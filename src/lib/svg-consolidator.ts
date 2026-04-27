/**
 * SVG Consolidator
 *
 * Takes an SVG with many paths/colors and produces a clean output with
 * a small number of compound paths — one per colour layer — ready for
 * cutting machines.
 *
 * Flow:
 *  1. Parse <style> to resolve class → fill/stroke.
 *  2. Extract every drawable element as path-data + colour.
 *  3. Ask OpenAI to group similar colours into layers.
 *  4. Build one compound <path> per layer.
 *  5. Return minimal SVG.
 */

import { groupColorsForCutting, type ColorGroup } from "./openai";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ParsedElement {
  d: string;
  fill: string;   // resolved hex or "none"
  stroke: string;  // resolved hex or "none"
}

export interface ConsolidationLayer {
  name: string;
  color: string;
  pathCount: number;
}

export interface ConsolidationResult {
  svg: string;
  layers: ConsolidationLayer[];
}

/* ------------------------------------------------------------------ */
/*  Colour resolution                                                  */
/* ------------------------------------------------------------------ */

interface ClassStyle {
  fill: string;
  stroke: string;
  strokeLinecap: string;
  strokeLinejoin: string;
}

function resolveClassStyles(svg: string): Map<string, ClassStyle> {
  const map = new Map<string, ClassStyle>();
  const styleBlock = svg.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "";

  // Match rules like  .cls-1 { fill: none; stroke: #000; ... }
  const ruleRe = /\.([a-zA-Z_][\w-]*)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(styleBlock)) !== null) {
    const cls = m[1];
    const body = m[2];
    const fill = body.match(/fill:\s*([^;\s}]+)/)?.[1] ?? "";
    const stroke = body.match(/(?<![a-z-])stroke:\s*([^;\s}]+)/)?.[1] ?? "";
    const cap = body.match(/stroke-linecap:\s*([^;\s}]+)/)?.[1] ?? "";
    const join = body.match(/stroke-linejoin:\s*([^;\s}]+)/)?.[1] ?? "";
    map.set(cls, { fill, stroke, strokeLinecap: cap, strokeLinejoin: join });
  }
  return map;
}

function resolveElementColor(
  elStr: string,
  classStyles: Map<string, ClassStyle>
): { fill: string; stroke: string } {
  let fill = "";
  let stroke = "";

  // Try inline attributes first
  const inlineFill = elStr.match(/\bfill="([^"]*)"/)?.[1];
  const inlineStroke = elStr.match(/\bstroke="([^"]*)"/)?.[1];
  if (inlineFill) fill = inlineFill;
  if (inlineStroke) stroke = inlineStroke;

  // Overlay class styles (class wins for properties it sets)
  const cls = elStr.match(/\bclass="([^"]*)"/)?.[1];
  if (cls) {
    const style = classStyles.get(cls);
    if (style) {
      if (style.fill) fill = style.fill;
      if (style.stroke) stroke = style.stroke;
    }
  }

  // Inline style attribute (highest precedence)
  const inlineStyle = elStr.match(/\bstyle="([^"]*)"/)?.[1];
  if (inlineStyle) {
    const sf = inlineStyle.match(/fill:\s*([^;\s]+)/)?.[1];
    const ss = inlineStyle.match(/(?<![a-z-])stroke:\s*([^;\s]+)/)?.[1];
    if (sf) fill = sf;
    if (ss) stroke = ss;
  }

  // Normalise near-black to #000000 (design tools export #202325 etc.)
  let finalFill = fill || "#000000";
  if (finalFill !== "none" && finalFill !== "#000000") {
    const h = finalFill.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16) || 0;
    const g = parseInt(h.substring(2, 4), 16) || 0;
    const b = parseInt(h.substring(4, 6), 16) || 0;
    if (Math.sqrt(r * r + g * g + b * b) < 65) finalFill = "#000000";
  }

  return {
    fill: finalFill,
    stroke: stroke || "none",
  };
}

/* ------------------------------------------------------------------ */
/*  Element → path-data converters                                     */
/* ------------------------------------------------------------------ */

function rectToPath(el: string): string | null {
  const x = parseFloat(el.match(/\bx="([^"]*)"/)?.[1] ?? "0");
  const y = parseFloat(el.match(/\by="([^"]*)"/)?.[1] ?? "0");
  const w = parseFloat(el.match(/\bwidth="([^"]*)"/)?.[1] ?? "0");
  const h = parseFloat(el.match(/\bheight="([^"]*)"/)?.[1] ?? "0");
  if (!w || !h) return null;
  return `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;
}

function polygonToPath(el: string): string | null {
  const raw = el.match(/\bpoints="([^"]*)"/)?.[1]?.trim();
  if (!raw) return null;
  const nums = raw.split(/[\s,]+/).map(Number);
  if (nums.length < 4) return null;
  let d = `M${nums[0]} ${nums[1]}`;
  for (let i = 2; i < nums.length; i += 2) {
    d += ` L${nums[i]} ${nums[i + 1]}`;
  }
  return d + " Z";
}

function circleToPath(el: string): string | null {
  const cx = parseFloat(el.match(/\bcx="([^"]*)"/)?.[1] ?? "0");
  const cy = parseFloat(el.match(/\bcy="([^"]*)"/)?.[1] ?? "0");
  const r = parseFloat(el.match(/\br="([^"]*)"/)?.[1] ?? "0");
  if (!r) return null;
  // Approximate circle with two arcs
  return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
}

function ellipseToPath(el: string): string | null {
  const cx = parseFloat(el.match(/\bcx="([^"]*)"/)?.[1] ?? "0");
  const cy = parseFloat(el.match(/\bcy="([^"]*)"/)?.[1] ?? "0");
  const rx = parseFloat(el.match(/\brx="([^"]*)"/)?.[1] ?? "0");
  const ry = parseFloat(el.match(/\bry="([^"]*)"/)?.[1] ?? "0");
  if (!rx || !ry) return null;
  return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
}

/* ------------------------------------------------------------------ */
/*  Extract all drawable elements                                      */
/* ------------------------------------------------------------------ */

function extractElements(
  svg: string,
  classStyles: Map<string, ClassStyle>
): ParsedElement[] {
  const elements: ParsedElement[] = [];

  // Build a map of inherited fills from <g> parent elements.
  // Walk through the SVG tracking open/close <g> tags and their fills.
  const groupFillStack: string[] = [];
  const inheritedFillAt = new Map<number, string>(); // position → inherited fill

  const tagRe = /<(\/?)g\b([^>]*)>|<(path|rect|polygon|circle|ellipse)\b/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(svg)) !== null) {
    if (tagMatch[1] === "/") {
      // </g>
      groupFillStack.pop();
    } else if (tagMatch[0].startsWith("<g")) {
      // <g ...> — check for fill attribute
      const gFill = tagMatch[2].match(/\bfill="([^"]*)"/)?.[1];
      groupFillStack.push(gFill ?? groupFillStack[groupFillStack.length - 1] ?? "");
    } else {
      // drawable element — record its inherited fill
      const inherited = groupFillStack[groupFillStack.length - 1] ?? "";
      if (inherited) inheritedFillAt.set(tagMatch.index, inherited);
    }
  }

  // <path d="...">
  const pathRe = /<path\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(svg)) !== null) {
    const el = m[0];
    const d = el.match(/\bd="([^"]*)"/)?.[1]?.trim();
    if (!d) continue;
    let { fill, stroke } = resolveElementColor(el, classStyles);
    // If no fill was resolved, check inherited from parent <g>
    if (fill === "#000000" && !el.includes('fill=') && !el.includes('class=')) {
      const inherited = inheritedFillAt.get(m.index);
      if (inherited) fill = inherited;
    }
    elements.push({ d, fill, stroke });
  }

  // <rect> — skip full-canvas background rects (Illustrator artboards)
  const vbMatch = svg.match(/viewBox="([^"]*)"/);
  const vbParts = vbMatch?.[1]?.split(/\s+/).map(Number) ?? [];
  const vbW = vbParts[2] ?? 10000;
  const vbH = vbParts[3] ?? 10000;

  const rectRe = /<rect\b[^>]*\/?>/gi;
  while ((m = rectRe.exec(svg)) !== null) {
    const rw = parseFloat(m[0].match(/\bwidth="([^"]*)"/)?.[1] ?? "0");
    const rh = parseFloat(m[0].match(/\bheight="([^"]*)"/)?.[1] ?? "0");
    if (rw >= vbW * 0.9 && rh >= vbH * 0.9) continue;
    const d = rectToPath(m[0]);
    if (!d) continue;
    let { fill, stroke } = resolveElementColor(m[0], classStyles);
    if (fill === "#000000" && !m[0].includes('fill=') && !m[0].includes('class=')) {
      const inherited = inheritedFillAt.get(m.index);
      if (inherited) fill = inherited;
    }
    elements.push({ d, fill, stroke });
  }

  // <polygon>
  const polyRe = /<polygon\b[^>]*\/?>/gi;
  while ((m = polyRe.exec(svg)) !== null) {
    const d = polygonToPath(m[0]);
    if (!d) continue;
    let { fill, stroke } = resolveElementColor(m[0], classStyles);
    if (fill === "#000000" && !m[0].includes('fill=') && !m[0].includes('class=')) {
      const inherited = inheritedFillAt.get(m.index);
      if (inherited) fill = inherited;
    }
    elements.push({ d, fill, stroke });
  }

  // <circle>
  const circleRe = /<circle\b[^>]*\/?>/gi;
  while ((m = circleRe.exec(svg)) !== null) {
    const d = circleToPath(m[0]);
    if (!d) continue;
    const { fill, stroke } = resolveElementColor(m[0], classStyles);
    elements.push({ d, fill, stroke });
  }

  // <ellipse>
  const ellipseRe = /<ellipse\b[^>]*\/?>/gi;
  while ((m = ellipseRe.exec(svg)) !== null) {
    const d = ellipseToPath(m[0]);
    if (!d) continue;
    const { fill, stroke } = resolveElementColor(m[0], classStyles);
    elements.push({ d, fill, stroke });
  }

  return elements;
}

/* ------------------------------------------------------------------ */
/*  Fallback grouping (no AI)                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Colour-distance clustering (fallback when AI is unavailable)       */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
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
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

function colorDist(a: [number, number, number], b: [number, number, number]) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** Determine a sensible max layer count based on unique colour count. */
function targetGroupCount(uniqueCount: number): number {
  if (uniqueCount <= 3) return uniqueCount;
  if (uniqueCount <= 8) return Math.min(uniqueCount, 5);
  if (uniqueCount <= 20) return 5;
  return 6;
}

/**
 * Hierarchical agglomerative clustering — merge the two closest
 * colour groups until we reach `maxGroups`.
 */
function clusterColors(
  colorStats: Array<{ color: string; count: number }>,
  maxGroups: number
): ColorGroup[] {
  const visible = colorStats.filter((c) => c.color !== "none");
  if (visible.length === 0) return [];

  // Bootstrap: one cluster per colour
  let clusters: Array<{
    colors: Array<{ color: string; count: number }>;
    rgb: [number, number, number];
    totalCount: number;
  }> = visible.map((c) => ({
    colors: [c],
    rgb: hexToRgb(c.color),
    totalCount: c.count,
  }));

  // Merge closest pair until at target
  while (clusters.length > maxGroups) {
    let minDist = Infinity;
    let mi = 0;
    let mj = 1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = colorDist(clusters[i].rgb, clusters[j].rgb);
        if (d < minDist) {
          minDist = d;
          mi = i;
          mj = j;
        }
      }
    }

    // Weighted-average centroid
    const a = clusters[mi];
    const b = clusters[mj];
    const total = a.totalCount + b.totalCount;
    const wa = a.totalCount / total;
    const wb = b.totalCount / total;

    a.colors.push(...b.colors);
    a.rgb = [
      a.rgb[0] * wa + b.rgb[0] * wb,
      a.rgb[1] * wa + b.rgb[1] * wb,
      a.rgb[2] * wa + b.rgb[2] * wb,
    ];
    a.totalCount = total;
    clusters.splice(mj, 1);
  }

  return clusters.map((cl, i) => {
    // Representative = most-used colour in the cluster
    const sorted = [...cl.colors].sort((a, b) => b.count - a.count);
    return {
      name: `Layer ${i + 1}`,
      representativeColor: sorted[0].color,
      inputColors: cl.colors.map((c) => c.color),
    };
  });
}

/** Trivial grouping for ≤1 colour. */
function singleGrouping(uniqueColors: string[]): ColorGroup[] {
  return uniqueColors
    .filter((c) => c !== "none")
    .map((c, i) => ({
      name: `Layer ${i + 1}`,
      representativeColor: c,
      inputColors: [c],
    }));
}

/* ------------------------------------------------------------------ */
/*  Build the consolidated SVG                                         */
/* ------------------------------------------------------------------ */

function buildSVG(
  viewBox: string,
  groups: ColorGroup[],
  elementsByColor: Map<string, ParsedElement[]>
): string {
  const paths: string[] = [];

  for (const group of groups) {
    const groupElements: ParsedElement[] = [];
    for (const inputColor of group.inputColors) {
      const els = elementsByColor.get(inputColor);
      if (els) groupElements.push(...els);
    }
    if (groupElements.length === 0) continue;

    const color = group.representativeColor;

    // Skip invisible elements (no fill AND no stroke)
    if (color === "none") continue;

    const compoundD = groupElements.map((el) => el.d).join(" ");
    const layerComment = `  <!-- ${group.name} (${groupElements.length} paths) -->`;

    // Always output filled paths with evenodd rule — this ensures inner
    // contours (letter holes, banner interiors) cut as holes, not solid fills.
    paths.push(
      `${layerComment}\n  <path d="${compoundD}" fill="${color}" fill-rule="evenodd"/>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n${paths.join("\n")}\n</svg>`;
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

export async function consolidateSVG(
  svgContent: string
): Promise<ConsolidationResult> {
  // 1. Parse styles and extract elements
  const classStyles = resolveClassStyles(svgContent);
  const elements = extractElements(svgContent, classStyles);

  if (elements.length === 0) {
    return { svg: svgContent, layers: [] };
  }

  // 2. Colour key for each element
  const colorKey = (el: ParsedElement): string => {
    if (el.fill !== "none") return el.fill;
    if (el.stroke !== "none") return el.stroke;
    return "none";
  };

  // 3. Build layers respecting STACKING ORDER.
  // Only compound adjacent same-coloured elements. If a different
  // colour appears between two groups of the same colour, they stay
  // as separate layers (because merging would break the visual overlap).
  interface Layer {
    color: string;
    elements: ParsedElement[];
  }
  const NEAR_MATCH = 20; // only merge truly identical shades (avoids chain-merging)
  const MIN_PATH_LEN = 100; // skip tiny artifact paths (< 100 chars of path data)
  const layers: Layer[] = [];
  for (const el of elements) {
    const c = colorKey(el);
    if (c === "none") continue;
    // Skip tiny artifact paths — design-tool debris, not real elements
    if (el.d.length < MIN_PATH_LEN) continue;
    const prev = layers[layers.length - 1];
    // Merge with previous layer if exact match OR very close colour
    const isMatch = prev && (
      prev.color === c ||
      colorDist(hexToRgb(prev.color), hexToRgb(c)) < NEAR_MATCH
    );
    if (isMatch) {
      prev.elements.push(el);
    } else {
      layers.push({ color: c, elements: [el] });
    }
  }

  // No grouping/merging — every distinct colour run is its own layer.
  // This preserves the original stacking order faithfully.
  const colorGroups: ColorGroup[] = layers.map((l) => ({
    name: l.color,
    representativeColor: l.color,
    inputColors: [l.color],
  }));

  // 4. Extract viewBox
  const viewBox =
    svgContent.match(/viewBox="([^"]*)"/)?.[1] ?? "0 0 100 100";

  // 5. Build SVG — one compound path per layer, in stacking order
  const pathStrings: string[] = [];
  for (const layer of layers) {
    const compoundD = layer.elements.map((el) => el.d).join(" ");
    pathStrings.push(
      `  <!-- ${layer.color} (${layer.elements.length} paths) -->\n  <path d="${compoundD}" fill="${layer.color}" fill-rule="evenodd"/>`
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n${pathStrings.join("\n")}\n</svg>`;

  // 6. Build layer info
  const outputLayers: ConsolidationLayer[] = layers.map((l) => ({
    name: l.color,
    color: l.color,
    pathCount: l.elements.length,
  }));

  return { svg, layers: outputLayers };
}
