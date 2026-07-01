/**
 * research.ts — DAWN Deep Research mode orchestrator.
 *
 * Runs a multi-step research pipeline entirely on the local model + DAWN's
 * SSRF-guarded web tools, persists everything to SQLite, and streams live
 * progress to the renderer (and the 3D brain). Pipeline:
 *
 *   plan → generate queries → search → fetch/read sources (safely) →
 *   summarize each (untrusted) → score reliability → detect contradictions →
 *   synthesize a cited report → save.
 *
 * Safety: web access is OFF by default (settings.researchAllowWeb) and never
 * touches localhost/private IPs (tools.webFetch SSRF guard). Local mode reads
 * only already-indexed knowledge/vault. All retrieved text is passed through
 * the untrusted-data firewall before it reaches the model. Runs are cancellable
 * and pausable without freezing the UI.
 */
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import db from '../db';
import logger from '../logger';
import settings from '../settings';
import runtime from '../runtime';
import * as llama from '../llama';
import tools from '../tools';
import rag from '../rag';
import security from '../security/promptSecurity';
import live from '../workspace/liveHooks';
import core, { Depth, SourceMode, SourceForPrompt } from './researchCore';

const newId = () => crypto.randomUUID();
const now = () => Date.now();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
function abortError() { return new DOMException('cancelled', 'AbortError'); }
function isAbort(e: any) { return e && (e.name === 'AbortError' || /cancel/i.test(e.message || '')); }

type RunStatus = 'planning' | 'searching' | 'reading' | 'analyzing' | 'synthesizing' | 'citing' | 'done' | 'cancelled' | 'error' | 'paused';

interface RunControl {
  id: string;
  cancelled: boolean;
  paused: boolean;
  controller: AbortController;
  sourceCount: number;
}

export interface StartOptions {
  question: string;
  depth?: Depth;
  sourceMode?: SourceMode;
  model?: string; // '' | 'auto' = use the loaded model; a path = switch to it first
}

class ResearchService extends EventEmitter {
  private runs = new Map<string, RunControl>();

  // --- public API ----------------------------------------------------------

  /** Kick off a research run. Returns immediately with the runId; work continues async. */
  start(opts: StartOptions): { ok: boolean; runId?: string; error?: string } {
    const question = String(opts?.question || '').trim();
    if (!question) return { ok: false, error: 'Enter a research question.' };
    const depth = (opts.depth || 'standard') as Depth;
    const sourceMode = (opts.sourceMode || 'both') as SourceMode;
    const model = opts.model || 'auto';

    const id = newId();
    db.run(
      'INSERT INTO research_runs (id,question,depth,source_mode,model,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, question, depth, sourceMode, model, 'planning', now(), now()]
    );
    live.register('research_run', id, question, 'research'); // live workspace registration (the user's own question — never fetched web content)
    const control: RunControl = { id, cancelled: false, paused: false, controller: new AbortController(), sourceCount: 0 };
    this.runs.set(id, control);
    logger.info('research', `Run ${id.slice(0, 8)} started: "${question.slice(0, 80)}" (${depth}/${sourceMode})`);

    // fire-and-forget; never throw to the caller
    this.pipeline(id, { question, depth, sourceMode, model }, control).catch((e) => {
      logger.error('research', `Run ${id.slice(0, 8)} crashed: ${e?.message || e}`);
      this.fail(id, e?.message || String(e));
    });
    return { ok: true, runId: id };
  }

  cancel(runId: string): boolean {
    const c = this.runs.get(runId);
    if (!c) return false;
    c.cancelled = true;
    c.paused = false;
    try { c.controller.abort(); } catch { /* */ }
    logger.info('research', `Run ${runId.slice(0, 8)} cancel requested`);
    return true;
  }

  pause(runId: string): boolean {
    const c = this.runs.get(runId);
    if (!c || c.cancelled) return false;
    c.paused = true;
    this.setStatus(runId, 'paused');
    this.emitProgress(runId, { status: 'paused', phase: 'pause', brain: 'IDLE', message: 'Paused.' });
    return true;
  }

  resume(runId: string): boolean {
    const c = this.runs.get(runId);
    if (!c || c.cancelled) return false;
    c.paused = false;
    this.emitProgress(runId, { status: 'reading', phase: 'resume', brain: 'THINKING', message: 'Resumed.' });
    return true;
  }

  list() {
    return db.all(
      'SELECT id,question,depth,source_mode,model,status,report_id,created_at,updated_at,finished_at,error FROM research_runs ORDER BY created_at DESC LIMIT 200'
    );
  }
  get(runId: string) {
    const run = db.get('SELECT * FROM research_runs WHERE id=?', [runId]);
    if (!run) return null;
    return {
      run,
      steps: db.all('SELECT * FROM research_steps WHERE run_id=? ORDER BY idx ASC', [runId]),
      sources: db.all('SELECT * FROM research_sources WHERE run_id=? ORDER BY position ASC', [runId]),
      findings: db.all('SELECT * FROM research_findings WHERE run_id=? ORDER BY created_at ASC', [runId]),
      report: db.get('SELECT * FROM research_reports WHERE run_id=? ORDER BY created_at DESC LIMIT 1', [runId]),
      running: this.runs.has(runId) && !this.runs.get(runId)!.cancelled,
    };
  }
  getReport(runId: string) {
    return db.get('SELECT * FROM research_reports WHERE run_id=? ORDER BY created_at DESC LIMIT 1', [runId]);
  }
  delete(runId: string): boolean {
    this.cancel(runId);
    for (const t of ['research_runs', 'research_steps', 'research_sources', 'research_findings', 'research_reports']) {
      db.run(`DELETE FROM ${t} WHERE ${t === 'research_runs' ? 'id' : 'run_id'}=?`, [runId]);
    }
    return true;
  }

  /** Export a finished report as Markdown or a standalone HTML document. */
  export(runId: string, format: 'md' | 'html'): { ok: boolean; filename?: string; content?: string; error?: string } {
    const rep: any = this.getReport(runId);
    const run: any = db.get('SELECT * FROM research_runs WHERE id=?', [runId]);
    if (!rep || !run) return { ok: false, error: 'No report for this run yet.' };
    const safe = String(run.question || 'research').replace(/[^a-z0-9]+/gi, '-').slice(0, 60).replace(/^-|-$/g, '');
    if (format === 'html') {
      const html = rep.content_html || core.reportHtmlDocument(rep.title || run.question, rep.content_md || '');
      return { ok: true, filename: `dawn-research-${safe}.html`, content: html };
    }
    return { ok: true, filename: `dawn-research-${safe}.md`, content: rep.content_md || '' };
  }

  // --- pipeline ------------------------------------------------------------

  private async pipeline(runId: string, opts: Required<StartOptions>, c: RunControl) {
    const cfg = core.depthConfig(opts.depth);
    const maxSources = settings.get().researchMaxSources > 0 ? settings.get().researchMaxSources : cfg.maxSources;
    const wantsWeb = opts.sourceMode === 'web' || opts.sourceMode === 'both';
    const wantsLocal = opts.sourceMode === 'local' || opts.sourceMode === 'both';
    let stepIdx = 0;
    const step = (phase: string, status: string, title: string, detail = '') => {
      db.run('INSERT INTO research_steps (id,run_id,idx,phase,status,title,detail,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [newId(), runId, stepIdx++, phase, status, title, detail, now()]);
      this.emitProgress(runId, { phase, status: status as any, brain: brainFor(phase), message: title, step: { idx: stepIdx, phase, status, title, detail } });
    };

    db.run('UPDATE research_runs SET started_at=?, updated_at=? WHERE id=?', [now(), now(), runId]);

    // 0. Guard: web access policy
    if (wantsWeb && !settings.get().researchAllowWeb) {
      if (opts.sourceMode === 'web') {
        return this.fail(runId, 'Web research is turned off. Enable it in Settings → Research (or choose "Local knowledge only").');
      }
      step('plan', 'warning', 'Web research is off — using local knowledge only.', 'Enable web in Settings → Research.');
    }
    const useWeb = wantsWeb && settings.get().researchAllowWeb;

    // 0b. Ensure a local model is loaded/ready (no cloud).
    try {
      await this.ensureModel(opts.model, c);
    } catch (e: any) {
      return this.fail(runId, isAbort(e) ? 'Cancelled.' : (e.message || 'Model not ready.'));
    }
    if (c.cancelled) return this.markCancelled(runId);

    // 1. PLAN
    this.setStatus(runId, 'planning');
    step('plan', 'running', 'Creating a research plan…');
    let plan = `Investigate: ${opts.question}`;
    let queries: string[] = [opts.question];
    try {
      const planOut = await this.ask(core.buildPlanMessages(opts.question, opts.depth, opts.sourceMode), c, { temperature: 0.4, max_tokens: 700 });
      plan = core.parsePlan(planOut, opts.question);
      queries = core.parseQueries(planOut, opts.question, cfg.queries);
    } catch (e: any) {
      if (isAbort(e)) return this.markCancelled(runId);
      logger.warn('research', `plan fallback: ${e.message}`);
    }
    db.run('UPDATE research_runs SET plan=?, updated_at=? WHERE id=?', [plan, now(), runId]);
    step('plan', 'done', 'Research plan ready', plan);
    step('query', 'done', `${queries.length} search ${queries.length === 1 ? 'query' : 'queries'}`, queries.join(' · '));
    await this.gate(c, runId);

    // 2. GATHER candidate sources
    interface Cand { url?: string; title: string; snippet?: string; sourceType: string; ref?: string; text?: string }
    const candidates: Cand[] = [];
    const seen = new Set<string>();

    if (useWeb) {
      this.setStatus(runId, 'searching');
      for (const q of queries) {
        if (c.cancelled) return this.markCancelled(runId);
        await this.gate(c, runId);
        step('search', 'running', `Searching: ${q}`);
        try {
          const results = await tools.webSearch(q, cfg.perQuery);
          for (const r of results) {
            const key = core.domainOf(r.url) + '|' + (r.title || '').toLowerCase().slice(0, 40);
            if (!r.url || seen.has(key) || core.domainOf(r.url) === '') continue;
            seen.add(key);
            candidates.push({ url: r.url, title: r.title || r.url, snippet: r.snippet, sourceType: 'web' });
          }
          step('search', 'done', `Found ${results.length} result${results.length === 1 ? '' : 's'} for "${q}"`);
        } catch (e: any) {
          step('search', 'error', `Search failed for "${q}"`, e.message || String(e));
        }
      }
    }

    if (wantsLocal) {
      this.setStatus(runId, 'reading');
      step('local', 'running', 'Searching your local knowledge…');
      try {
        const chunks = await rag.retrieve(opts.question).catch(() => [] as any[]);
        for (const ch of (chunks || [])) {
          candidates.push({ title: ch.name || 'Local file', sourceType: 'local_file', ref: ch.path, text: ch.content });
        }
        step('local', 'done', `Found ${(chunks || []).length} local passage(s)`);
      } catch (e: any) {
        step('local', 'error', 'Local knowledge search failed', e.message || String(e));
      }
      // Obsidian vault (optional, only if indexed)
      try {
        const vaultIndex = require('../vaultIndex').default;
        const notes = await vaultIndex.search(opts.question).catch(() => [] as any[]);
        for (const n of (notes || [])) {
          candidates.push({ title: (n.title || 'Note') + (n.heading ? ' › ' + n.heading : ''), sourceType: 'vault', ref: n.path, text: n.content });
        }
        if ((notes || []).length) step('local', 'done', `Found ${(notes || []).length} vault note(s)`);
      } catch { /* vault not enabled/indexed */ }
    }

    if (!candidates.length) {
      step('read', 'warning', 'No sources found', useWeb ? 'Web search returned nothing reachable.' : 'No local knowledge matched. Index folders or enable web research.');
    }

    // 3. READ + SUMMARIZE (cap to maxSources; web first but keep some local in "both")
    this.setStatus(runId, 'reading');
    const ordered = orderCandidates(candidates, opts.sourceMode, maxSources);
    const summaries: { sourceId: string; label: string; summary: string; ref?: string; url?: string; reliability: number; sourceType: string }[] = [];
    let pos = 0;
    for (const cand of ordered) {
      if (c.cancelled) return this.markCancelled(runId);
      await this.gate(c, runId);
      pos++;
      const label = cand.title;
      step(cand.sourceType === 'web' ? 'fetch' : 'read', 'running', `Reading [${pos}/${ordered.length}] ${truncate(label, 60)}`, cand.url || cand.ref || '');
      this.emitProgress(runId, { phase: 'fetch', status: 'reading', brain: cand.sourceType === 'web' ? 'SEARCHING_WEB' : 'READING_LOCAL_FILES', message: `Reading ${truncate(label, 50)}`, percent: Math.round((pos / ordered.length) * 70) });

      let text = cand.text || '';
      let fetchErr = '';
      let finalUrl = cand.url;
      if (cand.sourceType === 'web' && cand.url) {
        try {
          const r = await this.fetchCancellable(cand.url, c);
          if (r.ok) { text = r.text || ''; finalUrl = r.url || cand.url; if (r.title) cand.title = r.title; }
          else fetchErr = r.error || 'fetch failed';
        } catch (e: any) {
          if (isAbort(e) && c.cancelled) return this.markCancelled(runId);
          fetchErr = e.message || 'fetch failed';
        }
      }

      const sourceId = newId();
      const reliability = core.scoreReliability(finalUrl || '', text, cand.sourceType);
      const citation = `[${summaries.length + 1}]`;

      if (fetchErr || !text || text.length < 80) {
        db.run(
          'INSERT INTO research_sources (id,run_id,url,title,domain,reliability,reliability_score,used_at,fetched_at,content_hash,excerpt,summary,source_type,citation_label,local_ref,status,error,position,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [sourceId, runId, finalUrl || null, cand.title, core.domainOf(finalUrl || ''), reliability, reliability, now(), now(), '', (text || '').slice(0, 280), '', cand.sourceType, '', cand.ref || null, 'error', fetchErr || 'empty/too short', pos, '{}']
        );
        step(cand.sourceType === 'web' ? 'fetch' : 'read', 'error', `Could not read ${truncate(label, 50)}`, fetchErr || 'empty content');
        this.emitProgress(runId, { phase: 'fetch', status: 'reading', brain: 'THINKING', message: `Skipped ${truncate(label, 40)}: ${fetchErr || 'empty'}`, source: sourceRow(sourceId, cand.title, finalUrl, cand.sourceType, reliability, 'error', fetchErr) });
        continue;
      }

      // summarize (untrusted)
      let summary = '';
      let claims: string[] = [];
      let injection = false;
      try {
        security.inspect(label, text, cand.sourceType === 'web' ? 'web' : 'file', runId);
        const out = await this.ask(core.buildSummaryMessages(opts.question, label, text, finalUrl || cand.ref, cfg.summarizeChars), c, { temperature: 0.2, max_tokens: 500 });
        const j = core.extractJson<any>(out);
        summary = (j?.summary && String(j.summary)) || firstSentences(out, 600);
        claims = Array.isArray(j?.claims) ? j.claims.map((x: any) => String(x)).slice(0, 8) : [];
        injection = !!j?.injection_detected;
      } catch (e: any) {
        if (isAbort(e) && c.cancelled) return this.markCancelled(runId);
        summary = firstSentences(text, 500);
      }
      if (injection) {
        step('fetch', 'warning', `Prompt-injection attempt ignored in ${truncate(label, 40)}`, 'The source tried to give instructions; treated as evidence only.');
        logger.warn('research', `Injection attempt detected & neutralized in source: ${finalUrl || cand.ref}`);
      }

      db.run(
        'INSERT INTO research_sources (id,run_id,url,title,domain,reliability,reliability_score,used_at,fetched_at,content_hash,excerpt,summary,source_type,citation_label,local_ref,status,error,position,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [sourceId, runId, finalUrl || null, cand.title, core.domainOf(finalUrl || ''), reliability, reliability, now(), now(),
          core.contentHash(text), text.slice(0, 280), summary, cand.sourceType, citation, cand.ref || null, 'ok', injection ? 'injection_neutralized' : '', pos,
          JSON.stringify({ claims, injection })]
      );
      db.run('INSERT INTO research_findings (id,run_id,source_id,kind,claim,confidence,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [newId(), runId, sourceId, 'summary', summary, reliability, JSON.stringify({ claims }), now()]);

      summaries.push({ sourceId, label: cand.title, summary, ref: cand.ref, url: finalUrl, reliability, sourceType: cand.sourceType });
      c.sourceCount = summaries.length;
      step(cand.sourceType === 'web' ? 'fetch' : 'read', 'done', `Summarized ${truncate(label, 50)}`, `reliability ${(reliability * 100).toFixed(0)}%`);
      this.emitProgress(runId, { phase: 'summarize', status: 'reading', brain: 'THINKING', message: `Summarized ${truncate(label, 40)}`, source: sourceRow(sourceId, cand.title, finalUrl, cand.sourceType, reliability, 'ok', '', summary, citation) });
    }

    await this.gate(c, runId);
    if (c.cancelled) return this.markCancelled(runId);

    // 4. CONTRADICTIONS
    this.setStatus(runId, 'analyzing');
    const contradictions: string[] = [];
    if (summaries.length >= 2) {
      step('contradiction', 'running', 'Checking sources for contradictions…');
      this.emitProgress(runId, { phase: 'synthesize', status: 'analyzing', brain: 'SYNTHESIZING', message: 'Cross-checking sources…', percent: 78 });
      try {
        const out = await this.ask(core.buildContradictionMessages(opts.question, summaries.map(toPrompt)), c, { temperature: 0.2, max_tokens: 600 });
        const j = core.extractJson<any>(out);
        for (const ct of (j?.contradictions || [])) {
          const claim = String(ct?.claim || ct?.detail || '').trim();
          if (!claim) continue;
          const srcNums = Array.isArray(ct?.sources) ? ct.sources.join(', ') : '';
          contradictions.push(srcNums ? `${claim} (sources ${srcNums})` : claim);
          db.run('INSERT INTO research_findings (id,run_id,source_id,kind,claim,confidence,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)',
            [newId(), runId, null, 'contradiction', claim, 0.5, JSON.stringify({ sources: ct?.sources || [] }), now()]);
        }
        step('contradiction', 'done', contradictions.length ? `${contradictions.length} contradiction(s) noted` : 'No major contradictions found');
      } catch (e: any) {
        if (isAbort(e) && c.cancelled) return this.markCancelled(runId);
        step('contradiction', 'error', 'Contradiction check skipped', e.message || '');
      }
    }
    await this.gate(c, runId);

    // 5. SYNTHESIZE
    this.setStatus(runId, 'synthesizing');
    step('synthesize', 'running', 'Synthesizing the final report…');
    this.emitProgress(runId, { phase: 'synthesize', status: 'synthesizing', brain: 'SYNTHESIZING', message: 'Writing the report…', percent: 85 });
    let reportMd = '';
    try {
      if (summaries.length) {
        reportMd = await this.ask(core.buildSynthesisMessages(opts.question, summaries.map(toPrompt), contradictions), c, { temperature: 0.4, max_tokens: 1800 });
      } else {
        reportMd = `## Summary\nNo sources could be gathered for this question.\n\n## Bottom line\nTry enabling web research (Settings → Research) or indexing local folders, then run again.`;
      }
    } catch (e: any) {
      if (isAbort(e) && c.cancelled) return this.markCancelled(runId);
      return this.fail(runId, `Synthesis failed: ${e.message}`);
    }
    if (c.cancelled) return this.markCancelled(runId);

    // 6. CITE — append the trusted source list
    this.setStatus(runId, 'citing');
    step('cite', 'running', 'Attaching citations and sources…');
    this.emitProgress(runId, { phase: 'cite', status: 'citing', brain: 'CITING_SOURCES', message: 'Citing sources…', percent: 95 });
    const title = truncate(opts.question, 100);
    const fullMd = `# ${title}\n\n_DAWN Deep Research · ${opts.depth} · ${opts.sourceMode} · ${new Date().toLocaleString()}_\n\n` +
      core.appendSourceList(reportMd, summaries.map((s) => ({ label: s.label, url: s.url, ref: s.ref, reliability: s.reliability, sourceType: s.sourceType })));
    const html = core.reportHtmlDocument(title, fullMd);
    const reportId = newId();
    db.run('INSERT INTO research_reports (id,run_id,title,format,content_md,content_html,created_at) VALUES (?,?,?,?,?,?,?)',
      [reportId, runId, title, 'md', fullMd, html, now()]);
    db.run('UPDATE research_runs SET status=?, report_id=?, finished_at=?, updated_at=? WHERE id=?', ['done', reportId, now(), now(), runId]);
    step('cite', 'done', 'Report ready');

    // 7. grow the brain
    try { require('../graph').default.rebuild(); } catch (e: any) { logger.warn('research', `graph rebuild: ${e.message}`); }

    this.runs.delete(runId);
    this.emitProgress(runId, { status: 'done', phase: 'done', brain: 'IDLE', message: 'Research complete.', percent: 100, reportId });
    logger.info('research', `Run ${runId.slice(0, 8)} done — ${summaries.length} sources, report ${reportId.slice(0, 8)}`);
  }

  // --- helpers -------------------------------------------------------------

  private async ensureModel(model: string, c: RunControl) {
    if (!runtime.isInstalled()) throw new Error('The local runtime (llama-server) is not installed.');
    if (!model || model === 'auto') {
      if (!runtime.isReady()) throw new Error('Turn DAWN ON and load a model first (or pick a model in Research).');
      return;
    }
    const cur = settings.get().modelPath;
    if (model !== cur || !runtime.isReady()) {
      await runtime.switchModel(model);
    }
    const t0 = now();
    while (!runtime.isReady()) {
      if (c.cancelled) throw abortError();
      if (now() - t0 > 90000) throw new Error('The selected model did not become ready in time.');
      await delay(800);
    }
  }

  private async ask(messages: llama.ChatMsg[], c: RunControl, opts: { temperature?: number; max_tokens?: number } = {}): Promise<string> {
    if (c.cancelled) throw abortError();
    security.assertNoUntrustedSystemRole(messages); // wrapped source text must stay out of the system role
    const params: llama.SamplingParams = { temperature: opts.temperature ?? 0.3, top_p: 0.9, max_tokens: opts.max_tokens ?? 1024 };
    return llama.chat(runtime.baseUrl(), messages, params, c.controller.signal);
  }

  /** webFetch + responsive cancellation: stop waiting the moment the run is cancelled. */
  private fetchCancellable(url: string, c: RunControl): Promise<{ ok: boolean; url?: string; title?: string; text?: string; error?: string }> {
    const aborted = new Promise<never>((_, rej) => {
      if (c.controller.signal.aborted) return rej(abortError());
      c.controller.signal.addEventListener('abort', () => rej(abortError()), { once: true });
    });
    return Promise.race([tools.webFetch(url), aborted]);
  }

  /** Block while paused (without busy-spinning the CPU); throw if cancelled. */
  private async gate(c: RunControl, runId: string) {
    if (c.paused) this.setStatus(runId, 'paused');
    while (c.paused && !c.cancelled) await delay(300);
    if (c.cancelled) throw abortError();
  }

  private setStatus(runId: string, status: RunStatus) {
    db.run('UPDATE research_runs SET status=?, updated_at=? WHERE id=?', [status, now(), runId]);
  }

  private markCancelled(runId: string) {
    db.run('UPDATE research_runs SET status=?, finished_at=?, updated_at=? WHERE id=?', ['cancelled', now(), now(), runId]);
    this.runs.delete(runId);
    this.emitProgress(runId, { status: 'cancelled', phase: 'cancelled', brain: 'IDLE', message: 'Research cancelled.' });
    logger.info('research', `Run ${runId.slice(0, 8)} cancelled`);
  }

  private fail(runId: string, error: string) {
    db.run('UPDATE research_runs SET status=?, error=?, finished_at=?, updated_at=? WHERE id=?', ['error', error, now(), now(), runId]);
    try { db.run('INSERT INTO research_steps (id,run_id,idx,phase,status,title,detail,created_at) VALUES (?,?,?,?,?,?,?,?)', [newId(), runId, 999, 'error', 'error', 'Research failed', error, now()]); } catch { /* */ }
    this.runs.delete(runId);
    this.emitProgress(runId, { status: 'error', phase: 'error', brain: 'ERROR', message: error, error });
  }

  private emitProgress(runId: string, payload: any) {
    this.emit('progress', { runId, ts: now(), ...payload });
  }
}

// --- small pure helpers (module-local) -------------------------------------

function brainFor(phase: string): string {
  switch (phase) {
    case 'search': case 'fetch': return 'SEARCHING_WEB';
    case 'local': case 'read': return 'READING_LOCAL_FILES';
    case 'contradiction': case 'synthesize': return 'SYNTHESIZING';
    case 'cite': return 'CITING_SOURCES';
    case 'plan': case 'query': return 'THINKING';
    default: return 'THINKING';
  }
}
function toPrompt(s: { label: string; summary: string; ref?: string }): SourceForPrompt {
  return { label: s.label, summary: s.summary, ref: s.ref };
}
function orderCandidates(cands: { sourceType: string }[] | any[], mode: SourceMode, max: number) {
  if (mode === 'both') {
    const local = cands.filter((c: any) => c.sourceType !== 'web');
    const web = cands.filter((c: any) => c.sourceType === 'web');
    const localTake = Math.min(local.length, Math.max(1, Math.floor(max * 0.35)));
    return [...local.slice(0, localTake), ...web].slice(0, max);
  }
  return cands.slice(0, max);
}
function sourceRow(id: string, title: string, url: string | undefined, sourceType: string, reliability: number, status: string, error = '', summary = '', citation = '') {
  return { id, title, url, domain: core.domainOf(url || ''), source_type: sourceType, reliability, status, error, summary, citation_label: citation };
}
function truncate(s: string, n: number) { return (s || '').length > n ? s.slice(0, n - 1) + '…' : (s || ''); }
function firstSentences(s: string, n: number) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

export default new ResearchService();
