import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Camera, ScanText, Snowflake, Trash2, Cpu, Aperture, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/button';
import { useBrainStore } from '../state/brainStore';

/**
 * Live Vision — DAWN's local webcam perception page. Privacy-first: the camera
 * is OFF until you turn it on, the OS camera light is the source of truth, and
 * nothing leaves the machine. The Python sidecar owns the camera and draws the
 * detection boxes onto the MJPEG we display here.
 */
export default function LiveVisionView() {
  const setBrain = useBrainStore((s) => s.setBrain);
  const [avail, setAvail] = useState<{ available: boolean; hasModel: boolean } | null>(null);
  const [cameras, setCameras] = useState<{ index: number; name: string }[]>([]);
  const [cfg, setCfg] = useState<any>(null);
  const [device, setDevice] = useState(0);
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<any>({});
  const [dets, setDets] = useState<any[]>([]);
  const [ctx, setCtx] = useState<any>({});
  const [ocr, setOcr] = useState<string>('');
  const [busy, setBusy] = useState('');
  const [frozen, setFrozen] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [streamKey, setStreamKey] = useState(0);
  const [msg, setMsg] = useState('');
  const pollRef = useRef<any>(null);

  useEffect(() => {
    window.dawn.vision.available().then(setAvail);
    window.dawn.settings.get().then((c: any) => { setCfg(c); setDevice(c.visionDevice ?? 0); });
    window.dawn.vision.cameras().then((c: any) => Array.isArray(c) && setCameras(c)).catch(() => {});
    return () => { stopPolling(); window.dawn.vision.stop().catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }
  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const [st, d, c] = await Promise.all([
        window.dawn.vision.status(),
        window.dawn.vision.detections(),
        window.dawn.vision.context(),
      ]);
      if (st) setStatus(st);
      if (d) setDets(d.objects || []);
      if (c) setCtx(c);
    }, 700);
  }

  async function startCamera() {
    setStarting(true); setMsg(''); setFrozen(null);
    await window.dawn.settings.save({ visionDevice: device, liveVisionEnabled: true });
    await window.dawn.vision.start();
    const full = await window.dawn.vision.status();
    setStarting(false);
    setStatus(full);
    if (!full || !full.running) {
      // No camera attached, in use, or blocked by Windows camera privacy.
      const err = full?.error || '';
      setMsg(
        /unavailable|could not open|backend/i.test(err)
          ? 'No camera detected. Connect a webcam, close any app using it, and allow camera access in Windows Privacy settings, then try again.'
          : (err || 'Could not start the camera.')
      );
      setBrain('IDLE');
      return;
    }
    setPreviewUrl(full.previewUrl || '');
    setStreamKey((k) => k + 1);
    setLive(true);
    setBrain('LOOKING', 'Watching the live camera…');
    startPolling();
  }

  async function stopCamera() {
    stopPolling();
    await window.dawn.vision.stop();
    setLive(false); setFrozen(null); setDets([]); setStatus({});
    setBrain('IDLE');
  }

  async function toggleFreeze() {
    if (frozen) { setFrozen(null); setStreamKey((k) => k + 1); startPolling(); return; }
    const url = await window.dawn.vision.frame();
    if (url) { setFrozen(url); stopPolling(); }
  }

  async function readText() {
    setBusy('ocr'); setOcr('');
    const r = await window.dawn.vision.ocr();
    setBusy('');
    setOcr(r && r.ok ? (r.text || '(no text found)') : `OCR error: ${r?.error || 'unavailable'}`);
  }

  async function snapshot() {
    setBusy('snap');
    const r = await window.dawn.vision.snapshot(true);
    setBusy('');
    setMsg(r?.ok ? `Snapshot saved: ${r.path}` : `Snapshot: ${r?.error || 'failed'}`);
  }

  async function enableSnapshots() {
    const next = await window.dawn.settings.save({ visionSaveSnapshots: !cfg?.visionSaveSnapshots });
    setCfg(next);
  }

  async function forget() {
    await window.dawn.vision.forget();
    setCtx({}); setOcr('');
    setMsg('Visual memory cleared.');
  }

  // ---- setup gate ----
  if (avail && !avail.available) {
    return (
      <div className="p-8 max-w-2xl mx-auto h-full overflow-y-auto">
        <h1 className="text-xl font-bold flex items-center gap-2"><Eye size={20} /> Live Vision</h1>
        <div className="glass p-5 mt-4">
          <p className="text-sm text-dim">
            Live Vision needs a one-time local setup (a small Python environment for the camera + detection models).
            It runs entirely offline — no cloud, no accounts.
          </p>
          <p className="text-xs text-faint mt-3">Run this once from the DAWN project folder:</p>
          <pre className="console-field mt-2 px-3 py-2 text-xs overflow-x-auto">powershell -ExecutionPolicy Bypass -File scripts/setup-vision.ps1</pre>
          <Button variant="default" className="mt-3" onClick={() => window.dawn.vision.available().then(setAvail)}>
            <RefreshCw size={15} /> Re-check
          </Button>
        </div>
      </div>
    );
  }

  const providers: string[] = status.providers || [];
  const onGpu = providers.some((p) => /dml|cuda/i.test(p));
  const objSummary = ctx.object_summary || '';

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between max-w-5xl mx-auto">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Eye size={20} /> Live Vision</h1>
          <p className="text-xs text-faint mt-0.5">Local real-time perception · nothing leaves this machine</p>
        </div>
        <div className="flex items-center gap-3">
          {live ? (
            <span className="chip-on inline-flex items-center gap-1.5 text-xs">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> CAMERA LIVE
            </span>
          ) : (
            <span className="chip inline-flex items-center gap-1.5 text-xs"><EyeOff size={13} /> Camera off</span>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 mt-4">
        {/* Preview */}
        <div className="glass hud-corners p-3">
          <div className="relative aspect-video bg-black/60 rounded-lg overflow-hidden flex items-center justify-center">
            {frozen ? (
              <img src={frozen} alt="frozen frame" className="w-full h-full object-contain" />
            ) : live && previewUrl ? (
              <img key={streamKey} src={`${previewUrl}?k=${streamKey}`} alt="live camera" className="w-full h-full object-contain" />
            ) : (
              <div className="text-center text-faint">
                <EyeOff size={40} className="mx-auto opacity-40" />
                <p className="text-sm mt-2">Camera is off</p>
                <p className="text-xs text-dim mt-1">Turn it on to see live detection.</p>
              </div>
            )}
            {frozen && <span className="absolute top-2 left-2 chip-on text-xs inline-flex items-center gap-1"><Snowflake size={12} /> Frozen</span>}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {!live ? (
              <Button variant="primary" onClick={startCamera} disabled={starting}>
                <Camera size={15} /> {starting ? 'Starting…' : 'Turn camera on'}
              </Button>
            ) : (
              <Button variant="default" onClick={stopCamera}><EyeOff size={15} /> Turn off</Button>
            )}
            <select
              value={device}
              onChange={(e) => setDevice(Number(e.target.value))}
              disabled={live}
              className="field-accent bg-bg/80 border border-border rounded-lg px-2 py-1.5 text-sm outline-none disabled:opacity-50"
            >
              {cameras.length === 0 && <option value={0}>Camera 0</option>}
              {cameras.map((c) => <option key={c.index} value={c.index}>{c.name || `Camera ${c.index}`}</option>)}
            </select>
            <div className="flex-1" />
            <Button variant="ghost" onClick={toggleFreeze} disabled={!live}><Snowflake size={15} /> {frozen ? 'Resume' : 'Freeze'}</Button>
            <Button variant="ghost" onClick={readText} disabled={!live || busy === 'ocr'}><ScanText size={15} /> {busy === 'ocr' ? 'Reading…' : 'Read text'}</Button>
            <Button variant="ghost" onClick={snapshot} disabled={!live || !cfg?.visionSaveSnapshots || busy === 'snap'}><Aperture size={15} /> Snapshot</Button>
          </div>

          {/* Stat strip */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-dim font-mono">
            <span className="hud-label">FPS <b className="text-ink">{status.fps ?? '—'}</b></span>
            <span className="hud-label">OBJECTS <b className="text-ink">{dets.length}</b></span>
            <span className="hud-label inline-flex items-center gap-1"><Cpu size={11} /> {onGpu ? 'GPU' : (providers.length ? 'CPU' : '—')}</span>
            <span className="hud-label">DETECTOR <b className={status.detector ? 'text-neural-green' : 'text-neural-amber'}>{status.detector ? 'on' : 'off'}</b></span>
          </div>
          {msg && <p className="text-xs text-dim mt-2">{msg}</p>}
        </div>

        {/* Right rail: detections + context */}
        <div className="space-y-4">
          <div className="glass p-4">
            <div className="panel-head mb-2">Detected now</div>
            {dets.length === 0 ? (
              <p className="text-xs text-faint">{live ? 'Nothing detected yet.' : 'Camera off.'}</p>
            ) : (
              <div className="space-y-1.5">
                {dets.slice(0, 12).map((d, i) => (
                  <div key={d.id ?? i} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate text-ink">{d.label}</span>
                    <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden">
                      <div className="h-full bg-neural-cyan" style={{ width: `${Math.round((d.conf || 0) * 100)}%` }} />
                    </div>
                    <span className="w-8 text-right text-faint">{Math.round((d.conf || 0) * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass p-4">
            <div className="panel-head mb-2">Scene</div>
            {objSummary ? <p className="text-xs text-ink">{objSummary}</p> : <p className="text-xs text-faint">—</p>}
            {ctx.scene && <p className="text-xs text-dim mt-2">{ctx.scene}</p>}
            {ocr && (
              <div className="mt-3">
                <div className="panel-head mb-1 flex items-center gap-1"><ScanText size={12} /> Text seen</div>
                <p className="text-xs text-ink whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{ocr}</p>
              </div>
            )}
            <button onClick={forget} className="text-xs text-faint hover:text-neural-amber inline-flex items-center gap-1 mt-3">
              <Trash2 size={12} /> Forget visual memory
            </button>
          </div>

          <div className="glass-soft p-3 text-xs text-dim leading-relaxed">
            <div className="flex items-center gap-1.5 text-ink mb-1"><ShieldCheck size={13} className="text-neural-green" /> Privacy</div>
            Camera is off until you turn it on. Frames are never saved unless you enable snapshots.
            <button onClick={enableSnapshots} className={`block mt-2 text-xs rounded-full px-2.5 py-0.5 border ${cfg?.visionSaveSnapshots ? 'border-neural-green/60 text-neural-green bg-neural-green/10' : 'border-border text-faint'}`}>
              Save snapshots: {cfg?.visionSaveSnapshots ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
