import { GAMES } from './lib/games.js';
import { settingsFrom, dayKey } from './lib/state.js';
import { summarizeVersion } from './lib/calendar.js';
const feedback = document.querySelector('#feedback');
const connectButton = document.querySelector('#connect');
const controls = {};
let expansionLoaded = false;
let stored = {}, renderVersion = 0, connecting = false, saving = false, desiredSettings;
const syncing = new Set();
const number = value => value == null ? '—' : Number(value).toLocaleString('ko-KR');
const date = at => new Date(at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
function el(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined) node.textContent = text; return node;
}
function link(text, href) { const node = el('a', '', text); node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node; }
function message(text, error = false) { feedback.textContent = text; feedback.classList.toggle('error', error); }
function section(title, route) {
  const node = el('section', 'mini-section'), heading = el('div', 'section-heading');
  heading.append(el('h3', '', title), link('상세 보기 ↗', route)); node.append(heading); return node;
}
for (const [id, game] of Object.entries(GAMES)) {
  const card = el('details', 'game'); card.dataset.game = id;
  const summary = el('summary'); summary.setAttribute('aria-label', `${game.name} 프로필 및 설정`);
  const info = el('div', 'profile-summary'), nickname = el('div', 'nickname'), identity = el('div', 'identity');
  info.append(el('span', 'game-name', game.name), nickname, identity);
  summary.append(el('span', 'game-icon', id === 'genshin' ? '원' : '별'), info);
  const body = el('div', 'game-body'), label = el('label', 'setting', '자동출석');
  const auto = el('input'); auto.type = 'checkbox'; auto.setAttribute('aria-label', `${game.name} 자동출석`); label.append(auto);
  const result = el('p', 'result');
  const attendance = el('section', 'attendance-section'); attendance.append(label, result); body.append(attendance);
  const gacha = section(id === 'genshin' ? '이번 버전 기원' : '이번 버전 워프', `dashboard.html#${id}/gacha`);
  const content = section('최근 엔드 콘텐츠', `dashboard.html#${id}/content`);
  body.append(gacha, content);
  const syncRow = el('div', 'sync-row'), syncButton = el('button', '', '정보 동기화'); syncButton.type = 'button';
  syncRow.append(syncButton, link('게임 상세 페이지 ↗', `dashboard.html#${id}/overview`)); body.append(syncRow);
  const syncTime = el('p', 'time'); body.append(syncTime); card.append(summary, body);
  document.querySelector('#games').append(card);
  controls[id] = { card, nickname, identity, auto, result, gacha, content, syncButton, syncTime };
  auto.addEventListener('change', saveSettings);
  syncButton.addEventListener('click', () => sync(id));
  card.addEventListener('toggle', () => {
    const expanded = { ...stored.popupExpanded, [id]: card.open };
    if (stored.popupExpanded?.[id] === card.open) return;
    stored.popupExpanded = expanded;
    chrome.storage.local.set({ popupExpanded: expanded }).catch(() => message('펼침 상태를 저장하지 못했습니다.', true));
  });
}
function gameData(id) {
  const status = stored.profiles?.[id], cached = stored[status?.key];
  if (!stored.connection?.connected) return { account: cached?.account, record: cached, cached: Boolean(cached) };
  const accounts = stored.connection.accounts?.[id] ?? [];
  const account = accounts.find(role => `${role.uid}:${role.region}` === status?.selected) ?? accounts[0];
  const record = account && cached?.account.uid === account.uid && cached?.account.region === account.region ? cached : undefined;
  return { account, record, cached: Boolean(stored.connection.error) };
}
async function render() {
  const token = ++renderVersion;
  const value = await chrome.storage.local.get(null);
  if (token !== renderVersion) return;
  stored = value;
  const settings = desiredSettings ?? settingsFrom(stored.settings);
  const connection = stored.connection;
  document.querySelector('#connection-panel').hidden = connection?.connected === true;
  const status = document.querySelector('#connection-status'); status.dataset.connected = String(connection?.connected === true);
  status.textContent = connection?.error ?? (connection?.connected ? '호요랩 연결됨' : connecting ? '호요랩 연결을 확인하고 있습니다.' : '호요랩 연결이 필요합니다.');
  status.classList.toggle('error', Boolean(connection?.error));
  connectButton.disabled = connecting; connectButton.textContent = connecting ? '연결 확인 중…' : '호요랩 연동하기';
  for (const [id, ui] of Object.entries(controls)) {
    const { account, record, cached } = gameData(id);
    if (!expansionLoaded) ui.card.open = stored.popupExpanded?.[id] === true;
    ui.nickname.textContent = account?.nickname || (account ? '내 게임 프로필' : connection?.connected ? '연결된 게임 계정 없음' : '호요랩 연결 후 프로필 표시');
    ui.identity.textContent = account ? `${cached ? '저장된 프로필 · ' : ''}UID ${account.uid} · ${id === 'genshin' ? '모험 등급' : '개척 레벨'} ${number(account.level)}` : '카드를 펼쳐 설정과 기록을 확인하세요';
    ui.auto.checked = settings.auto && settings.games[id]; ui.auto.disabled = saving;
    const result = stored.results?.[id], current = result?.day === dayKey();
    ui.result.dataset.status = current ? result.status : 'pending';
    ui.result.textContent = current ? ({ success: '오늘 출석 완료', already: '오늘 출석 완료', login: '로그인 필요', verification: '보안 인증 필요', network: '연결 오류', api: '출석 확인 필요' }[result.status] ?? '출석 확인 필요') : '아직 출석 확인 전';
    ui.result.title = result?.message ?? '';
    while (ui.gacha.childNodes.length > 1) ui.gacha.lastChild.remove();
    const gacha = account ? stored[`gacha:${id}:${account.uid}`] : undefined;
    const stats = summarizeVersion(gacha?.records, record?.calendar);
    if (stats.status === 'available') {
      const total = el('div', 'gacha-total'); total.append(el('span', 'version-label', `${stats.version} 버전 픽업`), el('strong', 'pull-total', `${number(stats.total)}회`));
      ui.gacha.append(total);
      const breakdown = el('div', 'pull-breakdown');
      for (const [label, count] of [['캐릭터', stats.character], [id === 'genshin' ? '무기' : '광추', stats.weapon], ...(stats.chronicled ? [['묶음 기원', stats.chronicled]] : [])]) {
        const box = el('div', 'pull-count', label); box.append(el('strong', '', `${number(count)}회`)); breakdown.append(box);
      }
      ui.gacha.append(breakdown, el('p', 'hint', record?.calendarError ? '저장된 픽업 기간 · 가져온 기록 기준' : stats.partial ? '일부 제공 기간 · 가져온 기록 기준' : '제공된 픽업 기간 · 가져온 기록 기준'));
    } else {
      const reason = stats.status === 'records-missing' ? `${stats.version} 버전 · 기록 가져오기 필요` : stats.status === 'schedule-stale' ? '가챠 일정 갱신 필요' : '가챠 일정 확인 필요';
      ui.gacha.append(el('p', 'unavailable', reason));
    }
    while (ui.content.childNodes.length > 1) ui.content.lastChild.remove();
    const recent = record?.content.filter(item => item.period === 1) ?? [];
    if (!recent.length) ui.content.append(el('p', 'hint', '정보 동기화 후 최근 결과를 확인할 수 있습니다.'));
    for (const item of recent) {
      const row = el('div', 'content-result'); row.append(el('span', 'content-name', item.name), el('strong', item.error ? 'content-value unavailable error' : item.hasData && item.stars != null ? 'content-value' : 'content-value unavailable', item.error ? '조회 실패' : item.hasData && item.stars != null ? `${number(item.stars)}${item.mode === 'theater' ? '메달' : '별'}` : item.hasData ? '정보 없음' : '기록 없음'));
      if (item.error) row.title = item.error; ui.content.append(row);
    }
    ui.syncButton.disabled = syncing.has(id); ui.syncButton.textContent = syncing.has(id) ? '동기화 중…' : '정보 동기화';
    const syncError = stored.profiles?.[id]?.error ?? record?.profileError ?? connection?.gameErrors?.[id];
    ui.syncTime.textContent = syncError ? '동기화 확인 필요 · 상세 페이지에서 확인' : record?.at ? `동기화 ${date(record.at)}` : '';
    ui.syncTime.title = syncError ?? '';
    ui.syncTime.classList.toggle('error', Boolean(stored.profiles?.[id]?.error || record?.profileError || connection?.gameErrors?.[id]));
  }
  expansionLoaded = true;
}
async function send(payload) {
  const result = await chrome.runtime.sendMessage(payload);
  if (!result?.ok) throw new Error(result?.error ?? '백그라운드 연결에 실패했습니다.');
  return result;
}
async function saveSettings() {
  const games = Object.fromEntries(Object.entries(controls).map(([id, ui]) => [id, ui.auto.checked]));
  desiredSettings = { auto: Object.values(games).some(Boolean), games }; saving = true;
  try { await render(); await send({ type: 'settings', settings: desiredSettings }); message('자동출석 설정을 저장했습니다.'); }
  catch (error) { message(error.message, true); }
  finally { saving = false; desiredSettings = undefined; await render(); }
}
async function sync(id) {
  syncing.add(id); message(`${GAMES[id].name} 정보를 동기화하고 있습니다…`); await render();
  try { await send({ type: 'sync-record', game: id }); message(`${GAMES[id].name} 정보를 동기화했습니다.`); }
  catch (error) { message(error.message, true); }
  finally { syncing.delete(id); await render(); }
}
async function checkConnection(interactive = false) {
  connecting = true; await render();
  try {
    const response = await send({ type: interactive ? 'connect-hoyolab' : 'connection-status' });
    if (interactive && response.connection.connected) message('호요랩 연동을 완료했습니다. 게임 카드를 펼쳐 설정을 확인하세요.');
    if (interactive && !response.connection.connected) {
      message(response.connection.error, true);
      if (response.connection.needsLogin) await chrome.tabs.create({ url: 'https://www.hoyolab.com/' });
    }
  } catch (error) { message(error.message, true); }
  finally { connecting = false; await render(); }
}
connectButton.addEventListener('click', () => checkConnection(true));
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area && area !== 'local') return;
  render().catch(error => message(error.message, true));
});
await render();
checkConnection().catch(error => message(error.message, true));
send({ type: 'wake' }).catch(error => message(error.message, true));
