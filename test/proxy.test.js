import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const uri = 'ui://vidwords/watch-view.html';
const data = { analysisId: 205, status: 'ready', title: 'Saved analysis', analysis: { overview: 'Full overview', chapters: [], evidence: [] } };
const result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, _meta: { fixture: 'preserved' } };
const resource = { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: '<div>Full analysis</div>', _meta: { ui: { csp: { resourceDomains: ['https://vidwords.com'] } } } }] };
async function proxy(env = {}) {
  const client = new Client({ name: 'proxy-test', version: '1' });
  const image = process.env.PROXY_TEST_DOCKER_IMAGE;
  const command = image ? 'docker' : process.execPath;
  const args = image
    ? ['run', '--rm', '-i', '--network', 'host', ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]), image]
    : ['src/index.js'];
  const transport = new StdioClientTransport({ command, args, env: { PATH: process.env.PATH, ...env }, stderr: 'pipe' });
  await client.connect(transport);
  return client;
}

test('offline discovery exposes thirteen tools and UI resources without a token', async () => {
  const client = await proxy({ VIDWORDS_MCP_URL: 'http://127.0.0.1:1/mcp' });
  try {
    assert.equal(client.getServerVersion().version, '1.2.0');
    assert.ok(client.getServerCapabilities().resources);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 13);
    assert.ok(tools.some(t => t.name === 'list_analyses'));
    const analysis = tools.find(t => t.name === 'get_analysis');
    assert.ok(!analysis.inputSchema.required?.includes('analysisId'));
    assert.equal(analysis._meta.ui.resourceUri, uri);
    const { resources } = await client.listResources();
    assert.deepEqual(resources.map(r => r.uri), [uri, 'ui://vidwords/account-view.html']);
    assert.ok(resources.every(r => r.mimeType === 'text/html;profile=mcp-app'));
    const missing = await client.callTool({ name: 'get_analysis', arguments: {} });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /VIDWORDS_API_TOKEN is not set/);
    await assert.rejects(client.readResource({ uri }), /VIDWORDS_API_TOKEN is not set/);
  } finally { await client.close(); }
});

test('stdio forwards latest-analysis calls, complete structured results and UI resources over authenticated HTTP', async () => {
  const calls = [];
  const errors = [];
  const sessions = new Set();
  const upstream = http.createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Basic test-only-key');
      const server = new Server({ name: 'upstream-test', version: '1' }, { capabilities: { tools: {}, resources: {} } });
      server.setRequestHandler(CallToolRequestSchema, async request => {
        calls.push(request.params);
        return result;
      });
      server.setRequestHandler(ReadResourceRequestSchema, async request => {
        assert.equal(request.params.uri, uri);
        return resource;
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      sessions.add(server);
      res.on('close', () => { server.close(); sessions.delete(server); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) { errors.push(e); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const client = await proxy({ VIDWORDS_API_TOKEN: 'test-only-key', VIDWORDS_MCP_URL: `http://127.0.0.1:${upstream.address().port}/mcp` });
  try {
    assert.deepEqual(await client.callTool({ name: 'get_analysis', arguments: {} }), result);
    assert.deepEqual(calls[0], { name: 'get_analysis', arguments: {} });
    assert.deepEqual(await client.readResource({ uri }), resource);
    await client.callTool({ name: 'list_analyses', arguments: { limit: 3, before: 205, video: 'nBQZKR2NBgk' } });
    assert.deepEqual(calls[1].arguments, { limit: 3, before: 205, video: 'nBQZKR2NBgk' });
    assert.deepEqual(errors, []);
  } finally {
    await client.close();
    for (const server of sessions) await server.close();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
});

test('release manifests agree with the packaged tool catalog and version', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = async file => JSON.parse(await readFile(file, 'utf8'));
  const pkg = await read('package.json');
  const lock = await read('package-lock.json');
  const registry = await read('server.json');
  const manifest = await read('lhm.plugin.json');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(registry.version, pkg.version);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.cloudEndpoint, 'https://vidwords.com/mcp');
  const client = await proxy();
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(manifest.tools.map(t => t.name), tools.map(t => t.name));
    assert.equal(tools.find(t => t.name === 'account')._meta.ui.resourceUri, 'ui://vidwords/account-view.html');
  } finally { await client.close(); }
});
