import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "admin-night-shift/index.html"), "utf8");

function between(first, next) {
  const start = html.indexOf(first);
  const stop = html.indexOf(next, start + first.length);
  assert.ok(start >= 0 && stop > start, `Missing section: ${first}`);
  return html.slice(start, stop);
}

const formatSource = between(
  "  function formatSecurityAlert(alerts) {",
  "\n  function displaySecurityAlert(alerts) {"
);
const displaySource = between(
  "  function displaySecurityAlert(alerts) {",
  "\n  function clearSecurityAlert() {"
);
const clearSource = between(
  "  function clearSecurityAlert() {",
  "\n  async function enterAppInternal() {"
);
const entrySource = between(
  "  function enterApp() {",
  "\n  // Construct user-facing text"
);

function alertHarness() {
  const elements = {
    securityAlert: {
      hidden: true,
      classList: {
        toggle(name, enabled) {
          assert.equal(name, "hidden");
          elements.securityAlert.hidden = enabled;
        }
      }
    },
    securityAlertText: { textContent: "" }
  };
  const context = { $: id => elements[id] };
  runInNewContext(
    "let securityAlertVersion = 0;\n" +
    formatSource + displaySource + clearSource,
    context
  );
  return { context, elements };
}

test("duplicate security events produce one fixed message", () => {
  const { context, elements } = alertHarness();
  const duplicated = [
    { type: "NEW_NETWORK" }, { type: "NEW_NETWORK" },
    { type: "NEW_BROWSER" }, { type: "NEW_BROWSER" }
  ];
  context.displaySecurityAlert(duplicated);
  const message = elements.securityAlertText.textContent;
  assert.equal((message.match(/安全提醒/g) || []).length, 1);
  assert.equal((message.match(/新的网络环境/g) || []).length, 1);
  assert.equal((message.match(/新的浏览器环境/g) || []).length, 1);
  assert.equal(elements.securityAlert.hidden, false);

  context.displaySecurityAlert(duplicated);
  assert.equal(elements.securityAlertText.textContent, message);
  assert.equal((elements.securityAlertText.textContent.match(/安全提醒/g) || []).length, 1);
});

test("unknown event types and empty responses do not show misleading warnings", () => {
  const { context, elements } = alertHarness();
  context.displaySecurityAlert([{ type: "UNKNOWN" }]);
  assert.equal(elements.securityAlertText.textContent, "");
  assert.equal(elements.securityAlert.hidden, true);
  context.displaySecurityAlert([{ type: "NEW_NETWORK" }]);
  assert.equal(elements.securityAlert.hidden, false);
  context.displaySecurityAlert([]);
  assert.equal(elements.securityAlert.hidden, true);
  context.displaySecurityAlert(null);
  assert.equal(elements.securityAlert.hidden, true);
});

test("provider-supplied text is never echoed into security notice", () => {
  const { context, elements } = alertHarness();
  context.displaySecurityAlert([{
    type: "NEW_NETWORK",
    malicious: "<script>alert(1)</script>",
    label: "<img src=x onerror=alert(1)>"
  }]);
  assert.equal(elements.securityAlertText.textContent.includes("<"), false);
  assert.ok(elements.securityAlertText.textContent.includes("新的网络环境"));
});

test("clearing an alert invalidates previous callbacks and hides its text", () => {
  const { context, elements } = alertHarness();
  context.displaySecurityAlert([{ type: "NEW_NETWORK" }]);
  context.clearSecurityAlert();
  assert.equal(elements.securityAlert.hidden, true);
  assert.equal(elements.securityAlertText.textContent, "");
  assert.equal(context.formatSecurityAlert([{ type: "NEW_NETWORK" }]).includes("安全提醒"), true);
  assert.match(html, /alertVersion !== securityAlertVersion/);
});

test("simultaneous enterApp calls share a single in-flight initialization", async () => {
  let calls = 0;
  let resolveFirst;
  const context = {
    enterAppInternal: () => {
      calls += 1;
      return new Promise(resolve => { resolveFirst = resolve; });
    }
  };
  runInNewContext("let enterAppPromise = null;\n" + entrySource, context);
  const a = context.enterApp();
  const b = context.enterApp();
  assert.equal(a, b);
  assert.equal(calls, 1);
  resolveFirst();
  await a;
  const c = context.enterApp();
  assert.equal(calls, 2);
  resolveFirst();
  await c;
});

test("warning lives outside the administrator mode description", () => {
  assert.match(html, /id="securityAlert" class="security-alert hidden"/);
  assert.match(html, /id="securityAlertText"/);
  assert.equal(html.includes("modeText').textContent+="), false);
  assert.equal(html.includes('modeText").textContent+='), false);
});
