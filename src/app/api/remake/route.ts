import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const maxDuration = 30;

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

    // Preprocessing pipeline to make the image vector-friendly:
    // 1. Resize to working resolution
    // 2. Median filter — smooths textures/noise while keeping edges sharp
    // 3. Posterize — reduces to a small number of flat colour levels
    // 4. Another median pass — cleans up posterization artifacts
    //
    // Result: same image, same subject, but flat simplified colours
    // that trace cleanly. No AI generation, instant, free.
    const processed = await sharp(rawBuffer)
      .resize(1500, 1500, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .median(5)          // smooth textures, preserve edges
      .png({ colours: 8, dither: 0 }) // posterize to 8 flat colours, no dithering
      .toBuffer();

    // One more median pass on the posterized result to clean edges
    const cleaned = await sharp(processed)
      .median(3)
      .png()
      .toBuffer();

    // Return as data URI so the client can use it directly
    const dataUri = `data:image/png;base64,${cleaned.toString("base64")}`;

    return NextResponse.json({ success: true, imageUrl: dataUri });
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
