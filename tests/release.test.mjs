import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { publishRelease } from '../scripts/publish-release.mjs';
import { pkg, checksum, writeChecksum } from '../scripts/common.mjs';
import { temporary } from './helpers.mjs';
const repository='spartaruga/GoogleSheetsBackup',commit='a'.repeat(40),tag='v'+pkg.version;
async function fixture(t,{published=false,tagCommit=null,corrupt=false,fresh=false,stale=false,wrongTag=false}={}) {
  const directory=await temporary(t),files=[`GoogleWorkspaceBackup-Setup-${pkg.version}.exe`,`GoogleWorkspaceBackup_v${pkg.version}_source.zip`];
  for(const name of files){fs.writeFileSync(path.join(directory,name),'fixture');writeChecksum(path.join(directory,name));}
  const assets=files.flatMap(name=>[name,name+'.sha256']).map((name,index)=>({id:100+index,name,state:'uploaded',size:fs.statSync(path.join(directory,name)).size,digest:'sha256:'+checksum(path.join(directory,name))}));
  const release={id:42,tag_name:tag,draft:!published,target_commitish:'b'.repeat(40),upload_url:`https://uploads.github.com/repos/${repository}/releases/42/assets{?name,label}`,assets:published||stale?structuredClone(assets):[]};
  const calls=[];
  const gh=(args,allowNotFound)=>{
    calls.push(args);
    if(args[0]==='api' && args[1].includes('/git/ref/tags/')){assert(allowNotFound);return tagCommit?JSON.stringify({object:{sha:tagCommit,type:'commit'}}):null;}
    if(args[0]==='api' && args[1].includes('/commits/')){assert(!allowNotFound);assert(tagCommit);return tagCommit;}
    if(args[0]==='api' && args.includes('--slurp'))return JSON.stringify([fresh?[]:[release]]);
    const method=args.includes('--method')?args[args.indexOf('--method')+1]:'GET';
    if(args[0]==='api' && method==='POST' && args[1].startsWith('https://uploads.github.com/')) {
      const name=new URL(args[1]).searchParams.get('name');
      assert(args[1].includes('/releases/42/assets?'));assert(args.includes('Content-Type: application/octet-stream'));
      assert(args.includes('Content-Length: '+fs.statSync(path.join(directory,name)).size));
      assert.equal(args[args.indexOf('--input')+1],path.join(directory,name));
      assert(!release.assets.some(a=>a.name===name));
      const asset=structuredClone(assets.find(a=>a.name===name));assert(asset);
      if(corrupt && name===files[0])asset.digest='sha256:wrong';
      release.assets.push(asset);return JSON.stringify(asset);
    }
    if(args[0]==='api' && method==='DELETE' && args[1].includes('/releases/assets/')) {
      const id=Number(args[1].split('/').at(-1));assert(release.draft);
      assert(release.assets.some(a=>a.id===id));release.assets=release.assets.filter(a=>a.id!==id);return '';
    }
    if(args[0]==='api' && (method==='POST'||method==='PATCH')) {
      assert(args.includes('Content-Type: application/json'));
      const body=JSON.parse(fs.readFileSync(args[args.indexOf('--input')+1],'utf8'));
      assert.equal(body.tag_name,tag);
      if(method==='POST'){assert(fresh);assert(args[1].endsWith('/releases'));assert.equal(body.tag_name,tag);assert.equal(body.draft,true);}
      else assert(args[1].endsWith('/42'));
      if(body.draft===false){assert.equal(body.make_latest,'true');release.draft=false;}
      else {assert.equal(body.target_commitish,commit);assert.equal(body.name,'Google Workspace Backup '+pkg.version);assert(body.body.trim());release.target_commitish=body.target_commitish;}
      return JSON.stringify(wrongTag && body.draft===false?{...release,tag_name:'untagged-test'}:release);
    }
    if(args[0]==='api' && method==='GET' && args[1].endsWith('/42'))return JSON.stringify(release);
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
  assert(!f.calls.some(args=>args[0]==='release'||args.includes('--method')));
  assert.throws(()=>publishRelease({repository,commit:'c'.repeat(40),...f}),/altro commit/);
});
test('release never publishes assets whose uploaded digest differs from the verified local file',async t=>{
  const f=await fixture(t,{corrupt:true});assert.throws(()=>publishRelease({repository,commit,...f}),/Asset incompleto/);
  assert.equal(f.release.draft,true);
});
test('release creates and publishes a draft even while it is absent from the list',async t=>{
  const f=await fixture(t,{fresh:true});publishRelease({repository,commit,...f});
  assert.equal(f.calls.filter(args=>args.includes('--slurp')).length,1);
  assert.equal(f.release.draft,false);assert.equal(f.release.assets.length,4);
  assert(!f.calls.some(args=>args[0]==='release'||args[1].includes('/releases/tags/')));
});
test('release replaces incomplete draft assets before checking and publishing',async t=>{
  const f=await fixture(t,{stale:true});publishRelease({repository,commit,...f});
  assert.equal(f.calls.filter(args=>args.includes('DELETE')).length,4);
  assert.equal(f.release.draft,false);assert.equal(f.release.assets.length,4);
});
test('release does not report success when GitHub publishes under an unexpected tag',async t=>{
  const f=await fixture(t,{wrongTag:true});assert.throws(()=>publishRelease({repository,commit,...f}),/Tag o stato della Release pubblicata/);
});
