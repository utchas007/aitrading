export async function readJsonSafely<T = any>(res: Response, context = 'request'): Promise<T> {
  const status = res.status;
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (!text || !text.trim()) return {} as T;

  const trimmed = text.trim();
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  const isJsonContentType = contentType.includes('application/json') || contentType.includes('+json');

  if (!isJsonContentType && !looksLikeJson) {
    throw new Error(`${context} returned non-JSON response (HTTP ${status})`);
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`${context} returned invalid JSON (HTTP ${status})`);
  }
}

