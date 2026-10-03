import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const UPDATE_FORMAT = 'gwb-update-v1';
export const MAX_UPDATE_BYTES = 20 * 1024 * 1024;
export const APP_FILES = ['package.json','package-lock.json','engine.mjs','server.mjs','oauth.mjs','browser.mjs','instance.mjs','diagnostics.mjs','triggers.mjs','updates.mjs','app-updates.mjs','app-processes.mjs','update-worker.mjs'];
export const ROOT_FILES = ['launcher.ps1','CloseApp.ps1','UpdateApp.ps1'];
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function dependencyFingerprint(lock) {
  const copy = structuredClone(lock);
  delete copy.version;
  if (copy.packages?.['']) delete copy.packages[''].version;
  return sha256(JSON.stringify(copy));
}
export function updatePath(name) {
  if (typeof name !== 'string' || !name || name.length > 180 || /[\\<>:"|?*\x00-\x1f]/.test(name)) throw new Error('Percorso ZIP non valido.');
  if (name.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Percorso ZIP non valido.');
  if (ROOT_FILES.includes(name) || APP_FILES.some(file => name === 'app/' + file) || /^app\/public\/[A-Za-z0-9_./-]+\.(?:js|html|css|svg)$/.test(name)) return name;
  throw new Error('File non consentito nel pacchetto: ' + name);
}

// Read only the ZIP features emitted by our packager. Never extract paths
// before checking bounds, duplicate names, file types and the manifest hashes.
export function readUpdateZip(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > MAX_UPDATE_BYTES) throw new Error('Dimensione ZIP non valida.');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end+4) || bytes.readUInt16LE(end+6)) throw new Error('Archivio ZIP non supportato.');
  const count = bytes.readUInt16LE(end+10), central = bytes.readUInt32LE(end+16), centralSize = bytes.readUInt32LE(end+12);
  if (!count || count > 200 || count !== bytes.readUInt16LE(end+8) || central + centralSize !== end) throw new Error('Indice ZIP non valido.');
  const entries = new Map(), seen = new Set(), ranges = [];
  let offset = central, total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Indice ZIP troncato.');
    const flags=bytes.readUInt16LE(offset+8), method=bytes.readUInt16LE(offset+10), compressed=bytes.readUInt32LE(offset+20), size=bytes.readUInt32LE(offset+24);
    const length=bytes.readUInt16LE(offset+28), extra=bytes.readUInt16LE(offset+30), comment=bytes.readUInt16LE(offset+32), local=bytes.readUInt32LE(offset+42);
    if (offset+46+length+extra+comment > end || (flags & 1) || ![0,8].includes(method) || size > MAX_UPDATE_BYTES || (total+=size)>MAX_UPDATE_BYTES || bytes.readUInt16LE(offset+34)) throw new Error('Contenuto ZIP non supportato.');
    const type=(bytes.readUInt32LE(offset+38)>>>16)&0xf000;
    if (type && type !== 0x8000) throw new Error('Link o cartella non consentiti nel ZIP.');
    const name=bytes.subarray(offset+46,offset+46+length).toString('utf8');
    if (name !== 'update.json') updatePath(name);
    if (seen.has(name.toLowerCase())) throw new Error('Nome duplicato nel ZIP.');
    seen.add(name.toLowerCase());
    if (local+30>central || bytes.readUInt32LE(local)!==0x04034b50 || bytes.readUInt16LE(local+8)!==method || (bytes.readUInt16LE(local+6)&1)) throw new Error('Intestazione ZIP non valida.');
    const localLength=bytes.readUInt16LE(local+26), localExtra=bytes.readUInt16LE(local+28), start=local+30+localLength+localExtra;
    if (start+compressed>central || bytes.subarray(local+30,local+30+localLength).toString('utf8')!==name || ranges.some(([a,b])=>local<b && start+compressed>a)) throw new Error('Dati ZIP non validi.');
    ranges.push([local,start+compressed]);
    const data=bytes.subarray(start,start+compressed);
    const unpacked=method===8?inflateRawSync(data,{maxOutputLength:Math.max(1,size)}):Buffer.from(data);
    if (unpacked.length!==size) throw new Error('Dimensione file ZIP non valida.');
    entries.set(name,unpacked); offset+=46+length+extra+comment;
  }
  if (offset!==end) throw new Error('Indice ZIP non valido.');
  return entries;
}

export function validateUpdate(bytes, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash || '') || sha256(bytes)!==expectedHash) throw new Error('Checksum aggiornamento non valido.');
  const entries=readUpdateZip(bytes);
  if (!entries.has('update.json') || entries.get('update.json').length>100000) throw new Error('Manifest aggiornamento mancante.');
  const manifest=JSON.parse(entries.get('update.json').toString());
  if (manifest.format!==UPDATE_FORMAT || !/^\d+\.\d+\.\d+$/.test(manifest.version||'') || manifest.nodeMajor!==24 || !/^[a-f0-9]{64}$/.test(manifest.dependencies||'') || !Array.isArray(manifest.files)) throw new Error('Manifest aggiornamento non valido.');
  const expected=new Set(['update.json']);
  for (const file of manifest.files) {
    updatePath(file.path);
    if (expected.has(file.path) || !Number.isSafeInteger(file.size) || file.size<0 || !/^[a-f0-9]{64}$/.test(file.sha256||'')) throw new Error('Manifest file non valido.');
    const data=entries.get(file.path);
    if (!data || data.length!==file.size || sha256(data)!==file.sha256) throw new Error('File aggiornamento alterato: '+file.path);
    expected.add(file.path);
  }
  if (expected.size!==entries.size || [...entries.keys()].some(name=>!expected.has(name)) || APP_FILES.some(name=>!expected.has('app/'+name)) || ROOT_FILES.some(name=>!expected.has(name))) throw new Error('Pacchetto aggiornamento incompleto.');
  const pkg=JSON.parse(entries.get('app/package.json'));
  const lock=JSON.parse(entries.get('app/package-lock.json'));
  if (pkg.name!=='google-workspace-backup' || pkg.version!==manifest.version || lock.version!==manifest.version || lock.packages?.['']?.version!==manifest.version || dependencyFingerprint(lock)!==manifest.dependencies) throw new Error('Versione o dipendenze incoerenti nel ZIP.');
  return {manifest,entries};
}

export async function assertCompatible(root, manifest) {
  const pkg=JSON.parse(await fs.readFile(path.join(root,'app/package.json'),'utf8'));
  const lock=JSON.parse(await fs.readFile(path.join(root,'app/package-lock.json'),'utf8'));
  if (pkg.name!=='google-workspace-backup' || !/^\d+\.\d+\.\d+$/.test(pkg.version||'') || dependencyFingerprint(lock)!==manifest.dependencies) throw new Error('Serve il pacchetto iniziale: dipendenze non compatibili con questo aggiornamento.');
  const current=pkg.version.split('.').map(Number), next=manifest.version.split('.').map(Number);
  const comparison=next.reduce((result,n,i)=>result || Math.sign(n-current[i]),0);
  if (comparison<0) throw new Error('Aggiornamento a una versione precedente non consentito.');
  for (const name of ['app','app/node_modules']) if (!(await fs.lstat(path.join(root,name))).isDirectory() || (await fs.lstat(path.join(root,name))).isSymbolicLink()) throw new Error('Installazione non valida o con link.');
  for (const name of ROOT_FILES) {
    try { if ((await fs.lstat(path.join(root,name))).isSymbolicLink()) throw new Error('File installazione con link.'); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
  }
  return pkg;
}

export async function stageUpdate(bytes, expectedHash) {
  const update=validateUpdate(bytes,expectedHash);
  const stage=await fs.mkdtemp(path.join(os.tmpdir(),'gwb-update-'));
  try {
    for (const [name,data] of update.entries) {
      const file=path.join(stage,name); await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,data,{flag:'wx'});
    }
    await fs.writeFile(path.join(stage,'package.zip'),bytes,{flag:'wx'});
    await fs.writeFile(path.join(stage,'expected.sha256'),expectedHash,{flag:'wx'});
    return {stage,manifest:update.manifest};
  } catch(error) { await fs.rm(stage,{recursive:true,force:true}); throw error; }
}

// Install on the same volume using renames. Keep dependencies and user data.
// A journal is written before each move so a interrupted update can be undone.
export async function applyUpdate(root, bytes, expectedHash, {healthCheck=async()=>{}, checkpoint=async()=>{}}={}) {
  const update=validateUpdate(bytes,expectedHash);
  const current=await assertCompatible(root,update.manifest);
  const transaction=path.join(root,'.gwb-update');
  try { await fs.mkdir(transaction); } catch(error) { if(error.code==='EEXIST') throw new Error('Aggiornamento interrotto presente. Ripristinalo prima di procedere.'); throw error; }
  const journal={format:UPDATE_FORMAT,from:current.version,to:update.manifest.version,operations:[],state:'preparing'};
  const writeJournal=async()=>{await fs.writeFile(path.join(transaction,'journal.next'),JSON.stringify(journal));await fs.rename(path.join(transaction,'journal.next'),path.join(transaction,'journal.json'));};
  const move=async(from,to)=>{
    journal.operations.push({from,to}); await writeJournal();
    await fs.mkdir(path.dirname(path.join(root,to)),{recursive:true});
    await fs.rename(path.join(root,from),path.join(root,to)); await checkpoint(from);
  };
  try {
    await writeJournal();
    for(const [name,data] of update.entries) {
      if(name==='update.json') continue;
      const destination=path.join(transaction,'new',name); await fs.mkdir(path.dirname(destination),{recursive:true}); await fs.writeFile(destination,data,{flag:'wx'});
    }
    await move('app','.gwb-update/old/app');
    await move('.gwb-update/old/app/node_modules','.gwb-update/new/app/node_modules');
    await move('.gwb-update/new/app','app');
    for(const name of ROOT_FILES) {
      let exists=true;
      try { await fs.access(path.join(root,name)); } catch(error) { if(error.code!=='ENOENT') throw error; exists=false; }
      if(exists) await move(name,'.gwb-update/old/'+name);
      await move('.gwb-update/new/'+name,name);
    }
    journal.state='checking'; await writeJournal();
    await healthCheck(update.manifest.version);
    journal.state='complete'; await writeJournal();
    const previous=path.join(root,'.gwb-previous');
    // Retain the immediately previous app for explicit rollback; do not remove
    // an older backup silently if it may contain locally added files.
    try { await fs.access(previous); await fs.rename(previous,path.join(root,'.gwb-previous-'+crypto.randomUUID())); } catch(e) { if(e.code!=='ENOENT') throw e; }
    await fs.rename(transaction,previous);
    return {version:update.manifest.version,previous:current.version};
  } catch(error) {
    try { await recoverUpdate(root); } catch(rollbackError) { throw new Error(error.message+' Ripristino non completato: '+rollbackError.message); }
    throw error;
  }
}

export async function recoverUpdate(root) {
  const transaction=path.join(root,'.gwb-update');
  const journal=JSON.parse(await fs.readFile(path.join(transaction,'journal.json'),'utf8'));
  if(journal.format!==UPDATE_FORMAT || !Array.isArray(journal.operations) || journal.operations.length>20) throw new Error('Registro ripristino non valido.');
  // The journal may only rename our app and the enumerated root files.
  const allowed=new Set(['app',...ROOT_FILES,'.gwb-update/old/app','.gwb-update/old/app/node_modules','.gwb-update/new/app','.gwb-update/new/app/node_modules',...ROOT_FILES.flatMap(n=>['.gwb-update/old/'+n,'.gwb-update/new/'+n])]);
  for(const op of journal.operations) if(!allowed.has(op.from)||!allowed.has(op.to)) throw new Error('Percorso ripristino non consentito.');
  while(journal.operations.length) {
    const op=journal.operations.at(-1);
    const from=path.join(root,op.from),to=path.join(root,op.to);
    const exists=async file=>{try{await fs.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
    if(await exists(to) && !await exists(from)) { await fs.mkdir(path.dirname(from),{recursive:true}); await fs.rename(to,from); }
    else if(await exists(to) && await exists(from)) throw new Error('Ripristino ambiguo; file originali conservati.');
    journal.operations.pop();
    await fs.writeFile(path.join(transaction,'journal.next'),JSON.stringify(journal));
    await fs.rename(path.join(transaction,'journal.next'),path.join(transaction,'journal.json'));
  }
  await fs.rm(transaction,{recursive:true,force:true});
  return {restored:journal.from};
}
