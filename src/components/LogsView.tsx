import React, { useEffect, useRef, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { PageShellLog, Button } from '../ui/system';

/** Logs page — startup steps, command output, errors, with timestamps. */
export default function LogsView() {
  const [logs, setLogs] = useState<any[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.dawn.logs.get().then(setLogs);
    const off = window.dawn.logs.onNew((e: any) => setLogs((p) => [...p.slice(-1999), e]));
    return off;
  }, []);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [logs.length]);

  const color: Record<string, string> = {
    step: 'text-neural-violet',
    info: 'text-ink',
    warn: 'text-neural-amber',
    error: 'text-neural-red',
  };

  return (
    <PageShellLog
      icon={<ScrollText size={22} />}
      title="Logs"
      subtitle="Startup, database, chat and graph activity."
      notice={<div className="text-[11px] text-faint">Errors are redacted; secrets are never logged. Detailed diagnostics: System Health → Export bundle.</div>}
      actions={<Button variant="secondary" onClick={() => window.dawn.logs.clear().then(() => setLogs([]))}>Clear</Button>}
      bodyRef={boxRef}
      bodyClassName="glass p-4 font-mono text-xs space-y-0.5"
    >
      {logs.length === 0 ? (
        <div className="text-faint text-center py-10">No log entries yet.</div>
      ) : (
        logs.map((l, i) => (
          <div key={i} className="flex gap-3">
            <span className="text-faint shrink-0">{new Date(l.ts).toLocaleTimeString()}</span>
            <span className="text-neural-cyan shrink-0 w-16">[{l.source}]</span>
            <span className={color[l.level] || 'text-ink'}>{l.message}</span>
          </div>
        ))
      )}
    </PageShellLog>
  );
}
