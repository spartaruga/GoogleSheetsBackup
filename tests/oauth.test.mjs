import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { google } from 'googleapis';
import { authenticateDesktop } from '../oauth.mjs';

test('OAuth uses loopback, validates state and PKCE before exchanging code', async t => {
  let authUrl;
  let exchanged = 0;
  const Original = google.auth.OAuth2;
  t.mock.method(Original.prototype, 'getToken', async function(args) {
    exchanged++;
    assert.equal(crypto.createHash('sha256').update(args.codeVerifier).digest('base64url'), authUrl.searchParams.get('code_challenge'));
    assert.equal(args.redirect_uri, authUrl.searchParams.get('redirect_uri'));
    return { tokens: { access_token: 'synthetic' } };
  });
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const result = authenticateDesktop({ keys: { client_id: 'demo', client_secret: 'demo' }, scopes: ['demo.readonly'], open(url) { authUrl = new URL(url); started(); }, timeoutMs: 3000 });
  await ready;
  const callback = new URL(authUrl.searchParams.get('redirect_uri'));
  assert.equal(callback.hostname, '127.0.0.1');
  assert.equal(authUrl.searchParams.get('prompt'), 'consent select_account');
  assert.equal(authUrl.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  callback.searchParams.set('code', 'synthetic'); callback.searchParams.set('state', 'wrong');
  assert.equal((await fetch(callback)).status, 400); assert.equal(exchanged, 0);
  callback.searchParams.set('state', authUrl.searchParams.get('state'));
  assert.equal((await fetch(callback)).status, 200);
  assert.equal((await result).credentials.access_token, 'synthetic'); assert.equal(exchanged, 1);
});

test('abandoned OAuth login times out and releases callback port', async () => {
  let callback;
  await assert.rejects(authenticateDesktop({ keys: { client_id: 'demo', client_secret: 'demo' }, scopes: [], open(url) { callback = new URL(url).searchParams.get('redirect_uri'); }, timeoutMs: 40 }), /scaduto/);
  await assert.rejects(fetch(callback));
});


test('OAuth access denial is returned immediately with a useful error', async () => {
  let authUrl;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const result = authenticateDesktop({
    keys: { client_id: 'demo', client_secret: 'demo' },
    scopes: ['demo.readonly'],
    open(url) { authUrl = new URL(url); started(); },
    timeoutMs: 3000,
  });
  await ready;
  const callback = new URL(authUrl.searchParams.get('redirect_uri'));
  callback.searchParams.set('error', 'access_denied');
  callback.searchParams.set('state', authUrl.searchParams.get('state'));
  assert.equal((await fetch(callback)).status, 400);
  await assert.rejects(result, /annullato o negato/);
});
