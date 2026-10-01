import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { authorizationScopes, SCOPES, PUBLISH_SCOPES, DIAGNOSTIC_SCOPES } from '../engine.mjs';
import { collectPages, collectDiagnostics, diagnosticRange, summarizeProcesses, csvProcesses, saveDiagnosticReport } from '../diagnostics.mjs';
import { temporary, readZip } from './helpers.mjs';
const id = '1234567890'.repeat(2);
const project = {id:'demo',name:'Demo',scriptId:id};

test('diagnostic consent remains optional and preserves previously granted publishing', () => {
  assert.deepEqual(authorizationScopes('backup', DIAGNOSTIC_SCOPES), SCOPES);
  const diagnostics = authorizationScopes('diagnostics', PUBLISH_SCOPES);
  assert(diagnostics.includes('https://www.googleapis.com/auth/script.processes'));
  assert(diagnostics.includes('https://www.googleapis.com/auth/script.projects'));
  assert(!diagnostics.includes('https://www.googleapis.com/auth/script.projects.readonly'));
  assert(authorizationScopes('publish', DIAGNOSTIC_SCOPES).includes('https://www.googleapis.com/auth/logging.read'));
  assert.throws(() => authorizationScopes('invalid'));
});
test('pagination handles empty pages and preserves the whole page behind its cursor', async () => {
  const tokens = [];
  const result = await collectPages(async token => {tokens.push(token);return {data:token?{rows:[1,2,3],nextPageToken:'more'}:{rows:[],nextPageToken:'next'}};}, 'rows', {maxItems:2});
  assert.deepEqual(tokens,[undefined,'next']);assert.deepEqual(result.items,[1,2,3]);assert(result.truncated);assert.equal(result.nextPageToken,'more');
});
test('repeated pagination cursors fail instead of looping forever', async () => {
  await assert.rejects(collectPages(async () => ({data:{nextPageToken:'same'}}),'rows'), /ripetuto/);
});
test('summary counts failures, quota delays and Rome day/night boundaries', () => {
  const rows = [
    {functionName:'sync',processStatus:'TIMED_OUT',duration:'360s',processType:'TIME_DRIVEN',startTime:'2026-10-01T07:00:00Z'},
    {functionName:'sync',processStatus:'FAILED',duration:'2.5s',processType:'TIME_DRIVEN',startTime:'2026-10-01T20:00:00Z'},
    {functionName:'sync',processStatus:'DELAYED',duration:'0s',processType:'TIME_DRIVEN',startTime:'2026-10-26T07:30:00Z'},
    {functionName:'manual',processStatus:'COMPLETED',duration:'1s',processType:'EDITOR',startTime:'2026-10-01T11:00:00Z'},
  ];
  const result = summarizeProcesses(rows);
  assert.equal(result[0].timedOut,1);assert.equal(result[0].failed,1);assert.equal(result[0].delayed,1);assert.equal(result[0].slow,1);assert.equal(result[0].automaticOutsideNight,2);assert.equal(result[1].automaticOutsideNight,0);
});
test('CSV output escapes formulas and retains quoted error fields', () => {
  const result = csvProcesses([{functionName:'=HYPERLINK("test")',processStatus:'FAILED'}]);
  assert(result.startsWith('\uFEFF'));assert(result.includes(`"'=HYPERLINK(""test"")"`));
});
test('execution export keeps Cloud errors and versions with API limits explicit', async () => {
  let query;
  const api = {processes:{listScriptProcesses:async params => {query=params;return {data:{processes:[{functionName:'sync',processStatus:'FAILED',duration:'3s'}]}};}},projects:{versions:{list:async()=>({data:{versions:[{versionNumber:1}]}})},deployments:{list:async()=>{throw new Error('permission denied');}}}};
  const loggingApi = {entries:{list:async () => ({data:{entries:[],nextPageToken:'next'}})}};
  const report = await collectDiagnostics({project,api,loggingApi,includeLogs:true,cloudProjectId:'demo-cloud',maxItems:1});
  assert.equal(query.scriptId,id);assert(query['scriptProcessFilter.startTime']);assert.equal(report.executions.items.length,1);assert.equal(report.versions.length,1);
  assert(report.warnings.some(w=>w.includes('permission denied')));assert(report.warnings.some(w=>w.includes('ripetuto')));assert(report.limitations.some(w=>w.includes('stack trace')));
});
test('permission failure identifies the missing diagnostic authorization', async () => {
  await assert.rejects(collectDiagnostics({project,api:{processes:{listScriptProcesses:async()=>{throw new Error('insufficient scope');}}}}), /Abilita diagnostica/);
});
test('ZIP includes native execution data, CSV, report and Cloud stack without personal credentials', async t => {
  const directory = await temporary(t);
  const report = await collectDiagnostics({project,api:{processes:{listScriptProcesses:async()=>({data:{processes:[]}})}}});
  report.cloudLogs={items:[{jsonPayload:{message:'Exception: demo\n at sync(Code:10)'}}],truncated:false};
  const saved=await saveDiagnosticReport(report,directory+'/new-output');
  const zip=await readZip(saved.zipPath);assert.deepEqual([...zip.keys()].sort(),['LEGGIMI.md','esecuzioni.csv','esecuzioni.json']);
  assert(zip.get('esecuzioni.json').toString().includes('sync(Code:10)'));assert(!zip.has('token.json'));
  assert.equal(JSON.parse(await fs.readFile(saved.directory+'/esecuzioni.json')).formatVersion,'1.0');
});
test('diagnostic ranges reject malformed and excessive queries', () => {
  assert.throws(()=>diagnosticRange({days:365}));assert.throws(()=>diagnosticRange({startTime:'bad'}));
  assert.throws(()=>diagnosticRange({startTime:'2026-01-01',endTime:'2026-10-01'}));
});
