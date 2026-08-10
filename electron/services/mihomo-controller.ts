import http from 'http';

export interface MihomoControllerTarget {
  controllerPort: number;
  secret: string;
}

export function parseMihomoVersion(output: string) {
  return /\b(?:mihomo|version)\b[^\r\n]{0,80}?\bv?(\d+\.\d+\.\d+)/i.exec(output)?.[1] ?? null;
}

export function requestMihomoController(
  runtime: MihomoControllerTarget,
  method: string,
  requestPath: string,
  body?: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const request = http.request({
      host: '127.0.0.1', port: runtime.controllerPort, path: requestPath, method,
      headers: { Authorization: `Bearer ${runtime.secret}`, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) },
      timeout: 5_000,
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > 2 * 1024 * 1024) {
          request.destroy(new Error('Mihomo controller response is too large'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`Mihomo controller ${response.statusCode ?? 'failed'}`));
        try { resolve(text ? JSON.parse(text) : null); } catch { resolve(text); }
      });
    });
    request.once('timeout', () => request.destroy(new Error('Mihomo controller timed out')));
    request.once('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}
