import { GAMES } from './games.js';
import { getAccounts } from './records.js';

// A stored profile is not proof of an active HoYoLAB login. Verify the session
// with read-only role requests, without changing privacy settings or claiming rewards.
export async function verifyConnection(previous, loadAccounts = getAccounts) {
  const games = Object.keys(GAMES);
  const results = await Promise.allSettled(games.map(game => loadAccounts(game)));
  const checkedAt = Date.now();
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.some(result => result.reason.kind === 'login')) {
    return { connected: false, needsLogin: true, checkedAt, accounts: {}, error: '호요랩 로그인이 필요합니다. 로그인 후 팝업을 다시 열어주세요.' };
  }
  if (results.some(result => result.status === 'fulfilled')) {
    return {
      connected: true, needsLogin: false, checkedAt, verifiedAt: checkedAt,
      accounts: Object.fromEntries(games.map((game, index) => [game, results[index].status === 'fulfilled' ? results[index].value : []])),
      gameErrors: Object.fromEntries(games.flatMap((game, index) => results[index].status === 'rejected' ? [[game, results[index].reason.message]] : [])),
    };
  }
  return { ...previous, connected: previous?.connected === true, needsLogin: false, checkedAt,
    error: '연결 상태를 확인하지 못했습니다. 잠시 후 다시 확인해주세요.',
  };
}
