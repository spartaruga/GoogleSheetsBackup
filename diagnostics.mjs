import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';
import { ZipArchive } from 'archiver';
import { loadAuth, safeName, validateProject } from './engine.mjs';

export function diagnosticRange(input = {}) {
  const days = Number(input.days ?? 7);
  if (![1, 7, 30].includes(days)) throw new Error('Periodo non valido: scegli 1, 7 o 30 giorni.');
  const end = input.endTime ? new Date(input.endTime) : new Date();
  const start = input.startTime ? new Date(input.startTime) : new Date(end.getTime() - days * 86400000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end - start > 31 * 86400000) throw new Error('Intervallo diagnostica non valido o superiore a 31 giorni.');
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

export async function collectPages(fetchPage, field, { maxItems = 5000, maxPages = 100, initialToken } = {}) {
  const items = [], seen = new Set();
  let token = initialToken;
  for (let page = 0; page < maxPages; page++) {
    if (token && seen.has(token)) throw new Error('Google ha ripetuto il cursore di pagina. Raccolta interrotta.');
    if (token) seen.add(token);
    const data = (await fetchPage(token)).data;
    const rows = data[field] || [];
    // Keep the entire last page; never discard rows behind a continuation token.
    items.push(...rows);
    token = data.nextPageToken || '';
    if (!token || items.length >= maxItems) return { items, nextPageToken: token, truncated: Boolean(token) };
  }
  return { items, nextPageToken: token, truncated: Boolean(token) };
}

function seconds(duration) {
  return /^\d+(?:\.\d+)?s$/.test(String(duration || '')) ? Number(duration.slice(0, -1)) : 0;
}

export function summarizeProcesses(processes) {
  const functions = Object.create(null);
  for (const run of processes) {
    const name = run.functionName || '(senza nome)';
    const row = functions[name] ||= { functionName: name, runs: 0, failed: 0, timedOut: 0, delayed: 0, slow: 0, maxSeconds: 0, totalSeconds: 0, automaticOutsideNight: 0 };
    const duration = seconds(run.duration);
    row.runs++; row.totalSeconds += duration; row.maxSeconds = Math.max(row.maxSeconds, duration);
    if (run.processStatus === 'FAILED') row.failed++;
    if (run.processStatus === 'TIMED_OUT') row.timedOut++;
    if (run.processStatus === 'DELAYED') row.delayed++;
    if (duration >= 270) row.slow++;
    if (run.processType === 'TIME_DRIVEN' && Number.isFinite(Date.parse(run.startTime))) {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(run.startTime));
      const hour = Number(parts.find(p => p.type === 'hour').value), minute = Number(parts.find(p => p.type === 'minute').value);
      if (hour * 60 + minute >= 510 && hour * 60 + minute < 1200) row.automaticOutsideNight++;
    }
  }
  return Object.values(functions).map(row => ({ ...row, averageSeconds: Number((row.totalSeconds / row.runs).toFixed(2)) }))
    .sort((a, b) => b.timedOut - a.timedOut || b.failed - a.failed || b.maxSeconds - a.maxSeconds);
}

export function csvProcesses(processes) {
  const quote = value => {
    let text = String(value ?? '');
    if (/^[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const fields = ['functionName', 'processType', 'processStatus', 'startTime', 'duration', 'userAccessLevel'];
  return '\uFEFF' + [fields, ...processes.map(run => fields.map(field => run[field] || ''))].map(row => row.map(quote).join(';')).join('\r\n') + '\r\n';
}

export async function collectDiagnostics({ project, credentialsPath, tokenPath, days = 7, cloudProjectId = '', cloudScriptKey = '', includeLogs = false, maxItems = 5000, startTime, endTime, api, loggingApi }) {
  const clean = validateProject(project);
  if (!clean.scriptId) throw new Error('Questo progetto non ha uno Script ID.');
  const range = diagnosticRange({ days, startTime, endTime });
  let auth;
  if (!api) { auth = await loadAuth(credentialsPath, tokenPath); api = google.script({ version: 'v1', auth }); }
  let executions;
  try {
    executions = await collectPages(token => api.processes.listScriptProcesses({
      scriptId: clean.scriptId, pageSize: 100, pageToken: token,
      'scriptProcessFilter.startTime': range.startTime, 'scriptProcessFilter.endTime': range.endTime,
    }, { timeout: 60000 }), 'processes', { maxItems });
  } catch (error) {
    throw new Error('Lettura esecuzioni non riuscita. Premi Abilita diagnostica, verifica Apps Script API e l’accesso al progetto. ' + (error?.response?.data?.error?.message || error.message));
  }
  const report = {
    formatVersion: '1.0', collectedAt: new Date().toISOString(), project: { id: clean.id, name: clean.name, scriptId: clean.scriptId }, range,
    executions, summary: summarizeProcesses(executions.items), warnings: [], cloudLogs: null, versions: [], deployments: [],
    limitations: [
      'Lo storico API contiene funzione, stato, tipo, inizio e durata; non contiene messaggi di errore o stack trace.',
      'I messaggi dettagliati dipendono dai log Cloud conservati e dai permessi sul progetto Cloud dello script.',
      'La disponibilità dello storico dipende da Google e dai permessi dell’account. Zero risultati non dimostra assenza di errori.',
      'Le esecuzioni automatiche fuori fascia sono segnalate; i controlli formule possono essere eccezioni intenzionali.',
    ],
  };
  if (executions.truncated) report.warnings.push('Storico parziale: raggiunto il limite di raccolta. Riduci il periodo. Il cursore successivo è conservato nel JSON.');
  for (const [field, method] of [['versions', api.projects?.versions], ['deployments', api.projects?.deployments]]) {
    if (!method?.list) continue;
    try {
      const result = await collectPages(token => method.list({ scriptId: clean.scriptId, pageSize: 50, pageToken: token }, { timeout: 30000 }), field, { maxItems: 500 });
      report[field] = result.items;
      if (result.truncated) report.warnings.push(field + ': elenco parziale.');
    } catch (error) { report.warnings.push(field + ': ' + (error?.response?.data?.error?.message || error.message)); }
  }
  if (includeLogs) {
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(cloudProjectId)) throw new Error('Inserisci l’ID del progetto Cloud dello script per leggere i log.');
    const key = cloudScriptKey || clean.scriptId;
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(key)) throw new Error('Chiave script per i log non valida.');
    try {
      const logging = loggingApi || google.logging({ version: 'v2', auth: auth || await loadAuth(credentialsPath, tokenPath) });
      report.cloudLogs = await collectPages(token => logging.entries.list({ requestBody: {
        resourceNames: ['projects/' + cloudProjectId],
        filter: 'resource.type="app_script_function" AND labels."script.googleapis.com/project_key"="' + key + '" AND timestamp>="' + range.startTime + '" AND timestamp<="' + range.endTime + '"',
        orderBy: 'timestamp desc', pageSize: 100, pageToken: token,
      } }, { timeout: 60000 }), 'entries', { maxItems });
      if (report.cloudLogs.truncated) report.warnings.push('Log Cloud parziali: riduci il periodo.');
      if (!report.cloudLogs.items.length) report.warnings.push('Nessun log Cloud trovato: verifica il progetto Cloud, la chiave project_key, i permessi e la conservazione.');
    } catch (error) { report.warnings.push('Log Cloud non disponibili: ' + (error?.response?.data?.error?.message || error.message)); }
  }
  return report;
}

export async function saveDiagnosticReport(report, outputDir) {
  const name = 'DIAGNOSTICA_' + safeName(report.project.name) + '_' + new Date().toISOString().replace(/[:.]/g, '-') ;
  const directory = path.join(path.resolve(outputDir), name);
  await fsp.mkdir(path.resolve(outputDir), { recursive: true });
  await fsp.mkdir(directory, { recursive: false });
  await fsp.writeFile(path.join(directory, 'esecuzioni.json'), JSON.stringify(report, null, 2));
  await fsp.writeFile(path.join(directory, 'esecuzioni.csv'), csvProcesses(report.executions.items));
  const lines = ['# Diagnostica Apps Script', '', report.project.name, '', ...report.summary.map(row => `- ${row.functionName}: ${row.runs} esecuzioni; ${row.failed} errori; ${row.timedOut} timeout; durata massima ${row.maxSeconds}s; ${row.automaticOutsideNight} avvii automatici fuori 20:00–08:30.`), '', '## Avvisi', '', ...report.warnings.map(w => '- ' + w), '', ...report.limitations.map(w => '- ' + w), '', 'Questi file possono contenere dati personali o segreti presenti nei log. Controllali prima di condividerli.'];
  await fsp.writeFile(path.join(directory, 'LEGGIMI.md'), lines.join('\n') + '\n');
  const zipPath = directory + '.zip';
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath), archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve); output.on('error', reject); archive.on('error', reject);
    archive.pipe(output); archive.directory(directory, false); archive.finalize().catch(reject);
  });
  return { directory, zipPath };
}
