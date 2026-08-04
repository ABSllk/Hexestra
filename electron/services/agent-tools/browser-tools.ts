import { z } from 'zod';
import { browserService } from '../browser.service';
import type { AgentToolContext } from './context';

export function createBrowserAgentTools({ sdk, sender, sessionId }: AgentToolContext) {
  return [
    sdk.tool(
      'browser_tabs',
      'List integrated browser tabs in the active Hexestra project. The visible tab is the default for tools when tabId is omitted. scopeState is informational and never blocks browser access.',
      {},
      async () => ({
        content: [{ type: 'text', text: JSON.stringify(browserService.listTabs(sender.id, sessionId), null, 2) }],
      }),
    ),
    sdk.tool(
      'browser_read',
      'Read a visible Hexestra browser page through Playwright. Returns informational scopeState, bounded page text, and element references that remain valid until the next navigation or snapshot. Out-of-scope pages remain accessible.',
      { tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab') },
      async ({ tabId }) => ({
        content: [{ type: 'text', text: JSON.stringify(await browserService.readPage(sender.id, sessionId, tabId), null, 2) }],
      }),
    ),
    sdk.tool(
      'browser_navigate',
      'Navigate a Hexestra integrated browser tab to any HTTP(S) URL through Playwright. If no Browser tab exists, create one automatically. The returned scopeState is informational and does not block navigation.',
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
    sdk.tool(
      'browser_back',
      'Navigate back in the selected integrated browser tab.',
      { tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab') },
      async ({ tabId }) => ({
        content: [{ type: 'text', text: JSON.stringify(await browserService.agentGoBack(sender.id, sessionId, tabId)) }],
      }),
    ),
    sdk.tool(
      'browser_forward',
      'Navigate forward in the selected integrated browser tab.',
      { tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab') },
      async ({ tabId }) => ({
        content: [{ type: 'text', text: JSON.stringify(await browserService.agentGoForward(sender.id, sessionId, tabId)) }],
      }),
    ),
    sdk.tool(
      'browser_reload',
      'Reload the selected integrated browser tab.',
      { tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab') },
      async ({ tabId }) => ({
        content: [{ type: 'text', text: JSON.stringify(await browserService.agentReload(sender.id, sessionId, tabId)) }],
      }),
    ),
    sdk.tool(
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
    sdk.tool(
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
    sdk.tool(
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
    sdk.tool(
      'browser_press',
      'Press a keyboard key or chord in the selected integrated browser tab.',
      {
        key: z.string().describe('Playwright key such as Enter, Escape, or Control+L'),
        tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab'),
      },
      async ({ key, tabId }) => {
        const location = await browserService.press(sender.id, key, sessionId, tabId);
        return { content: [{ type: 'text', text: JSON.stringify({ action: `Pressed ${key}`, ...location }) }] };
      },
    ),
    sdk.tool(
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
    sdk.tool(
      'browser_wait',
      'Wait briefly for page loading, animation, or an asynchronous update in the integrated browser.',
      {
        milliseconds: z.number().min(0).max(30_000).describe('Wait duration, at most 30000 ms'),
        tabId: z.string().optional().describe('Browser tab ID; defaults to the visible browser tab'),
      },
      async ({ milliseconds, tabId }) => {
        const location = await browserService.wait(sender.id, milliseconds, sessionId, tabId);
        return { content: [{ type: 'text', text: JSON.stringify({ action: `Waited ${milliseconds} ms`, ...location }) }] };
      },
    ),
    sdk.tool(
      'browser_screenshot',
      'Capture the current integrated browser viewport as a PNG image.',
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
