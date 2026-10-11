import { GAMES } from './games.js';

export class CheckinError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

async function request(game, endpoint, fetcher) {
  const url = new URL(`${game.base}/${endpoint}`);
  url.searchParams.set('lang', 'ko-kr');
  url.searchParams.set('act_id', game.actId);
  let response;
  try {
    response = await fetcher(url.href, {
      method: endpoint === 'sign' ? 'POST' : 'GET',
      credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'x-rpc-signgame': game.signGame },
      ...(endpoint === 'sign' ? { body: JSON.stringify({ act_id: game.actId, lang: 'ko-kr' }) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new CheckinError('network', '연결하지 못했습니다. 잠시 후 다시 시도합니다.');
  }
  if (!response.ok) throw new CheckinError('network', `호요랩 서버 응답 오류 (HTTP ${response.status})`);
  let payload;
  try { payload = await response.json(); } catch {
    throw new CheckinError('api', '호요랩 응답 형식을 확인할 수 없습니다.');
  }
  if (typeof payload?.retcode !== 'number') throw new CheckinError('api', '호요랩 응답 형식이 변경되었습니다.');
  if (payload.retcode === -5003) return { alreadySigned: true };
  if (payload.retcode === 10001 || payload.retcode === -100) {
    throw new CheckinError('login', '호요랩 로그인이 필요합니다. 공식 출석 페이지에서 로그인하세요.');
  }
  const risk = payload.data?.gt_result ?? payload.data;
  if (risk && ((risk.risk_code != null && risk.risk_code !== 0) || risk.gt || risk.challenge)) {
    throw new CheckinError('verification', '보안 인증이 필요합니다. 공식 출석 페이지에서 직접 확인하세요.');
  }
  if (payload.retcode !== 0) throw new CheckinError('api', `호요랩 오류 (${payload.retcode}). 공식 출석 페이지를 확인하세요.`);
  return payload.data;
}

export async function checkIn(gameId, fetcher = fetch) {
  const game = GAMES[gameId];
  if (!game) throw new CheckinError('api', '지원하지 않는 게임입니다.');
  const before = await request(game, 'info', fetcher);
  if (before?.is_sign === true) return { status: 'already', days: before.total_sign_day };
  if (before?.is_sign !== false) throw new CheckinError('api', '출석 상태 응답 형식이 변경되었습니다.');
  await request(game, 'sign', fetcher);
  const after = await request(game, 'info', fetcher);
  if (after?.is_sign !== true) throw new CheckinError('api', '출석 완료를 확인하지 못했습니다. 공식 페이지를 확인하세요.');
  return { status: 'success', days: after.total_sign_day };
}
