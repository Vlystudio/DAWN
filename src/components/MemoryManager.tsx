import React, { useEffect, useState } from 'react';
import { Pin, Trash2, Plus } from 'lucide-react';
import { Button } from '../ui/button';
import type { Memory } from '../types';
import { useBrainStore } from '../state/brainStore';

const TYPES = ['preference', 'project', 'personal_fact', 'workflow', 'recurring_instruction', 'technical_setup', 'local_ai_setting', 'creative_idea'];

/** Memory Manager — view/add/edit/delete/pin memories, toggle memory globally. */
export default function MemoryManager() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [draft, setDraft] = useState('');
  const [type, setType] = useState('personal_fact');
  const [enabled, setEnabled] = useState(true);
  const loadGraph = useBrainStore((s) => s.loadGraph);

  const refresh = () => window.dawn.memory.list().then(setMemories);

  useEffect(() => {
    refresh();
    window.dawn.settings.get().then((s: any) => setEnabled(s.memoryEnabled !== false));
  }, []);

  async function add() {
    const t = draft.trim();
    if (!t) return;
    if (!confirm('Save this memory locally? DAWN will use it in future chats.\n\n' + t)) return;
    await window.dawn.memory.add(t, type);
    setDraft('');
    refresh();
    loadGraph();
  }
  async function remove(id: string) {
    if (!confirm('Delete this memory?')) return;
    await window.dawn.memory.remove(id);
    refresh();
    loadGraph();
  }
  async function pin(m: Memory) {
    await window.dawn.memory.update(m.id, { pinned: m.pinned ? 0 : 1 });
    refresh();
  }
  async function toggleEnabled(v: boolean) {
    setEnabled(v);
    await window.dawn.settings.save({ memoryEnabled: v });
  }

  return (
    <div className="p-6 max-w-3xl mx-auto h-full overflow-y-auto">
      <h1 className="text-xl font-bold">Memory</h1>
      <p className="text-sm text-dim mb-4">Durable facts &amp; preferences DAWN remembers. Stored locally, used during chat. Separate from file knowledge.</p>

      <div className="glass p-4 mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Use memory during chat</div>
          <div className="text-xs text-faint">When off, DAWN ignores all stored memories.</div>
        </div>
        <button
          onClick={() => toggleEnabled(!enabled)}
          className={`w-12 h-6 rounded-full relative transition ${enabled ? 'bg-neural-cyan/40' : 'bg-panel2'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${enabled ? 'left-6' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="glass p-4 mb-4">
        <div className="text-sm font-semibold mb-2">Add a memory</div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. I'm a beekeeper in South Portland, Maine; prefer concise answers with code."
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-neural-cyan resize-y min-h-[64px]"
        />
        <div className="flex items-center gap-2 mt-2">
          <select value={type} onChange={(e) => setType(e.target.value)} className="bg-bg border border-border rounded-lg px-2 py-1.5 text-xs outline-none">
            {TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <Button variant="primary" size="sm" onClick={add} disabled={!draft.trim()}>
            <Plus size={14} /> Save memory
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {memories.length === 0 ? (
          <div className="text-center text-faint py-8">No memories yet.</div>
        ) : (
          memories.map((m) => (
            <div key={m.id} className={`glass p-3 flex items-start gap-3 ${m.pinned ? 'ring-1 ring-neural-amber/50' : ''}`}>
              <div className="flex-1">
                <div className="text-sm">{m.content}</div>
                <div className="text-[11px] text-faint mt-1 capitalize">
                  {m.type.replace(/_/g, ' ')} · {m.source}
                  {m.last_used_at ? ` · last used ${new Date(m.last_used_at).toLocaleDateString()}` : ''}
                </div>
              </div>
              <button onClick={() => pin(m)} className={`p-1.5 rounded ${m.pinned ? 'text-neural-amber' : 'text-faint hover:text-ink'}`} title="Pin">
                <Pin size={14} />
              </button>
              <button onClick={() => remove(m.id)} className="p-1.5 rounded text-faint hover:text-neural-red" title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
