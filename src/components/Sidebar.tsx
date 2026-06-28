import React, { useEffect, useState } from 'react';
import { MessageSquare, Network, Brain, Database, ScrollText, Settings as SettingsIcon, Plus, Search, Pin, X, HardDrive, DownloadCloud, BookMarked, NotebookText, Eye } from 'lucide-react';
import { cn } from '../lib/cn';
import PowerSwitch from './PowerSwitch';
import { StatusDot } from './hud';
import { useBrainStore } from '../state/brainStore';
import { metaFor } from '../brain/BrainState';

// Grouped so the rail reads as a few tidy clusters instead of one long list.
const NAV_GROUPS: { key: string; label: string; icon: any }[][] = [
  [
    { key: 'chat', label: 'Chat', icon: MessageSquare },
    { key: 'explorer', label: 'Brain', icon: Network },
    { key: 'vision', label: 'Live Vision', icon: Eye },
  ],
  [
    { key: 'memory', label: 'Memory', icon: Brain },
    { key: 'obsidian', label: 'Obsidian', icon: BookMarked },
    { key: 'notion', label: 'Notion', icon: NotebookText },
    { key: 'knowledge', label: 'Knowledge', icon: Database },
  ],
  [
    { key: 'hub', label: 'Model Hub', icon: DownloadCloud },
    { key: 'models', label: 'Models', icon: HardDrive },
  ],
  [
    { key: 'logs', label: 'Logs', icon: ScrollText },
    { key: 'settings', label: 'Settings', icon: SettingsIcon },
  ],
];

/** Left rail: HUD brand + reactor, primary navigation, conversations, live status. */
export default function Sidebar({
  view,
  setView,
  convs,
  selectedId,
  onSelectConv,
  onNewChat,
  search,
  setSearch,
  onDeleteConv,
  onNeedsModel,
}: any) {
  const pinned = convs.filter((c: any) => c.pinned);
  const recent = convs.filter((c: any) => !c.pinned);

  const brain = useBrainStore((s) => s.mock ?? s.state);
  const online = brain !== 'OFF';
  const [model, setModel] = useState('');
  useEffect(() => {
    const apply = (st: any) => setModel(st?.model ? st.model.split(/[\\/]/).pop() : '');
    window.dawn.runtime.status().then(apply);
    const off = window.dawn.runtime.onUpdate(apply);
    return off;
  }, []);

  return (
    <aside className="w-64 shrink-0 bg-bg/50 backdrop-blur-xl border-r border-border flex flex-col relative">
      {/* faint accent hairline down the right edge */}
      <div className="absolute top-0 right-0 bottom-0 w-px" style={{ background: 'linear-gradient(180deg, transparent, rgba(var(--accent-rgb),0.35), transparent)' }} />

      {/* Brand + reactor */}
      <div className="flex items-center gap-3 px-4 py-4">
        <div className="relative w-11 h-11 grid place-items-center shrink-0">
          <div className={cn('absolute inset-0 rounded-full border border-dashed', online ? 'animate-spinSlow' : '')} style={{ borderColor: 'rgba(var(--accent-rgb),0.45)' }} />
          <div className={cn('absolute inset-1.5 rounded-full border', online ? 'animate-spinRev' : '')} style={{ borderColor: 'rgba(var(--accent-rgb),0.2)' }} />
          <div
            className={cn('w-6 h-6 rounded-lg grid place-items-center bg-gradient-to-br from-neural-cyan to-neural-violet', online ? 'animate-breathe' : 'opacity-60')}
            style={{ boxShadow: '0 0 18px -2px rgba(var(--accent-rgb),0.7)' }}
          >
            <Brain size={14} className="text-white" />
          </div>
        </div>
        <div className="min-w-0">
          <div className="font-bold leading-none tracking-[0.18em] text-[15px] accent-text">DAWN</div>
          <div className="hud-label mt-1 truncate">Digitally Autonomous · Workspace Node</div>
        </div>
      </div>

      <div className="pb-3">
        <PowerSwitch onNeedsModel={onNeedsModel} />
      </div>

      <nav className="px-2">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {gi > 0 ? <div className="mx-3 my-1.5 h-px bg-border/60" /> : null}
            <div className="space-y-0.5">
              {group.map((n) => {
                const Icon = n.icon;
                const active = view === n.key;
                return (
                  <button
                    key={n.key}
                    onClick={() => setView(n.key)}
                    className={cn(
                      'group relative w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-[13px] transition-colors',
                      active ? 'text-ink bg-panel2/70' : 'text-dim hover:text-ink hover:bg-panel/50'
                    )}
                  >
                    {active ? (
                      <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }} />
                    ) : null}
                    <Icon size={15} className={active ? '' : 'group-hover:text-ink'} style={active ? { color: 'var(--accent)' } : undefined} />
                    {n.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-3 mt-3">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors"
          style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)', boxShadow: '0 0 18px -8px rgba(var(--accent-rgb),0.8)' }}
        >
          <Plus size={15} /> New Chat
        </button>
        <div className="relative mt-2">
          <Search size={14} className="absolute left-2.5 top-2.5 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="field-accent w-full bg-bg/70 border border-border rounded-lg pl-8 pr-2 py-2 text-xs outline-none transition-shadow"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 mt-2 space-y-0.5">
        {pinned.length > 0 && <div className="hud-label px-2 pt-2 pb-1">Pinned</div>}
        {pinned.map((c: any) => (
          <ConvItem key={c.id} c={c} active={c.id === selectedId} onSelect={onSelectConv} onDelete={onDeleteConv} />
        ))}
        {recent.length > 0 && <div className="hud-label px-2 pt-2 pb-1">Recent</div>}
        {recent.map((c: any) => (
          <ConvItem key={c.id} c={c} active={c.id === selectedId} onSelect={onSelectConv} onDelete={onDeleteConv} />
        ))}
        {convs.length === 0 ? <div className="text-xs text-faint text-center py-6">No conversations yet.</div> : null}
      </div>

      {/* System status panel */}
      <div className="px-3 py-3 border-t border-border">
        <div className="rounded-lg border border-border/60 bg-panel/30 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="panel-head after:hidden">System</span>
            <StatusDot live={online} />
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-faint tracking-wider">STATE</span>
            <span style={online ? { color: 'var(--accent)' } : undefined}>{metaFor(brain).label}</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono gap-2">
            <span className="text-faint tracking-wider">MODEL</span>
            <span className="truncate max-w-[130px] text-dim" title={model || 'no model'}>{model || '—'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-faint pt-0.5 font-mono tracking-wider">
            <span className="inline-block w-1 h-1 rounded-full bg-neural-green" /> LOCAL · NOTHING LEAVES YOUR PC
          </div>
        </div>
      </div>
    </aside>
  );
}

function ConvItem({ c, active, onSelect, onDelete }: any) {
  return (
    <div
      onClick={() => onSelect(c.id)}
      className={cn(
        'group relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors',
        active ? 'bg-panel2/70 text-ink' : 'text-dim hover:text-ink hover:bg-panel/50'
      )}
    >
      {active ? <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full" style={{ background: 'var(--accent)' }} /> : null}
      {c.pinned ? <Pin size={11} className="text-neural-amber shrink-0" /> : null}
      <span className="flex-1 truncate">{c.title || 'New chat'}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
        className="opacity-0 group-hover:opacity-100 text-faint hover:text-neural-red"
      >
        <X size={13} />
      </button>
    </div>
  );
}
