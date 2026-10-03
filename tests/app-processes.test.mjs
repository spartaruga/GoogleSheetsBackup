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

async function registeredProfile(t,pid=11) {
  const fs=await import('node:fs/promises'),path=await import('node:path'),{temporary}=await import('./helpers.mjs');
  const directory=await temporary(t);
  await fs.writeFile(path.join(directory,'instance.lock'),JSON.stringify({pid,id:'old-instance'}));
  await fs.writeFile(path.join(directory,'instance.json'),JSON.stringify({app:'GoogleWorkspaceBackup',pid,instanceId:'old-instance',port:12345}));
  await fs.writeFile(path.join(directory,'state.json'),'keep profile');return directory;
}
test('registered relative npm server closes through its verified handshake even when root discovery misses it',async t=>{
  const directory=await registeredProfile(t),relative={...server,command:'node.exe server.mjs',parent:0};
  const fake=adapter([relative]);fake.health=async()=>({app:'GoogleWorkspaceBackup',instanceId:'old-instance',busy:false});
  const report=await closeAppProcesses({adapter:fake,profileDirectory:directory,verifyRoot:async()=>false,waitMs:0});
  assert.equal(report.closed,1);assert.deepEqual(fake.requested,[11]);assert.equal(fake.stopped.length,0);
});
test('a registered busy instance cannot be forced if the second health request stops responding',async t=>{
  const directory=await registeredProfile(t),relative={...server,command:'node.exe server.mjs',parent:0};
  const fake=adapter([relative]);let calls=0;
  fake.health=async()=>{if(calls++)throw new Error('health now unavailable');return {app:'GoogleWorkspaceBackup',instanceId:'old-instance',busy:true};};
  const report=await closeAppProcesses({adapter:fake,profileDirectory:directory,verifyRoot:async()=>false,force:true,waitMs:0});
  assert(report.busy.includes(11));assert.equal(fake.requested.length,0);assert.equal(fake.stopped.length,0);
});
test('wrong handshake, different owner, reused port or protected PID never authorize registered shutdown',async t=>{
  const directory=await registeredProfile(t),relative={...server,command:'node.exe server.mjs',parent:0};
  for(const mode of ['wrong-id','different-owner','wrong-port','protected']) {
    const row=mode==='different-owner'?{...relative,owner:'other'}:relative;
    const fake=adapter([row]);fake.health=async()=>({app:'GoogleWorkspaceBackup',instanceId:mode==='wrong-id'?'another-instance':'old-instance',busy:false});
    if(mode==='wrong-port')fake.ports=async()=>[54321];
    const report=await closeAppProcesses({adapter:fake,profileDirectory:directory,verifyRoot:async()=>false,protectPid:mode==='protected'?11:0,force:true,waitMs:0});
    assert.equal(report.count,0);assert.equal(fake.requested.length,0);assert.equal(fake.stopped.length,0);
  }
});
test('proven PID reuse archives the matching lock and record and preserves credentials and state',async t=>{
  const fs=await import('node:fs/promises'),path=await import('node:path'),{verifyProfileLock}=await import('../app-processes.mjs');
  const directory=await registeredProfile(t,44),lock=await fs.readFile(path.join(directory,'instance.lock'),'utf8');
  await fs.writeFile(path.join(directory,'credentials.json'),'keep credentials');
  const fake={processInfo:async()=>({pid:44,name:'unrelated.exe',created:new Date(Date.now()+5000).toISOString()})};
  const report=await verifyProfileLock(directory,{recoverStale:true,adapter:fake,isAlive:async()=>true});
  assert.equal(report.staleLockArchived,true);
  const archive=(await fs.readdir(directory)).find(name=>name.startsWith('instance.lock.stale-'));
  assert.equal(await fs.readFile(path.join(directory,archive),'utf8'),lock);
  assert.equal(await fs.readFile(path.join(directory,'state.json'),'utf8'),'keep profile');
  assert.equal(await fs.readFile(path.join(directory,'credentials.json'),'utf8'),'keep credentials');
  const recordArchive=(await fs.readdir(directory)).find(name=>name.startsWith('instance.json.stale-'));
  assert.equal(JSON.parse(await fs.readFile(path.join(directory,recordArchive),'utf8')).instanceId,'old-instance');
});
test('an old live process, unreadable process identity or lock changed during recovery blocks archive',async t=>{
  const fs=await import('node:fs/promises'),path=await import('node:path'),{verifyProfileLock}=await import('../app-processes.mjs');
  for(const mode of ['old-process','unknown','changed-lock','mismatch-record']) {
    const directory=await registeredProfile(t,44),file=path.join(directory,'instance.lock');
    const fake={processInfo:async()=>{if(mode==='changed-lock')await fs.writeFile(file,JSON.stringify({pid:45,id:'new-owner'}));if(mode==='mismatch-record')await fs.writeFile(path.join(directory,'instance.json'),JSON.stringify({pid:45,instanceId:'new-owner'}));return mode==='unknown'?null:{pid:44,name:'node.exe',created:new Date(mode==='old-process'?Date.now()-5000:Date.now()+5000).toISOString()};}};
    await assert.rejects(verifyProfileLock(directory,{recoverStale:true,adapter:fake,isAlive:async()=>true}),/bloccato|cambiato|non coincide/);
    assert(await fs.readFile(file,'utf8'));assert(!(await fs.readdir(directory)).some(name=>name.includes('.stale-')));
  }
});
