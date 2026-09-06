import fs from 'node:fs';
import path from 'node:path';
import { root, pkg, runtime, run, npmCi, checksum, walk } from './common.mjs';
import { checkRepo } from './check-repo.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('La build richiede Windows x64. Usa il workflow Windows build su GitHub oppure un PC Windows.');
checkRepo();
const dist = path.join(root, 'dist');
const app = path.join(dist, 'app');
const cache = path.join(root, '.build-cache');
fs.mkdirSync(cache, { recursive: true });
const archive = path.join(cache, runtime.archive);
const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const psQuote = value => `'${value.replace(/'/g, "''")}'`;
function powershell(script) { run(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]); }
if (!fs.existsSync(archive)) {
  const url = `https://nodejs.org/dist/v${runtime.version}/${runtime.archive}`;
  powershell(`$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 -Uri ${psQuote(url)} -OutFile ${psQuote(archive + '.tmp')}`);
  fs.renameSync(archive + '.tmp', archive);
}
if (checksum(archive) !== runtime.sha256) throw new Error('Checksum runtime errato. Rimuovi il solo archivio in .build-cache e riprova.');
const extracted = path.join(cache, 'node');
fs.rmSync(extracted, { recursive: true, force: true });
powershell(`$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(extracted)}`);
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });
for (const name of ['package.json', 'package-lock.json', 'engine.mjs', 'server.mjs', 'oauth.mjs', 'browser.mjs', 'instance.mjs', 'public']) {
  fs.cpSync(path.join(root, name), path.join(app, name), { recursive: true });
}
// Install from the lock in an empty app directory, never copy the developer profile.
npmCi(app);
fs.mkdirSync(path.join(dist, 'runtime'));
const nodeRoot = path.join(extracted, `node-v${runtime.version}-win-x64`);
fs.copyFileSync(path.join(nodeRoot, 'node.exe'), path.join(dist, 'runtime/node.exe'));
fs.copyFileSync(path.join(nodeRoot, 'LICENSE'), path.join(dist, 'runtime/LICENSE'));
for (const name of ['launcher.ps1', 'Avvia_visibile.bat', 'Diagnostica.bat', 'README.md', 'SECURITY.md', 'CHANGELOG.md', ...(fs.existsSync(path.join(root, 'LICENSE')) ? ['LICENSE'] : ['LICENSE-TODO.md'])]) fs.copyFileSync(path.join(root, name), path.join(dist, name));
fs.cpSync(path.join(root, 'docs'), path.join(dist, 'docs'), { recursive: true });
const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
run(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/reference:System.Windows.Forms.dll', `/out:${path.join(dist, 'GoogleWorkspaceBackup.exe')}`, path.join(root, 'installer/Launcher.cs')]);
run(path.join(dist, 'runtime/node.exe'), [path.join(app, 'engine.mjs'), 'self-test']);
const licenses = walk(path.join(app, 'node_modules')).filter(name => /(?:^|\/)(?:licen[cs]e|copying|notice)(?:\..*)?$/i.test(name));
fs.writeFileSync(path.join(dist, 'THIRD-PARTY-NOTICES.txt'), 'Node.js: runtime/LICENSE\nDipendenze: licenze originali incluse senza modifiche.\n' + licenses.map(name => `app/node_modules/${name}`).join('\n') + '\n');
const files = walk(dist).map(name => ({ path: name, sha256: checksum(path.join(dist, name)) }));
fs.writeFileSync(path.join(dist, 'build-manifest.json'), JSON.stringify({ version: pkg.version, node: runtime.version, nodeArchiveSha256: runtime.sha256, files }, null, 2) + '\n');
console.log(`Build ${pkg.version} pronta in dist. Nessuna configurazione utente inclusa.`);
