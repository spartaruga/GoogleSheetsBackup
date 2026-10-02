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
// An absent Git ref returns 404; commits/<missing-tag> can return 422 instead.
const tagRef = gh(['api', `repos/${repository}/git/ref/tags/${tag}`], true);
const tagCommit = tagRef ? gh(['api', `repos/${repository}/commits/${tag}`, '--jq', '.sha']).trim() : null;
if(tagCommit && tagCommit!==commit) throw new Error('Questa versione appartiene a un altro commit. Incrementa package.json prima di pubblicare.');
let release = findRelease();
if(release && !release.draft && !tagCommit) throw new Error('Release pubblicata senza tag verificabile.');
function writeNotes() {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const section = changelog.split(`## ${pkg.version} —`)[1];
  if (!section) throw new Error('Note della versione mancanti nel changelog.');
  const notes = section.split('\n').slice(1).join('\n').split('\n## ')[0].trim();
  const notesPath = path.join(directory, 'release-notes.md');
  fs.writeFileSync(notesPath, notes + '\n');
  return notesPath;
}
function writeRelease(method, url, body) {
  const requestPath=path.join(directory,'release-request.json');
  fs.writeFileSync(requestPath,JSON.stringify(body));
  return JSON.parse(gh(['api',url,'--method',method,'--header','Content-Type: application/json','--input',requestPath]));
}
const metadata = () => ({target_commitish:commit,name:`Google Workspace Backup ${pkg.version}`,body:fs.readFileSync(writeNotes(),'utf8')});
if (!release) {
  // Use the creation response: a new draft may not appear in the list yet.
  release=writeRelease('POST',endpoint,{tag_name:tag,...metadata(),draft:true});
}
if(!Number.isSafeInteger(release.id) || release.id<=0 || release.tag_name!==tag) throw new Error('Risposta Release non valida.');
const releaseEndpoint=endpoint+'/'+release.id;
if (release.draft) {
  // Only an unpublished draft without a conflicting tag may change its target.
  // Published Releases and existing tags are never retargeted or overwritten.
  release=writeRelease('PATCH',releaseEndpoint,metadata());
  const uploadBase=release.upload_url?.split('{')[0];
  if(uploadBase!==`https://uploads.github.com/repos/${repository}/releases/${release.id}/assets`) throw new Error('URL upload Release non valido.');
  for(const name of assets) {
    const existing=release.assets.find(a=>a.name===name);
    if(existing) gh(['api',endpoint+'/assets/'+existing.id,'--method','DELETE']);
    const upload=uploadBase+'?name='+encodeURIComponent(name);
    const file=path.join(directory,name);
    gh(['api',upload,'--method','POST','--header','Content-Type: application/octet-stream','--header','Content-Length: '+fs.statSync(file).size,'--input',file]);
  }
  release = JSON.parse(gh(['api', releaseEndpoint]));
}
for (const name of assets) {
  const asset = release.assets.find(a => a.name === name);
  const file = path.join(directory, name);
  if (!asset || asset.state !== 'uploaded' || asset.size !== fs.statSync(file).size || (asset.digest && asset.digest !== 'sha256:' + checksum(file))) throw new Error('Asset incompleto o diverso: ' + name);
}
if (release.draft) writeRelease('PATCH',releaseEndpoint,{draft:false,make_latest:'true'});
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
