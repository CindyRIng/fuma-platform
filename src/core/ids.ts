import { randomUUID, randomBytes, createHash } from 'node:crypto';

export function newRequestId(): string {
  return `req_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
