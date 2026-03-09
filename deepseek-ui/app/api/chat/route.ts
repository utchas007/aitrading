import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { messages, model = 'deepseek-r1:14b', temperature = 0.7, max_tokens = 1000, system } = await req.json();

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'Messages are required' }, { status: 400 });
    }

    // Build the prompt from messages
    let prompt = '';
    if (system) {
      prompt += `System: ${system}\n\n`;
    }
    
    messages.forEach((msg: { role: string; content: string }) => {
      if (msg.role === 'user') {
        prompt += `User: ${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        prompt += `Assistant: ${msg.content}\n\n`;
      }
    });
    
    prompt += 'Assistant: ';

    // Connect to local Ollama instance
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: temperature,
          num_predict: max_tokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();

    // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
    const estimatedTokens = Math.ceil(data.response.length / 4);

    return NextResponse.json({
      response: data.response,
      model: model,
      done: data.done,
      tokens: estimatedTokens,
    });
  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate response' },
      { status: 500 }
    );
  }
}
