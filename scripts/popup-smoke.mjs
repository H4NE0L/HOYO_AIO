// UI-only browser check. Chrome APIs and HoYoLAB results are deliberately mocked.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (!/^\/[a-zA-Z0-9/.-]+$/.test(path) || path.includes('..')) { res.writeHead(404).end(); return; }
  try {
    const content = await readFile(new URL(`../extension${path}`, import.meta.url));
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 400, height: 820 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const stored = {};
    const listeners = [];
    function update(value) { Object.assign(stored, value); listeners.forEach(fn => fn()); }
    window.chrome = {
      storage: {
        local: { async get() { return structuredClone(stored); } },
        onChanged: { addListener(fn) { listeners.push(fn); } },
      },
      runtime: { async sendMessage(message) {
        if (message.type === 'settings') update({ settings: message.settings });
        if (message.type === 'checkin') {
          const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
          update({ results: {
            genshin: { status: 'success', days: 3, at: Date.now(), day },
            starrail: { status: 'login', message: '호요랩 로그인이 필요합니다.', at: Date.now(), day },
          } });
        }
        return { ok: true };
      } },
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
  assert.equal(await page.locator('.game').count(), 2);
  assert.equal(await page.locator('#auto').isChecked(), false);
  await page.locator('#auto').check();
  await page.waitForFunction(() => document.querySelector('#feedback').textContent === '설정을 저장했습니다.');
  await page.locator('#checkin').click();
  await page.waitForFunction(() => document.querySelector('#feedback').textContent === '게임별 결과를 확인해주세요.');
  assert.equal(await page.locator('.result[data-status="success"]').count(), 1);
  assert.equal(await page.locator('.result[data-status="login"]').count(), 1);
  assert.match(await page.locator('.result').first().textContent(), /이번 달 3일/);
  assert.equal(await page.locator('#checkin').isDisabled(), false);
  for (const checkbox of await page.locator('.game input').all()) await checkbox.uncheck();
  await page.locator('#checkin').click();
  assert.match(await page.locator('#feedback').textContent(), /게임을 선택/);
  assert.deepEqual(errors, []);
  console.log('PASS: popup rendering, settings, per-game success/error results, and empty selection (mocked Chrome APIs).');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
