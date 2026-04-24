import sharp from "sharp";
import potrace from "potrace";

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

function posterizeAsync(
  buffer: Buffer,
  options: potrace.PosterizeOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    potrace.posterize(buffer, options, (err, svg) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });
}

export interface TraceOptions {
  recommendedColors: number;
  threshold?: number;
  backgroundColor?: string;
}

export async function traceImage(
  imageBuffer: Buffer,
  options: TraceOptions
): Promise<string> {
  const bgColor =
    options.backgroundColor && options.backgroundColor !== "none"
      ? options.backgroundColor
      : "#ffffff";

  // Preprocess: resize large images, flatten transparency, convert to PNG
  const processed = await sharp(imageBuffer)
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: bgColor })
    .normalize()
    .png()
    .toBuffer();

  const colors = Math.max(1, Math.min(options.recommendedColors, 4));

  if (colors <= 1) {
    // Single-color trace — best for silhouettes, text, simple designs
    const svg = await traceAsync(processed, {
      threshold: options.threshold ?? 128,
      color: "#000000",
      background: "transparent",
      turdSize: 50,
      optTolerance: 0.4,
    });
    return cleanTracedSVG(svg);
  }

  // Multi-color posterize
  const svg = await posterizeAsync(processed, {
    steps: colors,
    color: "auto",
    background: "transparent",
    turdSize: 30,
    optTolerance: 0.4,
  });
  return cleanTracedSVG(svg);
}

/**
 * Clean up potrace output for cutting machines:
 * - Ensure all paths are closed
 * - Remove fill-rule if it causes issues
 * - Add proper SVG namespace
 */
function cleanTracedSVG(svg: string): string {
  // Ensure xmlns is present
  if (!svg.includes("xmlns=")) {
    svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // Close any open paths
  svg = svg.replace(
    /(<path[^>]*\bd=")((?:(?!")\S|\s)*?)(")/g,
    (_match, before, pathData, after) => {
      const trimmed = pathData.trim();
      if (trimmed && !/[zZ]\s*$/.test(trimmed)) {
        return `${before}${trimmed} Z${after}`;
      }
      return `${before}${trimmed}${after}`;
    }
  );

  return svg;
}
