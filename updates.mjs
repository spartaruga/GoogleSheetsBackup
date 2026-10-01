const REPOSITORY = 'spartaruga/GoogleSheetsBackup';
export function compareVersions(a, b) {
  if (![a, b].every(v => /^\d+\.\d+\.\d+$/.test(v))) throw new Error('Versione non valida.');
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
  return 0;
}
export async function checkUpdates(currentVersion, fetcher = fetch) {
  const response = await fetcher(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GoogleWorkspaceBackup' }, signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return { currentVersion, available: false, message: 'Nessuna Release pubblicata.' };
  if (!response.ok) throw new Error('Controllo aggiornamenti non riuscito: GitHub HTTP ' + response.status);
  const release = await response.json(), version = String(release.tag_name || '').replace(/^v/, '');
  compareVersions(version, currentVersion);
  if (release.draft || release.prerelease) throw new Error('Release non stabile.');
  const name = `GoogleWorkspaceBackup-Setup-${version}.exe`;
  const asset = release.assets?.find(a => a.name === name);
  const expected = `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`;
  if (!asset || asset.browser_download_url !== expected) throw new Error('Installer ufficiale mancante nella Release.');
  return { currentVersion, latestVersion: version, available: compareVersions(version, currentVersion) > 0,
    installerUrl: expected, releaseUrl: `https://github.com/${REPOSITORY}/releases/tag/v${version}`, notes: String(release.body || '').slice(0, 15000) };
}
