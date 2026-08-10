import http from 'http';
import net from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { getProjectEgressRoute, openProjectConnectTunnel, projectProxyEnvironment, publishProjectEgressRoute } from '@electron/services/project-egress';

const servers: Array<http.Server | net.Server> = [];
afterEach(() => servers.splice(0).forEach((server) => server.close()));

describe('project egress registry', () => {
  it('rejects stale route revisions and builds local/WSL proxy environments', () => {
    publishProjectEgressRoute({ mode: 'proxy', projectId: 'project-route', revision: 3, mixedPort: 43210 });
    publishProjectEgressRoute({ mode: 'direct', projectId: 'project-route', revision: 2 });
    expect(getProjectEgressRoute('project-route')).toMatchObject({ mode: 'proxy', mixedPort: 43210, revision: 3 });
    const env = projectProxyEnvironment('project-route', { NO_PROXY: 'internal.test', WSLENV: 'KEEP/u' });
    expect(env).toMatchObject({
      HTTP_PROXY: 'http://127.0.0.1:43210', HTTPS_PROXY: 'http://127.0.0.1:43210',
      ALL_PROXY: 'socks5h://127.0.0.1:43210',
    });
    expect(env.NO_PROXY).toContain('127.0.0.1');
    expect(env.WSLENV).toContain('HTTP_PROXY');
    expect(env.WSLENV).toContain('KEEP/u');
  });

  it('uses an unreachable loopback proxy environment while enforced routing is blocked', () => {
    publishProjectEgressRoute({ mode: 'blocked', projectId: 'project-blocked', revision: 1, error: 'runtime stopped' });
    expect(projectProxyEnvironment('project-blocked', {})).toMatchObject({ HTTP_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'socks5h://127.0.0.1:9' });
  });

  it('opens outer SSH/WebShell-style sockets through the project CONNECT route', async () => {
    const target = net.createServer((socket) => socket.pipe(socket));
    const targetPort = await listen(target);
    servers.push(target);
    let connectCount = 0;
    const proxy = http.createServer();
    proxy.on('connect', (request, client, head) => {
      connectCount += 1;
      const [host, port] = request.url!.split(':');
      const upstream = net.connect(Number(port), host, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream).pipe(client);
      });
    });
    const proxyPort = await listen(proxy);
    servers.push(proxy);
    publishProjectEgressRoute({ mode: 'proxy', projectId: 'project-connect', revision: 1, mixedPort: proxyPort });
    const socket = await openProjectConnectTunnel('project-connect', '127.0.0.1', targetPort);
    expect(socket).toBeDefined();
    const echoed = new Promise<string>((resolve) => socket!.once('data', (data) => resolve(data.toString('utf8'))));
    socket!.write('round-trip');
    expect(await echoed).toBe('round-trip');
    expect(connectCount).toBe(1);
    socket!.destroy();
  });
});

function listen(server: http.Server | net.Server) {
  return new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    resolve(typeof address === 'object' && address ? address.port : 0);
  }));
}
