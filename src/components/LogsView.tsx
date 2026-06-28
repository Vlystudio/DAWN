import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';

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
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Logs</h1>
          <p className="text-sm text-dim">Startup, database, chat and graph activity.</p>
        </div>
        <Button variant="ghost" onClick={() => window.dawn.logs.clear().then(() => setLogs([]))}>Clear</Button>
      </div>
      <div ref={boxRef} className="flex-1 overflow-y-auto glass p-4 font-mono text-xs space-y-0.5">
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
      </div>
    </div>
  );
}
