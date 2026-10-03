import crypto from 'node:crypto';
import {MAX_UPDATE_BYTES,sha256,validateUpdate} from './app-updates.mjs';
export const REPOSITORY = 'spartaruga/GoogleSheetsBackup';
const api = `https://api.github.com/repos/${REPOSITORY}`;
const options = () => ({headers:{Accept:'application/vnd.github+json','User-Agent':'GoogleWorkspaceBackup'},signal:AbortSignal.timeout(20000)});
export function compareVersions(a, b) {
  if (![a, b].every(v => /^\d+\.\d+\.\d+$/.test(v))) throw new Error('Versione non valida.');
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
  return 0;
}
export function validateChannel(channel) {
  if(channel.format!=='gwb-update-channel-v1' || !/^[a-f0-9]{40}$/.test(channel.packageBlob||'') || !/^[a-f0-9]{64}$/.test(channel.sha256||'') || !Number.isInteger(channel.size) || channel.size<22 || channel.size>MAX_UPDATE_BYTES) throw new Error('Canale aggiornamenti non valido.');
  compareVersions(channel.version,'0.0.0');return channel;
}
export async function checkUpdates(currentVersion, fetcher = fetch) {
  compareVersions(currentVersion,'0.0.0');
  const channelResponse=await fetcher(`https://raw.githubusercontent.com/${REPOSITORY}/main/packages/stable.json`,options());
  if(channelResponse.ok) {
    const channel=validateChannel(await channelResponse.json());
    return {currentVersion,latestVersion:channel.version,available:compareVersions(channel.version,currentVersion)>0,kind:'zip',channel,notes:String(channel.notes||'').slice(0,15000)};
  }
  if(channelResponse.status!==404)throw new Error('Controllo aggiornamenti non riuscito: GitHub HTTP '+channelResponse.status);
  const response = await fetcher(`${api}/releases/latest`, options());
  if (response.status === 404) return { currentVersion, available: false, message: 'Nessuna versione pubblicata.' };
  if (!response.ok) throw new Error('Controllo aggiornamenti non riuscito: GitHub HTTP ' + response.status);
  const release = await response.json(), version = String(release.tag_name || '').replace(/^v/, '');
  compareVersions(version, currentVersion);
  if (release.draft || release.prerelease) throw new Error('Release non stabile.');
  const name = `GoogleWorkspaceBackup-Setup-${version}.exe`;
  const asset = release.assets?.find(a => a.name === name);
  const expected = `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`;
  if (!asset || asset.browser_download_url !== expected) throw new Error('Installer ufficiale mancante nella Release.');
  return { currentVersion, latestVersion: version, available: compareVersions(version, currentVersion) > 0,
    kind:'installer',installerUrl: expected, releaseUrl: `https://github.com/${REPOSITORY}/releases/tag/v${version}`, notes: String(release.body || '').slice(0, 15000) };
}
export function decodePackage(blob,channel) {
  validateChannel(channel);
  if(blob.encoding!=='base64' || typeof blob.content!=='string' || blob.content.length>MAX_UPDATE_BYTES*2)throw new Error('Pacchetto GitHub non valido.');
  const text=Buffer.from(blob.content.replace(/\s/g,''),'base64');
  const gitHash=crypto.createHash('sha1').update(Buffer.from(`blob ${text.length}\0`)).update(text).digest('hex');
  if(gitHash!==channel.packageBlob)throw new Error('Identità pacchetto GitHub non valida.');
  const envelope=JSON.parse(text);
  if(envelope.format!=='gwb-update-envelope-v1' || envelope.version!==channel.version || envelope.sha256!==channel.sha256 || envelope.size!==channel.size || typeof envelope.payload!=='string')throw new Error('Pacchetto e canale non coerenti.');
  const bytes=Buffer.from(envelope.payload,'base64');
  if(bytes.length!==channel.size || sha256(bytes)!==channel.sha256)throw new Error('Checksum aggiornamento non valido.');
  const {manifest}=validateUpdate(bytes,channel.sha256);
  if(manifest.version!==channel.version)throw new Error('Versione pacchetto non coerente.');return bytes;
}
export async function downloadUpdate(channel,fetcher=fetch) {
  validateChannel(channel);
  const response=await fetcher(`${api}/git/blobs/${channel.packageBlob}`,options());
  if(!response.ok)throw new Error('Download aggiornamento fallito: GitHub HTTP '+response.status);
  if(Number(response.headers?.get('content-length'))>MAX_UPDATE_BYTES*2)throw new Error('Pacchetto troppo grande.');
  return decodePackage(await response.json(),channel);
}
