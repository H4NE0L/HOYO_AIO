import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey } from '../extension/lib/state.js';

test('service worker initializes alarms, isolates failures, and runs automatic checks without duplicates', async () => {
  const handlers = {};
  const event = name => ({ addListener(fn) { handlers[name] = fn; } });
  const stored = {};
  let rules, alarm;
  globalThis.chrome = {
    runtime: { id: 'test-extension', onInstalled: event('install'), onStartup: event('startup'), onMessage: event('message') },
    storage: { local: {
      async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(stored[key])])); },
      async set(value) { Object.assign(stored, structuredClone(value)); },
    } },
    declarativeNetRequest: { async updateDynamicRules(value) { rules = value; } },
    alarms: { onAlarm: event('alarm'), async get() { return alarm; }, async create(name, value) { alarm = { name, ...value }; } },
  };
  const originalFetch = globalThis.fetch;
  const calls = [];
  let signed = false;
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    const genshin = url.includes('sg-hk4e-api');
    if (options.method === 'POST') signed = true;
    return { ok: true, json: async () => genshin ? { retcode: 10001 } : {
      retcode: 0, data: options.method === 'POST' ? { risk_code: 0 } : { is_sign: signed, total_sign_day: 2 },
    } };
  };
  const send = message => new Promise(resolve => {
    assert.equal(handlers.message(message, { id: 'test-extension' }, resolve), true);
  });
  try {
    await import('../extension/background.js');
    assert.deepEqual(await send({ type: 'wake' }), { ok: true });
    assert.equal(calls.length, 0, 'automatic execution is off by default');
    assert.equal(rules.addRules.length, 5);
    assert.deepEqual(rules.addRules[0].condition.initiatorDomains, ['test-extension']);
    assert.equal(alarm.periodInMinutes, 30);
    assert.deepEqual(await send({ type: 'checkin' }), { ok: true });
    assert.equal(stored.results.genshin.status, 'login');
    assert.equal(stored.results.starrail.status, 'success', 'one game failure does not stop the other');
    assert.equal(stored.results.starrail.day, dayKey());
    const count = calls.length;
    await send({ type: 'settings', settings: { auto: true } });
    await send({ type: 'wake' });
    assert.equal(calls.length, count, 'completed and login-blocked games are not retried today');
    stored.results = {};
    await send({ type: 'settings', settings: { auto: false } });
    await Promise.all([send({ type: 'wake' }), send({ type: 'checkin' })]);
    assert.equal(stored.results.starrail.status, 'already', 'manual request survives overlap with disabled automatic run');
    stored.results = {};
    await send({ type: 'settings', settings: { auto: true } });
    await send({ type: 'wake' });
    assert.equal(stored.results.starrail.status, 'already');
    assert.equal(handlers.message({ type: 'checkin' }, { id: 'foreign' }, () => {}), undefined);
  } finally { globalThis.fetch = originalFetch; delete globalThis.chrome; }
});
