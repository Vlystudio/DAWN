/**
 * ragEval.ts — in-app RAG eval (electron). Runs the deterministic eval core over the EMBEDDED fixture
 * (always available in the installed app) and persists the result to userData so System Health + the UI
 * can show real, honest metrics. No cloud, no telemetry, no user-file scanning — only the public fixture.
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import core from './ragEvalCore';
import fixture from './ragEvalFixture';
import logger from '../logger';

function resultsPath(): string { return path.join(app.getPath('userData'), 'rag-eval-results.json'); }

export function run(): { ok: boolean; summary?: any; scores?: any[]; strategies?: any; error?: string } {
  try {
    const { summary, scores } = core.runEval(fixture.cases);
    const strategies = core.compareStrategies(fixture.cases);
    fs.writeFileSync(resultsPath(), JSON.stringify({ summary, scores, strategies, fixtureCount: fixture.cases.length }, null, 2));
    logger.info('rag', `RAG eval run: ${summary.valid}/${summary.cases} valid, hit-rate ${summary.retrievalHitRate}, negatives ${summary.negativesLeaked}`);
    return { ok: true, summary, scores, strategies };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}

export function status() {
  const s: any = { fixtureAvailable: fixture.cases.length > 0, fixtureCount: fixture.cases.length, hasRun: false };
  try {
    if (fs.existsSync(resultsPath())) { const j = JSON.parse(fs.readFileSync(resultsPath(), 'utf8')); s.hasRun = true; s.summary = j.summary; s.strategies = j.strategies; }
  } catch { /* not run yet */ }
  return s;
}

export default { run, status };
