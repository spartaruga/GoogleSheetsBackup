import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import { triggerSource, validateTriggerPlan, prepareTriggerPlan } from '../triggers.mjs';
import { temporary } from './helpers.mjs';
const id='1234567890'.repeat(2);
const plan=[{handler:'jobA',kind:'daily',hour:22},{handler:'jobB',kind:'daily',hour:23}];
function sandbox(rows=plan) {
  let count=0, failCreate='', failDelete=false, peak=0;
  const triggers=[],properties={};
  const props={getProperty:k=>properties[k]||null,setProperty:(k,v)=>{properties[k]=v;},deleteProperty:k=>{delete properties[k];}};
  const make=(handler,event='CLOCK')=>{const trigger={getUniqueId:()=>String(++count)};const key=String(++count);Object.assign(trigger,{getUniqueId:()=>key,getHandlerFunction:()=>handler,getEventType:()=>event,getTriggerSource:()=> 'CLOCK',getTriggerSourceId:()=>null});triggers.push(trigger);return trigger;};
  const api={EventType:{CLOCK:'CLOCK'},WeekDay:{MONDAY:'MONDAY'},getScriptId:()=>id,getProjectTriggers:()=>triggers.slice(),deleteTrigger:t=>{if(failDelete){failDelete=false;throw new Error('delete failed');}triggers.splice(triggers.indexOf(t),1);},newTrigger(handler){
    const b={};for(const method of ['timeBased','inTimezone','atHour','nearMinute','everyMinutes','everyHours','everyDays','everyWeeks','onWeekDay'])b[method]=()=>b;
    b.create=()=>{if(handler===failCreate)throw new Error('create failed');if(triggers.length>=20)throw new Error('quota');const t=make(handler);peak=Math.max(peak,triggers.length);return t;};return b;
  }};
  const context=vm.createContext({ScriptApp:api,PropertiesService:{getUserProperties:()=>props},LockService:{getUserLock:()=>({tryLock:()=>true,releaseLock(){}})},console:{log(){}}});
  vm.runInContext(triggerSource(validateTriggerPlan(rows,rows.map(r=>r.handler)),'plan-test'),context);
  return {context,triggers,properties,make,failCreate:handler=>{failCreate=handler;},failDelete:()=>{failDelete=true;},peak:()=>peak};
}
test('trigger plan validates functions, duplicate handlers, schedules and injection attempts', () => {
  for(const rows of [[{handler:'unknown',hour:22}],[{handler:'jobA',hour:24}],[{handler:'jobA',kind:'minutes',interval:2}],[{handler:'jobA);evil()',hour:22}],[...plan,plan[0]]])assert.throws(()=>validateTriggerPlan(rows,['jobA','jobB']));
});
test('clock replacements preserve unrelated and event triggers and repeat safely', () => {
  const e=sandbox();e.make('jobA');e.make('jobA');e.make('jobB');const other=e.make('other');const event=e.make('jobA','ON_EDIT');
  e.context.gwbApplyTriggerPlan();const before=e.triggers.map(t=>t.getUniqueId());e.context.gwbApplyTriggerPlan();
  assert.deepEqual(e.triggers.map(t=>t.getUniqueId()),before);assert(e.triggers.includes(other));assert(e.triggers.includes(event));assert.equal(e.triggers.filter(t=>t.getEventType()==='CLOCK'&&t.getHandlerFunction()==='jobA').length,1);
});
test('a partially applied plan resumes at the failed row without repeating earlier replacements', () => {
  const e=sandbox();e.make('jobA');e.make('jobB');e.failCreate('jobB');assert.throws(()=>e.context.gwbApplyTriggerPlan(),/create failed/);
  assert.equal(JSON.parse(e.properties.GWB_TRIGGER_PENDING).index,1);const installedA=e.triggers.find(t=>t.getHandlerFunction()==='jobA').getUniqueId();
  e.failCreate('');e.context.gwbApplyTriggerPlan();assert.equal(e.triggers.find(t=>t.getHandlerFunction()==='jobA').getUniqueId(),installedA);assert.equal(e.triggers.length,2);
});
test('failure deleting an old trigger resumes with the already created replacement', () => {
  const e=sandbox([plan[0]]);e.make('jobA');e.failDelete();assert.throws(()=>e.context.gwbApplyTriggerPlan(),/delete failed/);assert.equal(e.triggers.length,2);
  const replacement=e.triggers[1];e.context.gwbApplyTriggerPlan();assert.deepEqual(e.triggers,[replacement]);
});
test('twelve replacements never temporarily double the trigger count', () => {
  const rows=Array.from({length:12},(_,i)=>({handler:'job'+i,kind:'daily',hour:22}));const e=sandbox(rows);rows.forEach(r=>e.make(r.handler));e.context.gwbApplyTriggerPlan();assert.equal(e.triggers.length,12);assert.equal(e.peak(),13);
});
test('deletion rule removes only matching clocks and does not create a trigger', () => {
  const e=sandbox([{handler:'jobA',action:'delete'}]);e.make('jobA');const event=e.make('jobA','ON_EDIT');e.context.gwbApplyTriggerPlan();assert.deepEqual(e.triggers,[event]);
});
test('preparation preserves protected sources and stores a full baseline before publishing', async t => {
  const directory=await temporary(t);
  const content={files:[{name:'Code',type:'SERVER_JS',source:'function jobA() {}\nfunction jobB() {}'},{name:'Config',type:'SERVER_JS',source:'var x=1;'},{name:'appsscript',type:'JSON',source:JSON.stringify({oauthScopes:['scope-existing'],timeZone:'Europe/Rome'})}]};
  const project={id:'demo',name:'Demo',scriptId:id,protectedFiles:['apps-script/Config.gs']};const api={projects:{getContent:async()=>({data:structuredClone(content)})}};
  const result=await prepareTriggerPlan({project,rows:plan,api,directory});
  assert.equal(await fs.readFile(path.join(result.sourceDirectory,'apps-script/Config.gs'),'utf8'),'var x=1;');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.baselineDirectory,'apps-script/_content-api.json'))),content);
  const manifest=JSON.parse(await fs.readFile(path.join(result.sourceDirectory,'apps-script/appsscript.json')));assert(manifest.oauthScopes.includes('scope-existing'));assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.scriptapp'));
  project.protectedFiles.push('apps-script/appsscript.json');await assert.rejects(prepareTriggerPlan({project,rows:plan,api,directory}),/intoccabile/);
});
