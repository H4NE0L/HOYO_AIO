import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyConnection } from '../extension/lib/connection.js';
function fail(kind) { const error = new Error(`error-${kind}`); error.kind = kind; throw error; }
test('connection is verified by authenticated role requests, not cached profiles', async () => {
  const result = await verifyConnection(undefined, async game => [{ uid: game === 'genshin' ? '800000001' : '800000002' }]);
  assert.equal(result.connected, true); assert.equal(result.needsLogin, false);
  assert.equal(result.accounts.genshin[0].uid, '800000001'); assert.equal(result.accounts.starrail[0].uid, '800000002');
  assert.equal(typeof result.verifiedAt, 'number');
});
test('an expired session reveals the connection button even when previously connected', async () => {
  const result = await verifyConnection({ connected: true, accounts: { genshin: [{ uid: '800000001' }] } }, async () => fail('login'));
  assert.equal(result.connected, false); assert.equal(result.needsLogin, true); assert.deepEqual(result.accounts, {});
});
test('network failure keeps known connection metadata without claiming fresh verification', async () => {
  const previous = { connected: true, accounts: { genshin: [{ uid: '800000001' }] }, verifiedAt: 123 };
  const result = await verifyConnection(previous, async () => fail('network'));
  assert.equal(result.connected, true); assert.equal(result.verifiedAt, 123); assert.ok(result.error);
  const first = await verifyConnection(undefined, async () => fail('network'));
  assert.equal(first.connected, false); assert.equal(first.needsLogin, false);
});
test('no game roles still verifies login, and one game failure does not reuse stale roles', async () => {
  const result = await verifyConnection({ accounts: { starrail: [{ uid: 'old' }] } }, async game => game === 'genshin' ? [] : fail('network'));
  assert.equal(result.connected, true); assert.deepEqual(result.accounts.starrail, []); assert.deepEqual(result.accounts.genshin, []); assert.ok(result.gameErrors.starrail);
});
