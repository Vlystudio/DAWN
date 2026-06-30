import React, { useEffect, useState } from 'react';
import { Send, Square, Paperclip, Mic, Brain, FileText, Terminal } from 'lucide-react';
import { Button } from '../ui/button';
import { useBrainStore } from '../state/brainStore';
import { resolveNames, baseName } from '../lib/modelName';

/**
 * Composer — message input with the loaded-model indicator, Memory / Local
 * Knowledge / Tools toggles, and voice/file placeholders. Enter sends,
 * Shift+Enter newlines. Pressing send sets the brain to THINKING immediately.
 */
export default function Composer({
  models,
  loadedPath,
  runtimeState,
  onSwitch,
  streaming,
  onSend,
  onStop,
  conv,
  onToggleMemory,
  onToggleKnowledge,
}: {
  models: { name: string; path: string }[];
  loadedPath: string;
  runtimeState: string;
  onSwitch: (path: string) => void;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  conv: any;
  onToggleMemory: () => void;
  onToggleKnowledge: () => void;
}) {
  const [text, setText] = useState('');
  const [toolsOn, setToolsOn] = useState(false);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const setBrain = useBrainStore((s) => s.setBrain);
  const current = useBrainStore((s) => s.state);

  useEffect(() => {
    window.dawn.settings.get().then((s: any) => setToolsOn(!!s.toolsEnabled));
  }, []);

  // Resolve friendly DAWN names for the model dropdown (cached).
  useEffect(() => {
    if (models.length) resolveNames(models.map((m) => m.path)).then(setNameMap);
  }, [models]);

  const send = () => {
    const t = text.trim();
    if (!t || streaming) return;
    setText('');
    setBrain('THINKING', 'Thinking…');
    onSend(t);
  };

  const memOn = conv ? !!conv.use_memory : true;
  const ragOn = conv ? !!conv.use_rag : false;
  const switching = runtimeState === 'STARTING' || runtimeState === 'LOADING_MODEL' || runtimeState === 'STOPPING';
  const model = loadedPath ? loadedPath.split(/[\\/]/).pop() : '';

  async function toggleTools() {
    const v = !toolsOn;
    setToolsOn(v);
    await window.dawn.settings.save({ toolsEnabled: v });
  }

  return (
    <div className="relative border-t border-border bg-panel2/40 backdrop-blur-xl px-4 pt-2.5 pb-3">
      <div className="absolute left-0 right-0 top-0 hud-divider" />
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="panel-head w-auto after:hidden text-[10px] mr-1">Console</span>
        <div className="relative">
          <select
            value={loadedPath}
            onChange={(e) => onSwitch(e.target.value)}
            disabled={switching}
            title="Switch model — DAWN swaps it in the background (no restart needed)"
            className="font-mono text-[11px] rounded-lg pl-2.5 pr-6 py-1.5 bg-panel/80 border border-border text-ink outline-none focus:border-[var(--accent)] max-w-[210px] disabled:opacity-60 appearance-none"
          >
            {models.length === 0 ? <option value="">No models — install in Model Hub</option> : null}
            {!loadedPath && models.length ? <option value="">Pick a model…</option> : null}
            {models.map((m) => <option key={m.path} value={m.path} title={m.name}>{nameMap[baseName(m.path)] || m.name}</option>)}
          </select>
        </div>
        {switching ? <span className="text-[11px] text-neural-amber animate-pulseSoft font-mono">loading…</span> : null}
        <button onClick={onToggleMemory} disabled={!conv} className={`chip ${memOn ? 'chip-on' : ''} disabled:opacity-40`} title="Use durable memories">
          <Brain size={12} /> Memory
        </button>
        <button onClick={onToggleKnowledge} disabled={!conv} className={`chip ${ragOn ? 'chip-on' : ''} disabled:opacity-40`} title="Use indexed local folders">
          <FileText size={12} /> Knowledge
        </button>
        <button onClick={toggleTools} className={`chip ${toolsOn ? 'chip-on' : ''}`} title="Allow PowerShell / internet / file tools">
          <Terminal size={12} /> Tools
        </button>
      </div>

      <div className="console-field flex items-end gap-2 rounded-2xl border border-border bg-bg/70 pl-3 pr-2 py-1.5">
        <span className="console-caret font-mono text-sm select-none pb-2.5 pt-0.5">›_</span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (current === 'IDLE') setBrain('LISTENING', 'Taking in your message…');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={model ? 'Message DAWN…  (Enter to send · Shift+Enter newline)' : 'Power DAWN on and load a model to begin.'}
          className="flex-1 resize-none bg-transparent border-0 py-2 text-sm outline-none max-h-40 placeholder:text-faint"
        />
        <button className="p-2 text-faint cursor-not-allowed self-center" title="Attach file (soon)" disabled>
          <Paperclip size={17} />
        </button>
        <button className="p-2 text-faint cursor-not-allowed self-center" title="Voice input (soon)" disabled>
          <Mic size={17} />
        </button>
        {streaming ? (
          <Button variant="danger" onClick={onStop} className="h-10 self-center"><Square size={15} /> Stop</Button>
        ) : (
          <Button variant="primary" onClick={send} disabled={!text.trim()} className="h-10 self-center"><Send size={15} /> Send</Button>
        )}
      </div>
    </div>
  );
}
