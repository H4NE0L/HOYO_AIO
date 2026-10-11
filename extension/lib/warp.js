// Official HoYoLAB warp statistics. Authentication stays in Chrome's cookie jar.
const BASE = 'https://sg-act-public-api.hoyolab.com';
export const WARP_PAGE = 'https://act.hoyolab.com/sr/event/gt-aio/gacha-records/index.html?lang=ko-kr#/index-pc';
const TYPES = { character: 'GachaType_AvatarUp', weapon: 'GachaType_EquipmentUp', standard: 'GachaType_Standard' };
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function officialImage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && ['hoyolab.com', 'hoyoverse.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : null;
  } catch { return null; }
}
async function request(path, account, fetcher, body, extra = {}) {
  const url = new URL(BASE + path);
  if (!body) for (const [key, value] of Object.entries({ game_biz: 'hkrpg_global', region: account.region, uid: account.uid, ...extra })) url.searchParams.set(key, value);
  const response = await fetcher(url.href, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { 'x-rpc-lang': 'ko-kr', 'x-rpc-language': 'ko-kr', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`공식 워프 통계 연결 오류 (HTTP ${response.status})`);
  const payload = await response.json();
  if (payload.retcode !== 0 || !payload.data) throw new Error('공식 워프 통계를 확인하지 못했습니다. 공식 페이지에서 로그인·인증 후 다시 동기화해주세요.');
  return payload.data;
}
export function normalizeWarpPool(cards, rows, cap) {
  if (!Array.isArray(cards) || !Array.isArray(rows)) throw new Error('공식 워프 통계 응답 형식이 변경되었습니다.');
  const pending = rows.find(row => row.got_item === false);
  const obtained = rows.filter(row => row.got_item === true && /^\d+$/.test(String(row.id))).sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0);
  const last = obtained[0];
  const pity = count(pending?.gacha_count);
  return {
    cards: cards.slice(0, 500).map(card => ({ version: String(card.version ?? '').slice(0, 40), name: String(card.pool_name ?? '').slice(0, 100), count: count(card.total_count) })),
    pity: pity != null && pity < cap ? pity : null,
    guaranteed: last && typeof last.is_up === 'boolean' ? !last.is_up : null,
    recent: obtained.slice(0, 5).map(row => ({ name: String(row.item?.name ?? '').slice(0, 100), icon: officialImage(row.item?.icon), count: count(row.gacha_count), isUp: typeof row.is_up === 'boolean' ? row.is_up : null })),
  };
}
export async function syncWarp(account, fetcher = fetch) {
  await request('/common/badge/v1/login/account', account, fetcher, { game_biz: 'hkrpg_global', lang: 'ko-kr', region: account.region, uid: account.uid });
  const pools = {};
  for (const [pool, type] of Object.entries(TYPES)) {
    const extra = { gacha_type: type };
    try {
      const stats = await request('/event/rpg_gacha_record/pool_stat', account, fetcher, null, extra);
      let pageParams = extra;
      const rows = [];
      for (let page = 0; page < 100; page++) {
        const history = await request('/event/rpg_gacha_record/five_star_list', account, fetcher, null, pageParams);
        if (!Array.isArray(history.list)) throw new Error('공식 워프 기록 형식이 변경되었습니다.');
        rows.push(...history.list);
        if (!history.has_more) break;
        if (page === 99 || history.next_max_id == null || history.version_id == null) throw new Error('공식 워프 기록을 끝까지 확인하지 못했습니다.');
        const next = { ...extra, max_id: history.next_max_id, version_id: history.version_id };
        if (String(next.max_id) === String(pageParams.max_id)) throw new Error('공식 워프 기록 페이지가 반복되었습니다.');
        pageParams = next;
      }
      pools[pool] = normalizeWarpPool(stats.cards, rows, pool === 'weapon' ? 80 : 90);
    } catch (error) { pools[pool] = { error: error.message }; }
  }
  return { uid: account.uid, at: Date.now(), pools };
}
export function warpVersion(warp, calendar, now = Date.now()) {
  if (!warp || !calendar || now < calendar.start || now > calendar.end) return null;
  const version = String(calendar.version).replace(/^v/i, '');
  const result = { status: 'available', version: calendar.version, official: true, total: 0 };
  for (const pool of Object.keys(TYPES)) {
    const cards = warp.pools?.[pool]?.cards?.filter(card => card.version.replace(/^v/i, '') === version);
    result[pool] = cards?.length && cards.every(card => card.count != null) ? cards.reduce((sum, card) => sum + card.count, 0) : null;
  }
  const known = Object.values(TYPES).length === Object.keys(TYPES).filter(pool => result[pool] != null).length;
  result.total = known ? result.character + result.weapon + result.standard : null;
  return Object.keys(TYPES).some(pool => result[pool] != null) ? result : null;
}
export function pitySummary(pool, data, game = 'starrail') {
  const cap = pool === 'weapon' ? 80 : 90;
  if (data?.pity == null) return '천장 기록 확인 필요';
  const next = Math.max(0, cap - data.pity);
  if (pool === 'standard') return `${data.pity}/${cap} · 5성까지 최대 ${next}회`;
  if (game === 'genshin' && pool === 'weapon') return `${data.pity}/${cap} · 5성까지 최대 ${next}회 · 운명 포인트는 상세에서 확인`;
  const guarantee = data.guaranteed;
  return `${data.pity}/${cap} · ${guarantee == null ? `5성까지 최대 ${next}회 · 픽업 확인 필요` : `픽업${guarantee ? ' 확정' : ''}까지 최대 ${next + (guarantee ? 0 : cap)}회`}`;
}
