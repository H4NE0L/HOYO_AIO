import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCalendar, summarizeVersion, mergeCalendar } from '../extension/lib/calendar.js';
const start = Date.parse('2026-10-01T03:00:00Z'), end = Date.parse('2026-10-20T09:59:59Z'), now = Date.parse('2026-10-11T00:00:00Z');
const banner = (name = '픽업') => ({ version_name: '5.1', pool_name: name, start_timestamp: start / 1000, end_timestamp: end / 1000 });
test('Genshin calendar derives current version from active banners and merges simultaneous windows', () => {
  const calendar = normalizeCalendar('genshin', { avatar_card_pool_list: [banner('캐릭터 A'), banner('캐릭터 B')], weapon_card_pool_list: [banner('무기')], mixed_card_pool_list: [] }, now);
  assert.equal(calendar.version, '5.1'); assert.equal(calendar.start, start); assert.equal(calendar.end, end);
  const records = [
    { pool: 'character', at: start }, { pool: 'weapon', at: now }, { pool: 'standard', at: now }, { pool: 'beginner', at: now },
    { pool: 'character', at: start - 1 }, { pool: 'weapon', at: end + 1 }, { pool: 'character', at: now + 1 },
  ];
  const result = summarizeVersion(records, calendar, now); assert.equal(result.total, 3); assert.equal(result.character, 1); assert.equal(result.weapon, 1);
  assert.equal(summarizeVersion([{ pool: 'character', at: end }], calendar, end).total, 1);
});
test('Star Rail uses declared version and server timestamps without mixing past/future versions', () => {
  const warp = { avatar_list: [{ rarity: 5, item_name: '픽업 캐릭터' }, { rarity: 4, item_name: '4성' }], version: '4.2', name: '캐릭터', time_info: { start_ts: String(start / 1000), end_ts: String(end / 1000) } };
  const calendar = normalizeCalendar('starrail', { cur_game_version: '4.2', avatar_card_pool_list: [warp, { ...warp, version: '4.1' }], equip_card_pool_list: [warp] }, now);
  assert.equal(calendar.version, '4.2'); assert.deepEqual(calendar.periods[0].featured, ['픽업 캐릭터']); assert.equal(calendar.periods.length, 2);
  assert.equal(summarizeVersion([{ pool: 'weapon', at: now }], calendar, now).weapon, 1);
});
test('missing records, unavailable schedules, and stale schedules never pretend to be zero pulls', () => {
  const calendar = normalizeCalendar('genshin', { avatar_card_pool_list: [banner()], weapon_card_pool_list: [] }, now);
  assert.equal(summarizeVersion(undefined, calendar, now).status, 'records-missing');
  assert.equal(summarizeVersion([], undefined, now).status, 'schedule-missing');
  assert.equal(summarizeVersion([], calendar, end + 1).status, 'schedule-stale');
  assert.equal(summarizeVersion([], calendar, start - 1).status, 'schedule-stale');
  assert.equal(summarizeVersion([], calendar, now).total, 0, 'an imported empty list is a known zero');
  assert.throws(() => normalizeCalendar('genshin', { avatar_card_pool_list: [{ ...banner(), start_timestamp: 0 }] }, now));
});
test('same-version phase history is retained and a new version replaces it', () => {
  const previous = normalizeCalendar('genshin', { avatar_card_pool_list: [banner('첫 픽업')], weapon_card_pool_list: [] }, now);
  const next = { ...previous, periods: [{ ...previous.periods[0], name: '다음 픽업', start: end + 1, end: end + 10 * 86400000 }] };
  const merged = mergeCalendar(previous, next); assert.equal(merged.periods.length, 2);
  assert.equal(merged.start, start); assert.equal(merged.end, end + 10 * 86400000);
  assert.equal(mergeCalendar(merged, next).periods.length, 2);
  assert.deepEqual(mergeCalendar(merged, null), merged);
  assert.equal(mergeCalendar(merged, { ...next, version: '5.2' }).periods.length, 1);
});
