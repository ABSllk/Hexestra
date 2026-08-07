import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toPublicPath = (absolutePath) => relative(projectRoot, absolutePath).replaceAll('\\', '/');
const listOnly = process.argv.includes('--list');

const PUBLIC_ROOT_FILES = new Set([
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'index.html',
  'package-lock.json',
  'package.json',
  'postcss.config.cjs',
  'tailwind.config.ts',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
]);

const PUBLIC_ROOT_DIRECTORIES = new Set([
  '.github',
  'burp-extension',
  'docs',
  'electron',
  'resources',
  'scripts',
  'src',
  'test',
]);

const LOCAL_ROOT_ENTRIES = new Set([
  '.agents',
  '.claude',
  '.codex',
  '.git',
  '.npm-cache',
  '.trellis',
  '.ui-test',
  'AGENTS.md',
  'artifacts',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'release',
]);

const LOCAL_VERSIONED_RELEASE_DIRECTORY_PATTERN =
  /^release-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const SKIPPED_PUBLIC_PREFIXES = [
  'resources/mitmproxy/bin/',
  'resources/mitmproxy/__pycache__/',
];

const SKIPPED_PUBLIC_FILES = new Set([
  'resources/burp-bridge/hexestra-burp-bridge.jar',
]);

const REQUIRED_IGNORE_RULES = new Set([
  '.agents/',
  '.claude/',
  '.codex/',
  '.trellis/',
  '.ui-test/',
  'AGENTS.md',
  'artifacts/',
  'coverage/',
  'dist/',
  'dist-electron/',
  'node_modules/',
  'release/',
  'release-*/',
  'resources/burp-bridge/*.jar',
  'resources/mitmproxy/bin/',
  '*.pyc',
  '*.burp',
  '*.har',
  '*.key',
  '*.pcap',
  '*.pcapng',
  '*.pem',
]);

const DISALLOWED_EXTENSIONS = new Set([
  '.7z',
  '.burp',
  '.dll',
  '.dmg',
  '.exe',
  '.har',
  '.jar',
  '.jks',
  '.key',
  '.keystore',
  '.msi',
  '.p12',
  '.pcap',
  '.pcapng',
  '.pem',
  '.pfx',
  '.pyc',
  '.pyd',
  '.sqlite',
  '.sqlite3',
  '.sys',
  '.zip',
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.java',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ps1',
  '.py',
  '.svg',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

const TEXT_BASENAMES = new Set([
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  'LICENSE',
]);

const APPROVED_OLD_BRAND_PATHS = new Set([
  '.gitignore',
  'CONTRIBUTING.md',
  'test/electron/services/project-registry.test.ts',
  'electron/services/project-registry.ts',
  'scripts/audit-public-boundary.mjs',
  'test/src/stores/useSessionStore.test.ts',
  'src/stores/useSessionStore.ts',
]);

const APPROVED_DEVELOPER_PATH_FIXTURES = new Set([
  'test/electron/services/claude-capabilities.service.test.ts',
  'test/electron/services/wsl-agent-runtime.test.ts',
  'test/src/components/center-panel/tabs/McpSettings.test.tsx',
  'test/src/components/center-panel/tabs/SkillsSettings.test.tsx',
]);

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const DEVELOPER_HOME_PATTERN = /(?:[A-Z]:\\+(?:Users|Documents and Settings)\\+[^\\\r\n]+|\/(?:Users|home)\/[^/\s]+)/i;
const OLD_BRAND_PATTERN = /pengent/i;
const MAX_PUBLIC_FILE_BYTES = 5 * 1024 * 1024;

const SECRET_PATTERNS = [
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
];

const failures = [];
const publicFiles = [];

function isSkipped(publicPath, isDirectory = false) {
  if (!isDirectory && SKIPPED_PUBLIC_FILES.has(publicPath)) return true;
  const comparablePath = isDirectory ? `${publicPath}/` : publicPath;
  return SKIPPED_PUBLIC_PREFIXES.some((prefix) => comparablePath.startsWith(prefix));
}

async function walkPublicDirectory(absoluteDirectory) {
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = resolve(absoluteDirectory, entry.name);
    const publicPath = toPublicPath(absolutePath);
    if (isSkipped(publicPath, entry.isDirectory())) continue;

    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      failures.push(`${publicPath}: symbolic links are not allowed in the public source set`);
      continue;
    }

    if (stats.isDirectory()) {
      await walkPublicDirectory(absolutePath);
      continue;
    }

    if (!stats.isFile()) {
      failures.push(`${publicPath}: unsupported filesystem entry`);
      continue;
    }

    publicFiles.push({ absolutePath, publicPath, size: stats.size });
  }
}

async function collectPublicFiles() {
  const entries = await readdir(projectRoot, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const name = entry.name;
    if (
      LOCAL_ROOT_ENTRIES.has(name) ||
      (entry.isDirectory() && LOCAL_VERSIONED_RELEASE_DIRECTORY_PATTERN.test(name))
    ) {
      continue;
    }

    if (entry.isFile() && PUBLIC_ROOT_FILES.has(name)) {
      const absolutePath = resolve(projectRoot, name);
      const stats = await lstat(absolutePath);
      publicFiles.push({ absolutePath, publicPath: name, size: stats.size });
      continue;
    }

    if (entry.isDirectory() && PUBLIC_ROOT_DIRECTORIES.has(name)) {
      await walkPublicDirectory(resolve(projectRoot, name));
      continue;
    }

    failures.push(`${name}: unknown top-level entry; classify it before publication`);
  }
}

async function checkIgnoreRules() {
  const content = await readFile(resolve(projectRoot, '.gitignore'), 'utf8');
  const rules = new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  );

  for (const requiredRule of REQUIRED_IGNORE_RULES) {
    if (!rules.has(requiredRule)) {
      failures.push(`.gitignore: missing required rule ${requiredRule}`);
    }
  }
}

async function checkPublicFile(file) {
  const extension = extname(file.publicPath).toLowerCase();
  if (DISALLOWED_EXTENSIONS.has(extension)) {
    failures.push(`${file.publicPath}: disallowed binary, capture, or credential extension`);
  }

  if (file.size > MAX_PUBLIC_FILE_BYTES) {
    failures.push(
      `${file.publicPath}: ${file.size} bytes exceeds the 5 MiB public-source limit`,
    );
  }

  const isText = TEXT_EXTENSIONS.has(extension) || TEXT_BASENAMES.has(basename(file.publicPath));
  if (!isText) return;

  const content = await readFile(file.absolutePath, 'utf8');
  for (const [label, pattern] of SECRET_PATTERNS) {
    if (pattern.test(content)) failures.push(`${file.publicPath}: possible ${label}`);
  }

  if (EMAIL_PATTERN.test(content) && file.publicPath !== 'package-lock.json') {
    failures.push(`${file.publicPath}: email address requires explicit publication review`);
  }

  if (
    DEVELOPER_HOME_PATTERN.test(content)
    && !APPROVED_DEVELOPER_PATH_FIXTURES.has(file.publicPath)
  ) {
    failures.push(`${file.publicPath}: developer home path requires explicit review`);
  }

  if (OLD_BRAND_PATTERN.test(content) && !APPROVED_OLD_BRAND_PATHS.has(file.publicPath)) {
    failures.push(`${file.publicPath}: unapproved legacy Pengent branding`);
  }
}

await collectPublicFiles();
await checkIgnoreRules();
await Promise.all(publicFiles.map(checkPublicFile));

if (failures.length > 0) {
  console.error('Public boundary audit failed:');
  for (const failure of failures.sort()) console.error(`- ${failure}`);
  process.exitCode = 1;
} else if (listOnly) {
  for (const file of [...publicFiles].sort((left, right) =>
    left.publicPath.localeCompare(right.publicPath))) {
    console.log(file.publicPath);
  }
} else {
  const totalBytes = publicFiles.reduce((sum, file) => sum + file.size, 0);
  console.log(
    `Public boundary audit passed: ${publicFiles.length} reviewed files, ${totalBytes} bytes.`,
  );
  console.log('Copied runtimes, build output, captures, credentials, and local workflow state are excluded.');
}
