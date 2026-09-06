const APP_HEADER = { "Content-Type": "application/json", "X-App-Request": "GoogleWorkspaceBackup" };

const ui = {
  appVersionBadge: document.querySelector("#appVersionBadge"),
  globalStatus: document.querySelector("#globalStatus"),
  nodeStatus: document.querySelector("#nodeStatus"),
  nodeText: document.querySelector("#nodeText"),
  credentialsStatus: document.querySelector("#credentialsStatus"),
  credentialsText: document.querySelector("#credentialsText"),
  loginStatus: document.querySelector("#loginStatus"),
  loginText: document.querySelector("#loginText"),
  tokenProtectionText: document.querySelector("#tokenProtectionText"),
  accessDetails: document.querySelector("#accessDetails"),
  projectsBody: document.querySelector("#projectsBody"),
  emptyProjects: document.querySelector("#emptyProjects"),
  outputDir: document.querySelector("#outputDir"),
  xlsxOption: document.querySelector("#xlsxOption"),
  zipOption: document.querySelector("#zipOption"),
  backupSummary: document.querySelector("#backupSummary"),
  runBackupButton: document.querySelector("#runBackupButton"),
  cancelBackupButton: document.querySelector("#cancelBackupButton"),
  progressWrap: document.querySelector("#progressWrap"),
  progressBar: document.querySelector("#progressBar"),
  logBox: document.querySelector("#logBox"),
  historyList: document.querySelector("#historyList"),
  emptyHistory: document.querySelector("#emptyHistory"),
  privacyDialog: document.querySelector("#privacyDialog"),
  privacyBody: document.querySelector("#privacyBody"),
  privacyEmpty: document.querySelector("#privacyEmpty"),
  privacySummary: document.querySelector("#privacySummary"),
  aiOperationsBody: document.querySelector("#aiOperationsBody"),
  aiPackageSummary: document.querySelector("#aiPackageSummary"),
  aiPreviewStatus: document.querySelector("#aiPreviewStatus"),
  applyAiButton: document.querySelector("#applyAiButton"),
  applyPublishAiButton: document.querySelector("#applyPublishAiButton"),
  toast: document.querySelector("#toast"),
};

let currentState = null;
let toastTimer = null;
let jobTimer = null;

async function api(url, options = {}) {
  const requestOptions = { cache: "no-store", ...options };
  if (requestOptions.method && requestOptions.method !== "GET") {
    requestOptions.headers = { ...APP_HEADER, ...(requestOptions.headers || {}) };
  }
  const response = await fetch(url, requestOptions);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore ${response.status}`);
  return payload;
}

function showToast(message, isError = false) {
  ui.toast.textContent = message;
  ui.toast.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.className = "toast"; }, 4200);
}

function setDot(element, state) {
  element.className = `dot ${state}`;
}

function switchPage(pageName) {
  document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.id === `page-${pageName}`));
  document.querySelectorAll(".step").forEach((step) => step.classList.toggle("active", step.dataset.page === pageName));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renderSetup(state) {
  const nodeMajor = Number(String(state.nodeVersion || "").replace(/^v/, "").split(".")[0]);
  const nodeOk = nodeMajor >= 24;
  setDot(ui.nodeStatus, nodeOk ? "ok" : "error");
  ui.nodeText.textContent = nodeOk ? `Node.js ${state.nodeVersion}: pronto` : `Node.js ${state.nodeVersion}: serve Node.js 24 LTS`;

  setDot(ui.credentialsStatus, state.credentialsConfigured ? "ok" : "warn");
  if (state.credentialsConfigured) {
    const project = state.credentials?.projectId ? ` · progetto ${state.credentials.projectId}` : "";
    ui.credentialsText.textContent = `Credenziali Desktop configurate${project}`;
  } else {
    ui.credentialsText.textContent = state.credentials?.error || "Credenziali non configurate";
  }

  const failedChecks = (state.accessChecks || []).reduce((total, item) => total
    + (item.drive?.ok === false ? 1 : 0)
    + (item.spreadsheet?.ok === false ? 1 : 0)
    + (item.appsScript?.ok === false ? 1 : 0), 0);
  const tokenInvalid = state.tokenProtection === "invalid";
  setDot(ui.loginStatus, !state.tokenConfigured ? "warn" : (failedChecks || tokenInvalid) ? "error" : "ok");
  if (tokenInvalid) {
    ui.loginText.textContent = "Token locale non valido: scollega e collega di nuovo l'account";
  } else if (!state.tokenConfigured) {
    ui.loginText.textContent = "Account non collegato";
  } else if (state.account?.emailAddress) {
    const displayName = state.account.displayName ? `${state.account.displayName} · ` : "";
    ui.loginText.textContent = `${displayName}${state.account.emailAddress}${failedChecks ? ` · ${failedChecks} accessi da correggere` : " · accesso verificato"}`;
  } else {
    ui.loginText.textContent = "Account collegato; usa Verifica accesso per identificarlo e controllare i progetti";
  }

  if (state.tokenProtection === "dpapi") {
    ui.tokenProtectionText.textContent = "Token locale cifrato con la protezione dell'utente Windows.";
  } else if (state.tokenProtection === "plain") {
    ui.tokenProtectionText.textContent = "Token locale non cifrato su questo sistema; su Windows viene migrato automaticamente alla prossima verifica.";
  } else if (state.tokenProtection === "invalid") {
    ui.tokenProtectionText.textContent = "Il file token locale non è leggibile: scollega e collega di nuovo l'account.";
  } else {
    ui.tokenProtectionText.textContent = "Il token personale non viene mai inserito nei backup.";
  }

  const accessRows = [];
  for (const check of state.accessChecks || []) {
    const parts = [];
    if (check.drive) parts.push(`Drive: ${check.drive.ok ? "OK" : `ERRORE — ${check.drive.error}`}`);
    if (check.spreadsheet) parts.push(`Foglio: ${check.spreadsheet.ok ? "OK" : `ERRORE — ${check.spreadsheet.error}`}`);
    if (check.appsScript) parts.push(`Apps Script: ${check.appsScript.ok ? "OK" : `ERRORE — ${check.appsScript.error}`}`);
    const row = document.createElement("p");
    row.className = parts.some((part) => part.includes("ERRORE")) ? "access-error" : "access-ok";
    row.textContent = `${check.projectName}: ${parts.join(" · ")}`;
    accessRows.push(row);
  }
  ui.accessDetails.replaceChildren(...accessRows);
  ui.accessDetails.hidden = accessRows.length === 0;

  if (nodeOk && state.credentialsConfigured && state.tokenConfigured && !tokenInvalid) {
    ui.globalStatus.textContent = failedChecks ? "Accessi da correggere" : "Configurazione pronta";
    ui.globalStatus.className = failedChecks ? "status warn" : "status ok";
  } else {
    ui.globalStatus.textContent = "Configurazione da completare";
    ui.globalStatus.className = "status warn";
  }
}

function projectRow(project) {
  const row = document.createElement("tr");
  row.dataset.id = project.id || randomId();

  const enabledCell = document.createElement("td");
  enabledCell.className = "enabled-cell";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.className = "project-enabled";
  enabled.checked = project.enabled !== false;
  enabled.setAttribute("aria-label", "Progetto attivo");
  enabledCell.append(enabled);

  const nameCell = document.createElement("td");
  const name = document.createElement("input");
  name.type = "text";
  name.className = "project-name";
  name.placeholder = "Es. Progetto demo";
  name.value = project.name || "";
  nameCell.append(name);

  const sheetCell = document.createElement("td");
  const sheet = document.createElement("input");
  sheet.type = "text";
  sheet.className = "project-sheet";
  sheet.placeholder = "https://docs.google.com/spreadsheets/d/…";
  sheet.value = project.spreadsheet || "";
  sheet.spellcheck = false;
  sheetCell.append(sheet);

  const scriptCell = document.createElement("td");
  const script = document.createElement("input");
  script.type = "text";
  script.className = "project-script";
  script.placeholder = "ID script (facoltativo)";
  script.value = project.scriptId || "";
  script.spellcheck = false;
  scriptCell.append(script);

  const actionCell = document.createElement("td");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "delete-row";
  remove.textContent = "×";
  remove.title = "Elimina progetto";
  remove.addEventListener("click", () => {
    row.remove();
    updateProjectEmptyState();
    updateBackupSummary();
  });
  actionCell.append(remove);
  row.append(enabledCell, nameCell, sheetCell, scriptCell, actionCell);
  row.querySelectorAll("input").forEach((input) => input.addEventListener("input", updateBackupSummary));
  return row;
}

function renderProjects(projects) {
  ui.projectsBody.replaceChildren(...projects.map(projectRow));
  updateProjectEmptyState();
  updateBackupSummary();
}

function updateProjectEmptyState() {
  ui.emptyProjects.hidden = ui.projectsBody.children.length > 0;
  document.querySelector("#projectsTable").hidden = ui.projectsBody.children.length === 0;
}

function collectProjects() {
  return [...ui.projectsBody.querySelectorAll("tr")].map((row) => ({
    id: row.dataset.id,
    enabled: row.querySelector(".project-enabled").checked,
    name: row.querySelector(".project-name").value.trim(),
    spreadsheet: row.querySelector(".project-sheet").value.trim(),
    scriptId: row.querySelector(".project-script").value.trim(),
  }));
}

function updateBackupSummary() {
  const projects = collectProjects();
  const enabled = projects.filter((project) => project.enabled);
  const sheets = enabled.filter((project) => project.spreadsheet).length;
  const scripts = enabled.filter((project) => project.scriptId).length;
  ui.backupSummary.innerHTML = `<b>${enabled.length}</b> progetti attivi · <b>${sheets}</b> Fogli · <b>${scripts}</b> Apps Script`;
}

function renderHistory(history) {
  ui.emptyHistory.hidden = history.length > 0;
  ui.historyList.replaceChildren(...history.map((item) => {
    const card = document.createElement("article");
    card.className = "card history-item";
    const nameWrap = document.createElement("div");
    const name = document.createElement("div");
    name.className = "history-name";
    name.textContent = item.project;
    nameWrap.append(name);
    if (item.type === "ai_modified") {
      const badge = document.createElement("div");
      badge.className = `history-badge ${item.publishedToGoogle ? "published" : "local"}`;
      badge.textContent = item.publishedToGoogle ? "AI · pubblicato su Google" : "AI · solo locale";
      nameWrap.append(badge);
    } else if (item.type === "safety_backup") {
      const badge = document.createElement("div");
      badge.className = "history-badge safety";
      badge.textContent = "Backup sicurezza pre-pubblicazione";
      nameWrap.append(badge);
    }
    const filePath = document.createElement("div");
    filePath.className = "history-path";
    filePath.textContent = item.zipPath || item.directory;
    const date = document.createElement("div");
    date.className = "history-date";
    date.textContent = new Date(item.completedAt).toLocaleString("it-IT");
    const actions = document.createElement("div");
    actions.className = "history-actions";
    if (item.type === "ai_modified" && item.publishedToGoogle !== true && item.id) {
      const publish = document.createElement("button");
      publish.type = "button";
      publish.className = "button small primary";
      publish.textContent = "Pubblica su Google";
      publish.addEventListener("click", () => publishHistoryItem(item.id, publish));
      actions.append(publish);
    } else if (item.type === "ai_modified" && item.publishedToGoogle === true) {
      const status = document.createElement("span");
      status.className = "history-published";
      status.textContent = "Pubblicato";
      actions.append(status);
    }
    card.append(nameWrap, filePath, date, actions);
    return card;
  }));
}

function renderState(state) {
  currentState = state;
  if (ui.appVersionBadge) {
    const version = state.appVersion || "?";
    ui.appVersionBadge.textContent = `v${version}`;
    ui.appVersionBadge.title = `Versione programma ${version}`;
    document.title = `Google Workspace Backup v${version}`;
  }
  renderSetup(state);
  renderProjects(state.projects || []);
  ui.outputDir.value = state.outputDir || "";
  ui.xlsxOption.checked = state.options?.xlsx !== false;
  ui.zipOption.checked = state.options?.zip !== false;
  renderHistory(state.history || []);
}

async function refreshState() {
  const state = await api("/api/state");
  renderState(state);
  return state;
}

async function saveSettings(showConfirmation = true) {
  const payload = {
    projects: collectProjects(),
    outputDir: ui.outputDir.value.trim(),
    options: { xlsx: ui.xlsxOption.checked, zip: ui.zipOption.checked },
  };
  const state = await api("/api/state", { method: "POST", body: JSON.stringify(payload) });
  currentState = state;
  renderProjects(state.projects || []);
  renderHistory(state.history || []);
  if (showConfirmation) showToast("Configurazione salvata.");
  return state;
}

async function importCredentials(file) {
  const text = await file.text();
  let credentials;
  try { credentials = JSON.parse(text); } catch { throw new Error("Il file selezionato non è un JSON valido."); }
  await api("/api/credentials", { method: "POST", body: JSON.stringify({ credentials }) });
  await refreshState();
  showToast("Credenziali configurate. Ora collega l'account Google.");
}

function setButtonsBusy(isBusy) {
  document.querySelectorAll("button").forEach((button) => {
    if (button.id === "shutdownButton") return;
    if (isBusy) {
      button.dataset.disabledBeforeBusy = button.disabled ? "true" : "false";
      button.disabled = true;
    } else {
      button.disabled = button.dataset.disabledBeforeBusy === "true";
      delete button.dataset.disabledBeforeBusy;
    }
  });
}

async function accountAction(action) {
  setButtonsBusy(true);
  try {
    let result = null;
    if (action === "login" || action === "publish") {
      ui.loginText.textContent = "Completa l'accesso nella finestra Google…";
      result = await api("/api/auth", { method: "POST", body: JSON.stringify({ mode: action === "publish" ? "publish" : "backup" }) });
      showToast(result.failedCount ? `Account collegato, ma ${result.failedCount} accessi richiedono attenzione.` : "Account Google collegato e verificato.", result.failedCount > 0);
    } else if (action === "test") {
      result = await api("/api/auth/test", { method: "POST", body: "{}" });
      showToast(result.failedCount ? `Verifica completata: ${result.failedCount} accessi non disponibili.` : "Accesso Google verificato per tutti i progetti.", result.failedCount > 0);
    } else {
      await api("/api/auth", { method: "DELETE", body: "{}" });
      showToast("Account scollegato da questo PC.");
    }
    await refreshState();
  } catch (error) {
    setDot(ui.loginStatus, "error");
    ui.loginText.textContent = error.message;
    showToast(error.message, true);
  } finally {
    setButtonsBusy(false);
  }
}

function formatJobLog(job) {
  if (!job.logs?.length) return "Avvio…";
  return job.logs.map((entry) => {
    const time = new Date(entry.time).toLocaleTimeString("it-IT");
    return `[${time}] [${String(entry.level).toUpperCase()}] ${entry.message}`;
  }).join("\n");
}

function updatePrivacySummary() {
  const rows = [...ui.privacyBody.querySelectorAll("tr")];
  const censored = rows.filter((row) => row.querySelector("select").value === "redact").length;
  const excluded = rows.filter((row) => row.querySelector("select").value === "exclude").length;
  const protectedCount = rows.filter((row) => row.querySelector(".protect-file").checked).length;
  const reviewsIncluded = rows.filter((row) => row.dataset.review === "true" && row.querySelector("select").value === "include").length;
  ui.privacySummary.textContent = `${censored} censurati · ${excluded} esclusi · ${protectedCount} intoccabili · ${reviewsIncluded} avvisi inclusi`;
}

function renderPrivacyReview(scan) {
  const rows = [];
  for (const project of scan.projects || []) {
    const protectedSet = new Set((project.protectedFiles || []).map((item) => String(item).toLowerCase()));
    for (const file of project.files || []) {
      const row = document.createElement("tr");
      row.dataset.projectId = project.projectId;
      row.dataset.path = file.path;
      row.dataset.sourceSha256 = file.sourceSha256;
      row.dataset.kind = "script";
      row.dataset.highConfidence = file.highConfidenceCount > 0 ? "true" : "false";
      row.dataset.review = file.reviewCount > 0 ? "true" : "false";

      const projectCell = document.createElement("td");
      projectCell.textContent = project.projectName;
      const fileCell = document.createElement("td");
      fileCell.textContent = file.name;
      const findingsCell = document.createElement("td");
      if (file.findingCount) {
        const list = document.createElement("ul");
        list.className = "finding-list";
        for (const finding of file.findings) {
          const item = document.createElement("li");
          const label = document.createElement("span");
          label.className = finding.confidence === "high" ? "finding-high" : "finding-review";
          label.textContent = `${finding.confidence === "high" ? "Token probabile" : "Da verificare"}: ${finding.type} · riga ${finding.line} · ${finding.length} caratteri`;
          const preview = document.createElement("code");
          preview.className = "finding-preview";
          preview.textContent = finding.preview || "[VALORE NASCOSTO]";
          item.append(label, preview);
          list.append(item);
        }
        findingsCell.append(list);
      } else {
        findingsCell.textContent = "Nessun candidato";
      }

      const actionCell = document.createElement("td");
      const select = document.createElement("select");
      for (const [value, label] of [["include", "Includi"], ["redact", "Censura token"], ["exclude", "Escludi"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.append(option);
      }
      select.value = file.highConfidenceCount > 0 ? "redact" : "include";
      actionCell.append(select);

      const protectCell = document.createElement("td");
      protectCell.className = "enabled-cell";
      const protect = document.createElement("input");
      protect.type = "checkbox";
      protect.className = "protect-file";
      protect.checked = protectedSet.has(file.path.toLowerCase());
      protect.title = "Impedisce modifiche provenienti dall'AI";
      protectCell.append(protect);

      select.addEventListener("change", () => {
        if (select.value === "exclude") {
          protect.checked = true;
          protect.disabled = true;
        } else {
          protect.disabled = false;
        }
        updatePrivacySummary();
      });
      protect.addEventListener("change", updatePrivacySummary);
      row.append(projectCell, fileCell, findingsCell, actionCell, protectCell);
      rows.push(row);
    }

    if (project.spreadsheet) {
      const row = document.createElement("tr");
      row.dataset.projectId = project.projectId;
      row.dataset.kind = "spreadsheet";
      row.dataset.review = "true";
      const projectCell = document.createElement("td");
      projectCell.textContent = project.projectName;
      const fileCell = document.createElement("td");
      fileCell.textContent = `Dati Foglio: ${project.spreadsheet.title}`;
      const findingsCell = document.createElement("td");
      const warning = document.createElement("p");
      warning.className = "risk-alert";
      warning.textContent = "Possibile rischio: i valori delle celle, le note e i commenti non possono essere classificati automaticamente come segreti.";
      const preview = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `Anteprima struttura: ${project.spreadsheet.sheetCount} schede, ${project.spreadsheet.hiddenSheetCount} nascoste`;
      const names = document.createElement("p");
      const visibleNames = (project.spreadsheet.sheetNames || []).slice(0, 20);
      names.textContent = visibleNames.join(" · ") + ((project.spreadsheet.sheetNames || []).length > 20 ? " · …" : "");
      preview.append(summary, names);
      findingsCell.append(warning, preview);

      const actionCell = document.createElement("td");
      const select = document.createElement("select");
      for (const [value, label] of [["include", "Includi dati Foglio"], ["exclude", "Escludi dati Foglio"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.append(option);
      }
      actionCell.append(select);

      const protectCell = document.createElement("td");
      protectCell.className = "enabled-cell";
      const protect = document.createElement("input");
      protect.type = "checkbox";
      protect.className = "protect-file";
      protect.disabled = true;
      protect.title = "I file dati sono di sola consultazione e non possono essere ripubblicati dall'AI";
      protectCell.append(protect);
      select.addEventListener("change", updatePrivacySummary);
      row.append(projectCell, fileCell, findingsCell, actionCell, protectCell);
      rows.push(row);
    }
  }
  ui.privacyBody.replaceChildren(...rows);
  ui.privacyEmpty.hidden = rows.length > 0;
  document.querySelector(".privacy-table").hidden = rows.length === 0;
  updatePrivacySummary();
  ui.privacyDialog.showModal();
}

function collectPrivacyPolicies() {
  const policies = {};
  for (const row of ui.privacyBody.querySelectorAll("tr")) {
    const projectId = row.dataset.projectId;
    if (!policies[projectId]) policies[projectId] = {};
    const action = row.querySelector("select").value;
    if (row.dataset.kind === "spreadsheet") {
      for (const relativePath of ["spreadsheet.full.json", "spreadsheet.xlsx", "formulas.json", "notes.json", "comments.json", "structure.json"]) {
        policies[projectId][relativePath] = { action, protected: false };
      }
    } else {
      policies[projectId][row.dataset.path] = {
        action,
        protected: row.querySelector(".protect-file").checked,
        sourceSha256: row.dataset.sourceSha256,
      };
    }
  }
  return policies;
}

async function pollJob() {
  try {
    const job = await api("/api/job");
    ui.logBox.textContent = formatJobLog(job);
    ui.logBox.scrollTop = ui.logBox.scrollHeight;
    const running = job.status === "running";
    ui.progressWrap.hidden = !running;
    ui.progressWrap.classList.remove("indeterminate");
    const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
    ui.progressBar.style.width = `${progress}%`;
    ui.progressWrap.setAttribute("aria-valuenow", String(progress));
    ui.runBackupButton.disabled = running;
    ui.cancelBackupButton.hidden = !running;
    ui.cancelBackupButton.disabled = job.cancelRequested === true;
    ui.cancelBackupButton.textContent = job.cancelRequested ? "Annullamento in corso…" : "Annulla backup";
    ui.runBackupButton.textContent = running ? "Backup in corso…" : "Scansiona e avvia backup";
    if (running) {
      jobTimer = setTimeout(pollJob, 900);
      return;
    }
    clearTimeout(jobTimer);
    jobTimer = null;
    if (job.status === "completed") showToast("Backup completato.");
    if (job.status === "completed_with_errors") showToast("Backup completato con alcuni errori. Controlla il log.", true);
    if (job.status === "error") showToast(job.error || "Backup non riuscito.", true);
    if (job.status === "cancelled") showToast("Backup annullato; le copie parziali sono state eliminate.");
    await refreshState();
    if (["completed", "completed_with_errors"].includes(job.status)) switchPage("results");
  } catch (error) {
    ui.progressWrap.hidden = true;
    ui.cancelBackupButton.hidden = true;
    ui.runBackupButton.disabled = false;
    ui.runBackupButton.textContent = "Scansiona e avvia backup";
    showToast(error.message, true);
  }
}

async function scanBeforeBackup() {
  try {
    await saveSettings(false);
    ui.logBox.textContent = "Scansione degli script e ricerca di possibili token…";
    ui.progressWrap.hidden = false;
    ui.progressWrap.classList.add("indeterminate");
    ui.progressBar.style.width = "34%";
    ui.runBackupButton.disabled = true;
    ui.runBackupButton.textContent = "Scansione in corso…";
    const scan = await api("/api/secrets/scan", { method: "POST", body: "{}" });
    ui.progressWrap.hidden = true;
    ui.progressWrap.classList.remove("indeterminate");
    renderPrivacyReview(scan);
  } catch (error) {
    ui.progressWrap.hidden = true;
    ui.progressWrap.classList.remove("indeterminate");
    ui.runBackupButton.disabled = false;
    ui.runBackupButton.textContent = "Scansiona e avvia backup";
    showToast(error.message, true);
    ui.logBox.textContent += `\n[ERRORE] ${error.message}`;
  }
}

async function runBackupWithPolicies() {
  try {
    const unsafeIncludes = [...ui.privacyBody.querySelectorAll("tr")]
      .filter((row) => row.dataset.highConfidence === "true" && row.querySelector("select").value === "include");
    if (unsafeIncludes.length && !window.confirm(`Hai scelto di includere ${unsafeIncludes.length} file con token ad alta confidenza senza censura. Continuare?`)) return;
    const filePolicies = collectPrivacyPolicies();
    ui.privacyDialog.close();
    ui.logBox.textContent = "Avvio backup con le protezioni selezionate…";
    ui.progressWrap.hidden = false;
    ui.progressWrap.classList.remove("indeterminate");
    ui.progressBar.style.width = "0%";
    ui.cancelBackupButton.hidden = false;
    await api("/api/backup", { method: "POST", body: JSON.stringify({ filePolicies }) });
    await pollJob();
  } catch (error) {
    ui.progressWrap.hidden = true;
    ui.cancelBackupButton.hidden = true;
    ui.runBackupButton.disabled = false;
    ui.runBackupButton.textContent = "Scansiona e avvia backup";
    showToast(error.message, true);
  }
}

async function cancelBackup() {
  ui.cancelBackupButton.disabled = true;
  ui.cancelBackupButton.textContent = "Annullamento in corso…";
  try {
    await api("/api/job/cancel", { method: "POST", body: "{}" });
  } catch (error) {
    ui.cancelBackupButton.disabled = false;
    ui.cancelBackupButton.textContent = "Annulla backup";
    showToast(error.message, true);
  }
}

function renderAiInspection(inspection) {
  ui.aiOperationsBody.replaceChildren(...inspection.operations.map((operation) => {
    const row = document.createElement("tr");
    const action = document.createElement("td");
    action.textContent = operation.action;
    const file = document.createElement("td");
    file.textContent = operation.path;
    const status = document.createElement("td");
    status.textContent = operation.detail;
    status.className = operation.status === "ready" ? "operation-ready" : operation.status === "conflict" ? "operation-conflict" : "operation-blocked";
    const reason = document.createElement("td");
    reason.textContent = operation.reason || "—";
    row.append(action, file, status, reason);
    return row;
  }));
  ui.aiPackageSummary.textContent = `${inspection.project.name}: ${inspection.summary}`;
  if (inspection.conflictCount > 0) {
    ui.aiPreviewStatus.textContent = `${inspection.conflictCount} conflitti`;
    ui.aiPreviewStatus.className = "status error";
  } else if (inspection.protectedCount > 0) {
    ui.aiPreviewStatus.textContent = `${inspection.protectedCount} operazioni bloccate`;
    ui.aiPreviewStatus.className = "status warn";
  } else {
    ui.aiPreviewStatus.textContent = "Controllo superato";
    ui.aiPreviewStatus.className = "status ok";
  }
  ui.applyAiButton.dataset.packageId = inspection.id;
  ui.applyPublishAiButton.dataset.packageId = inspection.id;
  const blocked = inspection.conflictCount > 0 || inspection.readyCount === 0;
  ui.applyAiButton.disabled = blocked;
  ui.applyPublishAiButton.disabled = blocked;
}

async function inspectAiFile(file) {
  let payload;
  try { payload = JSON.parse(await file.text()); } catch { throw new Error("Il file modifiche-ai.json non contiene JSON valido."); }
  const inspection = await api("/api/ai/inspect", { method: "POST", body: JSON.stringify(payload) });
  renderAiInspection(inspection);
  showToast("Pacchetto AI controllato.");
}

async function applyAiChanges() {
  const packageId = ui.applyAiButton.dataset.packageId;
  if (!packageId) return;
  ui.applyAiButton.disabled = true;
  ui.applyPublishAiButton.disabled = true;
  ui.applyAiButton.textContent = "Applicazione in corso…";
  try {
    const result = await api("/api/ai/apply", { method: "POST", body: JSON.stringify({ packageId }) });
    showToast(`Creata nuova copia locale. Modifiche: ${result.appliedCount}. File protetti saltati: ${result.skippedProtectedCount}.`);
    await refreshState();
    switchPage("results");
  } catch (error) {
    showToast(error.message, true);
    ui.applyAiButton.disabled = false;
    ui.applyPublishAiButton.disabled = false;
  } finally {
    ui.applyAiButton.textContent = "Crea solo copia locale";
  }
}

async function applyAndPublishAiChanges() {
  const packageId = ui.applyPublishAiButton.dataset.packageId;
  if (!packageId) return;
  const confirmed = window.confirm("Verrà creata una copia locale, un backup di sicurezza dello stato Google corrente e poi verrà aggiornato Apps Script. Continuare?");
  if (!confirmed) return;
  ui.applyAiButton.disabled = true;
  ui.applyPublishAiButton.disabled = true;
  ui.applyPublishAiButton.textContent = "Pubblicazione in corso…";
  try {
    const result = await api("/api/ai/apply-publish", { method: "POST", body: JSON.stringify({ packageId }) });
    showToast(`Pubblicazione completata su Google. File Apps Script: ${result.publication.fileCount}.`);
    await refreshState();
    switchPage("results");
  } catch (error) {
    showToast(error.message, true);
    await refreshState().catch(() => {});
    switchPage("results");
  } finally {
    ui.applyPublishAiButton.textContent = "Applica e pubblica su Google";
  }
}

async function publishHistoryItem(historyId, button) {
  const confirmed = window.confirm("Prima della pubblicazione verrà creato un backup di sicurezza e verrà verificato che Google non sia cambiato dopo il backup usato dall'AI. Continuare?");
  if (!confirmed) return;
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = "Pubblicazione…";
  try {
    const result = await api("/api/ai/publish", { method: "POST", body: JSON.stringify({ historyId }) });
    showToast(`Pubblicato su Google: ${result.fileCount} file Apps Script.`);
    await refreshState();
  } catch (error) {
    showToast(error.message, true);
    await refreshState().catch(() => {});
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

document.querySelectorAll(".step").forEach((button) => button.addEventListener("click", () => switchPage(button.dataset.page)));
document.querySelectorAll("[data-next]").forEach((button) => button.addEventListener("click", () => switchPage(button.dataset.next)));

document.querySelector("#refreshStatusButton").addEventListener("click", () => refreshState().catch((error) => showToast(error.message, true)));
document.querySelector("#credentialsButton").addEventListener("click", () => document.querySelector("#credentialsFile").click());
document.querySelector("#credentialsFile").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try { await importCredentials(file); } catch (error) { showToast(error.message, true); }
  event.target.value = "";
});
document.querySelector("#loginButton").addEventListener("click", () => accountAction("login"));
document.querySelector("#enablePublishButton").addEventListener("click", () => accountAction("publish"));
document.querySelector("#testLoginButton").addEventListener("click", () => accountAction("test"));
document.querySelector("#logoutButton").addEventListener("click", () => accountAction("logout"));

document.querySelector("#addProjectButton").addEventListener("click", () => {
  ui.projectsBody.append(projectRow({ id: randomId(), enabled: true, name: "", spreadsheet: "", scriptId: "" }));
  updateProjectEmptyState();
  updateBackupSummary();
  ui.projectsBody.lastElementChild.querySelector(".project-name").focus();
});
document.querySelector("#saveProjectsButton").addEventListener("click", () => saveSettings().catch((error) => showToast(error.message, true)));
document.querySelector("#projectsNextButton").addEventListener("click", async () => {
  try { await saveSettings(); switchPage("backup"); } catch (error) { showToast(error.message, true); }
});

document.querySelector("#chooseFolderButton").addEventListener("click", async () => {
  try {
    const result = await api("/api/choose-folder", { method: "POST", body: "{}" });
    ui.outputDir.value = result.outputDir;
  } catch (error) { showToast(error.message, true); }
});
document.querySelector("#openFolderButton").addEventListener("click", () => api("/api/open-folder", { method: "POST", body: "{}" }).catch((error) => showToast(error.message, true)));
document.querySelector("#resultsOpenFolderButton").addEventListener("click", () => api("/api/open-folder", { method: "POST", body: "{}" }).catch((error) => showToast(error.message, true)));
ui.runBackupButton.addEventListener("click", scanBeforeBackup);
ui.cancelBackupButton.addEventListener("click", cancelBackup);
document.querySelector("#confirmPrivacyButton").addEventListener("click", runBackupWithPolicies);
document.querySelector("#cancelPrivacyButton").addEventListener("click", () => {
  ui.runBackupButton.disabled = false;
  ui.runBackupButton.textContent = "Scansiona e avvia backup";
});
ui.privacyDialog.addEventListener("cancel", () => {
  ui.runBackupButton.disabled = false;
  ui.runBackupButton.textContent = "Scansiona e avvia backup";
});
document.querySelector("#aiFileButton").addEventListener("click", () => document.querySelector("#aiFile").click());
document.querySelector("#aiFile").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try { await inspectAiFile(file); } catch (error) { showToast(error.message, true); }
  event.target.value = "";
});
ui.applyAiButton.addEventListener("click", applyAiChanges);
ui.applyPublishAiButton.addEventListener("click", applyAndPublishAiChanges);
ui.copyLogButton = document.querySelector("#copyLogButton");
ui.copyLogButton.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(ui.logBox.textContent); showToast("Log copiato."); }
  catch { showToast("Impossibile copiare il log.", true); }
});

document.querySelector("#shutdownButton").addEventListener("click", async () => {
  try {
    await api("/api/shutdown", { method: "POST", body: "{}" });
    document.body.innerHTML = "<main><div class='card empty-state'><h2>Programma chiuso</h2><p>Puoi chiudere questa scheda.</p></div></main>";
    window.close();
  } catch (error) { showToast(error.message, true); }
});

refreshState()
  .then((state) => {
    if (state.activeJob?.status === "running") {
      switchPage("backup");
      pollJob();
    }
  })
  .catch((error) => {
    ui.globalStatus.textContent = "Errore di avvio";
    ui.globalStatus.className = "status error";
    showToast(error.message, true);
  });
