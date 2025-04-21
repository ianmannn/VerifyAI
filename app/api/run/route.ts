import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { openAIService } from '@/app/lib/services/openai-service';
import { broadcastAlert } from '@/app/lib/eventEmitter';

export const runtime = 'nodejs';           // guarantee Node, not Edge
export const dynamic = 'force-dynamic';    // disable any implicit caching

export async function POST(request: Request) {
  try {
    const formData      = await request.formData();
    const screenshot    = formData.get('screenshot')  as File | null;
    const businessName  = formData.get('businessName') as string | null;

    if (!screenshot || !businessName) {
      return NextResponse.json({ error: 'Missing screenshot or business name.' }, { status: 400 });
    }

    // ---- 4.5 MB guard ----------------------------------------------------
    if (screenshot.size > 4.5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Screenshot exceeds 4.5 MB. Compress on the client or use Blob storage.' },
        { status: 413 }
      );
    }

    broadcastAlert({ type: 'ImageCompression', message: 'Compressing image', timestamp: Date.now() });

    const compressed = await sharp(Buffer.from(await screenshot.arrayBuffer()))
      .resize({ width: 800 })              // down‑scale
      .jpeg({ quality: 65, mozjpeg: true })// JPEG ≈ ⅓ the size of PNG
      .toBuffer();

    const base64Image = compressed.toString('base64');

    broadcastAlert({ type: 'OpenAI', message: 'Sending screenshot to OpenAI', timestamp: Date.now() });

    const { message } = await openAIService.analyzeScreenshot(base64Image, businessName);

    const parsed = JSON.parse(message as string);

    const screenshotAnalysis = {
      score: parsed.score ?? 0,
      metadata: {
        summary:            parsed.metadata?.summary            ?? 'No summary.',
        restrictedItems:    parsed.metadata?.restrictedItems    ?? { score: 0, message: 'N/A' },
        productPages:       parsed.metadata?.productPages       ?? { score: 0, message: 'N/A' },
        ownership:          parsed.metadata?.ownership          ?? { score: 0, message: 'N/A' },
        overallSafety:      parsed.metadata?.overallSafety      ?? { score: 0, message: 'N/A' },
      },
    };

    return NextResponse.json({ message: 'Analysis completed', screenshotAnalysis });

  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error('❌ Error:', err);
      return NextResponse.json(
        { error: `Error: ${err.message}` },
        { status: 500 }
      );
    } else {
      console.error('❌ Unknown error:', err);
      return NextResponse.json(
        { error: 'Unknown error' },
        { status: 500 }
      );
    }
  }
}
