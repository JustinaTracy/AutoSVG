import { NextRequest, NextResponse } from "next/server";
import { analyzeImageForCutting } from "@/lib/openai";
import { traceImage } from "@/lib/tracer";
import { checkAndFixSVG, optimizeSVG } from "@/lib/svg-utils";
import { consolidateSVG } from "@/lib/svg-consolidator";
import {
  validateForCutting,
  buildChangelog,
  extractInputStats,
} from "@/lib/svg-validator";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

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

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: "File is too large. Maximum size is 10 MB." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type;

    // ── SVG upload ────────────────────────────────────────────────
    if (mimeType === "image/svg+xml") {
      const svgContent = buffer.toString("utf-8");

      // Snapshot input stats before any changes
      const inputStats = extractInputStats(svgContent);

      // 1. Structural checks & auto-fixes
      const { svg: fixedSVG } = checkAndFixSVG(svgContent);

      // 2. Consolidate into compound paths with AI colour grouping
      const { svg: consolidated, layers } = await consolidateSVG(fixedSVG);

      // 3. Validate the OUTPUT against cutting requirements
      const validation = validateForCutting(consolidated);

      // 4. Build human-readable changelog
      const changelog = buildChangelog(inputStats, consolidated, layers.length);

      return NextResponse.json({
        success: true,
        svg: consolidated,
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

      // Trace
      const tracedSVG = await traceImage(buffer, {
        recommendedColors: analysis.recommendedColors ?? 2,
        threshold: analysis.threshold,
        backgroundColor: analysis.backgroundColor,
      });

      // Consolidate
      const { svg: consolidated, layers } = await consolidateSVG(tracedSVG);
      const finalSVG = layers.length > 0 ? consolidated : optimizeSVG(tracedSVG);

      // Validate
      const validation = validateForCutting(finalSVG);

      // Changelog for raster is simpler — describe the conversion
      const changelog = [
        {
          action: "consolidated" as const,
          detail: `Traced raster image into ${layers.length || 1} vector layer${(layers.length || 1) !== 1 ? "s" : ""} with AI-optimised settings.`,
        },
        ...(analysis.suggestions?.map((s: string) => ({
          action: "info" as const,
          detail: s,
        })) ?? []),
      ];

      return NextResponse.json({
        success: true,
        svg: finalSVG,
        analysis: {
          description: analysis.description ?? "Processed image",
          originalType: mimeType.split("/")[1],
          colorCount: layers.length || (analysis.recommendedColors ?? 2),
          isMultiLayered:
            (layers.length || (analysis.recommendedColors ?? 2)) > 1,
          layers: layers.length > 0 ? layers : undefined,
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
