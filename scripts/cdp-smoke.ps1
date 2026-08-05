$ErrorActionPreference = 'Stop'

$endpoint = if ($env:HEXESTRA_CDP_ENDPOINT) {
  $env:HEXESTRA_CDP_ENDPOINT
} else {
  'http://127.0.0.1:9223/json'
}
$artifactDir = Join-Path (Get-Location) 'artifacts'
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null

$targets = @(Invoke-RestMethod -Uri $endpoint -TimeoutSec 10)
$target = $targets | Where-Object { $_.type -eq 'page' -and $_.title -eq 'Hexestra' } | Select-Object -First 1
if (-not $target.webSocketDebuggerUrl) {
  throw 'Hexestra renderer target was not found'
}

$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$connectCts = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(15))
$socket.ConnectAsync(
  [Uri]$target.webSocketDebuggerUrl,
  $connectCts.Token
).GetAwaiter().GetResult() | Out-Null

$script:nextId = 0
$script:runtimeErrors = [System.Collections.Generic.List[string]]::new()

function Receive-CdpMessage {
  $buffer = [byte[]]::new(65536)
  $stream = [System.IO.MemoryStream]::new()
  $receiveCts = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(30))

  do {
    $segment = [ArraySegment[byte]]::new($buffer)
    $result = $socket.ReceiveAsync($segment, $receiveCts.Token).GetAwaiter().GetResult()
    if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
      throw 'CDP socket closed unexpectedly'
    }
    $stream.Write($buffer, 0, $result.Count)
  } until ($result.EndOfMessage)

  $json = [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
  return $json | ConvertFrom-Json
}

function Send-CdpCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [hashtable]$Params = @{}
  )

  $script:nextId += 1
  $id = $script:nextId
  $payload = @{
    id = $id
    method = $Method
    params = $Params
  } | ConvertTo-Json -Compress -Depth 20
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  $sendCts = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(15))
  $socket.SendAsync(
    [ArraySegment[byte]]::new($bytes),
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    $sendCts.Token
  ).GetAwaiter().GetResult() | Out-Null

  while ($true) {
    $message = Receive-CdpMessage
    if ($message.method -eq 'Runtime.exceptionThrown') {
      $description = [string]$message.params.exceptionDetails.exception.description
      if (-not $description) { $description = [string]$message.params.exceptionDetails.text }
      $script:runtimeErrors.Add($description)
      continue
    }
    if ($message.method -eq 'Log.entryAdded' -and $message.params.entry.level -eq 'error') {
      $logText = [string]$message.params.entry.text
      if ($logText -ne 'Unable to preventDefault inside passive event listener invocation.') {
        $script:runtimeErrors.Add($logText)
      }
      continue
    }
    if ($message.id -eq $id) {
      if ($message.error) {
        throw "CDP command failed: $Method - $($message.error.message)"
      }
      return $message.result
    }
  }
}

function Send-CdpCommandNoWait {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [hashtable]$Params = @{}
  )

  $script:nextId += 1
  $payload = @{
    id = $script:nextId
    method = $Method
    params = $Params
  } | ConvertTo-Json -Compress -Depth 20
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  $sendCts = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(15))
  $socket.SendAsync(
    [ArraySegment[byte]]::new($bytes),
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    $sendCts.Token
  ).GetAwaiter().GetResult() | Out-Null
}

function Invoke-CdpExpression {
  param([Parameter(Mandatory = $true)][string]$Expression)

  $result = Send-CdpCommand -Method 'Runtime.evaluate' -Params @{
    expression = $Expression
    awaitPromise = $true
    returnByValue = $true
  }
  if ($result.exceptionDetails) {
    throw "Renderer evaluation failed: $($result.exceptionDetails.text)"
  }
  return $result.result.value
}

Send-CdpCommand -Method 'Runtime.enable' | Out-Null
Send-CdpCommand -Method 'Log.enable' | Out-Null
Send-CdpCommand -Method 'Page.enable' | Out-Null
Write-Host '[smoke] CDP connected'

$engagementId = Invoke-CdpExpression -Expression @'
(async () => {
  const projects = await window.hexestra.invoke('project:list-recent');
  const project = projects.find((candidate) => candidate.name === 'UI Functional Test');
  if (!project) return '';
  window.localStorage.setItem('hexestra:last-project', project.id);
  return project.id;
})()
'@
if (-not $engagementId) {
  throw 'UI Functional Test folder project was not found'
}
Send-CdpCommand -Method 'Page.reload' | Out-Null
Start-Sleep -Milliseconds 1800
Write-Host '[smoke] Test engagement loaded'

Invoke-CdpExpression -Expression @'
Array.from(document.querySelectorAll('button[aria-label^="Close "]'))
  .forEach((button) => button.click())
'@ | Out-Null
Start-Sleep -Milliseconds 250
Invoke-CdpExpression -Expression @'
document.querySelector('button[aria-label="Fit topology"]')?.click()
'@ | Out-Null
Start-Sleep -Milliseconds 350

$initialExpression = @'
(() => {
  const text = document.body.innerText;
  const bounds = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  };
  const netmap = document.querySelector('.netmap-shell');
  const canvas = document.querySelector('.netmap-canvas');
  return {
    title: document.title,
    readyState: document.readyState,
    svgCount: document.querySelectorAll('svg').length,
    emojiMatches: text.match(/\p{Extended_Pictographic}/gu) ?? [],
    previewVisible: text.includes('PREVIEW TOPOLOGY'),
    previewNodeCount: document.querySelectorAll('[data-node-id]').length,
    domainGraphBadge: text.includes('DOMAIN GRAPH'),
    networkPerspectiveButton: Array.from(document.querySelectorAll('button'))
      .some((button) => button.textContent?.trim().toUpperCase() === 'NETWORK'),
    netmapHud: document.querySelector('[aria-label="Domain asset relationship map"] aside')?.innerText ?? '',
    tabTitles: Array.from(document.querySelectorAll('.tab-bar > div')).map(
      (element) => element.innerText.trim()
    ),
    netmapBounds: netmap ? bounds(netmap) : null,
    canvasBounds: canvas ? bounds(canvas) : null,
    nodeBounds: Array.from(document.querySelectorAll('[data-node-id]')).map((node) => {
      const labels = Array.from(node.querySelectorAll('text')).map(bounds);
      return {
        id: node.getAttribute('data-node-id'),
        y: Math.min(...labels.map((label) => label.y)),
        bottom: Math.max(...labels.map((label) => label.bottom)),
      };
    }),
  };
})()
'@
$initial = Invoke-CdpExpression -Expression $initialExpression
Write-Host '[smoke] Initial renderer state captured'

$permissionModes = Invoke-CdpExpression -Expression @'
(async () => {
  const findMode = (label) => Array.from(document.querySelectorAll('button'))
    .find((button) => button.textContent?.trim() === label);
  const ask = findMode('ASK');
  const auto = findMode('AUTO');
  const bypass = findMode('BYPASS');
  const labels = [ask, auto, bypass].filter(Boolean).map((button) => button.textContent.trim());
  const askInitiallyPressed = ask?.getAttribute('aria-pressed') === 'true';

  bypass?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const warning = document.querySelector('[role="alert"]')?.textContent ?? '';
  const bypassBeforeConfirmation = bypass?.getAttribute('aria-pressed') === 'true';
  const enable = Array.from(document.querySelectorAll('button'))
    .find((button) => button.textContent?.trim() === 'ENABLE BYPASS');
  enable?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const bypassAfterConfirmation = bypass?.getAttribute('aria-pressed') === 'true';

  auto?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const autoPressed = auto?.getAttribute('aria-pressed') === 'true';
  ask?.click();

  return {
    labels,
    askInitiallyPressed,
    warning,
    bypassBeforeConfirmation,
    bypassAfterConfirmation,
    autoPressed,
  };
})()
'@
Write-Host '[smoke] Claude permission modes verified'

$nodeDrag = Invoke-CdpExpression -Expression @'
(async () => {
  const svg = document.querySelector('svg[aria-label="Interactive domain asset graph"]');
  const node = document.querySelector('[data-node-id]');
  const nodeId = node?.getAttribute('data-node-id');
  const linkGroup = Array.from(document.querySelectorAll('g[aria-label="Asset links"] > g'))
    .find((edge) => edge.getAttribute('data-edge-source') === nodeId
      || edge.getAttribute('data-edge-target') === nodeId);
  const link = linkGroup?.querySelector('path');
  if (!svg || !node || !link) return { available: false };
  const bounds = node.getBoundingClientRect();
  const start = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  const beforeNode = node.getAttribute('transform');
  const beforeLink = link.getAttribute('d');
  node.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    button: 0,
    clientX: start.x,
    clientY: start.y,
  }));
  svg.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true,
    button: 0,
    clientX: start.x + 42,
    clientY: start.y + 14,
  }));
  svg.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true,
    button: 0,
    clientX: start.x + 42,
    clientY: start.y + 14,
  }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const afterNode = node.getAttribute('transform');
  const afterLink = link.getAttribute('d');
  Array.from(document.querySelectorAll('button'))
    .find((button) => button.getAttribute('aria-label') === 'Fit topology')?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  return {
    available: true,
    nodeMoved: beforeNode !== afterNode,
    linkMoved: beforeLink !== afterLink,
    fitRestored: node.getAttribute('transform') === beforeNode,
  };
})()
'@
Write-Host '[smoke] NetMap node dragging verified'

$selectedNetmapNodeId = Invoke-CdpExpression -Expression @'
(() => {
const node =
  document.querySelector('[data-node-id="preview-web"]') ??
  document.querySelector('[data-node-id]');
node?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
return node?.getAttribute('data-node-id') ?? '';
})()
'@
Start-Sleep -Milliseconds 150
$selectedHud = Invoke-CdpExpression -Expression @'
document.querySelector('[aria-label="Domain asset relationship map"] aside')?.innerText ?? ''
'@
Write-Host '[smoke] NetMap selection verified'

Invoke-CdpExpression -Expression @'
Array.from(document.querySelectorAll('button'))
  .find((button) => button.getAttribute('aria-label') === 'Zoom in')?.click()
'@ | Out-Null
Start-Sleep -Milliseconds 100
$zoomLabel = Invoke-CdpExpression -Expression @'
Array.from(document.querySelectorAll('span'))
  .find((element) => element.textContent?.trim() === '116%')?.textContent?.trim() ?? ''
'@
Write-Host '[smoke] NetMap zoom verified'

Invoke-CdpExpression -Expression @'
Array.from(document.querySelectorAll('button'))
  .find((button) => button.getAttribute('aria-label') === 'Fit topology')?.click()
'@ | Out-Null
Start-Sleep -Milliseconds 100

$netmapScreenshot = Send-CdpCommand -Method 'Page.captureScreenshot' -Params @{
  format = 'png'
  fromSurface = $true
  captureBeyondViewport = $false
}
[System.IO.File]::WriteAllBytes(
  (Join-Path $artifactDir 'hexestra-netmap.png'),
  [Convert]::FromBase64String([string]$netmapScreenshot.data)
)
Write-Host '[smoke] NetMap screenshot saved'

Invoke-CdpExpression -Expression @'
Array.from(document.querySelectorAll('button'))
  .find((button) => button.textContent?.includes('New Terminal'))?.click()
'@ | Out-Null
Start-Sleep -Milliseconds 1200
$terminal = Invoke-CdpExpression -Expression @'
(() => {
  const bounds = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  return {
    tabVisible: Array.from(document.querySelectorAll('*')).some(
      (element) => element.textContent?.trim() === 'Terminal'
    ),
    tabTitles: Array.from(document.querySelectorAll('.tab-bar > div')).map(
      (element) => element.innerText.trim()
    ),
    xtermMounted: Boolean(document.querySelector('.xterm-container .xterm')),
    xtermBounds: bounds('.xterm-container'),
    netmapBounds: bounds('.netmap-shell'),
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
})()
'@
Write-Host '[smoke] Terminal mount verified'

$terminalProbe = Invoke-CdpExpression -Expression @'
(async () => {
  const sessions = await window.hexestra.invoke('terminal:list');
  const session = sessions[0];
  if (!session) return { sessionCount: 0, output: '' };

  return await new Promise((resolve) => {
    let output = '';
    const unsubscribe = window.hexestra.on('terminal:output', (payload) => {
      if (payload.sessionId !== session.id) return;
      output += payload.data;
      if (output.includes('HEXESTRA_SMOKE_OK')) {
        unsubscribe();
        resolve({ sessionCount: sessions.length, output });
      }
    });
    window.hexestra.invoke('terminal:write', session.id, 'echo HEXESTRA_SMOKE_OK\r');
    setTimeout(() => {
      unsubscribe();
      resolve({ sessionCount: sessions.length, output });
    }, 3000);
  });
})()
'@
Write-Host '[smoke] Terminal PTY round-trip verified'

$terminalPagingInitial = Invoke-CdpExpression -Expression @'
(async () => {
  const sessions = await window.hexestra.invoke('terminal:list');
  const session = sessions[0];
  if (!session) return {
    outputComplete: false,
    autoFollowLabel: '',
    viewportAtBottom: false,
    scrollbarVisible: false,
    wheelPoint: null
  };
  const outputComplete = await new Promise((resolve) => {
    let output = '';
    const unsubscribe = window.hexestra.on('terminal:output', (payload) => {
      if (payload.sessionId !== session.id) return;
      output += payload.data;
      if (output.includes('HEXESTRA-LINE-120')) {
        unsubscribe();
        resolve(true);
      }
    });
    window.hexestra.invoke(
      'terminal:write',
      session.id,
      'for /L %i in (1,1,120) do @echo HEXESTRA-LINE-%i\r'
    );
    setTimeout(() => { unsubscribe(); resolve(false); }, 5000);
  });
  const label = () => document.querySelector('button[aria-label="Page up"]')
    ?.parentElement?.querySelector('span')?.textContent?.trim() ?? '';
  // The PTY stream can finish before xterm's asynchronous write queue has
  // materialized the DOM scrollback on slower Windows CI/desktop runs.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const pendingViewport = document.querySelector('.xterm-viewport');
    if (pendingViewport && pendingViewport.scrollHeight > pendingViewport.clientHeight) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const viewport = document.querySelector('.xterm-viewport');
  const autoFollowLabel = label();
  const viewportAtBottom = viewport
    ? Math.abs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop) <= 2
    : false;
  const scrollbarVisible = viewport
    ? viewport.scrollHeight > viewport.clientHeight &&
      getComputedStyle(viewport).overflowY === 'scroll' &&
      viewport.getBoundingClientRect().right <=
        document.querySelector('.xterm-container').getBoundingClientRect().right
    : false;
  const scrollbarMetrics = viewport ? {
    scrollHeight: viewport.scrollHeight,
    clientHeight: viewport.clientHeight,
    offsetWidth: viewport.offsetWidth,
    clientWidth: viewport.clientWidth,
    overflowY: getComputedStyle(viewport).overflowY,
    viewportRight: viewport.getBoundingClientRect().right,
    containerRight: document.querySelector('.xterm-container').getBoundingClientRect().right
  } : null;
  const viewportBounds = viewport?.getBoundingClientRect();
  return {
    outputComplete,
    autoFollowLabel,
    viewportAtBottom,
    scrollbarVisible,
    scrollbarMetrics,
    wheelPoint: viewportBounds ? {
      x: viewportBounds.left + viewportBounds.width / 2,
      y: viewportBounds.top + viewportBounds.height / 2
    } : null
  };
})()
'@

Send-CdpCommandNoWait -Method 'Input.dispatchMouseEvent' -Params @{
  type = 'mouseWheel'
  x = [double]$terminalPagingInitial.wheelPoint.x
  y = [double]$terminalPagingInitial.wheelPoint.y
  deltaX = 0
  deltaY = -700
} | Out-Null
Start-Sleep -Milliseconds 250
$wheelUpLabel = Invoke-CdpExpression -Expression @'
document.querySelector('button[aria-label="Page up"]')
  ?.parentElement?.querySelector('span')?.textContent?.trim() ?? ''
'@
$preservedScrollLabel = Invoke-CdpExpression -Expression @'
(async () => {
  const sessions = await window.hexestra.invoke('terminal:list');
  const session = sessions[0];
  if (!session) return '';
  window.hexestra.invoke('terminal:write', session.id, 'echo HEXESTRA-SCROLL-PRESERVE\r');
  await new Promise((resolve) => setTimeout(resolve, 250));
  return document.querySelector('button[aria-label="Page up"]')
    ?.parentElement?.querySelector('span')?.textContent?.trim() ?? '';
})()
'@
Send-CdpCommandNoWait -Method 'Input.dispatchMouseEvent' -Params @{
  type = 'mouseWheel'
  x = [double]$terminalPagingInitial.wheelPoint.x
  y = [double]$terminalPagingInitial.wheelPoint.y
  deltaX = 0
  deltaY = 20000
} | Out-Null
Start-Sleep -Milliseconds 250
$bottomLabel = Invoke-CdpExpression -Expression @'
document.querySelector('button[aria-label="Page up"]')
  ?.parentElement?.querySelector('span')?.textContent?.trim() ?? ''
'@
$terminalPaging = [ordered]@{
  outputComplete = $terminalPagingInitial.outputComplete
  autoFollowLabel = $terminalPagingInitial.autoFollowLabel
  viewportAtBottom = $terminalPagingInitial.viewportAtBottom
  scrollbarVisible = $terminalPagingInitial.scrollbarVisible
  scrollbarMetrics = $terminalPagingInitial.scrollbarMetrics
  wheelUpLabel = $wheelUpLabel
  preservedScrollLabel = $preservedScrollLabel
  bottomLabel = $bottomLabel
}
Write-Host '[smoke] Terminal live follow and native wheel scroll verified'

$terminalAssetIsolation = Invoke-CdpExpression -Expression @'
(async () => {
  const terminals = await window.hexestra.invoke('terminal:list');
  const terminal = terminals[0];
  const projects = await window.hexestra.invoke('project:list-recent');
  const project = projects.find((candidate) => candidate.name === 'UI Functional Test');
  if (!terminal || !project) return { available: false };
  const initialTerminalContext = await window.hexestra.invoke('terminal:info', terminal.id);
  const targetsBefore = await window.hexestra.invoke('targets:list', project.id);
  const graphBefore = await window.hexestra.invoke('netmap:get', project.id);
  window.hexestra.invoke(
    'terminal:write',
    terminal.id,
    '(echo Nmap scan report for 203.0.113.241&echo 65530/tcp open unknown parser-must-not-run)\r'
  );
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const targetsAfter = await window.hexestra.invoke('targets:list', project.id);
  const graphAfter = await window.hexestra.invoke('netmap:get', project.id);
  return {
    available: true,
    targetCountBefore: targetsBefore.length,
    targetCountAfter: targetsAfter.length,
    assetCountBefore: graphBefore.assets.length,
    assetCountAfter: graphAfter.assets.length,
    edgeCountBefore: graphBefore.edges.length,
    edgeCountAfter: graphAfter.edges.length,
    syntheticHostAbsent: !targetsAfter.some((candidate) => candidate.ip === '203.0.113.241')
      && !graphAfter.assets.some((asset) => asset.key === 'host:203.0.113.241'),
    initialTerminalContext: initialTerminalContext?.activeTargetId ?? '',
  };
})()
'@
Write-Host '[smoke] Terminal output isolation from AI-owned assets verified'

$taskTree = Invoke-CdpExpression -Expression @'
(async () => {
  Array.from(document.querySelectorAll('button'))
    .find((button) => button.textContent?.includes('Task Tree'))?.click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  return {
    rootPresent: Boolean(document.querySelector('#root')?.firstElementChild),
    taskCountVisible: /\b[1-9]\d* tasks\b/.test(document.body.innerText),
    errorBoundaryVisible: document.body.innerText.includes('panel encountered an error'),
  };
})()
'@
Write-Host '[smoke] Task Tree stability verified'

$screenshot = Send-CdpCommand -Method 'Page.captureScreenshot' -Params @{
  format = 'png'
  fromSurface = $true
  captureBeyondViewport = $false
}
[System.IO.File]::WriteAllBytes(
  (Join-Path $artifactDir 'hexestra-smoke.png'),
  [Convert]::FromBase64String([string]$screenshot.data)
)
Write-Host '[smoke] Screenshot saved'

Invoke-CdpExpression -Expression @'
document.querySelector('button[aria-label^="Close Terminal"]')?.click()
'@ | Out-Null
Start-Sleep -Milliseconds 350
$cleanup = Invoke-CdpExpression -Expression @'
(async () => ({
  tabTitles: Array.from(document.querySelectorAll('.tab-bar > div')).map(
    (element) => element.innerText.trim()
  ),
  xtermMounted: Boolean(document.querySelector('.xterm-container .xterm')),
  terminalSessionCount: (await window.hexestra.invoke('terminal:list')).length,
}))()
'@
Write-Host '[smoke] Terminal cleanup verified'

$nodesInsideNetmap = (
  $null -ne $initial.canvasBounds -and
  @(
    $initial.nodeBounds | Where-Object {
      $_.y -ge ($initial.canvasBounds.y - 1) -and
      $_.bottom -le ($initial.canvasBounds.bottom + 1)
    }
  ).Count -eq @($initial.nodeBounds).Count
)
$expectedTerminalContext = if ($initial.previewVisible) { 'local-operator' } else { $selectedNetmapNodeId }

$passed = (
  $initial.title -eq 'Hexestra' -and
  $initial.readyState -eq 'complete' -and
  $initial.svgCount -ge 20 -and
  @($initial.emojiMatches).Count -eq 0 -and
  @($initial.tabTitles).Count -eq 1 -and
  $initial.tabTitles[0] -eq 'Welcome' -and
  $initial.domainGraphBadge -and
  -not $initial.networkPerspectiveButton -and
  $initial.previewNodeCount -ge 1 -and
  @($permissionModes.labels).Count -eq 3 -and
  $permissionModes.labels[0] -eq 'ASK' -and
  $permissionModes.labels[1] -eq 'AUTO' -and
  $permissionModes.labels[2] -eq 'BYPASS' -and
  $permissionModes.askInitiallyPressed -and
  $permissionModes.warning.Contains('without any permission prompt') -and
  -not $permissionModes.bypassBeforeConfirmation -and
  $permissionModes.bypassAfterConfirmation -and
  $permissionModes.autoPressed -and
  $nodeDrag.available -and
  $nodeDrag.nodeMoved -and
  $nodeDrag.linkMoved -and
  $nodeDrag.fitRestored -and
  $nodesInsideNetmap -and
  $selectedHud.Length -gt 0 -and
  $zoomLabel -eq '116%' -and
  $terminal.tabVisible -and
  @($terminal.tabTitles).Count -eq 2 -and
  $terminal.tabTitles[0] -eq 'Welcome' -and
  $terminal.tabTitles[1] -match 'Terminal' -and
  $terminal.xtermMounted -and
  $terminalProbe.sessionCount -eq 1 -and
  $terminalProbe.output.Contains('HEXESTRA_SMOKE_OK') -and
  $terminalPaging.outputComplete -and
  $terminalPaging.autoFollowLabel -eq 'LIVE' -and
  $terminalPaging.viewportAtBottom -and
  $terminalPaging.scrollbarVisible -and
  $terminalPaging.wheelUpLabel -ne 'LIVE' -and
  $terminalPaging.preservedScrollLabel -ne 'LIVE' -and
  $terminalPaging.bottomLabel -eq 'LIVE' -and
  $terminalAssetIsolation.available -and
  $terminalAssetIsolation.targetCountAfter -eq $terminalAssetIsolation.targetCountBefore -and
  $terminalAssetIsolation.assetCountAfter -eq $terminalAssetIsolation.assetCountBefore -and
  $terminalAssetIsolation.edgeCountAfter -eq $terminalAssetIsolation.edgeCountBefore -and
  $terminalAssetIsolation.syntheticHostAbsent -and
  $terminalAssetIsolation.initialTerminalContext -eq $expectedTerminalContext -and
  $taskTree.rootPresent -and
  $taskTree.taskCountVisible -and
  -not $taskTree.errorBoundaryVisible -and
  $terminal.xtermBounds.width -lt $terminal.viewport.width * 0.75 -and
  $terminal.xtermBounds.height -lt $terminal.viewport.height * 0.8 -and
  @($cleanup.tabTitles).Count -eq 1 -and
  $cleanup.tabTitles[0] -eq 'Welcome' -and
  -not $cleanup.xtermMounted -and
  $cleanup.terminalSessionCount -eq 0 -and
  $script:runtimeErrors.Count -eq 0
)

$report = [ordered]@{
  target = [ordered]@{
    title = $target.title
    url = $target.url
  }
  initial = $initial
  permissionModes = $permissionModes
  nodeDrag = $nodeDrag
  selectedHud = $selectedHud
  zoomLabel = $zoomLabel
  terminal = $terminal
  terminalProbe = $terminalProbe
  terminalPaging = $terminalPaging
  terminalAssetIsolation = $terminalAssetIsolation
  taskTree = $taskTree
  cleanup = $cleanup
  runtimeErrors = @($script:runtimeErrors)
  passed = $passed
}
$reportJson = $report | ConvertTo-Json -Depth 20
Set-Content -Path (Join-Path $artifactDir 'hexestra-smoke.json') -Value $reportJson -Encoding utf8
Write-Output $reportJson

$closeCts = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(3))
$socket.CloseAsync(
  [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
  'Smoke test complete',
  $closeCts.Token
).GetAwaiter().GetResult() | Out-Null

if (-not $passed) {
  exit 1
}
