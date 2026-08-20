import type { ScanParser } from './types';
import { nmapScanParser } from './nmap';
import { httpxScanParser } from './httpx';

// The single source of truth for supported formats. Register a new mapper here —
// its `format` is automatically exposed to the asset_import tool and validated.
const PARSERS: readonly ScanParser[] = [nmapScanParser, httpxScanParser];

const REGISTRY: ReadonlyMap<string, ScanParser> = new Map(
  PARSERS.map((parser) => [parser.format, parser]),
);

export const SCAN_PARSER_FORMATS: [string, ...string[]] = PARSERS.map((parser) => parser.format) as [string, ...string[]];

export function getScanParser(format: string): ScanParser | undefined {
  return REGISTRY.get(format);
}

/** One-line summary of every supported format for the tool description. */
export function describeScanParsers(): string {
  return PARSERS.map((parser) => `${parser.format} (${parser.outputHint})`).join(', ');
}

export type { ScanParser, ScanParseResult } from './types';
