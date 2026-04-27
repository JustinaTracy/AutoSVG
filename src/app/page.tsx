"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type DragEvent,
  type ChangeEvent,
} from "react";
import {
  Upload,
  Download,
  RotateCcw,
  AlertTriangle,
  Scissors,
  Layers,
  Sparkles,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Status = "idle" | "processing" | "done" | "error";

interface Issue {
  type: string;
  description: string;
  severity: "high" | "medium" | "low";
  fixed: boolean;
}

interface LayerInfo {
  name: string;
  color: string;
  pathCount: number;
}

interface Analysis {
  description: string;
  originalType: string;
  colorCount: number;
  isMultiLayered: boolean;
  suggestions?: string[];
  layers?: LayerInfo[];
  issues?: Issue[];
  complexity?: string;
}

interface ChangelogEntry {
  action: string;
  detail: string;
}

interface ProcessResult {
  success: boolean;
  svg: string;
  silhouetteSVG?: string;
  analysis: Analysis;
  changelog?: ChangelogEntry[];
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];
const ACCEPTED_EXT = ".png, .jpg, .jpeg, .svg";

const PROCESSING_STEPS = [
  "Analysing your image with AI…",
  "Determining optimal colours and layers…",
  "Tracing vector paths for cutting…",
  "Optimising for Cricut & Silhouette…",
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [originalPreview, setOriginalPreview] = useState("");
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [outputMode, setOutputMode] = useState<"color" | "silhouette">("color");
  const [aiDisabled, setAiDisabled] = useState(false);
  const [consolidatedSVG, setConsolidatedSVG] = useState<string | null>(null);
  const [consolidatedLayers, setConsolidatedLayers] = useState<LayerInfo[] | null>(null);
  const [undoStack, setUndoStack] = useState<Array<{ svg: string | null; layers: LayerInfo[] | null }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cycle processing-step text
  useEffect(() => {
    if (status !== "processing") return;
    setStepIndex(0);
    const id = setInterval(
      () => setStepIndex((i) => (i + 1) % PROCESSING_STEPS.length),
      2800
    );
    return () => clearInterval(id);
  }, [status]);

  // Blob URL for the result SVG (respects color/silhouette mode)
  const activeSVG =
    outputMode === "silhouette" && result?.silhouetteSVG
      ? result.silhouetteSVG
      : consolidatedSVG ?? result?.svg ?? "";

  const svgBlobUrl = useMemo(() => {
    if (!activeSVG) return "";
    const blob = new Blob([activeSVG], { type: "image/svg+xml" });
    return URL.createObjectURL(blob);
  }, [activeSVG]);

  /* ── Handlers ─────────────────────────────────────────────── */

  const processFile = useCallback(async (f: File) => {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError("Please upload a PNG, JPEG, or SVG file.");
      setStatus("error");
      return;
    }
    const isSvg = f.type === "image/svg+xml";
    const limit = isSvg ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
    if (f.size > limit) {
      setError(
        isSvg
          ? "SVG file is too large. Maximum size is 10 MB."
          : "Image is too large. Maximum size is 50 MB."
      );
      setStatus("error");
      return;
    }

    setFile(f);
    setResult(null);
    setError("");
    setOutputMode("color");
    setConsolidatedSVG(null);
    setConsolidatedLayers(null);
    setUndoStack([]);
    setStatus("processing");

    // Build original preview
    const reader = new FileReader();
    reader.onload = (e) => setOriginalPreview(e.target?.result as string);
    reader.readAsDataURL(f);

    // For large raster images, resize client-side before upload
    // (Vercel has a ~4.5 MB body limit on serverless functions)
    let uploadFile: File | Blob = f;
    if (!isSvg && f.size > 3 * 1024 * 1024) {
      try {
        uploadFile = await resizeImageClientSide(f);
      } catch {
        // If resize fails, try uploading the original
      }
    }

    // Upload
    const body = new FormData();
    body.append("file", uploadFile);
    if (aiDisabled) body.append("noai", "1");

    try {
      const res = await fetch("/api/process", { method: "POST", body });
      const data: ProcessResult = await res.json();
      if (data.success) {
        setResult(data);
        setStatus("done");
      } else {
        setError(data.error || "Processing failed.");
        setStatus("error");
      }
    } catch {
      setError("Failed to reach the server. Please try again.");
      setStatus("error");
    }
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const f = e.dataTransfer.files?.[0];
      if (f) processFile(f);
    },
    [processFile]
  );

  const onFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) processFile(f);
    },
    [processFile]
  );

  const handleDownload = useCallback(() => {
    if (!activeSVG || !file) return;
    const blob = new Blob([activeSVG], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const suffix = outputMode === "silhouette" ? "_silhouette" : "_cut-ready";
    a.download = `${file.name.replace(/\.[^.]+$/, "")}${suffix}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeSVG, file, outputMode]);

  const handleReset = useCallback(() => {
    setStatus("idle");
    setFile(null);
    setOriginalPreview("");
    setResult(null);
    setError("");
    setConsolidatedSVG(null);
    setConsolidatedLayers(null);
    setUndoStack([]);
  }, []);

  const handleConsolidate = useCallback(() => {
    const currentSVG = consolidatedSVG ?? result?.svg ?? "";
    if (!currentSVG) return;
    const consolidated = consolidateSVGLayers(currentSVG);
    if (!consolidated) return;
    // Push current state to undo stack before applying
    setUndoStack((prev) => [
      ...prev,
      { svg: consolidatedSVG, layers: consolidatedLayers },
    ]);
    setConsolidatedSVG(consolidated.svg);
    setConsolidatedLayers(consolidated.layers);
  }, [consolidatedSVG, consolidatedLayers, result]);

  const handleRemoveLayer = useCallback((color: string) => {
    const currentSVG = consolidatedSVG ?? result?.svg ?? "";
    if (!currentSVG) return;
    const removed = removeLayerFromSVG(currentSVG, color);
    if (!removed) return;
    setUndoStack((prev) => [
      ...prev,
      { svg: consolidatedSVG, layers: consolidatedLayers },
    ]);
    setConsolidatedSVG(removed.svg);
    setConsolidatedLayers(removed.layers);
  }, [consolidatedSVG, consolidatedLayers, result]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setConsolidatedSVG(prev.svg);
    setConsolidatedLayers(prev.layers);
  }, [undoStack]);

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <div className="min-h-screen flex flex-col bg-pearl">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="w-full border-b border-neutral-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          {/* Logo mark */}
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-plum-wine-700 text-white">
            <Scissors size={20} />
          </div>
          <div>
            <h1 className="font-heading text-2xl leading-none tracking-tight text-plum-wine-900">
              AutoSVG
            </h1>
            <p className="font-body text-xs text-plum-wine-400">
              Cut-ready SVG converter
            </p>
          </div>
          <button
            onClick={() => setAiDisabled((v) => !v)}
            className={`ml-auto rounded-full px-3 py-1 font-body text-xs font-medium transition-colors ${
              aiDisabled
                ? "bg-sunset-red-500 text-white"
                : "bg-neutral-100 text-neutral-400 hover:text-neutral-600"
            }`}
          >
            AI {aiDisabled ? "OFF" : "ON"}
          </button>
        </div>
      </header>

      {/* ── Main ─────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-5xl">
          {/* ── IDLE: Drop zone ───────────────────────────────── */}
          {status === "idle" && (
            <div className="flex flex-col items-center gap-8">
              <div className="text-center">
                <h2 className="font-heading text-[40px] leading-snug text-plum-wine-900">
                  Make Any Image Cut-Ready
                </h2>
                <p className="mt-2 max-w-lg font-body text-base leading-relaxed text-plum-wine-500">
                  Drop a PNG, JPEG, or SVG and AutoSVG will trace, simplify, and
                  optimise it for your Cricut or Silhouette machine.
                </p>
              </div>

              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={`group w-full max-w-2xl cursor-pointer rounded-2xl border-2 border-dashed p-16 text-center transition-all ${
                  dragActive
                    ? "border-plum-wine-500 bg-plum-wine-50 shadow-md"
                    : "border-neutral-300 bg-alabaster hover:border-plum-wine-300 hover:bg-plum-wine-50/50"
                }`}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED_EXT}
                  onChange={onFileChange}
                  className="hidden"
                />

                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-plum-wine-100 text-plum-wine-600 transition-colors group-hover:bg-plum-wine-200">
                  <Upload size={28} />
                </div>

                <p className="font-body text-lg font-medium text-plum-wine-800">
                  Drag &amp; drop your file here
                </p>
                <p className="mt-1 font-body text-sm text-plum-wine-400">
                  or{" "}
                  <span className="font-semibold text-plum-wine-700 underline decoration-plum-wine-300 underline-offset-2">
                    click to browse
                  </span>
                </p>
                <p className="mt-4 font-body text-xs text-neutral-400">
                  Accepts PNG, JPEG, SVG — large images auto-resized
                </p>
              </div>

              {/* Feature pills */}
              <div className="flex flex-wrap justify-center gap-3">
                {[
                  { icon: Sparkles, label: "AI-powered analysis" },
                  { icon: Layers, label: "Smart layer detection" },
                  { icon: Scissors, label: "Cut-path optimised" },
                ].map(({ icon: Icon, label }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full bg-plum-wine-50 px-4 py-1.5 font-body text-sm font-medium text-plum-wine-700"
                  >
                    <Icon size={14} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── PROCESSING ────────────────────────────────────── */}
          {status === "processing" && (
            <div className="flex flex-col items-center gap-6 py-16">
              <div className="relative">
                <div className="animate-spin-slow flex h-20 w-20 items-center justify-center rounded-full border-4 border-plum-wine-200 border-t-plum-wine-600">
                  <Scissors size={28} className="text-plum-wine-600" />
                </div>
              </div>

              <div className="text-center">
                <p className="font-body text-lg font-medium text-plum-wine-800 animate-pulse-slow">
                  {PROCESSING_STEPS[stepIndex]}
                </p>
                {file && (
                  <p className="mt-2 font-body text-sm text-plum-wine-400">
                    {file.name}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── DONE: Results ─────────────────────────────────── */}
          {status === "done" && result && (
            <div className="flex flex-col gap-6">
              {/* Previews */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* Original */}
                <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-heading text-lg text-plum-wine-900">
                      Original
                    </h3>
                  </div>
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-neutral-100 p-4">
                    {originalPreview && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={originalPreview}
                        alt="Original upload"
                        className="max-h-full max-w-full object-contain"
                      />
                    )}
                  </div>
                  {file && (
                    <p className="mt-3 truncate font-body text-sm text-neutral-500">
                      {file.name} &middot;{" "}
                      {(file.size / 1024).toFixed(0)} KB
                    </p>
                  )}
                </div>

                {/* Processed */}
                <div className="rounded-2xl border border-plum-wine-200 bg-white p-6 shadow-sm ring-2 ring-plum-wine-100">
                  <h3 className="mb-3 font-heading text-lg text-plum-wine-900">
                    Cut-Ready SVG
                  </h3>
                  <div
                    className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-neutral-100 p-4"
                    style={{
                      backgroundImage:
                        "url(\"data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='10' height='10' fill='%23f0f0f0'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f0f0f0'/%3E%3C/svg%3E\")",
                    }}
                  >
                    {svgBlobUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={svgBlobUrl}
                        alt="Processed SVG"
                        className="max-h-full max-w-full object-contain"
                      />
                    )}
                  </div>

                  {/* Output mode toggle */}
                  {result.silhouetteSVG && (
                    <div className="mt-3 flex rounded-full border border-neutral-200 bg-neutral-100 p-0.5">
                      <button
                        onClick={() => setOutputMode("color")}
                        className={`flex-1 rounded-full px-3 py-1.5 font-body text-sm font-medium transition-colors ${
                          outputMode === "color"
                            ? "bg-plum-wine-700 text-white shadow-sm"
                            : "text-plum-wine-600 hover:text-plum-wine-800"
                        }`}
                      >
                        Full Color
                      </button>
                      <button
                        onClick={() => setOutputMode("silhouette")}
                        className={`flex-1 rounded-full px-3 py-1.5 font-body text-sm font-medium transition-colors ${
                          outputMode === "silhouette"
                            ? "bg-plum-wine-700 text-white shadow-sm"
                            : "text-plum-wine-600 hover:text-plum-wine-800"
                        }`}
                      >
                        Silhouette
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* What Changed — mode-aware */}
              <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
                <h3 className="mb-3 flex items-center gap-2 font-heading text-lg text-plum-wine-900">
                  <Sparkles size={16} className="text-plum-wine-500" />
                  What Changed
                </h3>
                {outputMode === "silhouette" ? (
                  <p className="font-body text-sm text-plum-wine-600">
                    Traced as a solid black silhouette outline of the entire design.
                  </p>
                ) : (
                  <>
                    {consolidatedSVG && (
                      <p className="mb-2 font-body text-sm font-medium text-plum-wine-700">
                        Layers consolidated: merged closest-coloured layers to reduce from{" "}
                        {result.analysis.layers?.length ?? 0} to{" "}
                        {consolidatedLayers?.length ?? 0} layer(s).
                      </p>
                    )}
                    {result.changelog && result.changelog.length > 0 ? (
                      <ul className="space-y-2">
                        {result.changelog.map((entry, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2.5 font-body text-sm"
                          >
                            <span
                              className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white text-[10px] font-bold ${
                                entry.action === "fixed"
                                  ? "bg-sage-gray-400"
                                  : entry.action === "removed"
                                    ? "bg-dusty-rose-300"
                                    : entry.action === "consolidated"
                                      ? "bg-plum-wine-500"
                                      : entry.action === "warning"
                                        ? "bg-lemon-500"
                                        : "bg-neutral-400"
                              }`}
                            >
                              {entry.action === "fixed"
                                ? "F"
                                : entry.action === "removed"
                                  ? "R"
                                  : entry.action === "consolidated"
                                    ? "C"
                                    : entry.action === "warning"
                                      ? "!"
                                      : "i"}
                            </span>
                            <span className="text-plum-wine-800">
                              {entry.detail}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </div>

              {/* Layers — mode-aware */}
              {(() => {
                const activeLayers =
                  outputMode === "silhouette"
                    ? [{ name: "Silhouette", color: "#000000", pathCount: 1 }]
                    : consolidatedLayers ?? result.analysis.layers ?? [];
                if (activeLayers.length === 0) return null;
                return (
                  <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="flex items-center gap-2 font-heading text-lg text-plum-wine-900">
                        <Layers size={16} className="text-plum-wine-500" />
                        Cut Layers ({activeLayers.length})
                      </h3>
                      {outputMode === "color" && (
                        <div className="flex items-center gap-2">
                          {undoStack.length > 0 && (
                            <button
                              onClick={handleUndo}
                              className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2.5 py-1 font-body text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                            >
                              <RotateCcw size={12} />
                              Undo
                            </button>
                          )}
                          {activeLayers.length >= 2 && (
                            <button
                              onClick={handleConsolidate}
                              className="inline-flex items-center gap-1.5 rounded-full border border-plum-wine-200 bg-plum-wine-50 px-3 py-1 font-body text-xs font-medium text-plum-wine-700 transition-colors hover:bg-plum-wine-100"
                            >
                              Consolidate Layers
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {activeLayers.map((layer, i) => (
                        <div
                          key={i}
                          className="group flex items-center gap-2 rounded-xl bg-alabaster px-3 py-2 font-body text-sm"
                        >
                          <span
                            className="inline-block h-4 w-4 shrink-0 rounded-full border border-neutral-300 shadow-sm"
                            style={{
                              backgroundColor:
                                layer.color === "none"
                                  ? "transparent"
                                  : layer.color,
                            }}
                          />
                          <span className="font-medium text-plum-wine-800">
                            {layer.name}
                          </span>
                          <span className="rounded-full bg-plum-wine-50 px-1.5 py-0.5 text-[10px] text-plum-wine-500">
                            {layer.pathCount}
                          </span>
                          {outputMode === "color" && (
                            <button
                              onClick={() => handleRemoveLayer(layer.color)}
                              className="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-200 hover:text-neutral-600 group-hover:opacity-100"
                              title="Remove this layer"
                            >
                              &times;
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Action buttons */}
              <div className="flex flex-wrap justify-center gap-4">
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-2 rounded-full bg-plum-wine-700 px-8 py-3.5 font-body text-base font-semibold text-white shadow-sm transition-colors hover:bg-plum-wine-800"
                >
                  <Download size={18} />
                  Download Cut-Ready SVG
                </button>
                <button
                  onClick={handleReset}
                  className="inline-flex items-center gap-2 rounded-full border border-plum-wine-700 px-6 py-3.5 font-body text-base font-semibold text-plum-wine-700 transition-colors hover:bg-plum-wine-50"
                >
                  <RotateCcw size={18} />
                  Convert Another
                </button>
              </div>
            </div>
          )}

          {/* ── ERROR ──────────────────────────────────────────── */}
          {status === "error" && (
            <div className="flex flex-col items-center gap-6 py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sunset-red-50 text-sunset-red-500">
                <AlertTriangle size={32} />
              </div>
              <div className="text-center">
                <p className="font-body text-lg font-medium text-plum-wine-900">
                  Something went wrong
                </p>
                <p className="mt-1 max-w-md font-body text-sm text-plum-wine-500">
                  {error}
                </p>
              </div>
              <button
                onClick={handleReset}
                className="inline-flex items-center gap-2 rounded-full bg-plum-wine-700 px-6 py-2.5 font-body text-base font-semibold text-white transition-colors hover:bg-plum-wine-800"
              >
                <RotateCcw size={16} />
                Try Again
              </button>
            </div>
          )}
        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-neutral-200 bg-white/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <p className="font-body text-xs text-neutral-400">
            AutoSVG &mdash; by Design Bundles
          </p>
          <p className="font-body text-xs text-neutral-400">
            Optimised for Cricut &amp; Silhouette
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Resize a raster image in the browser before uploading.
 * Uses JPEG for photo-like images (much smaller than PNG for complex art).
 * Progressively shrinks until under the Vercel 4.5 MB body limit.
 */
async function resizeImageClientSide(file: File): Promise<Blob> {
  const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB (under Vercel's 4.5 MB limit)

  const loadImg = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = src;
    });

  const blobFromCanvas = (
    canvas: HTMLCanvasElement,
    mime: string,
    quality: number
  ): Promise<Blob> =>
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        mime,
        quality
      );
    });

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);

    // Try progressively smaller sizes until we fit under the limit
    const attempts = [2000, 1500, 1200, 800];
    for (const maxDim of attempts) {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);

      // Try JPEG first (much smaller for photo/watercolour art)
      const jpegBlob = await blobFromCanvas(canvas, "image/jpeg", 0.85);
      if (jpegBlob.size <= MAX_UPLOAD_BYTES) return jpegBlob;

      // Try lower quality JPEG
      const jpegLow = await blobFromCanvas(canvas, "image/jpeg", 0.7);
      if (jpegLow.size <= MAX_UPLOAD_BYTES) return jpegLow;
    }

    // Last resort: 800px at low quality
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 800;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, 800, 800);
    return blobFromCanvas(canvas, "image/jpeg", 0.6);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Merge the two closest-coloured layers in an SVG string.
 * Returns the new SVG and layer info, or null if fewer than 2 paths.
 */
function consolidateSVGLayers(svgString: string): { svg: string; layers: LayerInfo[] } | null {
  // Parse all paths
  const pathRegex = /<path\b([^>]*)\/?>|<path\b([^>]*)>[^<]*<\/path>/gi;
  const paths: Array<{ full: string; fill: string; d: string }> = [];
  let match;
  while ((match = pathRegex.exec(svgString)) !== null) {
    const attrs = match[1] || match[2] || '';
    const fill = attrs.match(/fill="([^"]+)"/)?.[1] || '#000000';
    const d = attrs.match(/d="([^"]*)"/)?.[1] || '';
    paths.push({ full: match[0], fill: fill.toLowerCase(), d });
  }

  if (paths.length < 2) return null;

  // Find the two closest colours
  const hexToRgb = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    return [
      parseInt(h.substring(0, 2), 16) || 0,
      parseInt(h.substring(2, 4), 16) || 0,
      parseInt(h.substring(4, 6), 16) || 0,
    ];
  };

  let minDist = Infinity;
  let mergeI = 0, mergeJ = 1;
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const a = hexToRgb(paths[i].fill);
      const b = hexToRgb(paths[j].fill);
      const dist = Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
      if (dist < minDist) {
        minDist = dist;
        mergeI = i;
        mergeJ = j;
      }
    }
  }

  // Merge j into i (keep i's colour if it has more path data)
  const keepColour = paths[mergeI].d.length >= paths[mergeJ].d.length
    ? paths[mergeI].fill
    : paths[mergeJ].fill;
  const mergedD = paths[mergeI].d + ' ' + paths[mergeJ].d;

  // Build new paths array
  const newPaths = paths.filter((_, idx) => idx !== mergeI && idx !== mergeJ);
  newPaths.splice(mergeI, 0, {
    full: '',
    fill: keepColour,
    d: mergedD
  });

  // Rebuild SVG
  const viewBox = svgString.match(/viewBox="([^"]*)"/)?.[1] || '0 0 100 100';
  const pathStrings = newPaths.map(p =>
    `<path d="${p.d}" fill="${p.fill}" fill-rule="evenodd"/>`
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n${pathStrings.join('\n')}\n</svg>`;

  const layers = newPaths.map(p => ({
    name: `Layer (${p.fill})`,
    color: p.fill,
    pathCount: 1,
  }));

  return { svg, layers };
}

function removeLayerFromSVG(svgString: string, colorToRemove: string): { svg: string; layers: LayerInfo[] } | null {
  const pathRegex = /<path\b([^>]*)\/?>|<path\b([^>]*)>[^<]*<\/path>/gi;
  const paths: Array<{ fill: string; d: string }> = [];
  let match;
  while ((match = pathRegex.exec(svgString)) !== null) {
    const attrs = match[1] || match[2] || "";
    const fill = attrs.match(/fill="([^"]+)"/)?.[1]?.toLowerCase() || "#000000";
    const d = attrs.match(/d="([^"]*)"/)?.[1] || "";
    paths.push({ fill, d });
  }

  const filtered = paths.filter((p) => p.fill !== colorToRemove.toLowerCase());
  if (filtered.length === 0) return null;

  const viewBox = svgString.match(/viewBox="([^"]*)"/)?.[1] || "0 0 100 100";
  const gTransform = svgString.match(/<g[^>]*transform="([^"]*)"/)?.[1];
  const pathStrings = filtered.map(
    (p) => `<path d="${p.d}" fill="${p.fill}" fill-rule="evenodd"/>`
  );
  const inner = pathStrings.join("\n");
  const wrapped = gTransform ? `<g transform="${gTransform}">\n${inner}\n</g>` : inner;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n${wrapped}\n</svg>`;

  const layers = filtered.map((p) => ({
    name: `Layer (${p.fill})`,
    color: p.fill,
    pathCount: 1,
  }));

  return { svg, layers };
}
