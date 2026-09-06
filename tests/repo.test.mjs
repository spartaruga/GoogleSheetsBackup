import test from 'node:test';
import assert from 'node:assert/strict';
import { forbiddenFile, inspectText } from '../scripts/check-repo.mjs';
test('source gate detects private files and constructed secrets without printing values', () => {
  for (const name of ['nested/credentials.json', '.env.production', 'nested/client_secret_demo.json', 'backup/demo.gs', 'state.json', 'demo.pfx', 'token.json']) assert(forbiddenFile(name), name);
  const key = ['AI', 'za', '1234567890'.repeat(3), '12345'].join('');
  const issues = inspectText('demo.mjs', `const k = '${key}';`);
  assert.equal(issues.length, 1); assert(!issues.join('').includes(key));
  assert.deepEqual(inspectText('demo.mjs', 'const count = 3;'), []);
});
