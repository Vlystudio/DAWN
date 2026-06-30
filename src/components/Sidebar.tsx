import React, { useEffect, useState } from 'react';
import { MessageSquare, Network, Brain, Database, ScrollText, Settings as SettingsIcon, Plus, Search, Pin, X, HardDrive, DownloadCloud, BookMarked, NotebookText, Eye, Library, Code2, Gauge, Telescope, Swords, FileText, StickyNote, CheckSquare, CalendarDays, Sparkles, ShieldCheck, Mail, Archive, LayoutDashboard, Activity, Share2, ListChecks, BookOpen } from 'lucide-react';
import { cn } from '../lib/cn';
import PowerSwitch from './PowerSwitch';
import { StatusDot } from './hud';
import { useBrainStore } from '../state/brainStore';
import { metaFor } from '../brain/BrainState';
import { useModelName } from '../lib/modelName';

// Grouped + labeled so the rail reads as a few tidy clusters instead of one long list.
const NAV_GROUPS: { title?: string; items: { key: string; label: string; icon: any }[] }[] = [
  { items: [{ key: 'dashboard', label: 'Home', icon: LayoutDashboard }] },
  { title: 'Core', items: [
    { key: 'chat', label: 'Chat', icon: MessageSquare },
    { key: 'explorer', label: 'Brain', icon: Network },
    { key: 'research', label: 'Research', icon: Telescope },
    { key: 'coding', label: 'Coding', icon: Code2 },
    { key: 'vision', label: 'Live Vision', icon: Eye },
  ] },
  { title: 'Models', items: [
    { key: 'hub', label: 'Model Hub', icon: DownloadCloud },
    { key: 'optimizer', label: 'Optimizer', icon: Gauge },
    { key: 'cookbook', label: 'Model Cookbook', icon: BookOpen },
    { key: 'compare', label: 'Compare', icon: Swords },
    { key: 'models', label: 'Models', icon: HardDrive },
  ] },
  { title: 'Workspace', items: [
    { key: 'documents', label: 'Documents', icon: FileText },
    { key: 'notes', label: 'Notes', icon: StickyNote },
    { key: 'tasks', label: 'Tasks', icon: CheckSquare },
    { key: 'calendar', label: 'Calendar', icon: CalendarDays },
    { key: 'email', label: 'Email', icon: Mail },
    { key: 'workspace', label: 'Workspace Graph', icon: Share2 },
  ] },
  { title: 'Knowledge', items: [
    { key: 'memory', label: 'Memory', icon: Brain },
    { key: 'obsidian', label: 'Obsidian', icon: BookMarked },
    { key: 'notion', label: 'Notion', icon: NotebookText },
    { key: 'knowledge', label: 'Knowledge', icon: Database },
    { key: 'localknowledge', label: 'Local Knowledge', icon: Library },
  ] },
  { title: 'Automation', items: [
    { key: 'skills', label: 'Skills', icon: Sparkles },
  ] },
  { title: 'Security', items: [
    { key: 'security', label: 'Security', icon: ShieldCheck },
    { key: 'backup', label: 'Backup', icon: Archive },
  ] },
  { title: 'System', items: [
    { key: 'setup', label: 'Setup Center', icon: ListChecks },
    { key: 'health', label: 'System Health', icon: Activity },
    { key: 'logs', label: 'Logs', icon: ScrollText },
    { key: 'settings', label: 'Settings', icon: SettingsIcon },
  ] },
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
  const friendlyModel = useModelName(model);
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

      {/* Scrollable middle: nav + new chat + conversations live in one scroll region so every
          nav item stays reachable on short windows (brand/power stay fixed above, System below). */}
      <div className="flex-1 min-h-0 overflow-y-auto">
      <nav className="px-2" aria-label="Primary">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-1.5' : ''}>
            {group.title ? <div className="hud-label px-3 pt-1.5 pb-0.5 text-faint/70">{group.title}</div> : null}
            <div className="space-y-0.5">
              {group.items.map((n) => {
                const Icon = n.icon;
                const active = view === n.key;
                return (
                  <button
                    key={n.key}
                    onClick={() => setView(n.key)}
                    aria-label={n.label}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-[13px] transition-colors focus-visible:ring-1 focus-visible:ring-[var(--accent)] outline-none',
                      active ? 'text-ink bg-panel2/70' : 'text-dim hover:text-ink hover:bg-panel/50'
                    )}
                  >
                    {active ? (
                      <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }} aria-hidden />
                    ) : null}
                    <Icon size={15} className={active ? '' : 'group-hover:text-ink'} style={active ? { color: 'var(--accent)' } : undefined} aria-hidden />
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

      <div className="px-2 mt-2 space-y-0.5">
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
            <span className="truncate max-w-[130px] text-dim" title={model || 'no model'}>{model ? friendlyModel : '—'}</span>
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
