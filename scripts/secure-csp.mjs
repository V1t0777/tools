import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';

export function scriptHash(text) {
  // HTML parsing normalizes CRLF and bare CR before CSP hashes are checked.
  return "'sha256-" + createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('base64') + "'";
}

export function inlineHashes(html, label = 'HTML') {
  const hashes = [];
  // This is a deliberately restricted build-time extractor for our trusted,
  // static HTML, NOT an HTML sanitizer or a parser for user-controlled input.
  // Only bare inline <script> tags are supported; new script formats fail closed
  // until reviewed. External scripts keep their original markup and order.
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const openings = html.match(/<script\b/gi) || [];
  if (scripts.length !== openings.length) throw new Error(`${label}: unsupported script markup`);
  for (const [, attributes, body] of scripts) {
    if (/^\s+src\s*=\s*(["'])[^"'<>]+\1(?:\s+defer)?\s*$/i.test(attributes)) {
      if (body.trim()) throw new Error(`${label}: external script has inline content`);
      continue;
    }
    if (attributes.trim()) throw new Error(`${label}: review new inline script attributes`);
    hashes.push(scriptHash(body));
  }
  return hashes;
}

export function renderHeaders(template, hashes) {
  const slot = "script-src 'self';";
  if (template.split(slot).length !== 2 || /script-src-elem\s|script-src[^;]*'unsafe-/i.test(template)) {
    throw new Error('Expected one strict script-src template');
  }
  if (!template.includes("script-src-attr 'none'")) throw new Error('Inline event handlers must remain blocked');
  const values = [...new Set(hashes)].sort();
  if (values.some(value => !/^'sha256-[A-Za-z0-9+/]{43}='$/.test(value))) throw new Error('Invalid CSP hash');
  const result = template.replace(slot, `script-src 'self'${values.length ? ' ' + values.join(' ') : ''};`);
  // Cloudflare Pages limits the entire header line to 2,000 characters.
  if (result.split(/\r?\n/).some(line => line.length > 2000)) throw new Error('Cloudflare header line exceeds 2000 characters');
  return result;
}

export function generateCsp(directory) {
  const root = resolve(directory);
  const hashes = [];
  let pages = 0;
  function visit(dir) {
    for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symlinks are not supported in secure output');
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.html')) {
        hashes.push(...inlineHashes(readFileSync(path, 'utf8'), path));
        pages++;
      }
    }
  }
  visit(root);
  if (!pages) throw new Error('No published HTML to protect');
  const path = join(root, '_headers');
  const result = renderHeaders(readFileSync(path, 'utf8'), hashes);
  // Validation completes before touching the generated header file.
  writeFileSync(path, result);
  return {pages, inlineScripts: hashes.length, uniqueHashes: new Set(hashes).size};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/secure-csp.mjs <build-output>');
  console.log('Secure CSP generated:', generateCsp(process.argv[2]));
}
