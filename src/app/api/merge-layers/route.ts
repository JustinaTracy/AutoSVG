import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import potrace from "potrace";

function traceAsync(
  buffer: Buffer,
  options: potrace.PotraceOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    potrace.trace(buffer, options, (err, svg) => {
      if (err) reject(err);
      else resolve(svg || "");
    });
  });
}

export async function POST(request: NextRequest) {
  try {
    const { svg, sourceColor, targetColor } = await request.json();
    if (!svg || !sourceColor || !targetColor) {
      return NextResponse.json(
        { success: false, error: "Missing svg, sourceColor, or targetColor" },
        { status: 400 }
      );
    }

    const src = sourceColor.toLowerCase();
    const tgt = targetColor.toLowerCase();

    // ── 1. Parse all paths from the SVG ──────────────────────────────
    const pathRegex =
      /<path\b([^>]*)\/?>|<path\b([^>]*)>[^<]*<\/path>/gi;
    const paths: Array<{ fill: string; d: string }> = [];
    let match;
    while ((match = pathRegex.exec(svg)) !== null) {
      const attrs = match[1] || match[2] || "";
      const fill =
        attrs.match(/fill="([^"]+)"/)?.[1]?.toLowerCase() || "#000000";
      const d = attrs.match(/d="([^"]*)"/)?.[1] || "";
      paths.push({ fill, d });
    }

    const viewBox =
      svg.match(/viewBox="([^"]*)"/)?.[1] || "0 0 100 100";
    const vbParts = viewBox.split(/\s+/).map(Number);
    const vbW = vbParts[2] || 100;
    const vbH = vbParts[3] || 100;

    // Collect paths that will be merged vs. kept as-is
    const mergePaths = paths.filter((p) => p.fill === src || p.fill === tgt);

    if (mergePaths.length === 0) {
      return NextResponse.json(
        { success: false, error: "No matching paths found" },
        { status: 400 }
      );
    }

    // ── 2. Render merged paths to bitmap ─────────────────────────────
    // Render at exactly the viewBox dimensions so potrace coordinates
    // map 1:1 back to the SVG coordinate space.
    const renderW = Math.max(Math.round(vbW), 1);
    const renderH = Math.max(Math.round(vbH), 1);

    const tempPathsStr = mergePaths
      .map((p) => `<path d="${p.d}" fill="#000000" fill-rule="evenodd"/>`)
      .join("\n");
    const tempSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${renderW}" height="${renderH}">
<rect width="100%" height="100%" fill="white"/>
${tempPathsStr}
</svg>`;

    const pngBuffer = await sharp(Buffer.from(tempSVG)).png().toBuffer();

    // ── 3. Re-trace as a single unified shape ────────────────────────
    const traced = await traceAsync(pngBuffer, {
      threshold: 128,
      color: tgt,
      background: "transparent",
      turdSize: 15,
      optTolerance: 0.2,
    });

    // Extract <path> elements from potrace output
    const newPaths: Array<{ fill: string; d: string }> = [];
    for (const m of traced.matchAll(/<path\b[^>]*>/gi)) {
      const tag = m[0];
      const dMatch = tag.match(/\bd="([^"]*)"/);
      if (dMatch && dMatch[1].length > 30) {
        newPaths.push({ fill: tgt, d: dMatch[1] });
      }
    }

    if (newPaths.length === 0) {
      return NextResponse.json(
        { success: false, error: "Re-trace produced no paths" },
        { status: 500 }
      );
    }

    // ── 4. Rebuild SVG ───────────────────────────────────────────────
    // Insert re-traced path(s) where the first source/target path was,
    // keep all other paths in their original stacking order.
    const result: Array<{ fill: string; d: string }> = [];
    let inserted = false;
    for (const p of paths) {
      if ((p.fill === tgt || p.fill === src) && !inserted) {
        result.push(...newPaths);
        inserted = true;
      } else if (p.fill !== tgt && p.fill !== src) {
        result.push(p);
      }
    }
    if (!inserted) result.push(...newPaths);

    const gTransform = svg.match(
      /<g[^>]*transform="([^"]*)"/
    )?.[1];
    const pathStrings = result.map(
      (p) =>
        `<path d="${p.d}" fill="${p.fill}" fill-rule="evenodd"/>`
    );
    const inner = pathStrings.join("\n");
    const wrapped = gTransform
      ? `<g transform="${gTransform}">\n${inner}\n</g>`
      : inner;
    const finalSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n${wrapped}\n</svg>`;

    // Deduplicated layer list
    const seen = new Set<string>();
    const layers = result
      .filter((p) => {
        if (seen.has(p.fill)) return false;
        seen.add(p.fill);
        return true;
      })
      .map((p) => ({
        name: `Layer (${p.fill})`,
        color: p.fill,
        pathCount: 1,
      }));

    return NextResponse.json({ success: true, svg: finalSVG, layers });
  } catch (err) {
    console.error("merge-layers error:", err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
