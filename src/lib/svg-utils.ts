import { optimize } from "svgo";

export interface SVGIssue {
  type: string;
  description: string;
  severity: "high" | "medium" | "low";
  fixed: boolean;
}

export interface CheckResult {
  svg: string;
  issues: SVGIssue[];
}

/* ------------------------------------------------------------------ */
/*  Path helpers                                                       */
/* ------------------------------------------------------------------ */

/** Count how many <path> d-attributes are properly closed with Z/z. */
function countPaths(svg: string): { total: number; closed: number } {
  const dAttrs = [...svg.matchAll(/\bd="([^"]*)"/g)].map((m) => m[1].trim());
  const total = dAttrs.filter((d) => /[MLCSQTAmlcsqta]/.test(d)).length;
  const closed = dAttrs.filter(
    (d) => /[MLCSQTAmlcsqta]/.test(d) && /[zZ]\s*$/.test(d)
  ).length;
  return { total, closed };
}

/* ------------------------------------------------------------------ */
/*  SVG checker / fixer                                                */
/* ------------------------------------------------------------------ */

/**
 * Check an SVG for cutting-machine compatibility and auto-fix what we can.
 */
export function checkAndFixSVG(svgContent: string): CheckResult {
  const issues: SVGIssue[] = [];
  let svg = svgContent;

  // --- Text elements (cannot auto-fix — must be outlined in a vector editor) ---
  if (/<text[\s>]/i.test(svg)) {
    issues.push({
      type: "text-elements",
      description:
        "Contains <text> elements. Convert text to outlines/paths in your vector editor before cutting.",
      severity: "high",
      fixed: false,
    });
  }

  // --- Embedded raster images ---
  if (/<image[\s>]/i.test(svg)) {
    issues.push({
      type: "embedded-images",
      description:
        "Contains embedded raster images that cannot be cut. They have been removed.",
      severity: "high",
      fixed: true,
    });
    svg = svg.replace(/<image[^>]*\/>/gi, "");
    svg = svg.replace(/<image[^]*?<\/image>/gi, "");
  }

  // --- Gradients → replace with solid fills ---
  if (/<(linearGradient|radialGradient)[\s>]/i.test(svg)) {
    issues.push({
      type: "gradients",
      description:
        "Contains gradients which cutting machines cannot reproduce. They have been removed.",
      severity: "medium",
      fixed: true,
    });
    svg = svg.replace(/<linearGradient[^]*?<\/linearGradient>/gi, "");
    svg = svg.replace(/<radialGradient[^]*?<\/radialGradient>/gi, "");
    svg = svg.replace(/fill\s*=\s*"url\(#[^)]*\)"/gi, 'fill="#000000"');
    svg = svg.replace(/fill\s*:\s*url\(#[^)]*\)/gi, "fill: #000000");
  }

  // --- Filters / effects ---
  if (/<filter[\s>]/i.test(svg)) {
    issues.push({
      type: "filters",
      description:
        "Contains filter effects (blur, shadow, etc.) not supported by cutting machines. They have been removed.",
      severity: "medium",
      fixed: true,
    });
    svg = svg.replace(/<filter[^]*?<\/filter>/gi, "");
    svg = svg.replace(/filter\s*=\s*"[^"]*"/gi, "");
    svg = svg.replace(/filter\s*:\s*[^;"]+;?/gi, "");
  }

  // --- Masks ---
  if (/<mask[\s>]/i.test(svg)) {
    issues.push({
      type: "masks",
      description:
        "Contains mask elements that may not translate correctly to cutting. Review the output carefully.",
      severity: "medium",
      fixed: false,
    });
  }

  // --- Open paths ---
  const before = countPaths(svg);

  if (before.total > 0 && before.closed < before.total) {
    issues.push({
      type: "open-paths",
      description: `${before.total - before.closed} of ${before.total} paths are not closed. They have been auto-closed for clean cutting.`,
      severity: "medium",
      fixed: true,
    });
    svg = svg.replace(
      /(\bd=")((?:(?!")[^])*)(")/g,
      (_m, pre, pathData, post) => {
        const trimmed = pathData.trim();
        if (
          trimmed &&
          !/[zZ]\s*$/.test(trimmed) &&
          /[MLCSQTAmlcsqta]/.test(trimmed)
        ) {
          return `${pre}${trimmed} Z${post}`;
        }
        return `${pre}${trimmed}${post}`;
      }
    );
  }

  // --- Stroke-only elements (no fill) ---
  if (
    /stroke\s*[:=]\s*["']?(?!none|transparent)[\w#].*fill\s*[:=]\s*["']?none/i.test(svg) ||
    /fill\s*[:=]\s*["']?none.*stroke\s*[:=]\s*["']?(?!none|transparent)[\w#]/i.test(svg)
  ) {
    issues.push({
      type: "stroke-only",
      description:
        "Elements use strokes without fills. Cutting machines will follow stroke paths as cut/score lines.",
      severity: "low",
      fixed: false,
    });
  }

  // --- Very thin strokes ---
  if (/stroke-width\s*[:=]\s*["']?\s*(0\.0\d|0\.[01]\d)/i.test(svg)) {
    issues.push({
      type: "thin-strokes",
      description:
        "Very thin strokes detected that may be invisible after cutting.",
      severity: "low",
      fixed: false,
    });
  }

  return { svg, issues };
}

/* ------------------------------------------------------------------ */
/*  SVGO wrappers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Conservative optimise — metadata cleanup only, never touches paths.
 * Use for uploaded SVGs where the user's path data must be preserved.
 */
export function optimizeSVGConservative(svgContent: string): string {
  const config = {
    plugins: [
      {
        name: "preset-default" as const,
        params: {
          overrides: {
            // NEVER touch paths or structure
            removeViewBox: false,
            convertPathData: false,
            mergePaths: false,
            collapseGroups: false,
            convertTransform: false,
            convertShapeToPath: false,
            moveElemsAttrsToGroup: false,
            moveGroupAttrsToElems: false,
          },
        },
      },
    ],
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = optimize(svgContent, config as any);

    // Safety: verify we didn't lose or break any paths
    const before = countPaths(svgContent);
    const after = countPaths(result.data);

    if (after.total < before.total || after.closed < before.closed) {
      // Optimization degraded the SVG — return the original
      return svgContent;
    }

    return result.data;
  } catch {
    return svgContent;
  }
}

/**
 * Aggressive optimise — for SVGs we generated (traced output).
 * OK to restructure paths since we own them.
 */
export function optimizeSVG(svgContent: string): string {
  const config = {
    plugins: [
      {
        name: "preset-default" as const,
        params: {
          overrides: {
            removeViewBox: false,
          },
        },
      },
    ],
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = optimize(svgContent, config as any);

    // Even for traced SVGs, don't lose closed paths
    const before = countPaths(svgContent);
    const after = countPaths(result.data);

    if (after.closed < before.closed) {
      return svgContent;
    }

    return result.data;
  } catch {
    return svgContent;
  }
}
