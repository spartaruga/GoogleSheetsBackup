import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalized = value => path.win32.normalize(String(value || '')).toLowerCase();
const psString = value => "'" + String(value).replaceAll("'", "''") + "'";
export function localRequest(port,route,method='GET') {
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Porta locale non valida.');
  return new Promise((resolve,reject)=>{
    // Explicit agent, with no proxy settings; localhost never goes through
    // the company proxy even when global environment proxy use is enabled.
    const agent=new http.Agent({keepAlive:false,proxyEnv:{}});
    const request=http.request({hostname:'127.0.0.1',port,path:route,method,agent,headers:{Connection:'close','X-App-Request':'GoogleWorkspaceBackup','Content-Type':'application/json'}},response=>{
      const chunks=[];let size=0;
      response.on('data',chunk=>{if((size+=chunk.length)>65536)response.destroy(new Error('Risposta locale troppo grande.'));else chunks.push(chunk);});
      response.on('error',reject);
      response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString()||'{}')});}catch(error){reject(error);}finally{agent.destroy();}});
    });
    request.on('error',error=>{agent.destroy();reject(error);});
    request.setTimeout(2500,()=>request.destroy(new Error('Timeout server locale.')));
    request.end(method==='POST'?'{}':undefined);
  });
}
async function powershell(script) {
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const encoded=Buffer.from('[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); '+script,'utf16le').toString('base64');
  const {stdout} = await exec(executable, ['-NoProfile','-NonInteractive','-EncodedCommand',encoded], {windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
  return JSON.parse(stdout.trim().replace(/^\uFEFF/, '') || 'null');
}

// Windows command-line quoting, including escaped quotes and backslashes.
export function windowsArgs(text) {
  const args=[]; let i=0;
  while(i<text.length) {
    while(/\s/.test(text[i] || '') && i<text.length) i++;
    if(i>=text.length) break;
    let word='',quoted=false;
    while(i<text.length && (quoted || !/\s/.test(text[i]))) {
      let slashes=0;
      while(text[i]==='\\') {slashes++;i++;}
      if(text[i]==='"') {word+='\\'.repeat(Math.floor(slashes/2)); if(slashes%2)word+='"';else quoted=!quoted;i++;}
      else {word+='\\'.repeat(slashes); if(i<text.length) word+=text[i++];}
    }
    args.push(word);
  }
  return args;
}

export async function verifiedRoot(root) {
  for(const app of [path.join(root,'app'),root,path.join(root,'.gwb-update/old/app')]) {
    try {
      const pkg=JSON.parse(await fs.readFile(path.join(app,'package.json'),'utf8'));
      if(pkg.name!=='google-workspace-backup') continue;
      await Promise.all(['server.mjs','engine.mjs'].map(file=>fs.access(path.join(app,file))));
      await fs.access(path.join(root,'launcher.ps1'));
      return true;
    } catch {}
  }
  return false;
}

export async function classifyProcesses(snapshot, {verifyRoot=verifiedRoot,protectPid=0}={}) {
  const eligible=snapshot.processes.filter(p=>p.owner===snapshot.owner && p.session===snapshot.session && Number.isInteger(p.pid) && p.pid>0 && p.command && p.executable);
  const found=new Map(), roots=new Map();
  const verify=async root=>{const key=normalized(root);if(!roots.has(key))roots.set(key,await verifyRoot(root));return roots.get(key);};
  for(const p of eligible) {
    const args=windowsArgs(p.command);let root,kind;
    if(/^node\.exe$/i.test(p.name)) {
      // Accept only a direct server entry point, never arbitrary Node programs.
      const script=args[1];
      if(!script || !path.win32.isAbsolute(script) || path.win32.basename(script).toLowerCase()!=='server.mjs')continue;
      const directory=path.win32.dirname(script);
      root=path.win32.basename(directory).toLowerCase()==='app'?path.win32.dirname(directory):directory;kind='server';
    } else if(/^GoogleWorkspaceBackup\.exe$/i.test(p.name)) {root=path.win32.dirname(p.executable);kind='launcher';}
    else if(/^(powershell|pwsh)\.exe$/i.test(p.name)) {
      const index=args.findIndex(a=>a.toLowerCase()==='-file');const script=args[index+1];
      if(index<0 || !script || !path.win32.isAbsolute(script) || path.win32.basename(script).toLowerCase()!=='launcher.ps1')continue;
      root=path.win32.dirname(script);kind='launcher';
    } else if(/^cmd\.exe$/i.test(p.name)) {
      // Recognize an orphan of the exact launcher command too, even after
      // its Node child has exited. Generic cmd processes never match.
      const match=p.command.match(/\s\/d\s+\/s\s+\/c\s+""([^"]+node\.exe)"\s+"([^"]+server\.mjs)"\s+1>"[^"]+"\s+2>"[^"]+""\s*$/i);
      if(!match || !path.win32.isAbsolute(match[1]) || !path.win32.isAbsolute(match[2]))continue;
      const directory=path.win32.dirname(match[2]);
      root=path.win32.basename(directory).toLowerCase()==='app'?path.win32.dirname(directory):directory;kind='launcher';
    } else continue;
    if(await verify(root))found.set(p.pid,{...p,root,kind});
  }
  // The cmd shim is accepted only as an older parent of a verified server.
  for(const p of [...found.values()]) {
    const parent=eligible.find(candidate=>candidate.pid===p.parent);
    if(p.kind==='server' && parent && /^cmd\.exe$/i.test(parent.name) && parent.created<=p.created)found.set(parent.pid,{...parent,root:p.root,kind:'launcher'});
  }
  const protectedIds=new Set();let current=eligible.find(p=>p.pid===protectPid);
  while(current && !protectedIds.has(current.pid)) {protectedIds.add(current.pid);const parent=eligible.find(p=>p.pid===current.parent);current=parent && parent.created<=current.created?parent:null;}
  return [...found.values()].filter(p=>!protectedIds.has(p.pid));
}

export const windowsAdapter = {
  async snapshot() {
    if(process.platform!=='win32')throw new Error('Chiusura delle altre istanze disponibile su Windows.');
    return powershell(`$ErrorActionPreference='Stop'; $me=Get-CimInstance Win32_Process -Filter 'ProcessId=${process.pid}'; $sid=(Invoke-CimMethod -InputObject $me -MethodName GetOwnerSid).Sid; $rows=@(Get-CimInstance Win32_Process | Where-Object { $_.SessionId -eq $me.SessionId -and $_.Name -match '^(node|GoogleWorkspaceBackup|powershell|pwsh|cmd)\\.exe$' } | ForEach-Object { $o=(Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid -ErrorAction SilentlyContinue).Sid; [pscustomobject]@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;session=[int]$_.SessionId;owner=$o;name=$_.Name;executable=$_.ExecutablePath;command=$_.CommandLine;created=$_.CreationDate.ToUniversalTime().ToString('o')} }); @{owner=$sid;session=[int]$me.SessionId;processes=$rows} | ConvertTo-Json -Depth 5 -Compress`);
  },
  async ports(p) {
    return (await powershell(`$ErrorActionPreference='Stop'; @(Get-NetTCPConnection -State Listen -OwningProcess ${p.pid} -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -ExpandProperty LocalPort -Unique) | ConvertTo-Json -Compress`)) || [];
  },
  async stop(p) {
    // Revalidate identity immediately before termination to resist PID reuse.
    const result=await powershell(`$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.pid}' -ErrorAction SilentlyContinue; if(-not $p){'true';exit}; $sid=(Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid).Sid; if($sid -ne ${psString(p.owner)} -or $p.SessionId -ne ${p.session} -or $p.ExecutablePath -cne ${psString(p.executable)} -or $p.CommandLine -cne ${psString(p.command)} -or $p.CreationDate.ToUniversalTime().ToString('o') -cne ${psString(p.created)}){throw 'Identita processo cambiata'}; Stop-Process -Id ${p.pid} -Force -ErrorAction Stop; 'true'`);
    return result;
  },
  async health(port) {
    const response=await localRequest(port,'/api/health');
    if(response.status!==200)throw new Error('Health non disponibile');return response.body;
  },
  async shutdown(port) {
    const response=await localRequest(port,'/api/shutdown','POST');
    return response.status;
  },
  sleep,
};
const identity = p => JSON.stringify([p.pid,p.created,p.executable,p.command,p.owner,p.session]);
export async function verifyProfileLock(directory) {
  let text;
  try {text=await fs.readFile(path.join(directory,'instance.lock'),'utf8');}catch(error){if(error.code==='ENOENT')return;throw error;}
  let lock;
  try {lock=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new Error('Blocco locale non leggibile: i dati sono conservati. Controlla instance.lock prima di aggiornare.');}
  if(!Number.isInteger(lock.pid)||lock.pid<1||!lock.id)throw new Error('Blocco locale non valido; nessun processo estraneo verrà terminato.');
  try {process.kill(lock.pid,0);}catch(error){if(error.code==='ESRCH')return;}
  // A live PID without a verified app command is never a target. A dead
  // lock is left intact; claimInstance performs serialized recovery later.
  throw new Error('Il profilo è ancora bloccato da un processo attivo o non verificabile. Nessun processo estraneo è stato terminato.');
}
export async function closeAppProcesses({adapter=windowsAdapter,force=false,protectPid=0,checkOnly=false,verifyRoot=verifiedRoot,waitMs=15000}={}) {
  const candidates=await classifyProcesses(await adapter.snapshot(),{verifyRoot,protectPid});
  const servers=candidates.filter(p=>p.kind==='server'), reachable=new Map(), busy=[];
  // Preflight all servers before closing any: known active work always blocks.
  for(const p of servers) {
    const ports=await adapter.ports(p);
    for(const port of Array.isArray(ports)?ports:[ports]) {
      if(!Number.isInteger(port)||port<1||port>65535)continue;
      try {const health=await adapter.health(port);if(health.app!=='GoogleWorkspaceBackup')continue;if(health.busy)busy.push(p.pid);reachable.set(p.pid,port);break;}catch{}
    }
  }
  const report={count:candidates.length,servers:servers.length,busy,needsForce:[],closed:0};
  if(busy.length || checkOnly)return report;
  for(const p of servers) {
    if(reachable.has(p.pid)) {
      const status=await adapter.shutdown(reachable.get(p.pid));
      if(status===409){report.busy.push(p.pid);return report;}
      if(status!==200){report.needsForce.push(p.pid);continue;}
    }
  }
  const deadline=Date.now()+waitMs;
  let remaining;
  do {
    const snapshot=await adapter.snapshot();const living=new Set(snapshot.processes.map(identity));remaining=candidates.filter(p=>living.has(identity(p)));
    if(!remaining.some(p=>p.kind==='server')||Date.now()>=deadline)break;
    await adapter.sleep(250);
  }while(true);
  const hung=remaining.filter(p=>p.kind==='server');
  if(hung.length&&!force) {report.needsForce=[...new Set([...report.needsForce,...hung.map(p=>p.pid)])];report.closed=candidates.length-remaining.length;return report;}
  // Stop only proven GWB servers and their verified launcher shims. No /T,
  // no process-name kill, no browsers, and no unrelated Node applications.
  for(const p of hung) {
    if(reachable.has(p.pid)) {
      try {if((await adapter.health(reachable.get(p.pid))).busy){report.busy.push(p.pid);return report;}}catch{}
    }
  }
  for(const p of [...hung,...remaining.filter(p=>p.kind==='launcher')])await adapter.stop(p);
  for(let i=0;i<20;i++) {
    const living=new Set((await adapter.snapshot()).processes.map(identity));
    remaining=candidates.filter(p=>living.has(identity(p)));
    if(!remaining.length)break;
    await adapter.sleep(150);
  }
  report.needsForce=remaining.map(p=>p.pid);report.closed=candidates.length-remaining.length;
  return report;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const result=await closeAppProcesses({checkOnly:process.argv.includes('--check'),force:process.argv.includes('--force')});
    if(!result.busy.length&&!result.needsForce.length && (!process.argv.includes('--check')||!result.count))await verifyProfileLock(path.join(process.env.APPDATA,'GoogleWorkspaceBackup'));
    console.log(JSON.stringify(result));process.exitCode=result.busy.length?2:result.needsForce.length?3:process.argv.includes('--check')&&result.count?1:0;
  }catch(error){console.error(error.message);process.exitCode=4;}
}
