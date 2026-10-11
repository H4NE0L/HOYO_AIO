// Functional UI check with explicit mocked Chrome storage and API responses.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (!/^\/[a-zA-Z0-9/.-]+$/.test(path) || path.includes('..')) { res.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(new URL(`../extension${path}`, import.meta.url));
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html'); res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = {};
    window.chrome = {
      storage: { local: { async get() { return structuredClone(state); } } },
      runtime: { async sendMessage(message) {
        if (message.type === 'sync-record') {
          const starrail = message.game === 'starrail';
          const account = { uid: starrail ? '800000002' : '800000001', region: 'asia', server: 'Asia', nickname: starrail ? '개척자 카드' : '여행자 카드', level: starrail ? 70 : 60 };
          const key = `record:${message.game}:${account.uid}:asia`;
          state[key] = { account, profile: { activeDays: 100, characterCount: 50, achievements: 500, characters: [{ name: '<img src=x onerror=alert(1)>', level: 80, rarity: 5, rank: 2 }] },
            content: [{ name: starrail ? '혼돈의 기억' : '나선 비경', mode: starrail ? 'chaos' : 'abyss', season: '10', stars: 12, progress: '4', battles: 2, period: 1, hasData: true,
              floors: [{ name: '4층', stars: 3, stages: [{ name: '전투 기록', score: 60000, teams: [[{ name: '캐릭터', level: 80 }]] }] }] }], archive: [], at: Date.now() };
          state.profiles = { ...state.profiles, [message.game]: { accounts: [account], selected: `${account.uid}:asia`, key, at: Date.now() } };
        }
        if (message.type === 'import-gacha') {
          const uid = message.document.info.uid;
          state[`gacha:${message.game}:${uid}`] = { uid, at: Date.now(), records: [{ id: '100000000000000001', pool: 'character', rank: 5, name: '픽업 캐릭터', at: Date.now() }] };
          return { ok: true, count: 1 };
        }
        if (message.type === 'save-plan') state[`plan:${message.game}`] = message.plan;
        if (message.type === 'checkin-game') {
          state.results = { ...state.results, [message.game]: { status: 'success', at: Date.now(), day: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) } };
        }
        return { ok: true };
      } },
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/dashboard.html`);
  await page.getByText('내 여정을 연결하세요').waitFor();
  assert.equal(await page.locator('#tab-genshin').getAttribute('aria-selected'), 'true');
  await page.locator('#sync').click(); await page.getByText('여행자 카드', { exact: true }).waitFor();
  assert.match(await page.locator('.profile-meta').textContent(), /800000001/);
  await page.locator('#tab-starrail').click(); await page.getByText('내 여정을 연결하세요').waitFor();
  await page.locator('#sync').click(); await page.getByText('개척자 카드', { exact: true }).waitFor();
  assert.match(await page.locator('.profile-meta').textContent(), /800000002/);
  await page.getByRole('button', { name: '지금 출석하기' }).click(); await page.getByText('오늘 출석 완료', { exact: true }).waitFor();
  await page.getByRole('button', { name: '콘텐츠 전적', exact: true }).click();
  await page.locator('summary').click(); await page.getByText('4층', { exact: true }).waitFor();
  assert.match(await page.locator('.team').textContent(), /캐릭터 Lv.80/);
  await page.getByRole('button', { name: '가챠 기록', exact: true }).click();
  await page.getByLabel('가챠 기록 JSON 파일').setInputFiles({ name: 'records.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ info: { uid: '800000002' }, list: [] })) });
  await page.getByText('픽업 캐릭터', { exact: true }).waitFor();
  assert.match(await page.locator('#feedback').textContent(), /새 기록 1건/);
  await page.getByRole('button', { name: '픽업 계획', exact: true }).click();
  await page.locator('[name="currency"]').fill('1600'); await page.locator('[name="tickets"]').fill('2'); await page.locator('[name="pity"]').fill('20'); await page.locator('[name="guaranteed"]').check();
  assert.equal(await page.locator('.metrics .value').nth(2).textContent(), '70회');
  await page.locator('[name="name"]').fill('다음 픽업'); await page.locator('[name="date"]').fill('2026-10-20');
  await page.getByRole('button', { name: '계획 저장' }).click(); await page.getByText('계획을 이 기기에 저장했습니다.').waitFor();
  await page.locator('#tab-genshin').click(); await page.waitForFunction(() => document.querySelector('[name="pity"]')?.value === '0');
  await page.locator('#tab-starrail').click(); await page.waitForFunction(() => document.querySelector('[name="pity"]')?.value === '20');
  await page.getByRole('button', { name: '캐릭터', exact: true }).click();
  await page.getByText('<img src=x onerror=alert(1)>', { exact: true }).waitFor(); assert.equal(await page.locator('#content img').count(), 0, 'API text is not interpreted as HTML');
  await page.getByRole('button', { name: '개요', exact: true }).click(); await page.getByText('개척자 카드', { exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/hoyo-dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'mobile overview must not overflow horizontally');
  await page.screenshot({ path: '/tmp/hoyo-dashboard-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: dashboard game tabs, profiles, per-game check-in, content details, JSON import UI, persisted plans, safe text rendering, and mobile layout (mocked Chrome APIs).');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
