import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, pkg, checksum } from './common.mjs';

const repository = process.env.GH_REPO;
const commit = process.env.GITHUB_SHA;
if (repository !== 'spartaruga/GoogleSheetsBackup' || !/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Release consentita solo dal workflow del repository ufficiale.');
const tag = `v${pkg.version}`;
const directory = path.join(root, 'release');
const files = [`GoogleWorkspaceBackup-Setup-${pkg.version}.exe`, `GoogleWorkspaceBackup_v${pkg.version}_source.zip`];
for (const name of files) {
  const file = path.join(directory, name);
  const declared = fs.readFileSync(file + '.sha256', 'utf8').trim();
  if (declared !== `${checksum(file)}  ${name}`) throw new Error('Checksum non valido: ' + name);
}
const assets = files.flatMap(name => [name, name + '.sha256']);
function gh(args, allowNotFound = false) {
  const result = spawnSync('gh', args, { cwd: root, encoding: 'utf8', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allowNotFound && /HTTP 404|Not Found \(404\)/i.test(result.stderr)) return null;
    throw new Error(result.stderr.trim() || 'Comando GitHub fallito.');
  }
  return result.stdout;
}
const endpoint = `repos/${repository}/releases/tags/${tag}`;
let existing = gh(['api', endpoint], true);
if (existing) {
  const sha = gh(['api', `repos/${repository}/commits/${tag}`, '--jq', '.sha']).trim();
  if (sha !== commit) throw new Error('Questa versione appartiene a un altro commit. Incrementa package.json prima di pubblicare.');
} else {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const section = changelog.split(`## ${pkg.version} —`)[1];
  if (!section) throw new Error('Note della versione mancanti nel changelog.');
  const notes = section.split('\n').slice(1).join('\n').split('\n## ')[0].trim();
  const notesPath = path.join(directory, 'release-notes.md');
  fs.writeFileSync(notesPath, notes + '\n');
  gh(['release', 'create', tag, '--repo', repository, '--target', commit, '--draft', '--title', `Google Workspace Backup ${pkg.version}`, '--notes-file', notesPath]);
  existing = gh(['api', endpoint]);
}
let release = JSON.parse(existing);
if (release.draft) {
  gh(['release', 'upload', tag, '--repo', repository, '--clobber', ...assets.map(name => path.join(directory, name))]);
  release = JSON.parse(gh(['api', endpoint]));
}
for (const name of assets) {
  const asset = release.assets.find(a => a.name === name);
  const file = path.join(directory, name);
  if (!asset || asset.state !== 'uploaded' || asset.size !== fs.statSync(file).size || (asset.digest && asset.digest !== 'sha256:' + checksum(file))) throw new Error('Asset incompleto o diverso: ' + name);
}
if (release.draft) gh(['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest']);
console.log(`Release completa: https://github.com/${repository}/releases/tag/${tag}`);
