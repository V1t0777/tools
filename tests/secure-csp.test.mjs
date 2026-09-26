import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inlineHashes, scriptHash, renderHeaders, generateCsp} from '../scripts/secure-csp.mjs';

const template = readFileSync(new URL('../cloudflare-secure/_headers', import.meta.url), 'utf8');
const published = ['cloudflare-secure', 'dinner', 'night-shift', 'admin-night-shift', 'beads', 'flappy', 'games', 'stack', 'pictionary'];

test('hashes preserve whitespace and match browser HTML newline normalization', () => {
  const expected = "'sha256-" + createHash('sha256').update('\nhello\n').digest('base64') + "'";
  assert.equal(scriptHash('\r\nhello\r'), expected);
  assert.notEqual(scriptHash('hello'), expected);
  assert.deepEqual(inlineHashes('<script>\r\nhello\r</script>'), [expected]);
});

test('external script tags are unchanged and are not hashed', () => {
  assert.deepEqual(inlineHashes('<script src="./app.js?v=1" defer></script>'), []);
  assert.throws(() => inlineHashes('<script src="x.js">ignored()</script>'), /inline content/);
});

test('unsupported or malformed script markup fails closed', () => {
  assert.throws(() => inlineHashes('<script type="module">hello()</script>'), /attributes/);
  assert.throws(() => inlineHashes('<script>unfinished'), /unsupported/);
});

test('policy is deterministic, deduplicated and retains other security directives', () => {
  const a = scriptHash('a'), b = scriptHash('b');
  const policy = renderHeaders(template, [b, a, a]);
  assert.equal(policy, renderHeaders(template, [a, b]));
  assert.equal(policy.split(a).length, 2);
  assert.match(policy, /script-src-attr 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /style-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-/);
});

test('invalid templates, hash injection and oversized headers fail the build', () => {
  assert.throws(() => renderHeaders(template.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"), []));
  assert.throws(() => renderHeaders(template, ["'unsafe-inline'"]));
  assert.throws(() => renderHeaders(template, Array.from({length: 40}, (_, i) => scriptHash(String(i)))), /2000/);
});

test('all nine current secure HTML pages fit one policy with four inline hashes', () => {
  const hashes = published.flatMap(path => inlineHashes(readFileSync(new URL(`../${path}/index.html`, import.meta.url), 'utf8'), path));
  assert.equal(hashes.length, 4);
  const policy = renderHeaders(template, hashes);
  for (const hash of hashes) assert.ok(policy.includes(hash));
  assert.ok(policy.split(/\r?\n/).every(line => line.length <= 2000));
});

test('generator hashes nested published artifacts and does not rewrite HTML', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toolbox-csp-'));
  try {
    mkdirSync(join(dir, 'nested'));
    const html = '<script>\r\nwindow.fixture = true;\r\n</script>';
    writeFileSync(join(dir, 'nested', 'index.html'), html);
    writeFileSync(join(dir, '_headers'), template);
    assert.deepEqual(generateCsp(dir), {pages: 1, inlineScripts: 1, uniqueHashes: 1});
    assert.ok(readFileSync(join(dir, '_headers'), 'utf8').includes(scriptHash('\nwindow.fixture = true;\n')));
    assert.equal(readFileSync(join(dir, 'nested', 'index.html'), 'utf8'), html);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
