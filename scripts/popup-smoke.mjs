// Popup browser checks with simulated Chrome APIs; no real account data or sign POSTs.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (!/^\/[a-zA-Z0-9/.-]+$/.test(path) || path.includes('..')) { res.writeHead(404).end(); return; }
  try {
    const content = await readFile(new URL(`../extension${path}`, import.meta.url));
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html'); res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 460, height: 600 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const stored = JSON.parse(localStorage.getItem('mock-storage') ?? '{}');
    const listeners = [];
    const roles = { genshin: [{ uid: '800000001', region: 'os_asia', nickname: '여행자', level: 60 }], starrail: [{ uid: '800000002', region: 'prod_official_asia', nickname: '개척자', level: 70 }] };
    window.mockMessages = [];
    window.mockStorage = stored;
    function update(value) { Object.assign(stored, value); localStorage.setItem('mock-storage', JSON.stringify(stored)); listeners.forEach(fn => fn(value, 'local')); }
    window.chrome = {
      tabs: { async create(options) { window.openedLoginUrl = options.url; localStorage.setItem('mock-login', 'true'); } },
      storage: { local: { async get() { return structuredClone(stored); }, async set(value) { update(value); } }, onChanged: { addListener(fn) { listeners.push(fn); } } },
      runtime: { async sendMessage(message) {
        window.mockMessages.push(message);
        if (['connection-status', 'connect-hoyolab'].includes(message.type)) {
          const connected = localStorage.getItem('mock-login') === 'true';
          const connection = { connected, needsLogin: !connected, accounts: connected ? roles : {}, ...(connected ? {} : { error: '호요랩 로그인이 필요합니다.' }) };
          update({ connection }); return { ok: true, connection };
        }
        if (message.type === 'settings') {
          const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
          const results = { ...stored.results };
          for (const [game, enabled] of Object.entries(message.settings.games)) if (message.settings.auto && enabled) results[game] = { status: 'success', days: 3, at: Date.now(), day };
          update({ settings: message.settings, results });
        }
        if (message.type === 'sync-record') {
          const account = roles[message.game][0], key = `record:${message.game}:${account.uid}:${account.region}`;
          update({ [key]: { account, at: Date.now(), profile: { activeDays: 100, characterCount: 30, achievements: 500 }, content: [{ mode: 'chaos', name: '혼돈의 기억', period: 1, stars: 12, progress: '4', hasData: true }], calendar: { version: 'test-version', source: 'hoyolab', at: Date.now(), start: Date.now() - 7 * 86400000, end: Date.now() + 7 * 86400000, periods: ['character', 'weapon'].map(pool => ({ pool, name: '테스트 픽업', start: Date.now() - 7 * 86400000, end: Date.now() + 7 * 86400000 })) } },
            profiles: { ...stored.profiles, [message.game]: { key, selected: `${account.uid}:${account.region}` } },
            [`gacha:${message.game}:${account.uid}`]: { uid: account.uid, records: [{ pool: 'character', rank: 5, at: Date.now() }, { pool: 'weapon', rank: 4, at: Date.now() }, { pool: 'standard', rank: 3, at: Date.now() }, { pool: 'character', rank: 3, at: Date.now() - 20 * 86400000 }] },
          });
        }
        return { ok: true };
      } },
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
  await page.waitForFunction(() => document.querySelector('#connect').disabled === false);
  assert.match(await page.locator('h1').textContent(), /HOYO All-in-one/);
  assert.equal(await page.locator('.dashboard-link').getAttribute('href'), 'dashboard.html');
  assert.equal(await page.locator('#connection-panel').isVisible(), true);
  assert.equal(await page.locator('#checkin').count(), 0);
  assert.equal(await page.locator('details[open]').count(), 0);
  await page.locator('#connect').click();
  await page.waitForFunction(() => window.openedLoginUrl === 'https://www.hoyolab.com/');
  assert.equal(await page.locator('#connection-panel').isVisible(), true, 'opening login alone is not a completed connection');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#connection-panel').hidden === true);
  assert.match(await page.locator('.game[data-game="genshin"] .identity').textContent(), /800000001.*60/);
  assert.match(await page.locator('.game[data-game="starrail"] .identity').textContent(), /800000002.*70/);
  const starrail = page.locator('.game[data-game="starrail"]');
  await starrail.locator('summary').click();
  await page.getByLabel('붕괴: 스타레일 자동출석').check();
  await page.waitForFunction(() => window.mockStorage.settings?.games.starrail === true);
  assert.equal(await page.evaluate(() => window.mockStorage.settings.games.genshin), false, 'enabling one game must not enable the other');
  assert.equal(await page.getByLabel('붕괴: 스타레일 자동출석').isChecked(), true);
  await starrail.getByRole('button', { name: '정보 동기화' }).click();
  await page.waitForFunction(() => document.querySelector('#feedback').textContent === '붕괴: 스타레일 정보를 동기화했습니다.');
  assert.match(await starrail.locator('.result').textContent(), /오늘 출석 완료/);
  assert.equal(await starrail.locator('.pull-total').textContent(), '2회', 'uses version windows rather than a rolling 30-day total');
  assert.equal(await starrail.locator('.pull-count strong').first().textContent(), '1회');
  assert.equal(await starrail.locator('.pull-count strong').nth(1).textContent(), '1회');
  assert.equal(await starrail.locator('.content-value').textContent(), '12별');
  assert.match(await starrail.locator('.content-result').textContent(), /혼돈의 기억12별/);
  assert.equal(await starrail.locator('.mini-stat').count(), 0, 'detailed profile metrics stay in the dashboard');
  assert.ok(await starrail.locator('.content-value').evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 28));
  assert.ok(await starrail.locator('.game-name').evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 17));
  await page.waitForFunction(() => window.mockStorage.popupExpanded?.starrail === true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.game[data-game="starrail"]').open === true && !document.querySelector('#connect').disabled);
  await page.getByLabel('붕괴: 스타레일 자동출석').uncheck();
  await page.waitForFunction(() => window.mockStorage.settings.auto === false);
  assert.equal(await page.evaluate(() => window.mockMessages.some(message => ['checkin', 'checkin-game'].includes(message.type))), false, 'popup has no manual check-in action');
  await page.screenshot({ path: '/tmp/hoyo-popup-connected.png', fullPage: true });
  await page.evaluate(async () => {
    const key = mockStorage.profiles.starrail.key;
    const value = structuredClone(mockStorage[key]); value.calendar.end = Date.now() - 1;
    await chrome.storage.local.set({ [key]: value });
  });
  await starrail.getByText('가챠 일정 갱신 필요', { exact: true }).waitFor();
  assert.equal(await starrail.locator('.pull-total').count(), 0, 'a stale version must not display a current count');
  await page.evaluate(async () => { localStorage.removeItem('mock-login'); await chrome.runtime.sendMessage({ type: 'connection-status' }); });
  await page.waitForFunction(() => !document.querySelector('#connection-panel').hidden);
  assert.equal(await page.locator('#connection-panel').isVisible(), true, 'expired login restores link control');
  assert.deepEqual(errors, []);
  assert.ok(await page.evaluate(() => document.body.scrollWidth <= 440));
  console.log('PASS: popup branding, initial login flow, verified link hiding/recovery, profile accordions, per-game automation, version-window counts, prominent content results, stale schedule handling, and persistent expansion (mocked Chrome APIs).');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
