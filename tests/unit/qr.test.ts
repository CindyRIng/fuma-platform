import { describe, expect, it } from 'vitest';
import { decodeQrPng, renderQr } from '../../src/auth/qr.js';

describe('qr', () => {
  it('payload → PNG → 解码 往返一致（ZXing）', async () => {
    const payload = 'https://login.dingtalk.com/oauth2/qr_confirm.htm?code=TEST-1234-ABCD';
    const rendered = await renderQr(payload);
    const buf = Buffer.from(rendered.pngBase64, 'base64');
    const decoded = decodeQrPng(buf);
    expect(decoded.payload).toBe(payload);
    expect(decoded.decoder).toMatch(/zxing/);
    expect(rendered.ascii.length).toBeGreaterThan(10);
  });
});
