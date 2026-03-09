import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AnalysisRequest {
  news: Array<{
    title: string;
    description: string;
    source: string;
    pubDate: string;
  }>;
  marketData: {
    [pair: string]: {
      price: string;
      volume: string;
      change24h?: string;
    };
  };
  pair: string; // Trading pair to analyze (e.g., 'XXBTZUSD')
}

export async function POST(req: NextRequest) {
  try {
    const body: AnalysisRequest = await req.json();
    const { news, marketData, pair } = body;

    if (!news || !marketData || !pair) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: news, marketData, pair' },
        { status: 400 }
      );
    }

    // Build context for AI analysis
    const newsContext = news
      .slice(0, 10) // Use top 10 most recent news items
      .map((item, idx) => `${idx + 1}. [${item.source}] ${item.title}\n   ${item.description}`)
      .join('\n\n');

    const marketContext = Object.entries(marketData)
      .map(([p, data]) => `${p}: $${data.price} (Volume: ${data.volume})`)
      .join('\n');

    const prompt = `You are an expert cryptocurrency trading analyst. Analyze the following information and provide a trading recommendation for ${pair}.

RECENT NEWS (Last 24 hours):
${newsContext}

CURRENT MARKET DATA:
${marketContext}

Based on this fundamental analysis, provide:
1. **Sentiment Analysis**: Overall market sentiment (Bullish/Bearish/Neutral) based on news
2. **Key Factors**: 3-5 most important factors affecting ${pair}
3. **Trading Signal**: BUY, SELL, or HOLD with confidence level (0-100%)
4. **Risk Assessment**: Potential risks and concerns
5. **Recommended Action**: Specific trading recommendation with entry/exit points if applicable

Format your response as JSON with these fields:
{
  "sentiment": "Bullish|Bearish|Neutral",
  "confidence": 0-100,
  "signal": "BUY|SELL|HOLD",
  "keyFactors": ["factor1", "factor2", ...],
  "risks": ["risk1", "risk2", ...],
  "recommendation": "detailed recommendation text",
  "entryPrice": "suggested entry price or null",
  "exitPrice": "suggested exit price or null",
  "stopLoss": "suggested stop loss or null"
}`;

    // Call DeepSeek AI for analysis
    const aiResponse = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'deepseek-r1:14b',
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3, // Lower temperature for more consistent analysis
          num_predict: 1500,
        },
      }),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI API error: ${aiResponse.statusText}`);
    }

    const aiData = await aiResponse.json();
    let analysis;

    try {
      // Try to parse JSON response from AI
      const jsonMatch = aiData.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: create structured response from text
        analysis = {
          sentiment: 'Neutral',
          confidence: 50,
          signal: 'HOLD',
          keyFactors: ['Analysis in progress'],
          risks: ['Insufficient data'],
          recommendation: aiData.response,
          entryPrice: null,
          exitPrice: null,
          stopLoss: null,
        };
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      analysis = {
        sentiment: 'Neutral',
        confidence: 50,
        signal: 'HOLD',
        keyFactors: ['Analysis in progress'],
        risks: ['Insufficient data'],
        recommendation: aiData.response,
        entryPrice: null,
        exitPrice: null,
        stopLoss: null,
      };
    }

    return NextResponse.json({
      success: true,
      analysis,
      pair,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Trading analysis error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to analyze trading data' },
      { status: 500 }
    );
  }
}
