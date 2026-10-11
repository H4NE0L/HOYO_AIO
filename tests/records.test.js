import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { md5, recordHeaders } from '../extension/lib/md5.js';
import { getAccounts, syncRecord, normalizeContent } from '../extension/lib/records.js';
const ok = data => ({ ok: true, json: async () => ({ retcode: 0, data }) });
const role = { game_biz: 'hkrpg_global', game_uid: '800000001', region: 'prod_official_asia', region_name: 'Asia', nickname: '개척자', level: 70 };
test('MD5 request signing matches standard vectors including multi-block UTF-8', () => {
  for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), '여행자'.repeat(100)]) assert.equal(md5(text), createHash('md5').update(text).digest('hex'));
  const headers = recordHeaders(1234567890000, 'abcdef');
  const digest = createHash('md5').update('salt=6s25p5ox5y14umn1p61aqyyvbvvl3lrt&t=1234567890&r=abcdef').digest('hex');
  assert.equal(headers.ds, `1234567890,abcdef,${digest}`);
});
test('binding roles are selected only from matching game, with preferred UID/server', async () => {
  const roles = [{ ...role, game_biz: 'hk4e_global' }, role, { ...role, game_uid: '800000002', level: 20 }, { ...role, region: 'not valid' }];
  const accounts = await getAccounts('starrail', async (url, opts) => {
    assert.equal(opts.credentials, 'include'); assert.ok(opts.headers.ds); assert.match(url, /game_biz=hkrpg_global/);
    return ok({ list: roles });
  });
  assert.deepEqual(accounts.map(account => account.uid), ['800000001', '800000002']);
  const result = await syncRecord('starrail', '800000002:prod_official_asia', async url => {
    if (url.includes('binding/')) return ok({ list: roles });
    assert.match(url, /role_id=800000002/);
    if (url.includes('/index?')) return ok({ stats: { active_days: 12, avatar_num: 4, achievement_num: 50 }, avatar_list: [{ id: 1001, name: '캐릭터', rarity: 5, level: 80 }] });
    return ok({ has_data: true, schedule_id: 42, star_num: 12, max_floor: '4', battle_num: 2, all_floor_detail: [{ maze_id: 4, name: '4층', star_num: 3, node_1: { score: 30000, avatars: [{ id: 1001, level: 80 }] } }] });
  });
  assert.equal(result.account.uid, '800000002'); assert.equal(result.profile.activeDays, 12); assert.equal(result.content.length, 6);
  assert.equal(result.content[0].floors[0].stages[0].score, 30000);
});
test('profile privacy and one mode failure preserve basic UID and other records', async () => {
  const result = await syncRecord('starrail', undefined, async url => {
    if (url.includes('binding/')) return ok({ list: [role] });
    if (url.includes('/index?')) return { ok: true, json: async () => ({ retcode: 10102 }) };
    if (url.includes('/challenge_story?')) return { ok: false, status: 503 };
    return ok({ has_data: false, schedule_id: 1, star_num: 0 });
  });
  assert.equal(result.account.uid, role.game_uid); assert.equal(result.profile, null); assert.match(result.profileError, /공개 설정/);
  assert.equal(result.content.filter(item => item.error).length, 2); assert.equal(result.content.filter(item => item.hasData === false).length, 4);
});
test('login expiration and unlinked accounts fail without misattributing cached data', async () => {
  await assert.rejects(getAccounts('genshin', async () => ({ ok: true, json: async () => ({ retcode: 10001 }) })), { kind: 'login' });
  await assert.rejects(syncRecord('starrail', undefined, async () => ok({ list: [] })), { kind: 'unlinked' });
});
test('genshin profile, abyss teams, and theater medals/acts use distinct schemas', async () => {
  const calls = [];
  const result = await syncRecord('genshin', undefined, async url => {
    calls.push(url);
    if (url.includes('binding/')) return ok({ list: [{ ...role, game_biz: 'hk4e_global', game_uid: '800000003', region: 'os_asia' }] });
    if (url.includes('/index?')) return ok({ stats: { active_day_number: 500, avatar_number: 65, achievement_number: 900 }, avatars: [] });
    if (url.includes('/spiralAbyss?')) return ok({ schedule_id: 7, total_star: 36, max_floor: '12-3', floors: [{ index: 12, star: 9, levels: [{ index: 3, star: 3, battles: [{ avatars: [{ name: '여행자', level: 90 }] }] }] }] });
    return ok({ data: [{ schedule: { schedule_id: 8 }, has_data: true, has_detail_data: true, stat: { medal_num: 10, max_round_id: 10 }, detail: { rounds_data: [{ round_id: 1, is_get_medal: true, avatars: [{ name: '여행자', level: 90 }] }] } }] });
  });
  assert.equal(result.profile.achievements, 900); assert.equal(result.content[0].floors[0].stages[0].teams[0][0].name, '여행자');
  const theater = result.content.find(item => item.mode === 'theater'); assert.equal(theater.stars, 10); assert.equal(theater.floors[0].name, '제1막');
  assert.equal(calls.filter(url => url.includes('/role_combat?')).length, 1);
  assert.throws(() => normalizeContent('starrail', { id: 'chaos' }, {}), { kind: 'api' });
});
