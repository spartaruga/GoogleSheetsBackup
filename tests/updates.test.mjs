import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, checkUpdates } from '../updates.mjs';
test('version comparison is numeric and excludes unreviewed version formats',()=>{
  assert(compareVersions('3.10.0','3.9.0')>0);assert.equal(compareVersions('3.4.0','3.4.0'),0);assert.throws(()=>compareVersions('evil','3.4.0'));
});
test('update check accepts only the official stable installer URL',async()=>{
  const release={tag_name:'v3.4.0',assets:[{name:'GoogleWorkspaceBackup-Setup-3.4.0.exe',browser_download_url:'https://github.com/spartaruga/GoogleSheetsBackup/releases/download/v3.4.0/GoogleWorkspaceBackup-Setup-3.4.0.exe'}]};
  const fake=async url=>{assert(url.includes('/spartaruga/GoogleSheetsBackup/'));return {ok:true,json:async()=>release};};
  assert((await checkUpdates('3.3.2',fake)).available);release.assets[0].browser_download_url='https://example.invalid/evil.exe';await assert.rejects(checkUpdates('3.3.2',fake),/ufficiale/);
});
test('absence of a Release is reported without an invented download',async()=>{
  const result=await checkUpdates('3.4.0',async()=>({status:404}));assert(!result.available);assert(!result.installerUrl);
});
