// Native bridge is exposed only to bundled app assets, never to remote pages.
const pending = new Map();
let serial = 0;
window.studyNativeResult = (id, status, body) => {
  const call = pending.get(id); if (!call) return;
  clearTimeout(call.timer); pending.delete(id);
  try { call.resolve({ status, body: JSON.parse(body) }); } catch { call.reject(new Error('电脑返回的数据格式无效。')); }
};
export function nativeCall(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++serial);
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('连接电脑超时，操作保留在本机。')); }, 45000);
    pending.set(id, { resolve, reject, timer });
    try { window.StudyNative.call(id, action, JSON.stringify(payload)); } catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
  });
}
export async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  let status, result;
  if (window.StudyNative) {
    const response = await nativeCall('request', { path: '/api' + path, body, method }); status = response.status; result = response.body;
  } else {
    const response = await fetch('/api' + path, { method, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    status = response.status; result = await response.json();
  }
  if (status < 200 || status >= 300) { const error = new Error(result.error || '连接失败'); error.status = status; throw error; }
  return result;
}
export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// SHA-256 fallback for LAN HTTP where SubtleCrypto is unavailable. Input is bounded to 20 MB.
export async function sha256(buffer) {
  if (crypto.subtle) return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(x => x.toString(16).padStart(2, '0')).join('');
  return sha256Plain(buffer);
}
export function sha256Plain(buffer) {
  const bytes = new Uint8Array(buffer), padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64); padded.set(bytes); padded[bytes.length] = 128;
  new DataView(padded.buffer).setUint32(padded.length - 4, bytes.length * 8);
  const K = [], H = []; for (let n = 2; K.length < 64; n++) { let prime = true; for (let j = 2; j * j <= n; j++) if (n % j === 0) { prime = false; break; } if (prime) { if (H.length < 8) H.push((Math.sqrt(n) % 1 * 2 ** 32) | 0); K.push((Math.cbrt(n) % 1 * 2 ** 32) | 0); } }
  const r = (v, n) => (v >>> n) | (v << (32 - n)), view = new DataView(padded.buffer), w = new Int32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 64; i++) w[i] = i < 16 ? view.getInt32(offset + i * 4) : (w[i - 16] + (r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 7] + (r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10))) | 0;
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) { const t = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0, t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; h = g; g = f; f = e; e = (d + t) | 0; d = c; c = b; b = a; a = (t + t2) | 0; }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  return H.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}
