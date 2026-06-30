/**
 * compare.ts — DAWN Model Arena. Runs the same prompt across 2–4 installed models
 * SEQUENTIALLY (one llama.cpp model loads at a time, for stability), captures
 * per-model metrics + output, optionally judges/synthesizes a winner, and saves the
 * whole comparison locally. The user's originally-loaded chat model is always
 * restored afterward (never silently destroyed).
 *
 * Future-ready: the run loop is abstracted behind runOne() so a parallel executor
 * (multiple runtime instances) can be slotted in later without touching callers.
 */
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import db from '../db';
import logger from '../logger';
import settings from '../settings';
import runtime from '../runtime';
import models from '../models';
import * as llama from '../llama';
import bench from './benchCore';
import { runModel, RunMetrics } from './runner';
import { parseModelId } from '../optimizer/modelMetadata';

const newId = () => crypto.randomUUID();
const now = () => Date.now();

export interface CompareOptions {
  prompt: string;
  systemPrompt?: string;
  modelPaths: string[];
  blind?: boolean;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  repeatPenalty?: number;
}

interface Control { id: string; cancelled: boolean; controller: AbortController; originalModel: string }

class CompareService extends EventEmitter {
  private active = new Map<string, Control>();

  start(opts: CompareOptions): { ok: boolean; runId?: string; error?: string } {
    const prompt = String(opts?.prompt || '').trim();
    if (!prompt) return { ok: false, error: 'Enter a prompt to compare.' };
    const paths = (opts.modelPaths || []).filter(Boolean);
    if (paths.length < 2) return { ok: false, error: 'Pick at least 2 models to compare.' };
    if (paths.length > 4) return { ok: false, error: 'Compare up to 4 models at a time.' };
    if (!runtime.isInstalled()) return { ok: false, error: 'The local runtime (llama-server) is not installed.' };

    const id = newId();
    const params = { temperature: opts.temperature ?? 0.7, top_p: opts.topP ?? 0.9, repeat_penalty: opts.repeatPenalty ?? 1.1, max_tokens: opts.maxTokens ?? 512 };
    db.run('INSERT INTO compare_runs (id,prompt,system_prompt,params_json,blind,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, prompt, opts.systemPrompt || '', JSON.stringify(params), opts.blind ? 1 : 0, 'running', now(), now()]);
    const ctrl: Control = { id, cancelled: false, controller: new AbortController(), originalModel: settings.get().modelPath || '' };
    this.active.set(id, ctrl);
    logger.info('compare', `Run ${id.slice(0, 8)} — ${paths.length} models`);

    this.pipeline(id, { ...opts, prompt, modelPaths: paths }, params, ctrl).catch((e) => {
      logger.error('compare', `Run ${id.slice(0, 8)} crashed: ${e?.message || e}`);
      db.run('UPDATE compare_runs SET status=?, updated_at=? WHERE id=?', ['error', now(), id]);
      this.emit('progress', { runId: id, phase: 'error', message: e?.message || String(e) });
      this.active.delete(id);
    });
    return { ok: true, runId: id };
  }

  cancel(runId: string): boolean {
    const c = this.active.get(runId);
    if (!c) return false;
    c.cancelled = true;
    try { c.controller.abort(); } catch { /* */ }
    return true;
  }

  private async pipeline(runId: string, opts: CompareOptions, params: any, c: Control) {
    const sysPrompt = opts.systemPrompt || settings.get().defaultSystemPrompt;
    const total = opts.modelPaths.length;

    for (let i = 0; i < total; i++) {
      if (c.cancelled) break;
      const modelPath = opts.modelPaths[i];
      const info = models.list().find((m) => m.path === modelPath);
      const name = info?.name || modelPath.split(/[\\/]/).pop() || modelPath;
      const label = bench.blindLabel(i);
      const outId = newId();
      db.run('INSERT INTO compare_outputs (id,run_id,position,label,model_path,model_name,quant,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [outId, runId, i, label, modelPath, name, info?.quant || parseModelId(name).quant, 'running', now()]);
      this.emit('progress', { runId, phase: 'model_start', position: i, label, modelName: opts.blind ? `Model ${label}` : name, total });

      const m = await this.runOne(modelPath, opts.prompt, sysPrompt, params, c, (delta) =>
        this.emit('progress', { runId, phase: 'token', position: i, label, delta }));

      const status = m.ok ? 'ok' : 'error';
      db.run(
        `UPDATE compare_outputs SET output=?, status=?, error=?, oom=?, load_ms=?, first_token_ms=?, total_ms=?, tokens_per_sec=?,
         prompt_tokens=?, completion_tokens=?, backend=?, gpu_layers=?, context_length=?, temperature=?, top_p=?, repeat_penalty=?, est_ram_gb=? WHERE id=?`,
        [m.text, status, m.error || '', m.oom ? 1 : 0, m.loadMs, m.firstTokenMs, m.totalMs, m.tokensPerSec,
          m.promptTokens, m.completionTokens, m.backend, m.gpuLayers, m.contextLength, m.temperature, m.topP, m.repeatPenalty, m.estRamGB, outId]);

      this.emit('progress', {
        runId, phase: 'model_done', position: i, label,
        modelName: opts.blind ? `Model ${label}` : name,
        metrics: publicMetrics(m), status, error: m.error, oom: m.oom,
      });
    }

    // Always restore the user's original chat model.
    await this.restore(c);

    db.run('UPDATE compare_runs SET status=?, updated_at=? WHERE id=?', [c.cancelled ? 'cancelled' : 'done', now(), runId]);
    try { require('../graph').default.rebuild(); } catch { /* */ }
    this.active.delete(runId);
    this.emit('progress', { runId, phase: c.cancelled ? 'cancelled' : 'done' });
    logger.info('compare', `Run ${runId.slice(0, 8)} ${c.cancelled ? 'cancelled' : 'done'}`);
  }

  /** Single-model executor (the seam a future parallel runner would replace). */
  private async runOne(modelPath: string, prompt: string, systemPrompt: string, params: any, c: Control, onToken: (d: string) => void): Promise<RunMetrics> {
    return runModel(modelPath, prompt, {
      systemPrompt, maxTokens: params.max_tokens, temperature: params.temperature, topP: params.top_p, repeatPenalty: params.repeat_penalty,
      onToken, signal: c.controller.signal,
    });
  }

  private async restore(c: Control) {
    if (c.originalModel && c.originalModel !== settings.get().modelPath) {
      this.emit('progress', { runId: c.id, phase: 'restoring' });
      try { await runtime.switchModel(c.originalModel); } catch (e: any) { logger.warn('compare', `restore failed: ${e.message}`); }
    }
  }

  /** Ask a judge model to compare the stored outputs and synthesize the best answer. */
  async judge(runId: string, judgeModel?: string): Promise<{ ok: boolean; error?: string; verdict?: any }> {
    const run: any = db.get('SELECT * FROM compare_runs WHERE id=?', [runId]);
    if (!run) return { ok: false, error: 'Run not found.' };
    const outs = db.all('SELECT * FROM compare_outputs WHERE run_id=? AND status=? ORDER BY position ASC', [runId, 'ok']);
    if (outs.length < 2) return { ok: false, error: 'Need at least 2 successful outputs to judge.' };

    const original = settings.get().modelPath || '';
    const judgePath = judgeModel && judgeModel !== 'auto' ? judgeModel : original;
    this.emit('progress', { runId, phase: 'judging' });
    try {
      if (judgePath && judgePath !== settings.get().modelPath) { await runtime.switchModel(judgePath); await waitReady(); }
      else if (!runtime.isReady()) return { ok: false, error: 'Turn DAWN ON and load a model to judge.' };

      const messages = bench.buildJudgeMessages(
        run.prompt,
        outs.map((o: any) => ({ label: o.label, modelName: o.model_name, text: o.output || '' })),
        !!run.blind
      );
      const raw = await llama.chat(runtime.baseUrl(), messages, { temperature: 0.2, max_tokens: 1200 });
      const verdict = bench.parseJudge(raw);
      if (!verdict) return { ok: false, error: 'Judge did not return a usable verdict.' };

      const winner = outs.find((o: any) => o.label === verdict.winnerLabel);
      db.run('INSERT INTO compare_scores (id,run_id,judge_model,winner_label,winner_model,analysis_md,strengths_json,weaknesses_json,merged_answer,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [newId(), runId, judgePath, verdict.winnerLabel, winner?.model_name || '', verdict.reasoning,
          JSON.stringify(verdict.strengths), JSON.stringify(verdict.weaknesses), verdict.mergedAnswer, now()]);
      db.run('UPDATE compare_runs SET winner_label=?, winner_model=?, judge_model=?, updated_at=? WHERE id=?',
        [verdict.winnerLabel, winner?.model_path || '', judgePath, now(), runId]);

      if (original && original !== settings.get().modelPath) { try { await runtime.switchModel(original); } catch { /* */ } }
      try { require('../graph').default.rebuild(); } catch { /* */ }
      this.emit('progress', { runId, phase: 'judged', winnerLabel: verdict.winnerLabel });
      return { ok: true, verdict: { ...verdict, winnerModel: run.blind ? `Model ${verdict.winnerLabel}` : (winner?.model_name || '') } };
    } catch (e: any) {
      if (original && original !== settings.get().modelPath) { try { await runtime.switchModel(original); } catch { /* */ } }
      return { ok: false, error: e.message };
    }
  }

  list() {
    return db.all('SELECT id,prompt,blind,status,winner_label,winner_model,judge_model,created_at FROM compare_runs ORDER BY created_at DESC LIMIT 100');
  }
  get(runId: string) {
    const run = db.get('SELECT * FROM compare_runs WHERE id=?', [runId]);
    if (!run) return null;
    return {
      run,
      outputs: db.all('SELECT * FROM compare_outputs WHERE run_id=? ORDER BY position ASC', [runId]),
      score: db.get('SELECT * FROM compare_scores WHERE run_id=? ORDER BY created_at DESC LIMIT 1', [runId]),
      running: this.active.has(runId),
    };
  }
  delete(runId: string) {
    this.cancel(runId);
    for (const [t, col] of [['compare_runs', 'id'], ['compare_outputs', 'run_id'], ['compare_scores', 'run_id']] as const) {
      db.run(`DELETE FROM ${t} WHERE ${col}=?`, [runId]);
    }
    return true;
  }
}

async function waitReady(timeoutMs = 120000) {
  const t0 = Date.now();
  while (!runtime.isReady()) {
    if (runtime.getStatus().state === 'ERROR') throw new Error(runtime.getStatus().error || 'runtime error');
    if (Date.now() - t0 > timeoutMs) throw new Error('model did not load in time');
    await new Promise((r) => setTimeout(r, 400));
  }
}

function publicMetrics(m: RunMetrics) {
  return {
    loadMs: m.loadMs, firstTokenMs: m.firstTokenMs, totalMs: m.totalMs, tokensPerSec: m.tokensPerSec,
    promptTokens: m.promptTokens, completionTokens: m.completionTokens, backend: m.backend, gpuLayers: m.gpuLayers,
    contextLength: m.contextLength, temperature: m.temperature, topP: m.topP, repeatPenalty: m.repeatPenalty,
    estRamGB: m.estRamGB, stopped: m.stopped,
  };
}

export default new CompareService();
