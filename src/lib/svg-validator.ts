/**
 * Post-processing validator — runs a comprehensive checklist on the
 * OUTPUT SVG to verify it meets cutting-machine requirements.
 *
 * Every check returns pass/fail with a human-readable explanation.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ChecklistItem {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  severity: "critical" | "warning" | "info";
}

export interface ChangelogEntry {
  action: "fixed" | "removed" | "consolidated" | "preserved" | "warning";
  detail: string;
}

export interface InputStats {
  pathCount: number;
  elementCount: number;
  colorCount: number;
  openPaths: number;
  hasText: boolean;
  hasGradients: boolean;
  hasFilters: boolean;
  hasImages: boolean;
  hasMasks: boolean;
  fileSize: number;
}

export interface ValidationResult {
  checklist: ChecklistItem[];
  status: "pass" | "review" | "fail";
  passCount: number;
  totalCount: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function countPathData(svg: string) {
  const dAttrs = [...svg.matchAll(/\bd="([^"]*)"/g)].map((m) => m[1].trim());
  const withDrawCommands = dAttrs.filter((d) => /[MLCSQTAmlcsqta]/.test(d));
  const closed = withDrawCommands.filter((d) => /[zZ]\s*$/.test(d));
  // Count total subpaths (M/m commands = individual subpath starts)
  const subpaths = dAttrs.reduce((sum, d) => {
    return sum + [...d.matchAll(/[Mm]\s*[\d.-]/g)].length;
  }, 0);
  return {
    pathElements: [...svg.matchAll(/<path[\s>]/gi)].length,
    totalSubpaths: subpaths,
    withDrawCommands: withDrawCommands.length,
    closed: closed.length,
    open: withDrawCommands.length - closed.length,
  };
}

/* ------------------------------------------------------------------ */
/*  Main validator                                                     */
/* ------------------------------------------------------------------ */

export function validateForCutting(svg: string): ValidationResult {
  const items: ChecklistItem[] = [];
  const pd = countPathData(svg);

  // ── 1. All paths closed ─────────────────────────────────────
  items.push({
    id: "paths-closed",
    label: "All paths closed",
    passed: pd.open === 0,
    detail:
      pd.open === 0
        ? `All ${pd.withDrawCommands} paths end with a close command (Z).`
        : `${pd.open} of ${pd.withDrawCommands} paths are not closed — the blade may drag or lift unexpectedly.`,
    severity: "critical",
  });

  // ── 2. No text elements ─────────────────────────────────────
  const hasText = /<text[\s>]/i.test(svg);
  items.push({
    id: "no-text",
    label: "No text elements",
    passed: !hasText,
    detail: hasText
      ? "Text elements must be converted to paths (outlines) before cutting."
      : "No raw text — all content is vector paths.",
    severity: "critical",
  });

  // ── 3. No embedded raster images ────────────────────────────
  const hasImages = /<image[\s>]/i.test(svg);
  items.push({
    id: "no-images",
    label: "No embedded images",
    passed: !hasImages,
    detail: hasImages
      ? "Embedded raster images cannot be cut by a blade."
      : "No embedded raster images.",
    severity: "critical",
  });

  // ── 4. No gradients ─────────────────────────────────────────
  const hasGradients = /<(linearGradient|radialGradient)[\s>]/i.test(svg);
  items.push({
    id: "no-gradients",
    label: "No gradients",
    passed: !hasGradients,
    detail: hasGradients
      ? "Gradients cannot be reproduced by a cutting machine — use solid fills."
      : "All fills are solid colours.",
    severity: "critical",
  });

  // ── 5. No filters / effects ─────────────────────────────────
  const hasFilters = /<filter[\s>]/i.test(svg);
  items.push({
    id: "no-filters",
    label: "No filters or effects",
    passed: !hasFilters,
    detail: hasFilters
      ? "Filters (blur, shadow, glow) are not supported by cutting machines."
      : "No unsupported filter effects.",
    severity: "critical",
  });

  // ── 6. No masks ─────────────────────────────────────────────
  const hasMasks = /<mask[\s>]/i.test(svg);
  items.push({
    id: "no-masks",
    label: "No masks",
    passed: !hasMasks,
    detail: hasMasks
      ? "Mask elements may not translate correctly to cut paths."
      : "No mask elements.",
    severity: "warning",
  });

  // ── 7. Compound paths (low element count) ───────────────────
  const isCompound = pd.pathElements <= 12;
  items.push({
    id: "compound-paths",
    label: "Uses compound paths",
    passed: isCompound,
    detail: isCompound
      ? `${pd.pathElements} compound path${pd.pathElements !== 1 ? "s" : ""} containing ${pd.totalSubpaths} subpath${pd.totalSubpaths !== 1 ? "s" : ""} — clean layer structure for cutting software.`
      : `${pd.pathElements} separate path elements — cutting software may create too many layers. Consider consolidating.`,
    severity: "warning",
  });

  // ── 8. ViewBox present ──────────────────────────────────────
  const hasViewBox = /viewBox\s*=\s*"[^"]+"/i.test(svg);
  items.push({
    id: "viewbox",
    label: "ViewBox defined",
    passed: hasViewBox,
    detail: hasViewBox
      ? "ViewBox is set — cutting software can determine proportions."
      : "No viewBox attribute — the design may import at the wrong size.",
    severity: "warning",
  });

  // ── 9. SVG namespace ────────────────────────────────────────
  const hasNS = /xmlns\s*=\s*"http:\/\/www\.w3\.org\/2000\/svg"/i.test(svg);
  items.push({
    id: "namespace",
    label: "SVG namespace declared",
    passed: hasNS,
    detail: hasNS
      ? "Proper xmlns namespace for maximum compatibility."
      : "Missing xmlns — some cutting software may not recognise the file.",
    severity: "warning",
  });

  // ── 10. No extremely thin strokes ───────────────────────────
  const thinStroke = /stroke-width\s*[:=]\s*["']?\s*(0\.0\d|0\.[01]\d)/i.test(
    svg
  );
  items.push({
    id: "no-thin-strokes",
    label: "No ultra-thin strokes",
    passed: !thinStroke,
    detail: thinStroke
      ? "Some strokes are thinner than 0.1 — they may be invisible or cause blade issues."
      : "All strokes are a reasonable width.",
    severity: "warning",
  });

  // ── 11. No clip-paths (informational) ───────────────────────
  const hasClipPath = /<clipPath[\s>]/i.test(svg);
  items.push({
    id: "no-clip-paths",
    label: "No clip paths",
    passed: !hasClipPath,
    detail: hasClipPath
      ? "Clip paths are present — some cutting software handles these inconsistently."
      : "No clip paths.",
    severity: "info",
  });

  // ── 12. Reasonable file size ────────────────────────────────
  const sizeKB = Buffer.byteLength(svg) / 1024;
  const sizeOk = sizeKB < 500;
  items.push({
    id: "file-size",
    label: "Reasonable file size",
    passed: sizeOk,
    detail: sizeOk
      ? `${sizeKB.toFixed(0)} KB — well within cutting-software limits.`
      : `${sizeKB.toFixed(0)} KB — very large files may slow down or crash cutting software.`,
    severity: "info",
  });

  // ── 13. No <use>/<symbol> references ────────────────────────
  const hasUse = /<use[\s>]/i.test(svg);
  items.push({
    id: "no-use-refs",
    label: "No <use> references",
    passed: !hasUse,
    detail: hasUse
      ? "<use> references may not be resolved by all cutting software — inline the geometry."
      : "All geometry is inlined.",
    severity: "warning",
  });

  // ── Summary ─────────────────────────────────────────────────
  const criticalFails = items.filter(
    (i) => !i.passed && i.severity === "critical"
  ).length;
  const warningFails = items.filter(
    (i) => !i.passed && i.severity === "warning"
  ).length;
  const passCount = items.filter((i) => i.passed).length;

  let status: "pass" | "review" | "fail";
  if (criticalFails > 0) status = "fail";
  else if (warningFails > 0) status = "review";
  else status = "pass";

  return { checklist: items, status, passCount, totalCount: items.length };
}

/* ------------------------------------------------------------------ */
/*  Self-repair — fix every fixable critical issue                     */
/* ------------------------------------------------------------------ */

/**
 * If WE generated the SVG, WE fix any problems before giving it to
 * the customer. This runs after validation and patches anything the
 * checklist flagged as critical + fixable.
 */
export function repairSVG(svg: string): { svg: string; repairs: string[] } {
  const repairs: string[] = [];

  // 1. Close open paths
  let repaired = svg.replace(
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
  if (repaired !== svg) repairs.push("Closed open paths.");

  // 2. Remove any lingering gradients
  if (/<(linearGradient|radialGradient)[\s>]/i.test(repaired)) {
    repaired = repaired.replace(/<linearGradient[^]*?<\/linearGradient>/gi, "");
    repaired = repaired.replace(/<radialGradient[^]*?<\/radialGradient>/gi, "");
    repaired = repaired.replace(/fill\s*=\s*"url\(#[^)]*\)"/gi, 'fill="#000000"');
    repairs.push("Removed residual gradients.");
  }

  // 3. Remove any lingering filters
  if (/<filter[\s>]/i.test(repaired)) {
    repaired = repaired.replace(/<filter[^]*?<\/filter>/gi, "");
    repaired = repaired.replace(/filter\s*=\s*"[^"]*"/gi, "");
    repairs.push("Removed residual filters.");
  }

  // 4. Remove any embedded images
  if (/<image[\s>]/i.test(repaired)) {
    repaired = repaired.replace(/<image[^>]*\/>/gi, "");
    repaired = repaired.replace(/<image[^]*?<\/image>/gi, "");
    repairs.push("Removed embedded raster images.");
  }

  // 5. Ensure xmlns
  if (!/xmlns\s*=/.test(repaired)) {
    repaired = repaired.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    repairs.push("Added SVG namespace.");
  }

  return { svg: repaired, repairs };
}

/* ------------------------------------------------------------------ */
/*  Changelog builder                                                  */
/* ------------------------------------------------------------------ */

/**
 * Build a human-readable changelog by comparing input stats to the
 * output SVG.
 */
export function buildChangelog(
  input: InputStats,
  outputSvg: string,
  layerCount: number
): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const outPaths = [...outputSvg.matchAll(/<path[\s>]/gi)].length;
  const pd = countPathData(outputSvg);

  // Consolidation
  if (input.pathCount > outPaths) {
    entries.push({
      action: "consolidated",
      detail: `Merged ${input.pathCount} individual paths into ${outPaths} compound path${outPaths !== 1 ? "s" : ""} (${pd.totalSubpaths} subpaths).`,
    });
  } else if (input.pathCount === outPaths && outPaths <= 2) {
    entries.push({
      action: "preserved",
      detail: `Path structure preserved — already ${outPaths === 1 ? "a single" : outPaths} compound path${outPaths !== 1 ? "s" : ""}.`,
    });
  }

  // Colour grouping
  if (input.colorCount > layerCount && layerCount > 0) {
    entries.push({
      action: "consolidated",
      detail: `Grouped ${input.colorCount} colours into ${layerCount} cut layer${layerCount !== 1 ? "s" : ""}.`,
    });
  }

  // Open paths
  if (input.openPaths > 0) {
    entries.push({
      action: "fixed",
      detail: `Closed ${input.openPaths} open path${input.openPaths !== 1 ? "s" : ""} with Z commands.`,
    });
  }

  // Gradients
  if (input.hasGradients) {
    entries.push({
      action: "removed",
      detail: "Removed gradient definitions and replaced with solid fills.",
    });
  }

  // Filters
  if (input.hasFilters) {
    entries.push({
      action: "removed",
      detail: "Removed filter effects (blur, shadow, glow).",
    });
  }

  // Embedded images
  if (input.hasImages) {
    entries.push({
      action: "removed",
      detail: "Removed embedded raster images.",
    });
  }

  // Masks
  if (input.hasMasks) {
    entries.push({
      action: "warning",
      detail: "Mask elements detected — review output for correctness.",
    });
  }

  // Text
  if (input.hasText) {
    entries.push({
      action: "warning",
      detail:
        "Text elements found — convert to outlines in your vector editor before cutting.",
    });
  }

  // File size reduction
  const outSize = Buffer.byteLength(outputSvg);
  if (input.fileSize > outSize) {
    const pct = (((input.fileSize - outSize) / input.fileSize) * 100).toFixed(
      0
    );
    entries.push({
      action: "consolidated",
      detail: `Reduced file size by ${pct}% (${(input.fileSize / 1024).toFixed(0)} KB → ${(outSize / 1024).toFixed(0)} KB).`,
    });
  }

  if (entries.length === 0) {
    entries.push({
      action: "preserved",
      detail: "File was already well-structured — no changes needed.",
    });
  }

  return entries;
}

/* ------------------------------------------------------------------ */
/*  Input stats extractor                                              */
/* ------------------------------------------------------------------ */

export function extractInputStats(svg: string): InputStats {
  const dAttrs = [...svg.matchAll(/\bd="([^"]*)"/g)].map((m) => m[1].trim());
  const paths = dAttrs.filter((d) => /[MLCSQTAmlcsqta]/.test(d));
  const closed = paths.filter((d) => /[zZ]\s*$/.test(d));

  const rects = (svg.match(/<rect/g) || []).length;
  const circles = (svg.match(/<circle/g) || []).length;
  const polys = (svg.match(/<polygon/g) || []).length;
  const ellipses = (svg.match(/<ellipse/g) || []).length;

  const styleBlock = (svg.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || "";
  const fromStyle = [
    ...styleBlock.matchAll(/fill:\s*([^;\s}]+)/g),
  ].map((m) => m[1]);
  const fromAttr = [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);
  const colors = new Set(
    [...fromStyle, ...fromAttr].filter((f) => f !== "none")
  );

  return {
    pathCount: paths.length,
    elementCount: paths.length + rects + circles + polys + ellipses,
    colorCount: colors.size,
    openPaths: paths.length - closed.length,
    hasText: /<text[\s>]/i.test(svg),
    hasGradients: /<(linearGradient|radialGradient)[\s>]/i.test(svg),
    hasFilters: /<filter[\s>]/i.test(svg),
    hasImages: /<image[\s>]/i.test(svg),
    hasMasks: /<mask[\s>]/i.test(svg),
    fileSize: Buffer.byteLength(svg),
  };
}
