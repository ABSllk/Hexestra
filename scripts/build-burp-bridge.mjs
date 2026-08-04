import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const version = '2026.7';
const expectedSha256 = 'CB852B7B883290FCC1D21B13D80FA10F5B13A0F57335D710D2B1E5956ECB2A94';
const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(projectRoot, 'burp-extension', 'hexestra-bridge', 'src', 'main', 'java');
const testSourceRoot = path.join(projectRoot, 'burp-extension', 'hexestra-bridge', 'src', 'test', 'java');
const outputRoot = path.join(projectRoot, 'resources', 'burp-bridge');
const buildRoot = path.join(os.tmpdir(), 'hexestra-burp-bridge-build');

const providedJar = valueAfter('--montoya-jar') ?? process.env.HEXESTRA_MONTOYA_JAR;
const montoyaJar = await resolveMontoyaJar(providedJar);
assertFile(montoyaJar, `Montoya API JAR was not found: ${montoyaJar}`);
const actualSha256 = sha256(montoyaJar);
if (actualSha256 !== expectedSha256) throw new Error(`Montoya API ${version} checksum mismatch`);

fs.rmSync(buildRoot, { recursive: true, force: true });
const classes = path.join(buildRoot, 'classes');
const testClasses = path.join(buildRoot, 'test-classes');
fs.mkdirSync(classes, { recursive: true });
fs.mkdirSync(testClasses, { recursive: true });
fs.mkdirSync(outputRoot, { recursive: true });

const sources = filesUnder(sourceRoot, '.java');
if (!sources.length) throw new Error('No Hexestra Bridge Java sources were found');
run('javac', ['--release', '17', '-encoding', 'UTF-8', '-classpath', montoyaJar, '-d', classes, ...sources]);

const testSources = filesUnder(testSourceRoot, '.java');
const loopbackSource = path.join(sourceRoot, 'hexestra', 'bridge', 'LoopbackHttpServer.java');
assertFile(loopbackSource, 'LoopbackHttpServer.java was not found');
if (!testSources.length) throw new Error('No Hexestra Bridge Java smoke sources were found');
run('javac', ['--release', '17', '-encoding', 'UTF-8', '-d', testClasses, loopbackSource, ...testSources]);
run('java', ['-classpath', testClasses, 'hexestra.bridge.LoopbackHttpServerSmoke']);

const manifest = path.join(buildRoot, 'MANIFEST.MF');
fs.writeFileSync(manifest, [
  'Manifest-Version: 1.0',
  'Burp-Extension-Class: hexestra.bridge.HexestraBurpBridge',
  'Implementation-Title: Hexestra Bridge',
  'Implementation-Version: 0.1.2',
  '',
].join('\n'));
const jarPath = path.join(outputRoot, 'hexestra-burp-bridge.jar');
run('jar', ['--create', '--file', jarPath, '--manifest', manifest, '-C', classes, '.']);
const moduleDependencies = run('jdeps', ['--ignore-missing-deps', '--print-module-deps', '--class-path', montoyaJar, jarPath]).trim();
if (moduleDependencies.includes('jdk.httpserver')) throw new Error('Bridge JAR unexpectedly depends on jdk.httpserver');
console.log(`Built ${jarPath}`);
console.log(`Montoya API ${version} is compile-only and is not bundled in the extension JAR.`);
console.log(`Runtime modules: ${moduleDependencies}`);

async function resolveMontoyaJar(input) {
  if (input) return path.resolve(input);
  const dependencyRoot = path.join(projectRoot, '.npm-cache', 'release-deps', `montoya-${version}`);
  const target = path.join(dependencyRoot, `montoya-api-${version}.jar`);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(dependencyRoot, { recursive: true });
    const url = `https://repo1.maven.org/maven2/net/portswigger/burp/extensions/montoya-api/${version}/montoya-api-${version}.jar`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to download Montoya API: HTTP ${response.status}`);
    fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
  return target;
}

function filesUnder(root, extension) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(fullPath, extension) : entry.name.endsWith(extension) ? [fullPath] : [];
  });
}

function run(command, args) {
  return execFileSync(command, args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function assertFile(file, message) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(message);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
