/**
 * ragEvalFixture.ts — a small, PUBLIC eval fixture embedded in code so the installed app can run the
 * RAG eval without the dev-only evals/ folder being bundled. Deterministic + offline. No secret content.
 * (The full dev fixture lives in evals/rag-eval.json for `npm run eval:rag`.)
 */
import type { EvalCase } from './ragEvalCore';

export const CASES: EvalCase[] = [
  {
    id: 'varroa',
    question: 'How do I treat varroa mites in my beehive?',
    corpus: [
      { id: 'hive', name: 'hive-health.md', text: 'Varroa mites are the biggest threat to a honey bee colony. Treat them with oxalic acid vaporization in late fall when the colony is broodless, or use formic acid strips during the season.' },
      { id: 'honey', name: 'honey.md', text: 'Harvest honey when frames are capped, then extract, filter and bottle it.' },
    ],
    expectedSourceIds: ['hive'], expectedKeywords: ['oxalic'],
    answer: 'Treat varroa mites with oxalic acid vaporization in late fall when the colony is broodless.',
    negativeClaims: ['The stock market rallied on Tuesday afternoon.'],
  },
  {
    id: 'ipc',
    question: 'How does the renderer talk to the main process?',
    corpus: [
      { id: 'ipc', name: 'ipc.md', text: 'The renderer reaches the main process only through the preload contextBridge, which exposes window.dawn; every call is ipcRenderer.invoke to an ipcMain.handle channel.' },
      { id: 'vault', name: 'vault.md', text: 'The vault stores encrypted secrets and is never searched.' },
    ],
    expectedSourceIds: ['ipc'], expectedKeywords: ['preload', 'contextbridge'],
    answer: 'The renderer uses the preload contextBridge exposed as window.dawn, calling ipcRenderer.invoke to ipcMain.handle channels.',
    negativeClaims: ['Bananas are an excellent source of dietary potassium.'],
  },
  {
    id: 'no-evidence',
    question: 'What is the capital of France?',
    corpus: [
      { id: 'compost', name: 'compost.md', text: 'A healthy compost pile wants a carbon to nitrogen ratio of about 30 to 1.' },
    ],
    expectedKeywords: ['paris'],
    answer: 'The capital of France is Paris.',
    notes: 'Grounding should be low: the local corpus has no supporting evidence.',
  },
];

export default { cases: CASES };
