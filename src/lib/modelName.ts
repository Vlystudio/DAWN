import { useEffect, useState } from 'react';

/**
 * Friendly DAWN model names in the renderer. Maps a raw GGUF filename/path to its
 * memorable name (e.g. qwen2.5-coder-7b…gguf → "Code Smith") via the optimizer, with
 * an in-memory cache so the status line / dropdown / system panel don't re-fetch.
 * Falls back to the raw basename when no friendly name exists — never blanks out.
 */
const cache = new Map<string, string>(); // basename -> friendly name

export function baseName(raw?: string): string {
  return (raw || '').split(/[\\/]/).pop() || '';
}

/** Resolve friendly names for a set of model ids; returns { basename: friendly }. */
export async function resolveNames(ids: string[]): Promise<Record<string, string>> {
  const keys = Array.from(new Set(ids.map(baseName).filter(Boolean)));
  const missing = keys.filter((k) => !cache.has(k));
  if (missing.length) {
    try {
      const res = await window.dawn.optimizer.names(missing);
      for (const k of missing) cache.set(k, (res && res[k]) || k);
    } catch {
      for (const k of missing) cache.set(k, k);
    }
  }
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = cache.get(k) || k;
  return out;
}

/** Reactive friendly name for one model id (path or filename). */
export function useModelName(raw?: string): string {
  const key = baseName(raw);
  const [name, setName] = useState<string>(cache.get(key) || key);
  useEffect(() => {
    let alive = true;
    if (!key) { setName(''); return; }
    if (cache.has(key)) { setName(cache.get(key)!); return; }
    resolveNames([key]).then((m) => { if (alive) setName(m[key] || key); });
    return () => { alive = false; };
  }, [key]);
  return name || key;
}
