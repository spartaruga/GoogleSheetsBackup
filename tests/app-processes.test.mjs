import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProcesses,windowsArgs,closeAppProcesses} from '../app-processes.mjs';
const base={owner:'owner',session:1,created:'2026-10-03T00:00:00.000Z',parent:0};
const root='C:\\Apps\\GWB';
const p=(pid,name,executable,command,extra={})=>({...base,pid,name,executable,command,...extra});
const server=p(11,'node.exe','C:\\node.exe','"C:\\node.exe" "C:\\Apps\\GWB\\app\\server.mjs"',{parent:10});
const launcher=p(10,'cmd.exe','C:\\Windows\\cmd.exe','cmd /c start-node',{created:'2026-10-02T00:00:00.000Z'});
const verifyRoot=async value=>value.toLowerCase()===root.toLowerCase();
function adapter(rows,{busy=false,reachable=true,reuse=false}={}) {
  let processes=[...rows];const stopped=[],requested=[];
  return {stopped,requested,snapshot:async()=>({owner:'owner',session:1,processes}),ports:async()=>[12345],health:async()=>{if(!reachable)throw new Error('hung');return {app:'GoogleWorkspaceBackup',busy};},shutdown:async()=>{requested.push(11);processes=processes.filter(p=>p.pid!==11);if(reuse)processes.push({...server,created:'2026-10-03T01:00:00.000Z',command:'node unrelated.mjs'});return 200;},stop:async p=>{stopped.push(p.pid);processes=processes.filter(row=>row.pid!==p.pid);},sleep:async()=>{}};
}
test('Windows argument parser handles spaces and escaped quotes',()=>{
  assert.deepEqual(windowsArgs('"C:\\Program Files\\node.exe" "C:\\Apps\\GWB\\app\\server.mjs"'),['C:\\Program Files\\node.exe','C:\\Apps\\GWB\\app\\server.mjs']);
});
test('only verified app roots of the same owner/session and safe ancestors are selected',async()=>{
  const rows=[server,launcher,p(20,'node.exe','C:\\node.exe','node C:\\Other\\server.mjs'),{...server,pid:21,owner:'other'},{...server,pid:22,session:2},p(23,'chrome.exe','chrome','chrome')];
  assert.deepEqual((await classifyProcesses({owner:'owner',session:1,processes:rows},{verifyRoot})).map(p=>p.pid).sort(),[10,11]);
  assert.equal((await classifyProcesses({owner:'owner',session:1,processes:rows},{verifyRoot,protectPid:11})).length,0);
});
test('busy servers prevent every termination even when force is requested',async()=>{
  const fake=adapter([server,launcher],{busy:true});const result=await closeAppProcesses({adapter:fake,verifyRoot,force:true,waitMs:0});assert.deepEqual(result.busy,[11]);assert.equal(fake.stopped.length,0);assert.equal(fake.requested.length,0);
});
test('responsive old servers shut down and leftover launcher is removed',async()=>{
  const fake=adapter([server,launcher]);const result=await closeAppProcesses({adapter:fake,verifyRoot,waitMs:0});assert.equal(result.closed,2);assert.deepEqual(fake.requested,[11]);assert.deepEqual(fake.stopped,[10]);
});
test('unresponsive servers require explicit force; unrelated programs survive',async()=>{
  const unrelated=p(99,'node.exe','C:\\node.exe','node C:\\other.mjs');const fake=adapter([server,launcher,unrelated],{reachable:false});
  const first=await closeAppProcesses({adapter:fake,verifyRoot,waitMs:0});assert.deepEqual(first.needsForce,[11]);assert.equal(fake.stopped.length,0);
  const second=await closeAppProcesses({adapter:fake,verifyRoot,force:true,waitMs:0});assert.equal(second.closed,2);assert(!fake.stopped.includes(99));
});
test('a reused PID is never terminated after graceful shutdown',async()=>{
  const fake=adapter([server,launcher],{reuse:true});await closeAppProcesses({adapter:fake,verifyRoot,force:true,waitMs:0});assert.deepEqual(fake.stopped,[10]);
});

test('an orphaned cmd of the exact old launcher is recognized without a Node child',async()=>{
  const orphan=p(30,'cmd.exe','C:\\Windows\\cmd.exe','C:\\Windows\\cmd.exe /d /s /c ""C:\\Apps\\GWB\\runtime\\node.exe" "C:\\Apps\\GWB\\app\\server.mjs" 1>"C:\\logs\\server.log" 2>"C:\\logs\\error.log""');
  const generic=p(31,'cmd.exe','C:\\Windows\\cmd.exe','cmd /c echo C:\\Apps\\GWB\\app\\server.mjs');
  const rows=await classifyProcesses({owner:'owner',session:1,processes:[orphan,generic]},{verifyRoot});
  assert.deepEqual(rows.map(p=>p.pid),[30]);
  const fake=adapter([orphan,generic]);const result=await closeAppProcesses({adapter:fake,verifyRoot,waitMs:0});assert.equal(result.closed,1);assert.deepEqual(fake.stopped,[30]);
});

test('a foreign live lock and a corrupt lock never authorize termination or deletion',async t=>{
  const fs=await import('node:fs/promises'),path=await import('node:path');
  const {temporary}=await import('./helpers.mjs'),{verifyProfileLock}=await import('../app-processes.mjs');
  const directory=await temporary(t),file=path.join(directory,'instance.lock');
  await fs.writeFile(file,JSON.stringify({pid:process.pid,id:'foreign'}));
  await assert.rejects(verifyProfileLock(directory),/non verificabile/);
  await fs.writeFile(file,'{broken');await assert.rejects(verifyProfileLock(directory),/non leggibile/);assert.equal(await fs.readFile(file,'utf8'),'{broken');
  await fs.writeFile(file,JSON.stringify({pid:2147483647,id:'stale'}));await verifyProfileLock(directory);assert(await fs.readFile(file,'utf8'));
});
