import http from "node:http";
import { claimInstance } from "./instance.mjs";
import { openBrowser } from "./browser.mjs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  authorizeInteractive,
  appsScriptDirectoryDigest,
  backupProjects,
  rehydrateRedactions,
  scanProjectsForSecrets,
  publishAppsScriptProject,
  normalizeAiPath,
  tokenProtectionStatus,
  testConnection,
  validateCredentialsFile,
  validateProject,
} from "./engine.mjs";

let PORT = Number(process.env.GWB_PORT ?? 47831);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error("Porta non valida.");
const HOST = "127.0.0.1";
const BASE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION = JSON.parse(await fsp.readFile(path.join(BASE_DIR, "package.json"), "utf8")).version;
const DATA_DIR = process.env.GWB_DATA_DIR || (process.platform === "win32"
  ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "GoogleWorkspaceBackup")
  : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "GoogleWorkspaceBackup"));
const STATE_PATH = path.join(DATA_DIR, "state.json");
const CREDENTIALS_PATH = path.join(DATA_DIR, "credentials.json");
const TOKEN_PATH = path.join(DATA_DIR, "token.json");
const DEFAULT_OUTPUT = path.join(os.homedir(), "Downloads", "GoogleWorkspaceBackup");

const DEFAULT_STATE = {
  version: 3,
  outputDir: DEFAULT_OUTPUT,
  options: { xlsx: true, zip: true },
  projects: [],
  history: [],
  account: null,
  accessChecks: [],
  accessCheckedAt: null,
};

let state = structuredClone(DEFAULT_STATE);
let activeJob = null;
let pendingAiPackage = null;
let requestBusy = false;
let shuttingDown = false;

async function fileExists(filePath) {
  try { await fsp.access(filePath); return true; } catch { return false; }
}

async function loadState() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  if (!(await fileExists(STATE_PATH))) return;
  try {
    const saved = JSON.parse(await fsp.readFile(STATE_PATH, "utf8"));
    state = {
      ...structuredClone(DEFAULT_STATE),
      ...saved,
      options: { ...DEFAULT_STATE.options, ...(saved.options || {}) },
      projects: Array.isArray(saved.projects) ? saved.projects : [],
      history: Array.isArray(saved.history)
        ? saved.history.slice(0, 20).map((item) => ({
          ...item,
          id: item.id || crypto.randomUUID(),
          type: item.type || "backup",
        }))
        : [],
    };
  } catch {
    throw new Error("state.json non leggibile. Il file è stato conservato: ripristina una copia valida prima di riavviare.");
  }
}

async function saveState() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const temporaryPath = `${STATE_PATH}.tmp`;
  await fsp.writeFile(temporaryPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fsp.rename(temporaryPath, STATE_PATH);
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function readJson(request, maxBytes = 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Richiesta troppo grande.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Dati JSON non validi.");
  }
}

function checkLocalRequest(request) {
  const host = String(request.headers.host || "");
  if (![`${HOST}:${PORT}`, `localhost:${PORT}`].includes(host)) return false;
  const origin = request.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) {
    return request.headers["x-app-request"] === "GoogleWorkspaceBackup"
      && /^application\/json(?:;|$)/i.test(request.headers["content-type"] || "");
  }
  return true;
}

async function publicState() {
  let credentials = null;
  if (await fileExists(CREDENTIALS_PATH)) {
    try { credentials = await validateCredentialsFile(CREDENTIALS_PATH); } catch (error) { credentials = { error: error.message }; }
  }
  return {
    appVersion: APP_VERSION,
    nodeVersion: process.version,
    platform: process.platform,
    dataDirectory: DATA_DIR,
    outputDir: state.outputDir,
    options: state.options,
    projects: state.projects,
    history: state.history,
    credentialsConfigured: Boolean(credentials && !credentials.error),
    credentials,
    tokenConfigured: await fileExists(TOKEN_PATH),
    tokenProtection: await tokenProtectionStatus(TOKEN_PATH),
    account: state.account,
    accessChecks: state.accessChecks,
    accessCheckedAt: state.accessCheckedAt,
    activeJob: activeJob ? { id: activeJob.id, status: activeJob.status, progress: activeJob.progress } : null,
  };
}

async function saveProjects(payload) {
  if (!Array.isArray(payload.projects)) throw new Error("Elenco progetti non valido.");
  const projects = payload.projects.map((project) => {
    const id = String(project.id || crypto.randomUUID());
    const previous = state.projects.find((item) => String(item.id) === id);
    return {
      ...validateProject(project),
      id,
      protectedFiles: Array.isArray(project.protectedFiles)
        ? [...new Set(project.protectedFiles.map(String))]
        : [...new Set((previous?.protectedFiles || []).map(String))],
    };
  });
  const outputDir = String(payload.outputDir || "").trim();
  if (!outputDir) throw new Error("La cartella di destinazione è obbligatoria.");
  state.projects = projects;
  state.outputDir = path.resolve(outputDir);
  state.options = {
    xlsx: payload.options?.xlsx !== false,
    zip: payload.options?.zip !== false,
  };
  await saveState();
}

function addJobLog(job, level, message, project = "") {
  job.logs.push({ time: new Date().toISOString(), level, message, project });
  if (job.logs.length > 1000) job.logs.splice(0, job.logs.length - 1000);
}

async function startBackup(payload) {
  if (activeJob?.status === "running") throw new Error("Un backup è già in corso.");
  const selectedIds = Array.isArray(payload.projectIds) ? new Set(payload.projectIds.map(String)) : null;
  const projects = state.projects.filter((project) => project.enabled !== false && (!selectedIds || selectedIds.has(String(project.id))));
  if (!projects.length) throw new Error("Nessun progetto attivo selezionato.");
  const filePolicies = payload.filePolicies && typeof payload.filePolicies === "object" ? payload.filePolicies : {};
  for (const project of projects) {
    const projectPolicies = filePolicies[String(project.id)] || {};
    const protectedSet = new Set((project.protectedFiles || []).map(String));
    const policyEntries = Object.entries(projectPolicies);
    if (project.scriptId && policyEntries.length) {
      const currentPaths = new Set(policyEntries.map(([relativePath]) => String(relativePath).replace(/\\/g, "/").toLowerCase()));
      for (const protectedPath of [...protectedSet]) {
        if (!currentPaths.has(String(protectedPath).replace(/\\/g, "/").toLowerCase())) protectedSet.delete(protectedPath);
      }
    }
    for (const [relativePath, policy] of policyEntries) {
      const normalized = String(relativePath).replace(/\\/g, "/");
      if (!normalized.startsWith("apps-script/") || normalized.includes("..")) continue;
      if (policy?.protected === true || policy?.action === "exclude") protectedSet.add(normalized);
      else if (policy?.protected === false) protectedSet.delete(normalized);
    }
    project.protectedFiles = [...protectedSet].sort();
  }
  await saveState();
  const job = {
    id: crypto.randomUUID(),
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    logs: [],
    progress: 0,
    cancelRequested: false,
    result: null,
    error: null,
  };
  activeJob = job;
  addJobLog(job, "info", `Avvio backup di ${projects.length} progetti.`);
  void (async () => {
    try {
      const result = await backupProjects({
        projects,
        outputDir: state.outputDir,
        credentialsPath: CREDENTIALS_PATH,
        tokenPath: TOKEN_PATH,
        options: state.options,
        filePolicies,
        shouldCancel: () => job.cancelRequested,
        onEvent: (event) => {
          if (Number.isFinite(event.progress)) job.progress = Math.max(0, Math.min(100, event.progress));
          if (event.message) addJobLog(job, event.level, event.message, event.project);
        },
      });
      job.result = result;
      job.status = result.cancelled ? "cancelled" : result.failed ? "completed_with_errors" : "completed";
      if (!result.cancelled) job.progress = 100;
      const successfulResults = result.results.filter((item) => item.status === "ok");
      for (const item of successfulResults) {
        const sourceProject = projects.find((project) => String(project.id || "") === String(item.projectId || ""))
          || projects.find((project) => project.name === item.project);
        state.history.unshift({
          id: crypto.randomUUID(),
          projectId: item.projectId || sourceProject?.id || "",
          project: item.project,
          type: "backup",
          completedAt: new Date().toISOString(),
          directory: item.directory,
          zipPath: item.zipPath,
          aiZipPath: item.aiZipPath || item.zipPath,
        });
      }
      state.history = state.history.slice(0, 20);
      await saveState();
      if (result.cancelled) {
        addJobLog(job, "warn", `Operazione annullata. Completati prima dell'annullamento: ${result.succeeded}.`);
      } else {
        addJobLog(job, result.failed ? "warn" : "ok", `Operazione terminata. Riusciti: ${result.succeeded}. Falliti: ${result.failed}.`);
      }
    } catch (error) {
      job.status = "error";
      job.error = error?.message || String(error);
      addJobLog(job, "error", job.error);
    } finally {
      job.finishedAt = new Date().toISOString();
    }
  })();
  return job;
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], { windowsHide: false });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(errorOutput.trim() || `PowerShell ha restituito ${code}.`));
    });
  });
}

async function chooseFolder() {
  if (process.platform !== "win32") return state.outputDir;
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Scegli la cartella principale dei backup'",
    `$dialog.SelectedPath = '${String(state.outputDir).replace(/'/g, "''")}'`,
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
  ].join("; ");
  return runPowerShell(script);
}

function openOutputFolder() {
  const target = path.resolve(state.outputDir);
  if (process.platform === "win32") spawn("explorer.exe", [target], { detached: true, stdio: "ignore" }).unref();
  else if (process.platform === "darwin") spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
}

function pathInside(baseDirectory, relativePath) {
  const base = path.resolve(baseDirectory);
  const target = path.resolve(base, ...relativePath.split("/"));
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error("Percorso fuori dalla cartella del progetto.");
  return target;
}

async function sha256(filePath) {
  const bytes = await fsp.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function resolvePackageProject(aiPackage) {
  const id = String(aiPackage?.project?.id || "");
  const name = String(aiPackage?.project?.name || "");
  const byId = state.projects.find((project) => String(project.id) === id);
  if (byId) return byId;
  const byName = state.projects.filter((project) => project.name === name);
  if (byName.length === 1) return byName[0];
  throw new Error("Il progetto indicato dal file AI non è presente o è ambiguo.");
}

function latestOriginalBackup(project) {
  const isOriginal = (item) => item.type !== "ai_modified" && item.type !== "safety_backup" && item.directory;
  const byId = state.history.find((item) => isOriginal(item) && String(item.projectId || "") === String(project.id || ""));
  if (byId) return byId;
  return state.history.find((item) => isOriginal(item) && !item.projectId && item.project === project.name);
}

async function inspectAiPackage(aiPackage) {
  if (aiPackage?.formatVersion !== "1.0") throw new Error("Versione del pacchetto AI non supportata.");
  if (!String(aiPackage.summary || "").trim()) throw new Error("Manca il riepilogo delle modifiche.");
  if (!Array.isArray(aiPackage.operations) || aiPackage.operations.length === 0) throw new Error("Il pacchetto AI non contiene operazioni.");
  if (aiPackage.operations.length > 100) throw new Error("Il pacchetto contiene troppe operazioni.");
  const project = resolvePackageProject(aiPackage);
  const baseline = latestOriginalBackup(project);
  if (!baseline || !(await fileExists(baseline.directory))) throw new Error("Manca un backup locale di partenza per questo progetto.");
  const sourceBackupId = String(aiPackage.sourceBackupId || "").trim();
  if (!sourceBackupId) throw new Error("Manca l'identificativo del backup di partenza.");
  if (path.basename(baseline.directory) !== sourceBackupId) {
    throw new Error("Il pacchetto AI è stato creato su una versione diversa dall'ultimo backup locale.");
  }
  const localManifestPath = path.join(baseline.directory, "ai-export-manifest.local.json");
  if (!(await fileExists(localManifestPath))) throw new Error("Questo backup non contiene il manifesto locale richiesto. Crea un nuovo backup con questa versione del programma.");
  const localManifest = JSON.parse(await fsp.readFile(localManifestPath, "utf8"));
  const aiHashes = new Map((localManifest.aiManifest?.includedFiles || []).map((item) => [String(item.path).toLowerCase(), String(item.sha256).toLowerCase()]));
  const originalHashes = new Map((localManifest.originalFiles || []).map((item) => [String(item.path).toLowerCase(), String(item.sha256).toLowerCase()]));
  const redactedPaths = new Set((localManifest.aiManifest?.redactions || []).map((item) => String(item.path).toLowerCase()));
  const protectedSet = new Set((project.protectedFiles || []).map((item) => String(item).toLowerCase()));

  const scriptDirectory = path.join(baseline.directory, "apps-script");
  if (await fileExists(scriptDirectory)) {
    const currentFiles = (await fsp.readdir(scriptDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => ({ path: `apps-script/${entry.name}`, key: `apps-script/${entry.name}`.toLowerCase() }));
    const currentFileKeys = new Set(currentFiles.map((item) => item.key));
    const expectedFiles = [...originalHashes.keys()].filter((relativePath) => relativePath.startsWith("apps-script/"));
    if (currentFiles.some((item) => !originalHashes.has(item.key)) || expectedFiles.some((relativePath) => !currentFileKeys.has(relativePath))) {
      throw new Error("Il backup locale di partenza è stato alterato: l'elenco dei file Apps Script non coincide.");
    }
    for (const file of currentFiles) {
      const currentHash = await sha256(pathInside(baseline.directory, file.path));
      if (currentHash !== originalHashes.get(file.key)) {
        throw new Error(`Il backup locale di partenza è stato alterato: ${file.path}.`);
      }
    }
  }

  const operations = [];
  const operationPaths = new Set();
  for (let index = 0; index < aiPackage.operations.length; index += 1) {
    const operation = aiPackage.operations[index];
    const action = String(operation?.action || "");
    if (!['replace', 'create', 'delete'].includes(action)) throw new Error(`Operazione ${index + 1}: azione non valida.`);
    const relativePath = normalizeAiPath(operation.path);
    const operationKey = relativePath.toLowerCase();
    if (operationPaths.has(operationKey)) throw new Error(`Operazione ${index + 1}: il file ${relativePath} è indicato più di una volta.`);
    operationPaths.add(operationKey);
    if (action === "delete" && operationKey === "apps-script/appsscript.json") {
      throw new Error("Il manifest apps-script/appsscript.json non può essere eliminato.");
    }
    const target = pathInside(baseline.directory, relativePath);
    const isProtected = protectedSet.has(relativePath.toLowerCase());
    const existsNow = await fileExists(target);
    let status = "ready";
    let detail = "Pronta";
    if (isProtected) {
      status = "blocked_protected";
      detail = "Bloccata: file intoccabile";
    } else if (action === "create" && existsNow) {
      status = "conflict";
      detail = "Conflitto: il file esiste già";
    } else if (['replace', 'delete'].includes(action) && !existsNow) {
      status = "conflict";
      detail = "Conflitto: il file non esiste";
    } else if (['replace', 'delete'].includes(action)) {
      const currentHash = await sha256(target);
      const expectedOriginalHash = originalHashes.get(relativePath.toLowerCase());
      const expectedAiHash = aiHashes.get(relativePath.toLowerCase());
      if (!expectedOriginalHash || currentHash !== expectedOriginalHash) {
        status = "conflict";
        detail = "Conflitto: il backup locale è stato alterato";
      } else if (!/^[a-f0-9]{64}$/i.test(String(operation.baseSha256 || "")) || expectedAiHash !== String(operation.baseSha256).toLowerCase()) {
        status = "conflict";
        detail = "Conflitto: hash AI non corrispondente";
      }
    }
    if (['replace', 'create'].includes(action) && typeof operation.content !== "string") {
      throw new Error(`Operazione ${index + 1}: manca il contenuto completo del file.`);
    }
    operations.push({ index, action, path: relativePath, status, detail, reason: String(operation.reason || "") });
  }
  const id = crypto.randomUUID();
  pendingAiPackage = { id, aiPackage, projectId: project.id, baseline: baseline.directory, inspected: operations, redactedPaths };
  return {
    id,
    project: { id: project.id, name: project.name },
    sourceBackupId: path.basename(baseline.directory),
    summary: String(aiPackage.summary),
    operations,
    readyCount: operations.filter((item) => item.status === "ready").length,
    protectedCount: operations.filter((item) => item.status === "blocked_protected").length,
    conflictCount: operations.filter((item) => item.status === "conflict").length,
  };
}

async function applyAiPackage(packageId) {
  if (!pendingAiPackage || pendingAiPackage.id !== packageId) throw new Error("Anteprima scaduta. Carica nuovamente il file AI.");
  const project = state.projects.find((item) => String(item.id) === String(pendingAiPackage.projectId));
  if (!project) throw new Error("Progetto non più disponibile.");
  const freshInspection = await inspectAiPackage(pendingAiPackage.aiPackage);
  if (freshInspection.conflictCount > 0) throw new Error("Ci sono conflitti. Nessuna modifica è stata applicata.");
  const baseline = pendingAiPackage.baseline;
  const previousPublished = await latestKnownPublishedAiVersion(project, baseline, "");
  const copySource = previousPublished?.directory || baseline;
  const parent = path.dirname(baseline);
  let destination = path.join(parent, `AI_MODIFICATO_${new Date().toISOString().replace(/[:.]/g, "-")}`);
  let counter = 2;
  while (await fileExists(destination)) {
    destination = `${destination}_${String(counter).padStart(2, "0")}`;
    counter += 1;
  }
  await fsp.cp(copySource, destination, { recursive: true, errorOnExist: true });
  const applied = [];
  const skipped = [];
  try {
    for (const inspected of pendingAiPackage.inspected) {
      const operation = pendingAiPackage.aiPackage.operations[inspected.index];
      if (inspected.status === "blocked_protected") {
        skipped.push({ path: inspected.path, reason: "file intoccabile" });
        continue;
      }
      if (inspected.status !== "ready") throw new Error(`Conflitto su ${inspected.path}.`);
      const target = pathInside(destination, inspected.path);
      if (inspected.action === "delete") {
        if (await fileExists(target)) await fsp.unlink(target);
      } else {
        let content = operation.content;
        if (pendingAiPackage.redactedPaths.has(inspected.path.toLowerCase()) && inspected.action === "replace") {
          const originalTarget = pathInside(baseline, inspected.path);
          const originalContent = await fsp.readFile(originalTarget, "utf8");
          content = rehydrateRedactions(originalContent, content).text;
        }
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, content, "utf8");
      }
      applied.push({ action: inspected.action, path: inspected.path, reason: inspected.reason });
    }
    if (project.scriptId) await validateLocalAppsScriptLogicalNames(destination);
    const report = {
      formatVersion: "1.0",
      appliedAt: new Date().toISOString(),
      project: { id: project.id, name: project.name },
      sourceBackup: baseline,
      basedOnPublishedVersion: previousPublished?.directory || null,
      summary: pendingAiPackage.aiPackage.summary,
      applied,
      skipped,
      publishedToGoogle: false,
    };
    await fsp.writeFile(path.join(destination, "modifiche-ai-applicate.json"), JSON.stringify(report, null, 2), "utf8");
    const historyId = crypto.randomUUID();
    state.history.unshift({
      id: historyId,
      projectId: project.id,
      project: project.name,
      type: "ai_modified",
      completedAt: new Date().toISOString(),
      directory: destination,
      zipPath: "",
      sourceBackupId: path.basename(baseline),
      sourceBackupDirectory: baseline,
      publishedToGoogle: false,
    });
    state.history = state.history.slice(0, 20);
    await saveState();
    pendingAiPackage = null;
    return { ok: true, historyId, directory: destination, appliedCount: applied.length, skippedProtectedCount: skipped.length };
  } catch (error) {
    await fsp.rm(destination, { recursive: true, force: true });
    throw error;
  }
}


async function createPrePublishSafetyBackup(project) {
  const result = await backupProjects({
    projects: [project],
    outputDir: state.outputDir,
    credentialsPath: CREDENTIALS_PATH,
    tokenPath: TOKEN_PATH,
    options: { xlsx: state.options.xlsx !== false, zip: false },
    filePolicies: {},
    onEvent: () => {},
  });
  const item = result.results?.[0];
  if (!item || item.status !== "ok") {
    throw new Error(`Backup di sicurezza non riuscito: ${item?.error || "errore sconosciuto"}`);
  }
  const historyId = crypto.randomUUID();
  state.history.unshift({
    id: historyId,
    projectId: project.id,
    project: project.name,
    type: "safety_backup",
    completedAt: new Date().toISOString(),
    directory: item.directory,
    zipPath: "",
  });
  state.history = state.history.slice(0, 20);
  await saveState();
  return { historyId, directory: item.directory };
}

async function validateLocalAppsScriptLogicalNames(sourceDirectory) {
  const scriptDirectory = path.join(sourceDirectory, "apps-script");
  if (!(await fileExists(scriptDirectory))) throw new Error("La copia locale non contiene la cartella apps-script.");
  const entries = await fsp.readdir(scriptDirectory, { withFileTypes: true });
  const seen = new Map();
  let hasManifest = false;
  for (const entry of entries) {
    if (!entry.isFile() || ["_project-metadata.json", "_content-api.json"].includes(entry.name)) continue;
    const lower = entry.name.toLowerCase();
    let logicalName = "";
    if (lower === "appsscript.json") {
      logicalName = "appsscript";
      hasManifest = true;
      try { JSON.parse(await fsp.readFile(path.join(scriptDirectory, entry.name), "utf8")); }
      catch { throw new Error("apps-script/appsscript.json non contiene JSON valido."); }
    }
    else if (lower.endsWith(".gs")) logicalName = entry.name.slice(0, -3);
    else if (lower.endsWith(".html")) logicalName = entry.name.slice(0, -5);
    else if (lower.endsWith(".json")) logicalName = entry.name.slice(0, -5);
    else continue;
    const key = logicalName.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Conflitto nomi Apps Script: ${seen.get(key)} e ${entry.name} diventano entrambi "${logicalName}" su Google. Rinomina uno dei due file prima di pubblicare.`);
    }
    seen.set(key, entry.name);
  }
  if (!hasManifest) throw new Error("Manca apps-script/appsscript.json.");
}

function projectForHistoryItem(item) {
  const byId = state.projects.find((project) => String(project.id) === String(item?.projectId || ""));
  if (byId) return byId;
  const matches = state.projects.filter((project) => project.name === item?.project);
  if (matches.length === 1) return matches[0];
  throw new Error("Impossibile associare questa versione locale a un progetto configurato.");
}

async function latestKnownPublishedAiVersion(project, baselineDirectory, excludeHistoryId) {
  const candidates = state.history
    .filter((entry) =>
      entry.type === "ai_modified" &&
      entry.publishedToGoogle === true &&
      String(entry.id || "") !== String(excludeHistoryId || "") &&
      String(entry.projectId || "") === String(project.id || "") &&
      path.resolve(String(entry.sourceBackupDirectory || "")) === path.resolve(String(baselineDirectory || ""))
    )
    .sort((a, b) => String(b.publishedAt || b.completedAt || "").localeCompare(String(a.publishedAt || a.completedAt || "")));

  for (const entry of candidates) {
    let report;
    try {
      const reportPath = path.join(entry.directory, "modifiche-ai-applicate.json");
      if (!(await fileExists(reportPath))) continue;
      report = JSON.parse(await fsp.readFile(reportPath, "utf8"));
    } catch {
      continue;
    }
    const digest = String(report?.publication?.afterSha256 || "").toLowerCase();
    if (/^[a-f0-9]{64}$/.test(digest) && await fileExists(entry.directory)) {
      try {
        const localDigest = await appsScriptDirectoryDigest({
          sourceDirectory: entry.directory,
          baselineDirectory,
          protectedFiles: project.protectedFiles || [],
        });
        if (localDigest !== digest) {
          throw new Error(`La versione AI già pubblicata è stata modificata sul disco: ${entry.directory}`);
        }
        return { digest, directory: entry.directory, historyId: entry.id };
      } catch (error) {
        if (/modificata sul disco/.test(String(error?.message || ""))) throw error;
        throw new Error(`La versione AI già pubblicata non è più valida sul disco: ${entry.directory}`);
      }
    }
  }
  return null;
}

async function publishAiHistoryItem(historyId) {
  const item = state.history.find((entry) => String(entry.id || "") === String(historyId || ""));
  if (!item || item.type !== "ai_modified") throw new Error("Versione AI locale non trovata.");
  if (item.publishedToGoogle === true) throw new Error("Questa versione risulta già pubblicata su Google.");
  if (!(await fileExists(item.directory))) throw new Error("La cartella AI modificata non esiste più sul disco.");
  const reportPath = path.join(item.directory, "modifiche-ai-applicate.json");
  if (!(await fileExists(reportPath))) throw new Error("Manca il report modifiche-ai-applicate.json.");
  const report = JSON.parse(await fsp.readFile(reportPath, "utf8"));
  const baseline = String(item.sourceBackupDirectory || report.sourceBackup || "");
  if (!baseline || !(await fileExists(baseline))) throw new Error("Il backup originale usato dall'AI non è più disponibile.");
  const project = projectForHistoryItem(item);
  if (!project.scriptId) throw new Error("Il progetto non ha uno Script ID configurato.");

  // Preflight locale: evita backup/pubblicazione se due file locali avrebbero
  // lo stesso nome logico nel progetto Google Apps Script.
  await validateLocalAppsScriptLogicalNames(item.directory);

  const safetyBackup = await createPrePublishSafetyBackup(project);
  let publication;
  try {
    const previousPublished = await latestKnownPublishedAiVersion(project, baseline, item.id);
    publication = await publishAppsScriptProject({
      project,
      sourceDirectory: item.directory,
      baselineDirectory: baseline,
      credentialsPath: CREDENTIALS_PATH,
      tokenPath: TOKEN_PATH,
      expectedLiveDigests: previousPublished ? [previousPublished.digest] : [],
    });
  } catch (error) {
    item.lastPublishAttemptAt = new Date().toISOString();
    item.lastPublishError = error?.message || String(error);
    item.safetyBackupDirectory = safetyBackup.directory;
    await saveState();
    throw new Error(`${item.lastPublishError} Backup di sicurezza creato in: ${safetyBackup.directory}`);
  }

  item.publishedToGoogle = true;
  item.publishedAt = new Date().toISOString();
  item.lastPublishAttemptAt = item.publishedAt;
  item.lastPublishError = "";
  item.safetyBackupDirectory = safetyBackup.directory;
  item.publishedFileCount = publication.fileCount;
  report.publishedToGoogle = true;
  report.publishedAt = item.publishedAt;
  report.safetyBackupDirectory = safetyBackup.directory;
  report.publication = publication;
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  await saveState();
  return {
    ok: true,
    project: project.name,
    directory: item.directory,
    safetyBackupDirectory: safetyBackup.directory,
    fileCount: publication.fileCount,
    publishedAt: item.publishedAt,
  };
}

async function applyAndPublishAiPackage(packageId) {
  const local = await applyAiPackage(packageId);
  try {
    const publication = await publishAiHistoryItem(local.historyId);
    return { ...local, publication };
  } catch (error) {
    throw new Error(`Copia locale creata correttamente in ${local.directory}, ma la pubblicazione su Google non è riuscita: ${error?.message || String(error)} Puoi riprovare dalla sezione Ultimi backup.`);
  }
}

const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
]);

async function serveStatic(response, pathname) {
  const definition = STATIC_FILES.get(pathname);
  if (!definition) return false;
  const [filename, mimeType] = definition;
  const bytes = await fsp.readFile(path.join(BASE_DIR, "public", filename));
  response.writeHead(200, {
    "Content-Type": mimeType,
    "Content-Length": bytes.length,
    "Cache-Control": "no-cache",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  response.end(bytes);
  return true;
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/health" && request.method === "GET") return sendJson(response, 200, { ok: true, app: "GoogleWorkspaceBackup", version: APP_VERSION, instanceId: instance.id, busy: requestBusy || activeJob?.status === "running" });
  if (pathname === "/api/state" && request.method === "GET") return sendJson(response, 200, await publicState());
  if (pathname === "/api/state" && request.method === "POST") {
    await saveProjects(await readJson(request));
    return sendJson(response, 200, await publicState());
  }
  if (pathname === "/api/credentials" && request.method === "POST") {
    const payload = await readJson(request);
    const credentials = payload.credentials;
    if (!credentials?.installed?.client_id || !credentials?.installed?.client_secret) {
      throw new Error("Seleziona il JSON di un client OAuth di tipo Applicazione desktop.");
    }
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.writeFile(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    if (await fileExists(TOKEN_PATH)) await fsp.unlink(TOKEN_PATH);
    state.account = null;
    state.accessChecks = [];
    state.accessCheckedAt = null;
    await saveState();
    const info = await validateCredentialsFile(CREDENTIALS_PATH);
    return sendJson(response, 200, { ok: true, credentials: info });
  }
  if (pathname === "/api/auth" && request.method === "POST") {
    const payload = await readJson(request);
    if (payload.mode && !["backup", "publish"].includes(payload.mode)) throw new Error("Modalità accesso non valida.");
    const result = await authorizeInteractive(CREDENTIALS_PATH, TOKEN_PATH, state.projects, payload.mode || "backup");
    state.account = result.user;
    state.accessChecks = result.checks;
    state.accessCheckedAt = result.checkedAt;
    await saveState();
    return sendJson(response, 200, result);
  }
  if (pathname === "/api/auth/test" && request.method === "POST") {
    const result = await testConnection(CREDENTIALS_PATH, TOKEN_PATH, state.projects);
    state.account = result.user;
    state.accessChecks = result.checks;
    state.accessCheckedAt = result.checkedAt;
    await saveState();
    return sendJson(response, 200, result);
  }
  if (pathname === "/api/auth" && request.method === "DELETE") {
    if (await fileExists(TOKEN_PATH)) await fsp.unlink(TOKEN_PATH);
    state.account = null;
    state.accessChecks = [];
    state.accessCheckedAt = null;
    await saveState();
    return sendJson(response, 200, { ok: true });
  }
  if (pathname === "/api/choose-folder" && request.method === "POST") {
    const selected = await chooseFolder();
    if (selected) {
      state.outputDir = path.resolve(selected);
      await saveState();
    }
    return sendJson(response, 200, { outputDir: state.outputDir });
  }
  if (pathname === "/api/open-folder" && request.method === "POST") {
    await fsp.mkdir(path.resolve(state.outputDir), { recursive: true });
    openOutputFolder();
    return sendJson(response, 200, { ok: true });
  }
  if (pathname === "/api/secrets/scan" && request.method === "POST") {
    const projects = state.projects.filter((project) => project.enabled !== false);
    if (!projects.length) throw new Error("Nessun progetto attivo.");
    const results = await scanProjectsForSecrets({
      projects,
      credentialsPath: CREDENTIALS_PATH,
      tokenPath: TOKEN_PATH,
    });
    return sendJson(response, 200, { projects: results });
  }
  if (pathname === "/api/backup" && request.method === "POST") {
    const job = await startBackup(await readJson(request));
    return sendJson(response, 202, { id: job.id, status: job.status });
  }
  if (pathname === "/api/ai/inspect" && request.method === "POST") {
    const payload = await readJson(request, 20 * 1024 * 1024);
    return sendJson(response, 200, await inspectAiPackage(payload));
  }
  if (pathname === "/api/ai/apply" && request.method === "POST") {
    const payload = await readJson(request);
    return sendJson(response, 200, await applyAiPackage(String(payload.packageId || "")));
  }
  if (pathname === "/api/ai/apply-publish" && request.method === "POST") {
    const payload = await readJson(request);
    return sendJson(response, 200, await applyAndPublishAiPackage(String(payload.packageId || "")));
  }
  if (pathname === "/api/ai/publish" && request.method === "POST") {
    const payload = await readJson(request);
    return sendJson(response, 200, await publishAiHistoryItem(String(payload.historyId || "")));
  }
  if (pathname === "/api/job" && request.method === "GET") return sendJson(response, 200, activeJob || { status: "idle", logs: [] });
  if (pathname === "/api/job/cancel" && request.method === "POST") {
    if (!activeJob || activeJob.status !== "running") throw new Error("Nessun backup in corso da annullare.");
    activeJob.cancelRequested = true;
    addJobLog(activeJob, "warn", "Richiesta di annullamento ricevuta: arresto al prossimo punto sicuro...");
    return sendJson(response, 202, { ok: true, status: activeJob.status });
  }
  if (pathname === "/api/shutdown" && request.method === "POST") {
    if (requestBusy || activeJob?.status === "running") return sendJson(response, 409, { error: "Operazione in corso. Attendi il termine oppure annulla il backup prima di chiudere." });
    shuttingDown = true;
    sendJson(response, 200, { ok: true });
    setTimeout(() => server.close(() => process.exit(0)), 100);
    return;
  }
  sendJson(response, 404, { error: "Funzione non trovata." });
}

// Refuse to replace a legacy instance: it may be writing a backup or Google.
async function healthAt(port) {
  try {
    const response = await fetch(`http://${HOST}:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    return await response.json();
  } catch { return null; }
}
const legacy = await healthAt(47831);
if (legacy?.app === "GoogleWorkspaceBackup" && !legacy.instanceId) {
  console.error("Chiudi la versione precedente con Chiudi programma, poi riapri questa versione. Nessun processo è stato terminato.");
  process.exit(2);
}
const instance = claimInstance(DATA_DIR);
if (!instance) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const record = JSON.parse(await fsp.readFile(path.join(DATA_DIR, "instance.json"), "utf8"));
      if (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535) throw new Error("Porta non valida");
      const health = await healthAt(record.port);
      if (health?.app === "GoogleWorkspaceBackup" && health.instanceId === record.instanceId) {
        if (health.version !== APP_VERSION) {
          console.error("Chiudi la versione precedente con Chiudi programma e riprova.");
          process.exit(2);
        }
        openBrowser(`http://${HOST}:${record.port}`);
        console.log("Istanza già aperta: interfaccia riutilizzata.");
        process.exit(0);
      }
    } catch { /* The other process may still be starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.error("Un'istanza risulta già avviata ma non risponde. Vedi la diagnostica nel README.");
  process.exit(2);
}
await loadState();

const server = http.createServer(async (request, response) => {
  let ownsBusy = false;
  try {
    if (!checkLocalRequest(request)) return sendJson(response, 403, { error: "Richiesta non autorizzata." });
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      if (shuttingDown) return sendJson(response, 409, { error: "Chiusura del programma in corso." });
      if (!["GET", "HEAD"].includes(request.method) && !["/api/job/cancel", "/api/shutdown"].includes(url.pathname)) {
        if (requestBusy || activeJob?.status === "running") return sendJson(response, 409, { error: "Operazione in corso. Attendi il completamento e riprova." });
        requestBusy = true;
        ownsBusy = true;
      }
      return await handleApi(request, response, url.pathname);
    }
    if (await serveStatic(response, url.pathname)) return;
    sendJson(response, 404, { error: "Pagina non trovata." });
  } catch (error) {
    const message = error?.response?.data?.error?.message || error?.message || String(error);
    if (!response.headersSent) sendJson(response, 400, { error: message });
  } finally {
    if (ownsBusy) requestBusy = false;
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && PORT !== 0) {
    PORT = 0;
    server.listen(PORT, HOST);
    return;
  }
  console.error(error.message);
  process.exit(1);
});
server.on("listening", () => {
  PORT = server.address().port;
  instance.publish(APP_VERSION, PORT);
  console.log(`Google Workspace Backup ${APP_VERSION}: http://${HOST}:${PORT}`);
  openBrowser(`http://${HOST}:${PORT}`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (requestBusy || activeJob?.status === "running") {
      console.error("Operazione in corso: usa Annulla backup o attendi prima di chiudere.");
      return;
    }
    server.close(() => process.exit(0));
  });
}
server.listen(PORT, HOST);
