/**
 * untrusted.ts — compatibility shim. The prompt-injection firewall now lives in the
 * central PromptSecurity service (electron/services/security/promptSecurityCore.ts).
 * This module re-exports the legacy names so existing callers (research, bench, docs,
 * workspace) keep working unchanged while sharing one implementation.
 */
export {
  UNTRUSTED_SYSTEM_RULE,
  wrapUntrusted,
  wrapNumbered,
  wrapUntrustedContent,
  buildUntrustedContextPolicy,
  scanForInjectionPatterns,
  type SourceType,
  type WrapOptions,
} from '../security/promptSecurityCore';

import core from '../security/promptSecurityCore';
export default { UNTRUSTED_SYSTEM_RULE: core.UNTRUSTED_SYSTEM_RULE, wrapUntrusted: core.wrapUntrusted, wrapNumbered: core.wrapNumbered };
