import React, { useEffect, useState } from 'react';
import {
  MessageSquare, FileText, StickyNote, CheckSquare, Telescope, Swords, Archive, Cpu, Zap,
  ShieldCheck, Mail, Clock, AlertTriangle, Sparkles, CheckCircle2,
} from 'lucide-react';
import { buildDashboardSummary, DashboardSummary } from '../lib/uiCore';
import { Badge, Spinner, SectionHeader } from '../ui/primitives';
import { useModelName } from '../lib/modelName';

/**
 * Dashboard / Home — a calm overview of DAWN: status, active model, what needs attention
 * (tasks/events), recent work, and security/backup/email posture, plus quick actions. Loads
 * once (no polling); never shows document/email bodies or any secret.
 */
export default function DashboardView({ onNav, onNewChat }: { onNav: (v: string) => void; onNewChat: () => void }) {
  const [s, setS] = useState<DashboardSummary | null>(null);
  const friendly = useModelName(s?.model);

  useEffect(() => {
    const now = Date.now();
    Promise.all([
      window.dawn.runtime.status().catch(() => null),
      window.dawn.auth.status().catch(() => null),
      window.dawn.tasks.list().catch(() => []),
      window.dawn.notes.list().catch(() => []),
      window.dawn.docs.list().catch(() => []),
      window.dawn.research.list().catch(() => []),
      window.dawn.cal.list(now, now + 14 * 86400000).catch(() => []),
      window.dawn.backup.history().catch(() => []),
      window.dawn.email.listAccounts().catch(() => []),
      window.dawn.security.count().catch(() => 0),
    ]).then(([runtime, auth, tasks, notes, documents, research, events, backups, emailAccounts, promptEvents]) => {
      setS(buildDashboardSummary({ runtime, auth, tasks, notes, documents, research, events, backups, emailAccounts, promptEvents }));
    });
  }, []);

  if (!s) return <div className="h-full grid place-items-center"><Spinner size={18} label="Loading your workspace…" /></div>;

  const actions: [string, any, () => void][] = [
    ['New chat', MessageSquare, onNewChat],
    ['Document', FileText, () => onNav('documents')],
    ['Note', StickyNote, () => onNav('notes')],
    ['Task', CheckSquare, () => onNav('tasks')],
    ['Research', Telescope, () => onNav('research')],
    ['Compare', Swords, () => onNav('compare')],
    ['Backup', Archive, () => onNav('backup')],
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-4xl mx-auto">
        {/* status */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">Welcome to DAWN</h1>
            <p className="text-sm text-dim">Your local-first AI workspace — everything stays on this PC.</p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${s.online ? 'border-neural-green/50 text-neural-green' : 'border-border text-faint'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${s.online ? 'bg-neural-green animate-pulse motion-reduce:animate-none' : 'bg-faint'}`} aria-hidden /> {s.online ? 'Online' : 'Offline'}
            </span>
            {s.model ? <span className="text-faint inline-flex items-center gap-1"><Cpu size={12} /> {friendly} <span className="opacity-60">· {s.backend}</span></span> : <button onClick={() => onNav('models')} className="text-neural-cyan">Load a model →</button>}
          </div>
        </div>

        {/* quick actions */}
        <div className="flex gap-2 flex-wrap mb-5">
          {actions.map(([label, Icon, fn]) => (
            <button key={label} onClick={fn} aria-label={label} className="text-xs px-3 py-2 rounded-lg border border-border text-dim hover:text-ink hover:border-[var(--accent)]/40 inline-flex items-center gap-1.5 transition-colors">
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          {/* attention: tasks + events */}
          <Card>
            <SectionHeader icon={<Clock size={15} />} title="Coming up" right={s.counts.overdue ? <Badge kind="high">{s.counts.overdue} overdue</Badge> : undefined} />
            {s.upcoming.length ? (
              <ul className="space-y-1.5">
                {s.upcoming.map((u) => (
                  <li key={u.id} className="flex items-center gap-2 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full ${u.overdue ? 'bg-neural-red' : 'bg-neural-cyan'}`} aria-hidden />
                    <span className="flex-1 truncate text-dim">{u.title}</span>
                    <span className={u.overdue ? 'text-neural-red' : 'text-faint'}>{new Date(u.when).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                  </li>
                ))}
              </ul>
            ) : <Muted>Nothing scheduled. <Link onClick={() => onNav('tasks')}>Add a task</Link> or <Link onClick={() => onNav('calendar')}>an event</Link>.</Muted>}
          </Card>

          {/* recent work */}
          <Card>
            <SectionHeader icon={<FileText size={15} />} title="Recent work" />
            {s.recentDocs.length || s.recentResearch.length ? (
              <ul className="space-y-1.5 text-xs">
                {s.recentDocs.map((d) => <li key={d.id} className="flex items-center gap-2"><FileText size={12} className="text-faint" /><button onClick={() => onNav('documents')} className="flex-1 truncate text-left text-dim hover:text-ink">{d.title}</button></li>)}
                {s.recentResearch.map((r) => <li key={r.id} className="flex items-center gap-2"><Telescope size={12} className="text-faint" /><button onClick={() => onNav('research')} className="flex-1 truncate text-left text-dim hover:text-ink">{r.question}</button></li>)}
              </ul>
            ) : <Muted>No documents or research yet. <Link onClick={() => onNav('research')}>Start research</Link>.</Muted>}
          </Card>

          {/* security posture */}
          <Card>
            <SectionHeader icon={<ShieldCheck size={15} />} title="Security" right={<Badge kind={s.security.locked ? 'locked' : s.security.tone}>{s.security.locked ? 'locked' : s.security.mode}</Badge>} />
            <div className="text-xs text-dim space-y-1">
              <div>{s.security.mode === 'Local desktop' ? 'No login required (local desktop mode).' : `Secure mode on${s.optimizer ? '' : ''}.`}</div>
              <div className="text-faint inline-flex items-center gap-1.5">{s.promptEvents ? <><AlertTriangle size={12} className="text-neural-amber" /> {s.promptEvents} prompt-safety event(s) logged</> : <><CheckCircle2 size={12} className="text-neural-green" /> No prompt-safety flags</>}</div>
              <button onClick={() => onNav('security')} className="text-neural-cyan text-[11px]">Open Security →</button>
            </div>
          </Card>

          {/* backup + email */}
          <Card>
            <SectionHeader icon={<Archive size={15} />} title="Backup &amp; Email" />
            <div className="text-xs text-dim space-y-1.5">
              <div className="flex items-center gap-2">{s.backup.has ? <Badge kind="ok">backed up</Badge> : <Badge kind="warning">no backup</Badge>}<span className="text-faint">{s.backup.lastAt ? `last ${new Date(s.backup.lastAt).toLocaleDateString()}` : 'create one to be safe'}</span><button onClick={() => onNav('backup')} className="text-neural-cyan text-[11px] ml-auto">Backup →</button></div>
              <div className="flex items-center gap-2"><Mail size={12} className="text-faint" /><span className="text-faint">{s.email.accounts ? `${s.email.accounts} account(s)${s.email.lastStatus === 'error' ? ' · sync failed' : ''}` : 'no email account'}</span><button onClick={() => onNav('email')} className="text-neural-cyan text-[11px] ml-auto">Email →</button></div>
            </div>
          </Card>
        </div>

        <div className="text-[11px] text-faint text-center mt-5 inline-flex items-center gap-1.5 w-full justify-center"><span className="inline-block w-1 h-1 rounded-full bg-neural-green" aria-hidden /> Local · nothing leaves your PC</div>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) { return <div className="glass p-4">{children}</div>; }
function Muted({ children }: { children: React.ReactNode }) { return <div className="text-xs text-faint">{children}</div>; }
function Link({ onClick, children }: { onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className="text-neural-cyan hover:underline">{children}</button>; }
