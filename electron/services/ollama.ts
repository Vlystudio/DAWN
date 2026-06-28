import settings from './settings';

/** Ollama API client (local, no cloud). Streaming chat + models + embeddings. */

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function base() {
  return settings.get().ollamaUrl.replace(/\/$/, '');
}

export async function listModels(): Promise<string[]> {
  try {
    const res = await fetch(`${base()}/api/tags`);
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data.models || []).map((m: any) => m.name);
  } catch {
    return [];
  }
}

export async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${base()}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Stream a chat completion. Calls onToken for each content delta. Returns the
 * full assembled text. Honors the AbortSignal (for Stop).
 */
export async function chatStream(
  model: string,
  messages: OllamaMessage[],
  onToken: (delta: string) => void,
  signal: AbortSignal
): Promise<string> {
  const res = await fetch(`${base()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Ollama /api/chat returned ${res.status}. ${txt}`.trim());
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
      if (!line) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.error) throw new Error(obj.error);
      const delta = obj.message?.content;
      if (delta) {
        full += delta;
        onToken(delta);
      }
    }
  }
  return full;
}

/** Embed text locally (for future RAG / memory similarity). */
export async function embed(text: string): Promise<Float32Array | null> {
  try {
    const res = await fetch(`${base()}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.get().embedModel, prompt: text }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const vec = data.embedding || (data.embeddings && data.embeddings[0]);
    return vec ? Float32Array.from(vec) : null;
  } catch {
    return null;
  }
}

export default { listModels, isUp, chatStream, embed };
