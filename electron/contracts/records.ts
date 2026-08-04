export const RECORDS_IPC = {
  DELETE: 'records:delete',
  EXPORT: 'records:export',
} as const;

export const MANAGED_RECORD_KINDS = ['finding', 'vulnerability', 'evidence', 'report'] as const;

export type ManagedRecordKind = (typeof MANAGED_RECORD_KINDS)[number];

export interface RecordExportResult {
  canceled: boolean;
  filePath?: string;
}

export function isManagedRecordKind(value: unknown): value is ManagedRecordKind {
  return MANAGED_RECORD_KINDS.some((kind) => kind === value);
}
