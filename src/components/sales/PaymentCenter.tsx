import { useEffect, useRef, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  RefreshCw,
  Smartphone,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  initiatePayment,
  pollPayment,
  confirmBankTransfer,
  markPaypalCompleted,
  cancelPayment,
  getConfirmationsForTransaction,
} from "../../lib/payments/service";
import { GATEWAY_PROVIDERS, getAdapter } from "../../lib/payments/gateway";
import { PAYMENT_COLOR, PAYMENT_LABEL } from "../../lib/payments/constants";
import { formatMoney, uid } from "../../lib/utils";
import { round2 } from "../../lib/sales";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { TextInput } from "../ui/Input";
import { Modal } from "../ui/Modal";
import type { PaymentMethod, PaymentStatus } from "../../types";

export interface ConfirmedPayment {
  key: string;
  method: PaymentMethod;
  amount: number;
  provider?: string;
  providerReference?: string;
  paymentReference?: string;
  transactionId?: string;
  confirmationId?: string;
  providerTransactionId?: string;
  status: PaymentStatus;
}

interface GatewaySession {
  provider: string;
  providerLabel: string;
  method: PaymentMethod;
  amount: number;
  transactionId: string;
  status: PaymentStatus;
  providerReference?: string;
  paymentReference?: string;
  providerTransactionId?: string;
  confirmationId?: string;
  message?: string;
}

interface PaymentCenterProps {
  currency: string;
  total: number;
  confirmed: ConfirmedPayment[];
  creditMode: boolean;
  customerPhone?: string;
  onConfirmedChange: (payments: ConfirmedPayment[]) => void;
  onCreditMode: (on: boolean) => void;
  onError: (message: string | null) => void;
  onEnsureDraft: () => Promise<string | null>;
  onInFlightChange?: (inFlight: boolean) => void;
}

const POLL_PROVIDERS = new Set([
  "MTN_MOMO",
  "AIRTEL_MONEY",
  "CARD_TERMINAL",
]);

export function PaymentCenter({
  currency,
  total,
  confirmed,
  creditMode,
  customerPhone,
  onConfirmedChange,
  onCreditMode,
  onError,
  onEnsureDraft,
  onInFlightChange,
}: PaymentCenterProps) {
  const confirmedSum = round2(
    confirmed.reduce((sum, p) => sum + p.amount, 0),
  );
  const remaining = round2(Math.max(0, total - confirmedSum));

  const [amountInput, setAmountInput] = useState(
    remaining > 0 ? String(remaining) : "",
  );
  const [amountTouched, setAmountTouched] = useState(false);
  const [session, setSession] = useState<GatewaySession | null>(null);

  const sessionRef = useRef<GatewaySession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!amountTouched) {
      setAmountInput(remaining > 0 ? String(remaining) : "");
    }
  }, [remaining, amountTouched]);

  const removePayment = (key: string) => {
    setAmountTouched(false);
    onConfirmedChange(confirmed.filter((p) => p.key !== key));
  };

  const finalizeGateway = async (s: GatewaySession) => {
    const confirmations = s.transactionId
      ? await getConfirmationsForTransaction(s.transactionId)
      : [];
    const latest = confirmations[confirmations.length - 1];
    onConfirmedChange([
      ...confirmed,
      {
        key: uid(),
        method: s.method,
        amount: s.amount,
        provider: s.provider,
        providerReference: s.providerReference,
        paymentReference: s.paymentReference,
        transactionId: s.transactionId,
        confirmationId: latest?.id,
        providerTransactionId:
          latest?.providerTransactionId ?? s.providerTransactionId,
        status: "SUCCESS",
      },
    ]);
    setSession(null);
    setAmountTouched(false);
  };

  const startCharge = async (providerId: string) => {
    onError(null);
    const def = GATEWAY_PROVIDERS.find((p) => p.id === providerId);
    if (!def) return;
    const amount = round2(Number(amountInput) || 0);
    if (amount <= 0) {
      onError("Enter an amount to collect first.");
      return;
    }
    try {
      const saleId = await onEnsureDraft();
      const result = await initiatePayment({
        saleId: saleId ?? undefined,
        method: def.method as PaymentMethod,
        provider: def.id,
        amount,
        currency,
        customerReference: customerPhone?.trim() || undefined,
      });
      setSession({
        provider: def.id,
        providerLabel: getAdapter(def.id)?.label ?? def.id,
        method: def.method as PaymentMethod,
        amount,
        transactionId: result.transactionId,
        status: result.status,
        providerReference: result.providerReference,
        paymentReference: result.paymentReference,
        message: result.message,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to start payment.");
    }
  };

  useEffect(() => {
    onInFlightChange?.(session !== null);
  }, [session, onInFlightChange]);

  useEffect(() => {
    const active = sessionRef.current;
    if (!active) return;
    if (active.status !== "PROCESSING") return;
    if (!POLL_PROVIDERS.has(active.provider)) return;

    let cancelled = false;
    let attempts = 0;
    const transactionId = active.transactionId;

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      if (attempts > 12) {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: "EXPIRED",
                message: "No confirmation received. The request expired.",
              }
            : prev,
        );
        return;
      }
      const status = await pollPayment(transactionId);
      if (cancelled) return;
      const current = sessionRef.current;
      if (!current) return;
      if (status === "SUCCESS") {
        void finalizeGateway({ ...current, status: "SUCCESS" });
      } else if (status === "FAILED" || status === "EXPIRED") {
        setSession((prev) => (prev ? { ...prev, status } : prev));
      } else {
        setSession((prev) => (prev ? { ...prev, status } : prev));
      }
    };

    const interval = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.transactionId]);

  const handleCash = () => {
    onError(null);
    const amount = round2(Number(amountInput) || 0);
    if (amount <= 0) {
      onError("Enter the cash amount received.");
      return;
    }
    onConfirmedChange([
      ...confirmed,
      { key: uid(), method: "CASH", amount, status: "SUCCESS" },
    ]);
    setAmountTouched(false);
  };

  const handleBankVerify = async (received: boolean) => {
    if (!session) return;
    try {
      const status = await confirmBankTransfer(
        session.transactionId,
        received,
      );
      if (status === "SUCCESS") {
        await finalizeGateway({ ...session, status: "SUCCESS" });
      } else {
        setSession({
          ...session,
          status: "FAILED",
          message: "Bank deposit could not be verified.",
        });
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Verification failed.");
    }
  };

  const handlePaypalApprove = async () => {
    if (!session) return;
    try {
      await markPaypalCompleted(session.transactionId);
      await finalizeGateway({ ...session, status: "SUCCESS" });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Approval failed.");
    }
  };

  const checkUnknown = async () => {
    if (!session) return;
    onError(null);
    try {
      const status = await pollPayment(session.transactionId);
      if (status === "SUCCESS") {
        await finalizeGateway({ ...session, status: "SUCCESS" });
      } else {
        setSession((prev) => (prev ? { ...prev, status } : prev));
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Status check failed.");
    }
  };

  const cancelSession = async () => {
    if (!session) return;
    try {
      if (session.provider === "BANK_TRANSFER") {
        await confirmBankTransfer(session.transactionId, false);
      } else {
        await cancelPayment(session.transactionId);
      }
    } catch {
      /* ignore */
    }
    setSession(null);
  };

  const iconFor = (method: PaymentMethod) => {
    switch (method) {
      case "CASH":
        return <Banknote size={16} />;
      case "MOBILE_MONEY":
        return <Smartphone size={16} />;
      case "CARD":
        return <CreditCard size={16} />;
      default:
        return <Wallet size={16} />;
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-800">
          Payment Center
        </span>
        <Badge tone="blue">{formatMoney(confirmedSum, currency)} collected</Badge>
      </div>

      {confirmed.length > 0 && (
        <ul className="space-y-1.5">
          {confirmed.map((p) => (
            <li
              key={p.key}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: PAYMENT_COLOR[p.method] }}
              />
              <span className="flex-1 font-medium text-slate-800">
                {PAYMENT_LABEL[p.method]}
              </span>
              <div className="text-right text-xs text-slate-500">
                {p.paymentReference && (
                  <p className="font-mono text-slate-500">{p.paymentReference}</p>
                )}
                {p.provider && (
                  <p>
                    {p.provider}
                    {p.providerReference ? ` · ${p.providerReference}` : ""}
                  </p>
                )}
                {p.providerTransactionId && (
                  <p className="font-mono text-emerald-600">
                    {p.providerTransactionId}
                  </p>
                )}
              </div>
              <span className="font-semibold text-slate-900">
                {formatMoney(p.amount, currency)}
              </span>
              <button
                onClick={() => removePayment(p.key)}
                disabled={!!session}
                className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-40"
                aria-label="Remove payment"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Amount to collect
        </label>
        <div className="flex gap-2">
          <TextInput
            type="number"
            min="0"
            placeholder="0"
            value={amountInput}
            onChange={(e) => {
              setAmountInput(e.target.value);
              setAmountTouched(true);
            }}
          />
          <Button
            variant="outline"
            size="md"
            onClick={() => {
              setAmountInput(String(remaining));
              setAmountTouched(true);
            }}
          >
            Exact
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          onClick={handleCash}
          disabled={!!session}
          className="justify-center"
        >
          <Banknote size={16} className="text-teal-700" />
          Cash
        </Button>
        {GATEWAY_PROVIDERS.map((provider) => (
          <Button
            key={provider.id}
            variant="outline"
            onClick={() => startCharge(provider.id)}
            disabled={!!session}
            className="justify-center"
          >
            {iconFor(provider.method as PaymentMethod)}
            {getAdapter(provider.id)?.label ?? provider.id}
          </Button>
        ))}
        <Button
          variant={creditMode ? "primary" : "outline"}
          onClick={() => {
            onError(null);
            onCreditMode(!creditMode);
          }}
          className="justify-center"
        >
          <Wallet size={16} className={creditMode ? "" : "text-amber-600"} />
          Credit {creditMode ? "On" : "Off"}
        </Button>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">Remaining</span>
        <span
          className={`font-bold ${remaining > 0 ? "text-amber-600" : "text-green-600"}`}
        >
          {formatMoney(remaining, currency)}
        </span>
      </div>

      {session && (
        <Modal
          title={session.providerLabel}
          subtitle={formatMoney(session.amount, currency)}
          onClose={cancelSession}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {session.status === "PROCESSING" ? (
                <Loader2 size={20} className="animate-spin text-blue-600" />
              ) : session.status === "SUCCESS" ? (
                <CheckCircle2 size={20} className="text-green-600" />
              ) : session.status === "UNKNOWN" ? (
                <Loader2 size={20} className="text-amber-600" />
              ) : (
                <RefreshCw size={20} className="text-red-500" />
              )}
              <Badge
                tone={
                  session.status === "SUCCESS"
                    ? "green"
                    : session.status === "PROCESSING" ||
                        session.status === "PENDING"
                      ? "blue"
                      : session.status === "UNKNOWN"
                        ? "amber"
                        : "red"
                }
              >
                {session.status}
              </Badge>
            </div>
            {session.message && (
              <p className="text-sm text-slate-600">{session.message}</p>
            )}
            {(session.status === "PROCESSING" ||
              session.status === "PENDING") && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                Money is <strong>not</strong> recorded as collected until the
                provider confirms the payment. Stock and revenue stay untouched
                until that confirmation is verified.
              </div>
            )}
            {session.paymentReference && (
              <p className="font-mono text-xs text-slate-400">
                Payment: {session.paymentReference}
              </p>
            )}
            {session.providerReference && (
              <p className="text-xs text-slate-400">
                Provider ref: {session.providerReference}
              </p>
            )}

            {session.provider === "BANK_TRANSFER" &&
              session.status === "PENDING" && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">
                    Confirm once the deposit appears in the pharmacy bank
                    account.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleBankVerify(true)}
                      className="flex-1"
                    >
                      <CheckCircle2 size={16} />
                      Deposit received
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleBankVerify(false)}
                    >
                      Not received
                    </Button>
                  </div>
                </div>
              )}

            {session.provider === "PAYPAL" &&
              session.status === "PENDING" && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">
                    Awaiting payer approval. Simulate the PayPal callback to
                    confirm.
                  </p>
                  <Button
                    onClick={handlePaypalApprove}
                    className="w-full"
                  >
                    <CheckCircle2 size={16} />
                    Approve (simulate callback)
                  </Button>
                </div>
              )}

            {(session.status === "FAILED" ||
              session.status === "DECLINED" ||
              session.status === "CANCELLED" ||
              session.status === "TIMEOUT" ||
              session.status === "EXPIRED") && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    startCharge(session.provider as (typeof GATEWAY_PROVIDERS)[number]["id"])
                  }
                  className="flex-1"
                >
                  <RefreshCw size={16} />
                  Retry
                </Button>
                <Button variant="outline" onClick={cancelSession}>
                  Cancel
                </Button>
              </div>
            )}

            {session.status === "UNKNOWN" && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Do not collect or record this payment until the provider status
                is confirmed. Re-check with the provider before retrying.
              </div>
            )}
            {session.status === "UNKNOWN" && (
              <div className="flex gap-2">
                <Button onClick={checkUnknown} className="flex-1">
                  <RefreshCw size={16} />
                  Check payment status
                </Button>
                <Button variant="outline" onClick={cancelSession}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
