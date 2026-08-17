import { describe, expect, it } from 'vitest';
import {
  ATTACK_CATALOG,
  ATTACK_CATALOG_VERSION,
  ATTACK_TECHNIQUES,
  listAttackTactics,
  searchAttackTechniques,
} from '@electron/services/attack-catalog';
import { ATTACK_TACTICS } from '@electron/contracts/tasks';

describe('Enterprise ATT&CK catalog', () => {
  it('pins the complete Enterprise v19.1 tactic and technique inventory', () => {
    expect(ATTACK_CATALOG_VERSION).toBe('19.1');
    expect(ATTACK_TACTICS).toHaveLength(15);
    expect(new Set(ATTACK_TACTICS.map((tactic) => tactic.id))).toEqual(new Set([
      'TA0043', 'TA0042', 'TA0001', 'TA0002', 'TA0003', 'TA0004', 'TA0005', 'TA0112',
      'TA0006', 'TA0007', 'TA0008', 'TA0009', 'TA0011', 'TA0010', 'TA0040',
    ]));
    expect(ATTACK_TACTICS.find((tactic) => tactic.id === 'TA0005')?.name).toBe('Stealth');
    expect(ATTACK_TACTICS.find((tactic) => tactic.id === 'TA0112')?.name).toBe('Defense Impairment');
    expect(ATTACK_TECHNIQUES).toHaveLength(697);
    expect(ATTACK_TECHNIQUES.filter((technique) => technique.isSubTechnique)).toHaveLength(475);
    expect(new Set(ATTACK_TECHNIQUES.map((technique) => technique.id)).size).toBe(697);
    expect(ATTACK_TECHNIQUES.every((technique) => technique.tacticIds.length > 0)).toBe(true);
  });

  it('includes newer Enterprise techniques that the old hand-maintained subset omitted', () => {
    expect(ATTACK_TECHNIQUES.some((technique) => technique.id === 'T1682')).toBe(true);
    expect(ATTACK_TECHNIQUES.some((technique) => technique.id === 'T1550.004' && technique.isSubTechnique)).toBe(true);
    expect(ATTACK_TECHNIQUES.some((technique) => technique.id === 'T1059.001' && technique.tacticIds.includes('TA0002'))).toBe(true);
  });

  it('lists tactics and searches exact or paginated Technique matches from the same pinned catalog', () => {
    expect(listAttackTactics()).toMatchObject({
      catalogVersion: '19.1',
      tacticCount: 15,
      techniqueCount: 697,
      tactics: expect.arrayContaining([expect.objectContaining({ id: 'TA0043', name: 'Reconnaissance' })]),
    });
    expect(searchAttackTechniques({ query: 'T1595.001' }).techniques).toEqual([
      expect.objectContaining({ id: 'T1595.001', name: 'Scanning IP Blocks' }),
    ]);
    const page = searchAttackTechniques({ tacticId: 'TA0043', includeSubTechniques: false, limit: 2 });
    expect(page.techniques).toHaveLength(2);
    expect(page.techniques.every((technique) => technique.tacticIds.includes('TA0043') && !technique.isSubTechnique)).toBe(true);
    expect(page.nextOffset).toBe(2);
    expect(() => searchAttackTechniques({ tacticId: 'TA0035' })).toThrow('Unknown ATT&CK tactic TA0035');
  });
});
