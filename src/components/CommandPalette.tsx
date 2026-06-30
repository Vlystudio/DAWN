import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, ArrowRight } from 'lucide-react';
import { ROUTES } from '../lib/uiCore';

/**
 * CommandPalette — global keyboard launcher (Ctrl/Cmd+K). Lists navigation + action commands,
 * fuzzy-filtered, fully keyboard driven (↑/↓/Enter/Esc). It respects feature setup state: on open
 * it loads System Health and annotates setup-gated destinations with "needs setup" (the command
 * still works — it lands you on the page/setup, never a dead end). No command fabricates state.
 */

type Cmd = {
  id: string; label: string; hint?: string; group: string;
  run: () => void; keywords?: string;
};

export default function CommandPalette({ onNav, onNewChat }: { onNav: (view: string) => void; onNewChat: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [needsSetup, setNeedsSetup] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Global open shortcut (Ctrl/Cmd+K). Esc handled while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setOpen((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // On open: focus input, reset query, and pull setup state so gated commands are annotated honestly.
  useEffect(() => {
    if (!open) return;
    setQ(''); setActive(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    (window as any).dawn?.maturity?.list?.().then((res: any) => {
      const map: Record<string, boolean> = {};
      for (const r of res?.reports || []) if (r.route && (r.status === 'BLOCKED_BY_SETUP' || r.status === 'MISSING')) map[r.route] = true;
      setNeedsSetup(map);
    }).catch(() => {});
  }, [open]);

  const close = () => setOpen(false);
  const go = (view: string) => { onNav(view); close(); };

  const commands: Cmd[] = useMemo(() => {
    const actions: Cmd[] = [
      { id: 'new-chat', label: 'New chat', group: 'Actions', keywords: 'message ask', run: () => { onNewChat(); close(); } },
      { id: 'global-search', label: 'Search everything…', group: 'Actions', keywords: 'find global workspace', run: () => { close(); window.dispatchEvent(new Event('dawn:open-search')); } },
      { id: 'health-check', label: 'Run health checks', group: 'Actions', keywords: 'system status maturity', run: () => { (window as any).dawn?.maturity?.check?.().catch(() => {}); go('health'); } },
      { id: 'start-research', label: 'Start research', group: 'Actions', keywords: 'deep search report', run: () => go('research') },
      { id: 'add-document', label: 'New document', group: 'Actions', keywords: 'write doc', run: () => go('documents') },
      { id: 'add-note', label: 'New note', group: 'Actions', keywords: 'jot', run: () => go('notes') },
      { id: 'add-task', label: 'New task', group: 'Actions', keywords: 'todo', run: () => go('tasks') },
      { id: 'run-benchmark', label: 'Benchmark / Compare models', group: 'Actions', keywords: 'speed tok/s arena', run: () => go('compare') },
      { id: 'open-workspace', label: 'Open Workspace Graph', group: 'Actions', keywords: 'items links related', run: () => go('workspace') },
      { id: 'open-health', label: 'Open System Health', group: 'Actions', keywords: 'status maturity diagnostics', run: () => go('health') },
      { id: 'email-setup', label: 'Email setup wizard…', group: 'Actions', keywords: 'imap smtp account gmail outlook', run: () => { close(); window.dispatchEvent(new Event('dawn:open-email-setup')); } },
    ];
    const nav: Cmd[] = ROUTES.map((r) => ({
      id: `nav-${r.key}`, label: `Go to ${r.label}`, group: r.group, keywords: r.key,
      hint: needsSetup[r.key] ? 'needs setup' : undefined, run: () => go(r.key),
    }));
    return [...actions, ...nav];
  }, [needsSetup]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return commands;
    return commands.filter((c) => (c.label + ' ' + (c.keywords || '') + ' ' + c.group).toLowerCase().includes(term));
  }, [q, commands]);

  useEffect(() => { if (active >= filtered.length) setActive(0); }, [filtered, active]);

  if (!open) return null;

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[active]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-start justify-center bg-black/60 pt-[12vh] p-4" onClick={close} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="glass w-full max-w-lg overflow-hidden border border-border" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search size={15} className="text-faint shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onListKey}
            placeholder="Type a command or page…  (Esc to close)"
            aria-label="Search commands"
            className="flex-1 bg-transparent py-3 text-sm outline-none"
          />
          <kbd className="text-[10px] text-faint border border-border rounded px-1.5 py-0.5 shrink-0">Ctrl K</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1" role="listbox" aria-label="Commands">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-faint">No matching command.</div>
          ) : filtered.map((c, i) => (
            <button
              key={c.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => c.run()}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm ${i === active ? 'bg-panel2/70 text-ink' : 'text-dim'}`}
            >
              <ArrowRight size={13} className="shrink-0 opacity-60" aria-hidden />
              <span className="flex-1 truncate">{c.label}</span>
              {c.hint ? <span className="text-[10px] text-neural-amber shrink-0">{c.hint}</span> : null}
              <span className="text-[10px] text-faint shrink-0">{c.group}</span>
              {i === active ? <CornerDownLeft size={12} className="text-faint shrink-0" aria-hidden /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
