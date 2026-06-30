# DAWN Skills & Tool Registry

DAWN's capabilities are modeled as a **Tool Registry** (with risk levels, permissions, and an
approval gateway) and a **Skills** system (user-created automations scoped to allowed tools).
Clean-room, DAWN-native. Builds on the PromptSecurity firewall ([SECURITY.md](SECURITY.md)).

## Tool Registry

Every DAWN capability is a registered tool with: `id, name, description, category, riskLevel,
requiredPermission, inputSchema, outputSchema, enabled, requiresApproval, providerId, future`.

- **Risk levels:** safe · low · medium · high · critical
- **Permissions:** none · read_local_data · write_local_data · network_access · shell_execute ·
  model_download · email_read · email_send · calendar_write · vault_read · vault_write ·
  settings_modify · brain_modify
- **Categories:** chat · research · rag · file · shell · model · document · note · task ·
  calendar · memory · brain · network · email_future · vault_future · provider · system

Built-ins include local chat, RAG retrieval, memory recall, document/note AI actions, task
planning, calendar create/update, research fetch/summarize, model benchmark, **model download
(high)**, **PowerShell (critical)**, file read/write/export, **network fetch (high)**, and
**settings modify (high)**. Capabilities that don't exist yet are registered as **future**
(disabled, never run): `backup.create/restore`, `email.read/send`, `vault.read/write`.

Enabled state reflects reality: shell is only "enabled" when PowerShell is allowed in Settings,
network fetch when Internet is on, file tools when Computer Access is on. The user can override
enable/disable per tool. Manage it in **Settings → 🧰 Tools & permissions** (toggle tools, see
risk/permission, pick the approval mode, view + clear the audit log).

## Tool Execution Gateway

All registered tool calls flow through `toolGateway.execute(toolId, input, ctx)`:

1. tool exists? · enabled? · not future? · input matches schema?
2. scan input/context for prompt-injection risk (PromptSecurity)
3. decide approval (risk level + mode + suspicious-context)
4. request approval if needed (allow once / always / deny)
5. execute via the tool's **provider**
6. **sanitize output** through `PromptSecurity.sanitizeToolOutput`
7. write a redacted, hashed **audit event**; return a typed result (errors redacted)

### Approval rules

- **safe/low** → run automatically (unless strict mode + suspicious context).
- **medium** → approval in strict mode, or when PromptSecurity flags medium/high context, or
  when the tool sets `requiresApproval`; otherwise auto in balanced/permissive.
- **high / critical** → **explicit approval every time** (critical shows a stronger warning).
- **disabled / future** → never run.
- **"Always allow"** is offered only for medium-or-lower, non-restricted tools — **never** for
  shell, vault, email send, settings modify, file write, or backup restore.

**Default approval mode: balanced** (Strict / Balanced / Permissive-low-risk-only available).

### Approval UI

A global modal ([ApprovalModal.tsx](../src/components/ApprovalModal.tsx)) shows the tool, risk,
requested permission, why approval is needed, a **redacted input preview**, and any
PromptSecurity warning, with **Allow once / Always (when eligible) / Deny**. Every decision is
audited.

## MCP-style provider seam

Tools are reached through a provider interface (`id, name, type, enabled, listTools,
executeTool, status`). The built-in DAWN tools are one provider; a second `mcp_future` provider
is registered but **disabled** — no external MCP is implemented, and nothing claims it is. New
providers (incl. MCP) can be added without changing the gateway or callers.

## Skills

A skill = `{ name, description, body, enabled, allowedToolIds, riskLevel, tags, runCount,
lastRunAt }`. The **body is untrusted user content**: it is wrapped by PromptSecurity and passed
as **user-role** context (never system/developer), so it can't override DAWN's rules. A skill's
**risk level = the highest risk among its allowed tools**.

Manage skills in the **Skills** screen (🟡 sidebar): create/edit/enable/delete, assign allowed
tools (with live risk display + a warning when high/critical tools are included), and **Test**
the skill against the local model. Recent runs are shown per skill.

**Skill tool calls** go through `skills.invokeTool(skillId, toolId, input)`: if the tool isn't in
the skill's allow-list it is **denied and audited**; otherwise it runs through the gateway
(approval + sanitize + audit), tagged with the skill id.

## PromptSecurity integration

- skill body inspected as `sourceType: skill`; tool output sanitized as `tool_output`
- tool input/output previews redacted (secrets/emails masked) + hashed in the audit
- `buildSkillTestMessages` + `assertNoUntrustedSystemRole` enforced before skill model calls
- suspicious skill/tool content creates PromptSecurity audit events

## Brain integration (quiet)

Enabled skills become nodes in the **Tools** region (high/critical glow red with a warning
edge); enabled high/critical registered tools appear too. Nothing spams the graph — only
enabled + risky items surface.

## Data model

`tool_state` (enable/always-allow overrides) · `tool_audit` (full audit) · `skills` ·
`skill_runs`.

## IPC

`window.dawn.tools.{list, get, updateEnabled, providers, auditRecent, auditClear, execute,
approvalResponse, onApproval}` · `window.dawn.skills.{list, get, create, update, delete, test,
invokeTool, auditRecent}`.

## Tests

[`tests/tools.test.ts`](../tests/tools.test.ts) covers all 14 requirements: registry built-ins,
disabled/future blocking, approval required for high/critical, denial blocks + audits,
allow-once runs + audits, output sanitized through PromptSecurity, skill body untrusted, skill
allow-list gate, skill risk from tools, audit redaction + hashing, provider lists built-ins,
the system-role assertion, and input-schema validation — plus the existing 185. **199 pass.**

## Email tool permissions

Email tools (`email.listAccounts/listFolders/sync/readMessage/summarizeMessage/draftReply/
createTask/createCalendarEvent/sendDraft`) are real registry entries. A skill may use them
**only if explicitly added to its allow-list** (`email_read` for read/sync/summarize/draft;
`email_send` for send). **`email.sendDraft` is critical + approval-required + never
"always allow"** — a skill can draft a reply but can **never** send without an explicit
approval that shows the skill name and the email preview. Off-list email tool calls are denied
and audited. See [EMAIL.md](EMAIL.md).

## Intentional limitations

- The gateway is the canonical path for **skills** and the `tools:execute` IPC. Chat's existing
  agentic tool loop is already secured by Part F (approval + wrapped output) and was **not**
  re-plumbed through the gateway in this pass to avoid regressions — a follow-up can converge them.
- `BuiltinProvider.executeTool` wires a real, useful subset (shell, network/research fetch, RAG,
  memory, benchmark, download, calendar). Tools that run from their own screens throw a clear
  "not callable via the gateway in this build" rather than pretending.
- Future tools (backup/email/vault) are registered + visible but never execute until their parts
  ship.
