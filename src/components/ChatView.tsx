import React, { useEffect, useRef, useState } from 'react';
import { RotateCw, Copy, Brain as BrainIcon, Volume2, VolumeX, Square, BookMarked, StickyNote, CheckSquare, FileText, ArrowRight, Link2 } from 'lucide-react';
import WorkspaceItemPicker from './WorkspaceItemPicker';
import Markdown from './Markdown';
import Composer from './Composer';
import { AttachmentThumb, AttachmentPreviewModal } from './ChatAttachments';
import AIBrainScene from '../brain/AIBrainScene';
import BrainBackdrop from '../brain/BrainBackdrop';
import { useBrainStore } from '../state/brainStore';
import { metaFor } from '../brain/BrainState';
import { StatusDot } from './hud';
import { voice } from '../voice/voiceManager';

/** Hide tool-call markup (```dawn-tool blocks / bare {"tool":…} JSON, even
 *  half-typed) from the LIVE stream so the user only sees prose. */
function stripToolText(t: string): string {
  return t
    .replace(/```dawn-tool[\s\S]*?```/gi, '')
    .replace(/```dawn-tool[\s\S]*$/i, '')
    .replace(/```(?:json)?\s*\{[\s\S]*?"tool"\s*:[\s\S]*?\}\s*```/gi, '')
    .replace(/^\s*\{[\s\S]*?"tool"\s*:[\s\S]*?\}\s*$/gm, '')
    .replace(/\{\s*"tool"\s*:[\s\S]*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/, '');
}

/** Chat Mode — streaming conversation with the live brain docked top-right. */
export default function ChatView({
  selectedId,
  setSelectedId,
  onConvChange,
  onOpenExplorer,
  onNav,
}: {
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  onConvChange: () => void;
  onOpenExplorer: () => void;
  onNav?: (view: string) => void;
}) {
  const [actMsg, setActMsg] = useState<{ id: string; text: string; route?: string } | null>(null);
  const [linkMsgId, setLinkMsgId] = useState<string | null>(null);
  const doMsgAction = async (messageId: string, p: Promise<any>, ok: string) => {
    try { const r = await p; setActMsg({ id: messageId, text: r?.ok ? ok : (r?.error || 'Action failed'), route: r?.ok ? r.route : undefined }); }
    catch (e: any) { setActMsg({ id: messageId, text: String(e?.message || e) }); }
    setTimeout(() => setActMsg((a) => (a && a.id === messageId ? null : a)), 7000);
  };
  const [conv, setConv] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [loadedPath, setLoadedPath] = useState('');
  const [rtState, setRtState] = useState('OFF');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<any[]>([]);
  const [verification, setVerification] = useState<any>(null);
  const [retrievalTrace, setRetrievalTrace] = useState<any>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [visionCap, setVisionCap] = useState<any>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const idRef = useRef<string | null>(null);
  const streamRef = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const setBrain = useBrainStore((s) => s.setBrain);
  const brainState = useBrainStore((s) => s.mock ?? s.state);

  useEffect(() => {
    idRef.current = selectedId;
  }, [selectedId]);

  const [toolReq, setToolReq] = useState<any>(null);
  const [voiceOn, setVoiceOn] = useState(false);

  useEffect(() => {
    voice.init();
    window.dawn.settings.get().then((s: any) => setVoiceOn(!!s.voiceEnabled));
    window.dawn.chatAttachments.capabilities().then(setVisionCap).catch(() => {});
    // Full list of installed models (for the switcher) + the currently loaded one.
    const refreshModels = () => window.dawn.models.list().then(setModels);
    const applyRt = (st: any) => { setLoadedPath(st?.model || ''); setRtState(st?.state || 'OFF'); };
    refreshModels();
    window.dawn.runtime.status().then(applyRt);
    const offRt = window.dawn.runtime.onUpdate((st: any) => { applyRt(st); refreshModels(); });

    const offTool = window.dawn.chat.onToolRequest((req: any) => {
      if (req.conversationId === idRef.current) setToolReq(req);
    });

    const offTok = window.dawn.chat.onToken(({ conversationId, content }: any) => {
      if (conversationId !== idRef.current) return;
      streamRef.current += content;
      setStreamText(streamRef.current);
      voice.feed(content);
    });
    const offDone = window.dawn.chat.onDone(async ({ conversationId, verification, retrieval }: any) => {
      if (conversationId !== idRef.current) return;
      voice.flush();
      setStreaming(false);
      streamRef.current = '';
      setStreamText('');
      setVerification(verification || null);
      setRetrievalTrace(retrieval || null);
      await loadConv(conversationId);
      onConvChange();
    });
    const offErr = window.dawn.chat.onError(({ conversationId, error }: any) => {
      if (conversationId !== idRef.current) return;
      setStreaming(false);
      streamRef.current = '';
      setStreamText('');
      setError(error);
    });
    return () => { offRt(); offTool(); offTok(); offDone(); offErr(); };
  }, []);

  function resolveTool(approved: boolean) {
    if (toolReq) window.dawn.chat.resolveTool(toolReq.callId, approved);
    setToolReq(null);
  }

  useEffect(() => {
    setDrafts([]);
    setAttachError('');
    if (selectedId) { loadConv(selectedId); refreshDrafts(selectedId); }
    else {
      setConv(null);
      setMessages([]);
    }
    setError('');
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  async function loadConv(id: string) {
    const { conversation, messages: msgs } = await window.dawn.conv.get(id);
    setConv(conversation);
    setMessages(msgs);
  }

  async function switchModel(path: string) {
    if (!path || path === loadedPath) return;
    setLoadedPath(path); // optimistic; runtime events confirm
    await window.dawn.runtime.switchModel(path);
  }

  async function ensureConv(): Promise<string> {
    if (idRef.current) return idRef.current;
    const c = await window.dawn.conv.create({});
    idRef.current = c.id;
    setSelectedId(c.id);
    setConv(c);
    setMessages([]);
    onConvChange();
    return c.id;
  }

  async function refreshDrafts(id: string) {
    try { setDrafts(await window.dawn.chatAttachments.listDraft(id)); } catch { /* */ }
  }
  async function addImageDataUrl(dataUrl: string, name?: string) {
    setAttachError('');
    const id = await ensureConv();
    const r = await window.dawn.chatAttachments.addFromClipboard(id, dataUrl, name);
    if (r?.ok) refreshDrafts(id);
    else if (r && !r.canceled) setAttachError(r.error || 'Could not attach that image.');
  }
  async function pickImage() {
    setAttachError('');
    const id = await ensureConv();
    const r = await window.dawn.chatAttachments.addFromFile(id);
    if (r?.ok) refreshDrafts(id);
    else if (r && !r.canceled) setAttachError(r.error || 'Could not attach that image.');
  }
  async function removeAttachment(aid: string) {
    await window.dawn.chatAttachments.removeDraft(aid);
    if (idRef.current) refreshDrafts(idRef.current);
    else setDrafts((d) => d.filter((x) => x.id !== aid));
  }

  async function onSend(text: string) {
    const id = await ensureConv();
    const attachmentIds = drafts.map((d) => d.id);
    setMessages((p) => [...p, { id: 'tmp' + Date.now(), role: 'user', content: text, attachments: drafts }]);
    setDrafts([]);
    setAttachError('');
    setVerification(null);
    setRetrievalTrace(null);
    setStreaming(true);
    streamRef.current = '';
    setStreamText('');
    setError('');
    await window.dawn.chat.send({ conversationId: id, content: text, attachmentIds });
  }

  function onStop() {
    if (idRef.current) window.dawn.chat.stop({ conversationId: idRef.current });
    voice.stop();
  }

  async function toggleVoice() {
    const v = !voiceOn;
    setVoiceOn(v);
    if (!v) voice.stop();
    await window.dawn.settings.save({ voiceEnabled: v });
    voice.refresh();
  }

  async function regenerate() {
    if (!idRef.current || streaming) return;
    setMessages((p) => {
      const c = [...p];
      for (let i = c.length - 1; i >= 0; i--) if (c[i].role === 'assistant') { c.splice(i, 1); break; }
      return c;
    });
    setStreaming(true);
    streamRef.current = '';
    setStreamText('');
    setBrain('THINKING', 'Thinking…');
    await window.dawn.chat.regenerate({ conversationId: idRef.current });
  }

  async function toggleMemory() {
    if (!idRef.current) return;
    setConv(await window.dawn.conv.update(idRef.current, { useMemory: !conv?.use_memory }));
  }
  async function toggleKnowledge() {
    if (!idRef.current) return;
    setConv(await window.dawn.conv.update(idRef.current, { useRag: !conv?.use_rag }));
  }

  const lastAssistant = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return i;
    return -1;
  })();

  return (
    <div className="relative flex flex-col h-full">
      {/* The living brain, faint, behind everything — its lobes fire with what DAWN does. */}
      <BrainBackdrop />
      {/* HUD status bar with docked brain */}
      <div className="relative z-10 hud-corners flex items-center justify-between px-5 py-3 border-b border-border bg-panel/30 backdrop-blur-sm">
        <div className="absolute left-0 right-0 bottom-0 hud-divider" />
        <div className="min-w-0 flex items-center gap-3">
          <StatusDot live={brainState !== 'OFF'} />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{conv?.title || 'New chat'}</div>
            <div className="hud-label mt-0.5 flex items-center gap-2">
              <span style={brainState !== 'OFF' ? { color: 'var(--accent)' } : undefined}>{metaFor(brainState).label}</span>
              <span className="text-faint">·</span>
              <span className="truncate max-w-[220px]">{loadedPath ? loadedPath.split(/[\\/]/).pop() : 'no model'}</span>
              <span className="text-faint">·</span>
              <span>local</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={async () => {
              if (!idRef.current) return;
              const r = await window.dawn.vault.saveConversation(idRef.current);
              alert(r.ok ? `Saved to Obsidian:\nDawn/${r.path}` : (r.error || 'Connect a vault in the Obsidian page first.'));
            }}
            title="Save this conversation to Obsidian"
            className="p-2 rounded-lg border border-border text-faint hover:text-ink"
          >
            <BookMarked size={16} />
          </button>
          <button
            onClick={toggleVoice}
            title={voiceOn ? 'Voice on — click to mute' : 'Voice off'}
            className={`p-2 rounded-lg border ${voiceOn ? 'border-neural-cyan/60 text-neural-cyan bg-neural-cyan/10' : 'border-border text-faint'}`}
          >
            {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          {voiceOn ? (
            <button onClick={() => voice.stop()} title="Stop speaking" className="p-2 rounded-lg border border-border text-faint hover:text-ink">
              <Square size={15} />
            </button>
          ) : null}
          <div className="relative hud-corners p-1 rounded-lg">
            <AIBrainScene size="sm" onClick={onOpenExplorer} />
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="relative z-10 flex-1 overflow-y-auto px-5 py-6">
        {messages.length === 0 && !streaming ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <h2 className="text-3xl font-bold tracking-[0.24em] accent-text">DAWN</h2>
            <div className="hud-label mt-2">{brainState === 'OFF' ? 'System dormant — power on to begin' : 'System ready — awaiting input'}</div>
            <p className="text-xs text-faint mt-3 max-w-sm">You're inside a living brain that grows from your memory, Obsidian &amp; Notion — its lobes light up as it works. Ask anything, or open <span className="accent-text cursor-pointer" onClick={onOpenExplorer}>Brain</span>.</p>
          </div>
        ) : null}

        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((m, i) => (
            <div key={m.id || i} className="animate-bootIn">
              <div className="hud-label mb-1.5 flex items-center gap-1.5">
                {m.role === 'user' ? 'You' : <><span className="inline-block w-1 h-1 rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 6px var(--accent)' }} /><span style={{ color: 'var(--accent)' }}>DAWN</span></>}
              </div>
              {m.role === 'user' ? (
                <div className="rounded-xl px-4 py-3 text-sm border border-border/70 border-l-2 bg-panel/30 backdrop-blur-sm" style={{ borderLeftColor: 'rgba(var(--accent-rgb),0.7)' }}>
                  {m.attachments?.length ? (
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {m.attachments.map((a: any) => <AttachmentThumb key={a.id} att={a} onOpen={() => setPreviewId(a.id)} />)}
                    </div>
                  ) : null}
                  {m.content ? <div className="whitespace-pre-wrap">{m.content}</div> : null}
                </div>
              ) : (
                <div className="pl-4 border-l-2" style={{ borderLeftColor: 'rgba(var(--accent-rgb),0.32)' }}>
                  <Markdown>{m.content}</Markdown>
                  {m.citations?.length ? (
                    <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-2 border-t border-dashed border-border/60">
                      <span className="hud-label">Sources</span>
                      {m.citations.map((c: any) => (
                        <span key={c.n} className="text-[10px] font-mono px-2 py-0.5 rounded-full border" style={{ background: 'rgba(var(--accent-rgb),0.1)', borderColor: 'rgba(var(--accent-rgb),0.35)', color: 'var(--accent)' }}>
                          {c.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {i === lastAssistant && verification ? (
                    <div className="mt-2 text-[11px]">
                      <button onClick={() => setVerifyOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-faint hover:text-ink" title={verification.method}>
                        <span className={verification.warning ? 'text-neural-amber' : 'text-neural-green'}>◈</span>
                        {verification.summary}
                        <span className="text-faint underline-offset-2 hover:underline">{verifyOpen ? 'hide' : 'details'}</span>
                      </button>
                      {verification.warning ? <div className="text-neural-amber mt-0.5">{verification.warning}</div> : null}
                      {verifyOpen ? (
                        <div className="mt-1.5 border-l-2 border-border pl-2 space-y-1">
                          {retrievalTrace ? (
                            <div className="text-faint">Retrieval: <span className="text-dim">{retrievalTrace.retrievalMode}</span>
                              {retrievalTrace.rerankMode && retrievalTrace.rerankMode !== 'disabled' ? <span> · rerank {retrievalTrace.rerankMode}</span> : null}
                              {retrievalTrace.rewriteMode && retrievalTrace.rewriteMode !== 'disabled' ? <span> · rewrite {retrievalTrace.rewriteMode}</span> : null}
                              {retrievalTrace.hydeMode && retrievalTrace.hydeMode !== 'disabled' ? <span> · HyDE {retrievalTrace.hydeMode}</span> : null}
                              {retrievalTrace.rewriteVariants?.length ? <span className="text-faint"> · variants: {retrievalTrace.rewriteVariants.slice(0, 3).join(' / ')}</span> : null}
                            </div>
                          ) : null}
                          <div className="text-faint">Grounding: {verification.mode === 'entailment' ? 'local-model entailment (falls back to lexical per claim)' : 'local lexical-overlap check'} against your retrieved sources — not an external judge. Groundedness {Math.round((verification.groundedness || 0) * 100)}%.</div>
                          {(verification.claims || []).map((c: any, k: number) => (
                            <div key={k} className="flex items-start gap-1.5">
                              <span className={c.support === 'supported' ? 'text-neural-green' : c.support === 'partially_supported' ? 'text-neural-cyan' : 'text-neural-amber'}>
                                {c.support === 'supported' ? '✓' : c.support === 'partially_supported' ? '≈' : '?'}
                              </span>
                              <span className="flex-1 text-dim">{c.claim}{c.source ? <span className="text-faint"> — {c.source}{c.stale ? ' (stale)' : ''}</span> : <span className="text-faint"> — no local source</span>}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex gap-2 mt-2 opacity-0 hover:opacity-100 transition-opacity">
                    <button className="text-xs text-faint hover:text-ink inline-flex items-center gap-1" onClick={() => navigator.clipboard.writeText(m.content)}>
                      <Copy size={12} /> Copy
                    </button>
                    <button className="text-xs text-faint hover:text-ink inline-flex items-center gap-1" onClick={() => voice.speakNow(m.content)}>
                      <Volume2 size={12} /> Read aloud
                    </button>
                    {i === lastAssistant && !streaming ? (
                      <button className="text-xs text-faint hover:text-ink inline-flex items-center gap-1" onClick={regenerate}>
                        <RotateCw size={12} /> Regenerate
                      </button>
                    ) : null}
                    <button className="text-xs text-faint hover:text-ink inline-flex items-center gap-1" onClick={() => doMsgAction(m.id, (window as any).dawn.chat.saveMessageAsNote(m.id), 'Saved as note')}>
                      <StickyNote size={12} /> Note
                    </button>
                    <button className="text-xs text-faint hover:text-ink inline-flex items-center gap-1" onClick={() => doMsgAction(m.id, (window as any).dawn.chat.createTaskFromMessage(m.id), 'Task created')}>
                      <CheckSquare size={12} /> Task
                    </button>
                    <button className="text-xs text-faint hover:text-ink inline-flex items-center gap-1" onClick={() => doMsgAction(m.id, (window as any).dawn.chat.createDocumentFromMessage(m.id), 'Document created')}>
                      <FileText size={12} /> Doc
                    </button>
                    <button className="text-xs text-faint hover:text-ink inline-flex items-center gap-1" onClick={() => doMsgAction(m.id, (window as any).dawn.chat.saveMessageAsMemory(m.id), 'Saved to memory')}>
                      <BrainIcon size={12} /> Remember
                    </button>
                    <button className="text-xs text-faint hover:text-ink inline-flex items-center gap-1" onClick={() => setLinkMsgId(m.id)}>
                      <Link2 size={12} /> Link
                    </button>
                  </div>
                  {actMsg && actMsg.id === m.id ? (
                    <div className="mt-1.5 text-[11px] text-neural-green inline-flex items-center gap-2">
                      {actMsg.text}
                      {actMsg.route && onNav ? <button onClick={() => onNav(actMsg.route!)} className="text-faint hover:text-ink inline-flex items-center gap-0.5 underline-offset-2 hover:underline">Open <ArrowRight size={10} /></button> : null}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}

          {streaming ? (
            <div>
              <div className="hud-label mb-1.5 flex items-center gap-1.5">
                <span className="inline-block w-1 h-1 rounded-full animate-pulseSoft" style={{ background: 'var(--accent)', boxShadow: '0 0 6px var(--accent)' }} />
                <span style={{ color: 'var(--accent)' }}>DAWN</span>
              </div>
              {(() => {
                const shown = stripToolText(streamText);
                return shown
                  ? <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed m-0">{shown}<span className="animate-pulseSoft" style={{ color: 'var(--accent)' }}>▍</span></pre>
                  : <span className="animate-pulseSoft" style={{ color: 'var(--accent)' }}>▍</span>;
              })()}
            </div>
          ) : null}

          {error ? <div className="text-sm text-neural-red bg-neural-red/10 border border-neural-red/40 rounded-lg px-3 py-2">⚠ {error}</div> : null}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="relative z-10">
        <Composer
          models={models}
          loadedPath={loadedPath}
          runtimeState={rtState}
          onSwitch={switchModel}
          streaming={streaming}
          onSend={onSend}
          onStop={onStop}
          conv={conv}
          onToggleMemory={toggleMemory}
          onToggleKnowledge={toggleKnowledge}
          draftAttachments={drafts}
          onAddImageDataUrl={addImageDataUrl}
          onPickImage={pickImage}
          onRemoveAttachment={removeAttachment}
          onOpenAttachment={setPreviewId}
          attachError={attachError}
          visionCap={visionCap}
        />
      </div>

      <AttachmentPreviewModal id={previewId} onClose={() => setPreviewId(null)} />


      {toolReq ? (
        <div className="fixed inset-0 z-[1500] grid place-items-center bg-bg/70 backdrop-blur-sm">
          <div className="glass hud-corners w-[560px] max-w-[92vw] p-5">
            <div className="text-xs uppercase tracking-wide text-neural-amber mb-1">Approve action</div>
            <div className="text-sm font-semibold mb-2">
              DAWN wants to run <span className="text-neural-cyan">{toolReq.tool}</span>
            </div>
            <pre className="bg-bg border border-border rounded-lg p-3 text-xs overflow-x-auto max-h-60 whitespace-pre-wrap">
              {toolReq.summary
                ? toolReq.summary
                : toolReq.tool === 'powershell'
                ? toolReq.args?.command
                : JSON.stringify(toolReq.args, null, 2)}
            </pre>
            <p className="text-xs text-faint mt-2">
              {toolReq.risk
                || (toolReq.tool === 'powershell'
                  ? 'This runs on your Windows PC. Review it carefully before approving.'
                  : 'This will access the live internet.')}
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => resolveTool(false)} className="px-4 py-2 rounded-lg text-sm border border-border text-dim hover:text-ink">Deny</button>
              <button onClick={() => resolveTool(true)} className="px-4 py-2 rounded-lg text-sm bg-neural-green/20 border border-neural-green/60 text-neural-green">Approve</button>
            </div>
          </div>
        </div>
      ) : null}

      <WorkspaceItemPicker
        open={!!linkMsgId}
        onClose={() => setLinkMsgId(null)}
        title="Link this reply to a workspace item"
        onPick={async (it) => { const id = linkMsgId; setLinkMsgId(null); if (id) doMsgAction(id, (window as any).dawn.chat.linkMessageItem(id, it.id, 'references'), `Linked to ${it.label}`); }}
      />
    </div>
  );
}
