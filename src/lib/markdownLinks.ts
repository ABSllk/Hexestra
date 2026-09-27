export type MarkdownLinkTarget =
  | { kind: 'web'; url: string }
  | { kind: 'project-file'; path: string }
  | { kind: 'anchor'; href: string };

export function resolveMarkdownLink(href: string, projectRoot?: string, sourceFilePath?: string): MarkdownLinkTarget | null {
  const value = href.trim();
  if (!value) return null;
  if (value.startsWith('#')) return { kind: 'anchor', href: value };
  if (/^https?:\/\//i.test(value) || value.startsWith('//')) {
    try {
      const url = new URL(value.startsWith('//') ? `https:${value}` : value);
      return { kind: 'web', url: url.href };
    } catch { return null; }
  }
  if (!projectRoot) return null;

  let filePath = value.split(/[?#]/, 1)[0];
  if (/^file:\/\//i.test(filePath)) {
    try {
      const url = new URL(filePath);
      if (url.host && url.host !== 'localhost') return null;
      filePath = decodeURIComponent(url.pathname).replace(/^\/(?=[A-Za-z]:\/)/, '');
    } catch { return null; }
  } else {
    try { filePath = decodeURIComponent(filePath); } catch { return null; }
  }
  filePath = filePath.replace(/\\/g, '/');
  if (!filePath || filePath.startsWith('//') || /[\x00-\x1f]/.test(filePath)) return null;

  const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const windowsRoot = /^[A-Za-z]:(?:\/|$)/.test(root);
  const compare = (path: string) => windowsRoot ? path.toLowerCase() : path;
  const absolute = /^[A-Za-z]:\//.test(filePath) || filePath.startsWith('/');
  if (absolute) {
    if (compare(filePath).startsWith(`${compare(root)}/`)) {
      filePath = filePath.slice(root.length + 1);
    } else if (filePath.startsWith('/') && !/^file:\/\//i.test(value)) {
      filePath = filePath.slice(1);
    } else {
      return null;
    }
  } else if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(filePath)) {
    return null;
  }

  const segments = absolute ? [] : sourceFilePath?.replace(/\\/g, '/').split('/').slice(0, -1).filter(Boolean) ?? [];
  for (const segment of filePath.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return null;
      segments.pop();
    } else if (segment.includes(':')) {
      return null;
    } else {
      segments.push(segment);
    }
  }
  return segments.length ? { kind: 'project-file', path: segments.join('/') } : null;
}
