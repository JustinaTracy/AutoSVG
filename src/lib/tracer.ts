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
import { analyzeLayerStrategyWithRetry, type LayerStrategy } from "./openai";

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
  description: string;
}

export async function traceImage(
  imageBuffer: Buffer,
  options: TraceOptions
): Promise<TraceResult> {
  const bgColor =
    options.backgroundColor && options.backgroundColor !== "none"
      ? options.backgroundColor
      : "#ffffff";
  const designColors = Math.max(1, Math.min(options.recommendedColors, 6));

  // ── 1. Preprocess ──────────────────────────────────────────────
  // Lower resolution = fewer contour points = smoother, smaller paths.
  // 1200px is enough detail for cutting machines while keeping
  // path data manageable (~50-200 nodes per layer vs 12,000+).
  const preprocessed = await sharp(imageBuffer)
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: bgColor })
    .toBuffer();

  // ── 2. Quantise to a generous palette ────────────────────────────
  // Capture ALL meaningful colours. Err on the side of too many —
  // we filter background and cluster later. 24 palette entries is
  // enough to capture 5-8 real design colours plus anti-aliasing.
  const quantizedBuf = await sharp(preprocessed)
    .png({ palette: true, colors: 24 })
    .toBuffer();

  // ── 3. Read quantised pixels ───────────────────────────────────
  const { data, info } = await sharp(quantizedBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const ch = 4; // RGBA

  // ── 4. Find unique colours + pixel counts ──────────────────────
  const counts = new Map<string, number>();
  for (let i = 0; i < data.length; i += ch) {
    const hex = rgbToHex(data[i], data[i + 1], data[i + 2]);
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }

  // ── 5. Strip background colour ──────────────────────────────────
  // The background is the DOMINANT colour (most pixels). Remove it
  // and anything close to it. That's all — don't blanket-remove
  // near-black or near-white, as those may be the actual design.
  const BG_DISTANCE = 60;
  const totalPixels = width * height;
  const MIN_SHARE = 0.004;

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const dominantHex = sorted[0][0];
  const dominantRgb = hexToRgb(dominantHex);

  let foreground = sorted
    .filter(([hex, count]) => {
      if (hex === dominantHex) return false;
      if (colorDistance(hexToRgb(hex), dominantRgb) <= BG_DISTANCE) return false;
      if (count < totalPixels * MIN_SHARE) return false;
      return true;
    })
    .map(([hex]) => hex);

  if (foreground.length === 0) {
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"></svg>`, description: "" };
  }

  // ── 5a. Silhouette trace ──────────────────────────────────────
  // Separate trace: ALL non-background pixels as one solid shape.
  // Uses a TIGHT threshold — only the exact dominant colour (and very
  // close shades) counts as background. Everything else is foreground.
  // This ensures light interior areas (eyes, highlights) are NOT cut
  // out as holes — the silhouette is a solid filled outline.
  let silhouetteSVG: string | undefined;
  if (foreground.length > 1) {
    const SIL_BG_DIST = 25; // much tighter than the colour-layer BG_DISTANCE
    const silMask = Buffer.alloc(width * height);
    for (let i = 0; i < data.length; i += ch) {
      const dist = colorDistance(
        [data[i], data[i + 1], data[i + 2]],
        dominantRgb
      );
      silMask[i / ch] = dist > SIL_BG_DIST ? 0 : 255;
    }
    // Light blur to close tiny gaps between the design and background
    const silPng = await sharp(silMask, { raw: { width, height, channels: 1 } })
      .blur(2)
      .threshold(128)
      .png()
      .toBuffer();
    try {
      const silTraced = await traceAsync(silPng, {
        threshold: 128,
        color: "#000000",
        background: "transparent",
        turdSize: 150,
        optTolerance: 2.0,
      });
      const silPaths: string[] = [];
      for (const m of silTraced.matchAll(/<path\b[^>]*>/gi)) {
        let p = m[0];
        // Use evenodd — preserves real structural holes (donut shapes)
        // while the tight SIL_BG_DIST ensures light interior features
        // (eyes, highlights) are included as solid, not cut out.
        if (!/fill-rule/.test(p)) p = p.replace("<path", '<path fill-rule="evenodd"');
        if (/fill="/.test(p)) p = p.replace(/fill="[^"]*"/, 'fill="#000000"');
        const dAttr = p.match(/\bd="([^"]*)"/)?.[1] ?? "";
        if (dAttr.length < 50) continue;
        silPaths.push(p);
      }
      if (silPaths.length > 0) {
        const silTrimmed = trimViewBox(silPaths, width, height);
        silhouetteSVG = silTrimmed;
      }
    } catch {
      // Silhouette trace failed — skip it
    }
  }

  // ── 5b. Merge near-duplicate colours + cap at max layers ────────
  // First: merge any colours closer than MIN_COLOR_DIST — these are
  // anti-aliasing shades that should be the same layer.
  const MIN_COLOR_DIST = 35;
  foreground = mergeNearDuplicates(foreground, counts, MIN_COLOR_DIST);

  // Then: cluster down to max if still too many
  const MAX_LAYERS = 10;
  if (foreground.length > MAX_LAYERS) {
    foreground = clusterForeground(foreground, counts, MAX_LAYERS);
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
  const colorOwnership = buildColorOwnership(foreground, counts, dominantRgb, BG_DISTANCE);

  const pathElements: string[] = [];

  for (const color of foreground) {
    const ownedHexes = colorOwnership.get(color) ?? [color];
    const strategy = strategies.get(color.toLowerCase());
    const prevCount = pathElements.length;
    console.log(
      `[tracer] ${color}: ${strategy ? strategy.role + (strategy.fillHoles ? " (fill holes)" : " (keep holes)") : "no strategy (default: detail)"} — ${strategy?.description ?? ""}`
    );

    // Binary mask: any pixel matching one of the owned colours → black
    const mask = Buffer.alloc(width * height);
    for (let i = 0; i < data.length; i += ch) {
      const pi = i / ch;
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

    const trimmed = trimViewBox(cleaned, width, height);
    return { svg: trimmed, silhouetteSVG, description: imageDescription };
  }

  const trimmed = trimViewBox(pathElements, width, height);
  return { svg: trimmed, silhouetteSVG, description: imageDescription };
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
