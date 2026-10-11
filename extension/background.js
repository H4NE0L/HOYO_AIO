import { GAMES } from './lib/games.js';
import { checkIn } from './lib/checkin.js';
import { settingsFrom, dayKey, shouldAttempt } from './lib/state.js';

const ALARM = 'hoyo-checkin';
let running;
let manualRun = false;

async function initialize() {
  const state = await chrome.storage.local.get('settings');
  if (!state.settings) await chrome.storage.local.set({ settings: settingsFrom() });
  // Supply the official web origin only to the two check-in API paths.
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2],
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
    })),
  });
  if (!await chrome.alarms.get(ALARM)) {
    await chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 30 });
  }
}

async function execute(manual) {
  await initialize();
  const stored = await chrome.storage.local.get(['settings', 'results']);
  const settings = settingsFrom(stored.settings);
  if (!manual && !settings.auto) return;
  for (const id of Object.keys(GAMES)) {
    if (!settings.games[id]) continue;
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

function run(manual = false) {
  if (running) {
    // A manual request arriving during a skipped/automatic run must still execute.
    return manual && !manualRun ? running.then(() => run(true)) : running;
  }
  manualRun = manual;
  running = execute(manual).finally(() => { running = undefined; manualRun = false; });
  return running;
}
function report(error) { console.error('HOYO AIO background error:', error.message); }
chrome.runtime.onInstalled.addListener(() => { initialize().catch(report); });
chrome.runtime.onStartup.addListener(() => { run().catch(report); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) run().catch(report); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'checkin') {
    run(true).then(() => respond({ ok: true }), () => respond({ ok: false, error: '출석 처리에 실패했습니다. 확장프로그램을 다시 열어주세요.' }));
  } else if (message.type === 'settings') {
    chrome.storage.local.set({ settings: settingsFrom(message.settings) })
      .then(() => run()).then(() => respond({ ok: true }), () => respond({ ok: false, error: '설정을 저장하지 못했습니다.' }));
  } else if (message.type === 'wake') {
    run().then(() => respond({ ok: true }), () => respond({ ok: false, error: '자동출석 상태를 확인하지 못했습니다.' }));
  } else return;
  return true;
});
