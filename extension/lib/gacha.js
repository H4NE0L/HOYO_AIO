const TYPES = {
  genshin: { '100': ['beginner', '초보자'], '200': ['standard', '상시'], '301': ['character', '캐릭터 이벤트'], '400': ['character', '캐릭터 이벤트'], '302': ['weapon', '무기 이벤트'], '500': ['chronicled', '묶음 기원'] },
  starrail: { '1': ['standard', '상시'], '2': ['beginner', '초행길'], '11': ['character', '캐릭터 이벤트'], '12': ['weapon', '광추 이벤트'] },
};
export function parseImport(document, gameId) {
  if (!TYPES[gameId]) throw new Error('지원하지 않는 게임입니다.');
  const key = gameId === 'genshin' ? 'hk4e' : 'hkrpg';
  let exports = document?.[key];
  if (!exports && Array.isArray(document?.list)) {
    const uid = String(document.info?.uid ?? document.list[0]?.uid ?? '');
    exports = [{ uid, list: document.list, timezone: document.info?.timezone }];
  }
  if (!Array.isArray(exports) || !exports.length) throw new Error('선택한 게임의 UIGF/SRGF JSON 기록을 찾지 못했습니다.');
  let total = 0;
  const groups = exports.map(group => {
    const uid = String(group.uid ?? '');
    if (!/^\d{6,12}$/.test(uid) || !Array.isArray(group.list)) throw new Error('UID 또는 기록 목록이 올바르지 않습니다.');
    const timezone = Number(group.timezone ?? 8);
    if (!Number.isInteger(timezone) || timezone < -12 || timezone > 14) throw new Error('기록의 시간대가 올바르지 않습니다.');
    const records = group.list.map(item => {
      if (++total > 50000) throw new Error('한 번에 최대 50,000건까지 가져올 수 있습니다.');
      const type = String(item.gacha_type ?? item.uigf_gacha_type ?? '');
      const id = typeof item.id === 'string' ? item.id : '';
      const rank = Number(item.rank_type);
      const uidValue = item.uid == null ? uid : String(item.uid);
      // IDs exceed JS's safe integer range: numeric IDs cannot be imported losslessly.
      if (!/^\d{1,30}$/.test(id) || uidValue !== uid || !TYPES[gameId][type] || ![3, 4, 5].includes(rank) || typeof item.name !== 'string' || item.name.length > 100) throw new Error('기록에 잘못된 ID·UID·배너·등급이 있습니다. ID는 문자열이어야 합니다.');
      const time = String(item.time ?? '');
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time)) throw new Error('기록 시간은 YYYY-MM-DD HH:mm:ss 형식이어야 합니다.');
      const date = new Date(time.replace(' ', 'T') + 'Z');
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19).replace('T', ' ') !== time) throw new Error('기록 날짜가 올바르지 않습니다.');
      return { id, type, pool: TYPES[gameId][type][0], rank, name: item.name, at: date.getTime() - timezone * 3600000 };
    });
    return { uid, records };
  });
  return groups;
}
export function mergeRecords(existing = [], incoming = []) {
  const records = new Map(existing.map(item => [item.id, item]));
  for (const item of incoming) records.set(item.id, item);
  if (records.size > 50000) throw new Error('계정별 보관 한도 50,000건을 초과했습니다.');
  return [...records.values()].sort((a, b) => a.at - b.at || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
}
export function summarize(records, now = Date.now()) {
  return {
    total: records.length,
    recent: records.filter(item => item.at >= now - 30 * 86400000 && item.at <= now).length,
    fiveStars: records.filter(item => item.rank === 5).length,
    pools: ['character', 'weapon', 'standard', 'beginner', 'chronicled'].map(pool => {
      const list = records.filter(item => item.pool === pool);
      const lastFive = list.findLastIndex(item => item.rank === 5);
      return { pool, count: list.length, pity: list.length - lastFive - 1, known: lastFive >= 0 };
    }).filter(pool => pool.count > 0),
  };
}
export function planBudget({ currency = 0, tickets = 0, pity = 0, guaranteed = false }) {
  for (const value of [currency, tickets, pity]) if (!Number.isInteger(value) || value < 0) throw new Error('재화·티켓·스택은 0 이상의 정수여야 합니다.');
  if (pity > 89 || currency > 100000000 || tickets > 1000000) throw new Error('캐릭터 이벤트 스택은 0~89, 재화는 1억, 티켓은 100만 이하로 입력해주세요.');
  const available = Math.floor(currency / 160) + tickets;
  const nextFive = 90 - pity;
  const featured = nextFive + (guaranteed ? 0 : 90);
  return { available, nextFive, featured, shortfall: Math.max(0, featured - available) };
}
export function scheduleDays(date, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return null;
  const canonical = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(canonical.getTime()) || canonical.toISOString().slice(0, 10) !== date) return null;
  const target = Date.parse(`${date}T00:00:00+09:00`);
  if (!Number.isFinite(target)) return null;
  const today = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  return Math.round((target - Date.parse(`${today}T00:00:00+09:00`)) / 86400000);
}
