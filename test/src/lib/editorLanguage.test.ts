import { describe, expect, it } from 'vitest';
import { detectEditorLanguage, isMarkdownPath } from '@/lib/editorLanguage';

describe('editor language detection', () => {
  it('recognizes common source, security, and configuration files', () => {
    expect(detectEditorLanguage('src/App.tsx')).toBe('typescript');
    expect(detectEditorLanguage('scripts/discovery.nse')).toBe('lua');
    expect(detectEditorLanguage('infra/main.tf')).toBe('hcl');
    expect(detectEditorLanguage('ops/run.ps1')).toBe('powershell');
    expect(detectEditorLanguage('Dockerfile')).toBe('dockerfile');
    expect(detectEditorLanguage('Makefile')).toBe('shell');
  });

  it('uses plaintext for unknown files and identifies Markdown case-insensitively', () => {
    expect(detectEditorLanguage('capture.unknown')).toBe('plaintext');
    expect(isMarkdownPath('notes/REPORT.Markdown')).toBe(true);
    expect(isMarkdownPath('notes/report.txt')).toBe(false);
  });
});
