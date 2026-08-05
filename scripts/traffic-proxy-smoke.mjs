import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';

let smokeStage = 'startup';
process.on('unhandledRejection', (error) => {
  process.stderr.write(`[traffic-proxy-smoke] unhandled during ${smokeStage}: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

const { TrafficSidecar } = await import('../dist-electron/services/traffic-sidecar.js');
const { TrafficRepository } = await import('../dist-electron/services/traffic.repository.js');
const { BurpMirrorClient } = await import('../dist-electron/services/burp-mirror-client.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-proxy-smoke-'));
const projectPath = path.join(root, 'project');
const userDataPath = path.join(root, 'user-data');
fs.mkdirSync(projectPath, { recursive: true });
let targetCount = 0;
const target = http.createServer((request, response) => {
  request.on('error', () => {});
  response.on('error', () => {});
  targetCount += 1;
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    response.setHeader('Content-Type', 'text/plain');
    response.end(`target:${request.headers['x-hexestra'] ?? 'none'}:${Buffer.concat(chunks).toString('utf8')}`);
  });
});
target.listen(0, '127.0.0.1');
await once(target, 'listening');
const targetPort = target.address().port;
const targetUrl = `http://127.0.0.1:${targetPort}/fixture`;
const fixtureKeyPath = path.join(root, 'fixture-key.pem');
const fixtureCertificatePath = path.join(root, 'fixture-cert.pem');
const opensslConfigPath = path.join(root, 'openssl.cnf');
fs.writeFileSync(opensslConfigPath, [
  '[req]',
  'distinguished_name=req_distinguished_name',
  'x509_extensions=v3_req',
  'prompt=no',
  '[req_distinguished_name]',
  'CN=localhost',
  '[v3_req]',
  'subjectAltName=@alt_names',
  'basicConstraints=critical,CA:TRUE',
  'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign',
  'extendedKeyUsage=serverAuth',
  '[alt_names]',
  'DNS.1=localhost',
  '',
].join('\n'));
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', fixtureKeyPath, '-out', fixtureCertificatePath,
  '-config', opensslConfigPath, '-days', '1',
], {
  stdio: 'ignore',
  windowsHide: true,
  env: { ...process.env, OPENSSL_CONF: opensslConfigPath },
});
let secureTargetCount = 0;
const secureTarget = https.createServer({
  key: fs.readFileSync(fixtureKeyPath),
  cert: fs.readFileSync(fixtureCertificatePath),
}, (_request, response) => {
  _request.on('error', () => {});
  response.on('error', () => {});
  secureTargetCount += 1;
  response.setHeader('Content-Type', 'text/plain');
  response.end('secure-target');
});
secureTarget.listen(0, '127.0.0.1');
await once(secureTarget, 'listening');
const secureTargetUrl = `https://localhost:${secureTarget.address().port}/fixture`;

try {
  smokeStage = 'capture and replay'; await captureAndReplay();
  smokeStage = 'restart replay'; await replayAfterSidecarRestart();
  smokeStage = 'HTTPS capture'; await captureHttps();
  smokeStage = 'HTTPS intercept'; await interceptHttps();
  smokeStage = 'request intercept'; await interceptAndDrop();
  smokeStage = 'response intercept'; await interceptResponse();
  smokeStage = 'disable intercept releases paused flows'; await disableInterceptReleasesPausedFlows();
  smokeStage = 'Burp mirror exactly once'; await burpMirrorExactlyOnce();
  console.log('[traffic-proxy-smoke] PASS');
} catch (error) {
  throw new Error(`[traffic-proxy-smoke] ${smokeStage}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
} finally {
  target.close();
  secureTarget.close();
  fs.rmSync(root, { recursive: true, force: true });
}

async function captureHttps() {
  const sidecar = new TrafficSidecar();
  const events = [];
  try {
    const status = await sidecar.start({
      projectId: 'proxy-smoke-https', projectPath, userDataPath,
      profile: profile(false, false),
      trustedServerCaPath: fixtureCertificatePath,
      onFlow: (flow) => events.push(flow),
      onExit: (error) => { throw new Error(error); },
    });
    assert.equal(await httpsProxyRequest(status.proxyPort, secureTargetUrl, status.caCertificatePath), 'secure-target');
    const completed = await waitFor(() => events.find((flow) => flow.request.url === secureTargetUrl && flow.state === 'completed'));
    assert.equal(completed.request.url, secureTargetUrl);
    assert.equal(completed.request.httpVersion, 'http/1.1');
    assert.equal(secureTargetCount, 1);
    await sidecar.replay(completed.id, completed.request);
    await waitFor(() => events.find((flow) => flow.source === 'replay' && flow.state === 'completed'));
    assert.equal(secureTargetCount, 2);
  } finally {
    await sidecar.stop();
  }
}

async function interceptHttps() {
  const sidecar = new TrafficSidecar();
  const events = [];
  try {
    const status = await sidecar.start({
      projectId: 'proxy-smoke-https-intercept', projectPath, userDataPath,
      profile: profile(true, true),
      trustedServerCaPath: fixtureCertificatePath,
      onFlow: (flow) => events.push(flow),
      onExit: (error) => { throw new Error(error); },
    });
    const editedUrl = `${secureTargetUrl}?intercept=1`;
    const pending = httpsProxyRequest(status.proxyPort, editedUrl, status.caCertificatePath)
      .then((value) => ({ value }), (error) => ({ error }));
    const requestPaused = await waitFor(() => events.find((flow) => flow.request.url === editedUrl && flow.state === 'request_paused'));
    await sidecar.decide({
      flowId: requestPaused.id,
      expectedRevision: requestPaused.revision,
      action: 'forward',
      message: {
        method: 'GET',
        url: editedUrl,
        headers: [
          { name: 'Host', value: new URL(editedUrl).host },
          { name: 'X-Hexestra', value: 'secure-edited' },
        ],
        body: { encoding: 'utf8', data: '' },
      },
    });
    const responsePaused = await waitFor(() => events.find((flow) => flow.id === requestPaused.id && flow.state === 'response_paused'));
    await sidecar.decide({
      flowId: responsePaused.id,
      expectedRevision: responsePaused.revision,
      action: 'forward',
      message: {
        statusCode: 200,
        reason: 'Edited',
        headers: [
          { name: 'Content-Type', value: 'text/plain' },
          { name: 'Content-Length', value: '13' },
          { name: 'Connection', value: 'close' },
        ],
        body: { encoding: 'utf8', data: 'secure-edited' },
      },
    });
    const outcome = await pending;
    if ('error' in outcome) throw outcome.error;
    assert.equal(outcome.value, 'secure-edited');
    await waitFor(() => events.find((flow) => flow.id === requestPaused.id && flow.state === 'completed'));
    const beforeDrop = secureTargetCount;
    const droppedUrl = `${secureTargetUrl}?drop=1`;
    const dropped = httpsProxyRequest(status.proxyPort, droppedUrl, status.caCertificatePath).catch(() => '<dropped>');
    const dropPaused = await waitFor(() => events.find((flow) => flow.request.url === droppedUrl && flow.state === 'request_paused'));
    await sidecar.decide({ flowId: dropPaused.id, expectedRevision: dropPaused.revision, action: 'drop' });
    assert.equal(await dropped, '<dropped>');
    await waitFor(() => events.find((flow) => flow.id === dropPaused.id && flow.state === 'dropped'));
    assert.equal(secureTargetCount, beforeDrop);
  } finally {
    await sidecar.stop();
  }
}

async function burpMirrorExactlyOnce() {
  let bridgeCount = 0;
  const token = 'm'.repeat(32);
  const bridge = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/v1/flows');
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      assert.ok(Number(request.headers['x-hexestra-request-length']) > 0);
      assert.ok(Number(request.headers['x-hexestra-response-length']) > 0);
      assert.equal(Buffer.concat(chunks).length, Number(request.headers['content-length']));
      bridgeCount += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"accepted":true,"duplicate":false,"siteMap":true,"organizer":true}');
    });
  });
  bridge.listen(0, '127.0.0.1');
  await once(bridge, 'listening');
  const sidecar = new TrafficSidecar();
  const events = [];
  try {
    const mirrorProfile = profile(false, false);
    mirrorProfile.burp = { ...mirrorProfile.burp, enabled: true, bridgePort: bridge.address().port, bridgeToken: token };
    const status = await sidecar.start({
      projectId: 'proxy-smoke-mirror', projectPath, userDataPath,
      profile: mirrorProfile,
      onFlow: (flow) => events.push(flow),
      onExit: (error) => { throw new Error(error); },
    });
    const before = targetCount;
    assert.equal(await proxyRequest(status.proxyPort, `${targetUrl}?mirror=1`, {}), 'target:none:');
    const completed = await waitFor(() => events.find((flow) => flow.request.url.endsWith('?mirror=1') && flow.state === 'completed'));
    assert.equal(completed.route.burpRouted, false);
    assert.equal(targetCount, before + 1);
    await new BurpMirrorClient().mirror('proxy-smoke-mirror', completed, mirrorProfile.burp);
    assert.equal(bridgeCount, 1);
    assert.equal(targetCount, before + 1, 'mirroring must not send a second target request');
  } finally {
    await sidecar.stop();
    await new Promise((resolve) => bridge.close(resolve));
  }
}

async function captureAndReplay() {
  const sidecar = new TrafficSidecar();
  const events = [];
  try {
    const status = await sidecar.start({
      projectId: 'proxy-smoke', projectPath, userDataPath,
      profile: profile(false, false),
      onFlow: (flow) => events.push(flow),
      onExit: (error) => { throw new Error(error); },
    });
    const response = await proxyRequest(status.proxyPort, targetUrl, { 'X-Hexestra': 'capture' });
    assert.equal(response, 'target:capture:');
    const completed = await waitFor(() => events.find((flow) => flow.state === 'completed'));
    assert.equal(completed.request.url, targetUrl);
    assert.equal(completed.response.body.data, 'target:capture:');
    assert.equal(targetCount, 1);
    await sidecar.replay(completed.id, completed.request);
    const replay = await waitFor(() => events.find((flow) => flow.source === 'replay' && flow.state === 'completed'));
    assert.equal(replay.parentFlowId, completed.id);
    assert.equal(targetCount, 2);
  } finally {
    await sidecar.stop();
  }
}

async function replayAfterSidecarRestart() {
  const replayProjectPath = path.join(projectPath, 'restart-replay');
  fs.mkdirSync(replayProjectPath, { recursive: true });
  const capturedEvents = [];
  const first = new TrafficSidecar();
  const firstStatus = await first.start({
    projectId: 'proxy-smoke-restart', projectPath: replayProjectPath, userDataPath,
    profile: profile(false, false),
    onFlow: (flow) => capturedEvents.push(flow),
    onExit: (error) => { throw new Error(error); },
  });
  assert.equal(await proxyRequest(firstStatus.proxyPort, `${targetUrl}?restart=1`, { 'X-Hexestra': 'disk' }), 'target:disk:');
  const captured = await waitFor(() => capturedEvents.find((flow) => flow.state === 'completed'));
  const repository = new TrafficRepository(replayProjectPath);
  repository.upsert(captured);
  repository.close();
  await first.stop();

  const diskRepository = new TrafficRepository(replayProjectPath);
  const diskFlow = diskRepository.read(captured.id);
  diskRepository.close();
  assert.ok(diskFlow, 'captured request should be readable after sidecar restart');
  const replayEvents = [];
  const second = new TrafficSidecar();
  try {
    await second.start({
      projectId: 'proxy-smoke-restart', projectPath: replayProjectPath, userDataPath,
      profile: profile(true, true),
      onFlow: (flow) => replayEvents.push(flow),
      onExit: (error) => { throw new Error(error); },
    });
    const before = targetCount;
    await second.replay(diskFlow.id, diskFlow.request);
    const replay = await waitFor(() => replayEvents.find((flow) => flow.source === 'replay' && flow.state === 'completed'));
    assert.equal(replay.parentFlowId, diskFlow.id);
    assert.equal(targetCount, before + 1);
    assert.equal(replayEvents.some((flow) => flow.state === 'request_paused' || flow.state === 'response_paused'), false);
  } finally {
    await second.stop();
  }
}

async function interceptAndDrop() {
  const sidecar = new TrafficSidecar();
  const events = [];
  try {
    const status = await sidecar.start({
      projectId: 'proxy-smoke', projectPath, userDataPath,
      profile: profile(true, false),
      onFlow: (flow) => events.push(flow),
      onExit: (error) => { throw new Error(error); },
    });
    const before = targetCount;
    const pending = proxyRequest(status.proxyPort, targetUrl, { 'X-Hexestra': 'paused' });
    const paused = await waitFor(() => events.find((flow) => flow.state === 'request_paused'));
    assert.equal(targetCount, before);
    await sidecar.decide({
      flowId: paused.id,
      expectedRevision: paused.revision,
      action: 'forward',
      message: {
        method: 'POST', url: paused.request.url,
        headers: [{ name: 'X-Hexestra', value: 'edited' }, { name: 'Content-Length', value: '7' }],
        body: { encoding: 'utf8', data: 'changed' },
      },
    });
    assert.equal(await pending, 'target:edited:changed');
    await waitFor(() => events.find((flow) => flow.id === paused.id && flow.state === 'completed'));
    assert.equal(targetCount, before + 1);

    const droppedRequest = proxyRequest(status.proxyPort, `${targetUrl}?drop=1`, {}).catch(() => '<dropped>');
    const droppedPause = await waitFor(() => events.find((flow) => flow.request.url.endsWith('?drop=1') && flow.state === 'request_paused'));
    await sidecar.decide({ flowId: droppedPause.id, expectedRevision: droppedPause.revision, action: 'drop' });
    await droppedRequest;
    await waitFor(() => events.find((flow) => flow.id === droppedPause.id && flow.state === 'dropped'));
    assert.equal(targetCount, before + 1);
  } finally {
    await sidecar.stop();
  }
}

async function interceptResponse() {
  const sidecar = new TrafficSidecar();
  const events = [];
  try {
    const status = await sidecar.start({
      projectId: 'proxy-smoke', projectPath, userDataPath,
      profile: profile(false, true),
      onFlow: (flow) => events.push(flow),
      onExit: (error) => { throw new Error(error); },
    });
    const before = targetCount;
    const pending = proxyRequest(status.proxyPort, `${targetUrl}?response=1`, { 'X-Hexestra': 'response' })
      .then((value) => ({ value }), (error) => ({ error }));
    const paused = await waitFor(() => events.find((flow) => flow.state === 'response_paused'));
    await sidecar.decide({
      flowId: paused.id,
      expectedRevision: paused.revision,
      action: 'forward',
      message: {
        statusCode: 201,
        reason: 'Edited',
        headers: [{ name: 'Content-Type', value: 'text/plain' }, { name: 'Content-Length', value: '15' }],
        body: { encoding: 'utf8', data: 'edited-response' },
      },
    });
    const outcome = await pending;
    const response = 'value' in outcome
      ? outcome.value
      : /Proxy response 201/.test(outcome.error.message) ? 'edited-response' : (() => { throw outcome.error; })();
    assert.equal(response, 'edited-response');
    await waitFor(() => events.find((flow) => flow.id === paused.id && flow.state === 'completed'));
    assert.equal(targetCount, before + 1);
  } finally {
    await sidecar.stop();
  }
}

async function disableInterceptReleasesPausedFlows() {
  const sidecar = new TrafficSidecar();
  const events = [];
  try {
    const status = await sidecar.start({
      projectId: 'proxy-smoke-disable-intercept', projectPath, userDataPath,
      profile: profile(true, true),
      onFlow: (flow) => events.push(flow),
      onExit: (error) => { throw new Error(error); },
    });
    const before = targetCount;
    const url = `${targetUrl}?disable-intercept=1`;
    const pending = proxyRequest(status.proxyPort, url, { 'X-Hexestra': 'auto-forward' });
    const requestPaused = await waitFor(() => events.find((flow) => flow.request.url === url && flow.state === 'request_paused'));
    assert.equal(targetCount, before);

    await sidecar.updateIntercept(false, true);
    const forwarding = await waitFor(() => events.find((flow) => flow.id === requestPaused.id && flow.state === 'forwarding'));
    assert.equal(forwarding.revision, requestPaused.revision + 1);
    const responsePaused = await waitFor(() => events.find((flow) => flow.id === requestPaused.id && flow.state === 'response_paused'));

    await sidecar.updateIntercept(false, false);
    const completed = await waitFor(() => events.find((flow) => flow.id === requestPaused.id && flow.state === 'completed'));
    assert.equal(completed.revision, responsePaused.revision + 1);
    assert.equal(await pending, 'target:auto-forward:');
    assert.equal(targetCount, before + 1);
  } finally {
    await sidecar.stop();
  }
}

function profile(interceptRequests, interceptResponses) {
  return {
    enabled: true,
    interceptRequests,
    interceptResponses,
    listenHost: '127.0.0.1',
    burp: {
      enabled: false,
      bridgeHost: '127.0.0.1',
      bridgePort: 9877,
      bridgeToken: '',
      mcpUrl: 'http://127.0.0.1:9876/sse',
    },
  };
}

function proxyRequest(proxyPort, url, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port: proxyPort, method: 'GET', path: url,
      headers: { Host: new URL(url).host, Connection: 'close', ...headers },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode !== 200) reject(new Error(`Proxy response ${response.statusCode}: ${body}`));
        else resolve(body);
      });
    });
    request.once('error', reject);
    request.setTimeout(5_000, () => request.destroy(new Error('Proxy request timed out')));
    request.end();
  });
}

function httpsProxyRequest(proxyPort, url, caCertificatePath) {
  const destination = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, '127.0.0.1');
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(15_000, () => fail(new Error('HTTPS proxy request timed out')));
    socket.once('error', fail);
    socket.once('connect', () => {
      socket.write(`CONNECT ${destination.host} HTTP/1.1\r\nHost: ${destination.host}\r\nConnection: keep-alive\r\n\r\n`);
    });
    let connectResponse = Buffer.alloc(0);
    const onConnectData = (chunk) => {
      connectResponse = Buffer.concat([connectResponse, chunk]);
      const end = connectResponse.indexOf('\r\n\r\n');
      if (end < 0) return;
      socket.off('data', onConnectData);
      const header = connectResponse.subarray(0, end).toString('latin1');
      if (!/^HTTP\/1\.[01] 200\b/.test(header)) return fail(new Error(`CONNECT failed: ${header}`));
      const remainder = connectResponse.subarray(end + 4);
      if (remainder.length) socket.unshift(remainder);
      const secureSocket = tls.connect({
        socket,
        servername: destination.hostname,
        ca: fs.readFileSync(caCertificatePath),
      });
      secureSocket.once('error', reject);
      secureSocket.once('secureConnect', () => {
        secureSocket.write(`GET ${destination.pathname}${destination.search} HTTP/1.1\r\nHost: ${destination.host}\r\nConnection: close\r\n\r\n`);
      });
      const chunks = [];
      secureSocket.on('data', (chunk) => chunks.push(chunk));
      secureSocket.once('end', () => {
        const response = Buffer.concat(chunks).toString('utf8');
        const separator = response.indexOf('\r\n\r\n');
        const status = response.slice(0, response.indexOf('\r\n'));
        if (!/^HTTP\/1\.[01] 200\b/.test(status)) reject(new Error(`HTTPS proxy response ${status}`));
        else resolve(response.slice(separator + 4));
      });
    };
    socket.on('data', onConnectData);
  });
}

async function waitFor(read, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for traffic sidecar event');
}
