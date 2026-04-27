import { NextRequest, NextResponse } from "next/server";
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

    // Convert file to data URI for Replicate
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const mimeType = file.type || "image/png";
    const dataUri = `data:${mimeType};base64,${base64}`;

    const output = await replicate.run(
      "black-forest-labs/flux-kontext-pro",
      {
        input: {
          prompt:
            "Recreate this exact design as a clean flat-colour vector-style illustration. " +
            "Keep the SAME composition, layout, text, and colour scheme. " +
            "Use solid flat colours with NO gradients, NO textures, NO shading, NO shadows, NO halftones. " +
            "Every colour region should be a single solid fill with clean sharp edges. " +
            "The result should look like a vinyl-cut sticker design — simple, bold, clean outlines. " +
            "White or transparent background.",
          image: dataUri,
          aspect_ratio: "1:1",
          output_format: "png",
          safety_tolerance: 5,
        },
      }
    );

    // Replicate returns a URL (or ReadableStream)
    let imageUrl: string;
    if (typeof output === "string") {
      imageUrl = output;
    } else if (output && typeof (output as Record<string, unknown>).url === "function") {
      // ReadableStream — read it and convert to base64
      const stream = output as ReadableStream;
      const reader = stream.getReader();
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
      // Try to use output directly as a URL
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
