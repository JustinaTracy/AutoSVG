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
  Loader2,
  CheckCircle,
  AlertTriangle,
  Scissors,
  Layers,
  FileWarning,
  Sparkles,
  Info,
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
  suggestions: string[];
  layers?: LayerInfo[];
  issues?: Issue[];
  overallScore?: number;
  complexity?: string;
}

interface ProcessResult {
  success: boolean;
  svg: string;
  analysis: Analysis;
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

  // Blob URL for the result SVG
  const svgBlobUrl = useMemo(() => {
    if (!result?.svg) return "";
    const blob = new Blob([result.svg], { type: "image/svg+xml" });
    return URL.createObjectURL(blob);
  }, [result?.svg]);

  /* ── Handlers ─────────────────────────────────────────────── */

  const processFile = useCallback(async (f: File) => {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError("Please upload a PNG, JPEG, or SVG file.");
      setStatus("error");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("File is too large. Maximum size is 10 MB.");
      setStatus("error");
      return;
    }

    setFile(f);
    setResult(null);
    setError("");
    setStatus("processing");

    // Build original preview
    const reader = new FileReader();
    reader.onload = (e) => setOriginalPreview(e.target?.result as string);
    reader.readAsDataURL(f);

    // Upload
    const body = new FormData();
    body.append("file", f);

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
    if (!result?.svg || !file) return;
    const blob = new Blob([result.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file.name.replace(/\.[^.]+$/, "")}_cut-ready.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, file]);

  const handleReset = useCallback(() => {
    setStatus("idle");
    setFile(null);
    setOriginalPreview("");
    setResult(null);
    setError("");
  }, []);

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
                  Accepts PNG, JPEG, SVG — up to 10 MB
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
            <div className="flex flex-col gap-8">
              {/* Previews */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* Original */}
                <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
                  <h3 className="mb-3 font-heading text-lg text-plum-wine-900">
                    Original
                  </h3>
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-neutral-100">
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
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-heading text-lg text-plum-wine-900">
                      Cut-Ready SVG
                    </h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-sage-success-50 px-3 py-1 font-body text-xs font-medium text-sage-success-500">
                      <CheckCircle size={12} />
                      Ready
                    </span>
                  </div>
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-neutral-100"
                       style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='10' height='10' fill='%23f0f0f0'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f0f0f0'/%3E%3C/svg%3E\")" }}>
                    {svgBlobUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={svgBlobUrl}
                        alt="Processed SVG"
                        className="max-h-full max-w-full object-contain"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Analysis card */}
              <div className="rounded-2xl border border-neutral-200 bg-alabaster p-6 shadow-sm">
                <h3 className="mb-4 flex items-center gap-2 font-heading text-xl text-plum-wine-900">
                  <Info size={18} className="text-plum-wine-500" />
                  Analysis
                </h3>

                <p className="mb-4 font-body text-base leading-relaxed text-plum-wine-800">
                  {result.analysis.description}
                </p>

                <div className="mb-4 flex flex-wrap gap-3">
                  <Badge
                    label={`${result.analysis.colorCount} layer${result.analysis.colorCount !== 1 ? "s" : ""}`}
                    icon={<Layers size={12} />}
                  />
                  {result.analysis.originalType && (
                    <Badge
                      label={`Source: ${result.analysis.originalType.toUpperCase()}`}
                    />
                  )}
                </div>

                {/* Layers */}
                {result.analysis.layers && result.analysis.layers.length > 0 && (
                  <div className="mb-4">
                    <h4 className="mb-2 font-body text-sm font-semibold text-plum-wine-700">
                      Cut Layers
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {result.analysis.layers.map((layer, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 font-body text-sm shadow-sm"
                        >
                          <span
                            className="inline-block h-4 w-4 rounded-full border border-neutral-300"
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
                          <span className="text-xs text-plum-wine-400">
                            {layer.pathCount} path{layer.pathCount !== 1 ? "s" : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Issues */}
                {result.analysis.issues && result.analysis.issues.length > 0 && (
                  <div className="mb-4">
                    <h4 className="mb-2 font-body text-sm font-semibold text-plum-wine-700">
                      Issues Detected
                    </h4>
                    <ul className="space-y-2">
                      {result.analysis.issues.map((issue, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 rounded-xl bg-white px-4 py-3 font-body text-sm"
                        >
                          {issue.severity === "high" ? (
                            <FileWarning
                              size={16}
                              className="mt-0.5 shrink-0 text-sunset-red-500"
                            />
                          ) : (
                            <AlertTriangle
                              size={16}
                              className="mt-0.5 shrink-0 text-lemon-500"
                            />
                          )}
                          <span className="text-plum-wine-800">
                            {issue.description}
                            {issue.fixed && (
                              <span className="ml-1 font-semibold text-sage-success-500">
                                (auto-fixed)
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Suggestions */}
                {result.analysis.suggestions &&
                  result.analysis.suggestions.length > 0 && (
                    <div>
                      <h4 className="mb-2 font-body text-sm font-semibold text-plum-wine-700">
                        Tips
                      </h4>
                      <ul className="space-y-1.5">
                        {result.analysis.suggestions.map((tip, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 font-body text-sm text-plum-wine-600"
                          >
                            <Sparkles
                              size={14}
                              className="mt-0.5 shrink-0 text-plum-wine-400"
                            />
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>

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

function Badge({
  label,
  icon,
}: {
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-plum-wine-50 px-3 py-1 font-body text-xs font-medium text-plum-wine-700">
      {icon}
      {label}
    </span>
  );
}
