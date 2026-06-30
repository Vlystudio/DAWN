/**
 * calCore.ts — pure helpers for Calendar-lite (no electron): iCalendar (.ics)
 * generation + parsing, and date-grid math for day/week/month views. Plus a CalDAV
 * provider interface (architecture only — CalDAV is optional, off by default, and
 * not implemented in this pass).
 */

export interface CalEvent {
  id?: string; title: string; details?: string; location?: string;
  start_at: number; end_at?: number | null; all_day?: boolean | number; uid?: string;
}

// --- iCalendar ---------------------------------------------------------------

function pad(n: number) { return String(n).padStart(2, '0'); }
function toUtcStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function toDateStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
function esc(s: string): string {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function unesc(s: string): string {
  return String(s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

export function generateIcs(events: CalEvent[]): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DAWN//Calendar//EN', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    const allDay = !!e.all_day;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid || e.id || cryptoRandom()}@dawn.local`);
    lines.push(`DTSTAMP:${toUtcStamp(Date.now())}`);
    if (allDay) {
      lines.push(`DTSTART;VALUE=DATE:${toDateStamp(e.start_at)}`);
      lines.push(`DTEND;VALUE=DATE:${toDateStamp((e.end_at || e.start_at) + 86400000)}`);
    } else {
      lines.push(`DTSTART:${toUtcStamp(e.start_at)}`);
      lines.push(`DTEND:${toUtcStamp(e.end_at || e.start_at + 3600000)}`);
    }
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.details) lines.push(`DESCRIPTION:${esc(e.details)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function cryptoRandom() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

/** Parse an .ics string into events (best-effort; handles line folding, DATE vs DATE-TIME, TZID/Z). */
export function parseIcs(text: string): CalEvent[] {
  const unfolded = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); // RFC5545 line unfolding
  const events: CalEvent[] = [];
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  for (const b of blocks) {
    const ev: CalEvent = { title: '', start_at: 0 };
    let allDay = false;
    for (const line of b.split('\n')) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const left = line.slice(0, idx);
      const value = line.slice(idx + 1).trim();
      const [name, ...paramParts] = left.split(';');
      const params = paramParts.join(';');
      switch (name.toUpperCase()) {
        case 'SUMMARY': ev.title = unesc(value); break;
        case 'DESCRIPTION': ev.details = unesc(value); break;
        case 'LOCATION': ev.location = unesc(value); break;
        case 'UID': ev.uid = value; break;
        case 'DTSTART': { const r = parseIcsDate(value, params); ev.start_at = r.ms; allDay = r.allDay; break; }
        case 'DTEND': { const r = parseIcsDate(value, params); ev.end_at = r.ms; break; }
      }
    }
    ev.all_day = allDay;
    if (allDay && ev.end_at) ev.end_at = ev.end_at - 86400000; // DTEND is exclusive for all-day
    if (ev.title && ev.start_at) events.push(ev);
  }
  return events;
}

function parseIcsDate(value: string, params: string): { ms: number; allDay: boolean } {
  const dateOnly = /VALUE=DATE/i.test(params) || /^\d{8}$/.test(value);
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return { ms: 0, allDay: dateOnly };
  const [, y, mo, d, hh = '0', mm = '0', ss = '0', z] = m;
  if (dateOnly) return { ms: new Date(+y, +mo - 1, +d).getTime(), allDay: true };
  if (z) return { ms: Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss), allDay: false };
  return { ms: new Date(+y, +mo - 1, +d, +hh, +mm, +ss).getTime(), allDay: false }; // floating/TZID → treat as local
}

// --- date grids --------------------------------------------------------------

export function startOfDay(ms: number): number { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
export function endOfDay(ms: number): number { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime(); }
export function addDays(ms: number, n: number): number { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }

/** 6×7 day grid (timestamps at local midnight) for the month containing `ms`, weeks starting Sunday. */
export function monthGrid(ms: number): number[] {
  const d = new Date(ms); d.setDate(1); d.setHours(0, 0, 0, 0);
  const first = d.getTime();
  const start = addDays(first, -new Date(first).getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
/** 7 day cells for the week containing `ms` (Sunday start). */
export function weekGrid(ms: number): number[] {
  const s = startOfDay(addDays(ms, -new Date(ms).getDay()));
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}
export function sameDay(a: number, b: number): boolean {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

// --- CalDAV provider interface (optional, off by default; NOT implemented) ---

export interface CalendarProvider {
  id: string;
  name: string;
  /** pull remote events within a range */
  fetch(rangeStart: number, rangeEnd: number): Promise<CalEvent[]>;
  /** push a local event upstream */
  push(event: CalEvent): Promise<{ ok: boolean; uid?: string; error?: string }>;
}

export default { generateIcs, parseIcs, startOfDay, endOfDay, addDays, monthGrid, weekGrid, sameDay };
