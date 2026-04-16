import crypto from 'crypto';

const SECRET = process.env.ANON_TOKEN_SECRET || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export function generateAnonToken(anonUserId: string): string {
  return crypto.createHmac('sha256', SECRET).update(anonUserId).digest('hex');
}

export function verifyAnonToken(anonUserId: string, token: string): boolean {
  if (!token || !anonUserId) return false;
  const expected = generateAnonToken(anonUserId);
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}
