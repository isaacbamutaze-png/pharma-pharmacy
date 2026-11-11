// PHARMA payments + AI gateway.
//
// Why this exists: provider secrets (Flutterwave / PayPal / Anthropic) must never
// ship inside the web app or the APK, and providers confirm payments to a server
// via webhooks. The PHARMA app talks only to this server. A payment is reported
// SUCCESS **only** after this server has asked the provider directly and the
// provider says "successful" for the right amount and currency.
//
// Zero runtime dependencies (Node >= 20: built-in fetch + crypto + http).

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const env = (k, d = "") => (process.env[k] ?? d).trim();

export function loadConfig() {
  const paypalLive = env("PAYPAL_ENV", "sandbox") === "live";
  return {
    port: Number(env("PORT", "8787")),
    apiKey: env("PHARMA_API_KEY"),
    origins: env(
      "ALLOWED_ORIGINS",
      "https://rinapharma.netlify.app,https://localhost,capacitor://localhost,http://localhost:5173",
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    publicBaseUrl: env("PUBLIC_BASE_URL").replace(/\/+$/, ""),
    dataDir: env("DATA_DIR", "./data"),
    flw: {
      base: env("FLW_BASE_URL", "https://api.flutterwave.com/v3"),
      secretKey: env("FLW_SECRET_KEY"),
      secretHash: env("FLW_SECRET_HASH"),
      hostedOptions: env("FLW_HOSTED_OPTIONS", "card,mobilemoneyuganda,banktransfer"),
      fallbackEmail: env("FLW_FALLBACK_EMAIL", "customer@pharma-pos.app"),
    },
    paypal: {
      base: env(
        "PAYPAL_BASE_URL",
        paypalLive ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
      ),
      clientId: env("PAYPAL_CLIENT_ID"),
      clientSecret: env("PAYPAL_CLIENT_SECRET"),
      webhookId: env("PAYPAL_WEBHOOK_ID"),
      ugxPerUsd: Number(env("PAYPAL_UGX_PER_USD", "3700")),
    },
    mmTimeoutMs: Number(env("MM_TIMEOUT_MINUTES", "4")) * 60_000,
    hostedTimeoutMs: Number(env("HOSTED_TIMEOUT_MINUTES", "30")) * 60_000,
    anthropic: {
      base: env("ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
      key: env("ANTHROPIC_API_KEY"),
      model: env("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Normalise a Ugandan number to 2567XXXXXXXX. */
export function normalizeUgPhone(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (/^256\d{9}$/.test(d)) return d;
  if (/^0\d{9}$/.test(d)) return "256" + d.slice(1);
  if (/^[1-9]\d{8}$/.test(d)) return "256" + d;
  return null;
}

export function detectNetwork(phone) {
  const p = phone.slice(3, 5);
  if (["77", "78", "76", "39"].includes(p)) return "MTN";
  if (["70", "75", "74", "20"].includes(p)) return "AIRTEL";
  return null;
}

const FINAL = new Set(["SUCCESS", "FAILED", "DECLINED", "CANCELLED"]);

/* ------------------------------------------------------------------ */
/* Ledger (JSON file; provider is always the source of truth)          */
/* ------------------------------------------------------------------ */

class Ledger {
  constructor(dir) {
    this.file = path.join(dir, "ledger.json");
    this.map = new Map();
    this.timer = null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const rows = JSON.parse(fs.readFileSync(this.file, "utf8"));
      for (const r of rows) this.map.set(r.txRef, r);
    } catch {
      /* first run */
    }
  }
  get(txRef) {
    return this.map.get(txRef);
  }
  put(rec) {
    this.map.set(rec.txRef, rec);
    this.#flushSoon();
  }
  #flushSoon() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        const tmp = this.file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify([...this.map.values()]));
        fs.renameSync(tmp, this.file);
      } catch (e) {
        console.error("ledger write failed", e.message);
      }
    }, 200);
    this.timer.unref?.();
  }
}

/* ------------------------------------------------------------------ */
/* Flutterwave                                                         */
/* ------------------------------------------------------------------ */

function flwClient(cfg) {
  async function call(method, urlPath, body) {
    if (!cfg.flw.secretKey) throw new HttpError(503, "Flutterwave is not configured on the server.");
    const res = await fetch(cfg.flw.base + urlPath, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.flw.secretKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25_000),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }
  return {
    call,
    chargeMobileMoney: (b) => call("POST", "/charges?type=mobile_money_uganda", b),
    createHostedLink: (b) => call("POST", "/payments", b),
    verifyByRef: (txRef) =>
      call("GET", `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`),
    refund: (id, amount) => call("POST", `/transactions/${encodeURIComponent(id)}/refund`, { amount }),
  };
}

/** Map a Flutterwave verify response to our status, checking amount + currency. */
export function interpretFlwVerify(rec, resp) {
  const d = resp.json?.data;
  if (!resp.ok || resp.json?.status !== "success" || !d) {
    // "No transaction was found" is normal while the customer has not acted yet.
    return { status: "PENDING", message: "Waiting for the customer to approve the payment." };
  }
  const st = String(d.status || "").toLowerCase();
  if (st === "successful" || st === "completed") {
    const paid = Number(d.amount);
    if (String(d.currency).toUpperCase() !== rec.currency || !(paid + 0.0001 >= rec.amount)) {
      return {
        status: "FAILED",
        message: `Amount/currency mismatch: expected ${rec.amount} ${rec.currency}, provider reports ${d.amount} ${d.currency}.`,
        flagged: true,
      };
    }
    return {
      status: "SUCCESS",
      message: "Payment confirmed by Flutterwave.",
      providerTransactionId: String(d.id),
      providerReference: d.flw_ref,
      amount: paid,
    };
  }
  if (st === "failed" || st === "cancelled") {
    const why = d.processor_response || d.message || "Payment failed.";
    const declined = /declin|reject|cancel|denied/i.test(why) || st === "cancelled";
    return { status: declined ? "DECLINED" : "FAILED", message: why, providerTransactionId: String(d.id), providerReference: d.flw_ref };
  }
  return { status: "PROCESSING", message: "Waiting for the customer to approve the payment.", providerTransactionId: d.id ? String(d.id) : undefined };
}

/* ------------------------------------------------------------------ */
/* PayPal                                                              */
/* ------------------------------------------------------------------ */

function paypalClient(cfg) {
  let tokenCache = { value: "", exp: 0 };
  async function token() {
    if (!cfg.paypal.clientId || !cfg.paypal.clientSecret)
      throw new HttpError(503, "PayPal is not configured on the server.");
    if (tokenCache.value && Date.now() < tokenCache.exp) return tokenCache.value;
    const res = await fetch(cfg.paypal.base + "/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${cfg.paypal.clientId}:${cfg.paypal.clientSecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(25_000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new HttpError(502, "PayPal authentication failed.");
    tokenCache = { value: j.access_token, exp: Date.now() + (Number(j.expires_in || 300) - 60) * 1000 };
    return tokenCache.value;
  }
  async function call(method, urlPath, body, extraHeaders = {}) {
    const t = await token();
    const res = await fetch(cfg.paypal.base + urlPath, {
      method,
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25_000),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }
  return { call };
}

export function interpretPaypalOrder(rec, order) {
  const st = order?.status;
  if (st === "COMPLETED") {
    const cap = order.purchase_units?.[0]?.payments?.captures?.[0];
    if (!cap || cap.status !== "COMPLETED") {
      return { status: "PROCESSING", message: "PayPal capture is still being processed." };
    }
    const value = Number(cap.amount?.value);
    if (cap.amount?.currency_code !== rec.chargeCurrency || !(value + 0.0001 >= rec.chargeAmount)) {
      return { status: "FAILED", message: "PayPal amount/currency mismatch.", flagged: true };
    }
    return {
      status: "SUCCESS",
      message: "Payment confirmed by PayPal.",
      providerTransactionId: cap.id,
      providerReference: order.id,
      captureId: cap.id,
      amount: rec.amount,
    };
  }
  if (st === "VOIDED") return { status: "CANCELLED", message: "PayPal order was voided." };
  return { status: "PENDING", message: "Waiting for the payer to approve on PayPal." };
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export function createServer(cfg = loadConfig()) {
  const ledger = new Ledger(cfg.dataDir);
  const flw = flwClient(cfg);
  const pp = paypalClient(cfg);
  const hits = new Map(); // ip -> {n, reset}

  const publicUrl = (req) =>
    cfg.publicBaseUrl || `http://${req.headers.host || "localhost:" + cfg.port}`;

  /** Public view of a ledger record. */
  const view = (r) => ({
    txRef: r.txRef,
    provider: r.provider,
    status: r.status,
    amount: r.amount,
    currency: r.currency,
    providerReference: r.providerReference,
    providerTransactionId: r.providerTransactionId,
    message: r.message,
    actionUrl: r.actionUrl,
    expiresAt: r.expiresAt,
    updatedAt: r.updatedAt,
  });

  function applyTimeout(rec) {
    if (!FINAL.has(rec.status) && rec.status !== "TIMEOUT" && Date.now() > rec.expiresAt) {
      rec.status = "TIMEOUT";
      rec.message =
        rec.kind === "FLW_MM"
          ? "The customer did not approve the payment on their phone in time."
          : "The payment page was not completed in time.";
    }
  }

  /** Ask the provider. SUCCESS is terminal; anything else can still be upgraded. */
  async function refresh(rec) {
    if (rec.status === "SUCCESS") return rec;
    let r;
    try {
      if (rec.kind === "PAYPAL") {
        if (!rec.paypalOrderId) return rec;
        let o = await pp.call("GET", `/v2/checkout/orders/${rec.paypalOrderId}`);
        if (o.ok && o.json.status === "APPROVED") {
          o = await pp.call("POST", `/v2/checkout/orders/${rec.paypalOrderId}/capture`, undefined, {
            "PayPal-Request-Id": `cap-${rec.txRef}`,
          });
        }
        if (!o.ok) {
          if (o.status === 404) return rec;
          throw new Error(`PayPal ${o.status}`);
        }
        r = interpretPaypalOrder(rec, o.json);
      } else {
        r = interpretFlwVerify(rec, await flw.verifyByRef(rec.txRef));
      }
    } catch (e) {
      // Provider unreachable: say nothing new, never guess success.
      console.error("refresh error", rec.txRef, e.message);
      applyTimeout(rec);
      return rec;
    }
    if (r.status === "PENDING" || r.status === "PROCESSING") {
      rec.status = rec.status === "TIMEOUT" ? "TIMEOUT" : r.status === "PENDING" ? rec.status : r.status;
      if (r.providerTransactionId) rec.providerTransactionId = r.providerTransactionId;
      applyTimeout(rec);
    } else {
      rec.status = r.status;
      rec.message = r.message;
      if (r.providerTransactionId) rec.providerTransactionId = r.providerTransactionId;
      if (r.providerReference) rec.providerReference = r.providerReference;
      if (r.captureId) rec.captureId = r.captureId;
      if (r.flagged) rec.flagged = true;
    }
    rec.updatedAt = Date.now();
    ledger.put(rec);
    return rec;
  }

  /* ---------------- route handlers ---------------- */

  async function initiate(req, body) {
    const txRef = String(body.txRef || "");
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(txRef)) throw new HttpError(400, "Invalid txRef.");
    const existing = ledger.get(txRef);
    if (existing) return view(await refresh(existing)); // idempotent: never charge twice

    const provider = String(body.provider || "");
    const amount = round2(body.amount);
    const currency = String(body.currency || "UGX").toUpperCase();
    if (!(amount > 0) || amount > 100_000_000) throw new HttpError(400, "Invalid amount.");
    if (!["UGX", "USD"].includes(currency)) throw new HttpError(400, "Unsupported currency.");

    const now = Date.now();
    const rec = {
      txRef, provider, amount, currency,
      status: "PROCESSING", createdAt: now, updatedAt: now,
      saleId: body.saleId ? String(body.saleId).slice(0, 64) : undefined,
    };
    const customerName = String(body.customerName || "PHARMA Customer").slice(0, 80);
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.customerEmail || "")
      ? body.customerEmail
      : cfg.flw.fallbackEmail;

    if (provider === "MTN_MOMO" || provider === "AIRTEL_MONEY") {
      if (currency !== "UGX") throw new HttpError(400, "Mobile money Uganda only supports UGX.");
      const phone = normalizeUgPhone(body.phone);
      if (!phone) throw new HttpError(400, "Enter the customer's Ugandan mobile number (e.g. 0772123456).");
      const wanted = provider === "MTN_MOMO" ? "MTN" : "AIRTEL";
      const actual = detectNetwork(phone);
      if (actual && actual !== wanted)
        throw new HttpError(400, `That number looks like ${actual}, not ${wanted}. Pick the matching button.`);
      rec.kind = "FLW_MM";
      rec.expiresAt = now + cfg.mmTimeoutMs;
      const r = await flw.chargeMobileMoney({
        tx_ref: txRef, amount, currency: "UGX", email, phone_number: phone,
        fullname: customerName, network: wanted,
      });
      if (!r.ok || r.json?.status !== "success") {
        rec.status = "FAILED";
        rec.message = r.json?.message || "Flutterwave rejected the request.";
      } else {
        rec.providerReference = r.json.data?.flw_ref;
        rec.message = `A payment prompt was sent to ${phone}. Ask the customer to enter their ${wanted === "MTN" ? "MTN MoMo" : "Airtel Money"} PIN.`;
        const redirect = r.json.meta?.authorization?.redirect;
        if (redirect) rec.actionUrl = redirect;
      }
    } else if (provider === "BANK_TRANSFER" || provider === "CARD_TERMINAL" || provider === "FLW_INLINE") {
      rec.kind = "FLW_HOSTED";
      rec.expiresAt = now + cfg.hostedTimeoutMs;
      const options =
        provider === "BANK_TRANSFER" ? "banktransfer,card" :
        provider === "CARD_TERMINAL" ? "card" : cfg.flw.hostedOptions;
      const r = await flw.createHostedLink({
        tx_ref: txRef, amount, currency,
        redirect_url: `${publicUrl(req)}/pay/done?tx=${encodeURIComponent(txRef)}`,
        payment_options: options,
        customer: { email, phonenumber: normalizeUgPhone(body.phone) || undefined, name: customerName },
        customizations: { title: "PHARMA Pharmacy", description: `Sale ${rec.saleId ?? txRef}` },
      });
      if (!r.ok || !r.json?.data?.link) {
        rec.status = "FAILED";
        rec.message = r.json?.message || "Could not create the payment page.";
      } else {
        rec.actionUrl = r.json.data.link;
        rec.message = "Open the secure payment page and complete the payment.";
      }
    } else if (provider === "PAYPAL") {
      rec.kind = "PAYPAL";
      rec.expiresAt = now + cfg.hostedTimeoutMs;
      let chargeAmount = amount, chargeCurrency = currency;
      if (currency !== "USD") {
        if (!(cfg.paypal.ugxPerUsd > 0)) throw new HttpError(500, "PAYPAL_UGX_PER_USD is not set.");
        chargeAmount = Math.ceil((amount / cfg.paypal.ugxPerUsd) * 100) / 100;
        chargeCurrency = "USD";
      }
      if (chargeAmount < 0.01) throw new HttpError(400, "Amount too small for PayPal.");
      rec.chargeAmount = chargeAmount;
      rec.chargeCurrency = chargeCurrency;
      const base = publicUrl(req);
      const o = await pp.call("POST", "/v2/checkout/orders", {
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: txRef.slice(0, 256), custom_id: txRef,
          description: `PHARMA sale ${rec.saleId ?? ""}`.trim(),
          amount: { currency_code: chargeCurrency, value: chargeAmount.toFixed(2) },
        }],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "PHARMA Pharmacy",
              user_action: "PAY_NOW",
              return_url: `${base}/paypal/return?tx=${encodeURIComponent(txRef)}`,
              cancel_url: `${base}/paypal/cancel?tx=${encodeURIComponent(txRef)}`,
            },
          },
        },
      }, { "PayPal-Request-Id": `ord-${txRef}` });
      const approve = o.json?.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
      if (!o.ok || !approve) {
        rec.status = "FAILED";
        rec.message = o.json?.message || "Could not create the PayPal order.";
      } else {
        rec.paypalOrderId = o.json.id;
        rec.providerReference = o.json.id;
        rec.actionUrl = approve;
        rec.message =
          chargeCurrency !== currency
            ? `Approve ${chargeAmount.toFixed(2)} USD on PayPal (converted from ${amount} ${currency}).`
            : "Approve the payment on PayPal.";
      }
    } else {
      throw new HttpError(400, "Unknown provider.");
    }
    rec.updatedAt = Date.now();
    ledger.put(rec);
    return view(rec);
  }

  async function status(txRef) {
    let rec = ledger.get(txRef);
    if (!rec) {
      // Ledger lost (e.g. free host restarted). Ask Flutterwave directly: if the
      // payment exists it is reported with the provider's own amount/currency and
      // the app re-checks the amount against its local sale before accepting it.
      const v = await flw.verifyByRef(txRef).catch(() => null);
      const d = v?.json?.data;
      if (v?.ok && d) {
        const ok = String(d.status).toLowerCase() === "successful";
        return {
          txRef, provider: "FLW", status: ok ? "SUCCESS" : String(d.status).toLowerCase() === "failed" ? "FAILED" : "PROCESSING",
          amount: Number(d.amount), currency: String(d.currency).toUpperCase(),
          providerTransactionId: String(d.id), providerReference: d.flw_ref,
          message: ok ? "Payment confirmed by Flutterwave." : "Waiting for the provider.",
        };
      }
      throw new HttpError(404, "Unknown transaction.");
    }
    return view(await refresh(rec));
  }

  async function refund(txRef, body) {
    const rec = ledger.get(txRef);
    if (!rec || rec.status !== "SUCCESS") throw new HttpError(409, "Only confirmed payments can be refunded.");
    const amount = round2(body.amount ?? rec.amount);
    if (!(amount > 0) || amount > rec.amount) throw new HttpError(400, "Invalid refund amount.");
    if (rec.refunded) throw new HttpError(409, "Already refunded.");
    let ok = false, ref;
    if (rec.kind === "PAYPAL") {
      const chargeAmt = round2((amount / rec.amount) * rec.chargeAmount);
      const r = await pp.call("POST", `/v2/payments/captures/${rec.captureId}/refund`,
        { amount: { value: chargeAmt.toFixed(2), currency_code: rec.chargeCurrency }, note_to_payer: String(body.reason || "Refund").slice(0, 255) },
        { "PayPal-Request-Id": `ref-${txRef}` });
      ok = r.ok; ref = r.json?.id;
    } else {
      const r = await flw.refund(rec.providerTransactionId, amount);
      ok = r.ok && r.json?.status === "success"; ref = r.json?.data?.id ? String(r.json.data.id) : undefined;
    }
    if (!ok) throw new HttpError(502, "The provider rejected the refund. Mobile-money refunds may need to be sent manually.");
    rec.refunded = true;
    rec.updatedAt = Date.now();
    ledger.put(rec);
    return { ok: true, refundReference: ref };
  }

  async function assistant(body) {
    if (!cfg.anthropic.key) throw new HttpError(503, "AI is not configured on the server.");
    const question = String(body.question || "").slice(0, 2000);
    if (!question) throw new HttpError(400, "Missing question.");
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    const messages = [
      ...history
        .filter((h) => (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
        .map((h) => ({ role: h.role, content: h.content.slice(0, 4000) })),
      { role: "user", content: question },
    ];
    // The Messages API needs the first turn to be "user" and strict alternation.
    while (messages.length && messages[0].role !== "user") messages.shift();
    const merged = [];
    for (const m of messages) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) last.content += "\n" + m.content;
      else merged.push({ ...m });
    }
    const system =
      "You are the assistant inside PHARMA, a pharmacy management system. Answer the manager clearly and concisely " +
      "using ONLY the business snapshot below. Never invent numbers. If the snapshot lacks the answer, say so and " +
      "suggest a question you can answer. You cannot change records and you give no medical advice or diagnosis.\n\n" +
      String(body.snapshot || "").slice(0, 60_000);
    const res = await fetch(cfg.anthropic.base + "/v1/messages", {
      method: "POST",
      headers: { "x-api-key": cfg.anthropic.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: cfg.anthropic.model, max_tokens: 700, system, messages: merged }),
      signal: AbortSignal.timeout(45_000),
    });
    const j = await res.json().catch(() => ({}));
    const text = j?.content?.find?.((c) => c.type === "text")?.text;
    if (!res.ok || !text) throw new HttpError(502, "The AI service is unavailable.");
    return { text: text.trim() };
  }

  /* ---------------- HTTP plumbing ---------------- */

  const readBody = (req, limit = 600_000) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > limit) { reject(new HttpError(413, "Body too large.")); req.destroy(); }
        else chunks.push(c);
      });
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) return resolve({});
        try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, "Invalid JSON.")); }
      });
      req.on("error", reject);
    });

  function send(res, status, obj, headers = {}) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
    res.end(body);
  }
  function page(res, title, msg, ok) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#f0fdf4">
<div style="text-align:center;padding:24px;max-width:420px"><div style="font-size:56px">${ok ? "✅" : "⚠️"}</div>
<h2 style="color:#14532d">${esc(title)}</h2><p style="color:#334155">${esc(msg)}</p>
<p style="color:#64748b;font-size:14px">You can close this window and return to PHARMA.</p></div></body>`);
  }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = origin && cfg.origins.includes(origin);
    const cors = allowed
      ? {
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin",
          "Access-Control-Allow-Headers": "content-type,x-api-key",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Max-Age": "600",
        }
      : {};
    try {
      const url = new URL(req.url, "http://x");
      const p = url.pathname;
      if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

      if (p === "/health") {
        return send(res, 200, {
          ok: true,
          flutterwave: Boolean(cfg.flw.secretKey),
          flutterwaveWebhook: Boolean(cfg.flw.secretHash),
          paypal: Boolean(cfg.paypal.clientId && cfg.paypal.clientSecret),
          ai: Boolean(cfg.anthropic.key),
          authConfigured: Boolean(cfg.apiKey),
        }, cors);
      }

      /* provider callbacks (no API key; authenticated by provider proof) */
      if (p === "/webhooks/flutterwave" && req.method === "POST") {
        if (!cfg.flw.secretHash || !safeEq(req.headers["verif-hash"] || "", cfg.flw.secretHash))
          throw new HttpError(401, "Bad signature.");
        const body = await readBody(req);
        const txRef = body?.data?.tx_ref || body?.txRef;
        const rec = txRef && ledger.get(txRef);
        if (rec) await refresh(rec); // re-verify with the API; never trust the payload
        return send(res, 200, { ok: true });
      }
      if (p === "/webhooks/paypal" && req.method === "POST") {
        const body = await readBody(req);
        if (!cfg.paypal.webhookId) return send(res, 200, { ok: true, ignored: true });
        const h = req.headers;
        const v = await pp.call("POST", "/v1/notifications/verify-webhook-signature", {
          auth_algo: h["paypal-auth-algo"], cert_url: h["paypal-cert-url"],
          transmission_id: h["paypal-transmission-id"], transmission_sig: h["paypal-transmission-sig"],
          transmission_time: h["paypal-transmission-time"], webhook_id: cfg.paypal.webhookId, webhook_event: body,
        });
        if (!v.ok || v.json?.verification_status !== "SUCCESS") throw new HttpError(401, "Bad signature.");
        const txRef = body?.resource?.custom_id ||
          body?.resource?.purchase_units?.[0]?.custom_id;
        const rec = txRef && ledger.get(txRef);
        if (rec) await refresh(rec);
        return send(res, 200, { ok: true });
      }
      if (p === "/paypal/return" && req.method === "GET") {
        const rec = ledger.get(url.searchParams.get("tx") || "");
        if (!rec) return page(res, "Unknown payment", "We could not find this payment.", false);
        await refresh(rec);
        return rec.status === "SUCCESS"
          ? page(res, "Payment received", "Thank you. PayPal confirmed your payment.", true)
          : page(res, "Payment not completed", rec.message || "Please try again.", false);
      }
      if (p === "/paypal/cancel" && req.method === "GET") {
        const rec = ledger.get(url.searchParams.get("tx") || "");
        if (rec && rec.status !== "SUCCESS") {
          rec.status = "CANCELLED"; rec.message = "The payer cancelled on PayPal."; rec.updatedAt = Date.now(); ledger.put(rec);
        }
        return page(res, "Payment cancelled", "No money was taken.", false);
      }
      if (p === "/pay/done" && req.method === "GET") {
        const rec = ledger.get(url.searchParams.get("tx") || "");
        if (rec) await refresh(rec); // do NOT trust ?status= in the URL
        return rec?.status === "SUCCESS"
          ? page(res, "Payment received", "Thank you. Your payment was confirmed.", true)
          : page(res, "Payment not confirmed", rec?.message || "We have not received confirmation yet.", false);
      }

      /* authenticated API */
      if (p.startsWith("/api/")) {
        const ip = req.socket.remoteAddress || "?";
        const t = Date.now();
        const h = hits.get(ip);
        if (!h || t > h.reset) hits.set(ip, { n: 1, reset: t + 60_000 });
        else if (++h.n > 120) throw new HttpError(429, "Too many requests.");

        if (!cfg.apiKey) throw new HttpError(503, "Server API key (PHARMA_API_KEY) is not set.");
        if (!safeEq(req.headers["x-api-key"] || "", cfg.apiKey)) throw new HttpError(401, "Unauthorized.");

        if (p === "/api/payments/initiate" && req.method === "POST")
          return send(res, 200, await initiate(req, await readBody(req)), cors);
        let m = p.match(/^\/api\/payments\/([A-Za-z0-9_-]{8,64})\/status$/);
        if (m && req.method === "GET") return send(res, 200, await status(m[1]), cors);
        m = p.match(/^\/api\/payments\/([A-Za-z0-9_-]{8,64})\/refund$/);
        if (m && req.method === "POST") return send(res, 200, await refund(m[1], await readBody(req)), cors);
        if (p === "/api/assistant" && req.method === "POST")
          return send(res, 200, await assistant(await readBody(req)), cors);
      }
      throw new HttpError(404, "Not found.");
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: status === 500 ? "Internal error." : e.message }, cors);
    }
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  createServer(cfg).listen(cfg.port, () => {
    console.log(`PHARMA payments server listening on :${cfg.port}`);
    if (!cfg.apiKey) console.warn("WARNING: PHARMA_API_KEY is not set; /api/* will refuse all requests.");
    if (!cfg.flw.secretHash) console.warn("WARNING: FLW_SECRET_HASH not set; Flutterwave webhooks will be rejected (polling still confirms payments).");
  });
}
