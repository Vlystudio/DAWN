/**
 * Tests for Calendar pure core (no electron): .ics round-trip (generate↔parse),
 * all-day handling, and date-grid math. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import cal from '../electron/services/calendar/calCore';

test('ics round-trip preserves title/details/time', () => {
  const start = Date.UTC(2026, 0, 15, 14, 30, 0);
  const ics = cal.generateIcs([{ title: 'Team sync, weekly', details: 'line1\nline2', location: 'HQ', start_at: start, end_at: start + 3600000, uid: 'abc' }]);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:Team sync\\, weekly/); // comma escaped
  const parsed = cal.parseIcs(ics);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'Team sync, weekly');
  assert.equal(parsed[0].details, 'line1\nline2');
  assert.equal(parsed[0].start_at, start);
  assert.equal(parsed[0].uid, 'abc@dawn.local');
});

test('all-day events use DATE value and parse back as all-day', () => {
  const day = new Date(2026, 5, 1).getTime();
  const ics = cal.generateIcs([{ title: 'Holiday', start_at: day, all_day: true }]);
  assert.match(ics, /DTSTART;VALUE=DATE:20260601/);
  const p = cal.parseIcs(ics)[0];
  assert.equal(p.all_day, true);
  assert.equal(new Date(p.start_at).getDate(), 1);
});

test('parseIcs handles line folding and floating (local) times', () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:x', 'DTSTART:20260310T090000', 'SUMMARY:Folded ', ' continuation', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const p = cal.parseIcs(ics);
  assert.equal(p.length, 1);
  assert.equal(p[0].title, 'Folded continuation');           // unfolded
  assert.equal(new Date(p[0].start_at).getHours(), 9);        // local 09:00
});

test('monthGrid is 42 days starting Sunday; weekGrid is 7; sameDay works', () => {
  const grid = cal.monthGrid(new Date(2026, 0, 15).getTime());
  assert.equal(grid.length, 42);
  assert.equal(new Date(grid[0]).getDay(), 0); // Sunday
  assert.equal(cal.weekGrid(Date.now()).length, 7);
  assert.ok(cal.sameDay(Date.now(), Date.now() + 1000));
  assert.ok(!cal.sameDay(Date.now(), cal.addDays(Date.now(), 1)));
});
