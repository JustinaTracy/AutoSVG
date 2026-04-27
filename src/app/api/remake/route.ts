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
    // Step 1: Flatten transparency to white, then detect and replace
    // any solid-colour background (black, colored, etc.) with white.
    const resized = await sharp(rawBuffer)
      .resize(1500, 1500, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .toBuffer();

    // Detect background by sampling edge pixels
    const { data, info } = await sharp(resized)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const ch = info.channels;

    const edgeCounts = new Map<string, number>();
    for (let i = 0; i < data.length; i += ch) {
      const pi = i / ch;
      const px = pi % width;
      const py = Math.floor(pi / width);
      if (px >= 3 && px < width - 3 && py >= 3 && py < height - 3) continue;
      const hex = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      edgeCounts.set(hex, (edgeCounts.get(hex) || 0) + 1);
    }
    const edgeBg = [...edgeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "255,255,255";
    const [bgR, bgG, bgB] = edgeBg.split(",").map(Number);

    // Replace background colour with white (threshold distance 60)
    const isWhite = bgR > 240 && bgG > 240 && bgB > 240;
    if (!isWhite) {
      for (let i = 0; i < data.length; i += ch) {
        const dr = data[i] - bgR, dg = data[i + 1] - bgG, db = data[i + 2] - bgB;
        if (Math.sqrt(dr * dr + dg * dg + db * db) < 60) {
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
        }
      }
    }

    const flattened = await sharp(data, { raw: { width, height, channels: ch } })
      .png()
      .toBuffer();

    // Step 2: Median filter on the already-white-bg image
    const smoothed = await sharp(flattened)
      .median(5)
      .png({ colours: 8, dither: 0 })
      .toBuffer();

    // Step 3: Clean up posterization edges
    const postCleaned = await sharp(smoothed)
      .median(3)
      .png()
      .toBuffer();

    // Step 4: Replace background AGAIN — posterization may have
    // shifted white to off-white/beige. Re-detect edges and force white.
    const { data: finalData, info: finalInfo } = await sharp(postCleaned)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const fw = finalInfo.width, fh = finalInfo.height, fc = finalInfo.channels;

    const finalEdgeCounts = new Map<string, number>();
    for (let i = 0; i < finalData.length; i += fc) {
      const pi = i / fc;
      const px = pi % fw, py = Math.floor(pi / fw);
      if (px >= 3 && px < fw - 3 && py >= 3 && py < fh - 3) continue;
      const key = `${finalData[i]},${finalData[i + 1]},${finalData[i + 2]}`;
      finalEdgeCounts.set(key, (finalEdgeCounts.get(key) || 0) + 1);
    }
    const finalBg = [...finalEdgeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "255,255,255";
    const [fbR, fbG, fbB] = finalBg.split(",").map(Number);
    const finalIsWhite = fbR > 240 && fbG > 240 && fbB > 240;
    if (!finalIsWhite) {
      for (let i = 0; i < finalData.length; i += fc) {
        const dr = finalData[i] - fbR, dg = finalData[i + 1] - fbG, db = finalData[i + 2] - fbB;
        if (Math.sqrt(dr * dr + dg * dg + db * db) < 40) {
          finalData[i] = 255;
          finalData[i + 1] = 255;
          finalData[i + 2] = 255;
        }
      }
    }

    const cleaned = await sharp(finalData, { raw: { width: fw, height: fh, channels: fc } })
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
