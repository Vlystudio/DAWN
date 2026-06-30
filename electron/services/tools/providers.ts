/**
 * providers.ts — MCP-style provider abstraction. Built-in DAWN tools are exposed through
 * the SAME interface a future MCP provider would implement, so the gateway is provider-
 * agnostic. An `mcp_future` provider is registered but disabled (off by default) — no
 * external MCP is implemented yet, and nothing claims it is.
 */
import { BUILTIN_TOOLS, ToolDef, ProviderType } from './toolRegistryCore';

export interface ToolProvider {
  id: string;
  name: string;
  type: ProviderType;
  enabled: boolean;
  listTools(): ToolDef[];
  executeTool(toolId: string, input: any): Promise<any>;
  status(): { ok: boolean; detail?: string };
}

/** The built-in DAWN provider — wires registry tool ids to the real local services. */
const builtinProvider: ToolProvider = {
  id: 'dawn',
  name: 'DAWN built-in tools',
  type: 'builtin',
  enabled: true,
  listTools: () => BUILTIN_TOOLS,
  status: () => ({ ok: true }),
  async executeTool(toolId: string, input: any): Promise<any> {
    switch (toolId) {
      case 'shell.powershell': {
        const tools = require('../tools').default;
        const r = await tools.runPowerShell(String(input.command || ''));
        return r.stdout || r.stderr || `exit ${r.code}`;
      }
      case 'network.fetch':
      case 'research.fetch': {
        const tools = require('../tools').default;
        const r = await tools.webFetch(String(input.url || ''));
        if (!r.ok) throw new Error(r.error || 'fetch failed');
        return r.text || '';
      }
      case 'rag.retrieve': {
        const rag = require('../rag').default;
        const chunks = await rag.retrieve(String(input.query || ''));
        return (chunks || []).map((c: any) => `${c.name}: ${c.content}`).join('\n\n');
      }
      case 'memory.recall': {
        const memory = require('../memory').default;
        return (memory.recall(String(input.query || '')) || []).map((m: any) => m.content).join('\n');
      }
      case 'model.benchmark': {
        const b = require('../bench/benchmark').default;
        const r = await b.run(String(input.modelPath || ''));
        return JSON.stringify(r.metrics ? { tokensPerSec: r.metrics.tokensPerSec, loadMs: r.metrics.loadMs, backend: r.metrics.backend } : r);
      }
      case 'model.download': {
        const dl = require('../download').default;
        const url = String(input.url || '');
        const r = await dl.start(input.modelId || 'tool', input.family || 'misc', input.filename || url.split('/').pop() || 'model.gguf', url, input.sha);
        return JSON.stringify(r);
      }
      case 'calendar.create': {
        const cal = require('../calendar/calendar').default;
        return JSON.stringify(cal.create({ title: input.title, start_at: input.start_at || Date.now(), end_at: input.end_at, details: input.details, location: input.location }));
      }
      // --- Vault (auth-gated: these throw when DAWN is locked, which the gateway surfaces) ---
      case 'vault.list': { require('../security/auth').default.requireSessionForVault(); return JSON.stringify(require('../security/vault').default.list()); }
      case 'vault.create': { require('../security/auth').default.requireSessionForVault(); return JSON.stringify(require('../security/vault').default.create({ label: input.label, kind: input.kind, username: input.username, secret: input.secret, tags: input.tags })); }
      case 'vault.update': { require('../security/auth').default.requireSessionForVault(); return JSON.stringify(require('../security/vault').default.update(input.id, input)); }
      case 'vault.delete': { require('../security/auth').default.requireSessionForVault(); return JSON.stringify(require('../security/vault').default.remove(input.id)); }
      case 'vault.reveal': {
        require('../security/auth').default.requireSessionForVault();
        const r = require('../security/vault').default.reveal(input.id);
        if (!r.ok) throw new Error(r.error || 'reveal failed');
        return r.secret; // sensitiveOutput → gateway redacts from audit + never returns to model
      }
      // --- Email (Part D) — auth-gated in the service; send is gateway-approved (critical) ---
      case 'email.listAccounts': return JSON.stringify(require('../email/email').default.listAccounts());
      case 'email.listFolders': return JSON.stringify(await require('../email/email').default.listFolders(input.accountId));
      case 'email.sync': return JSON.stringify(await require('../email/email').default.sync(input.accountId, input.folder));
      case 'email.readMessage': { const m = require('../email/email').default.getMessage(input.id); return JSON.stringify(m ? { subject: m.subject, from: m.from_email, snippet: m.snippet } : null); }
      case 'email.summarizeMessage': { const r = await require('../email/email').default.summarize(input.id); if (!r.ok) throw new Error(r.error); return r.summary; }
      case 'email.draftReply': { const r = await require('../email/email').default.draftReply(input.id, input.instruction); if (!r.ok) throw new Error(r.error); return JSON.stringify({ draftId: r.draftId }); }
      case 'email.createTask': { const r = await require('../email/email').default.createTaskFromEmail(input.id); if (!r.ok) throw new Error(r.error); return JSON.stringify({ taskId: r.taskId, title: r.title }); }
      case 'email.createCalendarEvent': { const r = await require('../email/email').default.createCalendarFromEmail(input.id); if (!r.ok) throw new Error(r.error); return JSON.stringify({ eventId: r.eventId }); }
      case 'email.sendDraft': { const r = await require('../email/email').default.sendDraft(input.draftId); if (!r.ok) throw new Error(r.error); return JSON.stringify({ sent: true, messageId: r.messageId }); }
      // --- Backup / Restore (Part H) — restore is gateway-approved (critical) ---
      case 'backup.create': { const r = require('../backup/backup').default.create(input || {}); if (!r.ok) throw new Error(r.error); return JSON.stringify({ path: require('path').basename(r.path), sizeBytes: r.sizeBytes }); }
      case 'backup.verify': return JSON.stringify(require('../backup/backup').default.verify(input.path));
      case 'backup.restore': { const r = await require('../backup/backup').default.restore(input.path); if (!r.ok) throw new Error(r.error); return JSON.stringify({ restored: true, safetySnapshot: r.safetySnapshot }); }
      case 'backup.listHistory': return JSON.stringify(require('../backup/backup').default.history());
      case 'backup.openFolder': await require('../backup/backup').default.openFolder(); return 'opened';
      case 'backup.deleteSafetySnapshot': return JSON.stringify(require('../backup/backup').default.deleteSafetySnapshot(input.id));
      default:
        throw new Error(`Tool "${toolId}" is registered but not callable through the gateway in this build (it runs from its own screen).`);
    }
  },
};

/** Disabled placeholder for future MCP servers. Lists nothing and refuses to execute. */
const mcpFutureProvider: ToolProvider = {
  id: 'mcp',
  name: 'MCP servers (future)',
  type: 'mcp_future',
  enabled: false,
  listTools: () => [],
  status: () => ({ ok: false, detail: 'disabled — external MCP providers are not implemented yet' }),
  async executeTool() { throw new Error('MCP providers are not enabled.'); },
};

const PROVIDERS: ToolProvider[] = [builtinProvider, mcpFutureProvider];

export function providers(): ToolProvider[] { return PROVIDERS; }
export function getProvider(id: string): ToolProvider | null { return PROVIDERS.find((p) => p.id === id) || null; }

export default { providers, getProvider, builtinProvider };
