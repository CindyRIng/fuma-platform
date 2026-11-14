import { PNG } from 'pngjs';
import * as jsQRModule from 'jsqr';
const jsQR = ((jsQRModule as unknown as { default?: unknown }).default ?? jsQRModule) as (data: Uint8ClampedArray, width: number, height: number, opts?: Record<string, unknown>) => { data?: string } | null;
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource
} from '@zxing/library';
import QRCode from 'qrcode';

export interface DecodedQr {
  payload: string | null;
  decoder: 'zxing' | 'jsqr' | 'zxing+2x' | null;
}

/** PNG buffer → 二维码文本（ZXing 优先，失败回退 jsQR / 2x 放大）。 */
export function decodeQrPng(buf: Buffer): DecodedQr {
  const png = PNG.sync.read(buf);
  const tryDecode = (pngData: PNG): DecodedQr => {
    const { width: w, height: h, data } = pngData;
    const lum = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const a = data[i * 4 + 3];
      lum[i] = Math.round((0.299 * r + 0.587 * g + 0.114 * b) * (a / 255) + 255 * (1 - a / 255));
    }
    try {
      const reader = new MultiFormatReader();
      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, w, h)));
      const res = reader.decode(bitmap, hints as never);
      const text = res?.getText?.();
      if (text) return { payload: text, decoder: 'zxing' };
    } catch {
      /* fallthrough */
    }
    try {
      const code = jsQR(new Uint8ClampedArray(pngData.data), w, h, { inversionAttempts: 'attemptBoth' });
      if (code?.data) return { payload: code.data, decoder: 'jsqr' };
    } catch {
      /* ignore */
    }
    return { payload: null, decoder: null };
  };

  const first = tryDecode(png);
  if (first.payload) return first;
  // 2x 放大再试
  const scale = 2;
  const up = new PNG({ width: png.width * scale, height: png.height * scale });
  for (let y = 0; y < up.height; y++) {
    for (let x = 0; x < up.width; x++) {
      const si = ((Math.floor(y / scale) * png.width) + Math.floor(x / scale)) * 4;
      const di = (y * up.width + x) * 4;
      up.data[di] = png.data[si];
      up.data[di + 1] = png.data[si + 1];
      up.data[di + 2] = png.data[si + 2];
      up.data[di + 3] = png.data[si + 3];
    }
  }
  const second = tryDecode(up);
  if (second.payload) return { payload: second.payload, decoder: 'zxing+2x' };
  return { payload: null, decoder: null };
}

export interface RenderedQr {
  payload: string;
  pngBase64: string;
  ascii: string;
}

/** payload → 重新编码 PNG(base64) + 终端 ASCII 二维码。 */
export async function renderQr(payload: string): Promise<RenderedQr> {
  const buf = await QRCode.toBuffer(payload, {
    type: 'png',
    width: 420,
    margin: 3,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#FFFFFF' }
  });
  const ascii = await QRCode.toString(payload, { type: 'terminal', small: true, margin: 2, errorCorrectionLevel: 'M' });
  return { payload, pngBase64: buf.toString('base64'), ascii };
}
