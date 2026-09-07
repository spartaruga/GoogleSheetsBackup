import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import { temporary } from './helpers.mjs';
import { createAiZip } from '../engine.mjs';
const root = path.resolve(import.meta.dirname, '..');
const headers = { 'Content-Type': 'application/json', 'X-App-Request': 'GoogleWorkspaceBackup' };
async function start(t, directory, port = 0) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, GWB_DATA_DIR: directory, GWB_PORT: String(port), GWB_NO_BROWSER: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', b => { errors += b; });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let record;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(errors);
    try { record = JSON.parse(await fs.readFile(path.join(directory, 'instance.json'), 'utf8')); if (record.pid === child.pid) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.equal(record?.pid, child.pid, errors);
  const url = `http://127.0.0.1:${record.port}`;
  const call = (route, body, extra = {}) => fetch(url + route, body === undefined ? extra : { method: 'POST', headers, body: JSON.stringify(body), ...extra });
  return { child, record, url, call };
}
async function stop(app) {
  const closed = once(app.child, 'exit');
  assert.equal((await app.call('/api/shutdown', {})).status, 200);
  await closed;
}

test('port collision, strict local requests, serialization, duplicate launch and data preservation', async t => {
  const directory = await temporary(t);
  const occupier = http.createServer((req, res) => res.end('{}'));
  occupier.listen(0, '127.0.0.1'); await once(occupier, 'listening');
  t.after(() => occupier.close());
  const state = { version: 3, projects: [], history: [], outputDir: path.join(directory, 'backups'), options: { zip: true }, sentinel: 'keep' };
  await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(state));
  const app = await start(t, directory, occupier.address().port);
  assert.notEqual(app.record.port, occupier.address().port);
  assert.equal((await app.call('/api/health')).status, 200);
  assert.equal((await app.call('/api/state', undefined, { headers: { Origin: 'https://example.invalid' } })).status, 403);
  const hostileHostStatus = await new Promise(resolve => {
    http.get(app.url + '/api/state', { headers: { Host: `127.0.0.1:${app.record.port}.example.invalid` } }, res => { res.resume(); resolve(res.statusCode); });
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await app.call('/api/state', {}, { headers: { 'Content-Type': 'application/json' } })).status, 403);
  assert.equal((await app.call('/api/state', undefined, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const hold = http.request(app.url + '/api/state', { method: 'POST', headers: { ...headers, 'Content-Length': 10000 } });
  hold.on('error', () => {}); hold.write('{');
  t.after(() => hold.destroy());
  for (let i = 0; i < 50; i++) { if ((await (await app.call('/api/health')).json()).busy) break; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal((await app.call('/api/shutdown', {})).status, 409);
  assert.equal((await app.call('/api/state', state)).status, 409);
  hold.destroy();
  for (let i = 0; i < 50; i++) { if (!(await (await app.call('/api/health')).json()).busy) break; await new Promise(resolve => setTimeout(resolve, 10)); }
  const duplicate = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, GWB_DATA_DIR: directory, GWB_PORT: '0', GWB_NO_BROWSER: '1' }, stdio: 'ignore' });
  assert.equal((await once(duplicate, 'exit'))[0], 0);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'instance.json'))).pid, app.child.pid);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'state.json'))), state);
  await stop(app);
  const next = await start(t, directory);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'state.json'))), state);
  await stop(next);
});

test('AI preview/apply respects protected files, hash and original backup', async t => {
  const directory = await temporary(t);
  const baseline = path.join(directory, 'backups', 'Demo', 'baseline');
  await fs.mkdir(path.join(baseline, 'apps-script'), { recursive: true });
  for (const [name, content] of Object.entries({ 'Code.gs': '// original', 'Config.gs': '// protected', 'appsscript.json': '{}' })) await fs.writeFile(path.join(baseline, 'apps-script', name), content);
  const project = { id: 'demo', name: 'Demo', scriptId: '1234567890'.repeat(2), protectedFiles: ['apps-script/Config.gs'] };
  const exported = await createAiZip({ sourceDirectory: baseline, project, policies: {}, protectedFiles: project.protectedFiles, zipPath: path.join(directory, 'ai.zip'), backupId: 'baseline' });
  const files = [];
  for (const name of ['Code.gs', 'Config.gs', 'appsscript.json']) files.push({ path: `apps-script/${name}`, sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(baseline, 'apps-script', name))).digest('hex') });
  await fs.writeFile(path.join(baseline, 'ai-export-manifest.local.json'), JSON.stringify({ aiManifest: exported.manifest, originalFiles: files }));
  await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify({ projects: [project], history: [{ id: 'backup', type: 'backup', projectId: 'demo', directory: baseline }] }));
  const app = await start(t, directory);
  const payload = { formatVersion: '1.0', project, sourceBackupId: 'baseline', summary: 'Demo change', operations: [
    { action: 'replace', path: 'apps-script/Code.gs', baseSha256: files[0].sha256, content: '// updated' },
    { action: 'replace', path: 'apps-script/Config.gs', baseSha256: files[1].sha256, content: '// unwanted' },
  ] };
  const preview = await (await app.call('/api/ai/inspect', payload)).json();
  assert.equal(preview.readyCount, 1); assert.equal(preview.protectedCount, 1);
  const applied = await (await app.call('/api/ai/apply', { packageId: preview.id })).json();
  assert.equal(applied.appliedCount, 1); assert.equal(applied.skippedProtectedCount, 1);
  assert.equal(await fs.readFile(path.join(applied.directory, 'apps-script/Code.gs'), 'utf8'), '// updated');
  assert.equal(await fs.readFile(path.join(applied.directory, 'apps-script/Config.gs'), 'utf8'), '// protected');
  assert.equal(await fs.readFile(path.join(baseline, 'apps-script/Code.gs'), 'utf8'), '// original');
  payload.operations[0].baseSha256 = '0'.repeat(64);
  const bad = await (await app.call('/api/ai/inspect', payload)).json();
  assert.equal(bad.conflictCount, 1);
  assert.equal((await app.call('/api/ai/apply', { packageId: bad.id })).status, 400);
  await stop(app);
});

test('corrupt configuration is preserved and startup fails', async t => {
  const directory = await temporary(t);
  await fs.writeFile(path.join(directory, 'state.json'), '{broken');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, GWB_DATA_DIR: directory, GWB_PORT: '0', GWB_NO_BROWSER: '1' }, stdio: 'ignore' });
  assert.notEqual((await once(child, 'exit'))[0], 0);
  assert.equal(await fs.readFile(path.join(directory, 'state.json'), 'utf8'), '{broken');
});

test('pending OAuth exposes a fallback link and disconnect cancels and cleans it', async t => {
  const directory = await temporary(t);
  await fs.writeFile(path.join(directory, 'credentials.json'), JSON.stringify({
    installed: { client_id: 'demo', client_secret: 'demo', project_id: 'demo' },
  }));
  const app = await start(t, directory);
  const login = app.call('/api/auth', { mode: 'backup' });
  let state;
  for (let i = 0; i < 100; i++) {
    state = await (await app.call('/api/state')).json();
    if (state.authUrl) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(state.authInProgress, true);
  assert.equal(state.authCancelable, true);
  assert.match(state.authUrl, /^https:\/\/accounts\.google\.com\//);
  const disconnected = await app.call('/api/auth', undefined, { method: 'DELETE', headers, body: '{}' });
  assert.equal(disconnected.status, 200);
  assert.equal((await login).status, 400);
  state = await (await app.call('/api/state')).json();
  assert.equal(state.authInProgress, false);
  assert.equal(state.authCancelable, false);
  assert.equal(state.authUrl, null);
  await assert.rejects(fs.access(path.join(directory, 'token.json')));
  await assert.rejects(fs.access(path.join(directory, 'token.json.tmp')));
  await stop(app);
});
