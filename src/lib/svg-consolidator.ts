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
    fill: fill || "none",
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

  // <rect>
  const rectRe = /<rect\b[^>]*\/?>/gi;
  while ((m = rectRe.exec(svg)) !== null) {
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
/*  Detect fill vs stroke mode                                         */
/* ------------------------------------------------------------------ */

type SVGMode = "fill" | "stroke" | "mixed";

function detectMode(elements: ParsedElement[]): SVGMode {
  let filledCount = 0;
  let strokedCount = 0;
  for (const el of elements) {
    if (el.fill !== "none") filledCount++;
    if (el.stroke !== "none") strokedCount++;
  }
  if (filledCount > 0 && strokedCount === 0) return "fill";
  if (strokedCount > 0 && filledCount === 0) return "stroke";
  if (filledCount > strokedCount * 2) return "fill";
  if (strokedCount > filledCount * 2) return "stroke";
  return "mixed";
}

/* ------------------------------------------------------------------ */
/*  Fallback grouping (no AI)                                          */
/* ------------------------------------------------------------------ */

function fallbackGrouping(uniqueColors: string[]): ColorGroup[] {
  return uniqueColors.map((c, i) => ({
    name: c === "none" ? "Cut Lines" : `Layer ${i + 1}`,
    representativeColor: c,
    inputColors: [c],
  }));
}

/* ------------------------------------------------------------------ */
/*  Build the consolidated SVG                                         */
/* ------------------------------------------------------------------ */

function buildSVG(
  viewBox: string,
  mode: SVGMode,
  groups: ColorGroup[],
  elementsByColor: Map<string, ParsedElement[]>,
  strokeAttrs: { linecap: string; linejoin: string }
): string {
  const paths: string[] = [];

  for (const group of groups) {
    // Collect all elements whose colour belongs to this group
    const groupElements: ParsedElement[] = [];
    for (const inputColor of group.inputColors) {
      const els = elementsByColor.get(inputColor);
      if (els) groupElements.push(...els);
    }
    if (groupElements.length === 0) continue;

    // Build compound path data
    const compoundD = groupElements.map((el) => el.d).join(" ");

    const color = group.representativeColor;
    const layerComment = `  <!-- ${group.name} (${groupElements.length} paths) -->`;

    if (color === "none" || mode === "stroke") {
      // Stroke-based layer
      const strokeColor =
        mode === "stroke" && color !== "none"
          ? color
          : groupElements[0]?.stroke !== "none"
            ? groupElements[0].stroke
            : "#000000";
      const cap = strokeAttrs.linecap
        ? ` stroke-linecap="${strokeAttrs.linecap}"`
        : "";
      const join = strokeAttrs.linejoin
        ? ` stroke-linejoin="${strokeAttrs.linejoin}"`
        : "";
      paths.push(
        `${layerComment}\n  <path d="${compoundD}" fill="none" stroke="${strokeColor}"${cap}${join}/>`
      );
    } else {
      // Fill-based layer
      paths.push(
        `${layerComment}\n  <path d="${compoundD}" fill="${color}"/>`
      );
    }
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

  // 2. Detect mode
  const mode = detectMode(elements);

  // 3. Determine the "colour key" for each element
  const colorKey = (el: ParsedElement): string => {
    if (mode === "stroke") return el.stroke !== "none" ? el.stroke : "none";
    return el.fill !== "none" ? el.fill : "none";
  };

  // 4. Group elements by their colour
  const elementsByColor = new Map<string, ParsedElement[]>();
  for (const el of elements) {
    const key = colorKey(el);
    if (!elementsByColor.has(key)) elementsByColor.set(key, []);
    elementsByColor.get(key)!.push(el);
  }

  const uniqueColors = [...elementsByColor.keys()];

  // 5. Determine stroke attributes to preserve (from the first class that has them)
  let strokeLinecap = "";
  let strokeLinejoin = "";
  for (const style of classStyles.values()) {
    if (style.strokeLinecap) strokeLinecap = style.strokeLinecap;
    if (style.strokeLinejoin) strokeLinejoin = style.strokeLinejoin;
    if (strokeLinecap && strokeLinejoin) break;
  }

  // 6. Ask AI for colour grouping (or fall back)
  let colorGroups: ColorGroup[];

  if (uniqueColors.length <= 1) {
    // Single colour — no grouping needed
    colorGroups = fallbackGrouping(uniqueColors);
  } else {
    // Build colour stats for the AI
    const colorStats = uniqueColors.map((c) => ({
      color: c,
      count: elementsByColor.get(c)?.length ?? 0,
    }));

    try {
      colorGroups = await groupColorsForCutting(colorStats);

      // Validate: every input colour must appear in exactly one group
      const covered = new Set(colorGroups.flatMap((g) => g.inputColors));
      for (const c of uniqueColors) {
        if (!covered.has(c)) {
          // AI missed a colour — add it to the closest group or its own
          const smallest = colorGroups.reduce((a, b) =>
            a.inputColors.length < b.inputColors.length ? a : b
          );
          smallest.inputColors.push(c);
        }
      }
    } catch {
      colorGroups = fallbackGrouping(uniqueColors);
    }
  }

  // 7. Extract viewBox
  const viewBox =
    svgContent.match(/viewBox="([^"]*)"/)?.[1] ?? "0 0 100 100";

  // 8. Build the consolidated SVG
  const svg = buildSVG(
    viewBox,
    mode,
    colorGroups,
    elementsByColor,
    { linecap: strokeLinecap, linejoin: strokeLinejoin }
  );

  // 9. Build layer info
  const layers: ConsolidationLayer[] = colorGroups
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
