import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { getTactic, getTechnique } from './attack-catalog';
import { projectUserDataPath } from './project-registry';

export type RestrictionScope = 'global' | 'project';

export type RestrictionSelector =
  | { kind: 'general' }
  | { kind: 'attack'; tacticIds: string[]; techniqueIds: string[] };

export interface RestrictionRule {
  id: string;
  text: string;
  enabled: boolean;
  selector: RestrictionSelector;
  createdAt: string;
  updatedAt: string;
}

export interface RestrictionDocument {
  version: 1;
  rules: RestrictionRule[];
}

export interface RestrictionDocumentResult {
  scope: RestrictionScope;
  path: string;
  exists: boolean;
  document: RestrictionDocument;
  diagnostics: string[];
  fingerprint: string;
  raw?: string;
}

export interface ResolvedRestriction {
  id: string;
  ruleIds: string[];
  text: string;
  sources: RestrictionScope[];
  matchedBy: string[];
  conflictRuleIds?: string[];
}

export interface RestrictionUpsertInput {
  id?: string;
  text: string;
  enabled?: boolean;
  selector: RestrictionSelector;
  createdAt?: string;
  updatedAt?: string;
}

export interface RestrictionImportPreview {
  scope: RestrictionScope;
  baseFingerprint: string;
  document: RestrictionDocument;
  added: RestrictionRule[];
  updated: RestrictionRule[];
  unchanged: RestrictionRule[];
  diagnostics: string[];
  conflicts: Array<{ ruleIds: string[]; text: string }>;
}

const EMPTY_DOCUMENT: RestrictionDocument = { version: 1, rules: [] };
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const PROHIBITIVE = /(禁止|不得|不能|不可|严禁|禁止|must\s+not|never|do\s+not|don't)/i;
const PERMISSIVE = /(允许|可以|可用|应当|必须|应该|允许|may|should|must|can)/i;
const MODAL_WORDS = /(禁止|不得|不能|不可|严禁|允许|可以|可用|应当|必须|应该|must|not|never|do|don't|may|should|can)/gi;

function cloneEmpty(): RestrictionDocument {
  return { version: 1, rules: [] };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string').map((value) => value.trim().toUpperCase()).filter(Boolean))].sort();
}

function normalizeSelector(raw: unknown): RestrictionSelector | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.kind === 'general') return { kind: 'general' };
  if (value.kind !== 'attack') return null;
  return { kind: 'attack', tacticIds: normalizeIds(value.tacticIds), techniqueIds: normalizeIds(value.techniqueIds) };
}

function canonicalSelector(selector: RestrictionSelector): string {
  return selector.kind === 'general'
    ? 'general'
    : `attack:t=${selector.tacticIds.join(',')};technique=${selector.techniqueIds.join(',')}`;
}

function normalizedFingerprintText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function ruleFingerprint(rule: Pick<RestrictionRule, 'text' | 'selector'>): string {
  return `${canonicalSelector(rule.selector)}|${normalizedFingerprintText(rule.text)}`;
}

function documentFingerprint(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function stableMigratedId(scope: RestrictionScope, selector: RestrictionSelector, text: string): string {
  return `restriction-${crypto.createHash('sha256').update(`${scope}|${ruleFingerprint({ selector, text })}`, 'utf8').digest('hex').slice(0, 16)}`;
}

function validateRule(raw: unknown, index: number): { rule?: RestrictionRule; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (!raw || typeof raw !== 'object') return { diagnostics: [`Rule ${index + 1} must be an object`] };
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const text = normalizeText(value.text);
  const selector = normalizeSelector(value.selector);
  const enabled = value.enabled === undefined ? true : value.enabled;
  const createdAt = value.createdAt instanceof Date ? value.createdAt.toISOString() : typeof value.createdAt === 'string' ? value.createdAt : '';
  const updatedAt = value.updatedAt instanceof Date ? value.updatedAt.toISOString() : typeof value.updatedAt === 'string' ? value.updatedAt : '';
  if (!ID_PATTERN.test(id)) diagnostics.push(`Rule ${index + 1} has an invalid id`);
  if (!text || text.length > 2_000) diagnostics.push(`Rule ${id || index + 1} text must contain 1–2,000 characters`);
  if (typeof enabled !== 'boolean') diagnostics.push(`Rule ${id || index + 1} enabled must be boolean`);
  if (!selector) diagnostics.push(`Rule ${id || index + 1} has an invalid selector`);
  if (!ISO_PATTERN.test(createdAt) || Number.isNaN(Date.parse(createdAt))) diagnostics.push(`Rule ${id || index + 1} has an invalid createdAt`);
  if (!ISO_PATTERN.test(updatedAt) || Number.isNaN(Date.parse(updatedAt))) diagnostics.push(`Rule ${id || index + 1} has an invalid updatedAt`);
  if (!selector) return { diagnostics };
  if (selector.kind === 'attack') {
    if (selector.tacticIds.length === 0 && selector.techniqueIds.length === 0) diagnostics.push(`Rule ${id || index + 1} must bind at least one ATT&CK tactic or technique`);
    for (const tacticId of selector.tacticIds) if (!getTactic(tacticId)) diagnostics.push(`Rule ${id || index + 1} references unknown tactic ${tacticId}`);
    for (const techniqueId of selector.techniqueIds) if (!getTechnique(techniqueId)) diagnostics.push(`Rule ${id || index + 1} references unknown technique ${techniqueId}`);
  }
  if (diagnostics.length) return { diagnostics };
  return {
    rule: {
      id,
      text,
      enabled: enabled as boolean,
      selector,
      createdAt,
      updatedAt,
    },
    diagnostics,
  };
}

export function validateRestrictionDocument(raw: unknown): { document: RestrictionDocument; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (!raw || typeof raw !== 'object') return { document: cloneEmpty(), diagnostics: ['Restriction document must be an object'] };
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) diagnostics.push('Restriction document version must be 1');
  if (!Array.isArray(value.rules)) diagnostics.push('Restriction document rules must be an array');
  const rules: RestrictionRule[] = [];
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  if (Array.isArray(value.rules)) {
    value.rules.forEach((entry, index) => {
      const rawId = entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).id === 'string'
        ? ((entry as Record<string, unknown>).id as string).trim()
        : '';
      if (rawId && ids.has(rawId)) diagnostics.push(`Duplicate restriction id ${rawId}`);
      if (rawId) ids.add(rawId);
      const result = validateRule(entry, index);
      diagnostics.push(...result.diagnostics);
      if (!result.rule) return;
      if (fingerprints.has(ruleFingerprint(result.rule))) diagnostics.push(`Duplicate restriction content for ${result.rule.id}`);
      fingerprints.add(ruleFingerprint(result.rule));
      rules.push(result.rule);
    });
  }
  return { document: { version: 1, rules }, diagnostics };
}

function readDocument(filePath: string, scope: RestrictionScope): RestrictionDocumentResult {
  if (!fs.existsSync(filePath)) return { scope, path: filePath, exists: false, document: cloneEmpty(), diagnostics: [], fingerprint: documentFingerprint('') };
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
    const parsed = YAML.parse(raw);
    const result = validateRestrictionDocument(parsed);
    return { scope, path: filePath, exists: true, document: result.document, diagnostics: result.diagnostics, fingerprint: documentFingerprint(raw), raw };
  } catch (error) {
    return { scope, path: filePath, exists: true, document: cloneEmpty(), diagnostics: [`Invalid restrictions YAML: ${error instanceof Error ? error.message : String(error)}`], fingerprint: documentFingerprint(raw), raw };
  }
}

function canonicalYaml(document: RestrictionDocument): string {
  return YAML.stringify(document, { indent: 2, lineWidth: 0 });
}

export function serializeRestrictionDocument(document: RestrictionDocument): string {
  return canonicalYaml(document);
}

export function writeRestrictionDocument(filePath: string, document: RestrictionDocument): void {
  const validation = validateRestrictionDocument(document);
  if (validation.diagnostics.length) throw new Error(validation.diagnostics.join('; '));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, canonicalYaml(validation.document), 'utf8');
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch { /* best effort cleanup */ }
    throw error;
  }
}

export function projectRestrictionsPath(sessionPath: string): string {
  return path.join(projectUserDataPath(sessionPath), 'restrictions.yaml');
}

export function globalRestrictionsPath(globalUserPath: string): string {
  return path.join(globalUserPath, 'restrictions.yaml');
}

export function seedGlobalRestrictions(globalUserPath: string): boolean {
  const target = globalRestrictionsPath(globalUserPath);
  const marker = path.join(globalUserPath, 'seeded-restrictions.json');
  if (fs.existsSync(marker)) return false;
  if (fs.existsSync(target)) {
    writeRestrictionSeedMarker(marker);
    return false;
  }
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'default-user', 'restrictions.yaml') : null,
    path.resolve(__dirname, '../../resources/default-user/restrictions.yaml'),
    path.resolve(process.cwd(), 'resources/default-user/restrictions.yaml'),
  ];
  const source = candidates.find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)));
  if (!source) return false;
  const loaded = readDocument(source, 'global');
  if (loaded.diagnostics.length) throw new Error(`Default global restrictions are invalid: ${loaded.diagnostics.join('; ')}`);
  writeRestrictionDocument(target, loaded.document);
  writeRestrictionSeedMarker(marker);
  return true;
}

function writeRestrictionSeedMarker(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, '{"version":1}\n', 'utf8');
  fs.renameSync(temporary, filePath);
}

export function readRestrictionDocument(filePath: string, scope: RestrictionScope): RestrictionDocumentResult {
  return readDocument(filePath, scope);
}

export function listRestrictionDocuments(globalPath: string, projectPath: string) {
  return {
    global: readDocument(globalPath, 'global'),
    project: readDocument(projectPath, 'project'),
  };
}

function selectorsOverlap(left: RestrictionSelector, right: RestrictionSelector): boolean {
  if (left.kind === 'general' || right.kind === 'general') return true;
  return left.tacticIds.some((id) => right.tacticIds.includes(id)) || left.techniqueIds.some((id) => right.techniqueIds.includes(id));
}

function possibleConflict(left: RestrictionRule, right: RestrictionRule): boolean {
  if (!selectorsOverlap(left.selector, right.selector)) return false;
  const leftWords = new Set(normalizedFingerprintText(left.text).replace(MODAL_WORDS, '').split(/\W+/).filter((word) => word.length > 2));
  const rightWords = new Set(normalizedFingerprintText(right.text).replace(MODAL_WORDS, '').split(/\W+/).filter((word) => word.length > 2));
  if (leftWords.size === 0 || rightWords.size === 0) return false;
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  return intersection / union >= 0.65 && PROHIBITIVE.test(left.text) !== PROHIBITIVE.test(right.text) && (PERMISSIVE.test(left.text) || PERMISSIVE.test(right.text));
}

export function resolveRestrictions(globalPath: string, projectPath: string, tacticId: string, techniqueIds: string[]) {
  const documents = listRestrictionDocuments(globalPath, projectPath);
  const diagnostics = [
    ...documents.global.diagnostics.map((value) => `Global rules: ${value}`),
    ...documents.project.diagnostics.map((value) => `Project rules: ${value}`),
  ];
  const selectedTactic = tacticId.toUpperCase();
  const selectedTechniques = new Set(techniqueIds.map((id) => id.toUpperCase()));
  const selected = [
    ...documents.global.document.rules.filter((rule) => rule.enabled).map((rule) => ({ scope: 'global' as const, rule })),
    ...documents.project.document.rules.filter((rule) => rule.enabled).map((rule) => ({ scope: 'project' as const, rule })),
  ].filter(({ rule }) => rule.selector.kind === 'general' || rule.selector.tacticIds.includes(selectedTactic) || rule.selector.techniqueIds.some((id) => selectedTechniques.has(id)));
  const merged = new Map<string, ResolvedRestriction>();
  const sourceRules = new Map<string, RestrictionRule[]>();
  for (const item of selected) {
    const fingerprint = ruleFingerprint(item.rule);
    const current = merged.get(fingerprint);
    if (current) {
      current.sources = [...new Set([...current.sources, item.scope])];
      current.ruleIds = [...new Set([...current.ruleIds, item.rule.id])];
      continue;
    }
    const matchedBy = item.rule.selector.kind === 'general'
      ? ['general']
      : [...(item.rule.selector.tacticIds.includes(selectedTactic) ? [`tactic:${selectedTactic}`] : []), ...item.rule.selector.techniqueIds.filter((id) => selectedTechniques.has(id)).map((id) => `technique:${id}`)];
    merged.set(fingerprint, { id: item.rule.id, ruleIds: [item.rule.id], text: item.rule.text, sources: [item.scope], matchedBy });
    sourceRules.set(fingerprint, [item.rule]);
  }
  const values = [...merged.values()];
  for (let index = 0; index < values.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < values.length; otherIndex += 1) {
      const first = sourceRules.get([...merged.keys()][index])?.[0];
      const second = sourceRules.get([...merged.keys()][otherIndex])?.[0];
      if (first && second && possibleConflict(first, second)) {
        const conflictRuleIds = [...new Set([first.id, second.id])];
        values[index].conflictRuleIds = conflictRuleIds;
        values[otherIndex].conflictRuleIds = conflictRuleIds;
      }
    }
  }
  return { rules: values, diagnostics };
}

export function upsertRestriction(filePath: string, scope: RestrictionScope, input: RestrictionUpsertInput): RestrictionRule {
  const current = readDocument(filePath, scope);
  if (current.diagnostics.length) throw new Error(current.diagnostics.join('; '));
  const now = new Date().toISOString();
  const id = input.id?.trim() || `restriction-${crypto.randomUUID()}`;
  const existing = current.document.rules.find((rule) => rule.id === id);
  const rule: RestrictionRule = {
    id,
    text: normalizeText(input.text),
    enabled: input.enabled ?? existing?.enabled ?? true,
    selector: normalizeSelector(input.selector) ?? { kind: 'general' },
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
  const rules = existing ? current.document.rules.map((candidate) => candidate.id === id ? rule : candidate) : [...current.document.rules, rule];
  const result = validateRestrictionDocument({ version: 1, rules });
  if (result.diagnostics.length) throw new Error(result.diagnostics.join('; '));
  writeRestrictionDocument(filePath, result.document);
  return rule;
}

export function deleteRestriction(filePath: string, scope: RestrictionScope, id: string): RestrictionDocument {
  const current = readDocument(filePath, scope);
  if (current.diagnostics.length) throw new Error(current.diagnostics.join('; '));
  if (!current.document.rules.some((rule) => rule.id === id)) throw new Error(`Restriction ${id} not found`);
  const document = { version: 1 as const, rules: current.document.rules.filter((rule) => rule.id !== id) };
  writeRestrictionDocument(filePath, document);
  return document;
}

function normalizeImportedDocument(raw: unknown): { document: RestrictionDocument; diagnostics: string[] } {
  const result = validateRestrictionDocument(raw);
  return result;
}

export function previewRestrictionImport(filePath: string, scope: RestrictionScope, yamlText: string): RestrictionImportPreview {
  const current = readDocument(filePath, scope);
  let parsed: unknown;
  try { parsed = YAML.parse(yamlText); } catch (error) { return { scope, baseFingerprint: current.fingerprint, document: cloneEmpty(), added: [], updated: [], unchanged: [], diagnostics: [`Invalid restrictions YAML: ${error instanceof Error ? error.message : String(error)}`], conflicts: [] }; }
  const imported = normalizeImportedDocument(parsed);
  const currentById = new Map(current.document.rules.map((rule) => [rule.id, rule]));
  const added = imported.document.rules.filter((rule) => !currentById.has(rule.id));
  const updated = imported.document.rules.filter((rule) => {
    const previous = currentById.get(rule.id);
    return previous && JSON.stringify(previous) !== JSON.stringify(rule);
  });
  const unchanged = imported.document.rules.filter((rule) => {
    const previous = currentById.get(rule.id);
    return Boolean(previous && JSON.stringify(previous) === JSON.stringify(rule));
  });
  const conflicts: Array<{ ruleIds: string[]; text: string }> = [];
  for (let index = 0; index < imported.document.rules.length; index += 1) for (let otherIndex = index + 1; otherIndex < imported.document.rules.length; otherIndex += 1) {
    const left = imported.document.rules[index];
    const right = imported.document.rules[otherIndex];
    if (possibleConflict(left, right)) conflicts.push({ ruleIds: [left.id, right.id], text: 'Rules may conflict and both remain effective' });
  }
  return { scope, baseFingerprint: current.fingerprint, document: imported.document, added, updated, unchanged, diagnostics: imported.diagnostics, conflicts };
}

export function applyRestrictionImport(filePath: string, preview: RestrictionImportPreview): RestrictionDocument {
  const current = readDocument(filePath, preview.scope);
  if (current.fingerprint !== preview.baseFingerprint) throw new Error('Restrictions changed after import preview; preview again');
  if (preview.diagnostics.length) throw new Error(preview.diagnostics.join('; '));
  if (current.diagnostics.length && current.exists) {
    const backupPath = `${filePath}.invalid.${new Date().toISOString().replace(/[:.]/g, '-')}.yaml`;
    fs.copyFileSync(filePath, backupPath);
  }
  const currentById = new Map(current.document.rules.map((rule) => [rule.id, rule]));
  const merged = current.diagnostics.length ? [] : [...current.document.rules];
  for (const rule of preview.document.rules) {
    const index = merged.findIndex((candidate) => candidate.id === rule.id);
    if (index >= 0) merged[index] = rule;
    else if (!currentById.has(rule.id)) merged.push(rule);
  }
  const document = { version: 1 as const, rules: merged };
  writeRestrictionDocument(filePath, document);
  return document;
}
