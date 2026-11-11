import type {
  GatewayEnvironment,
  PaymentGateway,
  PaymentMethod,
  ProviderEventType,
} from "../../types";
import {
  NetworkUnavailableError,
  PaymentsServerError,
  loadPaymentsServerConfig,
  remote,
  type RemoteStatus,
} from "./remote";

export const GATEWAY_PROVIDERS = [
  { id: "MTN_MOMO", label: "MTN Mobile Money", method: "MOBILE_MONEY" },
  { id: "AIRTEL_MONEY", label: "Airtel Money", method: "MOBILE_MONEY" },
  { id: "BANK_TRANSFER", label: "Bank Transfer", method: "BANK" },
  { id: "CARD_TERMINAL", label: "Card (Online)", method: "CARD" },
  { id: "PAYPAL", label: "PayPal", method: "PAYPAL" },
  { id: "FLW_INLINE", label: "Flutterwave (All)", method: "MOBILE_MONEY" },
] as const;

export type GatewayProviderId = (typeof GATEWAY_PROVIDERS)[number]["id"];

export function providerLabel(id: string): string {
  return GATEWAY_PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

export function providerForMethod(
  method: PaymentMethod,
  provider?: string,
): string | undefined {
  if (provider) return provider;
  const match = GATEWAY_PROVIDERS.find((p) => p.method === method);
  return match?.id;
}

export interface GatewayContext {
  transactionId: string;
  paymentId?: string;
  saleId?: string;
  provider: string;
  method: PaymentMethod;
  amount: number;
  currency: string;
  customerReference?: string;
  /** For refunds: id of the original COLLECTION transaction being refunded. */
  originalTransactionId?: string;
  gateway?: PaymentGateway;
}

export type GatewayStatus =
  | "PROCESSING"
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "DECLINED"
  | "CANCELLED"
  | "TIMEOUT"
  | "EXPIRED"
  | "UNKNOWN";

export interface GatewayResult {
  status: GatewayStatus;
  providerReference?: string;
  message?: string;
  /** Page the customer must open to pay (card / bank / PayPal). */
  actionUrl?: string;
  events: Array<{
    eventType: ProviderEventType;
    status: string;
    raw: string;
  }>;
}

export interface ProviderConfirmationResult {
  status: GatewayStatus;
  providerTransactionId?: string;
  confirmationReference?: string;
  amount?: number;
  raw: string;
}

export interface PaymentGatewayAdapter {
  readonly provider: string;
  readonly label: string;
  readonly method: PaymentMethod;
  collect(context: GatewayContext): Promise<GatewayResult>;
  checkStatus(
    context: GatewayContext,
    providerReference: string,
  ): Promise<GatewayResult>;
  confirm(
    context: GatewayContext,
    providerReference: string,
  ): Promise<ProviderConfirmationResult>;
  refund(
    context: GatewayContext,
    providerReference: string,
  ): Promise<GatewayResult>;
}

function forcedOutcome(context: GatewayContext): string | undefined {
  const sim = context.gateway?.config?.["simOutcome"];
  if (
    sim === "SUCCESS" ||
    sim === "FAILED" ||
    sim === "DECLINED" ||
    sim === "TIMEOUT" ||
    sim === "UNKNOWN"
  ) {
    return sim;
  }
  return undefined;
}

function simulatedFinal(
  context: GatewayContext,
  successBias: number,
): { status: GatewayStatus; message: string } {
  const forced = forcedOutcome(context);
  if (forced === "FAILED")
    return { status: "FAILED", message: "Provider declined the transaction." };
  if (forced === "DECLINED")
    return {
      status: "DECLINED",
      message: "The customer declined the payment request.",
    };
  if (forced === "TIMEOUT")
    return {
      status: "TIMEOUT",
      message: "No confirmation was received before the request window ended.",
    };
  if (forced === "UNKNOWN")
    return {
      status: "UNKNOWN",
      message:
        "Connection was lost before the provider could confirm the result.",
    };
  if (forced === "SUCCESS")
    return { status: "SUCCESS", message: "Payment confirmed by provider." };
  if (Math.random() > successBias) {
    const reasons = [
      "Provider declined the transaction.",
      "Insufficient funds on the customer's account.",
      "The customer declined the payment request.",
    ];
    return {
      status: "FAILED",
      message: reasons[Math.floor(Math.random() * reasons.length)],
    };
  }
  return { status: "SUCCESS", message: "Payment confirmed by provider." };
}

function providerReference(prefix: string): string {
  const rand = Math.floor(Math.random() * 1_000_000_000);
  return `${prefix}-${String(rand).padStart(9, "0")}`;
}

function providerTxnId(prefix: string): string {
  const rand = Math.floor(Math.random() * 1_000_000_000);
  return `${prefix}${String(rand).padStart(9, "0")}`;
}

function confirmationPayload(
  provider: string,
  context: GatewayContext,
  reference: string,
  status: GatewayStatus,
  providerTransactionId: string,
): string {
  return JSON.stringify({
    event: "confirmation",
    provider,
    status,
    reference,
    transactionId: providerTransactionId,
    amount: context.amount,
    currency: context.currency,
    merchant: "PHARMA",
    timestamp: new Date().toISOString(),
  });
}

export function createMobileMoneyAdapter(
  provider: string,
  label: string,
  prefix: string,
  successBias = 0.88,
): PaymentGatewayAdapter {
  return {
    provider,
    label,
    method: "MOBILE_MONEY",
    async collect(context) {
      return {
        status: "PROCESSING",
        providerReference: providerReference(prefix),
        message: `${label} Request-to-Pay sent. Awaiting customer approval.`,
        events: [
          {
            eventType: "REQUEST",
            status: "PROCESSING",
            raw: `requestToPay amount=${context.amount} customer=${context.customerReference ?? "N/A"}`,
          },
        ],
      };
    },
    async checkStatus(context, reference) {
      const outcome = simulatedFinal(context, successBias);
      return {
        status: outcome.status,
        providerReference: reference,
        message: outcome.message,
        events: [
          {
            eventType: "STATUS_POLL",
            status: outcome.status,
            raw: `statusPoll reference=${reference} -> ${outcome.status}`,
          },
        ],
      };
    },
    async confirm(context, reference) {
      const outcome = simulatedFinal(context, successBias);
      const providerTransactionId = providerTxnId("MM");
      return {
        status: outcome.status,
        providerTransactionId,
        confirmationReference: `CNF-${reference}`,
        amount: context.amount,
        raw: confirmationPayload(
          provider,
          context,
          reference,
          outcome.status,
          providerTransactionId,
        ),
      };
    },
    async refund(context, reference) {
      return {
        status: "SUCCESS",
        providerReference: `REF-${reference}`,
        message: "Refund processed by provider.",
        events: [
          {
            eventType: "WEBHOOK",
            status: "SUCCESS",
            raw: `refund transactionId=${context.transactionId} reference=${reference}`,
          },
        ],
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Live adapters: every online payment goes through the PHARMA server   */
/* ------------------------------------------------------------------ */

function isDemoMode(context: GatewayContext): boolean {
  return context.gateway?.config?.["demoMode"] === "true";
}

const NO_SERVER_MESSAGE =
  "Online payments are not set up yet. An admin must enter the Payments Server URL and key in Settings > Payments Server.";

function remoteEvent(
  eventType: ProviderEventType,
  status: string,
  raw: string,
): GatewayResult["events"][number] {
  return { eventType, status, raw };
}

function toGatewayStatus(s: RemoteStatus): GatewayStatus {
  return s;
}

/**
 * Wraps a legacy (simulated) adapter so that:
 *  - demo mode (Settings > Payment Gateways) still uses the simulator, and
 *  - live mode talks to the PHARMA payments server, which asks the real provider.
 * A payment is SUCCESS only when the provider confirmed it for the right amount.
 */
function createLiveAdapter(
  legacy: PaymentGatewayAdapter,
  options: { manualFallback?: boolean } = {},
): PaymentGatewayAdapter {
  const live: PaymentGatewayAdapter = {
    provider: legacy.provider,
    label: legacy.label,
    method: legacy.method,

    async collect(context) {
      if (isDemoMode(context)) return legacy.collect(context);
      const cfg = await loadPaymentsServerConfig();
      if (!cfg) {
        if (options.manualFallback) return legacy.collect(context);
        return {
          status: "FAILED",
          message: NO_SERVER_MESSAGE,
          events: [remoteEvent("REQUEST", "FAILED", "payments_server_not_configured")],
        };
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return {
          status: "FAILED",
          message:
            "No internet connection. Online payments need internet. Use cash or try again when you are back online.",
          events: [remoteEvent("REQUEST", "FAILED", "offline_before_request")],
        };
      }
      try {
        const r = await remote.initiate(cfg, {
          txRef: context.transactionId,
          provider: context.provider,
          amount: context.amount,
          currency: context.currency,
          phone: context.customerReference,
          saleId: context.saleId,
        });
        return {
          status: toGatewayStatus(r.status),
          providerReference: r.providerReference,
          message: r.message,
          actionUrl: r.actionUrl,
          events: [
            remoteEvent(
              "REQUEST",
              r.status,
              `server_initiate provider=${context.provider} amount=${context.amount} ${context.currency} ref=${r.providerReference ?? "-"}`,
            ),
          ],
        };
      } catch (err) {
        if (err instanceof NetworkUnavailableError) {
          // The request may or may not have reached the server: never guess.
          return {
            status: "UNKNOWN",
            message:
              "Lost connection while starting the payment. Press 'Check payment status' before trying again so the customer is not charged twice.",
            events: [remoteEvent("REQUEST", "UNKNOWN", "network_error_on_initiate")],
          };
        }
        return {
          status: "FAILED",
          message: err instanceof Error ? err.message : "Payment could not be started.",
          events: [remoteEvent("REQUEST", "FAILED", "server_rejected_initiate")],
        };
      }
    },

    async checkStatus(context, reference) {
      const r = await live.confirm(context, reference);
      return {
        status: r.status,
        providerReference: reference || undefined,
        events: [remoteEvent("STATUS_POLL", r.status, `server_status ${r.status}`)],
      };
    },

    async confirm(context, reference) {
      if (isDemoMode(context)) return legacy.confirm(context, reference);
      const cfg = await loadPaymentsServerConfig();
      if (!cfg) {
        if (options.manualFallback) return legacy.confirm(context, reference);
        return {
          status: "PENDING",
          amount: context.amount,
          raw: JSON.stringify({ status: "PENDING", note: "payments_server_not_configured" }),
        };
      }
      try {
        const r = await remote.status(cfg, context.transactionId);
        return {
          status: toGatewayStatus(r.status),
          providerTransactionId: r.providerTransactionId,
          confirmationReference: r.providerReference,
          amount: r.amount,
          raw: JSON.stringify({
            event: "confirmation",
            source: "payments_server",
            provider: context.provider,
            status: r.status,
            amount: r.amount,
            currency: r.currency,
            transactionId: r.providerTransactionId,
            message: r.message,
            timestamp: new Date().toISOString(),
          }),
        };
      } catch (err) {
        if (err instanceof PaymentsServerError && err.status === 404) {
          // The server never saw this payment, so no money can have moved.
          return {
            status: "FAILED",
            amount: context.amount,
            raw: JSON.stringify({ status: "FAILED", note: "unknown_to_server" }),
          };
        }
        // Offline or server hiccup: stay undecided and keep polling. Never guess.
        return {
          status: "PROCESSING",
          amount: context.amount,
          raw: JSON.stringify({ status: "PROCESSING", note: "status_unavailable" }),
        };
      }
    },

    async refund(context, reference) {
      if (isDemoMode(context)) return legacy.refund(context, reference);
      const cfg = await loadPaymentsServerConfig();
      const original = context.originalTransactionId;
      if (!cfg || !original) {
        return {
          status: "FAILED",
          message:
            "The provider refund could not be sent automatically. Refund the customer manually and note it here.",
          events: [remoteEvent("WEBHOOK", "FAILED", "refund_not_sent")],
        };
      }
      try {
        const r = await remote.refund(cfg, original, context.amount);
        return {
          status: "SUCCESS",
          providerReference: r.refundReference,
          message: "Refund sent to the provider.",
          events: [remoteEvent("WEBHOOK", "SUCCESS", `server_refund ref=${r.refundReference ?? "-"}`)],
        };
      } catch (err) {
        return {
          status: "FAILED",
          message: err instanceof Error ? err.message : "Refund failed.",
          events: [remoteEvent("WEBHOOK", "FAILED", "server_refund_failed")],
        };
      }
    },
  };
  return live;
}

function createBankTransferAdapter(): PaymentGatewayAdapter {
  return {
    provider: "BANK_TRANSFER",
    label: "Bank Transfer",
    method: "BANK",
    async collect(context) {
      return {
        status: "PENDING",
        providerReference: providerReference("BNK"),
        message:
          "Bank transfer instructions issued. Awaiting manual verification of the deposit.",
        events: [
          {
            eventType: "REQUEST",
            status: "PENDING",
            raw: `bankInstructions amount=${context.amount} account=${context.customerReference ?? "N/A"}`,
          },
        ],
      };
    },
    async checkStatus() {
      return {
        status: "PENDING",
        message: "Bank deposit not yet verified.",
        events: [
          {
            eventType: "STATUS_POLL",
            status: "PENDING",
            raw: "statusPoll bankVerification=awaiting",
          },
        ],
      };
    },
    async confirm(context, reference) {
      const providerTransactionId = providerTxnId("BNK");
      return {
        status: "PENDING",
        providerTransactionId,
        confirmationReference: `CNF-${reference}`,
        amount: context.amount,
        raw: JSON.stringify({
          event: "confirmation",
          provider: "BANK_TRANSFER",
          status: "PENDING",
          reference,
          transactionId: providerTransactionId,
          amount: context.amount,
          currency: context.currency,
          merchant: "PHARMA",
          timestamp: new Date().toISOString(),
          note: "Deposit confirmation is completed by pharmacy staff after the funds appear in the bank account.",
        }),
      };
    },
    async refund(context, reference) {
      return {
        status: "SUCCESS",
        providerReference: `REF-${reference}`,
        message: "Bank refund requested.",
        events: [
          {
            eventType: "WEBHOOK",
            status: "SUCCESS",
            raw: `refund transactionId=${context.transactionId} reference=${reference}`,
          },
        ],
      };
    },
  };
}

function createCardTerminalAdapter(): PaymentGatewayAdapter {
  return {
    provider: "CARD_TERMINAL",
    label: "Card Terminal",
    method: "CARD",
    async collect(_context) {
      return {
        status: "PROCESSING",
        providerReference: providerReference("TMP"),
        message:
          "Card payment request sent to the terminal. Awaiting the terminal's approval.",
        events: [
          {
            eventType: "REQUEST",
            status: "PROCESSING",
            raw: "cardTerminal(no PIN captured, hardware auth only)",
          },
        ],
      };
    },
    async checkStatus(context, reference) {
      return this.collect(context).then((r) => ({
        ...r,
        providerReference: reference,
        events: [
          {
            eventType: "STATUS_POLL",
            status: r.status,
            raw: `statusPoll reference=${reference} -> ${r.status}`,
          },
        ],
      }));
    },
    async confirm(context, reference) {
      const outcome = simulatedFinal(context, 0.92);
      const providerTransactionId = providerTxnId("TMP");
      return {
        status: outcome.status,
        providerTransactionId,
        confirmationReference: `CNF-${reference}`,
        amount: context.amount,
        raw: confirmationPayload(
          "CARD_TERMINAL",
          context,
          reference,
          outcome.status,
          providerTransactionId,
        ),
      };
    },
    async refund(context, reference) {
      return {
        status: "SUCCESS",
        providerReference: `REF-${reference}`,
        message: "Card refund submitted.",
        events: [
          {
            eventType: "WEBHOOK",
            status: "SUCCESS",
            raw: `refund transactionId=${context.transactionId} reference=${reference}`,
          },
        ],
      };
    },
  };
}

function createPayPalAdapter(): PaymentGatewayAdapter {
  return {
    provider: "PAYPAL",
    label: "PayPal",
    method: "PAYPAL",
    async collect(context) {
      return {
        status: "PENDING",
        providerReference: providerReference("PYPL"),
        message: "PayPal checkout session opened. Awaiting payer approval.",
        events: [
          {
            eventType: "REQUEST",
            status: "PENDING",
            raw: `paypalCheckout amount=${context.amount} currency=${context.currency}`,
          },
        ],
      };
    },
    async checkStatus(context, reference) {
      const outcome = simulatedFinal(context, 0.85);
      return {
        status: outcome.status,
        providerReference: reference,
        message: outcome.message,
        events: [
          {
            eventType: "CALLBACK",
            status: outcome.status,
            raw: `paypalCallback reference=${reference} -> ${outcome.status}`,
          },
        ],
      };
    },
    async confirm(context, reference) {
      const outcome = simulatedFinal(context, 0.85);
      const providerTransactionId = providerTxnId("PYPL");
      return {
        status: outcome.status,
        providerTransactionId,
        confirmationReference: `CNF-${reference}`,
        amount: context.amount,
        raw: confirmationPayload(
          "PAYPAL",
          context,
          reference,
          outcome.status,
          providerTransactionId,
        ),
      };
    },
    async refund(context, reference) {
      return {
        status: "SUCCESS",
        providerReference: `REF-${reference}`,
        message: "PayPal refund processed.",
        events: [
          {
            eventType: "WEBHOOK",
            status: "SUCCESS",
            raw: `refund transactionId=${context.transactionId} reference=${reference}`,
          },
        ],
      };
    },
  };
}

const ADAPTERS: PaymentGatewayAdapter[] = [
  createLiveAdapter(createMobileMoneyAdapter("MTN_MOMO", "MTN Mobile Money", "MTN")),
  createLiveAdapter(createMobileMoneyAdapter("AIRTEL_MONEY", "Airtel Money", "AIRTEL")),
  // Bank: automatic through the server; if no server is configured the cashier
  // can still verify a deposit manually (the original, honest manual flow).
  createLiveAdapter(createBankTransferAdapter(), { manualFallback: true }),
  createLiveAdapter(createCardTerminalAdapter()),
  createLiveAdapter(createPayPalAdapter()),
  createLiveAdapter(createMobileMoneyAdapter("FLW_INLINE", "Flutterwave (All)", "FLW")),
];

export function getAdapter(
  provider: string,
): PaymentGatewayAdapter | undefined {
  return ADAPTERS.find((a) => a.provider === provider);
}

export function isGatewayMethod(method: PaymentMethod): boolean {
  return method === "MOBILE_MONEY" || method === "BANK" || method === "CARD" || method === "PAYPAL";
}

export function gatewayEnvLabel(env: GatewayEnvironment): string {
  return env === "production" ? "Production" : "Sandbox";
}
