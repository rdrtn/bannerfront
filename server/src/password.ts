import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 10;

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const options: ScryptOptions = { N: n, r, p, maxmem: 128 * n * r * 2 };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LEN, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Formato: scrypt$N$r$p$salt(base64)$hash(base64). Os parâmetros ficam no hash para permitir aumentá-los depois. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await derive(password, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | null = null;

/** Hash de mentira, usado para gastar o mesmo tempo quando o e-mail não existe. */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(12).toString('hex'));
  return dummyHash;
}
