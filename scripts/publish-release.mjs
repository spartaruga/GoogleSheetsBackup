import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, pkg, checksum } from './common.mjs';

export function publishRelease({repository=process.env.GH_REPO, commit=process.env.GITHUB_SHA, directory=path.join(root,'release'), gh=runGh}={}) {
if (repository !== 'spartaruga/GoogleSheetsBackup' || !/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Release consentita solo dal workflow del repository ufficiale.');
const tag = `v${pkg.version}`;
const files = [`GoogleWorkspaceBackup-Setup-${pkg.version}.exe`, `GoogleWorkspaceBackup_v${pkg.version}_source.zip`];
for (const name of files) {
  const file = path.join(directory, name);
  const declared = fs.readFileSync(file + '.sha256', 'utf8').trim();
  if (declared !== `${checksum(file)}  ${name}`) throw new Error('Checksum non valido: ' + name);
}
const assets = files.flatMap(name => [name, name + '.sha256']);
const endpoint = `repos/${repository}/releases`;
// The by-tag REST endpoint can return 404 for a draft. Locate drafts in the
// authenticated list, then use their numeric ID throughout asset verification.
const findRelease = () => JSON.parse(gh(['api', endpoint+'?per_page=100', '--paginate', '--slurp'])).flat().find(r=>r.tag_name===tag);
const tagCommit = gh(['api', `repos/${repository}/commits/${tag}`, '--jq', '.sha'], true)?.trim();
if(tagCommit && tagCommit!==commit) throw new Error('Questa versione appartiene a un altro commit. Incrementa package.json prima di pubblicare.');
let release = findRelease();
if(release && !release.draft && !tagCommit) throw new Error('Release pubblicata senza tag verificabile.');
if (!release) {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const section = changelog.split(`## ${pkg.version} —`)[1];
  if (!section) throw new Error('Note della versione mancanti nel changelog.');
  const notes = section.split('\n').slice(1).join('\n').split('\n## ')[0].trim();
  const notesPath = path.join(directory, 'release-notes.md');
  fs.writeFileSync(notesPath, notes + '\n');
  gh(['release', 'create', tag, '--repo', repository, '--target', commit, '--draft', '--title', `Google Workspace Backup ${pkg.version}`, '--notes-file', notesPath]);
  release = findRelease();
  if(!release) throw new Error('Bozza appena creata non disponibile. Rilancia il workflow.');
}
if (release.draft) {
  // Only an unpublished draft without a conflicting tag may change its target.
  // Published Releases and existing tags are never retargeted or overwritten.
  if(release.target_commitish!==commit) gh(['release','edit',tag,'--repo',repository,'--target',commit]);
  gh(['release', 'upload', tag, '--repo', repository, '--clobber', ...assets.map(name => path.join(directory, name))]);
  release = JSON.parse(gh(['api', endpoint+'/'+release.id]));
}
for (const name of assets) {
  const asset = release.assets.find(a => a.name === name);
  const file = path.join(directory, name);
  if (!asset || asset.state !== 'uploaded' || asset.size !== fs.statSync(file).size || (asset.digest && asset.digest !== 'sha256:' + checksum(file))) throw new Error('Asset incompleto o diverso: ' + name);
}
if (release.draft) gh(['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest']);
return `https://github.com/${repository}/releases/tag/${tag}`;
}

function runGh(args, allowNotFound = false) {
  const result = spawnSync('gh', args, { cwd: root, encoding: 'utf8', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allowNotFound && /HTTP 404|Not Found \(404\)/i.test(result.stderr)) return null;
    throw new Error(result.stderr.trim() || 'Comando GitHub fallito.');
  }
  return result.stdout;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log('Release completa: '+publishRelease());
