import fs from 'node:fs/promises';
import path from 'node:path';
import {ZipArchive} from 'archiver';
import {root,pkg,walk} from './common.mjs';
import {APP_FILES,ROOT_FILES,UPDATE_FORMAT,dependencyFingerprint,sha256,validateUpdate} from '../app-updates.mjs';
export async function createUpdatePackage(directory=root) {
  const files=new Map();
  for(const name of APP_FILES)files.set('app/'+name,await fs.readFile(path.join(directory,name)));
  for(const name of walk(path.join(directory,'public')))files.set('app/public/'+name,await fs.readFile(path.join(directory,'public',name)));
  for(const name of ROOT_FILES)files.set(name,await fs.readFile(path.join(directory,name==='launcher.ps1'?name:'installer/'+name)));
  const lock=JSON.parse(files.get('app/package-lock.json'));
  const version=JSON.parse(files.get('app/package.json')).version;
  const manifest={format:UPDATE_FORMAT,version,nodeMajor:24,dependencies:dependencyFingerprint(lock),files:[...files].map(([name,data])=>({path:name,size:data.length,sha256:sha256(data)}))};
  const archive=new ZipArchive({zlib:{level:9}}),chunks=[];
  const completed=new Promise((resolve,reject)=>{archive.on('data',chunk=>chunks.push(chunk));archive.once('end',resolve);archive.once('error',reject);});
  for(const [name,data] of files)archive.append(data,{name,date:new Date('2026-01-01T00:00:00Z'),mode:0o100644});
  archive.append(JSON.stringify(manifest),{name:'update.json',date:new Date('2026-01-01T00:00:00Z'),mode:0o100644});
  await archive.finalize();await completed;
  const bytes=Buffer.concat(chunks),hash=sha256(bytes);validateUpdate(bytes,hash);
  return {bytes,hash,manifest,envelope:{format:'gwb-update-envelope-v1',version,sha256:hash,size:bytes.length,payload:bytes.toString('base64')}};
}
export async function writeBootstrap() {
  const script=await fs.readFile(path.join(root,'scripts/bootstrap.ps1'),'utf8');
  const head=['@echo off','setlocal','set "GWB_BOOTSTRAP_FILE=%~f0"',`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:GWB_BOOTSTRAP_FILE);$b=$s.Substring($s.IndexOf('# GWB_PAYLOAD_BEGIN')+19).Trim();& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b))))"`,'if errorlevel 1 pause','exit /b','# GWB_PAYLOAD_BEGIN'];
  // The marker occurs inside the command too. Use LastIndexOf to select tail.
  head[3]=head[3].replace('IndexOf','LastIndexOf');
  await fs.writeFile(path.join(root,'Aggiorna-GWB.cmd'),head.join('\n')+'\n'+Buffer.from(script).toString('base64')+'\n');
}
if(process.argv[1] && path.resolve(process.argv[1])===path.join(root,'scripts/update-package.mjs')) {
  await writeBootstrap();const result=await createUpdatePackage();
  await fs.mkdir(path.join(root,'release'),{recursive:true});
  const name=`GoogleWorkspaceBackup-Update-${pkg.version}.zip`;
  await fs.writeFile(path.join(root,'release',name),result.bytes);
  await fs.writeFile(path.join(root,'release',name+'.sha256'),result.hash+'  '+name+'\n');
  await fs.mkdir(path.join(root,'packages'),{recursive:true});
  await fs.writeFile(path.join(root,'packages',`v${pkg.version}.json`),JSON.stringify(result.envelope)+'\n');
  console.log(`ZIP applicativo ${pkg.version}: ${result.bytes.length} byte, SHA-256 ${result.hash}. Nessuna build o Action.`);
}
