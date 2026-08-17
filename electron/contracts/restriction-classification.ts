export type RestrictionClassificationConfidence = 'high' | 'medium' | 'low';

export type RestrictionClassificationSelector =
  | { kind: 'general' }
  | { kind: 'attack'; tacticIds: string[]; techniqueIds: string[] };

export interface RestrictionClassificationSuggestion {
  selector: RestrictionClassificationSelector;
  confidence: RestrictionClassificationConfidence;
  reason: string;
  matchedTactics: Array<{ id: string; name: string }>;
  matchedTechniques: Array<{ id: string; name: string }>;
}

export interface RestrictionClassificationInput {
  text: string;
  cwd: string;
  projectId?: string;
}
