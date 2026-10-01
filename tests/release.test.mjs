import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { publishRelease } from '../scripts/publish-release.mjs';
import { pkg, checksum, writeChecksum } from '../scripts/common.mjs';
import { temporary } from './helpers.mjs';
const repository='spartaruga/GoogleSheetsBackup',commit='a'.repeat(40),tag='v'+pkg.version;
async function fixture(t,{published=false,tagCommit=null,corrupt=false}={}) {
  const directory=await temporary(t),files=[`GoogleWorkspaceBackup-Setup-${pkg.version}.exe`,`GoogleWorkspaceBackup_v${pkg.version}_source.zip`];
  for(const name of files){fs.writeFileSync(path.join(directory,name),'fixture');writeChecksum(path.join(directory,name));}
  const assets=files.flatMap(name=>[name,name+'.sha256']).map(name=>({name,state:'uploaded',size:fs.statSync(path.join(directory,name)).size,digest:'sha256:'+checksum(path.join(directory,name))}));
  const release={id:42,tag_name:tag,draft:!published,target_commitish:'b'.repeat(40),assets:published?assets:[]};
  const calls=[];
  const gh=(args,allowNotFound)=>{
    calls.push(args);
    if(args[0]==='api' && args[1].includes('/git/ref/tags/')){assert(allowNotFound);return tagCommit?JSON.stringify({object:{sha:tagCommit,type:'commit'}}):null;}
    if(args[0]==='api' && args[1].includes('/commits/')){assert(!allowNotFound);assert(tagCommit);return tagCommit;}
    if(args[0]==='api' && args.includes('--slurp'))return JSON.stringify([[release]]);
    if(args[0]==='api' && args[1].endsWith('/42'))return JSON.stringify(release);
    if(args[0]==='release' && args[1]==='upload'){release.assets=structuredClone(assets);if(corrupt)release.assets[0].digest='sha256:wrong';return '';}
    if(args[0]==='release' && args[1]==='edit'){if(args.includes('--target'))release.target_commitish=commit;else release.draft=false;return '';}
    throw new Error('Chiamata inattesa: '+JSON.stringify(args));
  };
  return {directory,gh,calls,release};
}
test('release resumes an unpublished draft without querying its unavailable by-tag endpoint',async t=>{
  const f=await fixture(t);assert(publishRelease({repository,commit,...f}).endsWith('/'+tag));
  assert.equal(f.release.target_commitish,commit);assert.equal(f.release.draft,false);assert.equal(f.release.assets.length,4);
  assert(!f.calls.some(args=>args.some(arg=>arg.includes('/releases/tags/'))));
  assert(!f.calls.some(args=>args.some(arg=>arg.includes('/commits/'))));
});
test('release keeps a published version unchanged and rejects a conflicting commit',async t=>{
  const f=await fixture(t,{published:true,tagCommit:commit});publishRelease({repository,commit,...f});
  assert(!f.calls.some(args=>args[0]==='release'));
  assert.throws(()=>publishRelease({repository,commit:'c'.repeat(40),...f}),/altro commit/);
});
test('release never publishes assets whose uploaded digest differs from the verified local file',async t=>{
  const f=await fixture(t,{corrupt:true});assert.throws(()=>publishRelease({repository,commit,...f}),/Asset incompleto/);
  assert.equal(f.release.draft,true);
});
