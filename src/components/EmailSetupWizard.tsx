import React, { useEffect, useState } from 'react';
import { Mail, X, Check, AlertTriangle, ExternalLink, Loader2, ArrowRight, ArrowLeft, ShieldCheck } from 'lucide-react';

/**
 * EmailSetupWizard — a guided, honest email setup flow over the existing email backend. Pick a
 * provider (Gmail/Outlook/iCloud/Yahoo/Custom), see exactly what credentials are needed (DAWN uses
 * app passwords — no OAuth, and it says so), test incoming and outgoing separately with plain-English
 * errors, then save. Credentials go ONLY into the encrypted Vault (createAccount requires an unlocked
 * session); if the vault is locked the save is blocked with a clear message. The password is never
 * logged or shown after save. Opened via the 'dawn:open-email-setup' event or the palette command.
 */

type Guide = {
  id: string; name: string; preset: string; appPasswordRequired: boolean; oauthSupported: boolean;
  imapHost: string; imapPort: number; imapSecurity: string; smtpHost: string; smtpPort: number; smtpSecurity: string;
  appPasswordUrl?: string; instructions: string[]; troubleshooting: string[];
};
type TestState = { state: 'idle' | 'testing' | 'ok' | 'fail'; error?: string };

export default function EmailSetupWizard() {
  const [open, setOpen] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [step, setStep] = useState(0);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [imapHost, setImapHost] = useState(''); const [smtpHost, setSmtpHost] = useState('');
  const [inTest, setInTest] = useState<TestState>({ state: 'idle' });
  const [outTest, setOutTest] = useState<TestState>({ state: 'idle' });
  const [saving, setSaving] = useState(false); const [saveErr, setSaveErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const openEvt = () => { setOpen(true); reset(); (window as any).dawn?.email?.providerGuides?.().then(setGuides).catch(() => setGuides([])); };
    window.addEventListener('dawn:open-email-setup', openEvt as any);
    return () => window.removeEventListener('dawn:open-email-setup', openEvt as any);
  }, []);

  const reset = () => { setStep(0); setGuide(null); setEmail(''); setPassword(''); setImapHost(''); setSmtpHost(''); setInTest({ state: 'idle' }); setOutTest({ state: 'idle' }); setSaveErr(null); setDone(false); };
  const close = () => setOpen(false);

  const cfg = () => {
    if (!guide) return {};
    const sslIn = guide.imapSecurity === 'SSL/TLS';
    const sslOut = guide.smtpSecurity === 'SSL/TLS';
    return {
      label: email, emailAddress: email, username: email, password,
      imapHost: guide.id === 'custom' ? imapHost : guide.imapHost, imapPort: guide.imapPort, imapSecure: sslIn,
      smtpHost: guide.id === 'custom' ? smtpHost : guide.smtpHost, smtpPort: guide.smtpPort, smtpSecure: sslOut, smtpStartTls: !sslOut,
    };
  };

  const testIn = async () => { setInTest({ state: 'testing' }); try { const r = await (window as any).dawn.email.testIncoming(cfg()); setInTest(r?.ok ? { state: 'ok' } : { state: 'fail', error: r?.error }); } catch (e: any) { setInTest({ state: 'fail', error: String(e?.message || e) }); } };
  const testOut = async () => { setOutTest({ state: 'testing' }); try { const r = await (window as any).dawn.email.testOutgoing(cfg()); setOutTest(r?.ok ? { state: 'ok' } : { state: 'fail', error: r?.error }); } catch (e: any) { setOutTest({ state: 'fail', error: String(e?.message || e) }); } };
  const save = async () => {
    setSaving(true); setSaveErr(null);
    try { const r = await (window as any).dawn.email.createAccount(cfg()); if (r?.ok) { setDone(true); setStep(4); } else setSaveErr(r?.error || 'Could not save the account.'); }
    catch (e: any) { setSaveErr(String(e?.message || e)); }
    finally { setSaving(false); }
  };

  if (!open) return null;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const credsReady = emailValid && password.length > 0 && (guide?.id !== 'custom' || (imapHost && smtpHost));
  const StepDot = ({ i, label }: { i: number; label: string }) => (
    <div className={`flex items-center gap-1.5 text-[11px] ${step === i ? 'text-ink' : step > i ? 'text-neural-green' : 'text-faint'}`}>
      <span className={`w-4 h-4 rounded-full grid place-items-center text-[9px] border ${step > i ? 'bg-neural-green/20 border-neural-green/50' : step === i ? 'border-[var(--accent)]' : 'border-border'}`}>{step > i ? '✓' : i + 1}</span>{label}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4" onClick={close} role="dialog" aria-modal="true" aria-label="Email setup">
      <div className="glass w-full max-w-lg border border-border max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border sticky top-0 bg-bg/80 backdrop-blur">
          <Mail size={17} style={{ color: 'var(--accent)' }} aria-hidden />
          <span className="font-semibold text-sm">Email setup</span>
          <button onClick={close} aria-label="Close" className="ml-auto text-faint hover:text-ink"><X size={16} /></button>
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-b border-border/60 flex-wrap">
          <StepDot i={0} label="Provider" /><StepDot i={1} label="Credentials" /><StepDot i={2} label="Test" /><StepDot i={3} label="Finish" />
        </div>

        <div className="p-4">
          {/* honesty note */}
          <div className="text-[11px] text-faint flex items-start gap-1.5 mb-3"><ShieldCheck size={12} className="mt-0.5 shrink-0" aria-hidden />Your password is stored only in DAWN's encrypted Vault (Secure mode must be unlocked) and is never logged or sent to the model. DAWN does not use OAuth — use an app password.</div>

          {/* Step 0 — provider */}
          {step === 0 ? (
            <div className="space-y-2">
              {guides.map((g) => (
                <button key={g.id} onClick={() => { setGuide(g); setStep(1); }} className="w-full text-left rounded-lg border border-border bg-panel/20 hover:border-[var(--accent)]/50 p-3">
                  <div className="flex items-center gap-2"><span className="font-medium text-sm">{g.name}</span>{g.appPasswordRequired ? <span className="text-[10px] text-neural-amber">app password</span> : null}<span className="text-[10px] text-faint ml-auto">no OAuth</span></div>
                  <div className="text-[11px] text-faint mt-0.5">{g.id === 'custom' ? 'Enter your own IMAP/SMTP servers' : `IMAP ${g.imapHost}:${g.imapPort} · SMTP ${g.smtpHost}:${g.smtpPort}`}</div>
                </button>
              ))}
              {guides.length === 0 ? <div className="text-sm text-faint text-center py-4 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading providers…</div> : null}
            </div>
          ) : null}

          {/* Step 1 — credentials + instructions */}
          {step === 1 && guide ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-panel/20 p-3">
                <div className="text-xs font-medium mb-1">{guide.name} — how to get your app password</div>
                <ol className="text-[11px] text-dim list-decimal ml-4 space-y-0.5">{guide.instructions.map((s, i) => <li key={i}>{s}</li>)}</ol>
                {guide.appPasswordUrl ? <button onClick={() => (window as any).dawn.openExternal?.(guide.appPasswordUrl)} className="text-[11px] text-[var(--accent)] inline-flex items-center gap-1 mt-1.5">Open provider page <ExternalLink size={10} /></button> : null}
              </div>
              <label className="block text-xs text-dim">Email address
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="mt-1 w-full bg-bg/70 border border-border rounded-lg px-2.5 py-1.5 text-sm outline-none" />
              </label>
              {guide.id === 'custom' ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-dim">IMAP host<input value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.example.com" className="mt-1 w-full bg-bg/70 border border-border rounded-lg px-2.5 py-1.5 text-sm outline-none" /></label>
                  <label className="block text-xs text-dim">SMTP host<input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" className="mt-1 w-full bg-bg/70 border border-border rounded-lg px-2.5 py-1.5 text-sm outline-none" /></label>
                </div>
              ) : null}
              <label className="block text-xs text-dim">App password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="paste app password" className="mt-1 w-full bg-bg/70 border border-border rounded-lg px-2.5 py-1.5 text-sm outline-none" />
              </label>
              <div className="flex items-center gap-2">
                <button onClick={() => setStep(0)} className="px-3 py-1.5 rounded-lg border border-border text-sm text-faint inline-flex items-center gap-1"><ArrowLeft size={13} /> Back</button>
                <button disabled={!credsReady} onClick={() => setStep(2)} className="ml-auto px-3.5 py-1.5 rounded-lg border text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}>Test connection <ArrowRight size={13} /></button>
              </div>
            </div>
          ) : null}

          {/* Step 2 — separate incoming/outgoing tests */}
          {step === 2 && guide ? (
            <div className="space-y-3">
              <TestRow label="Incoming (IMAP)" sub={`${cfg().imapHost}:${guide.imapPort} · ${guide.imapSecurity}`} test={inTest} onTest={testIn} />
              <TestRow label="Outgoing (SMTP)" sub={`${cfg().smtpHost}:${guide.smtpPort} · ${guide.smtpSecurity}`} test={outTest} onTest={testOut} />
              {(inTest.state === 'fail' || outTest.state === 'fail') ? (
                <div className="text-[11px] text-faint">Troubleshooting: <ul className="list-disc ml-4 mt-1">{guide.troubleshooting.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
              ) : null}
              <div className="flex items-center gap-2">
                <button onClick={() => setStep(1)} className="px-3 py-1.5 rounded-lg border border-border text-sm text-faint inline-flex items-center gap-1"><ArrowLeft size={13} /> Back</button>
                <button onClick={() => setStep(3)} className="ml-auto px-3.5 py-1.5 rounded-lg border text-sm font-semibold inline-flex items-center gap-1" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}>Continue <ArrowRight size={13} /></button>
              </div>
            </div>
          ) : null}

          {/* Step 3 — finish/save */}
          {step === 3 && guide ? (
            <div className="space-y-3">
              <div className="text-sm">Save <b>{email}</b>? The app password is stored encrypted in your Vault. You can sync the inbox after saving.</div>
              {inTest.state !== 'ok' || outTest.state !== 'ok' ? <div className="text-[11px] text-neural-amber inline-flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5" /> One or both connection tests haven't passed. You can still save and fix settings later.</div> : null}
              {saveErr ? <div className="text-[11px] text-neural-red inline-flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5" /> {saveErr}{/locked|session|unlock/i.test(saveErr) ? ' — open Security and unlock Secure mode, then try again.' : ''}</div> : null}
              <div className="flex items-center gap-2">
                <button onClick={() => setStep(2)} className="px-3 py-1.5 rounded-lg border border-border text-sm text-faint inline-flex items-center gap-1"><ArrowLeft size={13} /> Back</button>
                <button disabled={saving} onClick={save} className="ml-auto px-3.5 py-1.5 rounded-lg border text-sm font-semibold disabled:opacity-60 inline-flex items-center gap-1" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}>{saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : 'Save account'}</button>
              </div>
            </div>
          ) : null}

          {/* Step 4 — done */}
          {step === 4 && done ? (
            <div className="text-center py-4">
              <div className="w-10 h-10 rounded-full bg-neural-green/15 grid place-items-center mx-auto mb-2"><Check size={20} className="text-neural-green" /></div>
              <div className="font-semibold">Account added</div>
              <div className="text-sm text-dim mt-1">Open the Email page to sync your inbox. Sending always asks for your approval.</div>
              <button onClick={close} className="mt-4 px-4 py-1.5 rounded-lg border text-sm font-semibold" style={{ color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.12)' }}>Done</button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TestRow({ label, sub, test, onTest }: { label: string; sub: string; test: TestState; onTest: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-panel/20 p-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0"><div className="text-sm font-medium">{label}</div><div className="text-[10px] text-faint truncate">{sub}</div></div>
        {test.state === 'ok' ? <span className="text-[11px] text-neural-green inline-flex items-center gap-1"><Check size={13} /> Connected</span> :
          test.state === 'testing' ? <span className="text-[11px] text-faint inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Testing…</span> :
            <button onClick={onTest} className="text-[11px] px-2.5 py-1 rounded-lg border border-border text-dim hover:text-ink">Test</button>}
      </div>
      {test.state === 'fail' ? <div className="text-[11px] text-neural-red mt-1.5 inline-flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {test.error}</div> : null}
    </div>
  );
}
