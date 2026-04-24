import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/trading/watchlist-suggest');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// US stock ticker format: 1–5 uppercase letters only
const TICKER_RE = /^[A-Z]{1,5}$/;

export async function POST(req: NextRequest) {
  try {
    const { news = [], currentPairs = [] } = await req.json();

    const headlines = (news as any[])
      .slice(0, 15)
      .map((n: any, i: number) => `${i + 1}. ${n.title ?? n.headline ?? ''}`)
      .filter(Boolean)
      .join('\n');

    if (!headlines) {
      return NextResponse.json({ success: true, suggestions: [] });
    }

    const excluded = (currentPairs as string[]).join(', ');

    const prompt = `You are a US equity trading assistant. Based on the market news headlines below, identify up to 5 US stock tickers that are likely to have strong trading opportunities in the next 24 hours.

Rules:
- Return only NYSE or NASDAQ tickers (1–5 uppercase letters, e.g. AAPL, NVDA)
- Do NOT include any of these already-watched tickers: ${excluded}
- Focus on stocks with high news relevance, momentum, or sector catalysts
- If no strong candidates exist, return fewer or zero suggestions

NEWS HEADLINES:
${headlines}

Respond ONLY with a JSON object in this exact format (no explanation, no extra text):
{"suggestions": ["TICK1", "TICK2"]}`;

    const ollamaUrl = process.env.OLLAMA_API_URL || 'http://localhost:11434';
    const aiResponse = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'deepseek-r1:14b',
        prompt,
        stream: false,
        options: { temperature: 0.2, num_predict: 200 },
      }),
    });

    if (!aiResponse.ok) throw new Error(`Ollama error: ${aiResponse.statusText}`);

    const aiData = await aiResponse.json();
    const cleaned = (aiData.response as string)
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim();

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ success: true, suggestions: [] });

    const parsed = JSON.parse(jsonMatch[0]);
    const suggestions: string[] = (parsed.suggestions ?? [])
      .filter((s: unknown) => typeof s === 'string' && TICKER_RE.test(s) && !(currentPairs as string[]).includes(s))
      .slice(0, 5);

    log.info('Watchlist suggestions', { suggestions });
    return NextResponse.json({ success: true, suggestions });
  } catch (error) {
    log.error('Watchlist suggest error', { error: String(error) });
    return apiError('Failed to suggest watchlist additions', 'INTERNAL_ERROR');
  }
}
