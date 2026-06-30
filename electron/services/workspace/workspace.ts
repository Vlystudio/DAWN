/**
 * workspace/workspace.ts — facade over the Workspace Graph (items + links + search) plus a couple of
 * REAL cross-feature actions that use existing services (no fakes): convert a workspace item into a
 * task, and save arbitrary text (e.g. a chat reply) as a note — each creating the workspace items and
 * the typed link between them. The Brain picks up workspace items on its next rebuild.
 */
import items from './items';
import links from './links';
import searchSvc from './search';
import tasks from './tasks';
import notes from './notes';

/** Ensure a workspace item exists for an existing feature row (idempotent via items.create dedupe). */
export function registerItem(type: string, refId: string, label: string, sourceFeature?: string, metadata?: any) {
  return items.create({ type, refId, label, sourceFeature: sourceFeature || type, metadata });
}

/** Convert a workspace item into a Task (real tasks.create) + a converted_to link. */
export function convertToTask(itemId: string) {
  const item = items.get(itemId);
  if (!item) return { ok: false, error: 'item not found' };
  const task = tasks.create({ title: item.label, details: '', source_type: 'workspace', source_id: itemId });
  const ti = items.create({ type: 'task', refId: task.id, label: task.title, sourceFeature: 'tasks', metadata: { fromWorkspaceItem: itemId } });
  let link: any = null;
  if (ti.ok && ti.item) link = links.create({ fromId: itemId, toId: ti.item.id, type: 'converted_to' }).link;
  return { ok: true, task, item: ti.item, link };
}

/** Save text (e.g. a chat response) as a Note + workspace item; optionally link it to a source item. */
export function saveAsNote(input: { title?: string; content?: string; fromItemId?: string }) {
  const note = notes.create({ title: input.title || 'Saved note', content: input.content || '' });
  const ni = items.create({ type: 'note', refId: note?.id, label: note?.title || input.title || 'Saved note', sourceFeature: 'notes' });
  let link: any = null;
  if (input.fromItemId && ni.ok && ni.item && items.get(input.fromItemId)) {
    link = links.create({ fromId: input.fromItemId, toId: ni.item.id, type: 'created_from' }).link;
  }
  return { ok: true, note, item: ni.item, link };
}

export default {
  items, links, search: searchSvc.search, registerItem, convertToTask, saveAsNote,
  related: links.related, counts: () => ({ items: items.countAll(), links: links.countAll() }),
};
