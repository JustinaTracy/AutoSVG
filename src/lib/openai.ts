import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ImageAnalysis {
  description: string;
  recommendedColors: number;
  isMultiLayered: boolean;
  complexity: "simple" | "moderate" | "complex";
  suggestions: string[];
  threshold: number;
  backgroundColor: string;
}

export interface SVGAnalysis {
  isCuttable: boolean;
  issues: Array<{
    type: string;
    description: string;
    severity: "high" | "medium" | "low";
  }>;
  hasOpenPaths: boolean;
  hasTextElements: boolean;
  hasTinyDetails: boolean;
  hasGradients: boolean;
  colorCount: number;
  recommendedFixes: string[];
  overallScore: number;
}

export async function analyzeImageForCutting(
  imageBase64: string,
  mimeType: string
): Promise<ImageAnalysis> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
              detail: "low",
            },
          },
          {
            type: "text",
            text: `You are an expert at preparing images for vinyl cutting machines (Cricut, Silhouette).

Analyze this image and return JSON with these exact fields:
- "description": string — brief description of the image subject
- "recommendedColors": number 1-4 — how many distinct color layers this should be traced into for cutting. Prefer fewer colors. Simple silhouettes = 1. Most designs = 2-3. Only use 4+ for truly complex multi-color designs.
- "isMultiLayered": boolean — true if the design should be cut as multiple separate colored layers
- "complexity": "simple" | "moderate" | "complex"
- "suggestions": string[] — 1-3 practical tips for getting a good cut from this image
- "threshold": number 0-255 — recommended brightness threshold for black/white tracing (128 is default, lower = more black area, higher = less). Pick what preserves the design best.
- "backgroundColor": hex color string of the dominant background color, or "none" if transparent/no clear background

Focus on producing clean, cuttable results. Fewer colors and simpler paths are better for cutting machines.`,
          },
        ],
      },
    ],
    max_tokens: 400,
  });

  return JSON.parse(response.choices[0].message.content || "{}");
}

/* ------------------------------------------------------------------ */
/*  Colour grouping for consolidation                                  */
/* ------------------------------------------------------------------ */

export interface ColorGroup {
  name: string;
  representativeColor: string;
  inputColors: string[];
}

export async function groupColorsForCutting(
  colorStats: Array<{ color: string; count: number }>,
  maxGroups: number
): Promise<ColorGroup[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: `You are preparing an SVG for a vinyl cutting machine (Cricut / Silhouette). Each layer = one piece of vinyl the user has to cut separately, so FEWER IS BETTER.

The design has ${colorStats.length} colours. Consolidate them into AT MOST ${maxGroups} groups.

Colours (hex, path count):
${colorStats.map((c) => `${c.color} (${c.count})`).join(", ")}

Return JSON:
{
  "groups": [
    {
      "name": "descriptive layer name",
      "representativeColor": "#hex",
      "inputColors": ["#hex1", "#hex2"]
    }
  ]
}

HARD RULES:
- Maximum ${maxGroups} groups. Merge aggressively — similar shades MUST be combined.
- Every input colour MUST appear in exactly one group's inputColors array.
- Use the inputColors array values EXACTLY as given above (copy the hex strings).
- Pick the most-used shade as representativeColor.
- Name layers descriptively (e.g. "Green Foliage", "Warm Browns").`,
      },
    ],
    max_tokens: 600,
  });

  const data = JSON.parse(response.choices[0].message.content || "{}");
  return data.groups ?? [];
}

/* ------------------------------------------------------------------ */
/*  Per-layer vinyl strategy                                           */
/* ------------------------------------------------------------------ */

export interface LayerStrategy {
  color: string;
  role: "fill" | "detail";
  fillHoles: boolean;
  order: number;
  description: string;
}

/**
 * Ask GPT-4o to look at the image and decide, for each detected colour,
 * how it should be handled for vinyl cutting:
 *
 *  - "fill" layers are solid background shapes (circles, banners).
 *    Holes from overlapping text/detail should be FILLED so the vinyl
 *    is one easy-to-weed piece. These go down first.
 *
 *  - "detail" layers are text, outlines, fine features.
 *    Holes (letter counters inside B, D, O, etc.) must be PRESERVED.
 *    These are layered on top.
 */
export async function analyzeLayerStrategy(
  imageBase64: string,
  mimeType: string,
  colors: string[]
): Promise<{ imageDescription?: string; layers: LayerStrategy[] }> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
              detail: "low",
            },
          },
          {
            type: "text",
            text: `You are a vinyl cutting expert advising how to layer this design.

Detected colours: ${JSON.stringify(colors)}

VINYL LAYERING RULES:
- Each colour is cut from a separate sheet of vinyl and stacked.
- Bottom layers go down first, top layers are applied last.
- A coloured shape (circle, heart, banner) that has TEXT or another colour ON TOP of it should be a SOLID shape — do NOT cut holes for the overlapping elements. The overlapping vinyl goes on top.

For EACH colour decide:

**role**: "fill" or "detail"
- "fill" = ANY shape that has other elements sitting on top of it. Circles, hearts, petals, banners, backgrounds — these MUST be solid. Even if they have text or icons drawn on them, the shape itself should have NO interior cutouts. Examples: a red circle with text inside = "fill". Flower petals = "fill".
- "detail" = text, lettering, outlines, or thin drawn features that are the TOPMOST layer and sit ON TOP of fill shapes. Only these need their letter counters preserved (inside of B, D, O, etc.).

**fillHoles**: true for "fill" layers, false for "detail" layers.

**order**: 1 = bottom, higher = top. Fill layers first, detail layers last.

**description**: e.g. "Red circle centers", "Dark text and outlines"

IMPORTANT: When in doubt, choose "fill". The ONLY things that should be "detail" are text/lettering that sit on top of coloured shapes. Everything else is "fill".

Also include a top-level "imageDescription" field — a brief description of what the image depicts.

Return JSON: { "imageDescription": "...", "layers": [ { "color": "#hex", "role": "fill"|"detail", "fillHoles": true|false, "order": 1, "description": "..." } ] }

Return EVERY colour from the list above. Use the hex values EXACTLY as given.`,
          },
        ],
      },
    ],
    max_tokens: 800,
  });

  const data = JSON.parse(response.choices[0].message.content || "{}");
  return {
    imageDescription: data.imageDescription ?? "",
    layers: data.layers ?? [],
  };
}

/** Retry wrapper — tries up to 2 times. */
export async function analyzeLayerStrategyWithRetry(
  imageBase64: string,
  mimeType: string,
  colors: string[]
): Promise<{ imageDescription?: string; layers: LayerStrategy[] }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await analyzeLayerStrategy(imageBase64, mimeType, colors);
      if (result.layers && result.layers.length > 0) return result;
    } catch (err) {
      console.error(`[openai] Layer strategy attempt ${attempt + 1} failed:`, err);
      if (attempt === 0) continue; // retry once
    }
  }
  return { layers: [] }; // fallback: no strategy
}

/* ------------------------------------------------------------------ */
/*  SVG cuttability analysis                                           */
/* ------------------------------------------------------------------ */

export async function analyzeSVGForCutting(
  svgContent: string
): Promise<SVGAnalysis> {
  const truncated = svgContent.substring(0, 8000);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: `You are an expert at preparing SVG files for vinyl cutting machines (Cricut, Silhouette).

Analyze this SVG markup for cuttability. Return JSON with these exact fields:
- "isCuttable": boolean — whether this SVG could work on a cutting machine as-is
- "issues": array of { "type": string, "description": string, "severity": "high"|"medium"|"low" }
- "hasOpenPaths": boolean
- "hasTextElements": boolean
- "hasTinyDetails": boolean — details under ~2mm that might not cut
- "hasGradients": boolean
- "colorCount": number of distinct fill/stroke colors used
- "recommendedFixes": string[] — what should be fixed for cutting
- "overallScore": number 1-10 — how cut-ready this SVG is (10 = perfect)

SVG content:
${truncated}`,
      },
    ],
    max_tokens: 500,
  });

  return JSON.parse(response.choices[0].message.content || "{}");
}
