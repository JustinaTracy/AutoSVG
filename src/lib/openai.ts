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
): Promise<LayerStrategy[]> {
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
            text: `You are a vinyl cutting expert. I'm converting this image to layered vinyl cut files.

I detected these colours in the design: ${JSON.stringify(colors)}

For vinyl cutting, layers STACK on top of each other on the surface. You cut each colour separately and apply them in order.

For EACH colour, decide:

1. **role**: "fill" or "detail"
   - "fill" = large solid shapes (coloured circles, banners, backgrounds). These should be CUT AS SOLID SHAPES with no holes from overlapping text. The text vinyl goes ON TOP.
   - "detail" = text, lettering, outlines, thin features. These need their internal holes PRESERVED (like the inside of letters B, D, O, P, R, etc.).

2. **fillHoles**: true if this colour's shapes should be solid (fill small interior gaps from overlapping layers). false if holes/counters must be kept.

3. **order**: stacking order (1 = applied to surface first / bottom, higher = on top). Fill layers go first, detail layers go on top.

4. **description**: brief label like "Red flower centers", "Dark brown text and outlines"

Return JSON: { "layers": [ { "color": "#hex", "role": "fill"|"detail", "fillHoles": true|false, "order": 1, "description": "..." } ] }

Think about what makes this EASIEST for someone to cut and weed vinyl. Solid shapes are easier to weed than complex shapes with lots of interior cutouts.`,
          },
        ],
      },
    ],
    max_tokens: 600,
  });

  const data = JSON.parse(response.choices[0].message.content || "{}");
  return data.layers ?? [];
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
