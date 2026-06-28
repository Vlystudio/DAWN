import React from 'react';
import { Power, Loader2, AlertTriangle } from 'lucide-react';
import { useRuntimeStore } from '../state/runtimeStore';

/** The native DAWN ON/OFF switch — starts/stops the local llama.cpp runtime. */
export default function PowerSwitch({ onNeedsModel }: { onNeedsModel?: () => void }) {
  const status = useRuntimeStore((s) => s.status);
  const on = status.state === 'READY' || status.state === 'GENERATING';
  const busy = status.state === 'STARTING' || status.state === 'LOADING_MODEL' || status.state === 'STOPPING';

  const label =
    ({ OFF: 'Turn DAWN On', STARTING: 'Starting…', LOADING_MODEL: 'Loading model…', READY: 'DAWN is On', GENERATING: 'DAWN is On', ERROR: 'Retry', STOPPING: 'Stopping…' } as any)[status.state] ||
    status.state;
  const color = on ? '#34d399' : status.state === 'ERROR' ? '#ef4444' : busy ? '#f59e0b' : '#64748b';

  const click = () => {
    if (busy) return;
    if (on) {
      window.dawn.runtime.stop();
      return;
    }
    if (!status.hasModel) {
      onNeedsModel?.();
      return;
    }
    window.dawn.runtime.start();
  };

  return (
    <div className="px-3">
      <button
        onClick={click}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border transition"
        style={{ borderColor: color + '99', color, background: color + '1f' }}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
        {label}
      </button>
      <div className="mt-1.5 text-[10px] text-faint flex items-center justify-between">
        <span>
          {status.state} · {status.backend}
        </span>
        {status.model ? <span className="truncate max-w-[120px]">{status.model.split(/[\\/]/).pop()}</span> : null}
      </div>
      {!status.installed ? (
        <div className="mt-1 text-[10px] text-neural-amber flex items-start gap-1">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" /> Runtime not installed — add llama-server.exe (Runtime Settings).
        </div>
      ) : !status.hasModel ? (
        <div className="mt-1 text-[10px] text-neural-amber flex items-start gap-1">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" /> No model — import one in Model Manager.
        </div>
      ) : status.error && status.state === 'ERROR' ? (
        <div className="mt-1 text-[10px] text-neural-red leading-tight">{status.error}</div>
      ) : null}
    </div>
  );
}
