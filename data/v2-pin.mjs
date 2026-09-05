// Device-local UX lock only. The bundled initial digest is not a server secret.
export async function pinDigest(pin, salt, cryptoApi = globalThis.crypto) {
  if (!/^\d{4,8}$/.test(pin)) throw Error('PIN: 4–8 цифр');
  const key = await cryptoApi.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await cryptoApi.subtle.deriveBits({ name:'PBKDF2', salt:new TextEncoder().encode(salt), iterations:150000, hash:'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2,'0')).join('');
}
const initial = { salt: 'ramina-device-pin-v2', digest: '4391fac2305958a176292f632a462f6d2f80bd8742ccd34b5b12dd599f5d40b2' };
export async function unlockPin(storage, key, pin, cryptoApi = globalThis.crypto) {
  const saved = JSON.parse(storage.getItem(key) ?? 'null') ?? initial;
  if ((await pinDigest(pin, saved.salt, cryptoApi)) !== saved.digest) return false;
  if (!storage.getItem(key)) {
    const salt = cryptoApi.randomUUID();
    storage.setItem(key, JSON.stringify({salt, digest: await pinDigest(pin, salt, cryptoApi)}));
  }
  return true;
}
