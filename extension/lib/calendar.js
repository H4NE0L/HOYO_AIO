// Calendar timestamps come from the account's server via HoYoLAB, not a guessed
// six-week release cycle or the local computer's timezone.
const timestamp = value => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const numeric = Number(value);
  const ms = numeric < 1e12 ? numeric * 1000 : numeric;
  return Number.isFinite(ms) && ms > 0 && ms < 8640000000000000 ? ms : null;
};
const label = value => typeof value === 'string' ? value.trim().slice(0, 100) : '';
export function normalizeCalendar(game, data, now = Date.now()) {
  const fields = game === 'genshin'
    ? [['avatar_card_pool_list', 'character'], ['weapon_card_pool_list', 'weapon'], ['mixed_card_pool_list', 'chronicled']]
    : [['avatar_card_pool_list', 'character'], ['equip_card_pool_list', 'weapon']];
  if (!['genshin', 'starrail'].includes(game) || !Array.isArray(data?.avatar_card_pool_list)) throw new Error('가챠 일정 응답 형식이 변경되었습니다.');
  const candidates = fields.flatMap(([field, pool]) => (Array.isArray(data[field]) ? data[field] : []).map(item => ({
    pool, name: label(item.pool_name ?? item.name), version: label(item.version_name ?? item.version),
    start: timestamp(item.start_timestamp ?? item.time_info?.start_ts),
    end: timestamp(item.end_timestamp ?? item.time_info?.end_ts),
  })));
  const active = candidates.filter(item => item.start != null && item.end != null && item.start <= now && now <= item.end)
    .sort((a, b) => b.start - a.start);
  const version = label(data.cur_game_version) || active.find(item => item.version)?.version;
  if (!version) throw new Error('현재 버전의 가챠 일정을 확인할 수 없습니다.');
  const selected = candidates.filter(item => item.version === version);
  const periods = selected.filter(item => item.start != null && item.end != null && item.end > item.start);
  if (!periods.length) throw new Error('현재 버전의 가챠 기간을 확인할 수 없습니다.');
  return {
    version, source: 'hoyolab', at: now, periods,
    start: Math.min(...periods.map(item => item.start)), end: Math.max(...periods.map(item => item.end)),
    partial: selected.length !== periods.length || fields.slice(0, 2).some(([field]) => !Array.isArray(data[field])),
  };
}
export function summarizeVersion(records, calendar, now = Date.now()) {
  if (!calendar?.periods?.length) return { status: 'schedule-missing' };
  if (now < calendar.start || now > calendar.end) return { status: 'schedule-stale' };
  if (!Array.isArray(records)) return { status: 'records-missing', version: calendar.version };
  // A pull appearing in overlapping simultaneous banner windows counts once.
  // Imported records don't identify which simultaneous character pickup was used.
  const matching = records.filter(record => record.at <= now && calendar.periods.some(period =>
    (record.pool === period.pool || record.pool === 'standard') && record.at >= period.start && record.at <= period.end));
  return { status: 'available', version: calendar.version, total: matching.length,
    character: matching.filter(item => item.pool === 'character').length,
    weapon: matching.filter(item => item.pool === 'weapon').length,
    standard: matching.filter(item => item.pool === 'standard').length,
    chronicled: matching.filter(item => item.pool === 'chronicled').length,
    partial: calendar.partial === true,
  };
}

export function mergeCalendar(previous, incoming) {
  if (!incoming) return previous ?? null;
  if (!previous || previous.version !== incoming.version) return incoming;
  const periods = new Map(previous.periods.map(period => [`${period.pool}:${period.start}:${period.end}:${period.name}`, period]));
  for (const period of incoming.periods) periods.set(`${period.pool}:${period.start}:${period.end}:${period.name}`, period);
  const list = [...periods.values()].slice(-100);
  return { ...incoming, periods: list, start: Math.min(...list.map(item => item.start)), end: Math.max(...list.map(item => item.end)) };
}
