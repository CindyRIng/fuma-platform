import { launchPersistentContext } from 'cloakbrowser';
import type { BrowserContext, Page } from 'playwright-core';
import { decodeQrPng, renderQr } from './qr.js';

export interface BrowserOptions {
  profileDir: string;
  headless?: boolean;
  locale?: string;
  timezone?: string;
  viewport?: { width: number; height: number };
}

export interface QrSnapshot {
  payload: string;
  pngBase64: string;
  ascii: string;
  capturedAt: string;
}

export interface ScanProgress {
  scanned: boolean;
  confirmed: boolean;
  popupUrl: string;
  popupText: string;
  popupClosed: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function visibleText(page: Page): Promise<string> {
  try {
    return (await page.evaluate(() => document.body?.innerText || '')).replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

/**
 * 钉钉 SSO 扫码登录的浏览器驱动（在 P0 侦察脚本验证过的流程上抽象）。
 * 仅负责浏览器侧动作；状态机/持久化在 SessionManager。
 */
export class LoginBrowser {
  ctx: BrowserContext | null = null;
  page: Page | null = null;
  popup: Page | null = null;
  private readonly opts: Required<Omit<BrowserOptions, 'viewport'>> & { viewport: { width: number; height: number } };

  constructor(opts: BrowserOptions) {
    this.opts = {
      profileDir: opts.profileDir,
      headless: opts.headless ?? true,
      locale: opts.locale ?? 'zh-CN',
      timezone: opts.timezone ?? 'Asia/Shanghai',
      viewport: opts.viewport ?? { width: 1440, height: 900 }
    };
  }

  async launch(): Promise<void> {
    this.ctx = await launchPersistentContext({
      userDataDir: this.opts.profileDir,
      headless: this.opts.headless,
      humanize: false,
      timezone: this.opts.timezone,
      locale: this.opts.locale,
      viewport: this.opts.viewport
    });
    this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
  }

  async openLoginPage(url = 'https://www.fumamx.com/#/login'): Promise<void> {
    if (!this.page) throw new Error('browser not launched');
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await sleep(5000);
  }

  /** 点击钉钉登录图标并等待 OAuth 弹窗。 */
  async clickDingtalkAndWaitPopup(): Promise<Page> {
    if (!this.page || !this.ctx) throw new Error('browser not launched');
    const popupPromise = this.ctx.waitForEvent('page', { timeout: 30_000 });
    const icon = this.page.locator('img[src*="dingtalk"]').first();
    await icon.click({ timeout: 15_000 });
    const popup = await popupPromise;
    if (!popup) throw new Error('钉钉登录弹窗未打开');
    this.popup = popup;
    await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
    await sleep(3000);
    return popup;
  }

  /** 抓取当前二维码 canvas，解码后重新编码。 */
  async captureQr(): Promise<QrSnapshot | null> {
    if (!this.popup) return null;
    try {
      await this.popup.waitForSelector('.module-qrcode-code canvas', { state: 'visible', timeout: 15_000 });
      const dataUrl = await this.popup.evaluate(() => {
        const c = document.querySelector('.module-qrcode-code canvas') as HTMLCanvasElement | null;
        return c ? c.toDataURL('image/png') : null;
      });
      if (!dataUrl) return null;
      const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
      const decoded = decodeQrPng(buf);
      if (!decoded.payload) return null;
      const rendered = await renderQr(decoded.payload);
      return { ...rendered, capturedAt: new Date().toISOString() };
    } catch {
      return null;
    }
  }

  /** 读取扫码进度（页面文字驱动，避免依赖钉钉轮询接口）。 */
  async scanProgress(): Promise<ScanProgress> {
    if (!this.popup) return { scanned: false, confirmed: false, popupUrl: '', popupText: '', popupClosed: true };
    const closed = this.popup.isClosed();
    if (closed) return { scanned: false, confirmed: false, popupUrl: '', popupText: '', popupClosed: true };
    const text = await visibleText(this.popup);
    const scanned = /扫描成功|请在手机上确认|扫码成功/.test(text);
    const confirmed = /登录成功|授权成功/.test(text);
    return { scanned, confirmed, popupUrl: this.popup.url(), popupText: text.slice(0, 500), popupClosed: false };
  }

  /** 扫描后：选择钉钉组织（精确名称）→ 确定 → 同意授权（如有）。 */
  async selectOrganization(company: string): Promise<{ clicked: boolean; confirmed: boolean; consented: boolean }> {
    if (!this.popup) return { clicked: false, confirmed: false, consented: false };
    let clicked = false;
    let confirmed = false;
    let consented = false;
    try {
      clicked = await this.popup.evaluate((c) => {
        const vis = (e: Element) => !!((e as HTMLElement).offsetWidth || (e as HTMLElement).offsetHeight);
        const els = [...document.querySelectorAll('*')].filter((e) => vis(e) && ((e as HTMLElement).innerText || '').trim() === c);
        if (!els.length) return false;
        (els[els.length - 1] as HTMLElement).click();
        return true;
      }, company);
      await sleep(1200);
      if (clicked && !this.popup.isClosed()) {
        const stillOrg = ((await visibleText(this.popup)).includes('选择你加入的组织'));
        if (stillOrg) {
          confirmed = await this.popup.evaluate(() => {
            const vis = (e: Element) => !!((e as HTMLElement).offsetWidth || (e as HTMLElement).offsetHeight);
            const els = [...document.querySelectorAll('div,button,span')].filter((e) => vis(e) && ((e as HTMLElement).innerText || '').trim() === '确定');
            if (!els.length) return false;
            (els[els.length - 1] as HTMLElement).click();
            return true;
          });
          await sleep(1200);
        }
      }
      if (!this.popup.isClosed()) {
        const txt = await visibleText(this.popup);
        if (/想要访问你的钉钉账号|同意授权/.test(txt)) {
          consented = await this.popup.evaluate(() => {
            const vis = (e: Element) => !!((e as HTMLElement).offsetWidth || (e as HTMLElement).offsetHeight);
            const els = [...document.querySelectorAll('div,button,span')].filter((e) => vis(e) && ((e as HTMLElement).innerText || '').trim() === '同意');
            if (!els.length) return false;
            (els[els.length - 1] as HTMLElement).click();
            return true;
          });
          await sleep(1200);
        }
      }
    } catch {
      /* 页面关闭/结构变化时忽略 */
    }
    return { clicked, confirmed, consented };
  }

  /** 主页面：选择孚盟企业并点击进入（中英文按钮均支持）。 */
  async selectFumaEnterprise(company: string): Promise<{ selected: boolean; entered: boolean }> {
    if (!this.page) return { selected: false, entered: false };
    const text = await visibleText(this.page);
    if (!/请选择您要进入的企业|select the enterprise|Please select the enterprise/i.test(text)) {
      return { selected: false, entered: false };
    }
    const selected = await this.page.evaluate((c) => {
      const label = [...document.querySelectorAll('label')].find((l) => ((l as HTMLElement).innerText || '').includes(c));
      label?.querySelector<HTMLInputElement>('input[type=radio]')?.click();
      if (!label) {
        const el = [...document.querySelectorAll('span,div,p')].find((e) => ((e as HTMLElement).innerText || '').trim() === c);
        (el as HTMLElement | undefined)?.click();
      }
      return true;
    }, company);
    await sleep(1000);
    let entered = false;
    const buttons = this.page.locator('button');
    const n = await buttons.count();
    for (let i = 0; i < n; i++) {
      const b = buttons.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      const t = (await b.innerText().catch(() => '')) || '';
      if (/进入企业|^Enter$/.test(t.trim())) { await b.click({ timeout: 10_000 }); entered = true; break; }
    }
    if (!entered) {
      entered = await this.page.evaluate(() => {
        const vis = (e: Element) => !!((e as HTMLElement).offsetWidth || (e as HTMLElement).offsetHeight);
        const el = [...document.querySelectorAll('button,div,span')].find((e) => vis(e) && ['进入企业', 'Enter'].includes(((e as HTMLElement).innerText || '').trim()));
        if (el) { (el as HTMLElement).click(); return true; }
        return false;
      });
    }
    return { selected, entered };
  }

  /** 等待进入工作台并返回 sessionStorage 中的 token JSON。 */
  async waitForWorkbenchTokens(timeoutMs = 90_000): Promise<{ accessToken: string; individualAccessToken: string; raw: Record<string, string> } | null> {
    if (!this.page) return null;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const url = this.page.url();
        const tokens = await this.page.evaluate(() => {
          const get = (k: string) => window.sessionStorage.getItem(k) ?? window.localStorage.getItem(k);
          return { accessToken: get('accessToken'), individualAccessToken: get('individualAccessToken') };
        });
        if (tokens.accessToken && tokens.individualAccessToken) {
          const raw: Record<string, string> = {};
          const ss = await this.page.evaluate(() => {
            const out: Record<string, string> = {};
            for (let i = 0; i < sessionStorage.length; i++) {
              const k = sessionStorage.key(i);
              if (k) out[k] = String(sessionStorage.getItem(k) ?? '');
            }
            return out;
          });
          Object.assign(raw, ss);
          return { accessToken: tokens.accessToken, individualAccessToken: tokens.individualAccessToken, raw };
        }
        if (/workbench/i.test(url)) {
          // 已进入工作台但仍未拿到 token，继续等待
        }
      } catch {
        /* navigation in progress */
      }
      await sleep(1000);
    }
    return null;
  }

  async reloadQr(): Promise<void> {
    if (this.popup && !this.popup.isClosed()) {
      await this.popup.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await sleep(3000);
    }
  }

  async close(): Promise<void> {
    if (this.ctx) {
      await this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.page = null;
      this.popup = null;
    }
  }
}
