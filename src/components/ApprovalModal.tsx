import React, { useEffect, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';

/**
 * ApprovalModal — global approval gate for risky tool calls coming from the Tool Execution
 * Gateway. Shows the tool, risk, requested permission, why approval is needed, a redacted
 * input preview, and any PromptSecurity warning. Allow once / Deny, plus an optional
 * "always allow" only for medium-or-lower, non-restricted tools.
 */
const riskColor: any = { safe: 'text-neural-green', low: 'text-neural-green', medium: 'text-neural-amber', high: 'text-neural-red', critical: 'text-neural-red' };

export default function ApprovalModal() {
  const [queue, setQueue] = useState<any[]>([]);
  useEffect(() => window.dawn.tools.onApproval((req: any) => setQueue((q) => [...q, req])), []);
  const req = queue[0];
  if (!req) return null;

  const respond = (decision: string) => {
    window.dawn.tools.approvalResponse(req.id, decision);
    setQueue((q) => q.slice(1));
  };
  const critical = req.riskLevel === 'critical';
  const suspicious = req.promptSeverity === 'medium' || req.promptSeverity === 'high';

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4">
      <div className={`glass w-full max-w-md p-5 border ${critical ? 'border-neural-red/60' : 'border-border'}`}>
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert size={18} className={riskColor[req.riskLevel] || 'text-neural-amber'} />
          <span className="font-semibold">Approve tool: {req.toolName}</span>
          <span className={`ml-auto text-[11px] font-mono uppercase ${riskColor[req.riskLevel]}`}>{req.riskLevel}</span>
        </div>
        <p className="text-xs text-dim mb-2">{req.description}</p>
        <div className="text-[11px] text-faint space-y-1 mb-3">
          <div>Permission: <span className="font-mono text-dim">{req.permission}</span></div>
          <div>Why: {req.reason}</div>
          {req.skillId ? <div>Requested by a skill.</div> : null}
        </div>
        {suspicious ? (
          <div className="text-[11px] text-neural-red bg-neural-red/10 border border-neural-red/30 rounded-lg p-2 mb-3">⚠ PromptSecurity flagged suspicious context ({req.promptSeverity}) associated with this call. Review carefully before allowing.</div>
        ) : null}
        <div className="text-[11px] text-faint mb-1">Input (redacted preview)</div>
        <div className="text-[11px] font-mono text-dim bg-bg border border-border rounded-lg p-2 mb-4 max-h-24 overflow-y-auto break-words">{req.inputPreview || '(none)'}</div>
        <div className="flex items-center gap-2">
          <button onClick={() => respond('allow_once')} className="px-3.5 py-1.5 rounded-lg border font-semibold text-sm" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}>Allow once</button>
          {req.canAlwaysAllow ? <button onClick={() => respond('always')} className="px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink text-sm">Always allow this tool</button> : null}
          <button onClick={() => respond('deny')} className="ml-auto px-3.5 py-1.5 rounded-lg border border-neural-red/50 text-neural-red font-semibold text-sm inline-flex items-center gap-1"><X size={14} /> Deny</button>
        </div>
      </div>
    </div>
  );
}
