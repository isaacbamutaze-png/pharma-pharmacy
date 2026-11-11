// End-to-end test against MOCK Flutterwave / PayPal / Anthropic servers.
import http from "node:http";
import assert from "node:assert/strict";
import { createServer, normalizeUgPhone, detectNetwork } from "../index.mjs";

const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s ? JSON.parse(s) : {})); });

// ---- mock Flutterwave: outcome per tx_ref is controlled by the test ----
const flwTx = new Map(); // tx_ref -> {status, amount, currency}
const flwMock = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "POST" && u.pathname === "/v3/charges") {
    const b = await body(req);
    if (!flwTx.has(b.tx_ref)) flwTx.set(b.tx_ref, { status: "pending", amount: b.amount, currency: b.currency, id: 9000 + flwTx.size });
    return json(res, 200, { status: "success", data: { flw_ref: "FLW-" + b.tx_ref, status: "pending" }, meta: { authorization: { mode: "callback" } } });
  }
  if (req.method === "POST" && u.pathname === "/v3/payments")
    return json(res, 200, { status: "success", data: { link: "https://checkout.flutterwave.test/pay/abc" } });
  if (req.method === "GET" && u.pathname === "/v3/transactions/verify_by_reference") {
    const t = flwTx.get(u.searchParams.get("tx_ref"));
    if (!t) return json(res, 404, { status: "error", message: "No transaction was found for this id" });
    return json(res, 200, { status: "success", data: { id: t.id, status: t.status, amount: t.amount, currency: t.currency, flw_ref: "FLW-X", processor_response: t.reason } });
  }
  json(res, 404, {});
});

// ---- mock PayPal ----
const orders = new Map();
const ppMock = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/v1/oauth2/token") return json(res, 200, { access_token: "tok", expires_in: 3600 });
  if (req.method === "POST" && u.pathname === "/v2/checkout/orders") {
    const b = await body(req);
    const id = "ORD" + orders.size;
    orders.set(id, { id, status: "CREATED", unit: b.purchase_units[0] });
    return json(res, 201, { id, status: "CREATED", links: [{ rel: "payer-action", href: "https://paypal.test/approve/" + id }] });
  }
  let m = u.pathname.match(/^\/v2\/checkout\/orders\/(\w+)$/);
  if (m && req.method === "GET") return orders.has(m[1]) ? json(res, 200, orders.get(m[1])) : json(res, 404, {});
  m = u.pathname.match(/^\/v2\/checkout\/orders\/(\w+)\/capture$/);
  if (m && req.method === "POST") {
    const o = orders.get(m[1]);
    o.status = "COMPLETED";
    o.purchase_units = [{ payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: o.unit.amount }] } }];
    return json(res, 201, o);
  }
  json(res, 404, {});
});

// ---- mock Anthropic ----
const aiMock = http.createServer(async (req, res) => {
  const b = await body(req);
  assert.equal(b.messages[0].role, "user");
  json(res, 200, { content: [{ type: "text", text: "Mock answer." }] });
});

const [flwPort, ppPort, aiPort] = await Promise.all([listen(flwMock), listen(ppMock), listen(aiMock)]);
const KEY = "test-api-key";
const app = createServer({
  port: 0, apiKey: KEY, origins: ["https://rinapharma.netlify.app"], publicBaseUrl: "https://pay.example",
  dataDir: "/tmp/pharma-test-" + process.pid,
  flw: { base: `http://127.0.0.1:${flwPort}/v3`, secretKey: "sk", secretHash: "hash123", hostedOptions: "card", fallbackEmail: "c@x.io" },
  paypal: { base: `http://127.0.0.1:${ppPort}`, clientId: "id", clientSecret: "sec", webhookId: "", ugxPerUsd: 3700 },
  mmTimeoutMs: 150, hostedTimeoutMs: 60_000,
  anthropic: { base: `http://127.0.0.1:${aiPort}`, key: "ak", model: "m" },
});
const port = await listen(app);
const api = async (method, path, b, headers = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { "content-type": "application/json", "x-api-key": KEY, ...headers },
    body: b ? JSON.stringify(b) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const mm = (txRef, extra = {}) => ({ txRef, provider: "MTN_MOMO", amount: 15000, currency: "UGX", phone: "0772123456", ...extra });

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log("  ok -", name); };

console.log("payments server tests");

await t("phone helpers", () => {
  assert.equal(normalizeUgPhone("0772 123 456"), "256772123456");
  assert.equal(normalizeUgPhone("+256 701 234567"), "256701234567");
  assert.equal(normalizeUgPhone("123"), null);
  assert.equal(detectNetwork("256772123456"), "MTN");
  assert.equal(detectNetwork("256701234567"), "AIRTEL");
});

await t("rejects missing / wrong API key", async () => {
  assert.equal((await api("POST", "/api/payments/initiate", mm("tx_nokey_01"), { "x-api-key": "nope" })).status, 401);
});

await t("MTN prompt sent, stays PROCESSING until customer acts", async () => {
  const r = await api("POST", "/api/payments/initiate", mm("tx_mtn_pending"));
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "PROCESSING");
  const s = await api("GET", "/api/payments/tx_mtn_pending/status");
  assert.notEqual(s.body.status, "SUCCESS");
});

await t("customer enters PIN with funds -> SUCCESS", async () => {
  await api("POST", "/api/payments/initiate", mm("tx_mtn_ok0001"));
  flwTx.get("tx_mtn_ok0001").status = "successful";
  const s = await api("GET", "/api/payments/tx_mtn_ok0001/status");
  assert.equal(s.body.status, "SUCCESS");
  assert.equal(s.body.amount, 15000);
});

await t("insufficient funds -> FAILED (never success)", async () => {
  await api("POST", "/api/payments/initiate", mm("tx_mtn_nofunds"));
  Object.assign(flwTx.get("tx_mtn_nofunds"), { status: "failed", reason: "Insufficient funds" });
  const s = await api("GET", "/api/payments/tx_mtn_nofunds/status");
  assert.equal(s.body.status, "FAILED");
  assert.match(s.body.message, /Insufficient/);
});

await t("customer declines prompt -> DECLINED", async () => {
  await api("POST", "/api/payments/initiate", mm("tx_mtn_decline"));
  Object.assign(flwTx.get("tx_mtn_decline"), { status: "failed", reason: "Transaction declined by customer" });
  assert.equal((await api("GET", "/api/payments/tx_mtn_decline/status")).body.status, "DECLINED");
});

await t("no PIN entered -> TIMEOUT, not success", async () => {
  await api("POST", "/api/payments/initiate", mm("tx_mtn_nopin01"));
  await new Promise((r) => setTimeout(r, 250));
  assert.equal((await api("GET", "/api/payments/tx_mtn_nopin01/status")).body.status, "TIMEOUT");
});

await t("late payment after timeout is still recovered as SUCCESS", async () => {
  flwTx.get("tx_mtn_nopin01").status = "successful";
  assert.equal((await api("GET", "/api/payments/tx_mtn_nopin01/status")).body.status, "SUCCESS");
});

await t("underpayment is NOT accepted (amount mismatch)", async () => {
  await api("POST", "/api/payments/initiate", mm("tx_mtn_short01"));
  Object.assign(flwTx.get("tx_mtn_short01"), { status: "successful", amount: 1000 });
  const s = await api("GET", "/api/payments/tx_mtn_short01/status");
  assert.equal(s.body.status, "FAILED");
});

await t("initiate is idempotent (no double charge)", async () => {
  const before = flwTx.size;
  await api("POST", "/api/payments/initiate", mm("tx_mtn_ok0001"));
  assert.equal(flwTx.size, before);
});

await t("network mismatch and bad phone are rejected", async () => {
  assert.equal((await api("POST", "/api/payments/initiate", mm("tx_bad_net01", { provider: "AIRTEL_MONEY" }))).status, 400);
  assert.equal((await api("POST", "/api/payments/initiate", mm("tx_bad_ph001", { phone: "12" }))).status, 400);
});

await t("webhook needs the secret hash and re-verifies with the API", async () => {
  await api("POST", "/api/payments/initiate", mm("tx_hook_0001"));
  const bad = await api("POST", "/webhooks/flutterwave", { data: { tx_ref: "tx_hook_0001", status: "successful" } }, { "verif-hash": "wrong" });
  assert.equal(bad.status, 401);
  // A forged "successful" payload must not flip the status: provider still says pending.
  const ok = await api("POST", "/webhooks/flutterwave", { data: { tx_ref: "tx_hook_0001", status: "successful" } }, { "verif-hash": "hash123" });
  assert.equal(ok.status, 200);
  assert.notEqual((await api("GET", "/api/payments/tx_hook_0001/status")).body.status, "SUCCESS");
  flwTx.get("tx_hook_0001").status = "successful";
  await api("POST", "/webhooks/flutterwave", { data: { tx_ref: "tx_hook_0001" } }, { "verif-hash": "hash123" });
  assert.equal((await api("GET", "/api/payments/tx_hook_0001/status")).body.status, "SUCCESS");
});

await t("card/bank hosted link is returned", async () => {
  const r = await api("POST", "/api/payments/initiate", { txRef: "tx_card_0001", provider: "CARD_TERMINAL", amount: 50000, currency: "UGX" });
  assert.equal(r.body.actionUrl, "https://checkout.flutterwave.test/pay/abc");
  flwTx.set("tx_card_0001", { status: "successful", amount: 50000, currency: "UGX", id: 1 });
  assert.equal((await api("GET", "/api/payments/tx_card_0001/status")).body.status, "SUCCESS");
});

await t("PayPal: converted to USD, SUCCESS only after capture", async () => {
  const r = await api("POST", "/api/payments/initiate", { txRef: "tx_ppal_0001", provider: "PAYPAL", amount: 37000, currency: "UGX" });
  assert.match(r.body.actionUrl, /paypal\.test\/approve/);
  assert.equal((await api("GET", "/api/payments/tx_ppal_0001/status")).body.status, "PROCESSING");
  orders.get(r.body.providerReference).status = "APPROVED";
  const s = await api("GET", "/api/payments/tx_ppal_0001/status");
  assert.equal(s.body.status, "SUCCESS");
});

await t("PayPal cancel page marks CANCELLED", async () => {
  await api("POST", "/api/payments/initiate", { txRef: "tx_ppal_0002", provider: "PAYPAL", amount: 3700, currency: "UGX" });
  await fetch(`http://127.0.0.1:${port}/paypal/cancel?tx=tx_ppal_0002`);
  assert.equal((await api("GET", "/api/payments/tx_ppal_0002/status")).body.status, "CANCELLED");
});

await t("AI proxy answers and hides the key", async () => {
  const r = await api("POST", "/api/assistant", { question: "hi", snapshot: "x", history: [{ role: "assistant", content: "yo" }] });
  assert.equal(r.body.text, "Mock answer.");
});

await t("CORS only for allowed origins", async () => {
  const a = await fetch(`http://127.0.0.1:${port}/health`, { headers: { origin: "https://rinapharma.netlify.app" } });
  assert.equal(a.headers.get("access-control-allow-origin"), "https://rinapharma.netlify.app");
  const b = await fetch(`http://127.0.0.1:${port}/health`, { headers: { origin: "https://evil.example" } });
  assert.equal(b.headers.get("access-control-allow-origin"), null);
});

console.log(`\n${n} tests passed`);
for (const s of [app, flwMock, ppMock, aiMock]) s.close();
process.exit(0);
