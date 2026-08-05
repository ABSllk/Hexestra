const BASENAME_LANGUAGES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'shell',
  gnumakefile: 'shell',
  '.bashrc': 'shell',
  '.zshrc': 'shell',
  '.profile': 'shell',
};

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyw: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  ps1: 'powershell', psm1: 'powershell', bat: 'bat', cmd: 'bat',
  yaml: 'yaml', yml: 'yaml', json: 'json', jsonc: 'json',
  md: 'markdown', markdown: 'markdown',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  xml: 'xml', svg: 'xml', sql: 'sql', mysql: 'mysql', pgsql: 'pgsql',
  ini: 'ini', cfg: 'ini', conf: 'ini', toml: 'ini',
  c: 'cpp', h: 'cpp', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', java: 'java', kt: 'kotlin', kts: 'kotlin',
  go: 'go', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift',
  lua: 'lua', nse: 'lua', pl: 'perl', pm: 'perl', r: 'r', scala: 'scala',
  sol: 'solidity', tf: 'hcl', hcl: 'hcl',
  graphql: 'graphql', gql: 'graphql', proto: 'protobuf', redis: 'redis',
};

export function detectEditorLanguage(filePath?: string) {
  const basename = filePath?.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  const basenameLanguage = BASENAME_LANGUAGES[basename];
  if (basenameLanguage) return basenameLanguage;
  const extension = basename.includes('.') ? basename.slice(basename.lastIndexOf('.') + 1) : '';
  return EXTENSION_LANGUAGES[extension] ?? 'plaintext';
}

export function isMarkdownPath(filePath?: string) {
  return detectEditorLanguage(filePath) === 'markdown';
}
