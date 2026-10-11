import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImport, mergeRecords, summarize, planBudget, scheduleDays } from '../extension/lib/gacha.js';
const record = { id: '100000000000000001', gacha_type: '11', rank_type: '5', name: '개척자', time: '2026-10-11 00:00:00' };
test('UIGF4 and SRGF records stay separated by game/UID and retain exact IDs/time zones', () => {
  const data = parseImport({ hkrpg: [{ uid: '800000001', timezone: 8, list: [record] }] }, 'starrail');
  assert.equal(data[0].records[0].id, record.id); assert.equal(data[0].records[0].at, Date.parse('2026-10-10T16:00:00Z'));
  assert.equal(parseImport({ info: { uid: '800000001', timezone: 9 }, list: [record] }, 'starrail')[0].records[0].at, Date.parse('2026-10-10T15:00:00Z'));
  assert.throws(() => parseImport({ hkrpg: [{ uid: '800000001', list: [record] }] }, 'genshin'));
});
test('duplicates merge, large string IDs sort correctly, and character banners share pity', () => {
  const records = parseImport({ hk4e: [{ uid: '800000001', list: [
    { ...record, gacha_type: '301', id: '100000000000000002', rank_type: '3' },
    { ...record, gacha_type: '400', id: '100000000000000001' },
  ] }] }, 'genshin')[0].records;
  const merged = mergeRecords([], records); assert.equal(merged[0].rank, 5);
  assert.equal(mergeRecords(merged, records).length, 2);
  const summary = summarize(merged, Date.parse('2026-10-11T00:00:00Z'));
  assert.equal(summary.recent, 2); assert.equal(summary.pools[0].pity, 1); assert.equal(summary.pools[0].known, true);
});
test('wrong UID, numeric IDs, malformed dates, and unknown banners are rejected atomically', () => {
  for (const change of [{ uid: '800000002' }, { id: 100000000000000001 }, { time: '2026-02-30 00:00:00' }, { rank_type: '6' }, { gacha_type: '301' }]) {
    assert.throws(() => parseImport({ info: { uid: '800000001' }, list: [{ ...record, ...change }] }, 'starrail'));
  }
  const unknown = summarize([{ pool: 'character', rank: 3, at: 0 }]); assert.equal(unknown.pools[0].known, false);
});
test('planner is a hard-pity upper bound and distinguishes guaranteed featured', () => {
  assert.deepEqual(planBudget({ currency: 1600, tickets: 2, pity: 20, guaranteed: true }), { available: 12, nextFive: 70, featured: 70, shortfall: 58 });
  assert.equal(planBudget({ pity: 20 }).featured, 160);
  for (const value of [-1, 90, 0.5, NaN]) assert.throws(() => planBudget({ pity: value }));
});
test('schedule countdown uses Korean calendar days and rejects impossible dates', () => {
  assert.equal(scheduleDays('2026-10-12', Date.parse('2026-10-11T14:59:00Z')), 1);
  assert.equal(scheduleDays('2026-10-12', Date.parse('2026-10-11T15:00:00Z')), 0);
  assert.equal(scheduleDays('2026-02-30'), null);
});
