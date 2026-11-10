import { createHash, randomBytes } from 'node:crypto';

export async function sha256(s: string): Promise<string> {
  return createHash('sha256').update(s).digest('hex');
}

export function newId(prefix: string): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  let body = '';
  for (const b of bytes) body += alphabet[b % alphabet.length];
  return `${prefix}_${body}`;
}
