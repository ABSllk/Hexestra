import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MITMPROXY_RUNTIME_VERSION = '12.2.3';
export const MITMPROXY_DOWNLOAD_ROOT =
  `https://downloads.mitmproxy.org/${MITMPROXY_RUNTIME_VERSION}`;

// SHA-256 values are from mitmproxy 12.2.3's official Sigstore provenance bundle:
// https://downloads.mitmproxy.org/12.2.3/mitmproxy-12.2.3.sigstore
export const MITMPROXY_RUNTIME_RELEASES = Object.freeze({
  'win32-x64': {
    archiveName: 'mitmproxy-12.2.3-windows-x86_64.zip',
    executableName: 'mitmdump.exe',
    sha256: '04a01ea95ae96df75058a893e774957d294e69012dab1f4e256ce2b0c6725483',
  },
  'linux-x64': {
    archiveName: 'mitmproxy-12.2.3-linux-x86_64.tar.gz',
    executableName: 'mitmdump',
    sha256: '2e95286b618fa6fd33e5e62a78c2e5112571d85f42ec2bac29b97ee242bdb5c5',
  },
  'darwin-x64': {
    archiveName: 'mitmproxy-12.2.3-macos-x86_64.tar.gz',
    executableName: 'mitmdump',
    sha256: '7998187f5a0d399ab796af4523d3ad830ebe690726a41bc3e1df47a8e477a641',
  },
  'darwin-arm64': {
    archiveName: 'mitmproxy-12.2.3-macos-arm64.tar.gz',
    executableName: 'mitmdump',
    sha256: '0a09ee3b82569e8985aff8186e4792618b8e5d0c766098db093d09a87d4b013a',
  },
});

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const cacheRoot = path.join(
  projectRoot,
  '.npm-cache',
  'mitmproxy-runtime',
  MITMPROXY_RUNTIME_VERSION,
);
const stagingRoot = path.join(projectRoot, 'resources', 'mitmproxy', 'bin');

export function resolveRuntimeRelease(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  const release = MITMPROXY_RUNTIME_RELEASES[key];
  if (!release) {
    throw new Error(
      `mitmproxy ${MITMPROXY_RUNTIME_VERSION} is not bundled for ${platform}/${arch}`,
    );
  }
  return {
    ...release,
    key,
    url: `${MITMPROXY_DOWNLOAD_ROOT}/${release.archiveName}`,
  };
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

export async function verifyArchiveDigest(filePath, expectedSha256) {
  const actualSha256 = await sha256File(filePath);
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new Error(
      `mitmproxy archive SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
  return actualSha256;
}

export async function findExtractedExecutable(root, executableName) {
  const matches = [];
  await walk(root, async (candidate, entry) => {
    if (entry.isFile() && entry.name === executableName) matches.push(candidate);
  });
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${executableName} in the mitmproxy archive; found ${matches.length}`,
    );
  }
  return matches[0];
}

export async function stageExtractedRuntime(
  extractionRoot,
  destinationRoot,
  release,
  platform,
) {
  const executable = await findExtractedExecutable(
    extractionRoot,
    release.executableName,
  );

  let stagedExecutable;
  if (platform === 'darwin') {
    const bundleRoot = path.join(extractionRoot, 'mitmproxy.app');
    const expectedExecutable = path.join(
      bundleRoot,
      'Contents',
      'MacOS',
      release.executableName,
    );
    if (path.resolve(executable) !== path.resolve(expectedExecutable)) {
      throw new Error(`Unexpected macOS mitmdump location: ${executable}`);
    }
    const stagedBundleRoot = path.join(destinationRoot, 'mitmproxy.app');
    await cp(bundleRoot, stagedBundleRoot, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    stagedExecutable = path.join(
      stagedBundleRoot,
      'Contents',
      'MacOS',
      release.executableName,
    );
  } else {
    stagedExecutable = path.join(destinationRoot, release.executableName);
    await copyFile(executable, stagedExecutable);
  }

  if (platform !== 'win32') await chmod(stagedExecutable, 0o755);
  return stagedExecutable;
}

export async function prepareMitmproxyRuntime({
  platform = process.platform,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
} = {}) {
  const release = resolveRuntimeRelease(platform, arch);
  await mkdir(cacheRoot, { recursive: true });
  const archivePath = assertChildPath(path.join(cacheRoot, release.archiveName), cacheRoot);

  if (!(await isFile(archivePath))) {
    await downloadVerifiedArchive(release, archivePath, fetchImpl);
  } else {
    try {
      await verifyArchiveDigest(archivePath, release.sha256);
      console.log(`Using cached ${release.archiveName}`);
    } catch {
      await rm(archivePath, { force: true });
      await downloadVerifiedArchive(release, archivePath, fetchImpl);
    }
  }

  const extractionRoot = await mkdtemp(path.join(cacheRoot, 'extract-'));
  try {
    await runCommand('tar', ['-xf', archivePath, '-C', extractionRoot]);
    const resolvedStagingRoot = assertChildPath(stagingRoot, path.join(projectRoot, 'resources'));
    await rm(resolvedStagingRoot, { recursive: true, force: true });
    await mkdir(resolvedStagingRoot, { recursive: true });
    const stagedExecutable = await stageExtractedRuntime(
      extractionRoot,
      resolvedStagingRoot,
      release,
      platform,
    );

    await verifyPreparedVersion(stagedExecutable);

    await writeFile(
      path.join(resolvedStagingRoot, 'runtime.json'),
      `${JSON.stringify({
        version: MITMPROXY_RUNTIME_VERSION,
        platform,
        arch,
        archive: release.archiveName,
        sha256: release.sha256,
        source: release.url,
      }, null, 2)}\n`,
      'utf8',
    );
    console.log(`Prepared mitmdump ${MITMPROXY_RUNTIME_VERSION} for ${platform}/${arch}`);
    console.log(`Staged runtime: ${stagedExecutable}`);
    return { ...release, executablePath: stagedExecutable };
  } finally {
    await rm(assertChildPath(extractionRoot, cacheRoot), { recursive: true, force: true });
  }
}

async function downloadVerifiedArchive(release, archivePath, fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new Error('A Fetch implementation is required');
  const temporaryPath = `${archivePath}.download`;
  await rm(assertChildPath(temporaryPath, cacheRoot), { force: true });
  console.log(`Downloading ${release.url}`);
  const response = await fetchImpl(release.url);
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download mitmproxy runtime: HTTP ${response.status}`);
  }
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporaryPath));
    await verifyArchiveDigest(temporaryPath, release.sha256);
    await rename(temporaryPath, archivePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function walk(directory, visit) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(candidate, visit);
    else await visit(candidate, entry);
  }
}

async function isFile(candidate) {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function assertChildPath(candidate, root) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relativePath = path.relative(resolvedRoot, resolvedCandidate);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    if (resolvedCandidate === resolvedRoot) return resolvedCandidate;
    throw new Error(`Refusing to use a path outside ${resolvedRoot}: ${resolvedCandidate}`);
  }
  return resolvedCandidate;
}

function runCommand(command, args, { capture = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let output = '';
    if (capture) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
    }
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise(output);
      else rejectPromise(new Error(
        `${command} exited with ${code ?? signal}${output.trim() ? `: ${output.trim()}` : ''}`,
      ));
    });
  });
}

async function verifyPreparedVersion(executablePath) {
  const failures = [];
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const output = await runCommand(executablePath, ['--version'], { capture: true });
      if (!output.includes(MITMPROXY_RUNTIME_VERSION)) {
        throw new Error(
          `Prepared mitmdump did not report version ${MITMPROXY_RUNTIME_VERSION}: ${output.trim()}`,
        );
      }
      return output;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 2_000));
    }
  }
  throw new Error(`Unable to start the prepared mitmdump runtime: ${failures.join(' | ')}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  prepareMitmproxyRuntime().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
