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
    // Replace url(#gradient) fills with a solid color
    svg = svg.replace(/fill\s*=\s*"url\(#[^)]*\)"/gi, 'fill="#000000"');
    svg = svg.replace(
      /fill\s*:\s*url\(#[^)]*\)/gi,
      "fill: #000000"
    );
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
  const pathRegex = /\bd="([^"]*)"/g;
  let match: RegExpExecArray | null;
  let hasOpenPaths = false;

  while ((match = pathRegex.exec(svg)) !== null) {
    const d = match[1].trim();
    if (d && !/[zZ]\s*$/.test(d) && /[MLCSQTAmlcsqta]/.test(d)) {
      hasOpenPaths = true;
      break;
    }
  }

  if (hasOpenPaths) {
    issues.push({
      type: "open-paths",
      description:
        "Some paths are not closed. They have been auto-closed for clean cutting.",
      severity: "medium",
      fixed: true,
    });
    svg = svg.replace(
      /(\bd=")((?:(?!")[^])*)(")/g,
      (_m, before, pathData, after) => {
        const trimmed = pathData.trim();
        if (
          trimmed &&
          !/[zZ]\s*$/.test(trimmed) &&
          /[MLCSQTAmlcsqta]/.test(trimmed)
        ) {
          return `${before}${trimmed} Z${after}`;
        }
        return `${before}${trimmed}${after}`;
      }
    );
  }

  // --- Stroke-only elements (no fill) — might produce cut lines not shapes ---
  if (
    /stroke\s*[:=]\s*["']?(?!none|transparent).*fill\s*[:=]\s*["']?none/i.test(
      svg
    ) ||
    /fill\s*[:=]\s*["']?none.*stroke\s*[:=]\s*["']?(?!none|transparent)/i.test(
      svg
    )
  ) {
    issues.push({
      type: "stroke-only",
      description:
        "Some elements use strokes without fills. Cutting machines follow fill outlines — stroked shapes may cut as outlines only.",
      severity: "low",
      fixed: false,
    });
  }

  // --- Very thin strokes ---
  const thinStroke = /stroke-width\s*[:=]\s*["']?\s*(0\.0\d|0\.[01]\d)/i;
  if (thinStroke.test(svg)) {
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

/**
 * Optimise SVG for cutting machines using SVGO.
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
      "convertPathData" as const,
      "sortAttrs" as const,
    ],
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = optimize(svgContent, config as any);
    return result.data;
  } catch {
    return svgContent;
  }
}
