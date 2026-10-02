// Uses the existing local API, authentication UI and toast helpers in app.js.
(() => {
  const $ = id => document.getElementById(id);
  let functions = [], scriptId = '', prepared = null, revision = 0;
  let knownProjects = new Map(), loadedProjectKey = '';
  function invalidatePlan() { revision++; prepared = null; $('triggerPlanPreview').hidden = true; }
  function projectId() {
    const id = $('diagnosticProject').value;
    if (!id) throw new Error('Aggiungi e salva un progetto con Script ID.');
    return id;
  }
  function projects(state) {
    const select = $('diagnosticProject'), previous = select.value;
    const rows = (state.projects || []).filter(p => p.scriptId);
    knownProjects = new Map(rows.map(p=>[String(p.id),p]));
    select.replaceChildren(...rows.map(p => new Option(p.name, p.id)));
    if (rows.some(p => String(p.id) === previous)) select.value = previous;
    const selected=knownProjects.get(select.value);
    if(`${select.value}:${selected?.scriptId || ''}`!==loadedProjectKey) resetProject();
  }
  function resetProject() {
    const project=knownProjects.get($('diagnosticProject').value);
    loadedProjectKey=`${$('diagnosticProject').value}:${project?.scriptId || ''}`;
    functions = []; scriptId = project?.scriptId || ''; invalidatePlan();
    $('triggerRowsBody').replaceChildren(); $('triggerInventoryOutput').textContent = '';
    const settings=project?.diagnosticSettings || {};
    $('includeCloudLogs').checked=settings.includeLogs===true;
    $('diagnosticCloudId').value=settings.cloudProjectId || '';
    $('diagnosticCloudKey').value=settings.cloudScriptKey || '';
    $('triggerInventoryInput').value=project?.triggerInventory?JSON.stringify(project.triggerInventory,null,2):'';
    if(project?.triggerInventory) renderInventory(project.triggerInventory);
    for (const id of ['addTriggerRowButton', 'nightTriggerPresetButton', 'prepareTriggerPlanButton']) $(id).disabled = true;
  }
  function settingsPayload() {
    return {projectId:projectId(),days:Number($('executionDays').value),includeLogs:$('includeCloudLogs').checked,cloudProjectId:$('diagnosticCloudId').value.trim(),cloudScriptKey:$('diagnosticCloudKey').value.trim()};
  }
  function renderInventory(data) {
    $('triggerInventoryOutput').textContent='Rilevato il '+new Date(data.exportedAt).toLocaleString('it-IT')+' · copia salvata\n'+(data.triggers.map(t=>`${t.handler} · ${t.eventType} · ${t.id} · ${t.schedule?JSON.stringify(t.schedule):'orario non esposto da Google'}`).join('\n') || 'Nessun trigger per l’account che ha eseguito l’esportazione.');
  }
  async function busy(button, fn) {
    const text = button.textContent; button.disabled = true; button.textContent = 'Attendi…';
    try { await fn(); } catch (error) { showToast(error.message, true); }
    finally { button.disabled = false; button.textContent = text; }
  }
  function downloadText(name, content) {
    const url = URL.createObjectURL(new Blob([content], {type:'text/plain;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function select(options, value) {
    const el = document.createElement('select');
    for (const [key, label] of options) el.append(new Option(label, key));
    el.value = value; return el;
  }
  function addRow(data = {}) {
    invalidatePlan();
    const row = document.createElement('tr');
    const handler = select(functions.map(f => [f, f]), data.handler || functions[0]); handler.className = 'trigger-handler';
    const action = select([['replace','Crea / sostituisci'],['delete','Rimuovi orari']], data.action || 'replace'); action.className = 'trigger-action';
    const kind = select([['daily','Giornaliero'],['weekly','Settimanale'],['minutes','Ogni N minuti'],['hours','Ogni N ore']], data.kind || 'daily'); kind.className = 'trigger-kind';
    const parameters = document.createElement('div');
    const time = document.createElement('input'); time.type = 'time'; time.value = `${String(data.hour ?? 22).padStart(2,'0')}:${String(data.minute ?? 0).padStart(2,'0')}`; time.className = 'trigger-time';
    const interval = document.createElement('input'); interval.type = 'number'; interval.min = '1'; interval.max = '30'; interval.value = String(data.interval || 15); interval.className = 'trigger-interval';
    parameters.append(time, interval);
    const day = select([['MONDAY','Lunedì'],['TUESDAY','Martedì'],['WEDNESDAY','Mercoledì'],['THURSDAY','Giovedì'],['FRIDAY','Venerdì'],['SATURDAY','Sabato'],['SUNDAY','Domenica']], data.weekDay || 'MONDAY'); day.className = 'trigger-day';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button small danger-quiet'; remove.textContent = 'Togli regola'; remove.onclick = () => {row.remove(); invalidatePlan();};
    for (const el of [handler, action, kind, parameters, day, remove]) {const td = document.createElement('td');td.append(el);row.append(td);}
    function showParameters() {
      const repeating = ['minutes','hours'].includes(kind.value);
      time.hidden = repeating; interval.hidden = !repeating; day.disabled = kind.value !== 'weekly' || action.value === 'delete';
      time.disabled = interval.disabled = kind.disabled = action.value === 'delete';
    }
    row.addEventListener('change', () => {showParameters();invalidatePlan();});
    row.addEventListener('input', invalidatePlan); showParameters(); $('triggerRowsBody').append(row);
  }
  function rows() {
    return [...$('triggerRowsBody').children].map(row => {
      const [hour, minute] = row.querySelector('.trigger-time').value.split(':').map(Number);
      return {handler:row.querySelector('.trigger-handler').value, action:row.querySelector('.trigger-action').value,
        kind:row.querySelector('.trigger-kind').value, hour, minute, interval:Number(row.querySelector('.trigger-interval').value), weekDay:row.querySelector('.trigger-day').value, timeZone:'Europe/Rome'};
    });
  }
  window.addEventListener('gwb-state', event => projects(event.detail));
  $('diagnosticProject').addEventListener('change', resetProject);
  $('enableDiagnosticsButton').addEventListener('click', () => accountAction('diagnostics'));
  $('saveDiagnosticSettingsButton').addEventListener('click',event=>busy(event.currentTarget,async()=>{
    const payload=settingsPayload();
    const result=await api('/api/diagnostics/settings',{method:'POST',body:JSON.stringify(payload)});
    if(knownProjects.has(payload.projectId)) knownProjects.get(payload.projectId).diagnosticSettings=result.settings;
    showToast('Impostazioni del progetto salvate. Verranno riutilizzate nei prossimi ZIP.');
  }));
  $('checkUpdatesButton').addEventListener('click', event => busy(event.currentTarget, async () => {
    const result = await api('/api/updates');
    if (!result.available) return showToast(result.message || `Versione ${result.currentVersion} aggiornata.`);
    if (window.confirm(`Disponibile versione ${result.latestVersion}. Aprire la Release ufficiale per scaricare l’installer?`)) window.open(result.releaseUrl, '_blank', 'noopener,noreferrer');
  }));
  $('loadTriggerFunctionsButton').addEventListener('click', event => busy(event.currentTarget, async () => {
    const selected = projectId();
    const result = await api('/api/triggers/functions', {method:'POST',body:JSON.stringify({projectId:selected})});
    if(selected!==projectId()) throw new Error('Il progetto è cambiato. Leggi nuovamente le funzioni.');
    functions = result.functions; scriptId = result.scriptId; $('triggerRowsBody').replaceChildren(); invalidatePlan();
    $('openTriggerEditor').href = result.editorUrl;
    for (const id of ['addTriggerRowButton', 'nightTriggerPresetButton', 'prepareTriggerPlanButton']) $(id).disabled = !functions.length;
    if (functions.length) addRow(); showToast(`${functions.length} funzioni lette.`);
  }));
  $('addTriggerRowButton').addEventListener('click', () => addRow());
  $('nightTriggerPresetButton').addEventListener('click', () => {
    const jobs = [
      ['gestionale_nightImport',20,30],['gestionale_nightPrimaNota',21,15],['gestionale_nightClients',22,0],['gestionale_nightSuppliers',23,0],
      ['gestionale_nightMaintenance',0,30],['gestionale_nightF24',1,30],['gestionale_nightDeadlines',3,0],['gestionale_nightAudit',4,30],['gestionale_nightHome',6,45],
      ['gestionale_nightSupplierReminder',7,30,'weekly'],['gestionale_nightTaxReminder',8,0,'weekly'],['gestionale_repairFormulaErrors',0,0,'minutes'],
    ];
    if (!jobs.every(j => functions.includes(j[0]))) return showToast('Prima pubblica gli Apps Script con le funzioni notturne del gestionale.', true);
    $('triggerRowsBody').replaceChildren(); for(const [handler,hour,minute,kind='daily'] of jobs) addRow({handler,hour,minute,kind,interval:15});
    showToast('Preset caricato. Sostituisce solo gli handler elencati; i vecchi handler diversi vanno rimossi separatamente.');
  });
  $('prepareTriggerPlanButton').addEventListener('click', event => busy(event.currentTarget, async () => {
    const expectedRevision = revision;
    const result = await api('/api/triggers/prepare', {method:'POST',body:JSON.stringify({projectId:projectId(),rows:rows()})});
    if(revision!==expectedRevision) throw new Error('Le regole sono cambiate. Prepara una nuova anteprima.');
    prepared = result;
    $('triggerPlanSource').textContent = prepared.source;
    $('triggerPlanSummary').textContent = `${prepared.plan.length} regole. File: ${prepared.changedFiles.join(', ')}. Copia di sicurezza: ${prepared.safetyBackupDirectory}`;
    $('triggerPlanStatus').textContent = 'Anteprima pronta. Nessun trigger è stato modificato.';
    $('triggerPlanPreview').hidden = false; $('openTriggerEditor').hidden = true; $('publishTriggerPlanButton').disabled = false;
  }));
  $('downloadTriggerSourceButton').addEventListener('click', () => {if(prepared) downloadText('GWB_Triggers.gs', prepared.source);});
  $('publishTriggerPlanButton').addEventListener('click', event => busy(event.currentTarget, async () => {
    if (!prepared) throw new Error('Prepara una nuova anteprima.');
    if (!window.confirm('Pubblicare il codice del piano su Google? I trigger cambieranno solo quando eseguirai gwbApplyTriggerPlan in Apps Script.')) return;
    const result = await api('/api/triggers/publish', {method:'POST',body:JSON.stringify({planId:prepared.id})});
    $('triggerPlanStatus').textContent = result.message; $('openTriggerEditor').href = result.editorUrl; $('openTriggerEditor').hidden = false;
  }));
  $('readTriggerInventoryButton').addEventListener('click', event => busy(event.currentTarget,async()=>{
      const selected=projectId();
      const data = JSON.parse($('triggerInventoryInput').value);
      const result=await api('/api/triggers/inventory',{method:'POST',body:JSON.stringify({projectId:selected,inventory:data})});
      if(knownProjects.has(selected)) knownProjects.get(selected).triggerInventory=result.inventory;
      if(selected===projectId()) {$('triggerInventoryInput').value=JSON.stringify(result.inventory,null,2);renderInventory(result.inventory);}
      showToast('Inventario salvato. Puoi includerlo nei successivi ZIP.');
  }));
  api('/api/state').then(projects).catch(() => {});
})();
