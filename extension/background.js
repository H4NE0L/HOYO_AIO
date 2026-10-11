import { syncRecord, RECORD_GAMES } from './lib/records.js';
import { parseImport, mergeRecords, planBudget, scheduleDays } from './lib/gacha.js';
import { GAMES } from './lib/games.js';
import { checkIn } from './lib/checkin.js';
import { settingsFrom, dayKey, shouldAttempt } from './lib/state.js';

const ALARM = 'hoyo-checkin';
let running;
let manualRun = false;
let activeTarget;

async function initialize() {
  const state = await chrome.storage.local.get('settings');
  if (!state.settings) await chrome.storage.local.set({ settings: settingsFrom() });
  // Set official web origins only for extension requests to known API paths.
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2, 3, 4, 5],
    addRules: Object.values(GAMES).map((game, index) => ({
      id: index + 1, priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://act.hoyolab.com/' },
        { header: 'Origin', operation: 'set', value: 'https://act.hoyolab.com' },
      ] },
      condition: {
        urlFilter: `|${game.base}/`, resourceTypes: ['xmlhttprequest'],
        initiatorDomains: [chrome.runtime.id],
      },
    })).concat([
      ...Object.values(RECORD_GAMES).map(game => `${game.base}/`),
      'https://sg-public-api.hoyolab.com/binding/api/',
    ].map((url, index) => ({
      id: index + 3, priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://www.hoyolab.com/' },
        { header: 'Origin', operation: 'set', value: 'https://www.hoyolab.com' },
      ] },
      condition: { urlFilter: `|${url}`, resourceTypes: ['xmlhttprequest'], initiatorDomains: [chrome.runtime.id] },
    }))),
  });
  if (!await chrome.alarms.get(ALARM)) {
    await chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 30 });
  }
}

async function execute(manual, target) {
  await initialize();
  const stored = await chrome.storage.local.get(['settings', 'results']);
  const settings = settingsFrom(stored.settings);
  if (!manual && !settings.auto) return;
  for (const id of Object.keys(GAMES)) {
    if (target ? id !== target : !settings.games[id]) continue;
    if (!manual && !shouldAttempt(stored.results?.[id])) continue;
    const at = Date.now();
    let result;
    try { result = { ...await checkIn(id), day: dayKey(at), at }; }
    catch (error) {
      result = { status: error.kind ?? 'api', message: error.kind ? error.message : '출석 처리 중 오류가 발생했습니다.', day: dayKey(at), at };
    }
    const latest = await chrome.storage.local.get('results');
    await chrome.storage.local.set({ results: { ...latest.results, [id]: result } });
  }
}

function run(manual = false, target) {
  if (running) {
    // A manual request arriving during a skipped/automatic run must still execute.
    return manual && (!manualRun || activeTarget !== target) ? running.then(() => run(true, target)) : running;
  }
  manualRun = manual;
  activeTarget = target;
  running = execute(manual, target).finally(() => { running = undefined; manualRun = false; activeTarget = undefined; });
  return running;
}
let profileWrites = Promise.resolve();
function updateProfile(gameId, update, extra = {}) {
  const task = profileWrites.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get('profiles');
    await chrome.storage.local.set({ ...extra, profiles: {
      ...stored.profiles, [gameId]: update(stored.profiles?.[gameId]),
    } });
  });
  profileWrites = task;
  return task;
}
const syncQueues = new Map();
function queueSync(gameId, role) {
  if (!RECORD_GAMES[gameId]) return Promise.reject(new Error('지원하지 않는 게임입니다.'));
  const previous = syncQueues.get(gameId) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    await initialize();
    const stored = await chrome.storage.local.get('profiles');
    const preferred = role ?? stored.profiles?.[gameId]?.selected;
    try {
      const record = await syncRecord(gameId, preferred);
      const key = `record:${gameId}:${record.account.uid}:${record.account.region}`;
      const cached = await chrome.storage.local.get(key);
      const archive = new Map((cached[key]?.archive ?? []).map(item => [`${item.mode}:${item.season}`, item]));
      for (const item of record.content) if (!item.error && item.hasData && item.season) archive.set(`${item.mode}:${item.season}`, { ...item, at: record.at });
      record.archive = [...archive.values()].sort((a, b) => b.at - a.at).slice(0, 60);
      await updateProfile(gameId, () => ({ accounts: record.accounts, selected: `${record.account.uid}:${record.account.region}`, key, at: record.at }), { [key]: record });
    } catch (error) {
      await updateProfile(gameId, previous => ({ ...previous, error: error.message, failedAt: Date.now() }));
      throw error;
    }
  });
  syncQueues.set(gameId, task);
  task.finally(() => { if (syncQueues.get(gameId) === task) syncQueues.delete(gameId); }).catch(() => {});
  return task;
}
let importQueue = Promise.resolve();
function importGacha(gameId, document) {
  const task = importQueue.catch(() => {}).then(async () => {
    const serialized = JSON.stringify(document);
    if (typeof serialized !== 'string') throw new Error('올바른 JSON 기록이 아닙니다.');
    if (serialized.length > 5 * 1024 * 1024) throw new Error('가져오기 파일은 5MB 이하여야 합니다.');
    const groups = parseImport(document, gameId);
    const updates = {};
    let count = 0;
    for (const group of groups) {
      const key = `gacha:${gameId}:${group.uid}`;
      const current = updates[key] ?? (await chrome.storage.local.get(key))[key];
      const records = mergeRecords(current?.records, group.records);
      updates[key] = { uid: group.uid, records, at: Date.now() };
      count += records.length - (current?.records.length ?? 0);
    }
    await chrome.storage.local.set(updates);
    return count;
  });
  importQueue = task;
  return task;
}
async function savePlan(gameId, value) {
  if (!RECORD_GAMES[gameId]) throw new Error('지원하지 않는 게임입니다.');
  planBudget(value);
  if (value.date && scheduleDays(value.date) === null) throw new Error('픽업 날짜가 올바르지 않습니다.');
  const plan = { currency: value.currency, tickets: value.tickets, pity: value.pity,
    guaranteed: value.guaranteed === true, name: String(value.name ?? '').slice(0, 80), date: String(value.date ?? '').slice(0, 10),
  };
  await chrome.storage.local.set({ [`plan:${gameId}`]: plan });
}
function report(error) { console.error('HOYO AIO background error:', error.message); }
chrome.runtime.onInstalled.addListener(() => { initialize().catch(report); });
chrome.runtime.onStartup.addListener(() => { run().catch(report); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) run().catch(report); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'sync-record') {
    queueSync(message.game, message.role).then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message }));
  } else if (message.type === 'import-gacha') {
    importGacha(message.game, message.document).then(count => respond({ ok: true, count }), error => respond({ ok: false, error: error.message }));
  } else if (message.type === 'save-plan') {
    savePlan(message.game, message.plan).then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message }));
  } else if (message.type === 'checkin-game' && GAMES[message.game]) {
    run(true, message.game).then(() => respond({ ok: true }), () => respond({ ok: false, error: '출석 처리에 실패했습니다.' }));
  } else if (message.type === 'checkin') {
    run(true).then(() => respond({ ok: true }), () => respond({ ok: false, error: '출석 처리에 실패했습니다. 확장프로그램을 다시 열어주세요.' }));
  } else if (message.type === 'settings') {
    chrome.storage.local.set({ settings: settingsFrom(message.settings) })
      .then(() => run()).then(() => respond({ ok: true }), () => respond({ ok: false, error: '설정을 저장하지 못했습니다.' }));
  } else if (message.type === 'wake') {
    run().then(() => respond({ ok: true }), () => respond({ ok: false, error: '자동출석 상태를 확인하지 못했습니다.' }));
  } else return;
  return true;
});
