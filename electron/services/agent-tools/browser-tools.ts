import { z } from 'zod';
import { browserService } from '../browser.service';
import type { AgentToolContext } from './context';
import { createAgentTool } from './contract';

export function createBrowserAgentTools({ sender, sessionId }: AgentToolContext) {
  return [
    createAgentTool(
      'browser_tabs',
      'List project browser tabs. The visible tab is the default when tabId is omitted. scopeState is informational and never blocks browser access.',
      {},
      async () => ({
        content: [{ type: 'text', text: JSON.stringify(browserService.listTabs(sender.id, sessionId), null, 2) }],
      }),
    ),
    createAgentTool(
      'browser_read',
      'Read the visible browser page. Returns bounded text and element references valid until navigation or the next snapshot. Out-of-scope pages remain accessible.',
      { tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab') },
      async ({ tabId }) => ({
        content: [{ type: 'text', text: JSON.stringify(await browserService.readPage(sender.id, sessionId, tabId), null, 2) }],
      }),
    ),
    createAgentTool(
      'browser_cookies',
      'Read all cookies in the project browser partition, including raw values and HttpOnly metadata. Does not require Traffic Capture or an open tab.',
      {},
      async () => ({
        content: [{ type: 'text', text: JSON.stringify(await browserService.readCookies(sessionId), null, 2) }],
      }),
    ),
    createAgentTool(
      'browser_storage',
      'Read localStorage and sessionStorage key/value pairs from the selected tab's origin.',
      { tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab') },
      async ({ tabId }) => ({
        content: [{ type: 'text', text: JSON.stringify(await browserService.readStorage(sender.id, sessionId, tabId), null, 2) }],
      }),
    ),
    createAgentTool(
      'browser_evaluate',
      'Execute JavaScript in the selected tab's main page and return a serializable result. It can modify page, storage, navigation, and network state.',
      {
        source: z.string().min(1).max(100_000).describe('JavaScript source to execute in the page'),
        tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab'),
      },
      async ({ source, tabId }) => ({
        content: [{ type: 'text', text: JSON.stringify(await browserService.evaluate(sender.id, source, sessionId, tabId), null, 2) }],
      }),
    ),
    createAgentTool(
      'browser_navigate',
      'Navigate a browser tab to any HTTP(S) URL. Create a tab if none exists. The returned scopeState is informational and does not block navigation.',
      {
        url: z.string().describe('Destination URL'),
        tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab'),
      },
      async ({ url, tabId }) => {
        if (!sessionId) throw new Error('No active engagement');
        return {
          content: [{ type: 'text', text: JSON.stringify(await browserService.navigateOrOpen(sender, url, sessionId, tabId)) }],
        };
      },
    ),
    createAgentTool(
      'browser_back',
      'Navigate the selected tab back.',
      { tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab') },
      async ({ tabId }) => ({
        content: [{ type: 'text', text: JSON.stringify(await browserService.agentGoBack(sender.id, sessionId, tabId)) }],
      }),
    ),
    createAgentTool(
      'browser_forward',
      'Navigate the selected tab forward.',
      { tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab') },
      async ({ tabId }) => ({
        content: [{ type: 'text', text: JSON.stringify(await browserService.agentGoForward(sender.id, sessionId, tabId)) }],
      }),
    ),
    createAgentTool(
      'browser_reload',
      'Reload the selected tab.',
      { tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab') },
      async ({ tabId }) => ({
        content: [{ type: 'text', text: JSON.stringify(await browserService.agentReload(sender.id, sessionId, tabId)) }],
      }),
    ),
    createAgentTool(
      'browser_click',
      'Click an element reference returned by browser_read.',
      {
        ref: z.string().describe('Element reference such as p2-3'),
        tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab'),
      },
      async ({ ref, tabId }) => {
        const location = await browserService.click(sender.id, ref, sessionId, tabId);
        return { content: [{ type: 'text', text: JSON.stringify({ action: `Clicked ${ref}`, ...location }) }] };
      },
    ),
    createAgentTool(
      'browser_type',
      'Fill an input or textarea referenced by browser_read, optionally submitting it.',
      {
        ref: z.string().describe('Element reference such as p2-5'),
        text: z.string().describe('Text to enter'),
        submit: z.boolean().optional().describe('Submit the parent form after typing'),
        tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab'),
      },
      async ({ ref, text, submit, tabId }) => {
        const location = await browserService.type(sender.id, ref, text, submit ?? false, sessionId, tabId);
        return { content: [{ type: 'text', text: JSON.stringify({ action: `Entered text into ${ref}`, ...location }) }] };
      },
    ),
    createAgentTool(
      'browser_fill',
      'Fill an input or textarea referenced by browser_read, optionally submitting it.',
      {
        ref: z.string().describe('Element reference such as p2-5'),
        text: z.string().describe('Text to enter'),
        submit: z.boolean().optional().describe('Submit the parent form after filling'),
        tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab'),
      },
      async ({ ref, text, submit, tabId }) => {
        const location = await browserService.type(sender.id, ref, text, submit ?? false, sessionId, tabId);
        return { content: [{ type: 'text', text: JSON.stringify({ action: `Filled ${ref}`, ...location }) }] };
      },
    ),
    createAgentTool(
      'browser_press',
      'Press a key or chord in the selected tab.',
      {
        key: z.string().describe('Playwright key such as Enter, Escape, or Control+L'),
        tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab'),
      },
      async ({ key, tabId }) => {
        const location = await browserService.press(sender.id, key, sessionId, tabId);
        return { content: [{ type: 'text', text: JSON.stringify({ action: `Pressed ${key}`, ...location }) }] };
      },
    ),
    createAgentTool(
      'browser_hover',
      'Hover an element reference returned by browser_read.',
      {
        ref: z.string().describe('Element reference such as p2-3'),
        tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab'),
      },
      async ({ ref, tabId }) => {
        const location = await browserService.hover(sender.id, ref, sessionId, tabId);
        return { content: [{ type: 'text', text: JSON.stringify({ action: `Hovered ${ref}`, ...location }) }] };
      },
    ),
    createAgentTool(
      'browser_wait',
      'Wait for page loading, animation, or an asynchronous update.',
      {
        milliseconds: z.number().min(0).max(30_000).describe('Wait duration, at most 30000 ms'),
        tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab'),
      },
      async ({ milliseconds, tabId }) => {
        const location = await browserService.wait(sender.id, milliseconds, sessionId, tabId);
        return { content: [{ type: 'text', text: JSON.stringify({ action: `Waited ${milliseconds} ms`, ...location }) }] };
      },
    ),
    createAgentTool(
      'browser_screenshot',
      'Capture the selected tab viewport as PNG.',
      { tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab') },
      async ({ tabId }) => {
        const screenshot = await browserService.screenshot(sender.id, sessionId, tabId);
        return { content: [
          { type: 'text', text: JSON.stringify({ url: screenshot.url, title: screenshot.title, scopeState: screenshot.scopeState }) },
          { type: 'image', data: screenshot.base64, mimeType: screenshot.mimeType },
        ] };
      },
    ),
  ];
}
