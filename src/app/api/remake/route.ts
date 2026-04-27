import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import Replicate from "replicate";

export const maxDuration = 120;

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

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

    // Resize to a clean 1024x1024 JPEG for Replicate — keeps the
    // data URI small and gives Kontext a clear reference image.
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const resized = await sharp(rawBuffer)
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();

    const dataUri = `data:image/jpeg;base64,${resized.toString("base64")}`;

    const output = await replicate.run(
      "black-forest-labs/flux-kontext-pro",
      {
        input: {
          prompt:
            "Transform this image into a simplified flat-color vector illustration. " +
            "Keep the EXACT same subject, character, composition, and pose. " +
            "Keep the EXACT same color palette — do not change any colors. " +
            "Replace all gradients, textures, watercolor effects, and shading with solid flat color fills. " +
            "Each color region should be one solid color with clean sharp edges — like a vinyl sticker cut from colored vinyl. " +
            "No gradients. No shadows. No texture. No halftones. No 3D effects. " +
            "Simple bold shapes with clean outlines. White background.",
          image: dataUri,
          aspect_ratio: "1:1",
          output_format: "png",
          safety_tolerance: 5,
        },
      }
    );

    // Replicate returns a ReadableStream or URL
    let imageUrl: string;
    if (typeof output === "string") {
      imageUrl = output;
    } else if (output instanceof ReadableStream) {
      const reader = output.getReader();
      const chunks: Uint8Array[] = [];
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        if (value) chunks.push(value);
        done = d;
      }
      const combined = Buffer.concat(chunks);
      imageUrl = `data:image/png;base64,${combined.toString("base64")}`;
    } else if (Array.isArray(output) && typeof output[0] === "string") {
      imageUrl = output[0];
    } else {
      imageUrl = String(output);
    }

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
