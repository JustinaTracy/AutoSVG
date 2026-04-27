/**
 * Per-colour raster-to-SVG tracer
 *
 * Instead of using potrace's posterize (which converts to grayscale
 * brightness levels and loses actual colours), this:
 *
 *  1. Quantises the image to N colours with sharp
 *  2. Identifies and removes the background colour
 *  3. Creates a binary mask for each foreground colour
 *  4. Traces each mask individually with potrace
 *  5. Assigns the original colour as the fill
 *
 * Result: filled compound paths with the real image colours.
 */

import sharp from "sharp";
import potrace from "potrace";
import { analyzeLayerStrategyWithRetry, groupAndColorIslands, type LayerStrategy } from "./openai";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function traceAsync(
  buffer: Buffer,
  options: potrace.PotraceOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    potrace.trace(buffer, options, (err, svg) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });
}

const NAMED_COLORS: Record<string, string> = {
  white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000",
  blue: "#0000ff", yellow: "#ffff00", cyan: "#00ffff", magenta: "#ff00ff",
  gray: "#808080", grey: "#808080", orange: "#ffa500", pink: "#ffc0cb",
  purple: "#800080", brown: "#a52a2a", transparent: "#ffffff",
};

function hexToRgb(hex: string): [number, number, number] {
  const mapped = NAMED_COLORS[hex.toLowerCase().trim()] ?? hex;
  const h = mapped.replace("#", "");
  if (h.length === 3)
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  return [
    parseInt(h.substring(0, 2), 16) || 0,
    parseInt(h.substring(2, 4), 16) || 0,
    parseInt(h.substring(4, 6), 16) || 0,
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")
      )
      .join("")
  );
}

function colorDistance(
  a: [number, number, number],
  b: [number, number, number]
): number {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  );
}

/** Split a compound path's d attribute into individual subpaths (each starting with M/m). */
function splitSubpaths(d: string): string[] {
  const parts: string[] = [];
  // Split on M/m commands but keep the M/m with its subpath
  const re = /[Mm][^Mm]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    const sp = m[0].trim();
    if (sp.length > 10) parts.push(sp); // skip trivially small
  }
  return parts;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface TraceOptions {
  recommendedColors: number;
  threshold?: number;
  backgroundColor?: string;
}

export interface TraceResult {
  svg: string;
  silhouetteSVG?: string;
  simplifiedSVG?: string;
  simplifiedLayers?: Array<{ name: string; color: string; pathCount: number }>;
  description: string;
}

export async function traceImage(
  imageBuffer: Buffer,
  options: TraceOptions
): Promise<TraceResult> {
  const designColors = Math.max(1, Math.min(options.recommendedColors, 6));

  // ── 1. Check for alpha channel ─────────────────────────────────
  const meta = await sharp(imageBuffer).metadata();
  const hasAlpha = !!(meta.channels && meta.channels >= 4 && meta.hasAlpha);

  // ── 2. Resize and read raw RGBA (before flattening) ────────────
  const resized = sharp(imageBuffer).resize(1200, 1200, {
    fit: "inside",
    withoutEnlargement: true,
  });

  const { data: rawRGBA, info: rawInfo } = await resized
    .clone()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = rawInfo;
  const ch = 4;
  const totalPixels = width * height;

  // Build alpha mask and verify there ARE actually transparent pixels.
  // Many PNGs have an alpha channel but are fully opaque — treat those
  // as non-alpha (use edge-based background detection instead).
  const alphaMask = new Uint8Array(totalPixels);
  let transparentPixelCount = 0;
  for (let i = 0; i < rawRGBA.length; i += ch) {
    const isTransparent = rawRGBA[i + 3] <= 128;
    alphaMask[i / ch] = isTransparent ? 0 : 1;
    if (isTransparent) transparentPixelCount++;
  }
  // Use alpha path if there are ANY transparent pixels. Zero = fake alpha
  // (PNG has alpha channel but every pixel is opaque, like a JPEG saved as PNG).
  const reallyHasAlpha = hasAlpha && transparentPixelCount > 0;

  // ── 3. Flatten and quantise ────────────────────────────────────
  const preprocessed = await resized
    .clone()
    .flatten({ background: "#ffffff" })
    .toBuffer();

  const quantizedBuf = await sharp(preprocessed)
    .png({ palette: true, colors: 24 })
    .toBuffer();

  const { data } = await sharp(quantizedBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // ── 4. Find unique colours (opaque pixels only for alpha images) ─
  const counts = new Map<string, number>();
  for (let i = 0; i < data.length; i += ch) {
    if (reallyHasAlpha && !alphaMask[i / ch]) continue; // skip transparent pixels
    const hex = rgbToHex(data[i], data[i + 1], data[i + 2]);
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }

  // ── 5. Strip background ────────────────────────────────────────
  // If the image has alpha, the background is ALREADY removed — the
  // alpha channel tells us exactly which pixels are foreground.
  // We only need to filter the dominant colour for non-alpha images
  // (JPEGs, PNGs without transparency).
  const BG_DISTANCE = 60;
  const MIN_SHARE = 0.004;
  const opaqueCount = reallyHasAlpha
    ? alphaMask.reduce((s, v) => s + v, 0)
    : totalPixels;

  let foreground: string[];

  if (reallyHasAlpha) {
    // Alpha image: every colour in `counts` is already foreground
    // (we skipped transparent pixels above). Just filter noise.
    const alphaEntries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const largestAlpha = alphaEntries[0]?.[1] ?? 1;
    foreground = alphaEntries
      .filter(([, count]) => count >= largestAlpha * 0.01)
      .map(([hex]) => hex);
  } else {
    // No alpha: detect background from EDGE pixels (borders of the image).
    // The background is whatever colour dominates the edges — this is far
    // more reliable than "most common overall" which fails when the
    // background is a gradient (many slightly different shades) while the
    // design is one solid colour.
    const edgeCounts = new Map<string, number>();
    const EDGE_WIDTH = 3; // sample 3px border

    for (let i = 0; i < data.length; i += ch) {
      const pi = i / ch;
      const px = pi % width;
      const py = Math.floor(pi / width);
      const isEdge =
        px < EDGE_WIDTH ||
        px >= width - EDGE_WIDTH ||
        py < EDGE_WIDTH ||
        py >= height - EDGE_WIDTH;
      if (!isEdge) continue;
      const hex = rgbToHex(data[i], data[i + 1], data[i + 2]);
      edgeCounts.set(hex, (edgeCounts.get(hex) || 0) + 1);
    }

    // The most common edge colour is the background
    const edgeSorted = [...edgeCounts.entries()].sort(
      (a, b) => b[1] - a[1]
    );
    const bgHex = edgeSorted[0]?.[0] ?? "#ffffff";
    const bgRgb = hexToRgb(bgHex);

    // First pass: remove background colours
    const fgEntries = [...counts.entries()]
      .filter(([hex]) => {
        if (hex === bgHex) return false;
        if (colorDistance(hexToRgb(hex), bgRgb) <= BG_DISTANCE) return false;
        return true;
      })
      .sort((a, b) => b[1] - a[1]);

    // Second pass: filter noise relative to LARGEST foreground colour.
    // This keeps small but important features (daisy centres at 0.2%
    // total are 2% of the main black at 10% → significant).
    const largestFG = fgEntries[0]?.[1] ?? 1;
    foreground = fgEntries
      .filter(([, count]) => count >= largestFG * 0.01) // 1% of largest fg
      .map(([hex]) => hex);
  }

  if (foreground.length === 0) {
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"></svg>`,
      description: "",
    };
  }

  // ── 5a. Silhouette trace ──────────────────────────────────────
  // Separate trace: ALL non-background pixels as one solid shape.
  // For alpha images: use the alpha mask directly — perfect accuracy.
  // For non-alpha: use tight dominant-colour detection.
  let silhouetteSVG: string | undefined;
  // Hoist silMask so it's available to both silhouette and simplified traces
  const silMask = Buffer.alloc(width * height, 255); // 255 = background
  if (foreground.length > 1) {
    if (reallyHasAlpha) {
      // Alpha mask is the ground truth — opaque = foreground
      for (let pi = 0; pi < totalPixels; pi++) {
        silMask[pi] = alphaMask[pi] ? 0 : 255;
      }
    } else {
      // No alpha: use edge-detected background colour
      const edgeCounts = new Map<string, number>();
      for (let i = 0; i < data.length; i += ch) {
        const pi = i / ch;
        const px = pi % width, py = Math.floor(pi / width);
        if (px >= 3 && px < width - 3 && py >= 3 && py < height - 3) continue;
        const hex = rgbToHex(data[i], data[i + 1], data[i + 2]);
        edgeCounts.set(hex, (edgeCounts.get(hex) || 0) + 1);
      }
      const edgeBg = [...edgeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#ffffff";
      const edgeBgRgb = hexToRgb(edgeBg);
      for (let i = 0; i < data.length; i += ch) {
        const dist = colorDistance([data[i], data[i + 1], data[i + 2]], edgeBgRgb);
        silMask[i / ch] = dist > BG_DISTANCE ? 0 : 255;
      }
    }
    // Blur + threshold for clean edges, then use for BOTH silhouette
    // trace and as the boundary reference for simplified mode
    // No blur — the silhouette should be a clean, accurate trace of
    // exactly what's in the mask. Any smoothing happens in potrace
    // via optTolerance, not by blurring the mask.
    // Median filter for alpha images: fills tiny transparent details
    // (bow highlights, eye sparkles, stitch marks) without affecting
    // large structural holes (circle interiors, letter counters).
    // Median is a majority-vote filter, NOT a blur — edges stay sharp.
    const silSharp = sharp(silMask, { raw: { width, height, channels: 1 } });
    const silPng = reallyHasAlpha
      ? await silSharp.median(5).png().toBuffer()
      : await silSharp.png().toBuffer();
    try {
      const silTraced = await traceAsync(silPng, {
        threshold: 128,
        color: "#000000",
        background: "transparent",
        turdSize: 300,  // aggressive — silhouettes should be clean outlines
        optTolerance: 2.0,
      });
      const silPaths: string[] = [];
      for (const m of silTraced.matchAll(/<path\b[^>]*>/gi)) {
        let p = m[0];
        // evenodd preserves real structural holes (circle interiors,
        // letter counters). Tiny transparent details (bow highlights,
        // eye sparkles) are removed by the median filter on the mask.
        if (!/fill-rule/.test(p)) p = p.replace("<path", '<path fill-rule="evenodd"');
        if (/fill="/.test(p)) p = p.replace(/fill="[^"]*"/, 'fill="#000000"');
        silPaths.push(p);
      }
      if (silPaths.length > 0) {
        // Use same viewBox as full color so toggling doesn't jump
        silhouetteSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n${silPaths.join("\n")}\n</svg>`;
      }
    } catch {
      // Silhouette trace failed — skip it
    }
  }

  // ── 5b. Merge near-duplicate colours + absorb satellites ────────
  // 1) Merge colours closer than MIN_COLOR_DIST
  // 80 catches "same colour family" like two shades of yellow on a
  // lemon (distance ~78) while keeping genuinely different hues
  // separate (red vs orange is ~128, blue vs purple is ~130+).
  const MIN_COLOR_DIST = 80;
  foreground = mergeNearDuplicates(foreground, counts, MIN_COLOR_DIST);

  // 2) Absorb "satellite" colours: if a colour has < 10% the pixels
  //    of its nearest larger neighbour, it's anti-aliasing noise.
  //    E.g. #3a3a3a (AA between black and white) gets absorbed into #000000.
  foreground = absorbSatellites(foreground, counts);

  // 3) Cluster down to max if still too many
  const MAX_LAYERS = 10;
  if (foreground.length > MAX_LAYERS) {
    foreground = clusterForeground(foreground, counts, MAX_LAYERS);
  }

  // ── 5c. Simplified — break silhouette into coloured islands ──────
  // Take the silhouette's subpaths ("islands"), colour each by sampling
  // the original image, then compound like-coloured islands.
  // Holes (transparent/bg centers) stay with their nearest fill island
  // so evenodd cuts them correctly.
  // Only available when there are 2+ fill islands (otherwise = silhouette).
  let simplifiedSVG: string | undefined;
  let simplifiedLayers: Array<{ name: string; color: string; pathCount: number }> = [];
  if (silhouetteSVG) {
    try {
      console.log(`[simplified] Starting — foreground: ${foreground.length} colours, silhouette exists: ${!!silhouetteSVG}`);
      // Get all subpaths from silhouette
      const silD = silhouetteSVG.match(/\bd="([^"]*)"/)?.[1] ?? "";
      const subpaths = splitSubpaths(silD);

      // Classify each subpath as fill-island or hole
      // Two-step approach:
      // 1. Build a per-pixel colour map from the quantized data (same
      //    as full-colour trace — reliable ground truth)
      // 2. For each subpath, find its BOUNDING BOX CENTER and sample
      //    the colour map there to determine its colour
      // 3. Group subpaths by colour, compound each group with evenodd

      // Step 1: pixel colour map
      const fgRgb = foreground.map((c) => hexToRgb(c));
      const pixColorMap = new Uint8Array(totalPixels);
      for (let i = 0; i < data.length; i += ch) {
        const pi = i / ch;
        if (reallyHasAlpha && !alphaMask[pi]) { pixColorMap[pi] = 255; continue; }
        const r = data[i], g = data[i + 1], b = data[i + 2];
        let bestIdx = 0, bestD = Infinity;
        for (let j = 0; j < fgRgb.length; j++) {
          const d = (r - fgRgb[j][0]) ** 2 + (g - fgRgb[j][1]) ** 2 + (b - fgRgb[j][2]) ** 2;
          if (d < bestD) { bestD = d; bestIdx = j; }
        }
        pixColorMap[pi] = bestIdx;
      }

      // Step 2: for each subpath, find bounding box center and sample
      const colorBuckets = new Map<string, string[]>();
      for (const sp of subpaths) {
        const nums = [...sp.matchAll(/-?[\d.]+/g)].map(Number);
        if (nums.length < 4) continue;

        // Compute bounding box
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < nums.length - 1; i += 2) {
          if (isFinite(nums[i]) && isFinite(nums[i + 1])) {
            if (nums[i] < minX) minX = nums[i];
            if (nums[i] > maxX) maxX = nums[i];
            if (nums[i + 1] < minY) minY = nums[i + 1];
            if (nums[i + 1] > maxY) maxY = nums[i + 1];
          }
        }

        // Sample at bounding box center
        const bcx = Math.round((minX + maxX) / 2);
        const bcy = Math.round((minY + maxY) / 2);
        const px = Math.max(0, Math.min(width - 1, bcx));
        const py = Math.max(0, Math.min(height - 1, bcy));
        const idx = pixColorMap[py * width + px];
        const color = idx < foreground.length ? foreground[idx] : foreground[0];

        if (!colorBuckets.has(color)) colorBuckets.set(color, []);
        colorBuckets.get(color)!.push(sp);
      }

      // Step 3: compound each colour group
      if (colorBuckets.size >= 2) {
        const simPaths: string[] = [];
        for (const [color, sps] of colorBuckets) {
          if (sps.length === 0) continue;
          simPaths.push(`<path d="${sps.join(" ")}" fill="${color}" fill-rule="evenodd"/>`);
        }
        if (simPaths.length > 1) {
          simplifiedSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n${simPaths.join("\n")}\n</svg>`;
          simplifiedLayers = [...colorBuckets.entries()]
            .filter(([, sps]) => sps.length > 0)
            .map(([color, sps]) => ({
              name: `Layer (${color})`,
              color,
              pathCount: sps.length,
            }));
        }
      }
    } catch {
      // Simplified failed — skip
    }
  }

  // ── 6. AI layer strategy ────────────────────────────────────────
  // Ask GPT-4o to look at the image and decide per-colour: is this a
  // solid fill layer (holes filled) or a detail layer (holes preserved)?
  let strategies: Map<string, LayerStrategy> = new Map();
  let imageDescription = "";
  {
    const thumbBuf = await sharp(preprocessed)
      .resize(600, 600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toBuffer();
    const thumbB64 = thumbBuf.toString("base64");
    const result = await analyzeLayerStrategyWithRetry(
      thumbB64,
      "image/jpeg",
      foreground
    );
    imageDescription = result.imageDescription ?? "";
    for (const layer of result.layers) {
      strategies.set(layer.color.toLowerCase(), layer);
    }
  }

  // ── 7. Per-colour mask → trace ─────────────────────────────────
  // For alpha images the bg colour doesn't matter (transparent pixels
  // were already excluded from counts). Use white as a placeholder.
  const bgRgbForOwnership: [number, number, number] = reallyHasAlpha
    ? [255, 255, 255]
    : hexToRgb(
        [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#ffffff"
      );
  const colorOwnership = buildColorOwnership(foreground, counts, bgRgbForOwnership, BG_DISTANCE);

  const pathElements: string[] = [];

  for (const color of foreground) {
    const ownedHexes = colorOwnership.get(color) ?? [color];
    const strategy = strategies.get(color.toLowerCase());
    const prevCount = pathElements.length;
    console.log(
      `[tracer] ${color}: ${strategy ? strategy.role + (strategy.fillHoles ? " (fill holes)" : " (keep holes)") : "no strategy (default: detail)"} — ${strategy?.description ?? ""}`
    );

    // Binary mask: opaque pixels matching one of the owned colours → black
    const mask = Buffer.alloc(width * height);
    for (let i = 0; i < data.length; i += ch) {
      const pi = i / ch;
      // For alpha images, skip transparent pixels
      if (reallyHasAlpha && !alphaMask[pi]) { mask[pi] = 255; continue; }
      const px = rgbToHex(data[i], data[i + 1], data[i + 2]);
      mask[pi] = ownedHexes.includes(px) ? 0 : 255;
    }

    // AI decides: "fill" layers get morphological close (solid shapes
    // for easy weeding), "detail" layers stay clean (letter holes preserved).
    const sharpMask = sharp(mask, { raw: { width, height, channels: 1 } });
    const maskPng =
      strategy?.fillHoles
        ? await sharpMask.blur(6).threshold(128).png().toBuffer()
        : await sharpMask.png().toBuffer();

    try {
      const traced = await traceAsync(maskPng, {
        threshold: 128,
        color: color,
        background: "transparent",
        turdSize: 100,
        // optTolerance: curve-fitting tolerance. Higher = smoother
        // paths with fewer nodes. Default 0.4 is pixel-level jagged.
        // 2.0 gives clean smooth curves ideal for cutting machines.
        optTolerance: 2.0,
      });

      // Pull <path> elements out of potrace's SVG
      for (const m of traced.matchAll(/<path\b[^>]*>/gi)) {
        let p = m[0];

        // Ensure fill-rule="evenodd"
        if (!/fill-rule/.test(p)) {
          p = p.replace("<path", '<path fill-rule="evenodd"');
        }

        // Force the correct fill colour
        if (/fill="/.test(p)) {
          p = p.replace(/fill="[^"]*"/, `fill="${color}"`);
        } else {
          p = p.replace("<path", `<path fill="${color}"`);
        }

        // Close any open subpaths
        p = p.replace(/\bd="([^"]*)"/, (_m, d) => {
          const trimmed = d.trim();
          if (trimmed && !/[zZ]\s*$/.test(trimmed)) {
            return `d="${trimmed} Z"`;
          }
          return `d="${trimmed}"`;
        });

        // Skip empty or debris paths (very short path data = tiny fragments)
        const dAttr = p.match(/\bd="([^"]*)"/)?.[1] ?? "";
        if (!dAttr.trim() || !/[MLCSQTAmlcsqta]/.test(dAttr)) continue;
        if (dAttr.length < 50) continue; // debris: path data too short to be real

        pathElements.push(p);
      }

      // Add layer comment for readability
      if (pathElements.length > prevCount) {
        const desc = strategy?.description ?? color;
        const role = strategy?.role ?? "unknown";
        const comment = `<!-- Layer: ${desc} (${role}${strategy?.fillHoles ? ", solid" : ""}) -->`;
        pathElements.splice(prevCount, 0, comment);
      }
    } catch {
      // Skip colour if tracing fails
    }
  }

  // ── 8. Remove debris layers ──────────────────────────────────────
  if (pathElements.length > 1) {
    const pathSizes = pathElements.map((p) => {
      if (p.startsWith("<!--")) return Infinity; // keep comments
      const d = p.match(/\bd="([^"]*)"/)?.[1] ?? "";
      return d.length;
    });
    const realSizes = pathSizes.filter((s) => s !== Infinity);
    const maxSize = Math.max(...realSizes, 1);
    const MIN_RATIO = 0.02;

    const cleaned = pathElements.filter(
      (_, i) => pathSizes[i] === Infinity || pathSizes[i] >= maxSize * MIN_RATIO
    );

    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n${cleaned.join("\n")}\n</svg>`, silhouetteSVG, simplifiedSVG, simplifiedLayers: simplifiedLayers.length > 0 ? simplifiedLayers : undefined, description: imageDescription };
  }

  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n${pathElements.join("\n")}\n</svg>`, silhouetteSVG, description: imageDescription };
}

/**
 * Compute a tight viewBox around actual path content with 5% padding.
 */
function trimViewBox(
  elements: string[],
  origW: number,
  origH: number
): string {
  // Extract all numeric coordinate pairs from path d attributes
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const el of elements) {
    if (el.startsWith("<!--")) continue;
    const d = el.match(/\bd="([^"]*)"/)?.[1] ?? "";
    // Pull all numbers from path data (coordinates come in pairs)
    const nums = d.match(/-?[\d.]+/g)?.map(Number) ?? [];
    for (let i = 0; i < nums.length - 1; i += 2) {
      const x = nums[i], y = nums[i + 1];
      if (isFinite(x) && isFinite(y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Fall back to original dimensions if no coordinates found
  if (!isFinite(minX)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${origW} ${origH}">\n${elements.join("\n")}\n</svg>`;
  }

  // Add 5% padding
  const w = maxX - minX;
  const h = maxY - minY;
  const pad = Math.max(w, h) * 0.05;
  const vbX = Math.max(0, minX - pad).toFixed(1);
  const vbY = Math.max(0, minY - pad).toFixed(1);
  const vbW = (w + pad * 2).toFixed(1);
  const vbH = (h + pad * 2).toFixed(1);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">\n${elements.join("\n")}\n</svg>`;
}

/* ------------------------------------------------------------------ */
/*  Foreground colour clustering                                       */
/* ------------------------------------------------------------------ */

/**
 * Merge any pair of colours closer than `minDist` in RGB space.
 * Keeps the one with more pixels as the representative.
 */
function mergeNearDuplicates(
  colors: string[],
  pixelCounts: Map<string, number>,
  minDist: number
): string[] {
  const result = [...colors];

  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        if (colorDistance(hexToRgb(result[i]), hexToRgb(result[j])) < minDist) {
          // Keep the one with more pixels
          const keepI =
            (pixelCounts.get(result[i]) ?? 0) >=
            (pixelCounts.get(result[j]) ?? 0);
          result.splice(keepI ? j : i, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  return result;
}

/**
 * Absorb small "satellite" colours into their nearest larger neighbour.
 * A satellite is a colour with < 10% the pixels of the nearest colour
 * that has MORE pixels. These are typically anti-aliasing artifacts
 * (e.g. #3a3a3a between black text and white background).
 */
function absorbSatellites(
  colors: string[],
  pixelCounts: Map<string, number>
): string[] {
  if (colors.length <= 1) return colors;

  // Sort by pixel count descending
  const sorted = [...colors].sort(
    (a, b) => (pixelCounts.get(b) ?? 0) - (pixelCounts.get(a) ?? 0)
  );

  const keep = new Set<string>();
  keep.add(sorted[0]); // largest always stays

  for (let i = 1; i < sorted.length; i++) {
    const myCount = pixelCounts.get(sorted[i]) ?? 0;

    // Find the nearest colour that is LARGER than this one
    let nearestLarger = sorted[0];
    let nearestDist = Infinity;
    for (const bigger of keep) {
      const d = colorDistance(hexToRgb(sorted[i]), hexToRgb(bigger));
      if (d < nearestDist) {
        nearestDist = d;
        nearestLarger = bigger;
      }
    }

    const nearestCount = pixelCounts.get(nearestLarger) ?? 0;

    // Only absorb if BOTH conditions are true:
    // 1. Has < 10% of the nearest larger colour's pixels (small)
    // 2. Is close in colour (distance < 150) — i.e. it's anti-aliasing
    // If it's far away in colour space, it's a genuinely different
    // colour that just happens to have few pixels (e.g. daisy centres).
    if (myCount < nearestCount * 0.1 && nearestDist < 150) {
      continue; // absorbed (anti-aliasing)
    }

    keep.add(sorted[i]);
  }

  // Preserve the original order
  return colors.filter((c) => keep.has(c));
}

/**
 * Merge the closest foreground colours until we reach `target` count.
 * Returns the representative hex for each surviving cluster.
 */
function clusterForeground(
  colors: string[],
  pixelCounts: Map<string, number>,
  target: number
): string[] {
  let clusters = colors.map((c) => ({
    members: [c],
    rgb: hexToRgb(c),
    pixels: pixelCounts.get(c) ?? 0,
  }));

  while (clusters.length > target) {
    let minDist = Infinity;
    let mi = 0;
    let mj = 1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = colorDistance(clusters[i].rgb, clusters[j].rgb);
        if (d < minDist) {
          minDist = d;
          mi = i;
          mj = j;
        }
      }
    }
    const a = clusters[mi];
    const b = clusters[mj];
    const total = a.pixels + b.pixels;
    const wa = a.pixels / total;
    const wb = b.pixels / total;
    a.members.push(...b.members);
    a.rgb = [
      a.rgb[0] * wa + b.rgb[0] * wb,
      a.rgb[1] * wa + b.rgb[1] * wb,
      a.rgb[2] * wa + b.rgb[2] * wb,
    ];
    a.pixels = total;
    clusters.splice(mj, 1);
  }

  // Return the most-common member as the representative
  return clusters.map((cl) => {
    const sorted = [...cl.members].sort(
      (a, b) => (pixelCounts.get(b) ?? 0) - (pixelCounts.get(a) ?? 0)
    );
    return sorted[0];
  });
}

/**
 * Build a map: representative colour → list of quantized hex values it owns.
 * Colours not in the foreground list (background, near-bg) are unowned.
 */
function buildColorOwnership(
  representatives: string[],
  pixelCounts: Map<string, number>,
  bgRgb: [number, number, number],
  bgThreshold: number
): Map<string, string[]> {
  const ownership = new Map<string, string[]>();
  for (const rep of representatives) {
    ownership.set(rep, []);
  }

  // Assign every quantized colour to its nearest representative
  for (const hex of pixelCounts.keys()) {
    // Skip background colours
    if (colorDistance(hexToRgb(hex), bgRgb) <= bgThreshold) continue;

    let bestRep = representatives[0];
    let bestDist = Infinity;
    for (const rep of representatives) {
      const d = colorDistance(hexToRgb(hex), hexToRgb(rep));
      if (d < bestDist) {
        bestDist = d;
        bestRep = rep;
      }
    }
    ownership.get(bestRep)!.push(hex);
  }

  return ownership;
}
