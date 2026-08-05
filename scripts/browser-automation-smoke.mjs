import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { app, BrowserWindow, WebContentsView } from 'electron';

const require = createRequire(import.meta.url);

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Smoke server did not expose a TCP port');
  return address.port;
}

const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  if (request.url === '/second') {
    response.end('<!doctype html><html><head><title>Hexestra browser second</title></head><body>second page</body></html>');
    return;
  }
  response.end(`<!doctype html>
    <html>
      <head><title>Hexestra browser smoke</title></head>
      <body>
        <label>Message <input aria-label="Message" /></label>
        <button onclick="document.querySelector('#result').textContent = document.querySelector('input').value">Apply</button>
        <output id="result">pending</output>
      </body>
    </html>`);
});

let automation;
let owner;
let view;
let smokeResult = { ok: false, error: 'Smoke test did not complete' };

function report(stage, detail) {
  if (!process.env.HEXESTRA_BROWSER_SMOKE_RESULT) return;
  writeFileSync(
    process.env.HEXESTRA_BROWSER_SMOKE_RESULT,
    JSON.stringify({ ok: false, stage, detail }, null, 2),
    'utf8',
  );
}

async function run() {
 try {
  report('server-listen');
  const port = await listen(server);
  report('window-create');
  const { BrowserAutomationSession } = require('../dist-electron/services/browser-automation.service.js');
  owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: `hexestra-browser-smoke-${Date.now()}`,
    },
  });
  owner.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  view.setVisible(true);
  await view.webContents.loadURL(`http://127.0.0.1:${port}`);

  report('automation-connect');
  automation = new BrowserAutomationSession(view.webContents, 'smoke-project', () => view.getBounds());
  const before = await automation.snapshot();
  report('automation-snapshot');
  const input = before.elements.find((element) => element.tag === 'input');
  const button = before.elements.find((element) => element.tag === 'button');
  if (!input || !button) throw new Error('Playwright snapshot did not expose the fixture controls');

  await automation.fill(input.ref, 'same visible page');
  await automation.click(button.ref);
  report('automation-action');
  const after = await automation.snapshot();
  if (!after.text.includes('same visible page')) throw new Error('Playwright action did not update the visible page');

  const second = await automation.navigate(`http://127.0.0.1:${port}/second`);
  if (second.title !== 'Hexestra browser second') throw new Error('Playwright navigation did not reach the second page');
  const back = await automation.goBack();
  if (back.title !== 'Hexestra browser smoke') throw new Error('Playwright back navigation did not restore the fixture');
  const forward = await automation.goForward();
  if (forward.title !== 'Hexestra browser second') throw new Error('Playwright forward navigation did not restore the second page');
  const reloaded = await automation.reload();
  if (reloaded.title !== 'Hexestra browser second') throw new Error('Playwright reload did not preserve the current page');

  smokeResult = { ok: true, title: reloaded.title, url: reloaded.url };
  process.stdout.write(`BROWSER_AUTOMATION_SMOKE_OK ${reloaded.title} ${reloaded.url}\n`);
 } catch (error) {
  smokeResult = { ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) };
  process.stderr.write(`BROWSER_AUTOMATION_SMOKE_FAILED ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
 } finally {
  automation?.dispose();
  if (owner && view && !owner.isDestroyed()) owner.contentView.removeChildView(view);
  if (view && !view.webContents.isDestroyed()) view.webContents.close();
  if (owner && !owner.isDestroyed()) owner.destroy();
  await new Promise((resolve) => server.close(resolve));
  if (process.env.HEXESTRA_BROWSER_SMOKE_RESULT) {
    writeFileSync(process.env.HEXESTRA_BROWSER_SMOKE_RESULT, JSON.stringify(smokeResult, null, 2), 'utf8');
  }
  app.exit(process.exitCode ?? 0);
 }
}

report('app-ready');
void app.whenReady().then(run).catch((error) => {
  report('app-ready-failed', error instanceof Error ? error.stack ?? error.message : String(error));
  app.exit(1);
});
