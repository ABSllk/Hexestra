import fs from 'node:fs';

const endpoint = process.env.HEXESTRA_CDP_ENDPOINT ?? 'http://127.0.0.1:9223/json';
const targets = await (await fetch(endpoint)).json();
const page = targets.find((item) => item.type === 'page' && item.title === 'Hexestra');
if (!page) throw new Error('Hexestra page not found');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let nextId = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
};

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

await send('Runtime.enable');
await send('Page.enable');

const domain = await evaluate(`(async () => {
  const button = [...document.querySelectorAll('button')]
    .find((item) => item.textContent?.trim() === 'domain');
  button?.click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const nodes = [...document.querySelectorAll('[data-node-id]')];
  const centers = nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return {
      id: node.dataset.nodeId,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      labels: node.querySelectorAll('text').length,
    };
  });
  let minDistance = Infinity;
  for (let left = 0; left < centers.length; left += 1) {
    for (let right = left + 1; right < centers.length; right += 1) {
      minDistance = Math.min(
        minDistance,
        Math.hypot(centers[left].x - centers[right].x, centers[left].y - centers[right].y),
      );
    }
  }
  const edgeOpacity = [...document.querySelectorAll('g[aria-label="Network links"] > g')]
    .map((edge) => Number(edge.getAttribute('opacity') ?? 1));
  return {
    nodeCount: nodes.length,
    visibleLabelNodes: centers.filter((node) => node.labels > 0).length,
    minDistance,
    edgeCount: edgeOpacity.length,
    dimmedEdges: edgeOpacity.filter((value) => value <= 0.1).length,
    pressed: button?.getAttribute('aria-pressed'),
  };
})()`);

const screenshot = await send('Page.captureScreenshot', {
  format: 'png',
  fromSurface: true,
  captureBeyondViewport: false,
});
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/hexestra-dense-domain.png', Buffer.from(screenshot.data, 'base64'));

const records = await evaluate(`(async () => {
  [...document.querySelectorAll('button')]
    .find((item) => item.textContent?.trim() === 'Records')?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  return ['Findings', 'Evidence', 'Reports'].map((label) =>
    [...document.querySelectorAll('button')].some((item) => item.textContent?.includes(label))
  );
})()`);

const scope = await evaluate(`(async () => {
  [...document.querySelectorAll('button')]
    .find((item) => item.textContent?.trim() === 'Assets')?.click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  [...document.querySelectorAll('button')]
    .find((item) => item.textContent?.trim() === 'scope')?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  return {
    defineButton: [...document.querySelectorAll('button')]
      .some((item) => item.textContent?.includes('Define Scope with Agent')),
    bodyHasScopeEditor: document.body.innerText.includes('Save Scope'),
  };
})()`);

const report = { domain, records, scope };
console.log(JSON.stringify(report, null, 2));
socket.close();

if (
  domain.nodeCount <= 36
  || domain.visibleLabelNodes < 1
  || domain.visibleLabelNodes >= domain.nodeCount / 2
  || domain.minDistance < 20
  || domain.pressed !== 'true'
  || (domain.edgeCount > 0 && domain.dimmedEdges >= domain.edgeCount)
  || records.some((available) => !available)
  || !scope.bodyHasScopeEditor
) {
  process.exitCode = 1;
}
