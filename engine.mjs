import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { google } from "googleapis";
import { authenticateDesktop } from "./oauth.mjs";
import { ZipArchive } from "archiver";

export const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/script.projects.readonly",
];

export const PUBLISH_SCOPES = [...SCOPES.slice(0, 2), "https://www.googleapis.com/auth/script.projects"];

export function safeName(value, fallback = "backup") {
  const cleaned = String(value || fallback)
    .normalize("NFKD")
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "_")
    .replace(/[^\p{L}\p{N}_. -]+/gu, "_")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 100) || fallback;
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)
    ? `_${cleaned}`
    : cleaned;
}

export function extractSpreadsheetId(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  const urlMatch = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{20,200}$/.test(value)) return value;
  throw new Error("Il link o ID del Foglio Google non è valido.");
}

export function normalizeScriptId(input) {
  let value = String(input || "").trim().replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (!value) return "";
  const urlMatch = value.match(/script\.google\.com\/(?:home\/projects\/|d\/)([a-zA-Z0-9_-]+)/i);
  if (urlMatch) value = urlMatch[1];
  if (!/^[a-zA-Z0-9_-]{20,200}$/.test(value)) {
    throw new Error("Lo Script ID non è valido.");
  }
  return value;
}

export function normalizeAiPath(input) {
  const value = String(input || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !/^apps-script\/[^/]+\.(?:gs|html|json)$/i.test(value)
    || value.includes("..")
    || value.includes("\0")
    || /[<>:"|?*\x00-\x1F]/.test(value)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value.split("/").pop())
  ) {
    throw new Error(`Percorso modifica non consentito: ${value || "vuoto"}`);
  }
  const filename = value.slice("apps-script/".length).toLowerCase();
  if (filename.endsWith(".json") && filename !== "appsscript.json") {
    throw new Error(`File Apps Script non modificabile: ${value}`);
  }
  return value;
}

export function validateProject(project) {
  const name = String(project?.name || "").trim();
  const spreadsheetId = extractSpreadsheetId(project?.spreadsheet || "");
  const scriptId = normalizeScriptId(project?.scriptId || "");
  if (!name) throw new Error("Il nome del progetto è obbligatorio.");
  if (!spreadsheetId && !scriptId) {
    throw new Error(`Il progetto "${name}" deve avere almeno un Foglio Google o uno Script ID.`);
  }
  return {
    id: String(project.id || ""),
    enabled: project.enabled !== false,
    name,
    spreadsheet: spreadsheetId,
    scriptId,
  };
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runPowerShellWithInput(script, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    child.stdin.on("error", () => {});
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(errorOutput.trim() || `Protezione Windows non riuscita: codice ${code}.`));
    });
    child.stdin.end(input, "utf8");
  });
}

async function protectWithWindowsDpapi(plainText) {
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$inputText = [Console]::In.ReadToEnd()",
    "$bytes = [Text.Encoding]::UTF8.GetBytes($inputText)",
    "$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($protected))",
  ].join("; ");
  return String(await runPowerShellWithInput(script, plainText)).trim();
}

async function unprotectWithWindowsDpapi(encryptedText) {
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$inputText = [Console]::In.ReadToEnd().Trim()",
    "$protected = [Convert]::FromBase64String($inputText)",
    "$bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))",
  ].join("; ");
  return runPowerShellWithInput(script, encryptedText);
}

async function writeTokenPayload(tokenPath, payload) {
  const diskValue = process.platform === "win32"
    ? { format: "gwb-dpapi-v1", data: await protectWithWindowsDpapi(JSON.stringify(payload)) }
    : payload;
  await fsp.mkdir(path.dirname(tokenPath), { recursive: true });
  const temporaryPath = `${tokenPath}.tmp`;
  await fsp.writeFile(temporaryPath, JSON.stringify(diskValue, null, 2), { mode: 0o600 });
  await fsp.rename(temporaryPath, tokenPath);
}

export async function tokenProtectionStatus(tokenPath) {
  if (!(await exists(tokenPath))) return "missing";
  try {
    const stored = JSON.parse(await fsp.readFile(tokenPath, "utf8"));
    return stored?.format === "gwb-dpapi-v1" ? "dpapi" : "plain";
  } catch {
    return "invalid";
  }
}

function credentialDefinition(raw) {
  const definition = raw?.installed || raw?.web;
  if (!definition?.client_id || !definition?.client_secret) {
    throw new Error("Il file non contiene un client OAuth valido. Crea un client di tipo Applicazione desktop.");
  }
  return definition;
}

export async function validateCredentialsFile(credentialsPath) {
  if (!(await exists(credentialsPath))) throw new Error("Credenziali Google non configurate.");
  let raw;
  try {
    raw = JSON.parse(await fsp.readFile(credentialsPath, "utf8"));
  } catch {
    throw new Error("Il file credenziali non è un JSON valido.");
  }
  const definition = credentialDefinition(raw);
  if (!raw.installed) {
    throw new Error("Le credenziali devono essere di tipo Applicazione desktop, non Applicazione web.");
  }
  return {
    clientIdSuffix: String(definition.client_id).slice(-18),
    projectId: raw.installed.project_id || "",
  };
}

async function loadAuth(credentialsPath, tokenPath) {
  await validateCredentialsFile(credentialsPath);
  if (!(await exists(tokenPath))) throw new Error("Account Google non collegato.");
  let stored;
  try {
    stored = JSON.parse(await fsp.readFile(tokenPath, "utf8"));
  } catch {
    throw new Error("Il token Google salvato non è valido. Scollega e collega di nuovo l'account.");
  }
  let token = stored;
  if (stored?.format === "gwb-dpapi-v1") {
    try {
      token = JSON.parse(await unprotectWithWindowsDpapi(stored.data));
    } catch {
      throw new Error("Il token Google non può essere decifrato da questo utente Windows. Scollega e collega di nuovo l'account.");
    }
  } else if (process.platform === "win32") {
    await writeTokenPayload(tokenPath, token);
  }
  return google.auth.fromJSON(token);
}

async function saveCredentials(client, credentialsPath, tokenPath) {
  const keys = JSON.parse(await fsp.readFile(credentialsPath, "utf8"));
  const definition = credentialDefinition(keys);
  if (!client.credentials?.refresh_token) {
    throw new Error("Google non ha restituito un token permanente. Revoca l'accesso all'app e riprova.");
  }
  const payload = {
    type: "authorized_user",
    client_id: definition.client_id,
    client_secret: definition.client_secret,
    refresh_token: client.credentials.refresh_token,
  };
  await writeTokenPayload(tokenPath, payload);
}

export async function authorizeInteractive(credentialsPath, tokenPath, projects = [], mode = "backup", options = {}) {
  const { signal, onUrl } = options;
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new Error("Collegamento Google annullato.");
  };
  await validateCredentialsFile(credentialsPath);
  throwIfCancelled();
  const scopes = mode === "publish" ? PUBLISH_SCOPES : SCOPES;
  // Desktop OAuth needs a new explicit consent; do not silently switch accounts.
  let previousEmail = null;
  if (mode === "publish") {
    const previous = await testConnection(credentialsPath, tokenPath, []);
    previousEmail = previous.user.emailAddress;
  }
  const keys = JSON.parse(await fsp.readFile(credentialsPath, "utf8")).installed;
  const client = await authenticateDesktop({ keys, scopes, signal, onUrl });
  throwIfCancelled();
  if (previousEmail) {
    const about = (await google.drive({ version: "v3", auth: client }).about.get(
      { fields: "user(emailAddress)" }, { timeout: 30000 },
    )).data;
    if (about.user?.emailAddress !== previousEmail) {
      throw new Error("Hai scelto un account diverso. Il collegamento precedente è stato conservato. Riprova con lo stesso account.");
    }
  }
  throwIfCancelled();
  try {
    await saveCredentials(client, credentialsPath, tokenPath);
    throwIfCancelled();
    const result = await testConnection(credentialsPath, tokenPath, projects);
    throwIfCancelled();
    return result;
  } catch (error) {
    if (signal?.aborted) {
      await fsp.rm(tokenPath, { force: true });
      await fsp.rm(`${tokenPath}.tmp`, { force: true });
      throw new Error("Collegamento Google annullato.");
    }
    throw error;
  }
}

export async function testConnection(credentialsPath, tokenPath, projects = []) {
  const auth = await loadAuth(credentialsPath, tokenPath);
  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });
  const scriptApi = google.script({ version: "v1", auth });
  const about = (await withGoogleRetry(
    () => drive.about.get({ fields: "user(displayName,emailAddress,me)" }, { timeout: 30000 }),
    { label: "verifica account Google" },
  )).data;
  const checks = [];
  for (const project of (Array.isArray(projects) ? projects : []).filter((item) => item?.enabled !== false)) {
    const clean = validateProject(project);
    const result = { projectId: clean.id, projectName: clean.name, drive: null, spreadsheet: null, appsScript: null };
    if (clean.spreadsheet) {
      try {
        await withGoogleRetry(
          () => drive.files.get({ fileId: clean.spreadsheet, fields: "id,mimeType" }, { timeout: 30000 }),
          { label: `verifica Drive ${clean.name}` },
        );
        result.drive = { ok: true };
      } catch (error) {
        result.drive = { ok: false, error: error?.response?.data?.error?.message || error?.message || String(error) };
      }
      try {
        await withGoogleRetry(
          () => sheets.spreadsheets.get({ spreadsheetId: clean.spreadsheet, fields: "spreadsheetId" }, { timeout: 30000 }),
          { label: `verifica Foglio ${clean.name}` },
        );
        result.spreadsheet = { ok: true };
      } catch (error) {
        result.spreadsheet = { ok: false, error: error?.response?.data?.error?.message || error?.message || String(error) };
      }
    }
    if (clean.scriptId) {
      try {
        await withGoogleRetry(
          () => scriptApi.projects.get({ scriptId: clean.scriptId }, { timeout: 30000 }),
          { label: `verifica Apps Script ${clean.name}` },
        );
        result.appsScript = { ok: true };
      } catch (error) {
        result.appsScript = { ok: false, error: error?.response?.data?.error?.message || error?.message || String(error) };
      }
    }
    checks.push(result);
  }
  const failedCount = checks.reduce((total, item) => total
    + (item.drive?.ok === false ? 1 : 0)
    + (item.spreadsheet?.ok === false ? 1 : 0)
    + (item.appsScript?.ok === false ? 1 : 0), 0);
  return {
    connected: true,
    user: {
      displayName: about.user?.displayName || "",
      emailAddress: about.user?.emailAddress || "",
    },
    checks,
    failedCount,
    checkedAt: new Date().toISOString(),
  };
}

function columnToA1(index) {
  let number = index + 1;
  let result = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function cellA1(row, column) {
  return `${columnToA1(column)}${row + 1}`;
}

export function buildFormulaIndex(spreadsheet) {
  const formulas = [];
  for (const sheet of spreadsheet.sheets || []) {
    const title = sheet.properties?.title || "Senza nome";
    for (const grid of sheet.data || []) {
      const startRow = grid.startRow || 0;
      const startColumn = grid.startColumn || 0;
      (grid.rowData || []).forEach((row, rowOffset) => {
        (row.values || []).forEach((cell, columnOffset) => {
          const formula = cell.userEnteredValue?.formulaValue;
          if (!formula) return;
          const rowIndex = startRow + rowOffset;
          const columnIndex = startColumn + columnOffset;
          formulas.push({
            sheet: title,
            cell: cellA1(rowIndex, columnIndex),
            row: rowIndex + 1,
            column: columnIndex + 1,
            formula,
            formattedValue: cell.formattedValue ?? null,
            effectiveValue: cell.effectiveValue ?? null,
            numberFormat: cell.userEnteredFormat?.numberFormat ?? null,
          });
        });
      });
    }
  }
  return formulas;
}

export function buildNoteIndex(spreadsheet) {
  const notes = [];
  for (const sheet of spreadsheet.sheets || []) {
    const title = sheet.properties?.title || "Senza nome";
    for (const grid of sheet.data || []) {
      const startRow = grid.startRow || 0;
      const startColumn = grid.startColumn || 0;
      (grid.rowData || []).forEach((row, rowOffset) => {
        (row.values || []).forEach((cell, columnOffset) => {
          if (typeof cell.note !== "string" || !cell.note) return;
          const rowIndex = startRow + rowOffset;
          const columnIndex = startColumn + columnOffset;
          notes.push({
            sheet: title,
            cell: cellA1(rowIndex, columnIndex),
            row: rowIndex + 1,
            column: columnIndex + 1,
            note: cell.note,
          });
        });
      });
    }
  }
  return notes;
}

export function buildStructure(spreadsheet) {
  return {
    spreadsheetId: spreadsheet.spreadsheetId,
    spreadsheetUrl: spreadsheet.spreadsheetUrl,
    properties: spreadsheet.properties || {},
    namedRanges: spreadsheet.namedRanges || [],
    developerMetadata: spreadsheet.developerMetadata || [],
    dataSources: spreadsheet.dataSources || [],
    sheets: (spreadsheet.sheets || []).map((sheet) => ({
      properties: sheet.properties || {},
      merges: sheet.merges || [],
      conditionalFormats: sheet.conditionalFormats || [],
      filterViews: sheet.filterViews || [],
      protectedRanges: sheet.protectedRanges || [],
      basicFilter: sheet.basicFilter || null,
      charts: sheet.charts || [],
      bandedRanges: sheet.bandedRanges || [],
      developerMetadata: sheet.developerMetadata || [],
      rowGroups: sheet.rowGroups || [],
      columnGroups: sheet.columnGroups || [],
      slicers: sheet.slicers || [],
      tables: sheet.tables || [],
      gridDataBlocks: (sheet.data || []).map((grid) => ({
        startRow: grid.startRow || 0,
        startColumn: grid.startColumn || 0,
        rowMetadata: grid.rowMetadata || [],
        columnMetadata: grid.columnMetadata || [],
        rowCountReturned: (grid.rowData || []).length,
      })),
    })),
  };
}

function scriptExtension(type) {
  if (type === "SERVER_JS") return ".gs";
  if (type === "HTML") return ".html";
  if (type === "JSON") return ".json";
  return ".txt";
}

const SECRET_PATTERNS = [
  { type: "Chiave privata", confidence: "high", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { type: "Google API key", confidence: "high", regex: /AIza[0-9A-Za-z_-]{30,}/g },
  { type: "Google OAuth token", confidence: "high", regex: /ya29\.[0-9A-Za-z._-]{20,}/g },
  { type: "GitHub token", confidence: "high", regex: /(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,}/g },
  { type: "Slack token", confidence: "high", regex: /xox[baprs]-[0-9A-Za-z-]{20,}/g },
  { type: "Stripe live key", confidence: "high", regex: /(?:sk|rk)_live_[0-9A-Za-z]{16,}/g },
  { type: "AWS access key", confidence: "high", regex: /(?:AKIA|ASIA)[0-9A-Z]{16}/g },
  { type: "JWT", confidence: "high", regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { type: "Bearer token", confidence: "high", regex: /Bearer\s+([0-9A-Za-z._~+\/-]{20,})/gi, capture: 1 },
  {
    type: "Variabile sensibile",
    confidence: "review",
    regex: /(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|secret)\s*[:=]\s*["'`]([^"'`\r\n]{8,})["'`]/gi,
    capture: 1,
  },
  { type: "Stringa lunga da verificare", confidence: "review", regex: /["'`]([A-Za-z0-9_\-/.+=]{32,})["'`]/g, capture: 1 },
];

function lineNumberAt(text, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (text.charCodeAt(position) === 10) line += 1;
  }
  return line;
}

export function findSecrets(source) {
  const text = String(source || "");
  const matches = [];
  for (const definition of SECRET_PATTERNS) {
    const regex = new RegExp(definition.regex.source, definition.regex.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const secret = definition.capture ? match[definition.capture] : match[0];
      if (!secret) continue;
      // Le stringhe tecniche lunghe usate come nomi di proprietà/configurazione
      // (es. GESTIONALE_LAST_PRIMA_NOTA_IMPORT) non sono segreti.
      // I pattern ad alta confidenza (Google, OAuth, GitHub, ecc.) restano invariati.
      if (definition.type === "Stringa lunga da verificare" && /^[A-Z][A-Z0-9_]{15,}$/.test(secret)) continue;
      const relative = definition.capture ? match[0].indexOf(secret) : 0;
      const start = match.index + Math.max(0, relative);
      const end = start + secret.length;
      if (matches.some((item) => start < item.end && end > item.start)) continue;
      matches.push({
        type: definition.type,
        confidence: definition.confidence,
        start,
        end,
        line: lineNumberAt(text, start),
        length: secret.length,
      });
      if (match[0].length === 0) regex.lastIndex += 1;
    }
  }
  return matches.sort((left, right) => left.start - right.start);
}

function findingPreview(source, finding, allFindings = [finding]) {
  const text = String(source || "");
  const lineStart = Math.max(0, text.lastIndexOf("\n", finding.start - 1) + 1);
  const lineBreak = text.indexOf("\n", finding.start);
  const lineEnd = lineBreak === -1 ? text.length : lineBreak;
  let maskedLine = text.slice(lineStart, lineEnd);
  const overlaps = allFindings
    .filter((item) => item.start < lineEnd && item.end > lineStart)
    .sort((left, right) => right.start - left.start);
  for (const item of overlaps) {
    const start = Math.max(0, item.start - lineStart);
    const end = Math.min(maskedLine.length, item.end - lineStart);
    maskedLine = `${maskedLine.slice(0, start)}[VALORE NASCOSTO]${maskedLine.slice(end)}`;
  }
  const masked = maskedLine
    .replace(/\s+/g, " ")
    .trim();
  if (masked.length <= 220) return masked;
  return `${masked.slice(0, 217)}...`;
}

export function redactSecrets(source) {
  const text = String(source || "");
  const findings = findSecrets(text).map((finding, index) => ({
    ...finding,
    placeholder: `[CENSURATO:${finding.type.toUpperCase().replace(/\s+/g, "_")}:${String(index + 1).padStart(3, "0")}]`,
  }));
  let redacted = text;
  for (const finding of [...findings].sort((left, right) => right.start - left.start)) {
    redacted = `${redacted.slice(0, finding.start)}${finding.placeholder}${redacted.slice(finding.end)}`;
  }
  return { text: redacted, findings };
}

export function rehydrateRedactions(originalSource, modifiedSource) {
  const original = String(originalSource || "");
  const redaction = redactSecrets(original);
  let restored = String(modifiedSource || "");
  for (const finding of redaction.findings) {
    const occurrences = restored.split(finding.placeholder).length - 1;
    if (occurrences !== 1) {
      throw new Error(`Il segnaposto ${finding.placeholder} è stato rimosso, duplicato o modificato dall'AI.`);
    }
    const secret = original.slice(finding.start, finding.end);
    restored = restored.replace(finding.placeholder, secret);
  }
  return { text: restored, count: redaction.findings.length };
}

function scriptFileName(file) {
  return `${safeName(file.name || "unnamed")}${scriptExtension(file.type)}`;
}

export async function scanProjectsForSecrets({ projects, credentialsPath, tokenPath }) {
  const auth = await loadAuth(credentialsPath, tokenPath);
  const scriptApi = google.script({ version: "v1", auth });
  const sheets = google.sheets({ version: "v4", auth });
  const results = [];
  for (const project of projects) {
    const clean = validateProject(project);
    let files = [];
    if (clean.scriptId) {
      const content = (await withGoogleRetry(
        () => scriptApi.projects.getContent({ scriptId: clean.scriptId }, { timeout: 60000 }),
        { label: `scansione Apps Script ${clean.name}` },
      )).data;
      files = (content.files || []).map((file) => {
        const source = file.source || "";
        const findings = findSecrets(source);
        return {
          path: `apps-script/${scriptFileName(file)}`,
          name: scriptFileName(file),
          type: file.type || "UNKNOWN",
          sourceSha256: crypto.createHash("sha256").update(source).digest("hex"),
          findingCount: findings.length,
          highConfidenceCount: findings.filter((finding) => finding.confidence === "high").length,
          reviewCount: findings.filter((finding) => finding.confidence === "review").length,
          findings: findings.map((finding) => ({
            type: finding.type,
            confidence: finding.confidence,
            line: finding.line,
            length: finding.length,
            preview: findingPreview(source, finding, findings),
          })),
        };
      });
    }
    let spreadsheet = null;
    if (clean.spreadsheet) {
      const metadata = (await withGoogleRetry(
        () => sheets.spreadsheets.get({
          spreadsheetId: clean.spreadsheet,
          includeGridData: false,
          fields: "properties(title),sheets(properties(title,hidden,gridProperties(rowCount,columnCount)))",
        }, { timeout: 60000 }),
        { label: `anteprima Foglio ${clean.name}` },
      )).data;
      const sheetNames = (metadata.sheets || []).map((sheet) => sheet.properties?.title || "Senza nome");
      spreadsheet = {
        title: metadata.properties?.title || clean.name,
        sheetCount: sheetNames.length,
        hiddenSheetCount: (metadata.sheets || []).filter((sheet) => sheet.properties?.hidden === true).length,
        sheetNames,
      };
    }
    results.push({
      projectId: clean.id,
      projectName: clean.name,
      protectedFiles: Array.isArray(project.protectedFiles) ? project.protectedFiles : [],
      files,
      spreadsheet,
    });
  }
  return results;
}

async function writeJson(filePath, value) {
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function backupScript(scriptApi, scriptId, spreadsheetId, outputDirectory, emit, shouldCancel) {
  const scriptDirectory = path.join(outputDirectory, "apps-script");
  await fsp.mkdir(scriptDirectory, { recursive: true });
  const metadata = (await withGoogleRetry(
    () => scriptApi.projects.get({ scriptId }, { timeout: 60000 }),
    { label: "metadati Apps Script", emit, shouldCancel },
  )).data;
  const content = (await withGoogleRetry(
    () => scriptApi.projects.getContent({ scriptId }, { timeout: 120000 }),
    { label: "contenuto Apps Script", emit, shouldCancel },
  )).data;
  await writeJson(path.join(scriptDirectory, "_project-metadata.json"), metadata);
  await writeJson(path.join(scriptDirectory, "_content-api.json"), content);
  const filenames = new Map();
  for (const file of content.files || []) {
    const filename = scriptFileName(file);
    const key = filename.toLowerCase();
    if (filenames.has(key)) {
      throw new Error(`Due file Apps Script diventano entrambi "${filename}" nel backup locale: ${filenames.get(key)} e ${file.name}. Rinomina uno dei due file su Google.`);
    }
    filenames.set(key, file.name || "senza nome");
    await fsp.writeFile(path.join(scriptDirectory, filename), file.source || "", "utf8");
  }
  return {
    status: "ok",
    scriptId,
    title: metadata.title || null,
    parentId: metadata.parentId || null,
    parentMatchesSpreadsheet: spreadsheetId ? metadata.parentId === spreadsheetId : null,
    fileCount: (content.files || []).length,
  };
}


function normalizedScriptContent(content) {
  return (content?.files || [])
    .map((file) => ({
      name: String(file?.name || ""),
      type: String(file?.type || ""),
      source: String(file?.source || ""),
    }))
    .sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`));
}

function scriptContentDigest(content) {
  return crypto.createHash("sha256").update(JSON.stringify(normalizedScriptContent(content))).digest("hex");
}

function localScriptDefinition(filename, source) {
  const lower = filename.toLowerCase();
  if (lower === "appsscript.json") return { name: "appsscript", type: "JSON", source };
  if (lower.endsWith(".gs")) return { name: filename.slice(0, -3), type: "SERVER_JS", source };
  if (lower.endsWith(".html")) return { name: filename.slice(0, -5), type: "HTML", source };
  if (lower.endsWith(".json")) return { name: filename.slice(0, -5), type: "JSON", source };
  throw new Error(`File Apps Script non pubblicabile: ${filename}`);
}

async function buildScriptContentFromDirectory(sourceDirectory, baselineContent, protectedFiles = []) {
  const scriptDirectory = path.join(sourceDirectory, "apps-script");
  if (!(await exists(scriptDirectory))) throw new Error("La copia locale non contiene la cartella apps-script.");
  const baselineByFilename = new Map((baselineContent?.files || []).map((file) => [scriptFileName(file).toLowerCase(), file]));
  const entries = await fsp.readdir(scriptDirectory, { withFileTypes: true });
  const files = [];
  const keys = new Set();
  for (const entry of entries) {
    if (!entry.isFile() || ["_project-metadata.json", "_content-api.json"].includes(entry.name)) continue;
    const fullPath = path.join(scriptDirectory, entry.name);
    const source = await fsp.readFile(fullPath, "utf8");
    const baselineFile = baselineByFilename.get(entry.name.toLowerCase());
    const definition = baselineFile
      ? { name: baselineFile.name, type: baselineFile.type, source }
      : localScriptDefinition(entry.name, source);
    // Google Apps Script richiede che il nome logico del file sia univoco
    // nell'intero progetto, indipendentemente dal tipo (SERVER_JS/HTML/JSON).
    // Esempio non valido: ClientReminders.gs + ClientReminders.html.
    const key = String(definition.name || '').toLowerCase();
    if (keys.has(key)) {
      throw new Error(`Nome file Apps Script duplicato: ${definition.name}. Google non permette due file con lo stesso nome anche se hanno estensioni/tipi diversi.`);
    }
    keys.add(key);
    files.push(definition);
  }

  // I file protetti possono essere esclusi dallo ZIP destinato all'AI.
  // Al momento della pubblicazione vengono recuperati ESCLUSIVAMENTE dal
  // backup locale di partenza e reinseriti invariati nel progetto completo.
  for (const protectedPathRaw of protectedFiles || []) {
    const protectedPath = String(protectedPathRaw || "").replace(/\\/g, "/");
    if (!protectedPath.toLowerCase().startsWith("apps-script/")) continue;
    const filename = protectedPath.split("/").pop().toLowerCase();
    const baselineFile = baselineByFilename.get(filename);
    if (!baselineFile) throw new Error(`Il file protetto ${protectedPath} non è presente nel backup locale di partenza.`);
    const key = String(baselineFile.name || '').toLowerCase();
    if (keys.has(key)) {
      const local = files.find((file) => String(file.name || '').toLowerCase() === key);
      if (!local || local.type !== baselineFile.type || String(local.source || "") !== String(baselineFile.source || "")) {
        throw new Error(`Il file protetto ${protectedPath} è stato modificato o entra in conflitto con un altro file omonimo. Pubblicazione bloccata.`);
      }
      continue;
    }
    files.push({ name: baselineFile.name, type: baselineFile.type, source: baselineFile.source || "" });
    keys.add(key);
  }

  const manifest = files.find((file) => file.name === "appsscript" && file.type === "JSON");
  if (!manifest) throw new Error("Manca apps-script/appsscript.json: pubblicazione bloccata.");
  try { JSON.parse(manifest.source); } catch { throw new Error("apps-script/appsscript.json non contiene JSON valido."); }
  return { files };
}

export async function appsScriptDirectoryDigest({ sourceDirectory, baselineDirectory, protectedFiles = [] }) {
  const baselinePath = path.join(baselineDirectory, "apps-script", "_content-api.json");
  if (!(await exists(baselinePath))) throw new Error("Il backup di partenza non contiene _content-api.json.");
  const baselineContent = JSON.parse(await fsp.readFile(baselinePath, "utf8"));
  const content = await buildScriptContentFromDirectory(sourceDirectory, baselineContent, protectedFiles);
  return scriptContentDigest(content);
}

function publicationPermissionError(error) {
  const status = Number(error?.response?.status || error?.code || 0);
  const message = String(error?.response?.data?.error?.message || error?.message || "");
  if (status === 401 || status === 403 || /insufficient|scope|permission|forbidden/i.test(message)) {
    return new Error("Google non ha concesso il permesso di scrittura Apps Script. Premi Abilita pubblicazione nella sezione Modifiche AI, poi riprova.");
  }
  return error;
}

export async function publishAppsScriptProject({ project, sourceDirectory, baselineDirectory, credentialsPath, tokenPath, expectedLiveDigests = [] }) {
  const clean = validateProject(project);
  if (!clean.scriptId) throw new Error("Il progetto non ha uno Script ID: pubblicazione non possibile.");
  const baselinePath = path.join(baselineDirectory, "apps-script", "_content-api.json");
  if (!(await exists(baselinePath))) throw new Error("Il backup di partenza non contiene _content-api.json. Crea un nuovo backup prima di pubblicare.");
  const baselineContent = JSON.parse(await fsp.readFile(baselinePath, "utf8"));
  const auth = await loadAuth(credentialsPath, tokenPath);
  const scriptApi = google.script({ version: "v1", auth });

  const desiredContent = await buildScriptContentFromDirectory(sourceDirectory, baselineContent, project.protectedFiles || []);
  const desiredDigest = scriptContentDigest(desiredContent);
  const protectedSet = new Set((project.protectedFiles || []).map((item) => String(item).replace(/\\/g, "/").toLowerCase()));
  if (protectedSet.size) {
    const baselineByFilename = new Map((baselineContent.files || []).map((file) => [`apps-script/${scriptFileName(file)}`.toLowerCase(), file]));
    const desiredByKey = new Map((desiredContent.files || []).map((file) => [`${file.type}:${file.name}`.toLowerCase(), file]));
    for (const protectedPath of protectedSet) {
      const baselineFile = baselineByFilename.get(protectedPath);
      if (!baselineFile) continue;
      const desiredFile = desiredByKey.get(`${baselineFile.type}:${baselineFile.name}`.toLowerCase());
      if (!desiredFile || String(desiredFile.source || "") !== String(baselineFile.source || "")) {
        throw new Error(`Il file protetto ${protectedPath} non coincide con il backup originale. Pubblicazione bloccata.`);
      }
    }
  }

  let liveContent;
  try {
    liveContent = (await scriptApi.projects.getContent({ scriptId: clean.scriptId })).data;
  } catch (error) {
    throw publicationPermissionError(error);
  }
  const baselineDigest = scriptContentDigest(baselineContent);
  const liveDigest = scriptContentDigest(liveContent);
  const allowedLiveDigests = new Set([
    baselineDigest,
    desiredDigest,
    ...(Array.isArray(expectedLiveDigests) ? expectedLiveDigests : []),
  ].filter((value) => /^[a-f0-9]{64}$/i.test(String(value || ""))));
  if (!allowedLiveDigests.has(liveDigest)) {
    throw new Error("Il progetto Apps Script su Google non coincide né con il backup usato dall'AI né con l'ultima versione AI pubblicata nota. Pubblicazione bloccata: crea un nuovo backup prima di procedere.");
  }

  if (liveDigest !== desiredDigest) {
    try {
      await scriptApi.projects.updateContent({
        scriptId: clean.scriptId,
        requestBody: { files: desiredContent.files },
      });
    } catch (error) {
      throw publicationPermissionError(error);
    }
  }

  let verified;
  if (liveDigest === desiredDigest) {
    verified = liveContent;
  } else {
    try {
      verified = (await scriptApi.projects.getContent({ scriptId: clean.scriptId })).data;
    } catch (error) {
      throw publicationPermissionError(error);
    }
  }
  if (scriptContentDigest(verified) !== desiredDigest) {
    throw new Error("Google ha accettato la pubblicazione ma la verifica finale non coincide con la copia locale. Controlla subito Apps Script e usa il backup di sicurezza se necessario.");
  }
  return {
    ok: true,
    scriptId: clean.scriptId,
    fileCount: desiredContent.files.length,
    beforeSha256: liveDigest,
    afterSha256: desiredDigest,
  };
}

async function fileHash(filePath) {
  const content = await fsp.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function listFiles(directory, prefix = "") {
  const output = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(fullPath, relative));
    else if (entry.isFile()) output.push({ relative, fullPath });
  }
  return output;
}

function aiInstructions(projectName) {
  return `# Istruzioni obbligatorie per l'AI

Questo archivio appartiene al progetto **${projectName}**.

## Prima di proporre modifiche

1. Leggi integralmente \`ai-package-manifest.json\`.
2. Considera i file elencati in \`protectedFiles\` come INTOCCABILI.
3. Non proporre modifiche, eliminazioni, rinomine o ricostruzioni dei file protetti.
4. Non ricostruire contenuti censurati o file esclusi.
5. Mantieni ogni segnaposto \`[CENSURATO:...:000]\` esattamente una volta e senza modificarlo.
6. Usa i valori \`sha256\` del manifest come versione di partenza.
7. Mantieni invariati tutti i file non necessari alla richiesta.

## File che devi restituire

Restituisci un solo file JSON chiamato \`modifiche-ai.json\` conforme a
\`ai-change-schema.json\`.

Ogni operazione deve contenere:

- \`action\`: \`replace\`, \`create\` oppure \`delete\`;
- \`path\`: percorso relativo esatto, per esempio \`apps-script/Code.gs\`;
- \`baseSha256\`: hash presente nel manifest per replace/delete;
- \`content\`: contenuto completo del file per replace/create.

Non inserire operazioni per file protetti. Non usare percorsi assoluti, \`..\`,
link esterni o codice codificato in base64. Il programma confronterà hash e
protezioni prima di applicare qualsiasi modifica.
`;
}

function aiChangeSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Pacchetto modifiche AI",
    type: "object",
    required: ["formatVersion", "project", "sourceBackupId", "summary", "operations"],
    properties: {
      formatVersion: { const: "1.0" },
      project: {
        type: "object",
        required: ["id", "name"],
        properties: { id: { type: "string" }, name: { type: "string" } },
        additionalProperties: false,
      },
      sourceBackupId: { type: "string" },
      summary: { type: "string", minLength: 1 },
      operations: {
        type: "array",
        items: {
          type: "object",
          required: ["action", "path"],
          properties: {
            action: { enum: ["replace", "create", "delete"] },
            path: { type: "string", pattern: "^apps-script/" },
            baseSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
            content: { type: "string" },
            reason: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  };
}

export async function createAiZip({ sourceDirectory, project, policies, protectedFiles, zipPath, backupId }) {
  const reviewed = Object.entries(policies || {}).filter(([name, policy]) => name.startsWith("apps-script/") && policy?.sourceSha256);
  if (reviewed.length) {
    const expected = new Set(reviewed.map(([name]) => name));
    const actual = (await listFiles(sourceDirectory)).map(file => file.relative).filter(name =>
      name.startsWith("apps-script/") && !["apps-script/_content-api.json", "apps-script/_project-metadata.json"].includes(name));
    if (actual.length !== expected.size || actual.some(name => !expected.has(name))) {
      throw new Error("L'elenco degli script è cambiato dopo la scansione privacy. Ripeti la scansione prima di esportare.");
    }
  }
  const temporaryDirectory = path.join(path.dirname(sourceDirectory), `.ai-export-${crypto.randomUUID()}`);
  await fsp.cp(sourceDirectory, temporaryDirectory, { recursive: true, errorOnExist: true });
  const excludedFiles = [];
  const redactions = [];
  try {
    // _content-api.json contiene il contenuto integrale restituito dall'API Apps Script,
    // inclusi eventuali file protetti/esclusi. È utile nel backup LOCALE per verifiche
    // e pubblicazione sicura, ma non deve mai essere consegnato all'AI.
    const rawContentApi = path.join(temporaryDirectory, "apps-script", "_content-api.json");
    if (await exists(rawContentApi)) await fsp.unlink(rawContentApi);

    for (const [relativePath, policy] of Object.entries(policies || {})) {
      const normalized = String(relativePath).replace(/\\/g, "/");
      const allowedRootFiles = new Set([
        "spreadsheet.full.json",
        "spreadsheet.xlsx",
        "formulas.json",
        "notes.json",
        "comments.json",
        "structure.json",
      ]);
      const allowed = normalized.startsWith("apps-script/") || allowedRootFiles.has(normalized);
      if (!allowed || normalized.includes("..") || normalized.includes("\0")) continue;
      const target = path.join(temporaryDirectory, ...normalized.split("/"));
      if (!(await exists(target))) continue;
      if (policy?.sourceSha256 && normalized.startsWith("apps-script/")) {
        if (await fileHash(target) !== policy.sourceSha256) {
          throw new Error(`Lo script ${normalized} è cambiato dopo la scansione privacy. Ripeti la scansione prima di esportare.`);
        }
      }
      if (policy?.action === "exclude") {
        await fsp.unlink(target);
        excludedFiles.push(normalized);
      } else if (policy?.action === "redact" && normalized.startsWith("apps-script/")) {
        const original = await fsp.readFile(target, "utf8");
        const result = redactSecrets(original);
        await fsp.writeFile(target, result.text, "utf8");
        redactions.push({
          path: normalized,
          count: result.findings.length,
          types: [...new Set(result.findings.map((item) => item.type))],
        });
      }
    }

    const filesBeforeManifest = await listFiles(temporaryDirectory);
    const includedFiles = [];
    for (const file of filesBeforeManifest) {
      if (["ai-package-manifest.json", "ai-change-schema.json", "ISTRUZIONI_PER_AI.md"].includes(file.relative)) continue;
      includedFiles.push({ path: file.relative, sha256: await fileHash(file.fullPath) });
    }
    const manifest = {
      formatVersion: "1.0",
      backupId,
      createdAt: new Date().toISOString(),
      project: { id: project.id, name: project.name },
      protectedFiles: [...new Set(protectedFiles || [])].sort(),
      excludedFiles: [...new Set(excludedFiles)].sort(),
      redactions,
      includedFiles,
      rules: {
        protectedFilesMustNeverBeChanged: true,
        excludedFilesMustNeverBeReconstructed: true,
        baseHashesMustMatch: true,
      },
    };
    await writeJson(path.join(temporaryDirectory, "ai-package-manifest.json"), manifest);
    await writeJson(path.join(temporaryDirectory, "ai-change-schema.json"), aiChangeSchema());
    await fsp.writeFile(path.join(temporaryDirectory, "ISTRUZIONI_PER_AI.md"), aiInstructions(project.name), "utf8");
    await zipDirectory(temporaryDirectory, zipPath);
    return { zipPath, manifest };
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

class BackupCancelledError extends Error {
  constructor() {
    super("Backup annullato dall'utente.");
    this.code = "BACKUP_CANCELLED";
  }
}

function ensureNotCancelled(shouldCancel = () => false) {
  if (shouldCancel()) throw new BackupCancelledError();
}

function googleErrorMessage(error) {
  return error?.response?.data?.error?.message || error?.message || String(error);
}

function isTransientGoogleError(error) {
  const status = Number(error?.response?.status || error?.code || 0);
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;
  return /timeout|timed out|network|socket hang up|econnreset|eai_again|temporar/i.test(googleErrorMessage(error));
}

async function withGoogleRetry(operation, {
  label = "richiesta Google",
  emit = () => {},
  shouldCancel = () => false,
  attempts = 3,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    ensureNotCancelled(shouldCancel);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientGoogleError(error)) throw error;
      emit("warn", `${label}: tentativo ${attempt} non riuscito, nuovo tentativo automatico...`);
      await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 500 : 1500));
    }
  }
  throw lastError;
}

function quotedSheetTitle(title) {
  return `'${String(title || "").replace(/'/g, "''")}'`;
}

export async function getSpreadsheetSnapshot(sheets, spreadsheetId, emit = () => {}, shouldCancel = () => false) {
  emit("info", "Lettura struttura del Foglio...", 14);
  const metadata = (await withGoogleRetry(
    () => sheets.spreadsheets.get({ spreadsheetId, includeGridData: false }, { timeout: 60000 }),
    { label: "lettura struttura Foglio", emit, shouldCancel },
  )).data;
  const sheetDefinitions = metadata.sheets || [];
  const estimatedCells = sheetDefinitions.reduce((total, sheet) => {
    const grid = sheet.properties?.gridProperties || {};
    return total + Number(grid.rowCount || 0) * Number(grid.columnCount || 0);
  }, 0);

  if (estimatedCells <= 2_000_000) {
    try {
      emit("info", `Lettura completa del Foglio (${estimatedCells.toLocaleString("it-IT")} celle dichiarate)...`, 22);
      return (await withGoogleRetry(
        () => sheets.spreadsheets.get({ spreadsheetId, includeGridData: true }, { timeout: 120000 }),
        { label: "lettura completa Foglio", emit, shouldCancel },
      )).data;
    } catch (error) {
      ensureNotCancelled(shouldCancel);
      emit("warn", `Lettura completa non riuscita (${googleErrorMessage(error)}). Passaggio automatico alla lettura per scheda.`);
    }
  } else {
    emit("info", `Foglio grande rilevato (${estimatedCells.toLocaleString("it-IT")} celle dichiarate): lettura per scheda.`);
  }

  const snapshot = structuredClone(metadata);
  const totalSheets = Math.max(1, snapshot.sheets?.length || 0);
  for (let sheetIndex = 0; sheetIndex < (snapshot.sheets || []).length; sheetIndex += 1) {
    ensureNotCancelled(shouldCancel);
    const targetSheet = snapshot.sheets[sheetIndex];
    const title = targetSheet.properties?.title || `Scheda ${sheetIndex + 1}`;
    const grid = targetSheet.properties?.gridProperties || {};
    const rowCount = Math.max(1, Number(grid.rowCount || 1));
    const columnCount = Math.max(1, Number(grid.columnCount || 1));
    const cells = rowCount * columnCount;
    const chunkRows = cells > 2_000_000 ? 5000 : rowCount;
    const chunkCount = Math.ceil(rowCount / chunkRows);
    targetSheet.data = [];
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      ensureNotCancelled(shouldCancel);
      const startRow = chunkIndex * chunkRows + 1;
      const endRow = Math.min(rowCount, startRow + chunkRows - 1);
      const range = chunkCount === 1
        ? quotedSheetTitle(title)
        : `${quotedSheetTitle(title)}!${startRow}:${endRow}`;
      const detail = chunkCount === 1 ? "" : `, righe ${startRow}-${endRow}`;
      const fraction = (sheetIndex + (chunkIndex + 1) / chunkCount) / totalSheets;
      emit("info", `Lettura scheda ${sheetIndex + 1}/${totalSheets}: ${title}${detail}`, 22 + Math.round(fraction * 33));
      const partial = (await withGoogleRetry(
        () => sheets.spreadsheets.get({
          spreadsheetId,
          includeGridData: true,
          ranges: [range],
          fields: "sheets(properties(sheetId),data)",
        }, { timeout: 120000 }),
        { label: `lettura scheda ${title}`, emit, shouldCancel },
      )).data;
      const returnedSheet = (partial.sheets || []).find((sheet) => sheet.properties?.sheetId === targetSheet.properties?.sheetId)
        || partial.sheets?.[0];
      if (returnedSheet?.data?.length) targetSheet.data.push(...returnedSheet.data);
    }
  }
  return snapshot;
}

export async function listDriveComments(drive, fileId, emit = () => {}, shouldCancel = () => false) {
  const comments = [];
  let pageToken;
  do {
    ensureNotCancelled(shouldCancel);
    const response = await withGoogleRetry(() => drive.comments.list({
      fileId,
      includeDeleted: false,
      pageSize: 100,
      pageToken,
      fields: "nextPageToken,comments(id,content,htmlContent,quotedFileContent(mimeType,value),anchor,resolved,createdTime,modifiedTime,author(displayName,photoLink,me),replies(id,content,htmlContent,createdTime,modifiedTime,action,deleted,author(displayName,photoLink,me)))",
    }, { timeout: 60000 }), { label: "lettura commenti", emit, shouldCancel });
    comments.push(...(response.data.comments || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return comments;
}

async function exportXlsx(drive, spreadsheetId, outputPath, emit, shouldCancel) {
  const response = await withGoogleRetry(() => drive.files.export(
    {
      fileId: spreadsheetId,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    { responseType: "arraybuffer", timeout: 120000 },
  ), { label: "esportazione Excel", emit, shouldCancel });
  await fsp.writeFile(outputPath, Buffer.from(response.data));
}

async function zipDirectory(sourceDirectory, zipPath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(sourceDirectory, false);
    archive.finalize().catch(reject);
  });
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function uniqueVersionDirectory(projectDirectory, timestamp) {
  let candidate = path.join(projectDirectory, timestamp);
  let counter = 2;
  while (await exists(candidate)) {
    candidate = path.join(projectDirectory, `${timestamp}_${String(counter).padStart(2, "0")}`);
    counter += 1;
  }
  return candidate;
}

async function backupOne(auth, project, outputDir, options, filePolicies, emit, shouldCancel) {
  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });
  const scriptApi = google.script({ version: "v1", auth });
  const cleanProject = validateProject(project);
  const projectDirectory = path.join(path.resolve(outputDir), safeName(cleanProject.name));
  const versionDirectory = await uniqueVersionDirectory(projectDirectory, timestampForPath());
  await fsp.mkdir(versionDirectory, { recursive: true });
  const zipPath = `${versionDirectory}_PER_AI.zip`;

  const info = {
    createdAt: new Date().toISOString(),
    projectName: cleanProject.name,
    spreadsheet: null,
    appsScript: null,
    warnings: [],
  };

  try {
    ensureNotCancelled(shouldCancel);
    emit("info", `Preparazione backup: ${cleanProject.name}`, 5);
    if (cleanProject.spreadsheet) {
      emit("info", `Lettura Foglio Google: ${cleanProject.name}`, 10);
      const driveMetadata = (await withGoogleRetry(() => drive.files.get({
        fileId: cleanProject.spreadsheet,
        fields: "id,name,mimeType,modifiedTime,createdTime,webViewLink,owners(displayName,emailAddress),capabilities(canDownload)",
      }, { timeout: 60000 }), { label: "metadati Drive", emit, shouldCancel })).data;
      if (driveMetadata.mimeType !== "application/vnd.google-apps.spreadsheet") {
        throw new Error("L'ID indicato non corrisponde a un Foglio Google.");
      }
      const spreadsheet = await getSpreadsheetSnapshot(sheets, cleanProject.spreadsheet, emit, shouldCancel);
      const formulas = buildFormulaIndex(spreadsheet);
      const notes = buildNoteIndex(spreadsheet);
      await writeJson(path.join(versionDirectory, "spreadsheet.full.json"), spreadsheet);
      await writeJson(path.join(versionDirectory, "formulas.json"), formulas);
      await writeJson(path.join(versionDirectory, "notes.json"), notes);
      await writeJson(path.join(versionDirectory, "structure.json"), buildStructure(spreadsheet));

      let comments = [];
      let commentsStatus = { status: "ok", count: 0, replyCount: 0 };
      try {
        emit("info", "Lettura di commenti e risposte...", 60);
        comments = await listDriveComments(drive, cleanProject.spreadsheet, emit, shouldCancel);
        commentsStatus = {
          status: "ok",
          count: comments.length,
          replyCount: comments.reduce((total, comment) => total + (comment.replies?.length || 0), 0),
        };
        await writeJson(path.join(versionDirectory, "comments.json"), {
          spreadsheetId: cleanProject.spreadsheet,
          exportedAt: new Date().toISOString(),
          comments,
        });
      } catch (error) {
        ensureNotCancelled(shouldCancel);
        commentsStatus = { status: "warning", error: googleErrorMessage(error), count: 0, replyCount: 0 };
        info.warnings.push(`Commenti non salvati: ${commentsStatus.error}`);
        emit("warn", `Commenti non salvati: ${commentsStatus.error}`);
      }

      let xlsx = { status: "skipped" };
      if (options.xlsx !== false) {
        try {
          ensureNotCancelled(shouldCancel);
          emit("info", "Esportazione della copia Excel...", 66);
          await exportXlsx(drive, cleanProject.spreadsheet, path.join(versionDirectory, "spreadsheet.xlsx"), emit, shouldCancel);
          xlsx = { status: "ok" };
        } catch (error) {
          ensureNotCancelled(shouldCancel);
          xlsx = { status: "warning", error: googleErrorMessage(error) };
          info.warnings.push(`Copia Excel non creata: ${xlsx.error}`);
          emit("warn", `Copia Excel non creata: ${xlsx.error}`);
        }
      }
      info.spreadsheet = {
        status: "ok",
        spreadsheetId: cleanProject.spreadsheet,
        name: driveMetadata.name || null,
        modifiedTime: driveMetadata.modifiedTime || null,
        createdTime: driveMetadata.createdTime || null,
        url: driveMetadata.webViewLink || spreadsheet.spreadsheetUrl || null,
        sheetCount: spreadsheet.sheets?.length || 0,
        formulaCount: formulas.length,
        noteCount: notes.length,
        comments: commentsStatus,
        xlsx,
      };
      emit("ok", `Foglio salvato: ${info.spreadsheet.sheetCount} schede, ${formulas.length} formule, ${notes.length} note, ${comments.length} commenti.`, 72);
    }

    if (cleanProject.scriptId) {
      ensureNotCancelled(shouldCancel);
      emit("info", "Download del progetto Apps Script...", cleanProject.spreadsheet ? 76 : 30);
      info.appsScript = await backupScript(
        scriptApi,
        cleanProject.scriptId,
        cleanProject.spreadsheet,
        versionDirectory,
        emit,
        shouldCancel,
      );
      if (info.appsScript.parentMatchesSpreadsheet === false) {
        const warning = "Lo Script ID non risulta collegato al Foglio indicato. Il backup è stato comunque salvato.";
        info.warnings.push(warning);
        emit("warn", warning);
      }
      emit("ok", `Apps Script salvato: ${info.appsScript.fileCount} file.`, 84);
    }

    await writeJson(path.join(versionDirectory, "backup-info.json"), info);
    let finalZipPath = "";
    if (options.zip !== false) {
      ensureNotCancelled(shouldCancel);
      finalZipPath = zipPath;
      emit("info", "Creazione ZIP per l'AI con protezioni e censura...", 90);
      const protectedFiles = [...new Set([
        ...(Array.isArray(project.protectedFiles) ? project.protectedFiles : []),
        ...Object.entries(filePolicies || {})
          .filter(([relativePath, policy]) => relativePath.startsWith("apps-script/") && (policy?.protected === true || policy?.action === "exclude"))
          .map(([relativePath]) => relativePath),
      ])];
      const aiExport = await createAiZip({
        sourceDirectory: versionDirectory,
        project: cleanProject,
        policies: filePolicies || {},
        protectedFiles,
        zipPath: finalZipPath,
        backupId: path.basename(versionDirectory),
      });
      ensureNotCancelled(shouldCancel);
      info.aiExport = {
        zipPath: finalZipPath,
        protectedFiles: aiExport.manifest.protectedFiles,
        excludedFiles: aiExport.manifest.excludedFiles,
        redactions: aiExport.manifest.redactions,
      };
      const originalFiles = [];
      for (const file of await listFiles(versionDirectory)) {
        originalFiles.push({ path: file.relative, sha256: await fileHash(file.fullPath) });
      }
      await writeJson(path.join(versionDirectory, "ai-export-manifest.local.json"), {
        formatVersion: "1.0",
        backupId: path.basename(versionDirectory),
        aiManifest: aiExport.manifest,
        originalFiles,
      });
      await writeJson(path.join(versionDirectory, "backup-info.json"), info);
    }
    emit("ok", `Backup pronto: ${cleanProject.name}`, 100);
    return { project: cleanProject.name, directory: versionDirectory, zipPath: finalZipPath, aiZipPath: finalZipPath, info };
  } catch (error) {
    await Promise.allSettled([
      fsp.rm(versionDirectory, { recursive: true, force: true }),
      fsp.rm(zipPath, { force: true }),
    ]);
    await fsp.rmdir(projectDirectory).catch(() => {});
    throw error;
  }
}

export async function backupProjects({
  projects,
  outputDir,
  credentialsPath,
  tokenPath,
  options = {},
  filePolicies = {},
  onEvent = () => {},
  shouldCancel = () => false,
}) {
  if (!Array.isArray(projects) || projects.length === 0) throw new Error("Nessun progetto selezionato.");
  if (!String(outputDir || "").trim()) throw new Error("La cartella di destinazione è obbligatoria.");
  const auth = await loadAuth(credentialsPath, tokenPath);
  await fsp.mkdir(path.resolve(outputDir), { recursive: true });
  const results = [];
  let failed = 0;
  let cancelled = false;
  for (let projectIndex = 0; projectIndex < projects.length; projectIndex += 1) {
    const project = projects[projectIndex];
    const label = String(project?.name || "Progetto");
    onEvent({ level: "info", message: `Inizio backup: ${label}`, progress: Math.round((projectIndex / projects.length) * 100) });
    try {
      ensureNotCancelled(shouldCancel);
      const projectPolicies = filePolicies[String(project.id || "")] || {};
      const result = await backupOne(auth, project, outputDir, options, projectPolicies, (level, message, localProgress) => {
        const progress = Math.min(100, Math.round(((projectIndex + Number(localProgress || 0) / 100) / projects.length) * 100));
        onEvent({ level, message, project: label, progress });
      }, shouldCancel);
      results.push({ status: "ok", projectId: String(project.id || ""), ...result });
      onEvent({ level: "ok", message: `Backup completato: ${label}`, project: label, progress: Math.round(((projectIndex + 1) / projects.length) * 100) });
    } catch (error) {
      if (error?.code === "BACKUP_CANCELLED") {
        cancelled = true;
        onEvent({ level: "warn", message: "Backup annullato. Le copie parziali sono state eliminate.", project: label });
        break;
      }
      failed += 1;
      const message = googleErrorMessage(error);
      results.push({ status: "error", project: label, error: message });
      onEvent({ level: "error", message: `${label}: ${message}`, project: label });
    }
  }
  return { succeeded: results.filter((item) => item.status === "ok").length, failed, cancelled, results };
}

export function runSelfTest() {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const checkThrows = (callback, message) => {
    try { callback(); failures.push(message); } catch {}
  };
  const fakeId = "1234567890".repeat(2);
  check(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${fakeId}/edit`) === fakeId, "Estrazione Spreadsheet ID");
  check(normalizeScriptId(`https://script.google.com/home/projects/${fakeId}/edit`) === fakeId, "Estrazione Script ID");
  check(safeName("Progetto: test?") === "Progetto_ test_", "Pulizia nome cartella");
  check(safeName("CON") === "_CON", "Nomi riservati Windows");
  check(normalizeAiPath("apps-script/Code.gs") === "apps-script/Code.gs", "Percorso modifica AI valido");
  checkThrows(() => normalizeAiPath("apps-script/cartella/Code.gs"), "Blocco sottocartelle Apps Script");
  checkThrows(() => normalizeAiPath("apps-script/_content-api.json"), "Blocco file interno Apps Script");
  const sample = { sheets: [{ properties: { title: "Dati" }, data: [{ rowData: [{ values: [{ userEnteredValue: { formulaValue: "=1+1" }, note: "Nota importante" }] }] }] }] };
  const formulas = buildFormulaIndex(sample);
  const notes = buildNoteIndex(sample);
  check(formulas.length === 1 && formulas[0].cell === "A1", "Indice formule");
  check(notes.length === 1 && notes[0].cell === "A1" && notes[0].note === "Nota importante", "Indice note");
  const fakeKey = ["AI", "za", "1234567890".repeat(3), "12345"].join("");
  const fakeSlack = ["xox", "b-", "1234567890".repeat(2)].join("");
  const secretSample = `const API_KEY = '${fakeKey}';`;
  const detected = findSecrets(secretSample);
  const censored = redactSecrets(secretSample);
  check(detected.length === 1 && detected[0].type === "Google API key" && detected[0].confidence === "high", "Rilevazione token ad alta confidenza");
  check(!findingPreview(secretSample, detected[0]).includes(fakeKey.slice(0, 10)), "Anteprima token mascherata");
  const dualSecretSample = `const a='${fakeKey}'; const b='${fakeSlack}';`;
  const dualFindings = findSecrets(dualSecretSample);
  const dualPreview = findingPreview(dualSecretSample, dualFindings[0], dualFindings);
  check(!dualPreview.includes("AIza") && !dualPreview.includes("xoxb-"), "Anteprima maschera tutti i token sulla stessa riga");
  check(findSecrets("const password = 'valore-da-controllare';")[0]?.confidence === "review", "Segnalazione da verificare");
  check(findSecrets("const key = 'GESTIONALE_LAST_PRIMA_NOTA_IMPORT';").length === 0, "Nessun falso positivo su chiavi tecniche lunghe");
  check(!censored.text.includes(fakeKey.slice(0, 10)), "Censura token");
  const editedCensored = censored.text.replace("const API_KEY", "// modifica AI\nconst API_KEY");
  const rehydrated = rehydrateRedactions(secretSample, editedCensored);
  check(rehydrated.text.includes(fakeKey), "Ripristino sicuro token");
  if (failures.length) throw new Error(`SELF-TEST FALLITO: ${failures.join(", ")}`);
  return "SELF-TEST OK";
}

if (process.argv[1] && path.basename(process.argv[1]) === "engine.mjs") {
  if (process.argv[2] === "self-test") {
    try {
      console.log(runSelfTest());
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
