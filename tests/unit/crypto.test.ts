import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretBox } from '../../src/core/crypto.js';

describe('SecretBox', () => {
  it('加密/解密往返且密文不同', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fuma-crypto-'));
    const box = new SecretBox(join(dir, 'secret.key'));
    const plain = '{"value":"abc123"}';
    const a = box.encrypt(plain);
    const b = box.encrypt(plain);
    expect(a).not.toBe(b);
    expect(box.decrypt(a)).toBe(plain);
    expect(box.decrypt(b)).toBe(plain);
  });

  it('key 文件权限 600 且 32 字节', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fuma-crypto-'));
    const keyPath = join(dir, 'secret.key');
    // eslint-disable-next-line no-new
    new SecretBox(keyPath);
    const st = statSync(keyPath);
    expect(st.size).toBe(32);
    expect(st.mode & 0o777).toBe(0o600);
  });

  it('篡改密文应失败', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fuma-crypto-'));
    const box = new SecretBox(join(dir, 'secret.key'));
    const enc = box.encrypt('hello');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => box.decrypt(parts.join('.'))).toThrow();
  });
});
