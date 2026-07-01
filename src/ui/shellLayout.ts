/**
 * shellLayout.ts — pure, framework-free layout class strings for DAWN's page-shell variants, plus
 * invariant checks. Keeping the region classes here lets us TEST layout guarantees without rendering
 * (no eyesight needed): e.g. a split shell's sidebar and main must scroll independently, a log shell's
 * header must be fixed while its body scrolls, and nothing should double-scroll. The React components
 * in system.tsx consume these exact classes.
 */

export const SHELL = {
  // simple top-scroll page (the original PageShell)
  page: 'h-full overflow-y-auto',
  pageInner: 'mx-auto p-6',

  // master–detail split: fixed header, then a flex body whose columns are independent flex hosts.
  // Columns don't scroll themselves — the caller's content owns scroll (an inner flex-1 overflow-y-auto
  // list/editor). This avoids double-scroll AND preserves screens whose sidebar has a fixed sub-header
  // + inner scroll list (e.g. Notes). Use `splitCol*Scroll` for simple flowing content.
  splitRoot: 'h-full flex flex-col',
  splitHeader: 'shrink-0 border-b border-border',
  splitBody: 'flex-1 min-h-0 flex',
  splitSidebar: 'shrink-0 border-r border-border min-h-0 flex flex-col',
  splitMain: 'flex-1 min-w-0 min-h-0 flex flex-col',
  splitDetail: 'shrink-0 border-l border-border min-h-0 flex flex-col',
  // a scrolling region a caller drops inside a column when its content simply flows
  colScroll: 'flex-1 min-h-0 overflow-y-auto',

  // panel/card page: top-scroll with a header + action bar (same scroll model as page)
  panelRoot: 'h-full overflow-y-auto',
  panelInner: 'mx-auto p-6',

  // logs/diagnostics: fixed header/actions + a single scrollable log box
  logRoot: 'h-full flex flex-col p-6',
  logHeader: 'shrink-0',
  logBody: 'flex-1 min-h-0 overflow-y-auto',

  // graph/canvas: header/action bar + full-bleed non-scrolling canvas region + optional side panel
  canvasRoot: 'h-full flex flex-col',
  canvasHeader: 'shrink-0 border-b border-border',
  canvasBody: 'flex-1 min-h-0 relative',
  canvasDetail: 'shrink-0 border-l border-border overflow-y-auto min-h-0',
} as const;

export function isScrollable(cls: string): boolean { return /\boverflow-y-auto\b/.test(cls); }
export function canShrink(cls: string): boolean { return /\bmin-h-0\b/.test(cls); }
export function isFlexFill(cls: string): boolean { return /\bflex-1\b/.test(cls); }
export function isFlexCol(cls: string): boolean { return /\bflex\b/.test(cls) && /\bflex-col\b/.test(cls); }

/**
 * A flex "host" region hosts its own scrolling child: it fills/shrinks and is a flex-col, but does
 * NOT scroll itself (so pairing it with an inner flex-1 overflow-y-auto gives exactly one scroll —
 * no double-scroll, and a fixed sub-header inside stays fixed).
 */
export function isFlexHost(cls: string): boolean {
  return canShrink(cls) && isFlexCol(cls) && !isScrollable(cls);
}

/** Two columns scroll independently when each is its own flex host (its content scrolls). */
export function hasIndependentScroll(a: string, b: string): boolean {
  return isFlexHost(a) && isFlexHost(b);
}

/** A flex body that hosts columns/scrollers must fill + shrink and NOT scroll (no double scroll). */
export function isCleanFlexBody(cls: string): boolean {
  return isFlexFill(cls) && canShrink(cls) && !isScrollable(cls);
}

export default { SHELL, isScrollable, canShrink, isFlexFill, isFlexCol, isFlexHost, hasIndependentScroll, isCleanFlexBody };
