import React, { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown';
import {
  Sparkles, Plus, Trash2, Play, Loader2, AlertTriangle, ShieldAlert, Check, Power,
} from 'lucide-react';
import { useBrainStore } from '../state/brainStore';

/**
 * Skills — user-created automations: an instruction body + a set of allowed tools. The body
 * is untrusted (wrapped by PromptSecurity, never the system prompt). Tool calls are limited
 * to the allowed list and routed through the approval gateway.
 */
const riskColor: any = { safe: 'text-neural-green', low: 'text-neural-green', medium: 'text-neural-amber', high: 'text-neural-red', critical: 'text-neural-red' };

export default function SkillsView() {
  const [skills, setSkills] = useState<any[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [testInput, setTestInput] = useState('');
  const [testOut, setTestOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const setBrain = useBrainStore((s) => s.setBrain);
  const saveTimer = useRef<any>(null);

  const refresh = () => window.dawn.skills.list().then(setSkills);
  useEffect(() => { refresh(); window.dawn.tools.list().then(setTools); }, []);

  async function open(sid: string) {
    const s = await window.dawn.skills.get(sid);
    if (!s) return;
    setId(sid); setDraft({ ...s, allowedToolIds: s.allowed_tools || [] }); setTestOut(''); setMsg('');
  }
  async function create() { const s = await window.dawn.skills.create({ name: 'New skill', body: '' }); await refresh(); open(s.id); }
  async function remove(sid: string) { if (!confirm('Delete this skill?')) return; await window.dawn.skills.delete(sid); if (id === sid) { setId(null); setDraft(null); } refresh(); }

  function patch(p: any) {
    setDraft((d: any) => ({ ...d, ...p }));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const next = { ...draft, ...p };
      const saved = await window.dawn.skills.update(id!, { name: next.name, description: next.description, body: next.body, enabled: !!next.enabled, allowedToolIds: next.allowedToolIds, tags: next.tags });
      setDraft({ ...saved, allowedToolIds: saved.allowed_tools || [] });
      refresh();
    }, 600);
  }
  function toggleTool(tid: string) {
    const cur: string[] = draft.allowedToolIds || [];
    patch({ allowedToolIds: cur.includes(tid) ? cur.filter((x) => x !== tid) : [...cur, tid] });
  }

  async function test() {
    if (!id) return;
    setBusy(true); setMsg(''); setBrain('THINKING', 'Running skill…');
    const r = await window.dawn.skills.test(id, testInput);
    setBusy(false); setBrain('IDLE');
    if (!r.ok) { setMsg(r.error); return; }
    setTestOut(r.output);
    open(id);
  }

  const risky = draft && (draft.risk_level === 'high' || draft.risk_level === 'critical');

  return (
    <div className="h-full flex">
      <div className="w-60 shrink-0 border-r border-border bg-bg/40 flex flex-col">
        <div className="p-3"><button onClick={create} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.1)' }}><Plus size={15} /> New skill</button></div>
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {skills.map((s) => (
            <div key={s.id} onClick={() => open(s.id)} className={`group px-2.5 py-2 rounded-lg cursor-pointer ${id === s.id ? 'bg-panel2/70' : 'hover:bg-panel/50'}`}>
              <div className="flex items-start gap-1.5">
                <Sparkles size={12} className={`mt-0.5 shrink-0 ${s.enabled ? '' : 'opacity-40'}`} style={{ color: 'var(--accent)' }} />
                <span className={`flex-1 text-xs leading-snug line-clamp-2 ${s.enabled ? 'text-dim' : 'text-faint line-through'}`}>{s.name}</span>
                <button onClick={(e) => { e.stopPropagation(); remove(s.id); }} className="opacity-0 group-hover:opacity-100 text-faint hover:text-neural-red"><Trash2 size={12} /></button>
              </div>
              <div className={`text-[10px] mt-0.5 ml-4 ${riskColor[s.risk_level]}`}>{s.risk_level} · {(s.allowed_tools || []).length} tools</div>
            </div>
          ))}
          {!skills.length ? <div className="text-[11px] text-faint text-center py-8 px-3">No skills yet.<br />Create a reusable instruction.</div> : null}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto">
        {!draft ? (
          <div className="h-full grid place-items-center text-center p-8"><div><Sparkles size={40} className="mx-auto text-faint mb-3" /><div className="text-lg font-semibold">Skills</div><p className="text-sm text-dim mt-1 max-w-sm">Create reusable instructions for DAWN, scoped to a set of allowed tools. Skill text is untrusted and can never override DAWN's safety rules.</p></div></div>
        ) : (
          <div className="p-6 max-w-2xl mx-auto">
            <div className="flex items-center gap-2 mb-3">
              <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} className="flex-1 bg-transparent text-xl font-bold outline-none" />
              <span className={`text-xs font-mono uppercase ${riskColor[draft.risk_level]}`}>{draft.risk_level}</span>
              <button onClick={() => patch({ enabled: !draft.enabled })} title={draft.enabled ? 'Enabled' : 'Disabled'} className={`p-1.5 rounded-lg border ${draft.enabled ? 'border-neural-green/50 text-neural-green' : 'border-border text-faint'}`}><Power size={14} /></button>
            </div>
            <input value={draft.description || ''} onChange={(e) => patch({ description: e.target.value })} placeholder="Short description" className="w-full bg-transparent text-sm text-dim mb-3 outline-none" />

            <div className="text-[11px] text-faint mb-1">Skill instructions (untrusted — wrapped by PromptSecurity)</div>
            <textarea value={draft.body} onChange={(e) => patch({ body: e.target.value })} rows={6} placeholder="e.g. You help me triage my notes: summarize, then suggest next actions…" className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--accent)] mb-4" />

            <div className="text-[11px] text-faint mb-1.5">Allowed tools <span className="text-faint/70">— the skill can only use these</span></div>
            {risky ? <div className="text-[11px] text-neural-red mb-2 flex items-center gap-1.5"><ShieldAlert size={13} /> This skill includes high/critical tools — every such call still requires your approval.</div> : null}
            <div className="grid md:grid-cols-2 gap-1 mb-4 max-h-56 overflow-y-auto">
              {tools.filter((t) => !t.future).map((t) => {
                const on = (draft.allowedToolIds || []).includes(t.id);
                return (
                  <button key={t.id} onClick={() => toggleTool(t.id)} disabled={!t.enabled} className={`text-left text-[11px] px-2 py-1.5 rounded-lg border flex items-center gap-1.5 ${on ? 'border-neural-cyan/60 bg-neural-cyan/10 text-ink' : 'border-border text-dim hover:text-ink'} ${t.enabled ? '' : 'opacity-40'}`} title={`${t.description} (${t.requiredPermission})`}>
                    {on ? <Check size={11} className="text-neural-cyan shrink-0" /> : <span className="w-[11px] shrink-0" />}
                    <span className="truncate flex-1">{t.name}</span>
                    <span className={`${riskColor[t.riskLevel]} shrink-0`}>{t.riskLevel}</span>
                  </button>
                );
              })}
            </div>

            <div className="glass p-3">
              <div className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Play size={13} /> Test skill</div>
              <div className="flex gap-2 mb-2">
                <input value={testInput} onChange={(e) => setTestInput(e.target.value)} placeholder="Optional input for the skill…" className="flex-1 bg-bg border border-border rounded-lg px-2.5 py-1.5 text-xs outline-none" />
                <button onClick={test} disabled={busy} className="px-3 py-1.5 rounded-lg border font-semibold text-xs inline-flex items-center gap-1 disabled:opacity-40" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.1)' }}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run</button>
              </div>
              {msg ? <div className="text-[11px] text-neural-amber mb-2 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5" />{msg}</div> : null}
              {testOut ? <div className="text-sm border-t border-border/50 pt-2 mt-1"><Markdown>{testOut}</Markdown></div> : null}
              {draft.runs?.length ? <div className="text-[10px] text-faint mt-2">Recent runs: {draft.runs.slice(0, 5).map((r: any) => `${new Date(r.created_at).toLocaleTimeString()} ${r.status}`).join(' · ')}</div> : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
