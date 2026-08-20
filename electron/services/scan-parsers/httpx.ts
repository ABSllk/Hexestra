import type { StructuredAssetRegistration } from '../sync-targets.service';
import type { ScanParser, ScanParseResult } from './types';

interface HttpxLine {
  url?: unknown;
  input?: unknown;
  host?: unknown;
  status_code?: unknown;
  title?: unknown;
  tech?: unknown;
  webserver?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asTechnologies(tech: unknown, webserver: unknown): string[] | undefined {
  const list = Array.isArray(tech)
    ? tech.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const server = asString(webserver);
  if (server && !list.includes(server)) list.push(server);
  return list.length ? list : undefined;
}

/** httpx JSON/JSONL (`httpx -json`) → web-app registrations, one per line. */
export const httpxScanParser: ScanParser = {
  format: 'httpx',
  label: 'httpx JSON lines',
  outputHint: 'httpx -json',
  parse(raw): ScanParseResult {
    const registrations: StructuredAssetRegistration[] = [];
    let skipped = 0;

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let record: HttpxLine;
      try {
        record = JSON.parse(trimmed) as HttpxLine;
      } catch {
        skipped += 1;
        continue;
      }
      const url = asString(record.url) ?? asString(record.input);
      if (!url) { skipped += 1; continue; }
      const statusCode = typeof record.status_code === 'number' ? record.status_code : undefined;
      registrations.push({
        type: 'webapp',
        url,
        ip: asString(record.host),
        statusCode: Number.isInteger(statusCode) ? statusCode : undefined,
        title: asString(record.title),
        technologies: asTechnologies(record.tech, record.webserver),
      });
    }

    return { registrations, skipped };
  },
};
