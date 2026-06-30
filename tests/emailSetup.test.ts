/**
 * Tests for the Email Setup wizard backing logic (emailCore): provider guides are complete and
 * honest (DAWN implements no OAuth), the error humanizer turns raw IMAP/SMTP failures into
 * actionable plain English without echoing a credential, config validation rejects bad input, and
 * the account public view never exposes a secret. No transport/DB. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import core, { PROVIDER_GUIDES, humanizeEmailError, validateAccountConfig, accountPublicView } from '../electron/services/email/emailCore';

test('provider guides cover the 5 providers, are honest about no-OAuth, and carry setup help', () => {
  const ids = PROVIDER_GUIDES.map((g) => g.id);
  for (const want of ['gmail', 'outlook', 'icloud', 'yahoo', 'custom']) assert.ok(ids.includes(want), `missing guide ${want}`);
  for (const g of PROVIDER_GUIDES) {
    assert.equal(g.oauthSupported, false, `${g.id} must not claim OAuth (DAWN does not implement it)`);
    assert.ok(g.instructions.length > 0 && g.troubleshooting.length > 0, `${g.id} needs instructions + troubleshooting`);
    assert.ok(g.imapSecurity && g.smtpSecurity, `${g.id} needs security info`);
  }
  // the hosted providers require an app password (honest)
  for (const id of ['gmail', 'outlook', 'icloud', 'yahoo']) assert.equal(PROVIDER_GUIDES.find((g) => g.id === id)!.appPasswordRequired, true);
});

test('humanizeEmailError maps common failures to plain English and never echoes a password', () => {
  const auth = humanizeEmailError('AUTHENTICATIONFAILED for user; password "hunter2secret" rejected');
  assert.match(auth, /app password/i, 'auth failure should advise an app password');
  assert.ok(!auth.includes('hunter2secret'), 'must not echo the credential');
  assert.match(humanizeEmailError('getaddrinfo ENOTFOUND imap.bad.host'), /find the mail server|host/i);
  assert.match(humanizeEmailError('connect ETIMEDOUT 1.2.3.4:993'), /timed out/i);
  assert.match(humanizeEmailError('ECONNREFUSED'), /refused/i);
  assert.match(humanizeEmailError('self signed certificate in chain'), /TLS|SSL/i);
  assert.equal(humanizeEmailError(''), 'Unknown error.');
});

test('config validation rejects a bad email + bad ports', () => {
  assert.equal(validateAccountConfig({ emailAddress: 'nope' }).ok, false);
  assert.equal(validateAccountConfig({ emailAddress: 'a@b.com', imapHost: 'imap.b.com', imapPort: 70000 }).ok, false);
  assert.equal(validateAccountConfig({ emailAddress: 'a@b.com', imapHost: 'imap.b.com', imapPort: 993 }).ok, true);
});

test('accountPublicView never exposes a secret or vault item id', () => {
  const view = accountPublicView({ id: '1', email_address: 'a@b.com', credential_vault_item_id: 'vault-xyz', imap_host: 'imap.b.com', imap_port: 993, imap_secure: 1 });
  const json = JSON.stringify(view);
  assert.ok(!json.includes('vault-xyz'), 'must not expose the vault item id');
  assert.equal(view.hasCredential, true, 'should signal a credential exists without revealing it');
  assert.ok(!('secret' in view) && !('password' in view));
});
