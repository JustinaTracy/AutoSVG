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

  return {
    // SVG spec: default fill is black, default stroke is none
    fill: fill || "#000000",
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

  // <path d="...">
  const pathRe = /<path\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(svg)) !== null) {
    const el = m[0];
    const d = el.match(/\bd="([^"]*)"/)?.[1]?.trim();
    if (!d) continue;
    const { fill, stroke } = resolveElementColor(el, classStyles);
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
    // Skip rects that are ≥90% of the canvas — background/artboard
    if (rw >= vbW * 0.9 && rh >= vbH * 0.9) continue;
    const d = rectToPath(m[0]);
    if (!d) continue;
    const { fill, stroke } = resolveElementColor(m[0], classStyles);
    elements.push({ d, fill, stroke });
  }

  // <polygon>
  const polyRe = /<polygon\b[^>]*\/?>/gi;
  while ((m = polyRe.exec(svg)) !== null) {
    const d = polygonToPath(m[0]);
    if (!d) continue;
    const { fill, stroke } = resolveElementColor(m[0], classStyles);
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

  // 2. Determine the "colour key" — use whatever is visible (prefer fill, fall back to stroke)
  const colorKey = (el: ParsedElement): string => {
    if (el.fill !== "none") return el.fill;
    if (el.stroke !== "none") return el.stroke;
    return "none";
  };

  // 4. Group elements by their colour
  const elementsByColor = new Map<string, ParsedElement[]>();
  for (const el of elements) {
    const key = colorKey(el);
    if (!elementsByColor.has(key)) elementsByColor.set(key, []);
    elementsByColor.get(key)!.push(el);
  }

  const uniqueColors = [...elementsByColor.keys()];

  // 5. Determine target layer count and group colours
  const visibleColors = uniqueColors.filter((c) => c !== "none");
  const maxGroups = targetGroupCount(visibleColors.length);
  let colorGroups: ColorGroup[];

  if (visibleColors.length <= 1) {
    colorGroups = singleGrouping(uniqueColors);
  } else {
    // Build colour stats
    const colorStats = visibleColors.map((c) => ({
      color: c,
      count: elementsByColor.get(c)?.length ?? 0,
    }));

    try {
      colorGroups = await groupColorsForCutting(colorStats, maxGroups);

      // Validate: every input colour must appear in exactly one group
      const covered = new Set(colorGroups.flatMap((g) => g.inputColors));
      for (const c of visibleColors) {
        if (!covered.has(c)) {
          // AI missed a colour — add to nearest group by colour distance
          const rgb = hexToRgb(c);
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let i = 0; i < colorGroups.length; i++) {
            const gRgb = hexToRgb(colorGroups[i].representativeColor);
            const d = colorDist(rgb, gRgb);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
          }
          colorGroups[bestIdx].inputColors.push(c);
        }
      }

      // If AI returned too many groups, fall back to clustering
      if (colorGroups.length > maxGroups + 2) {
        colorGroups = clusterColors(colorStats, maxGroups);
      }
    } catch {
      // AI unavailable — cluster by colour distance
      colorGroups = clusterColors(colorStats, maxGroups);
    }
  }

  // 7. Extract viewBox
  const viewBox =
    svgContent.match(/viewBox="([^"]*)"/)?.[1] ?? "0 0 100 100";

  // 7. Build the consolidated SVG
  const svg = buildSVG(viewBox, colorGroups, elementsByColor);

  // 8. Build layer info (exclude invisible "none" groups)
  const layers: ConsolidationLayer[] = colorGroups
    .filter((g) => g.representativeColor !== "none")
    .map((g) => {
      const count = g.inputColors.reduce(
        (sum, c) => sum + (elementsByColor.get(c)?.length ?? 0),
        0
      );
      return { name: g.name, color: g.representativeColor, pathCount: count };
    })
    .filter((l) => l.pathCount > 0);

  return { svg, layers };
}
