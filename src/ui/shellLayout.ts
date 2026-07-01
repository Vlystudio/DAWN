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

  // master–detail split: fixed header, then a flex body of independently-scrolling columns
  splitRoot: 'h-full flex flex-col',
  splitHeader: 'shrink-0 border-b border-border',
  splitBody: 'flex-1 min-h-0 flex',
  splitSidebar: 'shrink-0 border-r border-border overflow-y-auto min-h-0',
  splitMain: 'flex-1 min-w-0 overflow-y-auto min-h-0',
  splitDetail: 'shrink-0 border-l border-border overflow-y-auto min-h-0',

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

/** True if two regions each scroll on their own (no shared/parent scroll fighting them). */
export function hasIndependentScroll(a: string, b: string): boolean {
  return isScrollable(a) && isScrollable(b) && canShrink(a) && canShrink(b);
}

/** A flex body that hosts scrolling children must itself be shrinkable and NOT scroll (no double scroll). */
export function isCleanFlexBody(cls: string): boolean {
  return isFlexFill(cls) && canShrink(cls) && !isScrollable(cls);
}

export default { SHELL, isScrollable, canShrink, isFlexFill, hasIndependentScroll, isCleanFlexBody };
