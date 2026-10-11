// RFC 1321 MD5, used only for HoYoLAB's public request-signature format.
// This is not password hashing or a security primitive for local data.
const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
export function md5(text) {
  const bytes = new TextEncoder().encode(text);
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes); padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setBigUint64(padded.length - 8, BigInt(bytes.length) * 8n, true);
  let state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < padded.length; offset += 64) {
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      const round = Math.floor(i / 16);
      const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const word = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
      const value = (a + f + constants[i] + view.getUint32(offset + word * 4, true)) >>> 0;
      const shift = shifts[round * 4 + i % 4];
      [a, b, c, d] = [d, (b + ((value << shift) | (value >>> (32 - shift)))) >>> 0, b, c];
    }
    state = state.map((v, i) => (v + [a, b, c, d][i]) >>> 0);
  }
  return state.map(word => [0, 8, 16, 24].map(shift => ((word >>> shift) & 255).toString(16).padStart(2, '0')).join('')).join('');
}
export function recordHeaders(now = Date.now(), nonce) {
  if (!nonce) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    nonce = Array.from(bytes, byte => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'[byte % 52]).join('');
  }
  const t = Math.floor(now / 1000);
  const hash = md5(`salt=6s25p5ox5y14umn1p61aqyyvbvvl3lrt&t=${t}&r=${nonce}`);
  return { ds: `${t},${nonce},${hash}`, 'x-rpc-app_version': '1.5.0', 'x-rpc-client_type': '5', 'x-rpc-language': 'ko-kr', 'x-rpc-lang': 'ko-kr' };
}
