export const DEFAULT_SETTINGS = { auto: false, games: { genshin: true, starrail: true } };
// HoYoLAB's daily reset is UTC+8 midnight; 01:00 Korea time.
export function dayKey(now = Date.now()) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
export function settingsFrom(value) {
  return {
    auto: value?.auto === true,
    games: {
      genshin: value?.games?.genshin !== false,
      starrail: value?.games?.starrail !== false,
    },
  };
}
export function shouldAttempt(result, now = Date.now()) {
  if (!result || result.day !== dayKey(now)) return true;
  if (['success', 'already', 'login', 'verification', 'api'].includes(result.status)) return false;
  return now - result.at >= 3600000;
}
