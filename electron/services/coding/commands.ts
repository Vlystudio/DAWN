/**
 * coding/commands.ts — pure allowlist + argv validation for coding test/lint/typecheck
 * commands. NO shell, NO interpolation, NO pipes/redirects/chaining, NO install/network/
 * destructive/system commands. Only a fixed set of test/lint/typecheck runners is permitted,
 * and the model never supplies a raw shell string — we tokenize an argv array and validate
 * every element. Fails closed: anything not explicitly allowed is rejected.
 */

// Shell metacharacters that must never appear (defense in depth — we never use a shell).
const META = /[|&;<>`$(){}\[\]\n\r]|\$\(|&&|\|\|/;

export interface ParsedCommand { ok: boolean; argv?: string[]; label?: string; reason?: string; }

const SCRIPT_RE = /^(test(:[\w.\-:+]+)?|lint(:[\w.\-:+]+)?|typecheck|type-check|tsc|check)$/i;
const NPX_BINS: Record<string, (rest: string[]) => boolean> = {
  tsc: (r) => r.includes('--noEmit') || r.includes('-p') || r.includes('--project'),
  vitest: (r) => r.includes('run'),                 // never watch mode
  jest: () => true,                                  // runs once by default
  eslint: () => true,
  mocha: () => true,
  prettier: (r) => r.includes('--check') || r.includes('-c'),
};

function safeFlags(rest: string[]): boolean {
  // every token must be metachar-free (already globally checked) and not a redirect-ish path
  return rest.every((a) => !META.test(a));
}

function checkExe(exe: string, rest: string[]): ParsedCommand {
  const e = exe.toLowerCase().replace(/\.(cmd|exe|bat)$/i, '');
  switch (e) {
    case 'npm':
    case 'pnpm': {
      if (rest[0] === 'test' && safeFlags(rest.slice(1))) return ok(`${e} test`);
      if ((rest[0] === 'run' || rest[0] === 'run-script') && SCRIPT_RE.test(rest[1] || '') && safeFlags(rest.slice(2)))
        return ok(`${e} run ${rest[1]}`);
      return no(`${e}: only "test", "run test|lint|typecheck[:*]" are allowed (no install/build/exec)`);
    }
    case 'yarn': {
      const head = rest[0] === 'run' ? rest[1] : rest[0];
      const tail = rest[0] === 'run' ? rest.slice(2) : rest.slice(1);
      if (SCRIPT_RE.test(head || '') && safeFlags(tail)) return ok(`yarn ${head}`);
      return no('yarn: only test/lint/typecheck scripts are allowed');
    }
    case 'npx': {
      const bin = (rest[0] || '').toLowerCase();
      const fn = NPX_BINS[bin];
      if (fn && fn(rest.slice(1)) && safeFlags(rest.slice(1))) return ok(`npx ${bin}`);
      return no(`npx: only ${Object.keys(NPX_BINS).join('/')} (read-only modes) are allowed`);
    }
    case 'tsc':
      if ((rest.includes('--noEmit') || rest.includes('-p') || rest.includes('--project')) && safeFlags(rest)) return ok('tsc');
      return no('tsc must use --noEmit (or -p) — no code emit');
    case 'python':
    case 'python3':
    case 'py': {
      const mod = rest[0] === '-m' ? (rest[1] || '').toLowerCase() : '';
      if (['pytest', 'mypy', 'ruff', 'unittest'].includes(mod) && safeFlags(rest.slice(2))) return ok(`python -m ${mod}`);
      return no('python: only "-m pytest|mypy|ruff|unittest" is allowed');
    }
    case 'pytest':
      return safeFlags(rest) ? ok('pytest') : no('pytest: unsafe arguments');
    case 'ruff':
      return rest[0] === 'check' && safeFlags(rest.slice(1)) ? ok('ruff check') : no('ruff: only "ruff check" is allowed');
    case 'mypy':
      return safeFlags(rest) ? ok('mypy') : no('mypy: unsafe arguments');
    case 'vitest':
      return rest.includes('run') && safeFlags(rest) ? ok('vitest run') : no('vitest must use "run" (no watch)');
    default:
      return no(`'${exe}' is not an allowed coding command (only test/lint/typecheck runners)`);
  }
  function ok(label: string): ParsedCommand { return { ok: true, argv: [exe, ...rest], label }; }
  function no(reason: string): ParsedCommand { return { ok: false, reason }; }
}

/** Validate a command (argv array, or a metachar-free string we tokenize). */
export function parseCommand(input: string | string[]): ParsedCommand {
  let argv: string[];
  if (Array.isArray(input)) {
    argv = input.map((x) => String(x));
  } else {
    const s = String(input || '').trim();
    if (!s) return { ok: false, reason: 'empty command' };
    if (META.test(s)) return { ok: false, reason: 'shell metacharacters are not allowed (no pipes, redirects, or chaining)' };
    argv = s.split(/\s+/);
  }
  if (!argv.length || !argv[0]) return { ok: false, reason: 'empty command' };
  if (argv.some((a) => META.test(a))) return { ok: false, reason: 'shell metacharacters are not allowed in arguments' };
  // The executable allowlist below is the real gate: only test/lint/typecheck runners are
  // permitted, and install/network/destructive verbs are rejected per-exe (e.g. `npm install`).
  return checkExe(argv[0], argv.slice(1));
}
