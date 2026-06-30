/**
 * workspace/chatActions.ts — turn a REAL assistant message into a note / task / document / memory,
 * using the existing services, and link the created item back to its source conversation in the
 * Workspace Graph (created_from). No fake messages, no silent failure: a missing message or a failed
 * service call returns a clear error. The created item is registered so it shows in Global Search +
 * the Brain, and the relationship is queryable via workspace related-lookup.
 */
import db from '../db';
import items from './items';
import links from './links';
import core from './workspaceCore';
import notes from './notes';
import tasks from './tasks';
import documents from '../documents/documents';
import memory from '../memory';

function getMessage(messageId: string): any {
  return db.get('SELECT * FROM messages WHERE id=?', [String(messageId || '')]);
}
function deriveTitle(content: string, max = 70): string {
  const firstLine = String(content || '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) || 'Untitled';
  return core.cleanLabel(firstLine, max);
}

/** Register the source conversation item + the created target item, and link target --created_from--> conversation. */
function linkToConversation(conversationId: string, targetType: string, targetRefId: string, targetLabel: string, sourceFeature: string) {
  let conversationTitle = 'Conversation';
  try { const cv: any = db.get('SELECT title FROM conversations WHERE id=?', [conversationId]); if (cv?.title) conversationTitle = cv.title; } catch { /* */ }
  const conv: any = items.create({ type: 'conversation', refId: conversationId, label: conversationTitle, sourceFeature: 'chat' });
  const tgt: any = items.create({ type: targetType, refId: targetRefId, label: targetLabel, sourceFeature });
  let link: any = null;
  if (conv?.ok && conv.item && tgt?.ok && tgt.item) link = links.create({ fromId: tgt.item.id, toId: conv.item.id, type: 'created_from' }).link;
  return { itemId: tgt?.item?.id, linkId: link?.id };
}

export function saveAsNote(messageId: string) {
  const m = getMessage(messageId);
  if (!m) return { ok: false, error: 'Message not found.' };
  const note: any = notes.create({ title: deriveTitle(m.content), content: m.content || '' });
  if (!note?.id) return { ok: false, error: 'Could not create the note.' };
  const { itemId } = linkToConversation(m.conversation_id, 'note', note.id, note.title || 'Note', 'notes');
  return { ok: true, id: note.id, itemId, route: 'notes', label: note.title };
}

export function createTask(messageId: string) {
  const m = getMessage(messageId);
  if (!m) return { ok: false, error: 'Message not found.' };
  const task: any = tasks.create({ title: deriveTitle(m.content), details: m.content || '', source_type: 'chat', source_id: m.conversation_id });
  if (!task?.id) return { ok: false, error: 'Could not create the task.' };
  const { itemId } = linkToConversation(m.conversation_id, 'task', task.id, task.title || 'Task', 'tasks');
  return { ok: true, id: task.id, itemId, route: 'tasks', label: task.title };
}

export function createDocument(messageId: string) {
  const m = getMessage(messageId);
  if (!m) return { ok: false, error: 'Message not found.' };
  const doc: any = documents.create({ title: deriveTitle(m.content), content: m.content || '', format: 'markdown' });
  if (!doc?.id) return { ok: false, error: 'Could not create the document.' };
  const { itemId } = linkToConversation(m.conversation_id, 'document', doc.id, doc.title || 'Document', 'documents');
  return { ok: true, id: doc.id, itemId, route: 'documents', label: doc.title };
}

export function saveAsMemory(messageId: string) {
  const m = getMessage(messageId);
  if (!m) return { ok: false, error: 'Message not found.' };
  const text = String(m.content || '').trim();
  if (!text) return { ok: false, error: 'Nothing to save.' };
  const mem: any = memory.add(text.slice(0, 2000), 'personal_fact', 'chat');
  if (!mem?.id) return { ok: false, error: 'Memory is disabled or could not be saved.' };
  const { itemId } = linkToConversation(m.conversation_id, 'memory', mem.id, core.cleanLabel(text, 60), 'memory');
  return { ok: true, id: mem.id, itemId, route: 'memory' };
}

/** Link an existing message's conversation to an existing workspace item (by id). */
export function linkItem(messageId: string, targetItemId: string, type = 'references') {
  const m = getMessage(messageId);
  if (!m) return { ok: false, error: 'Message not found.' };
  const conv: any = items.create({ type: 'conversation', refId: m.conversation_id, label: 'Conversation', sourceFeature: 'chat' });
  if (!conv?.ok || !conv.item) return { ok: false, error: 'Could not register the conversation.' };
  return links.create({ fromId: conv.item.id, toId: String(targetItemId || ''), type });
}

export default { saveAsNote, createTask, createDocument, saveAsMemory, linkItem };
