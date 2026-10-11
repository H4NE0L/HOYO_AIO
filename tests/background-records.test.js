import test from 'node:test';
import assert from 'node:assert/strict';

test('background persists concurrent game syncs, archives by account, and imports records atomically', async () => {
  const stored = {}, handlers = {};
  let cycle = 1, loggedIn = true;
  const event = name => ({ addListener(fn) { handlers[name] = fn; } });
  globalThis.chrome = {
    runtime: { id: 'test-extension', onInstalled: event('install'), onStartup: event('startup'), onMessage: event('message') },
    storage: { local: {
      async get(keys) { const result = Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(stored[key])])); await Promise.resolve(); return result; },
      async set(value) { Object.assign(stored, structuredClone(value)); },
    } },
    declarativeNetRequest: { async updateDynamicRules() {} },
    alarms: { onAlarm: event('alarm'), async get() { return { name: 'hoyo-checkin' }; } },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const genshin = url.includes('genshin') || url.includes('game_biz=hk4e');
    const data = url.includes('binding/') ? { list: [{ game_biz: genshin ? 'hk4e_global' : 'hkrpg_global', game_uid: genshin ? '800000001' : '800000002', region: genshin ? 'os_asia' : 'prod_official_asia', level: 60 }] }
      : url.includes('/index?') ? { stats: { active_days: 1 }, avatar_list: [] }
      : url.includes('role_combat') ? { data: [{ schedule: { schedule_id: cycle }, has_data: true, stat: { medal_num: 10 } }] }
      : { has_data: true, schedule_id: cycle * 10 + Number(new URL(url).searchParams.get('schedule_type')), star_num: 3, total_star: 3, all_floor_detail: [], floors: [] };
    return { ok: true, json: async () => loggedIn ? { retcode: 0, data } : { retcode: 10001 } };
  };
  const send = message => new Promise(resolve => handlers.message(message, { id: 'test-extension' }, resolve));
  try {
    await import('../extension/background.js');
    const replies = await Promise.all(['genshin', 'starrail'].map(game => send({ type: 'sync-record', game })));
    assert.ok(replies.every(reply => reply.ok));
    assert.deepEqual(Object.keys(stored.profiles).sort(), ['genshin', 'starrail'], 'parallel writes preserve both games');
    const key = stored.profiles.starrail.key;
    assert.equal(stored[key].archive.length, 6);
    cycle = 2;
    assert.equal((await send({ type: 'sync-record', game: 'starrail' })).ok, true);
    assert.equal(stored[key].archive.length, 12);
    loggedIn = false;
    assert.equal((await send({ type: 'sync-record', game: 'starrail' })).ok, false);
    assert.equal(stored.profiles.starrail.key, key); assert.match(stored.profiles.starrail.error, /로그인/); assert.equal(stored[key].archive.length, 12);
    const document = { info: { uid: '800000002' }, list: [{ id: '100000000000000001', name: '워프 캐릭터', gacha_type: '11', rank_type: '5', time: '2026-10-11 00:00:00' }] };
    const imports = await Promise.all([send({ type: 'import-gacha', game: 'starrail', document }), send({ type: 'import-gacha', game: 'starrail', document })]);
    assert.deepEqual(imports.map(reply => reply.count), [1, 0]);
    assert.equal(stored['gacha:starrail:800000002'].records.length, 1);
    const before = structuredClone(stored['gacha:starrail:800000002']);
    const malformed = { ...document, list: [...document.list, { ...document.list[0], id: 123 }] };
    assert.equal((await send({ type: 'import-gacha', game: 'starrail', document: malformed })).ok, false);
    assert.deepEqual(stored['gacha:starrail:800000002'], before, 'invalid import leaves existing records unchanged');
    assert.equal((await send({ type: 'save-plan', game: 'starrail', plan: { currency: 160, tickets: 1, pity: 0, guaranteed: false, name: '목표', date: '2026-10-20' } })).ok, true);
    assert.equal(stored['plan:starrail'].name, '목표');
    assert.equal((await send({ type: 'save-plan', game: 'starrail', plan: { pity: 90 } })).ok, false);
  } finally { globalThis.fetch = originalFetch; delete globalThis.chrome; }
});
