import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createUpdatePackage} from '../scripts/update-package.mjs';
import {applyUpdate,validateUpdate,readUpdateZip,assertCompatible,ROOT_FILES,sha256,dependencyFingerprint,recoverUpdate} from '../app-updates.mjs';
import {decodePackage,checkUpdates} from '../updates.mjs';
import {temporary} from './helpers.mjs';
const root=path.resolve(import.meta.dirname,'..');
const built=await createUpdatePackage();
async function installed(t) {
  const directory=await temporary(t);
  await fs.mkdir(path.join(directory,'app/node_modules'),{recursive:true});
  const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json')));pkg.version='3.4.5';
  const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json')));lock.version=lock.packages[''].version='3.4.5';
  await fs.writeFile(path.join(directory,'app/package.json'),JSON.stringify(pkg));await fs.writeFile(path.join(directory,'app/package-lock.json'),JSON.stringify(lock));
  await fs.writeFile(path.join(directory,'app/server.mjs'),'old server');
  await fs.writeFile(path.join(directory,'app/node_modules/sentinel'),'dependencies');
  for(const file of ROOT_FILES)await fs.writeFile(path.join(directory,file),'old '+file);
  await fs.writeFile(path.join(directory,'private-profile'),'untouched');return directory;
}
test('package whitelist, manifest and immutable Git blob agree; tampering is refused',async()=>{
  const text=Buffer.from(JSON.stringify(built.envelope)+'\n');
  const channel={format:'gwb-update-channel-v1',version:built.manifest.version,sha256:built.hash,size:built.bytes.length,packageBlob:crypto.createHash('sha1').update(Buffer.from(`blob ${text.length}\0`)).update(text).digest('hex')};
  assert.deepEqual(decodePackage({encoding:'base64',content:text.toString('base64')},channel),built.bytes);
  assert.throws(()=>decodePackage({encoding:'base64',content:Buffer.from('{}').toString('base64')},channel),/Identità/);
  const corrupted=Buffer.from(built.bytes);corrupted[25]^=1;assert.throws(()=>validateUpdate(corrupted,built.hash),/Checksum/);
  const checked=validateUpdate(built.bytes,built.hash);assert(![...checked.entries.keys()].some(name=>name.includes('node_modules')||name.includes('state.json')));
  const result=await checkUpdates('3.4.5',async()=>({ok:true,json:async()=>channel}));assert(result.available);assert.equal(result.kind,'zip');
});
test('ZIP parser refuses path traversal, duplicate names and oversized central bounds',()=>{
  const entries=readUpdateZip(built.bytes);assert(entries.size>15);
  const bytes=Buffer.from(built.bytes);const end=bytes.length-22;bytes.writeUInt32LE(0xffffffff,end+16);assert.throws(()=>validateUpdate(bytes,sha256(bytes)),/Indice/);
  const traversal=Buffer.from(built.bytes);const name='app/package.json';let offset=0;
  while((offset=traversal.indexOf(name,offset))>=0){traversal.write('../package.jsonx',offset);offset+=name.length;}
  assert.throws(()=>validateUpdate(traversal,sha256(traversal)),/Percorso|File non consentito/);
});
test('update retains runtime/dependencies/profile and verifies startup before commit',async t=>{
  const directory=await installed(t);let checked=false;
  const result=await applyUpdate(directory,built.bytes,built.hash,{healthCheck:async version=>{checked=true;assert.equal(version,built.manifest.version);assert.equal(await fs.readFile(path.join(directory,'app/node_modules/sentinel'),'utf8'),'dependencies');}});
  assert(checked);assert.equal(result.previous,'3.4.5');assert.equal(JSON.parse(await fs.readFile(path.join(directory,'app/package.json'))).version,built.manifest.version);
  assert.equal(await fs.readFile(path.join(directory,'private-profile'),'utf8'),'untouched');assert.equal(await fs.readFile(path.join(directory,'.gwb-previous/old/app/server.mjs'),'utf8'),'old server');
});
test('failed startup automatically restores all old files and dependencies',async t=>{
  const directory=await installed(t);
  await assert.rejects(applyUpdate(directory,built.bytes,built.hash,{healthCheck:async()=>{throw new Error('failed startup');}}),/failed startup/);
  assert.equal(await fs.readFile(path.join(directory,'app/server.mjs'),'utf8'),'old server');
  assert.equal(await fs.readFile(path.join(directory,'app/node_modules/sentinel'),'utf8'),'dependencies');
  for(const file of ROOT_FILES)assert.equal(await fs.readFile(path.join(directory,file),'utf8'),'old '+file);
  assert.equal(await fs.readFile(path.join(directory,'private-profile'),'utf8'),'untouched');
});
test('each intermediate rename can fail without losing the installed app',async t=>{
  for(const target of ['app','.gwb-update/old/app/node_modules','.gwb-update/new/app','launcher.ps1','.gwb-update/new/CloseApp.ps1']) {
    const directory=await installed(t);
    await assert.rejects(applyUpdate(directory,built.bytes,built.hash,{checkpoint:async name=>{if(name===target)throw new Error('interruption');}}),/interruption/);
    assert.equal(await fs.readFile(path.join(directory,'app/server.mjs'),'utf8'),'old server');assert.equal(await fs.readFile(path.join(directory,'app/node_modules/sentinel'),'utf8'),'dependencies');
  }
});
test('incompatible dependencies and journal paths refuse mutation',async t=>{
  const directory=await installed(t);const manifest={...built.manifest,dependencies:'0'.repeat(64)};
  await assert.rejects(assertCompatible(directory,manifest),/dipendenze/);
  await fs.mkdir(path.join(directory,'.gwb-update'));
  await fs.writeFile(path.join(directory,'.gwb-update/journal.json'),JSON.stringify({format:'gwb-update-v1',operations:[{from:'private-profile',to:'app'}]}));
  await assert.rejects(recoverUpdate(directory),/Percorso/);assert.equal(await fs.readFile(path.join(directory,'private-profile'),'utf8'),'untouched');
});

test('an interrupted swap is recovered before a fresh update attempt',async t=>{
  const directory=await installed(t),transaction=path.join(directory,'.gwb-update');
  await fs.mkdir(path.join(transaction,'new/app'),{recursive:true});
  await fs.mkdir(path.join(transaction,'old'),{recursive:true});
  await fs.writeFile(path.join(transaction,'new/app/server.mjs'),'new staged');
  await fs.rename(path.join(directory,'app'),path.join(transaction,'old/app'));
  await fs.rename(path.join(transaction,'old/app/node_modules'),path.join(transaction,'new/app/node_modules'));
  await fs.writeFile(path.join(transaction,'journal.json'),JSON.stringify({format:'gwb-update-v1',from:'3.4.5',operations:[{from:'app',to:'.gwb-update/old/app'},{from:'.gwb-update/old/app/node_modules',to:'.gwb-update/new/app/node_modules'}]}));
  await recoverUpdate(directory);
  assert.equal(await fs.readFile(path.join(directory,'app/server.mjs'),'utf8'),'old server');
  assert.equal(await fs.readFile(path.join(directory,'app/node_modules/sentinel'),'utf8'),'dependencies');
  await applyUpdate(directory,built.bytes,built.hash);assert.equal(JSON.parse(await fs.readFile(path.join(directory,'app/package.json'))).version,built.manifest.version);
});
test('startup verifier runs the real server and shuts down only its own read-only child',async t=>{
  const {verifyStartup}=await import('../update-worker.mjs');
  const directory=await temporary(t),profile=await temporary(t);
  await fs.symlink(root,path.join(directory,'app'),'dir');
  const state='{"version":3,"projects":[],"sentinel":"keep"}';await fs.writeFile(path.join(profile,'state.json'),state);
  await verifyStartup(directory,profile,built.manifest.version,process.execPath);
  assert.equal(await fs.readFile(path.join(profile,'state.json'),'utf8'),state);
  await assert.rejects(fs.access(path.join(profile,'instance.lock')),error=>error.code==='ENOENT');
});

test('force never substitutes the actual profile path in worker arguments',async()=>{
  const {workerArguments}=await import('../update-worker.mjs');
  assert.deepEqual(workerArguments(['--close','root','stage','--force'],'actual-profile'),{mode:'--close',root:'root',stage:'stage',directory:'actual-profile',force:true});
  assert.equal(workerArguments(['--close','root','stage','explicit-profile','--force'],'default-profile').directory,'explicit-profile');
  assert.throws(()=>workerArguments(['--close','root','stage','--invalid'],'default-profile'),/non validi/);
});
