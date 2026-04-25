import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { analyzeImageForCutting } from "@/lib/openai";
import { traceImage } from "@/lib/tracer";
import { checkAndFixSVG, optimizeSVG } from "@/lib/svg-utils";
import { consolidateSVG } from "@/lib/svg-consolidator";
import {
  validateForCutting,
  repairSVG,
  buildChangelog,
  extractInputStats,
} from "@/lib/svg-validator";

export const maxDuration = 60; // seconds — tracing multiple colours takes time

const MAX_RASTER_SIZE = 50 * 1024 * 1024;
const MAX_SVG_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file uploaded." },
        { status: 400 }
      );
    }

    const mimeType = file.type;
    const isRaster =
      mimeType === "image/png" ||
      mimeType === "image/jpeg" ||
      mimeType === "image/jpg";

    // SVGs: hard 10MB limit (text-based, can't resize)
    // Rasters: accept up to 50MB, auto-resize to fit
    const sizeLimit = isRaster ? MAX_RASTER_SIZE : MAX_SVG_SIZE;
    if (file.size > sizeLimit) {
      return NextResponse.json(
        {
          success: false,
          error: isRaster
            ? "Image is too large (over 50 MB)."
            : "SVG file is too large. Maximum size is 10 MB.",
        },
        { status: 400 }
      );
    }

    const rawBuffer = Buffer.from(await file.arrayBuffer());

    // Auto-resize large raster images so they fit within processing limits
    let buffer: Buffer;
    if (isRaster && rawBuffer.length > 10 * 1024 * 1024) {
      buffer = await sharp(rawBuffer)
        .resize(4096, 4096, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
    } else {
      buffer = rawBuffer;
    }

    // ── SVG upload ────────────────────────────────────────────────
    if (mimeType === "image/svg+xml") {
      const svgContent = buffer.toString("utf-8");

      // Snapshot input stats before any changes
      const inputStats = extractInputStats(svgContent);

      // 1. Structural checks & auto-fixes
      const { svg: fixedSVG } = checkAndFixSVG(svgContent);

      // 2. Consolidate into compound paths with AI colour grouping
      const { svg: consolidated, layers } = await consolidateSVG(fixedSVG);

      // 3. Self-repair any remaining issues, then validate
      const { svg: repaired, repairs } = repairSVG(consolidated);
      const validation = validateForCutting(repaired);

      // 4. Build human-readable changelog
      const changelog = [
        ...buildChangelog(inputStats, repaired, layers.length),
        ...repairs.map((r) => ({ action: "fixed" as const, detail: r })),
      ];

      return NextResponse.json({
        success: true,
        svg: repaired,
        analysis: {
          description: "Uploaded SVG — consolidated into cut-ready compound paths.",
          originalType: "svg",
          colorCount: layers.length,
          isMultiLayered: layers.length > 1,
          layers,
        },
        validation,
        changelog,
      });
    }

    // ── Raster upload (PNG / JPEG) ───────────────────────────────
    if (
      mimeType === "image/png" ||
      mimeType === "image/jpeg" ||
      mimeType === "image/jpg"
    ) {
      const base64 = buffer.toString("base64");

      // AI analysis
      let analysis;
      try {
        analysis = await analyzeImageForCutting(base64, mimeType);
      } catch {
        analysis = {
          description: "Image (AI analysis unavailable)",
          recommendedColors: 2,
          isMultiLayered: false,
          complexity: "moderate" as const,
          suggestions: [
            "AI analysis was unavailable — the image was traced with default settings.",
          ],
          threshold: 128,
          backgroundColor: "#ffffff",
        };
      }

      // Trace — the tracer already quantises to real image colours,
      // creates per-colour masks, and traces each separately.
      // The output is already clean: one <path> per colour, correct
      // fills, fill-rule="evenodd".  No consolidation needed.
      const tracedSVG = await traceImage(buffer, {
        recommendedColors: analysis.recommendedColors ?? 2,
        threshold: analysis.threshold,
        backgroundColor: analysis.backgroundColor,
      });

      // Build layer info from the traced paths
      const tracedFills = [
        ...new Set(
          [...tracedSVG.matchAll(/fill="([^"]+)"/g)]
            .map((m) => m[1])
            .filter((f) => f !== "none" && f !== "transparent")
        ),
      ];
      const tracedPaths = [...tracedSVG.matchAll(/<path /g)].length;
      const layers = tracedFills.map((color) => ({
        name: color === "#000000" ? "Design" : `Layer (${color})`,
        color,
        pathCount: 1,
      }));

      // Self-repair any remaining issues, then validate
      const { svg: repairedSVG, repairs } = repairSVG(tracedSVG);
      const validation = validateForCutting(repairedSVG);

      // Update path/layer counts after repair
      const finalFills = [
        ...new Set(
          [...repairedSVG.matchAll(/fill="([^"]+)"/g)]
            .map((m) => m[1])
            .filter((f) => f !== "none" && f !== "transparent")
        ),
      ];
      const finalPaths = [...repairedSVG.matchAll(/<path /g)].length;
      const finalLayers = finalFills.map((color) => ({
        name: color === "#000000" ? "Design" : `Layer (${color})`,
        color,
        pathCount: 1,
      }));

      const changelog = [
        {
          action: "consolidated" as const,
          detail: `Traced raster image into ${finalPaths} colour layer${finalPaths !== 1 ? "s" : ""} preserving original colours.`,
        },
        ...repairs.map((r) => ({ action: "fixed" as const, detail: r })),
        ...(analysis.suggestions?.map((s: string) => ({
          action: "info" as const,
          detail: s,
        })) ?? []),
      ];

      return NextResponse.json({
        success: true,
        svg: repairedSVG,
        analysis: {
          description: analysis.description ?? "Processed image",
          originalType: mimeType.split("/")[1],
          colorCount: finalLayers.length,
          isMultiLayered: finalLayers.length > 1,
          layers: finalLayers,
          complexity: analysis.complexity,
        },
        validation,
        changelog,
      });
    }

    return NextResponse.json(
      {
        success: false,
        error:
          "Unsupported file type. Please upload a PNG, JPEG, or SVG file.",
      },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    console.error("Process API error:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
