import { normalizeCalendar } from './calendar.js';
import { recordHeaders } from './md5.js';
export const RECORD_GAMES = {
  genshin: { biz: 'hk4e_global', base: 'https://sg-public-api.hoyolab.com/event/game_record/genshin/api',
    modes: [{ id: 'abyss', name: '나선 비경', endpoint: 'spiralAbyss' }, { id: 'theater', name: '환상극', endpoint: 'role_combat' }] },
  starrail: { biz: 'hkrpg_global', base: 'https://bbs-api-os.hoyolab.com/game_record/hkrpg/api',
    modes: [{ id: 'chaos', name: '혼돈의 기억', endpoint: 'challenge' }, { id: 'fiction', name: '허구 이야기', endpoint: 'challenge_story' }, { id: 'shadow', name: '종말의 환영', endpoint: 'challenge_boss' }] },
};
export class RecordError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}
const number = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const text = value => typeof value === 'string' ? value.slice(0, 100) : '';
async function request(url, fetcher, body) {
  let response;
  try { response = await fetcher(url.href, { credentials: 'include', cache: 'no-store', headers: { ...recordHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) }); }
  catch { throw new RecordError('network', '호요랩에 연결하지 못했습니다. 잠시 후 다시 동기화해주세요.'); }
  if (!response.ok) throw new RecordError('network', `호요랩 서버 오류 (HTTP ${response.status})`);
  let payload;
  try { payload = await response.json(); } catch { throw new RecordError('api', '호요랩 응답 형식이 변경되었습니다.'); }
  if ([10001, -100].includes(payload?.retcode)) throw new RecordError('login', '호요랩 로그인이 필요합니다.');
  if ([10102, 10103].includes(payload?.retcode)) throw new RecordError('private', '전적 정보를 볼 수 없습니다. 호요랩 전적 공개 설정을 확인해주세요.');
  if ([10035, 5003, 10041, 1034].includes(payload?.retcode)) throw new RecordError('verification', '호요랩에서 보안 인증을 완료한 뒤 다시 동기화해주세요.');
  if (payload?.data?.gt_result?.risk_code || payload?.data?.gt_result?.challenge) throw new RecordError('verification', '호요랩에서 보안 인증을 완료한 뒤 다시 동기화해주세요.');
  if (payload?.retcode !== 0 || !payload.data || typeof payload.data !== 'object') throw new RecordError('api', `호요랩 응답을 처리하지 못했습니다 (${Number.isInteger(payload?.retcode) ? payload.retcode : '형식 오류'}).`);
  return payload.data;
}
export async function getAccounts(gameId, fetcher = fetch) {
  const config = RECORD_GAMES[gameId];
  if (!config) throw new RecordError('api', '지원하지 않는 게임입니다.');
  const url = new URL('https://sg-public-api.hoyolab.com/binding/api/getUserGameRolesByCookie');
  url.searchParams.set('game_biz', config.biz);
  const data = await request(url, fetcher);
  if (!Array.isArray(data.list)) throw new RecordError('api', '계정 목록 형식이 변경되었습니다.');
  return data.list.filter(role => (!role.game_biz || role.game_biz === config.biz) && /^\d{6,12}$/.test(String(role.game_uid)) && /^[a-z0-9_]+$/.test(role.region))
    .map(role => ({ uid: String(role.game_uid), region: role.region, server: text(role.region_name), nickname: text(role.nickname), level: number(role.level) }))
    .sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
}
function endpointUrl(gameId, account, endpoint, params = {}) {
  const url = new URL(`${RECORD_GAMES[gameId].base}/${endpoint}`);
  for (const [key, value] of Object.entries({ role_id: account.uid, server: account.region, ...params })) url.searchParams.set(key, value);
  return url;
}
function characters(data) {
  return (Array.isArray(data.avatar_list) ? data.avatar_list : Array.isArray(data.avatars) ? data.avatars : []).slice(0, 200).map(avatar => ({
    id: String(avatar.id ?? ''), name: text(avatar.name), level: number(avatar.level), rarity: number(avatar.rarity),
    element: text(avatar.element), rank: number(avatar.rank ?? avatar.actived_constellation_num),
  }));
}
export function normalizeProfile(data) {
  if (!data.stats || typeof data.stats !== 'object') throw new RecordError('api', '프로필 통계 형식이 변경되었습니다.');
  return { activeDays: number(data.stats.active_day_number ?? data.stats.active_days),
    characterCount: number(data.stats.avatar_number ?? data.stats.avatar_num),
    achievements: number(data.stats.achievement_number ?? data.stats.achievement_num),
    characters: characters(data),
  };
}
const team = node => (Array.isArray(node?.avatars) ? node.avatars : []).map(avatar => ({ name: text(avatar.name) || `캐릭터 ${avatar.id ?? '?'}`, level: number(avatar.level) }));
function normalizeFloors(gameId, data) {
  const floors = gameId === 'genshin' ? data.floors : data.all_floor_detail;
  if (!Array.isArray(floors)) return [];
  return floors.slice(0, 30).map(floor => ({
    name: text(floor.name) || `${floor.index ?? floor.maze_id ?? '?'}층`, stars: number(floor.star ?? floor.star_num),
    rounds: number(floor.round_num),
    stages: gameId === 'genshin' ? (floor.levels ?? []).map(level => ({ name: `${level.index ?? '?'}번 방`, stars: number(level.star),
      teams: (level.battles ?? []).map(battle => team(battle)),
    })) : [{ name: '전투 기록', score: number(floor.node_1?.score) !== null || number(floor.node_2?.score) !== null ? (number(floor.node_1?.score) ?? 0) + (number(floor.node_2?.score) ?? 0) : null,
      teams: [floor.node_1, floor.node_2, floor.node_3].filter(Boolean).map(team) }],
  }));
}
export function normalizeContent(gameId, mode, data) {
  // Imaginarium Theater returns multiple seasons in data[] rather than abyss floors.
  if (mode.id === 'theater') {
    if (!Array.isArray(data.data)) throw new RecordError('api', '환상극 기록 형식이 변경되었습니다.');
    return data.data.slice(0, 2).map(season => ({
      mode: mode.id, name: mode.name, season: String(season.schedule?.id ?? season.schedule?.schedule_id ?? ''),
      stars: number(season.stat?.medal_num), progress: number(season.stat?.max_round_id), battles: null,
      hasData: season.has_data === true,
      floors: (Array.isArray(season.detail?.rounds_data) ? season.detail.rounds_data : []).slice(0, 30).map(round => ({
        name: `제${round.round_id ?? '?'}막`, stars: round.is_get_medal === true ? 1 : 0, rounds: null,
        stages: [{ name: '출전 편성', teams: [team(round)] }],
      })), detailSupported: season.has_detail_data === true,
    }));
  }
  if (typeof data.has_data !== 'boolean' && !('total_star' in data) && !('star_num' in data)) throw new RecordError('api', '콘텐츠 기록 형식이 변경되었습니다.');
  return [{ mode: mode.id, name: mode.name, season: String(data.schedule_id ?? ''),
    stars: number(data.total_star ?? data.star_num), progress: text(data.max_floor), battles: number(data.total_battle_times ?? data.battle_num),
    hasData: data.has_data !== false, floors: normalizeFloors(gameId, data), detailSupported: true,
  }];
}
export async function syncRecord(gameId, preferred, fetcher = fetch) {
  const accounts = await getAccounts(gameId, fetcher);
  const account = accounts.find(role => `${role.uid}:${role.region}` === preferred) ?? accounts[0];
  if (!account) throw new RecordError('unlinked', '연결된 게임 계정을 찾지 못했습니다. 호요랩에서 계정 연결을 확인해주세요.');
  const calendarUrl = gameId === 'genshin' ? new URL(`${RECORD_GAMES[gameId].base}/act_calendar`) : endpointUrl(gameId, account, 'get_act_calender');
  const [profileResult, calendarResult] = await Promise.allSettled([
    request(endpointUrl(gameId, account, 'index', gameId === 'genshin' ? { avatar_list_type: 0 } : {}), fetcher).then(normalizeProfile),
    request(calendarUrl, fetcher, gameId === 'genshin' ? { role_id: account.uid, server: account.region } : undefined).then(data => normalizeCalendar(gameId, data)),
  ]);
  const profile = profileResult.status === 'fulfilled' ? profileResult.value : null;
  const profileError = profileResult.status === 'rejected' ? profileResult.reason.message : null;
  const content = [];
  // Keep the official API's current/previous cycles; do not imply a lifetime history.
  for (const mode of RECORD_GAMES[gameId].modes) {
    for (const period of mode.id === 'theater' ? [1] : [1, 2]) {
      try {
        const data = await request(endpointUrl(gameId, account, mode.endpoint, { schedule_type: period, need_all: 'true', need_detail: 'true' }), fetcher);
        content.push(...normalizeContent(gameId, mode, data).map(item => ({ ...item, period })));
      } catch (error) { content.push({ mode: mode.id, name: mode.name, period, error: error.message }); }
    }
  }
  return { accounts, account, profile, profileError, content, calendar: calendarResult.status === 'fulfilled' ? calendarResult.value : null, calendarError: calendarResult.status === 'rejected' ? calendarResult.reason.message : null, at: Date.now() };
}
