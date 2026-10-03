import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyUpdate,validateUpdate,recoverUpdate} from './app-updates.mjs';
import {closeAppProcesses,verifyProfileLock,localRequest} from './app-processes.mjs';
import {claimInstance} from './instance.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function workerArguments(args,fallbackDirectory) {
  const [mode,root,stage,...tail]=args;
  const directories=tail.filter(value=>value!=='--force');
  if(!['--close','--apply'].includes(mode)||!root||!stage||directories.length>1||directories.some(value=>value.startsWith('--')))throw new Error('Argomenti aggiornamento non validi.');
  const directory=directories[0]||fallbackDirectory;
  if(!directory)throw new Error('Profilo aggiornamento mancante.');
  return {mode,root,stage,directory,force:tail.includes('--force')};
}

export async function verifyStartup(root, directory, version, node=process.execPath) {
  const child=spawn(node,[path.join(root,'app/server.mjs')],{cwd:path.join(root,'app'),windowsHide:true,stdio:'ignore',env:{...process.env,GWB_DATA_DIR:directory,GWB_PORT:'0',GWB_NO_BROWSER:'1',GWB_UPDATE_HEALTHCHECK:'1'}});
  let record,verified=false;
  try {
    for(let i=0;i<200;i++) {
      if(child.exitCode!==null || child.signalCode!==null)throw new Error('La nuova versione non si avvia.');
      try {
        record=JSON.parse(await fs.readFile(path.join(directory,'instance.json'),'utf8'));
        if(record.pid===child.pid && record.version===version) {
          const response=await localRequest(record.port,'/api/health');
          const health=response.body;
          if(response.status===200 && health.instanceId===record.instanceId && health.version===version && health.app==='GoogleWorkspaceBackup' && !health.busy){verified=true;break;}
        }
      }catch{}
      await pause(100);
    }
    if(!verified)throw new Error('Verifica avvio scaduta; ripristino versione precedente.');
    const response=await localRequest(record.port,'/api/shutdown','POST');
    if(response.status!==200)throw new Error('La verifica non riesce a chiudere la nuova istanza.');
    for(let i=0;i<100&&child.exitCode===null&&child.signalCode===null;i++)await pause(100);
    if(child.exitCode===null&&child.signalCode===null)throw new Error('Chiusura verifica scaduta.');
  } finally {
    // This is exclusively our own child, in read-only health-check mode.
    if(child.exitCode===null&&child.signalCode===null){child.kill();await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000).unref();});}
  }
}

export async function installStaged(root,stage,directory) {
  const bytes=await fs.readFile(path.join(stage,'package.zip')),hash=(await fs.readFile(path.join(stage,'expected.sha256'),'utf8')).trim();
  validateUpdate(bytes,hash);
  let lease=claimInstance(directory);
  if(!lease)throw new Error('Un’altra istanza sta usando il profilo. Riprova dopo averla chiusa.');
  try {
    try {await fs.access(path.join(root,'.gwb-update'));await recoverUpdate(root);}catch(error){if(error.code!=='ENOENT')throw error;}
    return await applyUpdate(root,bytes,hash,{healthCheck:async version=>{lease.release();lease=null;await verifyStartup(root,directory,version,path.join(root,'runtime/node.exe'));}});
  }finally{lease?.release();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const {mode,root,stage,directory,force}=workerArguments(process.argv.slice(2),process.env.GWB_DATA_DIR||(process.env.APPDATA?path.join(process.env.APPDATA,'GoogleWorkspaceBackup'):null));
    if(mode==='--close') {
      validateUpdate(await fs.readFile(path.join(stage,'package.zip')),(await fs.readFile(path.join(stage,'expected.sha256'),'utf8')).trim());
      const result=await closeAppProcesses({force,profileDirectory:directory});
      if(!result.busy.length&&!result.needsForce.length)Object.assign(result,await verifyProfileLock(directory,{recoverStale:true}));
      console.log(JSON.stringify(result));process.exitCode=result.busy.length?2:result.needsForce.length?3:0;
    }else if(mode==='--apply') {if(!root||!stage||!directory)throw new Error('Argomenti aggiornamento mancanti.');console.log(JSON.stringify(await installStaged(path.resolve(root),path.resolve(stage),path.resolve(directory))));}
    else throw new Error('Modalità aggiornamento non valida.');
  }catch(error){console.log(JSON.stringify({error:error.message,code:error.code,diagnostic:error.diagnostic}));process.exitCode=4;}
}
