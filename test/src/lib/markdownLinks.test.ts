import { describe, expect, it } from 'vitest';
import { resolveMarkdownLink } from '@/lib/markdownLinks';

describe('Markdown link routing', () => {
  const root = 'D:\\projects\\demo';

  it('resolves local Markdown links only inside the active project', () => {
    expect(resolveMarkdownLink('ptt.md', root)).toEqual({ kind: 'project-file', path: 'ptt.md' });
    expect(resolveMarkdownLink('../ptt.md', root, 'docs/guide.md')).toEqual({ kind: 'project-file', path: 'ptt.md' });
    expect(resolveMarkdownLink('D:/projects/demo/ptt.md', root)).toEqual({ kind: 'project-file', path: 'ptt.md' });
    expect(resolveMarkdownLink('file:///D:/projects/demo/ptt.md', root)).toEqual({ kind: 'project-file', path: 'ptt.md' });
    expect(resolveMarkdownLink('../outside.md', root)).toBeNull();
    expect(resolveMarkdownLink('D:/projects/other/ptt.md', root)).toBeNull();
    expect(resolveMarkdownLink('file:///D:/projects/other/ptt.md', root)).toBeNull();
  });

  it('routes web links separately and rejects unsupported schemes', () => {
    expect(resolveMarkdownLink('https://example.com/docs', root)).toEqual({ kind: 'web', url: 'https://example.com/docs' });
    expect(resolveMarkdownLink('javascript:alert(1)', root)).toBeNull();
    expect(resolveMarkdownLink('mailto:test@example.com', root)).toBeNull();
  });
});
