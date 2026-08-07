import { describe, expect, it } from 'vitest';
import {
  appendTerminalContext,
  stripTerminalControlSequences,
  terminalScrollLabel,
} from '@/lib/terminalText';

describe('terminalText', () => {
  it('removes ANSI and terminal control sequences from shared context', () => {
    expect(stripTerminalControlSequences('\x1b[31mred\x1b[0m\rnext')).toBe('red\nnext');
  });

  it('keeps only the newest bounded terminal context', () => {
    expect(appendTerminalContext('12345', '67890', 6)).toBe('567890');
  });

  it('reports live and historical scroll positions', () => {
    expect(terminalScrollLabel(10, 10)).toBe('LIVE');
    expect(terminalScrollLabel(5, 10)).toBe('50%');
  });
});
