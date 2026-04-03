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
  pair: string; // Trading pair or stock symbol to analyze (e.g., 'XXBTZUSD' or 'AAPL')
  assetType?: 'crypto' | 'stock'; // Optional: defaults to 'crypto' for backward compat
  technicals?: {
    rsi?: number;
    rsiSignal?: string;
    macd?: string;
    overallSignal?: string;
    confidence?: number;
    price?: number;
    change?: string;
  };
  worldContext?: string; // Global market context from World Monitor (commodities, geopolitics, indices)
}

export async function POST(req: NextRequest) {
  try {
    const body: AnalysisRequest = await req.json();
    const { news, marketData, pair, assetType = 'crypto', technicals, worldContext } = body;

    if (!news || !marketData || !pair) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: news, marketData, pair' },
        { status: 400 }
      );
    }

    const isStock = assetType === 'stock';
    const analystType = isStock ? 'expert stock market analyst' : 'expert cryptocurrency trading analyst';
    const assetLabel = isStock ? `${pair} stock` : `${pair} cryptocurrency`;

    // Time context — AI must know when it is to reason about market sessions and news recency
    const now = new Date();
    const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const etHour = etNow.getHours();
    const etMin  = etNow.getMinutes();
    const etDay  = etNow.getDay(); // 0=Sun, 6=Sat
    const isWeekend = etDay === 0 || etDay === 6;
    const isPreMarket   = !isWeekend && etHour >= 4  && (etHour < 9  || (etHour === 9  && etMin < 30));
    const isRegularHours = !isWeekend && (etHour > 9 || (etHour === 9 && etMin >= 30)) && etHour < 16;
    const isAfterHours  = !isWeekend && etHour >= 16 && etHour < 20;
    const marketSession = isWeekend ? 'Weekend (market closed)' : isPreMarket ? 'Pre-market (4:00–9:30 AM ET)' : isRegularHours ? 'Regular hours (9:30 AM–4:00 PM ET)' : isAfterHours ? 'After-hours (4:00–8:00 PM ET)' : 'Market closed';
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const timeContext = `CURRENT TIME & MARKET SESSION:
Date: ${now.toUTCString()}
Eastern Time: ${etNow.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/New_York' })}
Day: ${dayNames[etDay]}
Market Session: ${marketSession}
Note: US stock markets are open Monday–Friday 9:30 AM–4:00 PM ET. Consider the session when assessing urgency of signals.\n`;

    // Build context for AI analysis
    const newsContext = news
      .slice(0, 10)
      .map((item, idx) => `${idx + 1}. [${item.source}] ${item.title}\n   ${item.description}`)
      .join('\n\n');

    const marketContext = Object.entries(marketData)
      .map(([p, data]) => `${p}: $${data.price} (Volume: ${data.volume}${data.change24h ? `, Change: ${data.change24h}%` : ''})`)
      .join('\n');

    // Build technical indicators section if provided
    let technicalsSection = '';
    if (technicals) {
      technicalsSection = `\nTECHNICAL INDICATORS (from IB historical data):
Price: $${technicals.price?.toFixed(2) ?? 'N/A'} (${technicals.change ?? '0'}% today)
RSI: ${technicals.rsi?.toFixed(1) ?? 'N/A'} (${technicals.rsiSignal ?? 'neutral'})
MACD Trend: ${technicals.macd ?? 'neutral'}
Technical Signal: ${technicals.overallSignal ?? 'neutral'} (${technicals.confidence ?? 0}% confidence)\n`;
    }

    const prompt = `You are an ${analystType}. Analyze the following information and provide a trading recommendation for ${assetLabel}.
${isStock ? `This is a publicly traded company stock on US exchanges (NYSE/NASDAQ). Consider earnings, sector trends, macro factors, and technical analysis.` : ''}

${timeContext}
${technicalsSection}
RECENT NEWS (Last 24 hours):
${newsContext}

CURRENT MARKET DATA:
${marketContext}
${worldContext ? `
${worldContext}

GLOBAL MARKET ANALYSIS INSTRUCTIONS:
- If Oil prices are spiking (>5%), consider inflation impact on growth stocks and benefit to energy sector
- If Gold is rising significantly, this often signals risk-off sentiment / flight to safety
- If Geopolitical Risk is HIGH or EXTREME, recommend more conservative positions and tighter stop-losses
- If Global Indices (S&P, NASDAQ, DAX, Nikkei) are all green, this indicates risk-on sentiment globally
- If Global Indices are mixed or red, consider defensive positioning
- Factor breaking news into your sentiment analysis - geopolitical events can override technicals
- Energy sector stocks correlate with oil prices; tech stocks are sensitive to risk sentiment` : ''}

Based on this ${isStock ? 'fundamental, technical, and global macro' : 'fundamental'} analysis, provide:
1. **Sentiment Analysis**: Overall market sentiment (Bullish/Bearish/Neutral) based on news and data
2. **Key Factors**: 3-5 most important factors affecting ${assetLabel}
3. **Trading Signal**: BUY, SELL, or HOLD with confidence level (0-100%)
4. **Risk Assessment**: Potential risks and concerns (include geopolitical risks if relevant)
5. **Global Macro Impact**: How do global indices, commodities, and geopolitical factors affect this trade?
6. **Recommended Action**: Specific trading recommendation with entry/exit points if applicable
${isStock ? '7. **Sector Context**: How is the broader sector performing?' : ''}

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
  "stopLoss": "suggested stop loss or null"${isStock ? ',\n  "sectorOutlook": "brief sector context"' : ''}
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
