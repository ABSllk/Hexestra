import type { Rectangle } from 'electron';
import type { BrowserBounds, BrowserIdentity } from '../contracts/browser';

const MAX_BROWSER_DIMENSION = 16_384;

export function normalizeBrowserUrl(value: string): string {
  if (typeof value !== 'string' || value.length > 8_192) throw new Error('Invalid browser URL');
  const trimmed = value.trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^https?:/i.test(trimmed)) {
    throw new Error('Only HTTP(S) URLs are supported');
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP(S) URLs are supported');
  return parsed.toString();
}

export function sanitizeBrowserBounds(bounds: BrowserBounds): Rectangle {
  const x = clampDimension(bounds.x);
  const y = clampDimension(bounds.y);
  const width = clampDimension(bounds.width);
  const height = clampDimension(bounds.height);
  return { x, y, width, height };
}

export function browserProjectPartition(projectId: string) {
  return `persist:hexestra-browser-${projectId}`;
}

export function browserRuntimeKey(ownerId: number, identity: BrowserIdentity) {
  return `${ownerId}:${identity.projectId}:${identity.tabId}`;
}

export function shouldDestroyBrowserRuntime(
  runtime: { ownerId: number; projectId: string; tabId: string },
  ownerId: number,
  projectId: string | null,
  retainedTabIds: ReadonlySet<string>,
) {
  return runtime.ownerId === ownerId
    && (runtime.projectId !== projectId || !retainedTabIds.has(runtime.tabId));
}

function clampDimension(value: number) {
  return Math.max(0, Math.min(MAX_BROWSER_DIMENSION, Math.round(value)));
}
