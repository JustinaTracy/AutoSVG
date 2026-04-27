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

    const rawBuffer = Buffer.from(await file.arrayBuffer());

    // ── Step 1: Remove background with rembg ────────────────────
    // Proper AI background removal — handles fur, hair, complex
    // edges. Returns a transparent PNG of just the subject.
    const resized = await sharp(rawBuffer)
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();

    const rembgOutput = await replicate.run(
      "cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003",
      {
        input: {
          image: `data:image/png;base64,${resized.toString("base64")}`,
        },
      }
    );

    // rembg returns a URL or ReadableStream
    let bgRemovedBuffer: Buffer;
    if (typeof rembgOutput === "string") {
      const resp = await fetch(rembgOutput);
      bgRemovedBuffer = Buffer.from(await resp.arrayBuffer());
    } else if (rembgOutput instanceof ReadableStream) {
      const reader = rembgOutput.getReader();
      const chunks: Uint8Array[] = [];
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        if (value) chunks.push(value);
        done = d;
      }
      bgRemovedBuffer = Buffer.concat(chunks);
    } else {
      const resp = await fetch(String(rembgOutput));
      bgRemovedBuffer = Buffer.from(await resp.arrayBuffer());
    }

    // ── Step 2: Flatten to white + posterize ─────────────────────
    // Now we have a clean transparent PNG of just the subject.
    // Flatten transparency to white, then posterize to flat colours.
    const flattened = await sharp(bgRemovedBuffer)
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();

    const smoothed = await sharp(flattened)
      .median(5)
      .png({ colours: 8, dither: 0 })
      .toBuffer();

    const cleaned = await sharp(smoothed)
      .median(3)
      .png()
      .toBuffer();

    const dataUri = `data:image/png;base64,${cleaned.toString("base64")}`;

    return NextResponse.json({ success: true, imageUrl: dataUri });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Simplify failed.";
    console.error("Remake API error:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
