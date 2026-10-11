import { GAMES } from './lib/games.js';
import { settingsFrom, dayKey } from './lib/state.js';
const auto = document.querySelector('#auto');
const button = document.querySelector('#checkin');
const feedback = document.querySelector('#feedback');
const controls = {};
for (const [id, game] of Object.entries(GAMES)) {
  const card = document.createElement('article');
  card.className = 'game';
  const label = document.createElement('label');
  const input = document.createElement('input'); input.type = 'checkbox';
  label.append(input, document.createTextNode(game.name));
  const result = document.createElement('p'); result.className = 'result';
  const time = document.createElement('p'); time.className = 'time';
  const link = document.createElement('a'); link.href = game.page; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '공식 출석 페이지 ↗';
  card.append(label, result, time, link);
  document.querySelector('#games').append(card);
  controls[id] = { input, result, time };
  input.addEventListener('change', save);
}
async function render() {
  const stored = await chrome.storage.local.get(['settings', 'results']);
  const settings = settingsFrom(stored.settings); auto.checked = settings.auto;
  for (const [id, ui] of Object.entries(controls)) {
    ui.input.checked = settings.games[id];
    const result = stored.results?.[id];
    const current = result?.day === dayKey();
    ui.result.dataset.status = current ? result.status : 'pending';
    const texts = { success: '출석 완료', already: '이미 출석했습니다' };
    ui.result.textContent = current
      ? `${texts[result.status] ?? result.message ?? '상태 확인 필요'}${Number.isInteger(result.days) ? ` · 이번 달 ${result.days}일` : ''}`
      : '오늘 출석을 아직 확인하지 않았습니다.';
    ui.time.textContent = result ? `최근 확인: ${new Date(result.at).toLocaleString('ko-KR')}` : '';
  }
}
async function send(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error ?? '백그라운드 연결에 실패했습니다.');
}
async function save() {
  try {
    await send({ type: 'settings', settings: { auto: auto.checked, games: Object.fromEntries(Object.entries(controls).map(([id, ui]) => [id, ui.input.checked])) } });
    feedback.textContent = '설정을 저장했습니다.';
  } catch (error) { feedback.textContent = error.message; await render(); }
}
auto.addEventListener('change', save);
button.addEventListener('click', async () => {
  if (!Object.values(controls).some(ui => ui.input.checked)) { feedback.textContent = '출석할 게임을 선택해주세요.'; return; }
  button.disabled = true; feedback.textContent = '출석을 확인하고 있습니다…';
  try { await send({ type: 'checkin' }); feedback.textContent = '게임별 결과를 확인해주세요.'; }
  catch (error) { feedback.textContent = error.message; }
  finally { button.disabled = false; await render(); }
});
chrome.storage.onChanged.addListener(() => { render().catch(error => { feedback.textContent = error.message; }); });
await render();
send({ type: 'wake' }).catch(error => { feedback.textContent = error.message; });
