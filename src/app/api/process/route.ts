import { NextRequest, NextResponse } from "next/server";
import { analyzeImageForCutting, analyzeSVGForCutting } from "@/lib/openai";
import { traceImage } from "@/lib/tracer";
import { checkAndFixSVG, optimizeSVG, optimizeSVGConservative } from "@/lib/svg-utils";

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

      // Structural checks & auto-fixes
      const { svg: fixedSVG, issues } = checkAndFixSVG(svgContent);

      // AI analysis for deeper cuttability insight
      let aiAnalysis;
      try {
        aiAnalysis = await analyzeSVGForCutting(fixedSVG);
      } catch {
        aiAnalysis = {
          isCuttable: true,
          issues: [],
          hasOpenPaths: false,
          hasTextElements: false,
          hasTinyDetails: false,
          hasGradients: false,
          colorCount: 1,
          recommendedFixes: [],
          overallScore: 7,
        };
      }

      // Conservative optimise — preserve user's path data
      const optimized = optimizeSVGConservative(fixedSVG);

      // Our structural checks are ground truth.  AI issues that
      // contradict what we actually verified get filtered out.
      const structuralTypes = new Set(issues.map((i) => i.type));

      // Map AI issue type names to the structural facts we already checked
      const structurallyVerified = new Set([
        "open-paths",   "hasOpenPaths",   "openPaths",
        "text-elements","hasTextElements","textElements",
        "gradients",    "hasGradients",
        "filters",
        "embedded-images",
      ]);

      // Only keep AI issues that are NOT about things we structurally verified
      const aiOnlyIssues = (aiAnalysis.issues || [])
        .filter((i: { type: string }) => {
          // Skip if we already have it
          if (structuralTypes.has(i.type)) return false;
          // Skip if AI claims something our parser proved absent
          if (structurallyVerified.has(i.type) && !structuralTypes.has(i.type)) return false;
          return true;
        })
        .map((i: { type: string; description: string; severity: string }) => ({
          ...i,
          fixed: false,
        }));

      const mergedIssues = [...issues, ...aiOnlyIssues];

      return NextResponse.json({
        success: true,
        svg: optimized,
        analysis: {
          description: "Uploaded SVG — checked and optimised for cutting.",
          originalType: "svg",
          colorCount: aiAnalysis.colorCount ?? 1,
          isMultiLayered: (aiAnalysis.colorCount ?? 1) > 1,
          suggestions: aiAnalysis.recommendedFixes ?? [],
          issues: mergedIssues,
          overallScore: aiAnalysis.overallScore ?? 7,
        },
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
        // Fallback to sensible defaults if OpenAI is unavailable
        analysis = {
          description: "Image (AI analysis unavailable)",
          recommendedColors: 2,
          isMultiLayered: false,
          complexity: "moderate" as const,
          suggestions: [
            "AI analysis was unavailable — the image was traced with default settings. You may want to adjust the result in your vector editor.",
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

      // Optimise
      const optimized = optimizeSVG(tracedSVG);

      return NextResponse.json({
        success: true,
        svg: optimized,
        analysis: {
          description: analysis.description ?? "Processed image",
          originalType: mimeType.split("/")[1],
          colorCount: analysis.recommendedColors ?? 2,
          isMultiLayered: analysis.isMultiLayered ?? false,
          suggestions: analysis.suggestions ?? [],
          complexity: analysis.complexity,
        },
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
