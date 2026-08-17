import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { listPackage } = createRequire(import.meta.url)('@electron/asar');

const SDK_JS_PATH = /node_modules[\\/]@anthropic-ai[\\/]claude-agent-sdk(?:[\\/]|$)/;
const SDK_PLATFORM_PATH = /node_modules[\\/]@anthropic-ai[\\/]claude-agent-sdk-(?:darwin|linux|win32)-[^\\/]+[\\/]/;
const SDK_CLI_FILE = /(?:^|[\\/])claude(?:\.exe|\.cmd|\.bat)?$/i;

export default async function auditReleaseClaude(context) {
  const result = auditClaudePackageTree(context.appOutDir);
  if (!result.hasJavaScriptSdk) {
    throw new Error(`[release audit] @anthropic-ai/claude-agent-sdk is missing from ${context.appOutDir}`);
  }
  if (result.forbidden.length) {
    throw new Error(`[release audit] bundled Claude CLI detected:\n${result.forbidden.join('\n')}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const roots = findPackagedAppRoots(path.resolve(process.argv[2] ?? 'release'));
  if (!roots.length) throw new Error('[release audit] no unpacked application directory was found');
  for (const root of roots) {
    const result = auditClaudePackageTree(root);
    if (!result.hasJavaScriptSdk) throw new Error(`[release audit] JavaScript SDK missing from ${root}`);
    if (result.forbidden.length) throw new Error(`[release audit] bundled Claude CLI detected in ${root}:\n${result.forbidden.join('\n')}`);
  }
  console.log(`[release audit] checked ${roots.length} packaged application tree(s)`);
}

export function auditClaudePackageTree(appOutDir) {
  const paths = [];
  const files = [...walkFiles(appOutDir)];
  for (const file of files) {
    if (path.basename(file) === 'app.asar') paths.push(...listPackage(file));
    paths.push(path.relative(appOutDir, file));
  }

  const normalized = paths.map((value) => value.replaceAll('\\', '/'));
  const hasJavaScriptSdk = normalized.some((value) => SDK_JS_PATH.test(value));
  const forbidden = normalized
    .filter((value) => SDK_PLATFORM_PATH.test(value) && SDK_CLI_FILE.test(value))
    .map((value) => `- ${value}`);
  return { hasJavaScriptSdk, forbidden: [...new Set(forbidden)] };
}

function* walkFiles(root) {
  if (!fs.existsSync(root)) return;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(file);
    else yield file;
  }
}

function findPackagedAppRoots(releaseDir) {
  if (!fs.existsSync(releaseDir)) return [];
  const roots = [];
  for (const candidate of walkDirectories(releaseDir)) {
    if (fs.existsSync(path.join(candidate, 'resources', 'app.asar')) || candidate.endsWith('.app')) roots.push(candidate);
  }
  return roots;
}

function* walkDirectories(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name);
    yield candidate;
    yield* walkDirectories(candidate);
  }
}
