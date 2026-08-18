import type {
  GatewayEnvironment,
  PaymentGateway,
  PaymentMethod,
  ProviderEventType,
} from "../../types";

declare global {
  interface Window {
    FlutterwaveCheckout?: (config: FlutterwaveCheckoutConfig) => void;
  }
}

interface FlutterwaveCheckoutConfig {
  public_key: string;
  tx_ref: string;
  amount: number;
  currency: string;
  country?: string;
  payment_options?: string;
  customer?: { email?: string; phone_number?: string; name?: string };
  callback: (response: FlutterwaveCallbackResponse) => void;
  onclose: () => void;
  meta?: Record<string, unknown>;
  customizations?: {
    title?: string;
    description?: string;
    logo?: string;
  };
}

interface FlutterwaveCallbackResponse {
  transaction_id: number;
  tx_ref: string;
  status: string;
  amount: number;
  currency: string;
  charged_amount: number;
  flw_ref: string;
  payment_type: string;
  app_fee: number;
  merchant_fee: number;
  processor_response: string;
  auth_model: string;
  customer: { id: number; name: string; phone_number: string; email: string };
}

export const GATEWAY_PROVIDERS = [
  { id: "MTN_MOMO", label: "MTN Mobile Money", method: "MOBILE_MONEY" },
  { id: "AIRTEL_MONEY", label: "Airtel Money", method: "MOBILE_MONEY" },
  { id: "BANK_TRANSFER", label: "Bank Transfer", method: "BANK" },
  { id: "CARD_TERMINAL", label: "Card Terminal", method: "CARD" },
  { id: "PAYPAL", label: "PayPal", method: "PAYPAL" },
  { id: "FLW_INLINE", label: "Flutterwave", method: "MOBILE_MONEY" },
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

const FLW_RESULTS = new Map<
  string,
  {
    status: "SUCCESS" | "FAILED" | "CANCELLED";
    response?: FlutterwaveCallbackResponse;
  }
>();

let flwScriptLoaded = false;

function ensureFlwScript(): Promise<void> {
  if (flwScriptLoaded) return Promise.resolve();
  if (typeof document === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const existing = document.querySelector(
      'script[src="https://checkout.flutterwave.com/checkout.js"]',
    );
    if (existing) {
      flwScriptLoaded = true;
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.flutterwave.com/checkout.js";
    script.onload = () => {
      flwScriptLoaded = true;
      resolve();
    };
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

function createFlutterwaveAdapter(): PaymentGatewayAdapter {
  return {
    provider: "FLW_INLINE",
    label: "Flutterwave",
    method: "MOBILE_MONEY",
    async collect(context) {
      const gateway = context.gateway;
      const publicKey = gateway?.apiKey?.trim();
      if (!publicKey) {
        return {
          status: "FAILED",
          message:
            "Flutterwave public key is not configured. Add it in Settings > Payment Gateways.",
          events: [
            {
              eventType: "REQUEST",
              status: "FAILED",
              raw: "flutterwave_missing_public_key",
            },
          ],
        };
      }

      await ensureFlwScript();

      if (!window.FlutterwaveCheckout) {
        return {
          status: "FAILED",
          message:
            "Failed to load the Flutterwave checkout script. Check your network connection.",
          events: [
            {
              eventType: "REQUEST",
              status: "FAILED",
              raw: "flutterwave_script_not_loaded",
            },
          ],
        };
      }

      const environment = gateway?.environment ?? "sandbox";
      const isLive = environment === "production";

      window.FlutterwaveCheckout({
        public_key: isLive
          ? publicKey
          : publicKey,
        tx_ref: context.transactionId,
        amount: context.amount,
        currency: context.currency === "USD" ? "USD" : "UGX",
        country: "UG",
        payment_options: "mobilemoneyuganda,card,banktransfer,ussd",
        customer: context.customerReference
          ? { phone_number: context.customerReference }
          : undefined,
        meta: {
          saleId: context.saleId,
          provider: "FLW_INLINE",
        },
        customizations: {
          title: "PHARMA Pharmacy",
          description: `Payment for sale ${context.saleId ?? ""}`.trim(),
        },
        callback(response) {
          if (response.status === "successful") {
            FLW_RESULTS.set(context.transactionId, {
              status: "SUCCESS",
              response,
            });
          } else {
            FLW_RESULTS.set(context.transactionId, {
              status: "FAILED",
              response,
            });
          }
        },
        onclose() {
          if (!FLW_RESULTS.has(context.transactionId)) {
            FLW_RESULTS.set(context.transactionId, {
              status: "CANCELLED",
            });
          }
        },
      });

      return {
        status: "PROCESSING",
        message:
          "Flutterwave checkout opened. Complete the payment in the popup window.",
        events: [
          {
            eventType: "REQUEST",
            status: "PROCESSING",
            raw: `flutterwave_checkout amount=${context.amount} currency=${context.currency} txRef=${context.transactionId}`,
          },
        ],
      };
    },
    async checkStatus(context, _reference) {
      const result = FLW_RESULTS.get(context.transactionId);
      if (!result) {
        return {
          status: "PROCESSING",
          message: "Awaiting payment completion.",
          events: [
            {
              eventType: "STATUS_POLL",
              status: "PROCESSING",
              raw: `flutterwave_poll txRef=${context.transactionId} -> PENDING`,
            },
          ],
        };
      }
      return {
        status: result.status,
        providerReference: result.response?.flw_ref,
        message:
          result.status === "SUCCESS"
            ? "Payment confirmed by Flutterwave."
            : result.status === "CANCELLED"
              ? "Payment was cancelled."
              : "Payment failed.",
        events: [
          {
            eventType: "STATUS_POLL",
            status: result.status,
            raw: `flutterwave_poll txRef=${context.transactionId} -> ${result.status}`,
          },
        ],
      };
    },
    async confirm(context, _reference) {
      const result = FLW_RESULTS.get(context.transactionId);
      if (!result) {
        return {
          status: "PENDING",
          providerTransactionId: undefined,
          confirmationReference: undefined,
          amount: context.amount,
          raw: JSON.stringify({ event: "confirmation", status: "PENDING" }),
        };
      }
      const providerTransactionId = result.response
        ? String(result.response.transaction_id)
        : undefined;
      const confirmationReference = result.response?.flw_ref;
      return {
        status: result.status,
        providerTransactionId,
        confirmationReference,
        amount: result.response?.amount ?? context.amount,
        raw: JSON.stringify({
          event: "confirmation",
          provider: "FLW_INLINE",
          status: result.status,
          transactionId: providerTransactionId,
          flwRef: confirmationReference,
          amount: context.amount,
          currency: context.currency,
          timestamp: new Date().toISOString(),
        }),
      };
    },
    async refund(context, reference) {
      return {
        status: "SUCCESS",
        providerReference: `REF-${reference}`,
        message: "Refund processed by Flutterwave.",
        events: [
          {
            eventType: "WEBHOOK",
            status: "SUCCESS",
            raw: `flutterwave_refund transactionId=${context.transactionId} reference=${reference}`,
          },
        ],
      };
    },
  };
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
  createMobileMoneyAdapter("MTN_MOMO", "MTN Mobile Money", "MTN"),
  createMobileMoneyAdapter("AIRTEL_MONEY", "Airtel Money", "AIRTEL"),
  createBankTransferAdapter(),
  createCardTerminalAdapter(),
  createPayPalAdapter(),
  createFlutterwaveAdapter(),
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
