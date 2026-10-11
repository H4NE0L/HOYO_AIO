import test from 'node:test';
import assert from 'node:assert/strict';
import { contentTime, deadline } from '../extension/lib/deadlines.js';
import { normalizeContent } from '../extension/lib/records.js';
test('official server times and Korean D-days respect reset boundaries and missing data', () => {
  const parts = { year: 2026, month: 10, day: 12, hour: 4, minute: 0 };
  const end = contentTime(parts, 'prod_official_asia');
  assert.equal(end, Date.parse('2026-10-11T20:00:00Z'));
  assert.equal(contentTime(parts, 'prod_official_usa'), Date.parse('2026-10-12T09:00:00Z'));
  assert.equal(contentTime(parts, 'unknown'), null);
  assert.equal(contentTime({ ...parts, month: 13 }, 'prod_official_asia'), null);
  assert.equal(deadline(end, Date.parse('2026-10-11T14:00:00Z')), 'D-1');
  assert.equal(deadline(end, Date.parse('2026-10-11T15:00:00Z')), 'D-DAY');
  assert.match(deadline(end, end), /기간 종료/);
  assert.equal(deadline(null), '일정 확인 필요');
  const mode = { id: 'fiction', name: '허구 이야기' };
  const item = normalizeContent('starrail', mode, { has_data: false, star_num: 0, groups: [{ schedule_id: 1, end_time: parts }] }, 'prod_official_asia')[0];
  assert.equal(item.end, end); assert.equal(item.season, '1');
});
test('anomaly arbitration uses per-season results rather than lifetime best summary', () => {
  const result = normalizeContent('starrail', { id: 'anomaly', name: '이상중재' }, {
    challenge_peak_best_record_brief: { boss_stars: 99 },
    challenge_peak_records: [{ group: { group_id: 42, end_time: { year: 2026, month: 10, day: 12, hour: 4, minute: 0 } }, has_challenge_record: true, boss_stars: 3, mob_stars: 9 }],
  }, 'prod_official_asia');
  assert.equal(result[0].stars, 12); assert.equal(result[0].season, '42'); assert.ok(result[0].end);
});
test('Stygian Onslaught retains its actual single-player difficulty and season deadline', () => {
  const mode = { id: 'onslaught', name: '지맥제압전' };
  const [item] = normalizeContent('genshin', mode, { schedule: { schedule_id: 5, start_time: 1791000000, end_time: 1792000000 }, single: { has_data: true, best: { difficulty: 5 } }, mp: { best: { difficulty: 6 } } }, 'os_asia');
  assert.equal(item.summary, '난이도 5'); assert.equal(item.stars, null); assert.equal(item.end, 1792000000000);
  assert.throws(() => normalizeContent('genshin', mode, {}), /형식/);
});
