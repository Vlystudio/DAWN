/**
 * eval-rag.mjs — DAWN local RAG eval runner. Loads the fixed dataset (evals/rag-eval.json) and scores
 * it with the SAME retrieval + groundedness cores DAWN ships (compiled to dist-test by tsconfig.test).
 * Deterministic + offline: no model, no live index, no network. Prints a summary and writes results to
 * evals/last-results.json. Run: npm run eval:rag  (runs tsc -p tsconfig.test.json first).
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.dirname(url.fileURLToPath(import.meta.url)) + '/..';
const corePath = path.join(root, 'dist-test/electron/services/rag/ragEvalCore.js');
if (!fs.existsSync(corePath)) {
  console.error('Compiled core not found. Run: tsc -p tsconfig.test.json  (npm run eval:rag does this for you).');
  process.exit(2);
}
const { runEval } = await import(url.pathToFileURL(corePath).href);

const dataPath = path.join(root, 'evals/rag-eval.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const { summary, scores } = runEval(data.cases || []);

console.log(`\nDAWN RAG eval — "${data.name}"`);
console.log(`  cases: ${summary.cases} (valid ${summary.valid}, invalid ${summary.invalid})`);
console.log(`  retrieval hit rate: ${fmt(summary.retrievalHitRate)}   top-1: ${fmt(summary.top1HitRate)}`);
console.log(`  mean keyword coverage: ${fmt(summary.meanKeywordCoverage)}`);
console.log(`  mean groundedness: ${fmt(summary.meanGroundedness)}   mean unsupported rate: ${fmt(summary.meanUnsupportedRate)}`);
console.log(`  negatives leaked (should be 0): ${summary.negativesLeaked}`);
for (const s of scores) {
  if (!s.valid) { console.log(`  - ${s.id}: INVALID (${s.invalidReason})`); continue; }
  console.log(`  - ${s.id}: hit=${s.retrievalHit} top1=${s.topKHit} mode=${s.mode} kw=${fmt(s.keywordCoverage)} ground=${fmt(s.groundedness)}`);
}

// Write results locally (no secret document contents beyond the fixed public eval set).
const outDir = path.join(root, 'evals');
fs.writeFileSync(path.join(outDir, 'last-results.json'), JSON.stringify({ summary, scores }, null, 2));
console.log(`\nSaved → evals/last-results.json`);

// Non-zero exit if a negative claim leaked (a real regression signal).
process.exit(summary.negativesLeaked > 0 ? 1 : 0);

function fmt(v) { return v == null ? 'n/a' : String(v); }
