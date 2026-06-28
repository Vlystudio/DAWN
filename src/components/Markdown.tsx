import React, { useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

/** GitHub-flavored markdown + syntax highlighting, with a copy button on code
 *  blocks. Remote images are blocked by CSP, so untrusted output can't phone home. */
function Pre({ children }: any) {
  const ref = useRef<HTMLPreElement>(null);
  const copy = () => navigator.clipboard.writeText(ref.current?.innerText || '').catch(() => {});
  return (
    <div className="relative group">
      <button
        onClick={copy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition text-[11px] px-2 py-0.5 rounded bg-panel2 border border-border text-dim hover:text-ink"
      >
        Copy
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight as any]} components={{ pre: Pre as any }}>
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}
