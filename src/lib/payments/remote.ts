import { pharmaDb } from "../../db";

/**
 * Client for the PHARMA payments server (see /server).
 * Provider secrets live on that server, never in the app. The app only ever
 * learns a payment succeeded because the server asked the provider and the
 * provider confirmed it.
 */

export const PAYMENTS_SETTING_KEYS = {
  url: "payments_server_url",
  key: "payments_server_key",
} as const;

export interface PaymentsServerConfig {
  url: string;
  apiKey: string;
}

const ENV_URL = (import.meta.env?.VITE_PAYMENTS_SERVER_URL as string | undefined) ?? "";
const ENV_KEY = (import.meta.env?.VITE_PAYMENTS_SERVER_KEY as string | undefined) ?? "";

export async function loadPaymentsServerConfig(): Promise<PaymentsServerConfig | null> {
  let url = "";
  let apiKey = "";
  try {
    const rows = await pharmaDb.systemSettings.toArray();
    const get = (k: string) =>
      rows.find((r) => r.settingKey === k)?.settingValue?.trim() ?? "";
    url = get(PAYMENTS_SETTING_KEYS.url);
    apiKey = get(PAYMENTS_SETTING_KEYS.key);
  } catch {
    /* db unavailable: fall through to build-time defaults */
  }
  url = (url || ENV_URL).trim().replace(/\/+$/, "");
  apiKey = (apiKey || ENV_KEY).trim();
  if (!url || !apiKey) return null;
  return { url, apiKey };
}

export type RemoteStatus =
  | "PROCESSING"
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "DECLINED"
  | "CANCELLED"
  | "TIMEOUT"
  | "EXPIRED";

export interface RemotePayment {
  txRef: string;
  provider: string;
  status: RemoteStatus;
  amount: number;
  currency: string;
  providerReference?: string;
  providerTransactionId?: string;
  message?: string;
  actionUrl?: string;
  expiresAt?: number;
}

/** Thrown when the server could not be reached (offline, DNS, timeout). */
export class NetworkUnavailableError extends Error {
  constructor(message = "Cannot reach the payments server. Check the internet connection.") {
    super(message);
    this.name = "NetworkUnavailableError";
  }
}

/** Thrown when the server answered with an error. `message` is safe to show. */
export class PaymentsServerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PaymentsServerError";
    this.status = status;
  }
}

async function request<T>(
  cfg: PaymentsServerConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(cfg.url + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new NetworkUnavailableError();
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    const msg =
      res.status === 401
        ? "The payments server rejected the app's key. Check Settings > Payments Server."
        : (data.error ?? `Payments server error (${res.status}).`);
    throw new PaymentsServerError(res.status, msg);
  }
  return data as T;
}

export interface InitiateRemoteInput {
  txRef: string;
  provider: string;
  amount: number;
  currency: string;
  phone?: string;
  saleId?: string;
  customerName?: string;
  customerEmail?: string;
}

export const remote = {
  initiate: (cfg: PaymentsServerConfig, input: InitiateRemoteInput) =>
    request<RemotePayment>(cfg, "POST", "/api/payments/initiate", input),
  status: (cfg: PaymentsServerConfig, txRef: string) =>
    request<RemotePayment>(
      cfg,
      "GET",
      `/api/payments/${encodeURIComponent(txRef)}/status`,
      undefined,
      20_000,
    ),
  refund: (
    cfg: PaymentsServerConfig,
    txRef: string,
    amount: number,
    reason?: string,
  ) =>
    request<{ ok: boolean; refundReference?: string }>(
      cfg,
      "POST",
      `/api/payments/${encodeURIComponent(txRef)}/refund`,
      { amount, reason },
    ),
  assistant: (
    cfg: PaymentsServerConfig,
    payload: {
      question: string;
      snapshot: string;
      history: Array<{ role: string; content: string }>;
    },
  ) =>
    request<{ text: string }>(cfg, "POST", "/api/assistant", payload, 50_000),
};
