/** chunk.ts — split text into overlapping chunks for embedding/retrieval. */
export function chunkText(text: string, opts: { size?: number; overlap?: number } = {}): string[] {
  const size = Math.max(200, opts.size || 1200);
  const overlap = Math.min(size - 50, Math.max(0, opts.overlap ?? 200));
  const clean = String(text).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';
  const push = () => {
    const t = current.trim();
    if (t) chunks.push(t);
  };
  for (const para of paragraphs) {
    if (para.length > size) {
      push();
      current = '';
      for (let i = 0; i < para.length; i += size - overlap) chunks.push(para.slice(i, i + size).trim());
      continue;
    }
    if ((current + '\n\n' + para).length > size) {
      push();
      current = overlap > 0 ? current.slice(-overlap) + '\n\n' + para : para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  push();
  return chunks.filter(Boolean);
}

export default { chunkText };
