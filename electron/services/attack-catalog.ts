import {
  ATTACK_CATALOG_VERSION,
  ATTACK_TACTICS,
  ATTACK_TECHNIQUES as CONTRACT_ATTACK_TECHNIQUES,
} from '../contracts/tasks';
import type { AttackCatalogTechnique, AttackCatalogTactic } from '../contracts/attack-catalog-data';

export { ATTACK_CATALOG_VERSION, ATTACK_TACTICS } from '../contracts/tasks';

export type AttackTechnique = AttackCatalogTechnique;
export type AttackTactic = AttackCatalogTactic;

export const ATTACK_TECHNIQUES: AttackTechnique[] = CONTRACT_ATTACK_TECHNIQUES as AttackTechnique[];

export const ATTACK_CATALOG = {
  version: ATTACK_CATALOG_VERSION,
  tactics: ATTACK_TACTICS,
  techniques: ATTACK_TECHNIQUES,
};

const techniqueMap = new Map(ATTACK_TECHNIQUES.map((technique) => [technique.id, technique]));
const tacticMap = new Map(ATTACK_TACTICS.map((tactic) => [tactic.id, tactic]));

export function getTechnique(id: string) {
  return techniqueMap.get(id);
}

export function getTactic(id: string) {
  return tacticMap.get(id);
}

export function deriveTactics(techniqueIds: string[]) {
  return [...new Set(techniqueIds.flatMap((id) => getTechnique(id)?.tacticIds ?? []))];
}

export function isTechniqueId(value: string): boolean {
  return Boolean(getTechnique(value));
}

export interface AttackTechniqueSearchOptions {
  query?: string;
  tacticId?: string;
  includeSubTechniques?: boolean;
  offset?: number;
  limit?: number;
}

export function listAttackTactics() {
  return {
    catalogVersion: ATTACK_CATALOG_VERSION,
    tacticCount: ATTACK_TACTICS.length,
    techniqueCount: ATTACK_TECHNIQUES.length,
    tactics: ATTACK_TACTICS.map((tactic) => ({
      ...tactic,
      techniqueCount: ATTACK_TECHNIQUES.filter((technique) => technique.tacticIds.includes(tactic.id)).length,
    })),
  };
}

export function searchAttackTechniques(options: AttackTechniqueSearchOptions = {}) {
  const query = options.query?.trim() ?? '';
  const normalizedQuery = query.toLocaleLowerCase('en-US');
  const tactic = options.tacticId ? getTactic(options.tacticId) : undefined;
  if (options.tacticId && !tactic) throw new Error(`Unknown ATT&CK tactic ${options.tacticId}`);

  const includeSubTechniques = options.includeSubTechniques ?? true;
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const matches = ATTACK_TECHNIQUES
    .filter((technique) => !tactic || technique.tacticIds.includes(tactic.id))
    .filter((technique) => includeSubTechniques || !technique.isSubTechnique)
    .filter((technique) => !normalizedQuery
      || technique.id.toLocaleLowerCase('en-US').includes(normalizedQuery)
      || technique.name.toLocaleLowerCase('en-US').includes(normalizedQuery))
    .sort((left, right) => techniqueMatchRank(left, normalizedQuery) - techniqueMatchRank(right, normalizedQuery)
      || left.id.localeCompare(right.id));
  const techniques = matches.slice(offset, offset + limit);
  const nextOffset = offset + techniques.length;

  return {
    catalogVersion: ATTACK_CATALOG_VERSION,
    query,
    tactic: tactic ?? null,
    includeSubTechniques,
    offset,
    limit,
    total: matches.length,
    nextOffset: nextOffset < matches.length ? nextOffset : null,
    techniques,
  };
}

function techniqueMatchRank(technique: AttackTechnique, normalizedQuery: string) {
  if (!normalizedQuery) return 0;
  const id = technique.id.toLocaleLowerCase('en-US');
  const name = technique.name.toLocaleLowerCase('en-US');
  if (id === normalizedQuery || name === normalizedQuery) return 0;
  if (id.startsWith(normalizedQuery) || name.startsWith(normalizedQuery)) return 1;
  return 2;
}
