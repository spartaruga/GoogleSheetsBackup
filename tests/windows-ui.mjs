// Real browser smoke test on the disposable Windows runner. Google APIs are mocked.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Test UI riservato al runner Windows.');
const url = process.argv[2];
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url || '')) throw new Error('URL di test non valido.');
const browserPath = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean)
  .flatMap(base => [path.join(base, 'Microsoft/Edge/Application/msedge.exe'), path.join(base, 'Google/Chrome/Application/chrome.exe')]).find(file => fs.existsSync(file));
if (!browserPath) throw new Error('Browser del runner non trovato.');
const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'gwb-ui-'));
const child = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], {windowsHide:true,stdio:'ignore'});
let socket, nextId = 0;
const pending = new Map(), errors = [];
let jobStatus = 'completed';
let resolvePageLoaded;
const mockState={version:3,appVersion:JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version,nodeVersion:process.version,options:{xlsx:true,zip:true},projects:[{id:'demo',name:'Progetto test',scriptId:'1234567890'.repeat(2),diagnosticSettings:{cloudProjectId:'demo-cloud',days:7}},{id:'peer',name:'Altro progetto',scriptId:'9876543210'.repeat(2),diagnosticSettings:{cloudProjectId:'other-cloud',days:1}}],history:[],outputDir:'Cartella test',accessChecks:[]};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {pending.delete(id);reject(new Error('Browser timeout: '+method));}, 20000);
    pending.set(id, {resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
}
try {
  let port;
  for(let i=0;i<200;i++) {try {port=String(await fsp.readFile(path.join(profile,'DevToolsActivePort'))).split('\n')[0];break;}catch{}await delay(50);}
  if(!port) throw new Error('Browser di test non avviato.');
  const version=await (await fetch('http://127.0.0.1:'+port+'/json/version')).json();
  socket=new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message', async event => {
    const message=JSON.parse(event.data);
    if(message.id) {
      const task=pending.get(message.id);pending.delete(message.id);
      if(task) message.error?task.reject(new Error(message.error.message)):task.resolve(message.result);
    }
    if(message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if(message.method==='Page.loadEventFired') resolvePageLoaded?.(message.sessionId);
    if(message.method==='Fetch.requestPaused') {
      const route=new URL(message.params.request.url).pathname;
      let result;
      const functions=['gestionale_nightImport','gestionale_nightPrimaNota','gestionale_nightClients','gestionale_nightSuppliers','gestionale_nightMaintenance','gestionale_nightF24','gestionale_nightDeadlines','gestionale_nightAudit','gestionale_nightHome','gestionale_nightSupplierReminder','gestionale_nightTaxReminder','gestionale_repairFormulaErrors'];
      if(route==='/api/state') {
        if(message.params.request.method==='POST') {
          const payload=JSON.parse(message.params.request.postData);
          mockState.projects=payload.projects.map(p=>({...mockState.projects.find(old=>old.id===p.id),...p}));
          mockState.options=payload.options;mockState.outputDir=payload.outputDir;
        }
        result=mockState;
      }
      else if(route==='/api/diagnostics/settings') {const payload=JSON.parse(message.params.request.postData);const project=mockState.projects.find(p=>p.id===payload.projectId);project.diagnosticSettings=payload;result={projectId:project.id,settings:payload};}
      else if(route==='/api/triggers/inventory') {const payload=JSON.parse(message.params.request.postData);mockState.projects.find(p=>p.id===payload.projectId).triggerInventory=payload.inventory;result={inventory:payload.inventory};}
      else if(route==='/api/triggers/functions') result={functions,scriptId:'1234567890'.repeat(2),editorUrl:'https://example.invalid'};
      else if(route==='/api/triggers/prepare') {const rows=JSON.parse(message.params.request.postData).rows;result={id:'demo-plan',plan:rows,source:'function gwbApplyTriggerPlan() {}',changedFiles:['apps-script/GWB_Triggers.gs'],safetyBackupDirectory:'Cartella test'};}
      else if(route==='/api/ui-test-job') {jobStatus=JSON.parse(message.params.request.postData).status;result={};}
      else if(route==='/api/job') result={status:jobStatus,progress:100,logs:[],error:'Errore simulato'};
      else result={};
      try {await send('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(result)).toString('base64')},message.sessionId);}catch(error){errors.push(error.message);}
    }
  });
  const target=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  await send('Runtime.enable',{},sessionId);
  await send('Page.enable',{},sessionId);
  await send('Fetch.enable',{patterns:[{urlPattern:url+'/api/*',requestStage:'Request'}]},sessionId);
  const loaded=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Caricamento pagina di test scaduto.')),20000);
    resolvePageLoaded=id=>{if(id===sessionId){clearTimeout(timer);resolve();}};
  });
  await send('Page.navigate',{url},sessionId);
  await loaded;
  const expression=`(async()=>{
    const wait=async fn=>{for(let i=0;i<180;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Attesa UI fallita');};
    await wait(()=>document.querySelector('#diagnosticProject option') && document.querySelectorAll('#projectsBody tr').length===2);
    document.querySelector('#executionOption').checked=true;document.querySelector('#triggerOption').checked=true;document.querySelector('#executionDays').value='30';
    await saveSettings(false);
    if(document.querySelectorAll('.step').length!==5 || document.querySelector('#page-diagnostics') || document.querySelector('#collectDiagnosticsButton'))throw new Error('Sezione diagnostica duplicata ancora presente');
    document.querySelector('[data-page="backup"]').click();
    document.querySelector('#backupDiagnosticsDetails').open=true;
    if(document.querySelector('#diagnosticProject').closest('.page').id!=='page-backup')throw new Error('Impostazioni diagnostiche fuori dal Backup');
    document.querySelector('#diagnosticCloudId').value='main-cloud';
    document.querySelector('#saveDiagnosticSettingsButton').click();
    await wait(()=>!document.querySelector('#saveDiagnosticSettingsButton').disabled);
    const select=document.querySelector('#diagnosticProject');select.value='peer';select.dispatchEvent(new Event('change'));
    if(document.querySelector('#diagnosticCloudId').value!=='other-cloud')throw new Error('Impostazioni di un altro progetto perse');
    select.value='demo';select.dispatchEvent(new Event('change'));
    if(document.querySelector('#diagnosticCloudId').value!=='main-cloud')throw new Error('Cloud ID salvato non ripristinato');
    document.querySelector('#triggerInventoryInput').value=JSON.stringify({scriptId:'1234567890'.repeat(2),exportedAt:new Date().toISOString(),triggers:[{id:'clock-1',handler:'sync',eventType:'CLOCK'}]});
    document.querySelector('#readTriggerInventoryButton').click();
    await wait(()=>document.querySelector('#triggerInventoryOutput').textContent.includes('clock-1'));
    const saved=await api('/api/state');
    if(!saved.options.includeExecutions || !saved.options.includeTriggers || saved.options.executionDays!==30 || saved.projects[0].scriptId!=='1234567890'.repeat(2) || !saved.projects[0].triggerInventory)throw new Error('Scelte ZIP o ID non conservati');
    document.querySelector('#loadTriggerFunctionsButton').click();
    document.querySelector('#triggerPlanDetails').open=true;
    await wait(()=>!document.querySelector('#nightTriggerPresetButton').disabled);
    document.querySelector('#nightTriggerPresetButton').click();
    if(document.querySelectorAll('#triggerRowsBody tr').length!==12)throw new Error('Preset non completo');
    document.querySelector('#prepareTriggerPlanButton').click();
    await wait(()=>!document.querySelector('#triggerPlanPreview').hidden);
    const time=document.querySelector('.trigger-time');time.value='23:15';time.dispatchEvent(new Event('input',{bubbles:true}));
    if(!document.querySelector('#triggerPlanPreview').hidden)throw new Error('Anteprima obsoleta ancora attiva');
    for(const status of ['completed','completed_with_errors','error','cancelled']) {
      await api('/api/ui-test-job',{method:'POST',body:JSON.stringify({status})});
      switchPage('backup');await pollJob();
      const expected=['completed','completed_with_errors'].includes(status)?'page-ai':'page-backup';
      if(document.querySelector('.page.active').id!==expected)throw new Error('Pagina errata dopo il backup: '+status);
    }
    document.querySelector('[data-page="results"]').click();
    if(!document.querySelector('#page-results').classList.contains('active'))throw new Error('Risultati non raggiungibili manualmente');
    switchPage('backup');
    return true;
  })()`;
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
  if(result.exceptionDetails || result.result?.value!==true || errors.length) throw new Error('Test UI fallito: '+JSON.stringify(result.exceptionDetails || errors));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
  const mobile=await send('Runtime.evaluate',{expression:'document.documentElement.scrollWidth <= innerWidth + 1',returnByValue:true},sessionId);
  if(!mobile.result.value) throw new Error('Overflow della pagina su schermo stretto.');
  console.log('UI browser OK: 5 sezioni, impostazioni nel Backup, scelte ZIP, inventario, 12 regole, navigazione dopo successo/errore/annullamento e schermo stretto. API Google simulate.');
} finally {
  if(socket?.readyState===WebSocket.OPEN) {try{await send('Browser.close');}catch{}socket.close();}
  child.kill();await delay(500);await fsp.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
