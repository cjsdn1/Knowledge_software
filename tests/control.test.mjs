import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createApp } from '../server.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));

test('PC controls gate phone access and isolate admin routes from Tailscale proxy', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'study-control-test-'));
  const actions = [];
  let stopped = false;
  const app = createApp({
    directory,
    config: { ACCESS_TOKEN: 'pc-admin-secret-123456789', CONTROL_ENABLED: 'true' },
    tailnetAction: async action => { actions.push(action); await pause(30); return action === 'on' ? { url: 'https://study.example.ts.net' } : { off: true }; },
    onStop: () => { stopped = true; },
  });
  await Promise.all([listen(app.server), listen(app.remoteServer)]);
  t.after(async () => {
    await Promise.all([close(app.server), close(app.remoteServer)]);
    await app.closeJobs(); app.store.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.includes('study-control-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const local = `http://127.0.0.1:${app.server.address().port}`;
  const remote = `http://127.0.0.1:${app.remoteServer.address().port}`;
  const token = 'pc-admin-secret-123456789';
  const call = async (base, path, body, headerToken) => {
    const response = await fetch(base + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(headerToken ? { 'X-Access-Token': headerToken } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const waitTask = async status => {
    for (let i = 0; i < 30; i++) {
      const result = await call(local, '/control', undefined, token);
      if (result.data.task.status === status) return result.data;
      await pause(20);
    }
    assert.fail(`Tailscale task did not reach ${status}`);
  };

  assert.equal((await call(local, '/launcher-status')).data.control, true);
  assert.equal((await call(local, '/control')).status, 401);
  assert.equal((await call(local, '/control', undefined, token)).status, 200);
  assert.equal((await call(remote, '/connection')).status, 503);

  const code = await call(local, '/pairing/code', {}, token);
  assert.equal(code.status, 201);
  assert.deepEqual(code.data.addresses, []);
  const paired = await call(local, '/pairing/claim', { code: code.data.code, name: 'test phone' });
  assert.equal(paired.status, 201);
  assert.equal((await call(local, '/bootstrap', undefined, paired.data.token)).status, 401);
  const deviceResponse = await fetch(local + '/api/bootstrap', { headers: { Authorization: `Bearer ${paired.data.token}` } });
  assert.equal(deviceResponse.status, 200);

  assert.equal((await call(local, '/control/mobile', { enabled: false }, token)).data.mobileEnabled, false);
  const denied = await fetch(local + '/api/bootstrap', { headers: { Authorization: `Bearer ${paired.data.token}` } });
  assert.equal(denied.status, 503);
  assert.equal((await call(local, '/control/tailnet', { enabled: true }, token)).status, 202);
  assert.equal((await waitTask('done')).tailnetUrl, 'https://study.example.ts.net');
  assert.equal((await call(remote, '/connection')).status, 503);
  assert.equal((await call(local, '/control/mobile', { enabled: true }, token)).data.mobileEnabled, true);
  assert.equal((await call(remote, '/connection')).status, 200);
  assert.equal((await call(remote, '/control', undefined, token)).status, 403);
  assert.equal((await call(remote, '/control/mobile', { enabled: false }, token)).status, 403);
  assert.equal((await call(local, '/control/tailnet', { enabled: false }, token)).status, 202);
  assert.equal((await waitTask('done')).remoteEnabled, false);
  assert.equal((await call(remote, '/connection')).status, 503);
  assert.deepEqual(actions, ['on', 'off']);
  assert.equal((await call(local, '/control/stop', {}, token)).status, 200);
  await pause(200);
  assert.equal(stopped, true);
});
