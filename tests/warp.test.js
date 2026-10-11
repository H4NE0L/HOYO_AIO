import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWarpPool, warpVersion, syncWarp, officialImage, pitySummary } from '../extension/lib/warp.js';
test('official statistics retain version counts, current pity, and last featured result', () => {
  const data = normalizeWarpPool([{ version: '4.2', total_count: 42 }], [
    { got_item: false, gacha_count: 17 },
    { got_item: true, id: '9007199254740994', is_up: false, gacha_count: 75, item: { name: '캐릭터', icon: 'https://act-webstatic.hoyoverse.com/a.png' } },
    { got_item: true, id: '9007199254740993', is_up: true, item: {} },
  ], 90);
  assert.equal(data.pity, 17); assert.equal(data.guaranteed, true);
  assert.equal(data.recent[0].name, '캐릭터');
  assert.match(pitySummary('character', data), /픽업 확정까지 최대 73회/);
  assert.equal(normalizeWarpPool([], [], 90).guaranteed, null);
  assert.equal(normalizeWarpPool([], [{ got_item: false, gacha_count: 80 }], 80).pity, null);
  assert.equal(officialImage('https://hoyoverse.com.evil.example/a'), null);
  assert.equal(officialImage('https://user:pass@hoyoverse.com/a'), null);
  const calendar = { version: '4.2', start: 1, end: 100 };
  const result = warpVersion({ pools: { character: data, weapon: { cards: [{ version: '4.1', count: 999 }] } } }, calendar, 50);
  assert.equal(result.character, 42); assert.equal(result.weapon, null); assert.equal(result.total, null);
  assert.equal(warpVersion({ pools: {} }, calendar, 101), null);
});
test('official warp sync uses browser cookies, paginates and isolates pool failures', async () => {
  const calls = [];
  const result = await syncWarp({ uid: '800000001', region: 'prod_official_asia' }, async (url, options) => {
    calls.push({ url, options });
    const u = new URL(url);
    let data = {};
    if (u.pathname.endsWith('pool_stat')) {
      if (u.searchParams.get('gacha_type') === 'GachaType_Standard') return { ok: true, json: async () => ({ retcode: -100 }) };
      data = { cards: [{ version: '4.2', total_count: 5 }] };
    }
    if (u.pathname.endsWith('five_star_list')) data = u.searchParams.has('max_id')
      ? { list: [{ got_item: true, id: '5', is_up: false, item: { name: '5성' } }], has_more: false }
      : { list: [{ got_item: false, gacha_count: 2 }], has_more: true, version_id: 42, next_max_id: '10' };
    return { ok: true, json: async () => ({ retcode: 0, data }) };
  });
  assert.equal(calls[0].options.method, 'POST');
  assert.ok(calls.every(call => call.options.credentials === 'include'));
  assert.equal(result.pools.character.guaranteed, true);
  assert.equal(result.pools.weapon.pity, 2);
  assert.ok(result.pools.standard.error);
  assert.ok(calls.some(call => call.url.includes('max_id=10')));
});
