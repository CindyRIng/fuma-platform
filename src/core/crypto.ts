import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ALG = 'aes-256-gcm';
const VERSION = 'v1';

/**
 * 本地加密（AES-256-GCM）。key 独立于 DB 存储，权限 600。
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(keyPath: string) {
    if (existsSync(keyPath)) {
      const raw = readFileSync(keyPath);
      if (raw.length !== 32) throw new Error(`secret key 文件长度异常: ${keyPath}`);
      this.key = raw;
    } else {
      mkdirSync(dirname(keyPath), { recursive: true });
      this.key = randomBytes(32);
      writeFileSync(keyPath, this.key, { mode: 0o600 });
      try { chmodSync(keyPath, 0o600); } catch { /* ignore */ }
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALG, this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('无效密文格式');
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = createDecipheriv(ALG, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}
