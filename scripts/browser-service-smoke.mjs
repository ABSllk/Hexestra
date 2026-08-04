import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

const require = createRequire(import.meta.url);
const smokeRoot = mkdtempSync(join(tmpdir(), 'hexestra-browser-service-'));
process.env.HEXESTRA_USER_DATA = join(smokeRoot, 'application');
const fixtureKeyPath = join(smokeRoot, 'fixture-key.pem');
const fixtureCertificatePath = join(smokeRoot, 'fixture-cert.pem');
const opensslConfigPath = join(smokeRoot, 'openssl.cnf');
writeFileSync(opensslConfigPath, [
  '[req]',
  'prompt=no',
  'distinguished_name=req_distinguished_name',
  'x509_extensions=v3_req',
  '[req_distinguished_name]',
  'CN=localhost',
  '[v3_req]',
  'subjectAltName=DNS:localhost',
  'basicConstraints=critical,CA:TRUE',
  'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign',
  'extendedKeyUsage=serverAuth',
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

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('Browser service fixture has no TCP port'));
      else resolve(address.port);
    });
  });
}

const server = createServer((request, response) => {
  if (request.url === '/post-target' && request.method === 'POST') {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head><title>Browser POST target</title></head><body>${Buffer.concat(chunks).toString('utf8')}</body></html>`);
    });
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  if (request.url === '/second') {
    response.end('<!doctype html><html><head><title>Browser service second</title></head><body>second page</body></html>');
    return;
  }
  response.end(`<!doctype html>
    <html>
      <head><title>Browser service fixture</title></head>
      <body>
        <label>Message <input aria-label="Message" /></label>
        <button id="apply" onclick="localStorage.setItem('message', document.querySelector('input').value); document.querySelector('#result').textContent = document.querySelector('input').value">Apply</button>
        <button id="popup" onclick="document.querySelector('#result').textContent = window.open('/popup') ? 'popup-opened' : 'popup-blocked'">Open popup</button>
        <form method="post" action="/post-target" target="_blank"><input name="token" value="preserved-post" /><button id="post-popup" type="submit">Submit popup form</button></form>
        <button id="leave" onclick="location.href = 'http://localhost:${server.address()?.port ?? 0}/outside'">Leave scope</button>
        <output id="result"><script>document.write(localStorage.getItem('message') || 'pending')</script></output>
      </body>
    </html>`);
});
const secureServer = createSecureServer({
  key: readFileSync(fixtureKeyPath),
  cert: readFileSync(fixtureCertificatePath),
}, (_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><head><title>Browser proxy TLS fixture</title></head><body>secure proxy page</body></html>');
});

let owner;
let sessionService;
let browserService;
let trafficSidecar;
let trafficSidecarError;

async function invoke(channel, ...args) {
  const payload = JSON.stringify([channel, ...args]);
  return owner.webContents.executeJavaScript(`(() => { const [channel, ...args] = ${payload}; return require('electron').ipcRenderer.invoke(channel, ...args); })()`);
}

async function run() {
  const [port, securePort] = await Promise.all([listen(server), listen(secureServer)]);
  const projectOnePath = join(smokeRoot, 'project-one');
  const projectTwoPath = join(smokeRoot, 'project-two');
  mkdirSync(projectOnePath, { recursive: true });
  mkdirSync(projectTwoPath, { recursive: true });

  ({ sessionService } = require('../dist-electron/services/session.service.js'));
  ({ browserService } = require('../dist-electron/services/browser.service.js'));
  const { TrafficSidecar } = require('../dist-electron/services/traffic-sidecar.js');
  const { DEFAULT_PROXY_PROFILE } = require('../dist-electron/contracts/traffic.js');
  const { BROWSER_IPC } = require('../dist-electron/contracts/browser.js');
  const projectOne = await sessionService.openProjectPath(projectOnePath, { name: 'Browser smoke one', scope: '127.0.0.1' });
  const projectTwo = await sessionService.openProjectPath(projectTwoPath, { name: 'Browser smoke two', scope: '127.0.0.1' });
  trafficSidecar = new TrafficSidecar();
  const proxyStatus = await trafficSidecar.start({
    projectId: projectOne.id,
    projectPath: projectOnePath,
    userDataPath: process.env.HEXESTRA_USER_DATA,
    profile: DEFAULT_PROXY_PROFILE,
    trustedServerCaPath: fixtureCertificatePath,
    onFlow: () => {},
    onExit: (error) => { trafficSidecarError = error; },
  });
  const proxyCa = new X509Certificate(readFileSync(proxyStatus.caCertificatePath));
  await browserService.setProjectProxy(
    projectOne.id,
    proxyStatus.proxyPort,
    proxyCa.fingerprint256,
    proxyStatus.caCertificatePath,
  );

  owner = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
  });
  await owner.loadURL('data:text/html,<title>Browser service owner</title>');
  await owner.webContents.executeJavaScript(`(() => {
    window.__hexestraOpenTabs = [];
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('${BROWSER_IPC.OPEN_TAB}', (_event, value) => {
      window.__hexestraOpenTabs.push(value);
      if (value.openerTabId === 'agent') {
        void ipcRenderer.invoke('${BROWSER_IPC.ENSURE}', {
          projectId: value.projectId,
          tabId: 'browser-one',
          url: value.url,
          ...(value.postBody ? { postBody: value.postBody } : {}),
        });
      }
    });
  })()`);
  const ownerId = owner.webContents.id;
  const firstIdentity = { projectId: projectOne.id, tabId: 'browser-one' };
  const secondIdentity = { projectId: projectTwo.id, tabId: 'browser-two' };
  const inScopeUrl = `http://127.0.0.1:${port}/`;

  const autoOpened = await browserService.navigateOrOpen(owner.webContents, inScopeUrl, projectOne.id);
  if (autoOpened.url !== inScopeUrl || autoOpened.scopeState !== 'in_scope') {
    throw new Error('Agent navigation did not create an integrated Browser tab');
  }
  await owner.webContents.executeJavaScript('window.__hexestraOpenTabs = []');
  await invoke(BROWSER_IPC.SET_LAYOUT, { ...firstIdentity, bounds: { x: 0, y: 0, width: 800, height: 600 }, visible: true });

  const initial = await browserService.readPage(ownerId, projectOne.id, firstIdentity.tabId);
  const input = initial.elements.find((element) => element.tag === 'input');
  const apply = initial.elements.find((element) => element.text === 'Apply');
  if (!input || !apply) throw new Error('Agent snapshot did not expose fixture controls');
  await browserService.type(ownerId, input.ref, 'same visible browser', false, projectOne.id, firstIdentity.tabId);
  await browserService.click(ownerId, apply.ref, projectOne.id, firstIdentity.tabId);
  const changed = await browserService.readPage(ownerId, projectOne.id, firstIdentity.tabId);
  if (!changed.text.includes('same visible browser')) throw new Error('Agent action did not update the same visible page');

  const popup = changed.elements.find((element) => element.text === 'Open popup');
  if (!popup) throw new Error('Popup fixture control is missing');
  await browserService.click(ownerId, popup.ref, projectOne.id, firstIdentity.tabId);
  const popupResult = await browserService.readPage(ownerId, projectOne.id, firstIdentity.tabId);
  if (!popupResult.text.includes('popup-blocked')) throw new Error('Popup was not denied by the browser service');
  const popupEvent = await waitForValue(() => owner.webContents.executeJavaScript('window.__hexestraOpenTabs[0]'));
  if (!popupEvent.url.endsWith('/popup') || popupEvent.projectId !== projectOne.id) throw new Error('Popup was not routed to a Hexestra Browser tab event');

  const postButton = popupResult.elements.find((element) => element.text === 'Submit popup form');
  if (!postButton) throw new Error('POST popup fixture control is missing');
  await browserService.click(ownerId, postButton.ref, projectOne.id, firstIdentity.tabId);
  const postEvent = await waitForValue(() => owner.webContents.executeJavaScript('window.__hexestraOpenTabs[1]'));
  if (!postEvent.postBody?.data?.length) throw new Error('Target-blank POST body was not preserved');
  const postIdentity = { projectId: projectOne.id, tabId: 'browser-post' };
  await invoke(BROWSER_IPC.ENSURE, { ...postIdentity, url: postEvent.url, postBody: postEvent.postBody });
  const postPage = await browserService.readPage(ownerId, projectOne.id, postIdentity.tabId);
  if (!postPage.text.includes('token=preserved-post')) throw new Error('Preserved target-blank POST was downgraded or lost');
  await invoke(BROWSER_IPC.DESTROY, postIdentity);

  const leave = popupResult.elements.find((element) => element.text === 'Leave scope');
  if (!leave) throw new Error('Out-of-scope fixture control is missing');
  await browserService.click(ownerId, leave.ref, projectOne.id, firstIdentity.tabId);
  const outsideUrl = `http://localhost:${port}/outside`;
  const afterSoftNavigation = await waitForValue(async () => {
    const state = browserService.listTabs(ownerId, projectOne.id)[0]?.state;
    return state?.url === outsideUrl ? state : null;
  });
  if (afterSoftNavigation.scopeState !== 'out_of_scope' || afterSoftNavigation.error) {
    throw new Error('Agent-triggered out-of-scope navigation did not remain accessible with soft scope state');
  }
  const outsideClickPage = await browserService.readPage(ownerId, projectOne.id, firstIdentity.tabId);
  if (outsideClickPage.scopeState !== 'out_of_scope') throw new Error('Out-of-scope page snapshot omitted soft scope state');

  const secondPage = await browserService.navigate(ownerId, `http://127.0.0.1:${port}/second`, projectOne.id, firstIdentity.tabId);
  if (secondPage.title !== 'Browser service second') throw new Error('Agent navigation did not reach the second page');
  if ((await browserService.agentGoBack(ownerId, projectOne.id, firstIdentity.tabId)).title !== 'Browser service fixture') {
    throw new Error('Agent back navigation failed');
  }
  if ((await browserService.agentGoForward(ownerId, projectOne.id, firstIdentity.tabId)).title !== 'Browser service second') {
    throw new Error('Agent forward navigation failed');
  }
  if ((await browserService.agentReload(ownerId, projectOne.id, firstIdentity.tabId)).title !== 'Browser service second') {
    throw new Error('Agent reload failed');
  }
  const screenshot = await browserService.screenshot(ownerId, projectOne.id, firstIdentity.tabId);
  if (screenshot.mimeType !== 'image/png' || screenshot.base64.length < 100) throw new Error('Agent screenshot is invalid');

  await browserService.navigate(ownerId, inScopeUrl, projectOne.id, firstIdentity.tabId);
  const agentOutState = await browserService.navigate(ownerId, outsideUrl, projectOne.id, firstIdentity.tabId);
  if (agentOutState.scopeState !== 'out_of_scope') throw new Error('Agent navigation omitted out-of-scope advisory state');
  const agentOutPage = await browserService.readPage(ownerId, projectOne.id, firstIdentity.tabId);
  if (agentOutPage.scopeState !== 'out_of_scope') throw new Error('Agent could not read an out-of-scope advisory page');
  const agentOutScreenshot = await browserService.screenshot(ownerId, projectOne.id, firstIdentity.tabId);
  if (agentOutScreenshot.scopeState !== 'out_of_scope' || agentOutScreenshot.base64.length < 100) {
    throw new Error('Agent could not screenshot an out-of-scope advisory page');
  }

  const humanOutState = await invoke(BROWSER_IPC.NAVIGATE, { ...firstIdentity, url: outsideUrl });
  if (humanOutState.scopeState !== 'out_of_scope') throw new Error('Human reference page did not expose advisory scope state');
  await invoke(BROWSER_IPC.NAVIGATE, { ...firstIdentity, url: inScopeUrl });

  const secureState = await invoke(BROWSER_IPC.NAVIGATE, {
    ...firstIdentity,
    url: `https://localhost:${securePort}/`,
  });
  if (secureState.title !== 'Browser proxy TLS fixture' || secureState.error) {
    throw new Error(`Project CA did not authorize the proxied HTTPS page: ${secureState.error ?? secureState.title}`);
  }
  await invoke(BROWSER_IPC.NAVIGATE, { ...firstIdentity, url: inScopeUrl });

  await invoke(BROWSER_IPC.ENSURE, { ...secondIdentity, url: inScopeUrl });
  await invoke(BROWSER_IPC.SET_LAYOUT, { ...secondIdentity, bounds: { x: 0, y: 0, width: 800, height: 600 }, visible: true });
  const isolated = await browserService.readPage(ownerId, projectTwo.id, secondIdentity.tabId);
  if (!isolated.text.includes('pending') || isolated.text.includes('same visible browser')) {
    throw new Error('Project-scoped browser storage leaked between projects');
  }

  await invoke(BROWSER_IPC.DESTROY, secondIdentity);
  await invoke(BROWSER_IPC.DESTROY, firstIdentity);
  if (browserService.listTabs(ownerId).length !== 0) throw new Error('Destroyed browser tabs remained registered');
  if (trafficSidecarError) throw new Error(trafficSidecarError);

  await browserService.setProjectProxy(projectOne.id, null);
  await trafficSidecar.stop();
  trafficSidecar = null;

  process.stdout.write('BROWSER_SERVICE_SMOKE_OK same-page Agent actions, advisory scope, popup, storage, history, screenshot, project CA HTTPS, cleanup\n');
}

async function waitForValue(action, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await action();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for Browser event');
}

void app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    await run();
  } catch (error) {
    exitCode = 1;
    process.stderr.write(`BROWSER_SERVICE_SMOKE_FAILED ${error instanceof Error ? error.stack : String(error)}\n`);
  } finally {
    await trafficSidecar?.stop();
    if (owner && !owner.isDestroyed()) owner.destroy();
    sessionService?.close();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => secureServer.close(resolve)),
    ]);
    rmSync(smokeRoot, { recursive: true, force: true });
    app.exit(exitCode);
  }
});
