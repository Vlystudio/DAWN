/**
 * llama.ts — client for the local llama.cpp server's OpenAI-compatible API.
 * Talks only to 127.0.0.1:<port>. Streaming via SSE.
 */

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SamplingParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  repeat_penalty?: number;
  max_tokens?: number;
}

/** Stream /v1/chat/completions. Calls onToken per delta; returns full text. */
export async function chatStream(
  baseUrl: string,
  messages: ChatMsg[],
  params: SamplingParams,
  onToken: (delta: string) => void,
  signal: AbortSignal
): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'dawn', messages, stream: true, ...params }),
    signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`/v1/chat/completions returned ${res.status}. ${t}`.trim());
  }
  const reader = (res.body as any).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const obj = JSON.parse(data);
        const delta = obj.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onToken(delta);
        }
      } catch {
        /* partial line — ignore */
      }
    }
  }
  return full;
}

/** Non-streaming /v1/chat/completions — returns the full assistant text. Used by
 *  background pipelines (Deep Research) that don't need token-by-token streaming. */
export async function chat(
  baseUrl: string,
  messages: ChatMsg[],
  params: SamplingParams = {},
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'dawn', messages, stream: false, ...params }),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`/v1/chat/completions returned ${res.status}. ${t}`.trim());
  }
  const d: any = await res.json();
  return d.choices?.[0]?.message?.content || '';
}

/** GET /v1/models — the loaded model id(s). */
export async function models(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const d: any = await res.json();
    return (d.data || []).map((m: any) => m.id);
  } catch {
    return [];
  }
}

/** POST /tokenize — accurate token count for a string (llama.cpp native endpoint). */
export async function tokenize(baseUrl: string, content: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(`${baseUrl}/tokenize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: signal || AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d: any = await res.json();
    return Array.isArray(d.tokens) ? d.tokens.length : null;
  } catch {
    return null;
  }
}

/** Optional: /v1/embeddings (only when the server is in embedding mode). */
export async function embeddings(baseUrl: string, input: string): Promise<Float32Array | null> {
  try {
    const res = await fetch(`${baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dawn', input }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const d: any = await res.json();
    const vec = d.data?.[0]?.embedding;
    return vec ? Float32Array.from(vec) : null;
  } catch {
    return null;
  }
}
