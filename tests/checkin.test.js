import test from 'node:test';
import assert from 'node:assert/strict';
import { checkIn } from '../extension/lib/checkin.js';
import { dayKey, settingsFrom, shouldAttempt } from '../extension/lib/state.js';

function mock(responses) {
  const calls = [];
  return { calls, fetch: async (url, options) => {
    calls.push({ url, options });
    assert.ok(responses.length, 'unexpected additional API request');
    const payload = responses.shift();
    return { ok: true, json: async () => payload };
  } };
}
const ok = data => ({ retcode: 0, data });
test('both games verify successful check-in and use authenticated requests', async () => {
  for (const id of ['genshin', 'starrail']) {
    const api = mock([ok({ is_sign: false }), ok({ risk_code: 0 }), ok({ is_sign: true, total_sign_day: 3 })]);
    assert.deepEqual(await checkIn(id, api.fetch), { status: 'success', days: 3 });
    assert.equal(api.calls.length, 3);
    assert.equal(api.calls[0].options.credentials, 'include');
    assert.equal(api.calls[1].options.method, 'POST');
    assert.equal(JSON.parse(api.calls[1].options.body).act_id, new URL(api.calls[0].url).searchParams.get('act_id'));
    assert.equal(api.calls[1].options.headers['x-rpc-signgame'], id === 'genshin' ? 'hk4e' : 'hkrpg');
  }
});
test('already signed accounts never receive a sign POST', async () => {
  const api = mock([ok({ is_sign: true, total_sign_day: 5 })]);
  assert.equal((await checkIn('genshin', api.fetch)).status, 'already');
  assert.equal(api.calls.length, 1);
});
test('concurrent official check-in is verified after already-claimed response', async () => {
  const api = mock([ok({ is_sign: false }), { retcode: -5003 }, ok({ is_sign: true, total_sign_day: 4 })]);
  assert.equal((await checkIn('starrail', api.fetch)).status, 'success');
});
test('expired login, captcha, malformed responses, and unconfirmed signs are failures', async () => {
  for (const [responses, kind] of [
    [[{ retcode: 10001 }], 'login'],
    [[ok({ is_sign: false }), ok({ gt_result: { risk_code: 1, gt: 'captcha' } })], 'verification'],
    [[ok({ is_sign: false }), ok({ risk_code: 1 })], 'verification'],
    [[{ hello: 'world' }], 'api'],
    [[ok({ is_sign: 'false' })], 'api'],
    [[ok({ is_sign: false }), { retcode: -999, message: 'secret response' }], 'api'],
    [[ok({ is_sign: false }), ok({}), ok({ is_sign: false })], 'api'],
  ]) {
    await assert.rejects(checkIn('genshin', mock(responses).fetch), error => error.kind === kind && !error.message.includes('secret response'));
  }
});
test('HTTP and fetch failures are retriable network failures', async () => {
  await assert.rejects(checkIn('genshin', async () => { throw new Error('timeout'); }), { kind: 'network' });
  await assert.rejects(checkIn('genshin', async () => ({ ok: false, status: 503 })), { kind: 'network' });
});
test('UTC+8 daily boundary is 01:00 Korean time', () => {
  assert.equal(dayKey(Date.parse('2026-10-10T15:59:59Z')), '2026-10-10');
  assert.equal(dayKey(Date.parse('2026-10-10T16:00:00Z')), '2026-10-11');
});
test('scheduler suppresses repeated signs and login/captcha errors, retries network errors', () => {
  const now = Date.parse('2026-10-10T17:00:00Z');
  for (const status of ['success', 'already', 'login', 'verification', 'api']) {
    assert.equal(shouldAttempt({ status, day: dayKey(now), at: now - 7200000 }, now), false);
  }
  assert.equal(shouldAttempt({ status: 'network', day: dayKey(now), at: now - 3599999 }, now), false);
  assert.equal(shouldAttempt({ status: 'network', day: dayKey(now), at: now - 3600000 }, now), true);
  assert.equal(shouldAttempt({ status: 'success', day: '2026-10-10', at: now - 3600000 }, now), true);
  assert.equal(shouldAttempt(undefined, now), true);
  assert.deepEqual(settingsFrom(), { auto: false, games: { genshin: true, starrail: true } });
});
