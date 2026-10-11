import { GAMES } from './lib/games.js';
import { RECORD_GAMES } from './lib/records.js';
import { dayKey } from './lib/state.js';
import { summarize, planBudget, scheduleDays } from './lib/gacha.js';

const VIEWS = {
  overview: ['개요', '오늘의 출석과 내 프로필, 최근 기록을 확인하세요.'],
  content: ['콘텐츠 전적', '호요랩에서 조회한 최근 회차와 이 기기에 보관한 결과입니다.'],
  gacha: ['가챠 기록', '가져온 기록을 UID별로 모아 최근 횟수와 배너별 스택을 확인하세요.'],
  plan: ['픽업 계획', '직접 입력한 일정과 재화로 캐릭터 이벤트 뽑기를 계획하세요.'],
  characters: ['캐릭터', '호요랩 프로필에서 조회한 캐릭터 목록입니다.'],
};
const POOLS = { character: '캐릭터 이벤트', weapon: '무기 / 광추 이벤트', standard: '상시', beginner: '초보자', chronicled: '묶음 기원' };
const root = document.querySelector('#content');
const syncButton = document.querySelector('#sync');
const accountSelect = document.querySelector('#account');
const messages = new Map();
const busy = new Set();
const importedSelection = {};
let game = 'genshin', view = 'overview', renderVersion = 0;
let state = {}, record;
const number = value => value == null ? '—' : Number(value).toLocaleString('ko-KR');
const date = at => new Date(at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function card(title, subtitle) {
  const node = el('section', 'card'); node.append(el('h2', '', title));
  if (subtitle) node.append(el('p', 'muted', subtitle));
  return node;
}
function empty(title, description) {
  const node = el('div', 'empty'); node.append(el('h3', '', title), el('p', '', description)); return node;
}
function notice(text, info = false) { return el('div', `notice${info ? ' info' : ''}`, text); }
function metric(label, value, hint) {
  const node = el('div', 'metric'); node.append(el('div', 'label', label), el('div', 'value', value));
  if (hint) node.append(el('div', 'hint', hint)); return node;
}
function action(text, fn, primary = false) {
  const button = el('button', primary ? 'primary' : '', text); button.type = 'button'; button.addEventListener('click', fn); return button;
}
function link(text, href) { const node = el('a', '', text); node.href = href; return node; }
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error ?? '확장프로그램 연결에 실패했습니다.');
  return result;
}
function setMessage(target, text, error = false) { messages.set(target, { text, error }); }
async function task(target, label, fn) {
  setMessage(target, label); busy.add(target); await render();
  try { const result = await fn(); setMessage(target, result ?? '완료했습니다.'); }
  catch (error) { setMessage(target, error.message, true); }
  finally { busy.delete(target); await render(); }
}
async function sync(target = game, role) {
  if (busy.has(target)) return;
  await task(target, '호요랩 프로필과 최근 전적을 동기화하고 있습니다…', async () => {
    await send({ type: 'sync-record', game: target, ...(role ? { role } : {}) });
    return '동기화했습니다. 조회할 수 없는 항목은 각 카드의 안내를 확인해주세요.';
  });
}
function route() {
  const [target, page] = location.hash.slice(1).split('/');
  game = GAMES[target] ? target : 'genshin'; view = VIEWS[page] ? page : 'overview';
  render().catch(error => { document.querySelector('#feedback').textContent = error.message; });
}
function gachaData() {
  const keys = Object.keys(state).filter(key => key.startsWith(`gacha:${game}:`));
  const uid = importedSelection[game] ?? record?.account.uid;
  const match = keys.find(key => key === `gacha:${game}:${uid}`);
  // Never show another UID's records as the currently linked profile's data.
  const key = match ?? (!record?.account.uid ? keys[0] : undefined);
  return { keys, key, data: key ? state[key] : undefined };
}
function checkinCard() {
  const node = card('오늘의 출석', '호요랩 출석 · 한국 시간 오전 1시 날짜 변경');
  const result = state.results?.[game];
  const current = result?.day === dayKey();
  const status = current ? ({ success: '오늘 출석 완료', already: '오늘 이미 출석했습니다' }[result.status] ?? result.message) : '오늘 출석을 아직 확인하지 않았습니다.';
  node.append(el('p', current && !['success', 'already'].includes(result.status) ? 'error-text' : 'status', status));
  if (result?.at) node.append(el('p', 'muted', `최근 확인 ${date(result.at)}`));
  const row = el('div', 'row');
  const target = game;
  const button = action('지금 출석하기', () => task(target, '출석을 확인하고 있습니다…', async () => { await send({ type: 'checkin-game', game: target }); return '출석 결과를 확인해주세요.'; }));
  button.disabled = busy.has(game);
  const official = link('공식 출석 페이지 ↗', GAMES[game].page); official.target = '_blank'; official.rel = 'noopener noreferrer';
  row.append(button, official); node.append(row);
  node.append(el('p', 'muted', `자동출석 ${state.settings?.auto ? '켜짐' : '꺼짐'} · 설정은 확장프로그램 팝업에서 변경`));
  return node;
}
function profileCard() {
  const node = el('section', 'card profile');
  node.append(el('span', 'pill', game === 'genshin' ? 'TRAVELER PROFILE' : 'TRAILBLAZER PROFILE'));
  if (!record?.account) {
    node.append(el('h2', '', '내 여정을 연결하세요'), el('p', 'muted', '호요랩에 로그인한 뒤 동기화하면 UID와 계정 레벨을 조회합니다.'));
    node.append(action('프로필 동기화', () => sync(), true)); return node;
  }
  const head = el('div', 'profile-head');
  head.append(el('div', 'avatar', game === 'genshin' ? '원' : '별'));
  const info = el('div'); info.append(el('h2', '', record.account.nickname || '내 프로필'),
    el('p', 'profile-meta', `UID ${record.account.uid} · ${record.account.server || record.account.region} · ${game === 'genshin' ? '모험 등급' : '개척 레벨'} ${number(record.account.level)}`));
  head.append(info); node.append(head);
  if (record.profileError) node.append(notice(record.profileError));
  const metrics = el('div', 'metrics');
  metrics.append(metric('활동 일수', number(record.profile?.activeDays), '호요랩 누적 활동'), metric('보유 캐릭터', number(record.profile?.characterCount)), metric('업적', number(record.profile?.achievements)), metric('계정 레벨', number(record.account.level)));
  node.append(metrics); return node;
}
function overview() {
  root.append(profileCard());
  const grid = el('div', 'grid'); grid.append(checkinCard());
  const pulls = gachaData().data;
  const node = card(game === 'genshin' ? '최근 기원' : '최근 워프', '가져온 기록 기준 · 최근 30일');
  if (pulls) {
    const stats = summarize(pulls.records);
    node.append(el('div', 'budget', `${number(stats.recent)}회`), el('p', 'muted', `UID ${pulls.uid} · 보관 ${number(stats.total)}건`));
  } else node.append(empty('아직 가져온 기록이 없습니다', '가챠 기록 메뉴에서 UIGF / SRGF JSON을 가져오세요.'));
  node.append(link('가챠 기록 보기 →', `#${game}/gacha`)); grid.append(node); root.append(grid);
  const content = card('최근 엔드 콘텐츠', '조회 가능한 최신 회차의 결과입니다.');
  const current = record?.content.filter(item => item.period === 1) ?? [];
  if (!current.length) content.append(empty('전적을 연결해주세요', '호요랩 동기화 후 콘텐츠별 요약을 확인할 수 있습니다.'));
  for (const item of current) content.append(el('p', item.error ? 'error-text' : '', item.error ? `${item.name}: ${item.error}` : `${item.name} · ${item.hasData ? `${number(item.stars)}별 / 메달 · 진행 ${item.progress || '—'}` : '이번 회차 기록 없음'}`));
  content.append(link('요약과 상세 결과 보기 →', `#${game}/content`)); root.append(el('div', 'section-space'), content);
  const plan = state[`plan:${game}`];
  const schedule = card('나의 픽업 일정', '직접 저장한 개인 계획입니다. 공식 일정 자동 연동은 준비 중입니다.');
  if (plan?.name && plan?.date) {
    const days = scheduleDays(plan.date);
    schedule.append(el('h3', '', plan.name), el('p', 'status', `${plan.date} · ${days < 0 ? `${Math.abs(days)}일 지남` : days === 0 ? '오늘' : `D-${days}`}`));
  } else schedule.append(el('p', 'muted', '목표 픽업과 시작 날짜를 픽업 계획 메뉴에서 저장하세요.'));
  schedule.append(link('픽업 계획 세우기 →', `#${game}/plan`)); root.append(schedule);
}
function contentCard(item, archived = false) {
  const node = card(item.name, archived ? `기기에 보관 · ${date(item.at)}` : `${item.period === 2 ? '이전 회차' : '최근 회차'}${item.season ? ` · 회차 ${item.season}` : ''}`);
  if (item.error) { node.append(notice(item.error)); return node; }
  if (!item.hasData) { node.append(empty('이 회차의 기록이 없습니다', '플레이 기록이 없거나 호요랩에 아직 반영되지 않았을 수 있습니다.')); return node; }
  const metrics = el('div', 'metrics'); metrics.append(metric('별 / 메달', number(item.stars)), metric('최대 진행', item.progress || '—'), metric('전투 횟수', number(item.battles)));
  node.append(metrics);
  if (item.floors?.length) {
    const details = el('details'); details.append(el('summary', '', '층별 상세 결과와 편성 보기'));
    for (const floor of item.floors) {
      const row = el('div', 'floor'); row.append(el('h3', '', floor.name), el('p', 'muted', `${number(floor.stars)}별${floor.rounds != null ? ` · ${floor.rounds}라운드` : ''}`));
      for (const stage of floor.stages) {
        row.append(el('p', '', `${stage.name}${stage.stars != null ? ` · ${stage.stars}별` : ''}${stage.score != null ? ` · 점수 ${number(stage.score)}` : ''}`));
        stage.teams.forEach((team, index) => row.append(el('p', 'team', `${index + 1}팀: ${team.map(avatar => `${avatar.name}${avatar.level != null ? ` Lv.${avatar.level}` : ''}`).join(' / ') || '편성 정보 없음'}`)));
      }
      details.append(row);
    }
    node.append(details);
  } else node.append(el('p', 'muted', item.detailSupported === false ? '이 콘텐츠는 현재 회차 요약만 지원합니다. 상세 전투 결과는 이후 추가합니다.' : '호요랩이 제공한 층별 상세 결과가 없습니다.'));
  return node;
}
function contentPage() {
  root.append(notice('호요랩에서 조회 가능한 최근·이전 회차만 가져옵니다. 과거 전체 전적은 복원되지 않으며, 성공적으로 조회한 결과를 이 기기에 최대 60회차 보관합니다.', true));
  if (!record) { root.append(empty('동기화한 전적이 없습니다', '먼저 호요랩 동기화를 실행해주세요.')); return; }
  for (const mode of RECORD_GAMES[game].modes) {
    root.append(el('h2', 'section-space', mode.name));
    const grid = el('div', 'grid');
    record.content.filter(item => item.mode === mode.id).forEach(item => grid.append(contentCard(item)));
    root.append(grid);
  }
  const currentKeys = new Set(record.content.filter(item => item.season).map(item => `${item.mode}:${item.season}`));
  const archive = record.archive?.filter(item => !currentKeys.has(`${item.mode}:${item.season}`)) ?? [];
  root.append(el('h2', 'section-space', '이 기기에 보관한 과거 기록'));
  if (!archive.length) root.append(empty('추가 보관 기록이 없습니다', '여러 회차에 걸쳐 동기화하면 이전 결과가 여기에 남습니다.'));
  else archive.forEach(item => root.append(contentCard(item, true)));
}
function table(headers, rows) {
  const wrapper = el('div', 'table-wrap'), table = el('table'), head = el('thead'), tr = el('tr');
  headers.forEach(text => tr.append(el('th', '', text))); head.append(tr); table.append(head);
  const body = el('tbody'); rows.forEach(values => { const row = el('tr'); values.forEach(value => row.append(el('td', '', String(value)))); body.append(row); });
  table.append(body); wrapper.append(table); return wrapper;
}
function gachaPage() {
  const node = card('기록 가져오기', 'UIGF v4 / 원신 UIGF 목록 / 스타레일 SRGF JSON · 최대 5MB');
  node.append(notice('현재는 로컬 JSON 파일 가져오기를 지원합니다. 게임 기록 URL에서 직접 수집하는 기능은 다음 단계입니다. 인증 URL·토큰은 입력하지 않습니다.', true));
  const input = el('input', 'file-input'); input.type = 'file'; input.accept = '.json,application/json'; input.setAttribute('aria-label', '가챠 기록 JSON 파일');
  const target = game;
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    await task(target, '기록을 확인하고 있습니다…', async () => {
      if (file.size > 5 * 1024 * 1024) throw new Error('파일은 5MB 이하여야 합니다.');
      let document; try { document = JSON.parse(await file.text()); } catch { throw new Error('올바른 JSON 파일이 아닙니다.'); }
      const result = await send({ type: 'import-gacha', game: target, document });
      return `새 기록 ${number(result.count)}건을 저장했습니다. 같은 ID의 기록은 중복 저장하지 않습니다.`;
    });
  });
  node.append(input); root.append(node);
  const { keys, key, data } = gachaData();
  if (keys.length) {
    const select = el('select'); select.setAttribute('aria-label', '가챠 기록 UID 선택');
    select.append(new Option('기록 UID 선택', ''));
    keys.forEach(key => select.append(new Option(`UID ${state[key].uid}`, state[key].uid)));
    select.value = key ? state[key].uid : '';
    select.addEventListener('change', () => { importedSelection[game] = select.value; render(); }); root.append(select);
  }
  if (!data) { root.append(empty('선택한 UID의 기록이 없습니다', '파일을 가져오거나 보관된 기록의 UID를 선택해주세요. 다른 계정의 기록은 프로필과 자동으로 합치지 않습니다.')); return; }
  if (record?.account.uid && data.uid !== record.account.uid) root.append(notice(`가져온 기록의 UID ${data.uid}는 현재 프로필 UID ${record.account.uid}와 다릅니다.`));
  const stats = summarize(data.records);
  const metrics = el('div', 'metrics'); metrics.append(metric('가져온 기록', number(stats.total)), metric('최근 30일', `${number(stats.recent)}회`, '가져온 범위 내'), metric('5성 획득', `${number(stats.fiveStars)}회`), metric('기록 UID', data.uid)); root.append(metrics);
  const summary = card('배너별 기록', '배너의 누적 기록과 마지막 5성 이후 횟수입니다.');
  summary.append(table(['배너', '보관 횟수', '5성 이후 횟수'], stats.pools.map(item => [POOLS[item.pool], number(item.count), item.known ? `${item.pity}회` : `최소 ${item.pity}회 · 이전 5성 없음`])));
  summary.append(el('p', 'muted', '누락된 기록이 있으면 스택이 실제와 다를 수 있습니다. 픽업 확정 여부는 기록만으로 자동 판정하지 않습니다.'));
  root.append(summary);
  const recent = card(game === 'genshin' ? '최근 기원 목록' : '최근 워프 목록', `최근 최대 100건 · 마지막 가져오기 ${date(data.at)}`);
  recent.append(table(['시각 (한국)', '이름', '등급', '배너'], data.records.slice(-100).reverse().map(item => [date(item.at), item.name, `${item.rank}성`, POOLS[item.pool]]))); root.append(recent);
}
function field(name, title, type, value) {
  const label = el('label', 'field', title); const input = el('input'); input.name = name; input.type = type; input.value = value ?? ''; input.required = type === 'number';
  if (type === 'number') { input.min = '0'; input.step = '1'; input.max = name === 'pity' ? '89' : name === 'currency' ? '100000000' : '1000000'; }
  if (type === 'text') input.maxLength = 80;
  label.append(input); return label;
}
function planPage() {
  const target = game, plan = state[`plan:${game}`] ?? { currency: 0, tickets: 0, pity: 0, guaranteed: false };
  const node = card('다음 캐릭터 픽업까지', '게임별 개인 계획 · 재화와 티켓 수량은 직접 입력합니다.');
  node.append(notice('캐릭터 이벤트 배너의 5성 최대 90회 규칙으로 계산한 상한입니다. 실제 필요 횟수 예측이나 확률 보장이 아닙니다. 무기·광추·묶음 기원은 이 계산 대상이 아닙니다.', true));
  const form = el('form'), grid = el('div', 'form-grid');
  grid.append(field('currency', game === 'genshin' ? '보유 원석' : '보유 성옥', 'number', plan.currency), field('tickets', game === 'genshin' ? '뒤얽힌 인연' : '별의 궤도 전용 티켓', 'number', plan.tickets), field('pity', '마지막 5성 이후 스택 (0~89)', 'number', plan.pity), field('name', '목표 픽업 이름', 'text', plan.name), field('date', '직접 확인한 픽업 시작 날짜 (한국)', 'date', plan.date));
  const checkboxLabel = el('label', 'checkbox-field'); const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.name = 'guaranteed'; checkbox.checked = plan.guaranteed; checkboxLabel.append(checkbox, document.createTextNode('다음 5성이 픽업 캐릭터로 확정된 상태입니다'));
  const calculation = el('div', 'metrics');
  function values() { return { currency: Number(form.elements.currency.value), tickets: Number(form.elements.tickets.value), pity: Number(form.elements.pity.value), guaranteed: checkbox.checked, name: form.elements.name.value.trim(), date: form.elements.date.value }; }
  function calculate() {
    calculation.replaceChildren();
    try {
      const result = planBudget(values());
      calculation.append(metric('현재 가능한 뽑기', `${number(result.available)}회`), metric('다음 5성까지 최대', `${result.nextFive}회`), metric('픽업 확보까지 최대', `${result.featured}회`), metric('상한 대비 부족', `${number(result.shortfall)}회`));
    } catch (error) { calculation.append(notice(error.message)); }
  }
  const save = el('button', 'primary', '계획 저장'); save.type = 'submit';
  form.append(grid, checkboxLabel, calculation, save);
  form.addEventListener('input', calculate);
  form.addEventListener('submit', event => { event.preventDefault(); task(target, '계획을 저장하고 있습니다…', async () => { await send({ type: 'save-plan', game: target, plan: values() }); return '계획을 이 기기에 저장했습니다.'; }); });
  node.append(form); root.append(node); calculate();
  root.append(el('p', 'muted', '확정 상태가 아니라면 최대 180회에서 현재 스택을 뺍니다. 확정 상태라면 최대 90회에서 현재 스택을 뺍니다. 소프트 천장, 조기 획득, 이벤트 수입은 계산하지 않습니다. 일정은 공식 공지에서 확인한 날짜를 직접 입력하세요.'));
}
function charactersPage() {
  const equipment = game === 'genshin' ? '성유물' : '유물';
  root.append(notice(`${equipment} 상태 분석은 준비 중입니다. 장비 상세 조회와 캐릭터별 평가 기준을 먼저 검증한 뒤 추가할 예정이며, 현재는 임의의 점수를 표시하지 않습니다.`, true));
  const node = card('프로필 캐릭터 목록', '호요랩 프로필 API가 반환한 범위만 표시합니다. 전체 보유 목록과 다를 수 있습니다.');
  const characters = record?.profile?.characters ?? [];
  if (!characters.length) node.append(empty('조회한 캐릭터가 없습니다', '프로필을 동기화하거나 호요랩 전적 공개 설정을 확인해주세요.'));
  else {
    const grid = el('div', 'character-grid');
    characters.forEach(character => { const item = el('article', 'character'); item.append(el('span', 'muted', `${number(character.rarity)}성 · ${character.element || '속성 정보 없음'}`), el('h3', '', character.name || `캐릭터 ${character.id}`), el('p', 'muted', `Lv.${number(character.level)} · ${game === 'genshin' ? '돌파' : '성혼'} ${number(character.rank)}`)); grid.append(item); }); node.append(grid);
  }
  root.append(node);
}
async function render() {
  const token = ++renderVersion, target = game, page = view;
  const stored = await chrome.storage.local.get(null);
  if (token !== renderVersion || target !== game || page !== view) return;
  state = stored; record = state[state.profiles?.[game]?.key];
  document.title = `HOYO AIO · ${GAMES[game].name} · ${VIEWS[view][0]}`;
  document.querySelector('#breadcrumb').textContent = `${GAMES[game].name} / MY JOURNEY`;
  document.querySelector('#page-title').textContent = VIEWS[view][0];
  document.querySelector('#page-description').textContent = VIEWS[view][1];
  document.querySelector('#workspace').setAttribute('aria-labelledby', `tab-${game}`);
  for (const tab of document.querySelectorAll('[data-game]')) { const active = tab.dataset.game === game; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }
  const nav = document.querySelector('#navigation'); nav.replaceChildren();
  for (const [id, [label]] of Object.entries(VIEWS)) { const button = action(label, () => { location.hash = `${game}/${id}`; }); if (id === view) button.setAttribute('aria-current', 'page'); nav.append(button); }
  const status = state.profiles?.[game];
  accountSelect.replaceChildren();
  for (const role of status?.accounts ?? []) accountSelect.append(new Option(`${role.nickname || role.uid} · ${role.server || role.region} · UID ${role.uid}`, `${role.uid}:${role.region}`));
  if (!accountSelect.options.length) accountSelect.append(new Option('동기화 후 선택할 수 있습니다', ''));
  if (status?.selected) accountSelect.value = status.selected;
  accountSelect.disabled = !status?.accounts?.length || busy.has(game);
  document.querySelector('#sync-time').textContent = status?.at ? `마지막 동기화 ${date(status.at)}` : '아직 동기화하지 않았습니다';
  syncButton.disabled = busy.has(game); syncButton.textContent = busy.has(game) ? '처리 중…' : '호요랩 동기화';
  const feedback = document.querySelector('#feedback'), message = messages.get(game);
  feedback.textContent = message?.text ?? ''; feedback.className = message?.error ? 'error' : '';
  root.replaceChildren();
  if (status?.error) root.append(notice(`${status.error}${record ? ' 아래는 마지막으로 저장된 데이터입니다.' : ''}`));
  ({ overview, content: contentPage, gacha: gachaPage, plan: planPage, characters: charactersPage })[view]();
}
syncButton.addEventListener('click', () => sync());
accountSelect.addEventListener('change', () => sync(game, accountSelect.value));
for (const tab of document.querySelectorAll('[data-game]')) tab.addEventListener('click', () => { location.hash = `${tab.dataset.game}/${view}`; });
document.querySelector('#game-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 'genshin' : event.key === 'End' ? 'starrail' : game === 'genshin' ? 'starrail' : 'genshin';
  location.hash = `${next}/${view}`; document.querySelector(`#tab-${next}`).focus();
});
window.addEventListener('hashchange', route);
route();
