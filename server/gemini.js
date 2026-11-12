// The only file that knows about Gemini. To switch provider, write another function with the same
// shape: (prompt: string) => Promise<string> (the model's JSON text), throwing an LlmError on failure.

export const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

export class LlmError extends Error {
  // kind: 'rate_limit' | 'auth' | 'timeout' | 'bad_response' | 'unavailable'
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

export function geminiProvider({ apiKey, model = DEFAULT_MODEL, fetch = globalThis.fetch, timeoutMs = 20000 }) {
  if (!apiKey) throw new Error('A Gemini API key is required.');

  return async function generate(prompt) {
    let res;
    try {
      res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.8 },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new LlmError('timeout', 'Gemini took too long to answer.');
      throw new LlmError('unavailable', `Couldn't reach Gemini (${e.message}).`);
    }

    const data = await res.json().catch(() => ({}));
    if (res.status === 429) throw new LlmError('rate_limit', 'Gemini free-tier limit reached.');
    if (res.status === 401 || res.status === 403 || (res.status === 400 && /API key/i.test(data.error?.message ?? '')))
      throw new LlmError('auth', 'Gemini rejected the API key.');
    if (!res.ok) throw new LlmError('unavailable', `Gemini error ${res.status}: ${data.error?.message ?? 'unknown'}`);

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new LlmError('bad_response', 'Gemini returned an empty answer.');
    return text;
  };
}
