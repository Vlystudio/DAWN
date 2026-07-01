/**
 * helperModelCore.ts — pure resolution for RETRIEVAL HELPER model slots (query rewrite / HyDE /
 * entailment / rerank). DAWN runs ONE llama-server at a time, so this is honest about what can actually
 * be used: a configured helper model is only used directly when it IS the loaded model; otherwise DAWN
 * falls back to the loaded chat model (if allowed) or skips. It never fakes running a separate model
 * concurrently — a dedicated helper runtime is a future capability, reported honestly here.
 */
export type HelperTask = 'query_rewrite' | 'hyde' | 'entailment' | 'reranker';

export interface HelperInputs {
  helperModelPath: string;   // configured for this task ('' = none)
  loadedModelPath: string;   // the currently loaded chat model
  loadedReady: boolean;
  preferChatFallback: boolean;
}
export interface HelperResolution {
  source: 'helper' | 'chat' | 'none';
  modelName: string;         // basename only (no full path)
  reason: string;
}

const base = (p: string) => String(p || '').split(/[\\/]/).pop() || '';

export function resolveHelper(i: HelperInputs): HelperResolution {
  const helper = base(i.helperModelPath);
  const loaded = base(i.loadedModelPath);
  if (i.helperModelPath) {
    if (i.loadedReady && helper === loaded) return { source: 'helper', modelName: helper, reason: 'configured helper model is the loaded model' };
    if (!i.loadedReady) return { source: 'none', modelName: helper, reason: 'helper configured but no model is loaded' };
    return i.preferChatFallback
      ? { source: 'chat', modelName: loaded, reason: 'DAWN runs one model at a time; configured helper isn\'t loaded — using the chat model' }
      : { source: 'none', modelName: helper, reason: 'configured helper isn\'t the loaded model and chat-model fallback is off' };
  }
  if (i.loadedReady && i.preferChatFallback) return { source: 'chat', modelName: loaded, reason: 'no helper configured — using the loaded chat model' };
  return i.loadedReady
    ? { source: 'chat', modelName: loaded, reason: 'no helper configured — using the loaded chat model' }
    : { source: 'none', modelName: '', reason: 'no model available' };
}

// --- dedicated-helper-runtime-aware resolution (structured) -----------------

export type HelperProvider = 'helper_runtime' | 'chat' | 'lexical' | 'none';

export interface TaskInputs {
  task: HelperTask;
  taskEnabled: boolean;          // the task's own on/off (e.g. queryRewriteEnabled)
  helperRuntimeEnabled: boolean; // helperRuntime.enabled
  helperRuntimeReady: boolean;   // helper server is actually reachable
  chatReady: boolean;            // the main chat model is loaded
  preferChatFallback: boolean;   // helperModels.preferChatModelFallback
  lexicalFallback: boolean;      // entailment only: the lexical verifier is available
}
export interface TaskResolution { provider: HelperProvider; reason: string }

/**
 * Decide, honestly + structured, which provider runs a helper task. Priority: dedicated helper runtime
 * (if enabled AND actually reachable) → chat model (if allowed + ready) → lexical fallback (entailment
 * only) → skip. Never returns 'helper_runtime' unless the runtime is truly reachable.
 */
export function resolveHelperTask(i: TaskInputs): TaskResolution {
  if (!i.taskEnabled) return { provider: 'none', reason: `${HELPER_LABELS[i.task]} is off` };
  if (i.helperRuntimeEnabled && i.helperRuntimeReady) return { provider: 'helper_runtime', reason: 'dedicated helper runtime is running' };
  const runtimeNote = i.helperRuntimeEnabled ? 'helper runtime not ready' : 'no helper runtime';
  if (i.chatReady && i.preferChatFallback) return { provider: 'chat', reason: `${runtimeNote} — using the chat model` };
  if (i.task === 'entailment' && i.lexicalFallback) return { provider: 'lexical', reason: `${runtimeNote} — using the lexical verifier` };
  return { provider: 'none', reason: `${runtimeNote} and no fallback available — skipped` };
}

export const HELPER_TASKS: HelperTask[] = ['query_rewrite', 'hyde', 'entailment', 'reranker'];
export const HELPER_LABELS: Record<HelperTask, string> = {
  query_rewrite: 'Query rewrite', hyde: 'HyDE', entailment: 'Entailment', reranker: 'Reranker',
};

export default { resolveHelper, resolveHelperTask, HELPER_TASKS, HELPER_LABELS };
