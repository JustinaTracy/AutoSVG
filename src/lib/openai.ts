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
  colorStats: Array<{ color: string; count: number }>
): Promise<ColorGroup[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: `You are preparing an SVG for a vinyl cutting machine (Cricut / Silhouette).

The design has these fill/stroke colours (with path counts):
${JSON.stringify(colorStats)}

For cutting, each colour layer = one material / colour of vinyl. Consolidate these into a small number of layers by grouping similar shades together.

Return JSON with EXACTLY this shape:
{
  "groups": [
    {
      "name": "descriptive layer name (e.g. Green Foliage)",
      "representativeColor": "#hex — the dominant shade for this group",
      "inputColors": ["#hex1", "#hex2", …]
    }
  ]
}

Rules:
1. Every colour in the input MUST appear in exactly one group's inputColors.
2. Aim for roughly 2-8 groups — use your judgement based on how visually distinct the colours are. Similar shades (e.g. multiple greens) should merge.
3. If a colour is "none", put it in its own group named "Cut Lines" with representativeColor "none".
4. The representative colour should be the most visually prominent shade in its group.
5. Name each layer descriptively based on what the colour likely represents.`,
      },
    ],
    max_tokens: 600,
  });

  const data = JSON.parse(response.choices[0].message.content || "{}");
  return data.groups ?? [];
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
