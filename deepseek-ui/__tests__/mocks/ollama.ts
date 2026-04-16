/**
 * Mock Ollama response factory for trading analysis tests.
 *
 * Usage in tests:
 *   vi.stubGlobal('fetch', mockOllamaFetch({ signal: 'BUY', confidence: 80 }));
 */

export function mockOllamaFetch(analysis: Partial<{
  sentiment: string;
  confidence: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
  keyFactors: string[];
  risks: string[];
  recommendation: string;
}> = {}) {
  const fullAnalysis = {
    sentiment: 'Neutral',
    confidence: 50,
    signal: 'HOLD',
    keyFactors: ['Market uncertainty'],
    risks: ['Volatility'],
    recommendation: 'Wait for clearer signal.',
    entryPrice: null,
    exitPrice: null,
    stopLoss: null,
    ...analysis,
  };

  return async (_url: string, _options?: RequestInit): Promise<Response> => {
    const responseText = JSON.stringify(fullAnalysis);
    return new Response(
      JSON.stringify({ response: responseText }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
}

/** Mock Ollama that returns unparseable text (for testing fallback handling) */
export function mockOllamaFetchBadResponse() {
  return async (_url: string, _options?: RequestInit): Promise<Response> => {
    return new Response(
      JSON.stringify({ response: 'Sorry, I cannot analyze this right now.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
}

/** Mock Ollama that simulates a network failure */
export function mockOllamaFetchError() {
  return async (_url: string, _options?: RequestInit): Promise<never> => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
  };
}
