import { chromium, type Browser, type Page } from 'playwright-core';
import type { Rectangle, WebContents } from 'electron';
import type { BrowserPageSnapshot } from '../contracts/browser';
import { IntegratedBrowserCdpTransport } from './browser-cdp-transport';

const PAGE_TIMEOUT_MS = 10_000;

export class BrowserAutomationSession {
  private transport: IntegratedBrowserCdpTransport | null = null;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private connecting: Promise<Page> | null = null;
  private snapshotGeneration = 0;

  constructor(
    private readonly contents: WebContents,
    private readonly browserContextId: string,
    private readonly getBounds: () => Rectangle,
  ) {}

  async snapshot(): Promise<Omit<BrowserPageSnapshot, 'scopeState'>> {
    const page = await this.getPage();
    const generation = ++this.snapshotGeneration;
    return page.evaluate(({ generation }) => {
      const candidates = [...document.querySelectorAll<HTMLElement>(
        'a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]',
      )].filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      }).slice(0, 160);
      const elements = candidates.map((element, index) => {
        const ref = `p${generation}-${index + 1}`;
        element.setAttribute('data-hexestra-ref', ref);
        return {
          ref,
          tag: element.tagName.toLowerCase(),
          text: (
            element.innerText
            || element.getAttribute('aria-label')
            || element.getAttribute('placeholder')
            || element.getAttribute('value')
            || ''
          ).trim().slice(0, 240),
          type: element.getAttribute('type') || undefined,
        };
      });
      return {
        url: location.href,
        title: document.title,
        text: (document.body?.innerText || '').slice(0, 24_000),
        elements,
      };
    }, { generation });
  }

  async navigate(url: string) {
    const page = await this.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    return { url: page.url(), title: await page.title() };
  }

  async goBack() {
    const page = await this.getPage();
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    return { url: page.url(), title: await page.title() };
  }

  async goForward() {
    const page = await this.getPage();
    await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    return { url: page.url(), title: await page.title() };
  }

  async reload() {
    const page = await this.getPage();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    return { url: page.url(), title: await page.title() };
  }

  async click(ref: string) {
    const page = await this.getPage();
    // Navigation completion is observed explicitly through browser_wait/browser_read.
    await page.locator(referenceSelector(ref)).click({ timeout: PAGE_TIMEOUT_MS, noWaitAfter: true });
  }

  async fill(ref: string, text: string, submit = false) {
    const page = await this.getPage();
    const locator = page.locator(referenceSelector(ref));
    await locator.fill(text, { timeout: PAGE_TIMEOUT_MS });
    if (submit) await locator.press('Enter');
  }

  async press(key: string) {
    const page = await this.getPage();
    await page.keyboard.press(key);
  }

  async hover(ref: string) {
    const page = await this.getPage();
    await page.locator(referenceSelector(ref)).hover({ timeout: PAGE_TIMEOUT_MS });
  }

  async wait(milliseconds: number) {
    const page = await this.getPage();
    await page.waitForTimeout(Math.max(0, Math.min(30_000, Math.round(milliseconds))));
  }

  async screenshot(): Promise<{ mimeType: 'image/png'; base64: string }> {
    const image = await this.contents.capturePage();
    const bytes = image.toPNG();
    return { mimeType: 'image/png', base64: bytes.toString('base64') };
  }

  async handleDialog(accept: boolean, promptText?: string) {
    const page = await this.getPage();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        page.removeListener('dialog', handler);
        reject(new Error('No browser dialog appeared before the timeout'));
      }, PAGE_TIMEOUT_MS);
      const handler = async (dialog: import('playwright-core').Dialog) => {
        clearTimeout(timeout);
        try {
          if (accept) await dialog.accept(promptText);
          else await dialog.dismiss();
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      page.once('dialog', handler);
    });
  }

  dispose() {
    this.page = null;
    const browser = this.browser;
    this.browser = null;
    void browser?.close().catch(() => {});
    this.transport?.close();
    this.transport = null;
  }

  private async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async connect(): Promise<Page> {
    if (this.contents.isDestroyed()) throw new Error('Browser tab is no longer available');
    this.transport = new IntegratedBrowserCdpTransport(this.contents, this.browserContextId, this.getBounds);
    this.browser = await withTimeout(
      chromium.connectOverCDP(this.transport),
      PAGE_TIMEOUT_MS,
      'Timed out while establishing the Playwright CDP connection',
    );

    const deadline = Date.now() + PAGE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const page = this.browser.contexts().flatMap((context) => context.pages())[0];
      if (page) {
        page.setDefaultTimeout(PAGE_TIMEOUT_MS);
        this.page = page;
        return page;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    this.dispose();
    throw new Error('Timed out while connecting Playwright to the integrated browser');
  }
}

function referenceSelector(ref: string) {
  if (!/^p\d+-\d+$/.test(ref)) throw new Error('Invalid or stale browser element reference');
  return `[data-hexestra-ref="${ref}"]`;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error) => { clearTimeout(timeout); reject(error); },
    );
  });
}
