import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findSecrets } from '../engine.mjs';
import { root } from './common.mjs';

export function inspectText(name, text) {
  const issues = [];
  if (findSecrets(text).some(item => item.confidence === 'high')) issues.push('possibile segreto riconoscibile');
  const emails = text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) || [];
  if (emails.some(email => !email.endsWith('@example.invalid') && !email.endsWith('@example.com'))) issues.push('email da verificare');
  if (/"(?:refresh_token|private_key|client_secret)"\s*:\s*"[^"\s]+"/.test(text)) issues.push('credenziali JSON');
  if (/C:\\\\?Users\\\\?[^\\\s"']+/i.test(text)) issues.push('percorso personale Windows');
  if (/https:\/\/(?:docs\.google\.com\/spreadsheets\/d|script\.google\.com\/home\/projects)\/[A-Za-z0-9_-]{20,}/.test(text)) issues.push('ID Google in URL');
  return issues.map(reason => `${name}: ${reason}`);
}
export function forbiddenFile(name) {
  const base = path.posix.basename(name).toLowerCase();
  return /(?:^|\/)(?:backups?|data|user-data|runtime|dist|release)\//i.test(name)
    || /^(?:\.env(?:\..*)?|.*credentials.*\.json|.*token.*\.json|client_secret.*\.json|.*oauth.*\.json|state.*\.json|instance\.(?:json|lock.*)|config\.local\..*|settings\.local\..*)$/.test(base)
    || /\.(?:pem|key|p12|pfx|crt|cer|der|zip|7z|exe|msi|log|tmp)$/.test(base)
    || /^(?:spreadsheet\..*|formulas\.json|notes\.json|comments\.json|structure\.json|backup-info\.json|ai-export-manifest\.local\.json|modifiche-ai.*\.json|_content-api\.json|_project-metadata\.json|id_rsa.*|id_ed25519.*)$/.test(base);
}
function sourceFiles(directory = root, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['.git', 'node_modules', 'dist', 'release', '.build-cache', 'coverage'].includes(entry.name)) return [];
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Link simbolico non consentito: ${name}`);
    return entry.isDirectory() ? sourceFiles(path.join(directory, entry.name), name) : [name];
  });
}
export function checkRepo() {
  const failures = [];
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  const names = new Set(sourceFiles());
  if (tracked.status === 0) for (const name of tracked.stdout.split('\0').filter(Boolean)) names.add(name);
  for (const name of names) {
    if (forbiddenFile(name)) { failures.push(`${name}: file privato o generato`); continue; }
    const full = path.join(root, name);
    if (!fs.existsSync(full)) { failures.push(`${name}: file tracciato mancante`); continue; }
    const bytes = fs.readFileSync(full);
    if (bytes.includes(0)) { failures.push(`${name}: binario inatteso`); continue; }
    // Lockfile integrity hashes/package author metadata are not user secrets.
    if (name !== 'package-lock.json') failures.push(...inspectText(name, bytes.toString('utf8')));
  }
  if (failures.length) throw new Error(`Controllo repository fallito (valori nascosti):\n${failures.join('\n')}`);
  console.log(`Repository: ${names.size} file controllati, nessun candidato rilevato. La scansione non sostituisce la revisione.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(root, 'scripts/check-repo.mjs')) checkRepo();
