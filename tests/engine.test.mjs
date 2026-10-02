import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { google } from 'googleapis';
import { backupProjects, createAiZip, publishAppsScriptProject, getSpreadsheetSnapshot, rehydrateRedactions, redactSecrets, normalizeAiPath, SCOPES, PUBLISH_SCOPES, runSelfTest } from '../engine.mjs';
import { temporary, readZip } from './helpers.mjs';
import { collectBackupExtras } from '../diagnostics.mjs';

const fakeKey = ['AI', 'za', '1234567890'.repeat(3), '12345'].join('');
const id = '1234567890'.repeat(2);
const source = `const API_KEY = '${fakeKey}';`;
const initial = { files: [
  { name: 'Code', type: 'SERVER_JS', source },
  { name: 'Config', type: 'SERVER_JS', source: 'const privateSetting = 123;' },
  { name: 'appsscript', type: 'JSON', source: '{}' },
] };
const snapshot = { spreadsheetId: id, sheets: [{ properties: { title: 'Demo', sheetId: 0, gridProperties: { rowCount: 4, columnCount: 4 } }, data: [{ startRow: 1, startColumn: 2, rowData: [{ values: [{ userEnteredValue: { formulaValue: '=ARRAYFORMULA(A1:A3)' }, userEnteredFormat: { backgroundColor: { red: 1 } }, note: 'Nota demo' }] }] }] }] };
async function mockGoogle(t) {
  const directory = await temporary(t);
  const credentialsPath = path.join(directory, 'credentials.json');
  const tokenPath = path.join(directory, 'token.json');
  await fs.writeFile(credentialsPath, JSON.stringify({ installed: { client_id: 'demo', client_secret: 'demo' } }));
  // DPAPI is tested separately on Windows. No real Google token exists.
  await fs.writeFile(tokenPath, JSON.stringify({ type: 'authorized_user' }));
  if (process.platform === 'win32') {
    const { execFileSync } = await import('node:child_process');
    const encrypted = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))"], { input: JSON.stringify({ type: 'authorized_user' }), encoding: 'utf8' }).trim();
    await fs.writeFile(tokenPath, JSON.stringify({ format: 'gwb-dpapi-v1', data: encrypted }));
  }
  let live = structuredClone(initial);
  let updates = 0;
  t.mock.method(google.auth, 'fromJSON', () => ({}));
  t.mock.method(google, 'drive', () => ({ files: {
    get: async () => ({ data: { mimeType: 'application/vnd.google-apps.spreadsheet', name: 'Demo' } }),
    export: async () => ({ data: Buffer.from('fake-xlsx-api-bytes') }),
  }, comments: { list: async ({ pageToken }) => ({ data: pageToken ? { comments: [{ id: 'b', content: 'Secondo' }] } : { nextPageToken: 'next', comments: [{ id: 'a', content: 'Commento', replies: [{ content: 'Risposta' }] }] } }) } }));
  t.mock.method(google, 'sheets', () => ({ spreadsheets: { get: async () => ({ data: structuredClone(snapshot) }) } }));
  t.mock.method(google, 'script', () => ({ projects: {
    get: async () => ({ data: { parentId: id, title: 'Demo' } }),
    getContent: async () => ({ data: structuredClone(live) }),
    updateContent: async ({ requestBody }) => { updates++; live = structuredClone(requestBody); return { data: live }; },
  } }));
  return { directory, credentialsPath, tokenPath, setLive(value) { live = value; }, get updates() { return updates; } };
}

test('existing self-test, read-only scopes and hostile AI paths', () => {
  assert.equal(runSelfTest(), 'SELF-TEST OK');
  assert(SCOPES.every(scope => scope.endsWith('.readonly')));
  assert(PUBLISH_SCOPES.includes('https://www.googleapis.com/auth/script.projects'));
  for (const invalid of ['apps-script/Code.gs:secret.gs', 'apps-script/CON.gs', 'apps-script/../Code.gs', 'apps-script/_content-api.json']) assert.throws(() => normalizeAiPath(invalid));
  const masked = redactSecrets(source).text;
  assert.throws(() => rehydrateRedactions(source, masked + masked));
  assert.throws(() => rehydrateRedactions(source, 'no placeholder'));
});

test('backup, formulas, formatting, notes, paginated comments, ZIP, protected publication and live conflicts', async t => {
  const mock = await mockGoogle(t);
  const project = { id: 'demo', name: 'Demo', spreadsheet: id, scriptId: id, protectedFiles: ['apps-script/Config.gs'] };
  const result = await backupProjects({ ...mock, projects: [project], outputDir: path.join(mock.directory, 'output'), filePolicies: { demo: {
    'apps-script/Code.gs': { action: 'redact', sourceSha256: crypto.createHash('sha256').update(source).digest('hex') },
    'apps-script/Config.gs': { action: 'exclude', protected: true, sourceSha256: crypto.createHash('sha256').update(initial.files[1].source).digest('hex') },
    'apps-script/appsscript.json': { action: 'include', sourceSha256: crypto.createHash('sha256').update('{}').digest('hex') },
  } } });
  assert.equal(result.failed, 0);
  const backup = result.results[0];
  const formulas = JSON.parse(await fs.readFile(path.join(backup.directory, 'formulas.json')));
  assert.equal(formulas[0].cell, 'C2'); assert.equal(formulas[0].formula, '=ARRAYFORMULA(A1:A3)');
  const full = JSON.parse(await fs.readFile(path.join(backup.directory, 'spreadsheet.full.json')));
  assert.deepEqual(full, snapshot);
  const notes = JSON.parse(await fs.readFile(path.join(backup.directory, 'notes.json')));
  assert.equal(notes[0].note, 'Nota demo');
  const comments = JSON.parse(await fs.readFile(path.join(backup.directory, 'comments.json')));
  assert.equal(comments.comments.length, 2); assert.equal(comments.comments[0].replies.length, 1);
  const zip = await readZip(backup.zipPath);
  assert(!zip.has('apps-script/_content-api.json')); assert(!zip.has('apps-script/Config.gs'));
  assert(!zip.get('apps-script/Code.gs').toString().includes(fakeKey));
  assert.equal(await fs.readFile(path.join(backup.directory, 'apps-script/Code.gs'), 'utf8'), source);
  for (const name of ['ISTRUZIONI_PER_AI.md', 'ai-package-manifest.json', 'ai-change-schema.json']) assert(zip.has(name));
  const desired = path.join(mock.directory, 'modified');
  await fs.cp(backup.directory, desired, { recursive: true });
  await fs.unlink(path.join(desired, 'apps-script/Config.gs'));
  await fs.writeFile(path.join(desired, 'apps-script/Code.gs'), source + '\n// edited');
  const args = { ...mock, project, sourceDirectory: desired, baselineDirectory: backup.directory };
  await publishAppsScriptProject(args); assert.equal(mock.updates, 1);
  await publishAppsScriptProject(args); assert.equal(mock.updates, 1, 'retry does not write twice');
  await fs.writeFile(path.join(desired, 'apps-script/Config.gs'), 'changed');
  await assert.rejects(publishAppsScriptProject(args), /protetto/);
  await fs.unlink(path.join(desired, 'apps-script/Config.gs'));
  mock.setLive({ files: [...initial.files, { name: 'External', type: 'SERVER_JS', source: '// external' }] });
  await assert.rejects(publishAppsScriptProject(args), /Pubblicazione bloccata/);
  assert.equal(mock.updates, 1);
});

test('optional execution and trigger files share the normal ZIP and reuse saved IDs independently', async t => {
  const mock=await mockGoogle(t),queries=[];
  t.mock.method(google,'script',()=>({projects:{get:async()=>({data:{title:'Demo'}}),getContent:async()=>({data:structuredClone(initial)})},processes:{listScriptProcesses:async query=>{queries.push(query);return {data:{processes:[{functionName:'sync',processStatus:'TIMED_OUT',duration:'360s'}]}};}}}));
  let logQueries=0;
  t.mock.method(google,'logging',()=>({entries:{list:async query=>{logQueries++;assert.deepEqual(query.requestBody.resourceNames,['projects/demo-cloud']);assert(query.requestBody.filter.includes(id));return {data:{entries:[{jsonPayload:{message:'Exception: demo '+fakeKey}}]}};}}}));
  const project={id:'demo',name:'Demo',scriptId:id,diagnosticSettings:{cloudProjectId:'demo-cloud',cloudScriptKey:id,includeLogs:true},triggerInventory:{scriptId:id,exportedAt:'2026-10-01T20:00:00Z',triggers:[{id:'clock-1',handler:'sync',eventType:'CLOCK'}]}};
  for(const flags of [{},{includeExecutions:true},{includeTriggers:true},{includeExecutions:true,includeTriggers:true}]) {
    const result=await backupProjects({...mock,projects:[project],outputDir:path.join(mock.directory,'output'),options:{...flags,executionDays:30},collectExtras:collectBackupExtras});
    assert.equal(result.failed,0);const zip=await readZip(result.results[0].zipPath);
    assert.equal(zip.has('diagnostics/esecuzioni.json'),flags.includeExecutions===true);
    assert.equal(zip.has('diagnostics/esecuzioni.csv'),flags.includeExecutions===true);
    assert.equal(zip.has('diagnostics/triggers.json'),flags.includeTriggers===true);
    if(flags.includeExecutions){const report=JSON.parse(zip.get('diagnostics/esecuzioni.json'));assert.equal(report.project.scriptId,id);assert.equal(report.cloudLogs.items.length,1);assert.equal(report.summary[0].timedOut,1);assert.equal(Date.parse(report.range.endTime)-Date.parse(report.range.startTime),30*86400000);assert(!zip.get('diagnostics/esecuzioni.json').toString().includes(fakeKey));assert((await fs.readFile(path.join(result.results[0].directory,'diagnostics/esecuzioni.json'),'utf8')).includes(fakeKey));}
    if(flags.includeTriggers){const inventory=JSON.parse(zip.get('diagnostics/triggers.json'));assert.equal(inventory.status,'saved_snapshot');assert.equal(inventory.live,false);assert.equal(inventory.triggers[0].id,'clock-1');assert.equal(inventory.exportedAt,'2026-10-01T20:00:00.000Z');}
    assert(!zip.has('credentials.json'));assert(!zip.has('token.json'));
  }
  assert.equal(queries.length,2);assert(queries.every(query=>query.scriptId===id));assert.equal(logQueries,2);
});

test('unavailable optional diagnostics do not discard a successful backup or pretend triggers were read',async t=>{
  const mock=await mockGoogle(t);
  t.mock.method(google,'script',()=>({projects:{get:async()=>({data:{title:'Demo'}}),getContent:async()=>({data:structuredClone(initial)})},processes:{listScriptProcesses:async()=>{throw new Error('insufficient scope');}}}));
  const result=await backupProjects({...mock,projects:[{id:'demo',name:'Demo',scriptId:id}],outputDir:path.join(mock.directory,'output'),options:{includeExecutions:true,includeTriggers:true},collectExtras:collectBackupExtras});
  assert.equal(result.succeeded,1);assert.equal(result.failed,0);
  const zip=await readZip(result.results[0].zipPath);
  assert.equal(JSON.parse(zip.get('diagnostics/esecuzioni.json')).status,'unavailable');
  assert.equal(JSON.parse(zip.get('diagnostics/triggers.json')).status,'unavailable');
  assert(result.results[0].info.warnings.some(w=>w.includes('Abilita diagnostica')));
  assert(zip.has('apps-script/Code.gs'));
});

test('changed script after privacy review fails; spreadsheet exclusion removes data', async t => {
  const directory = await temporary(t);
  const sourceDirectory = path.join(directory, 'source');
  await fs.mkdir(path.join(sourceDirectory, 'apps-script'), { recursive: true });
  await fs.writeFile(path.join(sourceDirectory, 'apps-script/Code.gs'), source);
  await fs.writeFile(path.join(sourceDirectory, 'notes.json'), '["private note"]');
  const args = { sourceDirectory, project: { id: 'demo', name: 'Demo' }, protectedFiles: [], zipPath: path.join(directory, 'test.zip'), backupId: 'demo' };
  await assert.rejects(createAiZip({ ...args, policies: { 'apps-script/Code.gs': { action: 'include', sourceSha256: '0'.repeat(64) } } }), /cambiato/);
  await fs.writeFile(path.join(sourceDirectory, 'apps-script/New.gs'), '// newly added');
  await assert.rejects(createAiZip({ ...args, policies: { 'apps-script/Code.gs': { action: 'include', sourceSha256: crypto.createHash('sha256').update(source).digest('hex') } } }), /elenco.*cambiato/);
  await fs.unlink(path.join(sourceDirectory, 'apps-script/New.gs'));
  await createAiZip({ ...args, policies: { 'notes.json': { action: 'exclude' }, 'apps-script/Code.gs': { action: 'redact' } } });
  assert(!(await readZip(args.zipPath)).has('notes.json'));
});

test('chunked large sheet preserves grid offsets and metadata', async () => {
  const calls = [];
  const sheets = { spreadsheets: { get: async args => {
    calls.push(args);
    if (!args.includeGridData) return { data: { sheets: [{ properties: { sheetId: 1, title: "O'Brien", gridProperties: { rowCount: 10001, columnCount: 201 } }, merges: [{ startRowIndex: 0 }] }] } };
    return { data: { sheets: [{ properties: { sheetId: 1 }, data: [{ startRow: (calls.length - 2) * 5000, rowData: [] }] }] } };
  } } };
  const result = await getSpreadsheetSnapshot(sheets, id);
  assert.equal(result.sheets[0].data.length, 3);
  assert.equal(result.sheets[0].data[2].startRow, 10000);
  assert.equal(calls[1].ranges[0], "'O''Brien'!1:5000");
  assert.equal(result.sheets[0].merges.length, 1);
});

test('cancellation removes incomplete project and ZIP', async t => {
  const mock = await mockGoogle(t);
  let cancelled = false;
  const outputDir = path.join(mock.directory, 'output');
  const result = await backupProjects({ ...mock, outputDir, projects: [{ id: 'demo', name: 'Demo', scriptId: id }], shouldCancel: () => cancelled, onEvent: e => { if (e.progress >= 84) cancelled = true; } });
  assert(result.cancelled); assert.equal(result.succeeded, 0);
  assert.deepEqual(await fs.readdir(outputDir), []);
});
