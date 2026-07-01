/**
 * workspace/liveHooks.ts — tiny, safe live-registration hooks. Feature services (notes, tasks) call
 * these on create/update/delete so a workspace item appears/updates/disappears immediately instead of
 * waiting for the next reconcile. Idempotent (items.create dedupes by type+ref_id), wrapped (a hook
 * failure never breaks the host service), and reconcile remains the fallback. Imports ONLY `items`
 * (no facade) to avoid circular deps. Never registers vault/auth/audit data.
 */
import items from './items';

/** Register or update a workspace item for a real feature row (idempotent). */
export function register(type: string, refId: string, label: string, sourceFeature: string, metadata?: any) {
  try { if (refId) items.create({ type, refId: String(refId), label: String(label || ''), sourceFeature, metadata }); } catch { /* never break the host service */ }
}

/** Remove the auto-registered item for a deleted feature row. */
export function remove(type: string, refId: string) {
  try { if (refId) items.removeByRef(type, String(refId)); } catch { /* */ }
}

export default { register, remove };
