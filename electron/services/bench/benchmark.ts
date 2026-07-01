/**
 * benchmark.ts — hardware benchmarking. Runs a fixed short prompt against an
 * installed model, records load time / first-token latency / tokens-per-sec /
 * backend / GPU layers / estimated max context / OOM, stores the history, and
 * ranks installed models ("Best for this PC"). Restores the user's chat model.
 */
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import db from '../db';
import logger from '../logger';
import settings from '../settings';
import runtime from '../runtime';
import models from '../models';
import bench from './benchCore';
import { runModel } from './runner';
import { parseModelId } from '../optimizer/modelMetadata';
import live from '../workspace/liveHooks';

const newId = () => crypto.randomUUID();
const now = () => Date.now();

/** Fixed, short, deterministic-ish prompt so runs are comparable across models. */
const FIXED_PROMPT = 'In exactly three short sentences, explain what a GPU does. Then list the numbers 1 to 5.';

class BenchmarkService extends EventEmitter {
  private busy = false;

  isBusy() { return this.busy; }

  async run(modelPath: string): Promise<{ ok: boolean; error?: string; id?: string; metrics?: any }> {
    if (this.busy) return { ok: false, error: 'A benchmark is already running.' };
    if (!modelPath) return { ok: false, error: 'No model specified.' };
    if (!runtime.isInstalled()) return { ok: false, error: 'The local runtime (llama-server) is not installed.' };
    this.busy = true;
    const original = settings.get().modelPath || '';
    const info = models.list().find((m) => m.path === modelPath);
    const name = info?.name || modelPath.split(/[\\/]/).pop() || modelPath;
    const parsed = parseModelId(name);
    this.emit('progress', { phase: 'start', modelPath, modelName: name });
    logger.info('bench', `Benchmarking ${name}`);

    try {
      const m = await runModel(modelPath, FIXED_PROMPT, { maxTokens: 160, temperature: 0.3 });
      const id = newId();
      const status = m.ok ? 'ok' : 'error';
      db.run(
        `INSERT INTO benchmarks (id,model_path,model_name,quant,params_b,status,error,oom,load_ms,first_token_ms,total_ms,tokens_per_sec,
         prompt_tokens,completion_tokens,backend,gpu_layers,context_length,est_max_context,est_ram_gb,created_at,metadata_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, modelPath, name, info?.quant || parsed.quant, parsed.paramsB, status, m.error || '', m.oom ? 1 : 0,
          m.loadMs, m.firstTokenMs, m.totalMs, m.tokensPerSec, m.promptTokens, m.completionTokens, m.backend, m.gpuLayers,
          m.contextLength, m.estMaxContext, m.estRamGB, now(), JSON.stringify({ stopped: m.stopped })]);
      live.register('benchmark', id, name, 'benchmark'); // live workspace registration (public model name; reconcile fills status/quant)

      // Restore the user's chat model.
      if (original && original !== settings.get().modelPath) { try { await runtime.switchModel(original); } catch { /* */ } }
      try { require('../graph').default.rebuild(); } catch { /* */ }

      this.emit('progress', { phase: 'done', modelPath, modelName: name, status, metrics: m });
      logger.info('bench', `${name}: ${status} ${m.ok ? `${m.tokensPerSec} tok/s` : m.error}`);
      return { ok: m.ok, error: m.error, id, metrics: m };
    } catch (e: any) {
      if (original && original !== settings.get().modelPath) { try { await runtime.switchModel(original); } catch { /* */ } }
      this.emit('progress', { phase: 'error', modelPath, error: e.message });
      return { ok: false, error: e.message };
    } finally {
      this.busy = false;
    }
  }

  history(modelPath?: string) {
    return modelPath
      ? db.all('SELECT * FROM benchmarks WHERE model_path=? ORDER BY created_at DESC LIMIT 50', [modelPath])
      : db.all('SELECT * FROM benchmarks ORDER BY created_at DESC LIMIT 200');
  }

  /** "Best for this PC" — rank installed models by their latest benchmark. */
  bestForThisPC() {
    const rows = db.all('SELECT * FROM benchmarks ORDER BY created_at DESC LIMIT 200') as any[];
    return bench.rankBenchmarks(rows);
  }

  delete(id: string) {
    db.run('DELETE FROM benchmarks WHERE id=?', [id]);
    live.remove('benchmark', id); // live prune of the workspace item (delete has no reconcile otherwise)
    return true;
  }
}

export default new BenchmarkService();
