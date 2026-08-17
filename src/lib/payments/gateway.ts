import type {
  GatewayEnvironment,
  PaymentGateway,
  PaymentMethod,
  ProviderEventType,
} from "../../types";

export const GATEWAY_PROVIDERS = [
  { id: "MTN_MOMO", label: "MTN Mobile Money", method: "MOBILE_MONEY" },
  { id: "AIRTEL_MONEY", label: "Airtel Money", method: "MOBILE_MONEY" },
  { id: "BANK_TRANSFER", label: "Bank Transfer", method: "BANK" },
  { id: "CARD_TERMINAL", label: "Card Terminal", method: "CARD" },
  { id: "PAYPAL", label: "PayPal", method: "PAYPAL" },
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
