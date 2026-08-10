import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const executable = process.env.HEXESTRA_MIHOMO_PATH;
if (!executable) {
  console.log('[proxy-smoke] SKIP: set HEXESTRA_MIHOMO_PATH to a Mihomo executable');
  process.exit(0);
}

const servers = [];
const sockets = new Set();
let child;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-mihomo-smoke-'));

try {
  const versionOutput = await run(executable, ['-v']);
  const version = /\bv?(\d+\.\d+\.\d+)\b/.exec(versionOutput)?.[1] ?? 'unknown';
  const [mixedPort, controllerPort] = await Promise.all([freePort(), freePort()]);
  const secret = `smoke-${Date.now()}`;
  const hop1 = await createConnectProxy('hop-1');
  const hop2 = await createConnectProxy('hop-2');
  const target = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.write('target-ok');
    setTimeout(() => response.end(), 1_000);
  });
  const targetPort = await listen(target);
  servers.push(target);
  const holding = net.createServer(() => undefined);
  const holdingPort = await listen(holding);
  servers.push(holding);

  const twoHopPath = writeConfig('two-hop.json', config({ mixedPort, controllerPort, secret, hop1: hop1.port, hop2: hop2.port, twoHop: true }));
  child = spawn(executable, ['-d', root, '-f', twoHopPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString('utf8')));
  await waitForController(controllerPort, secret, child, stderr);
  console.log(`[proxy-smoke] Mihomo ${version} controller ready`);

  const first = requestThroughMixed(mixedPort, targetPort);
  await stage('two-hop request start', first.started);
  const connections = await controller(controllerPort, secret, 'GET', '/connections');
  const observedChains = connections.connections?.map((connection) => connection.chains) ?? [];
  const reportedHops = new Set(observedChains.flatMap((chain) => Array.isArray(chain) ? chain : []));
  assert.equal(
    reportedHops.has('hexestra-hop-1') && reportedHops.has('hexestra-hop-2'),
    true,
    `controller /connections did not report both hops; observed ${JSON.stringify(observedChains)}`,
  );
  assert.equal(await stage('two-hop response', first.done), 'target-ok');
  assert.ok(hop1.hits.length > 0, 'hop 1 was not visited');
  assert.ok(hop2.hits.length > 0, 'hop 2 was not visited');
  console.log('[proxy-smoke] two-hop request and controller chain verified');

  const heldSocket = await stage('held connection open', openHeldConnect(mixedPort, holdingPort));
  const closed = new Promise((resolve) => heldSocket.once('close', () => resolve(true)));
  const oneHopPath = writeConfig('one-hop.json', config({ mixedPort, controllerPort, secret, hop1: hop1.port, hop2: hop2.port, twoHop: false }));
  await controller(controllerPort, secret, 'PUT', '/configs?force=true', { path: oneHopPath });
  await controller(controllerPort, secret, 'DELETE', '/connections');
  assert.equal(await Promise.race([closed, delay(2_000).then(() => false)]), true, 'old connection survived the chain switch');

  hop1.hits.length = 0;
  hop2.hits.length = 0;
  const second = requestThroughMixed(mixedPort, targetPort);
  await stage('one-hop request start', second.started);
  assert.equal(await stage('one-hop response', second.done), 'target-ok');
  assert.ok(hop1.hits.length > 0, 'one-hop chain did not visit hop 1');
  assert.equal(hop2.hits.length, 0, 'one-hop chain unexpectedly visited removed hop 2');
  console.log(`[proxy-smoke] PASS (${version}): two hops, target delivery, controller chain, and switch teardown verified`);
} finally {
  child?.kill();
  for (const socket of sockets) socket.destroy();
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  fs.rmSync(root, { recursive: true, force: true });
}

function config({ mixedPort, controllerPort, secret, hop1, hop2, twoHop }) {
  const proxies = [
    { name: 'hexestra-hop-1', type: 'http', server: '127.0.0.1', port: hop1 },
    ...(twoHop ? [{ name: 'hexestra-hop-2', type: 'http', server: '127.0.0.1', port: hop2, 'dialer-proxy': 'hexestra-hop-1' }] : []),
  ];
  const exit = twoHop ? 'hexestra-hop-2' : 'hexestra-hop-1';
  return {
    'mixed-port': mixedPort,
    'external-controller': `127.0.0.1:${controllerPort}`,
    secret,
    'allow-lan': false,
    'bind-address': '127.0.0.1',
    mode: 'rule',
    'log-level': 'warning',
    proxies,
    'proxy-groups': [{ name: 'hexestra-active', type: 'select', proxies: [exit] }],
    rules: ['MATCH,hexestra-active'],
  };
}

function writeConfig(name, value) {
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
  return filePath;
}

async function createConnectProxy(name) {
  const hits = [];
  const server = http.createServer((_request, response) => response.writeHead(405).end());
  server.on('connect', (request, client, head) => {
    hits.push(request.url);
    client.on('error', () => undefined);
    const [host, portText] = splitAuthority(request.url);
    const upstream = net.connect(Number(portText), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    upstream.on('error', () => client.destroy());
  });
  const port = await listen(server);
  servers.push(server);
  return { name, port, hits };
}

function requestThroughMixed(mixedPort, targetPort) {
  let startResolve;
  let startReject;
  const started = new Promise((resolve, reject) => { startResolve = resolve; startReject = reject; });
  const done = new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port: mixedPort, method: 'GET',
      path: `http://127.0.0.1:${targetPort}/smoke`,
      headers: { Host: `127.0.0.1:${targetPort}` },
    }, (response) => {
      startResolve();
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('error', (error) => { startReject(error); reject(error); });
    request.end();
  });
  void done.catch(() => undefined);
  return { started, done };
}

function openHeldConnect(mixedPort, targetPort) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(mixedPort, '127.0.0.1', () => socket.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`));
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString('latin1');
      if (data.includes('\r\n\r\n')) resolve(socket);
    });
    socket.on('error', reject);
  });
}

async function waitForController(port, secret, process, errors) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(errors.at(-1) || `Mihomo exited ${process.exitCode}`);
    try { await controller(port, secret, 'GET', '/version'); return; } catch { await delay(100); }
  }
  throw new Error('Mihomo controller did not become ready');
}

function controller(port, secret, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const request = http.request({ host: '127.0.0.1', port, path: requestPath, method, headers: { Authorization: `Bearer ${secret}`, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`controller ${response.statusCode}${text ? `: ${text}` : ''}`));
        }
        resolve(text ? JSON.parse(text) : null);
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    process.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    process.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    process.on('error', reject);
    process.on('exit', (code) => code === 0 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(Buffer.concat(chunks).toString('utf8') || `exit ${code}`)));
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function splitAuthority(value) {
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return [value.slice(1, end), value.slice(end + 2)];
  }
  const separator = value.lastIndexOf(':');
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function stage(name, promise) {
  try {
    return await promise;
  } catch (error) {
    throw new Error(`${name} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
