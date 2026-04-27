import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import Replicate from "replicate";
import OpenAI from "openai";

export const maxDuration = 120;

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

    // Resize to 1024 JPEG with white bg for both AI description and ControlNet
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const resized = await sharp(rawBuffer)
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();

    const dataUri = `data:image/jpeg;base64,${resized.toString("base64")}`;

    // Step 1: Ask GPT-4o to describe the image for the SDXL prompt
    let description = "flat color vector illustration";
    try {
      const vision = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: dataUri, detail: "low" },
              },
              {
                type: "text",
                text: "Describe this image in one sentence for an AI image generator. Focus on: what the subject is, the colors used, and the composition. Keep it under 30 words. Do not mention style or medium.",
              },
            ],
          },
        ],
        max_tokens: 60,
      });
      description =
        vision.choices[0].message.content?.trim() || description;
    } catch {
      // GPT-4o failed — use generic description
    }

    // Step 2: Use SDXL img2img (no ControlNet) — gives the model
    // freedom to remake the image in a vector-friendly style while
    // keeping the same subject. prompt_strength controls how much
    // it departs from the original (0.7 = mostly follows prompt).
    const output = await replicate.run(
      "stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc",
      {
        input: {
          image: dataUri,
          prompt: `Simple flat color vector illustration of ${description}, solid flat colors only, 2D, clean bold outlines, no gradients, no shading, no shadows, no texture, plain white background, die-cut design, SVG ready, minimal detail, clipart style`,
          negative_prompt:
            "gradient, shadow, texture, 3d, realistic, photographic, shading, halftone, watercolor, painterly, blurry, noisy, border, frame, soft edges, depth, lighting, pink background, colored background",
          prompt_strength: 0.7,
          num_inference_steps: 30,
          guidance_scale: 12,
        },
      }
    );

    const imageUrl = String(output);

    return NextResponse.json({ success: true, imageUrl });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Remake failed.";
    console.error("Remake API error:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
