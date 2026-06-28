import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, RefreshCw, ShieldCheck, Globe, Copy } from 'lucide-react';
import { Button } from '../ui/button';
import { useBrainStore } from '../state/brainStore';
import { voice } from '../voice/voiceManager';

function Toggle({ label, desc, value, onChange }: any) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <div className="pr-4">
        <div className="text-sm">{label}</div>
        {desc ? <div className="text-xs text-faint mt-0.5">{desc}</div> : null}
      </div>
      <button onClick={() => onChange(!value)} className={`w-12 h-6 rounded-full relative shrink-0 transition ${value ? 'bg-neural-cyan/40' : 'bg-panel2'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${value ? 'left-6' : 'left-0.5'}`} />
      </button>
    </div>
  );
}
function Field({ label, children }: any) {
  return (
    <label className="block mb-3">
      <div className="text-xs text-dim mb-1.5">{label}</div>
      {children}
    </label>
  );
}
const inputCls = 'w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-neural-cyan';

/** Phone access — runs DAWN's full brain on your phone over LAN + Tailscale.
 *  Self-contained: applies immediately via the companion IPC (no Save needed). */
function PhoneAccessPanel() {
  const [st, setSt] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [port, setPort] = useState(8765);
  const [copied, setCopied] = useState('');

  const refresh = () => window.dawn.companion.status().then((x: any) => { setSt(x); setPort(x.port); });
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, []);
  if (!st) return null;

  const toggle = async () => { setBusy('toggle'); setSt(await window.dawn.companion.setEnabled(!st.enabled)); setBusy(''); };
  const regen = async () => { setBusy('pin'); setSt(await window.dawn.companion.regeneratePin()); setBusy(''); };
  const savePort = async () => { setBusy('port'); setSt(await window.dawn.companion.setPort(port)); setBusy(''); };
  const firewall = async () => { setBusy('fw'); await window.dawn.companion.firewall(); setBusy(''); setTimeout(refresh, 1500); };
  const copy = (u: string) => { navigator.clipboard?.writeText(u); setCopied(u); setTimeout(() => setCopied(''), 1200); };

  const urls: string[] = st.urls || [];
  const lanUrl = (st.lan && st.lan[0]) ? `http://${st.lan[0]}:${st.port}` : '';
  const tsUrl = st.tailscale ? `http://${st.tailscale}:${st.port}` : '';

  return (
    <div className="glass p-5 mb-4">
      <h3 className="font-semibold mb-3 flex items-center gap-2"><Smartphone size={16} /> Phone access</h3>
      <p className="text-xs text-dim mb-2">
        Use DAWN's full brain — memory, knowledge, Obsidian, Notion, tools — from your phone's browser.
        Stays on your network; PIN-protected; nothing goes to the cloud.
      </p>
      <Toggle label="Enable phone access" desc={st.running ? 'Server running.' : 'Off.'} value={st.enabled} onChange={toggle} />

      {st.enabled && (
        <div className="mt-3 space-y-4">
          {/* PIN */}
          <div className="flex items-center justify-between glass-soft px-4 py-3">
            <div>
              <div className="text-xs text-faint">PIN (enter on phone)</div>
              <div className="text-2xl font-mono tracking-[0.3em] text-neural-amber">{st.pin || '------'}</div>
            </div>
            <Button variant="ghost" onClick={regen} disabled={busy === 'pin'}><RefreshCw size={14} className={busy === 'pin' ? 'animate-spin' : ''} /> New PIN</Button>
          </div>

          {/* QR + URLs */}
          {urls.length === 0 ? (
            <p className="text-xs text-neural-amber">No network address found. Connect this PC to Wi-Fi/Ethernet (or start Tailscale).</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {lanUrl && (
                <div className="glass-soft p-3 flex items-center gap-3">
                  <div className="bg-[#f5f5f0] rounded-lg p-2 shrink-0"><QRCodeSVG value={lanUrl} size={104} bgColor="#f5f5f0" fgColor="#0a0a0f" level="M" /></div>
                  <div className="min-w-0">
                    <div className="text-xs text-ink font-medium">Home Wi-Fi</div>
                    <div className="text-[11px] text-dim break-all font-mono">{lanUrl}</div>
                    <button onClick={() => copy(lanUrl)} className="text-[11px] text-neural-cyan inline-flex items-center gap-1 mt-1"><Copy size={11} /> {copied === lanUrl ? 'Copied' : 'Copy'}</button>
                  </div>
                </div>
              )}
              {tsUrl && (
                <div className="glass-soft p-3 flex items-center gap-3">
                  <div className="bg-[#f5f5f0] rounded-lg p-2 shrink-0"><QRCodeSVG value={tsUrl} size={104} bgColor="#f5f5f0" fgColor="#0a0a0f" level="M" /></div>
                  <div className="min-w-0">
                    <div className="text-xs text-ink font-medium flex items-center gap-1"><Globe size={11} /> Remote (Tailscale)</div>
                    <div className="text-[11px] text-dim break-all font-mono">{tsUrl}</div>
                    <button onClick={() => copy(tsUrl)} className="text-[11px] text-neural-cyan inline-flex items-center gap-1 mt-1"><Copy size={11} /> {copied === tsUrl ? 'Copied' : 'Copy'}</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Port + firewall */}
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <div className="text-xs text-dim mb-1.5">Port</div>
              <input type="number" className={inputCls + ' w-28'} value={port} onChange={(e) => setPort(Number(e.target.value))} onBlur={savePort} />
            </div>
            <Button variant="default" onClick={firewall} disabled={busy === 'fw'}><ShieldCheck size={14} /> Allow through firewall</Button>
          </div>

          <div className="glass-soft p-3 text-xs text-dim leading-relaxed">
            <b className="text-ink">On your phone:</b> connect to the same Wi-Fi, scan the <b>Home Wi-Fi</b> QR (or type the address), enter the PIN. Tap your browser's <i>Add to Home Screen</i> for an app-like icon.
            <br /><br />
            <b className="text-ink">Away from home (Tailscale):</b> install <span className="text-neural-cyan cursor-pointer" onClick={() => window.dawn.openExternal('https://tailscale.com/download')}>Tailscale</span> on this PC <i>and</i> your phone, sign into the same account on both, then use the <b>Remote</b> QR/address from anywhere. No ports opened to the internet.
            {!tsUrl && <span className="block mt-1 text-faint">Tailscale not detected yet — its address will appear here once it's running.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Settings — connection, behavior, projects, brain/performance, transparency. */
export default function SettingsView() {
  const [s, setS] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [voices, setVoices] = useState<any[]>([]);
  const [piper, setPiper] = useState<any>({ piper: false, kokoro: false, piperVoices: [], kokoroVoices: [] });
  const [updMsg, setUpdMsg] = useState('');
  const loadPerf = useBrainStore((st) => st.loadPerf);

  useEffect(() => {
    window.dawn.settings.get().then(setS);
    window.dawn.voice.engine().then(setPiper);
    const load = () => setVoices((window.speechSynthesis?.getVoices() || []).map((v) => ({ name: v.name, lang: v.lang })));
    load();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = load;
    const off = window.dawn.updater.onStatus(({ status, info }: any) =>
      setUpdMsg(status === 'checking' ? 'Checking…' : status === 'none' ? 'You’re up to date.' : status === 'available' ? `Update found (v${info?.version})…` : status === 'ready' ? 'Update downloaded — restart to apply.' : status === 'error' ? 'No update feed configured.' : '')
    );
    return off;
  }, []);
  if (!s) return <div className="p-6 text-dim">Loading…</div>;

  const set = (k: string) => (v: any) => { setS((p: any) => ({ ...p, [k]: v })); setSaved(false); };
  const text = (k: string) => (e: any) => set(k)(e.target.value);

  const save = async () => {
    const patch = {
      ...s,
      fpsCap: Number(s.fpsCap) || 0,
      nodeLimit: Math.max(100, Number(s.nodeLimit) || 1500),
      projects: String(s._projectsText ?? s.projects.join('\n')).split('\n').map((x: string) => x.trim()).filter(Boolean),
    };
    delete patch._projectsText;
    const next = await window.dawn.settings.save(patch);
    setS(next);
    setSaved(true);
    loadPerf();
    voice.refresh(); // pick up engine/voice changes immediately
  };

  const projectsText = s._projectsText ?? (s.projects || []).join('\n');

  return (
    <div className="p-6 max-w-2xl mx-auto h-full overflow-y-auto">
      <h1 className="text-xl font-bold mb-1">Settings</h1>
      <p className="text-sm text-dim mb-5">All settings are stored locally. No secrets, nothing sent anywhere.</p>

      <div className="glass p-5 mb-4">
        <h3 className="font-semibold mb-3">Local runtime (llama.cpp)</h3>
        <Field label="Runtime executable path (blank = bundled resources/runtime/llama-server.exe)">
          <input className={inputCls} value={s.runtimeExePath} onChange={text('runtimeExePath')} placeholder="(auto)" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Port"><input type="number" className={inputCls} value={s.runtimePort} onChange={(e) => set('runtimePort')(Number(e.target.value))} /></Field>
          <Field label="Context length"><input type="number" className={inputCls} value={s.contextLength} onChange={(e) => set('contextLength')(Number(e.target.value))} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="CPU threads (0=auto)"><input type="number" className={inputCls} value={s.threads} onChange={(e) => set('threads')(Number(e.target.value))} /></Field>
          <Field label="GPU layers (-ngl)"><input type="number" className={inputCls} value={s.gpuLayers} onChange={(e) => set('gpuLayers')(Number(e.target.value))} /></Field>
          <Field label="Batch size"><input type="number" className={inputCls} value={s.batchSize} onChange={(e) => set('batchSize')(Number(e.target.value))} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Temperature"><input type="number" step="0.05" className={inputCls} value={s.temperature} onChange={(e) => set('temperature')(Number(e.target.value))} /></Field>
          <Field label="Top P"><input type="number" step="0.05" className={inputCls} value={s.topP} onChange={(e) => set('topP')(Number(e.target.value))} /></Field>
          <Field label="Max tokens"><input type="number" className={inputCls} value={s.maxTokens} onChange={(e) => set('maxTokens')(Number(e.target.value))} /></Field>
        </div>
        <Toggle label="Low VRAM mode" desc="Keep the model mostly off the GPU." value={s.lowVram} onChange={set('lowVram')} />
        <Toggle label="Auto-start runtime when DAWN opens" value={s.autoStartRuntime} onChange={set('autoStartRuntime')} />
        <p className="text-xs text-faint mt-2">Switch models in Model Manager. After changing runtime options, toggle the power switch off/on to apply.</p>
      </div>

      <div className="glass p-5 mb-4">
        <h3 className="font-semibold mb-3">🛠️ Tools (PowerShell &amp; Internet)</h3>
        <p className="text-xs text-dim mb-2">Let DAWN run commands and use the live web. Powerful and dual-use — off by default, on your own machine only.</p>
        <Toggle label="Enable tools" desc="Master switch for tool use in chat." value={s.toolsEnabled} onChange={set('toolsEnabled')} />
        <Toggle label="PowerShell" desc="Allow DAWN to run PowerShell commands on this PC." value={s.powershellEnabled} onChange={set('powershellEnabled')} />
        <Toggle label="Internet (search + fetch)" desc="Allow live web search and page reading." value={s.webEnabled} onChange={set('webEnabled')} />
        <Toggle label="Require approval before each tool runs" desc="Strongly recommended. You'll get an Approve/Deny prompt." value={s.toolApproval} onChange={set('toolApproval')} />
      </div>

      <div className="glass p-5 mb-4">
        <h3 className="font-semibold mb-3">🖥️ Computer Access (Files &amp; Downloads)</h3>
        <p className="text-xs text-dim mb-2">
          Let DAWN scan, organize, and download files on this PC. Reads work broadly; <b>changes are confined to your chosen scope</b> and never touch
          Windows, Program Files, or credential areas. Deletions go to the Recycle Bin and organizing is reversible.
        </p>
        <Toggle label="Enable file access" desc="Allow DAWN to scan and organize your files (in chat)." value={s.fileAgentEnabled} onChange={set('fileAgentEnabled')} />
        <Toggle label="Allow downloads" desc="DAWN can download files into a quarantine folder (never executed)." value={s.downloadEnabled} onChange={set('downloadEnabled')} />
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Where DAWN may make changes">
            <select className={inputCls} value={s.fileModifyScope} onChange={text('fileModifyScope')}>
              <option value="user">My user folders only (recommended)</option>
              <option value="anywhere">Anywhere except protected system areas</option>
            </select>
          </Field>
          <Field label="How it acts on changes">
            <select className={inputCls} value={s.fileAutonomy} onChange={text('fileAutonomy')}>
              <option value="confirm">Preview &amp; confirm each change (recommended)</option>
              <option value="auto">Auto with guardrails (confirm only risky)</option>
              <option value="full">Full autonomy (minimal prompts)</option>
            </select>
          </Field>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={() => window.dawn.fileAgent?.openDownloads()} className="text-xs px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink">Open downloads folder</button>
          <button onClick={async () => { const r = await window.dawn.fileAgent?.undo(); alert(r?.ok ? `Undid "${r.label}" — moved ${r.reversed} file(s) back.` : `Nothing to undo${r?.error ? ': ' + r.error : ''}.`); }} className="text-xs px-3 py-1.5 rounded-lg border border-border text-dim hover:text-ink">Undo last change</button>
        </div>
        <p className="text-xs text-faint mt-2">Tip: in chat, try "scan my Downloads folder" or "organize my Desktop by file type".</p>
      </div>

      <div className="glass p-5 mb-4">
        <h3 className="font-semibold mb-3">Behavior</h3>
        <Field label="Default system prompt"><textarea className={inputCls + ' resize-y min-h-[70px]'} value={s.defaultSystemPrompt} onChange={text('defaultSystemPrompt')} /></Field>
        <Toggle label="Memory enabled" desc="Use durable memories during chat." value={s.memoryEnabled} onChange={set('memoryEnabled')} />
        <Field label="Projects (one per line — seeds the brain's Projects region)">
          <textarea className={inputCls + ' resize-y min-h-[90px] font-mono text-xs'} value={projectsText} onChange={(e) => set('_projectsText')(e.target.value)} />
        </Field>
      </div>

      <div className="glass p-5 mb-4">
        <h3 className="font-semibold mb-3">🔊 Voice (local TTS)</h3>
        <p className="text-xs text-dim mb-2">DAWN speaks responses out loud, fully offline. <b>Kokoro</b> is the most human voice (24 kHz neural, British), <b>Piper</b> is the fast neural fallback, and Windows voices are the robotic last resort.</p>
        <Toggle label="Enable voice" desc="Speak responses (streaming, sentence by sentence)." value={s.voiceEnabled} onChange={set('voiceEnabled')} />
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Engine">
            <select className={inputCls} value={s.voiceEngine} onChange={text('voiceEngine')}>
              <option value="auto">Auto — best neural {(piper.kokoro || piper.piper) ? '✓' : ''}</option>
              <option value="kokoro" disabled={!piper.kokoro}>Kokoro — most human{piper.kokoro ? '' : ' — not installed'}</option>
              <option value="piper" disabled={!piper.piper}>Piper — neural (fast){piper.piper ? '' : ' — not installed'}</option>
              <option value="system">Windows voices (robotic)</option>
            </select>
          </Field>
          {(() => {
            const eng = s.voiceEngine;
            const useK = eng === 'kokoro' || (eng === 'auto' && piper.kokoro);
            const useP = eng === 'piper' || (eng === 'auto' && !piper.kokoro && piper.piper);
            if (useK) return (
              <Field label="Kokoro voice">
                <select className={inputCls} value={s.voiceModel} onChange={text('voiceModel')}>
                  <option value="">Auto (British male — George)</option>
                  {(piper.kokoroVoices || []).map((v: string) => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
            );
            if (useP) return (
              <Field label="Piper voice">
                <select className={inputCls} value={s.voiceModel} onChange={text('voiceModel')}>
                  <option value="">Auto (British male — alan)</option>
                  {(piper.piperVoices || []).map((v: string) => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
            );
            return (
              <Field label="Voice (Windows)">
                <select className={inputCls} value={s.voiceName} onChange={text('voiceName')}>
                  <option value="">Auto (prefer British male)</option>
                  {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                </select>
              </Field>
            );
          })()}
        </div>
        <Toggle label="Don't speak code blocks" desc="Skip code and tables when speaking." value={!s.speakCodeBlocks} onChange={(v: boolean) => set('speakCodeBlocks')(!v)} />
        <Toggle label="Startup greeting" value={s.startupGreeting} onChange={set('startupGreeting')} />
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Preset">
            <select className={inputCls} value={s.voicePreset} onChange={text('voicePreset')}>
              <option value="jarvis_inspired">Jarvis-inspired (British, calm)</option>
              <option value="calm_assistant">Calm assistant</option>
              <option value="fast_system">Fast system</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={`Rate ${s.voiceRate}`}><input type="range" min={0.5} max={1.5} step={0.02} value={s.voiceRate} onChange={(e) => set('voiceRate')(Number(e.target.value))} className="w-full" /></Field>
          <Field label={`Pitch ${s.voicePitch}`}><input type="range" min={0.5} max={1.5} step={0.02} value={s.voicePitch} onChange={(e) => set('voicePitch')(Number(e.target.value))} className="w-full" /></Field>
          <Field label={`Volume ${s.voiceVolume}`}><input type="range" min={0} max={1} step={0.05} value={s.voiceVolume} onChange={(e) => set('voiceVolume')(Number(e.target.value))} className="w-full" /></Field>
        </div>
      </div>

      <PhoneAccessPanel />

      <div className="glass p-5 mb-4">
        <h3 className="font-semibold mb-3">⬇️ Updates</h3>
        <Toggle label="Check for updates automatically" desc="DAWN updates in place from a local offline feed — no reinstall, nothing leaves your PC." value={s.autoCheckUpdates} onChange={set('autoCheckUpdates')} />
        <div className="flex items-center gap-3 mt-2">
          <Button variant="default" onClick={() => window.dawn.updater.check()}>Check now</Button>
          {updMsg ? <span className="text-xs text-dim">{updMsg}</span> : null}
        </div>
      </div>

      <div className="glass p-5 mb-4">
        <h3 className="font-semibold mb-3">AI Brain &amp; performance</h3>
        <Toggle label="3D brain (WebGL)" desc="Off = lightweight 2D core. Auto-falls back if WebGL is unavailable." value={s.brain3DEnabled} onChange={set('brain3DEnabled')} />
        <Toggle label="Low performance mode" desc="Fewer particles, no antialiasing, lower resolution." value={s.lowPerfMode} onChange={set('lowPerfMode')} />
        <Toggle label="Particles" desc="Neural particle cloud around the core." value={s.brainParticles} onChange={set('brainParticles')} />
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="FPS cap (0 = uncapped)"><input type="number" min={0} className={inputCls} value={s.fpsCap} onChange={(e) => set('fpsCap')(Number(e.target.value))} /></Field>
          <Field label="Max brain nodes"><input type="number" min={100} className={inputCls} value={s.nodeLimit} onChange={(e) => set('nodeLimit')(Number(e.target.value))} /></Field>
        </div>
      </div>

      <div className="glass p-4 mb-4 text-xs text-dim leading-relaxed border-l-2 border-neural-cyan/50">
        DAWN is a local AI system. It can appear responsive and "alive" through animation, memory and status changes,
        but it is not conscious or sentient. Everything runs on your computer; no chat or files are sent to any cloud service.
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save}>Save settings</Button>
        {saved ? <span className="text-neural-green text-sm">✓ Saved</span> : null}
      </div>
    </div>
  );
}
