// Convert official server-local date parts; never guess a reset cycle.
export function contentTime(value, region) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || typeof value === 'string') {
    const n = Number(value); return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : null;
  }
  const offset = { os_asia: 8, os_cht: 8, os_euro: 1, os_usa: -5, prod_official_asia: 8, prod_official_cht: 8, prod_official_eur: 1, prod_official_usa: -5 }[region];
  if (offset == null || !['year', 'month', 'day', 'hour', 'minute'].every(key => Number.isInteger(value[key]))) return null;
  const { year, month, day, hour, minute, second = 0 } = value;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second), d = new Date(utc);
  if (!Number.isInteger(second) || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  return utc - offset * 3600000;
}
export function deadline(end, now = Date.now()) {
  if (!Number.isFinite(end) || end <= 0) return '일정 확인 필요';
  if (end <= now) return '기간 종료 · 동기화 필요';
  const localDay = time => Math.floor((time + 9 * 3600000) / 86400000);
  const days = localDay(end) - localDay(now);
  return days === 0 ? 'D-DAY' : `D-${days}`;
}
