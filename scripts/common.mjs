import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
export const runtime = JSON.parse(fs.readFileSync(path.join(root, 'scripts/runtime.json'), 'utf8'));
export const sourceRoots = ['.gitignore', '.github', 'package.json', 'package-lock.json', 'server.mjs', 'engine.mjs', 'oauth.mjs', 'browser.mjs', 'instance.mjs', 'public', 'launcher.ps1', 'Avvia.vbs', 'Avvia_visibile.bat', 'Diagnostica.bat', 'installer', 'scripts', 'tests', 'README.md', 'SECURITY.md', 'CHANGELOG.md', ...(fs.existsSync(path.join(root, 'LICENSE')) ? ['LICENSE'] : ['LICENSE-TODO.md']), 'LEGGIMI.txt', 'NOTE_VERSIONE.txt', 'docs'];
export function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)}: uscita ${result.status}`);
}
export function npmCi(directory) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !fs.existsSync(npmCli)) throw new Error('Avvia con npm run build.');
  run(process.execPath, [npmCli, 'ci', '--prefix', directory, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
}
export function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
export function writeChecksum(file) {
  fs.writeFileSync(`${file}.sha256`, `${checksum(file)}  ${path.basename(file)}\n`);
}
export function walk(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Link simbolico non consentito: ${relative}`);
    return entry.isDirectory() ? walk(path.join(directory, entry.name), relative) : [relative];
  });
}
