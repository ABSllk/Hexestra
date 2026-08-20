import type { StructuredAssetRegistration } from '../sync-targets.service';

export interface ScanParseResult {
  /** Assets ready to hand to syncTargetsService.registerAssets. */
  registrations: StructuredAssetRegistration[];
  /** Entries that were present in the input but could not be mapped (malformed or unsupported). */
  skipped: number;
  /** Optional human-readable notes surfaced back to the Agent. */
  notes?: string[];
}

/**
 * A scan-output mapper. To add a new tool, implement this interface in its own
 * file and register the instance in ./index.ts — nothing else needs to change.
 *
 * Contract: `parse` is a pure function that must NEVER throw. Malformed input is
 * reported through `skipped`/`notes`, not exceptions, so one bad record can never
 * abort a whole import.
 */
export interface ScanParser {
  /** Stable format key used by the asset_import tool and the parser registry. */
  readonly format: string;
  /** One-line human label shown in the tool description (e.g. "Nmap XML"). */
  readonly label: string;
  /** The machine-readable output flag the operator/Agent must use (e.g. "nmap -oX -"). */
  readonly outputHint: string;
  parse(raw: string): ScanParseResult;
}
