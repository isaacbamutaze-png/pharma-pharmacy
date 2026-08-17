import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ReceiptText,
  TrendingUp,
  AlertTriangle,
  History,
  RefreshCw,
  ShieldCheck,
  Clock3,
} from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { SelectInput, TextInput } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { formatMoney, formatDateTime } from "../../lib/utils";
import { PAYMENT_LABEL } from "../../lib/payments/constants";
import { providerLabel } from "../../lib/payments/gateway";
import { pollPayment } from "../../lib/payments/service";
import type {
  PaymentMethod,
  PaymentTransaction,
} from "../../types";

const FINAL_STATUSES = new Set([
  "SUCCESS",
  "FAILED",
  "DECLINED",
  "CANCELLED",
  "TIMEOUT",
  "EXPIRED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "VOIDED",
]);

const AWAITING_STATUSES = new Set([
  "PENDING",
  "PROCESSING",
  "UNKNOWN",
  "EXPIRED",
]);

const STATUS_TONE: Record<string, "green" | "red" | "amber" | "slate" | "blue"> = {
  SUCCESS: "green",
  PENDING: "blue",
  PROCESSING: "blue",
  UNKNOWN: "amber",
  FAILED: "red",
  DECLINED: "red",
  CANCELLED: "red",
  TIMEOUT: "red",
  EXPIRED: "red",
  REFUNDED: "red",
  PARTIALLY_REFUNDED: "amber",
  VOIDED: "slate",
};

const DIRECTION_LABEL: Record<"COLLECTION" | "REFUND", string> = {
  COLLECTION: "Collection",
  REFUND: "Refund",
};

const ALL_STATUSES = [
  "SUCCESS",
  "PENDING",
  "PROCESSING",
  "UNKNOWN",
  "FAILED",
  "DECLINED",
  "CANCELLED",
  "TIMEOUT",
  "EXPIRED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "VOIDED",
];

export function UserPaymentsPage() {
  const transactions =
    useLiveQuery(
      () =>
        pharmaDb.paymentTransactions
          .orderBy("createdAt")
          .reverse()
          .limit(300)
          .toArray(),
      [],
    ) ?? [];
  const sales = useLiveQuery(() => pharmaDb.sales.toArray(), []) ?? [];
  const events =
    useLiveQuery(() => pharmaDb.paymentProviderEvents.toArray(), []) ?? [];

  const invoiceBySaleId = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sales) map.set(s.id, s.invoiceNumber);
    return map;
  }, [sales]);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [methodFilter, setMethodFilter] = useState("ALL");
  const [directionFilter, setDirectionFilter] = useState("ALL");
  const [viewing, setViewing] = useState<PaymentTransaction | null>(null);
  const [checking, setChecking] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  const confirmations =
    useLiveQuery(
      async () =>
        viewing
          ? await pharmaDb.paymentConfirmations
              .where("transactionId")
              .equals(viewing.id)
              .toArray()
          : [],
      [viewing],
    ) ?? [];

  const checkStatus = async (txId: string) => {
    setChecking(true);
    setPollError(null);
    try {
      await pollPayment(txId);
      const fresh = await pharmaDb.paymentTransactions.get(txId);
      if (fresh) setViewing(fresh);
    } catch (err) {
      setPollError(err instanceof Error ? err.message : "Status check failed.");
    } finally {
      setChecking(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (statusFilter !== "ALL" && tx.status !== statusFilter) return false;
      if (methodFilter !== "ALL" && tx.method !== methodFilter) return false;
      if (directionFilter !== "ALL" && tx.direction !== directionFilter) {
        return false;
      }
      if (!q) return true;
      const invoice = invoiceBySaleId.get(tx.saleId ?? "") ?? "";
      return (
        (tx.paymentReference ?? "").toLowerCase().includes(q) ||
        (tx.providerReference ?? "").toLowerCase().includes(q) ||
        invoice.toLowerCase().includes(q) ||
        (tx.provider ?? "").toLowerCase().includes(q) ||
        (tx.customerReference ?? "").toLowerCase().includes(q)
      );
    });
  }, [transactions, query, statusFilter, methodFilter, directionFilter, invoiceBySaleId]);

  const collected = useMemo(
    () =>
      filtered
        .filter(
          (tx) => tx.direction === "COLLECTION" && tx.status === "SUCCESS",
        )
        .reduce((sum, tx) => sum + tx.amount, 0),
    [filtered],
  );
  const awaiting = useMemo(
    () =>
      filtered.filter(
        (tx) =>
          tx.direction === "COLLECTION" && AWAITING_STATUSES.has(tx.status),
      ),
    [filtered],
  );
  const unresolved = useMemo(
    () => filtered.filter((tx) => tx.status === "UNKNOWN").length,
    [filtered],
  );

  const timeline = useMemo(
    () =>
      viewing
        ? events
            .filter((e) => e.transactionId === viewing.id)
            .sort((a, b) => a.receivedAt - b.receivedAt)
        : [],
    [events, viewing],
  );

  return (
    <div>
      <PageHeader
        title="Payments & Transactions"
        subtitle="Track gateway charges, provider confirmations and money collected from sales"
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">
            Transactions ({filtered.length})
          </p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {transactions.length}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
            <TrendingUp size={13} className="text-green-600" />
            Collected (filter)
          </p>
          <p className="mt-1 text-xl font-bold text-green-600">
            {formatMoney(collected)}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
            <Clock3 size={13} className="text-blue-600" />
            Awaiting confirmation
          </p>
          <p className="mt-1 text-xl font-bold text-blue-600">
            {awaiting.length}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="flex items-center gap-1 text-xs font-medium text-slate-500">
            <AlertTriangle size={13} className="text-amber-600" />
            Unresolved
          </p>
          <p className="mt-1 text-xl font-bold text-amber-600">
            {unresolved}
          </p>
        </Card>
      </div>

      <Card
        title="Transaction history"
        subtitle="Search by payment reference, provider reference or invoice"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <TextInput
            label="Search"
            placeholder="PAY-…, MTN-…, INV-…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <SelectInput
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">All statuses</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            label="Method"
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
          >
            <option value="ALL">All methods</option>
            {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_LABEL[m]}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            label="Direction"
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
          >
            <option value="ALL">All</option>
            <option value="COLLECTION">Collection</option>
            <option value="REFUND">Refund</option>
          </SelectInput>
        </div>

        <div className="mt-4 overflow-x-auto">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              No transactions match the current filters.
            </p>
          ) : (
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-2 font-medium">Date</th>
                  <th className="py-2 pr-2 font-medium">Payment Ref</th>
                  <th className="py-2 pr-2 font-medium">Type</th>
                  <th className="py-2 pr-2 font-medium">Method</th>
                  <th className="py-2 pr-2 font-medium">Invoice</th>
                  <th className="py-2 pr-2 text-right font-medium">Amount</th>
                  <th className="py-2 pr-2 font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Trace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-2 text-slate-600">
                      {formatDateTime(tx.createdAt)}
                    </td>
                    <td className="py-2.5 pr-2 font-mono text-xs text-slate-800">
                      {tx.paymentReference ?? "—"}
                    </td>
                    <td className="py-2.5 pr-2 text-slate-600">
                      {DIRECTION_LABEL[tx.direction]}
                    </td>
                    <td className="py-2.5 pr-2 text-slate-600">
                      {PAYMENT_LABEL[tx.method]}
                      {tx.provider ? (
                        <span className="block text-xs text-slate-400">
                          {providerLabel(tx.provider)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-2 font-mono text-xs text-slate-500">
                      {invoiceBySaleId.get(tx.saleId ?? "") ?? "—"}
                    </td>
                    <td
                      className={`py-2.5 pr-2 text-right font-semibold ${
                        tx.direction === "REFUND"
                          ? "text-red-600"
                          : "text-slate-800"
                      }`}
                    >
                      {tx.direction === "REFUND" ? "-" : "+"}
                      {formatMoney(tx.amount)}
                    </td>
                    <td className="py-2.5 pr-2">
                      <Badge tone={STATUS_TONE[tx.status] ?? "slate"}>
                        {tx.status}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewing(tx)}
                      >
                        <History size={14} />
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {viewing && (
        <Modal
          title={`Transaction ${viewing.paymentReference ?? viewing.id.slice(0, 8)}`}
          subtitle={`${formatDateTime(viewing.createdAt)} · ${
            PAYMENT_LABEL[viewing.method]
          } · ${DIRECTION_LABEL[viewing.direction]}`}
          onClose={() => setViewing(null)}
          size="lg"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-400">Amount</p>
              <p className="mt-0.5 text-lg font-bold text-slate-900">
                {viewing.direction === "REFUND" ? "-" : "+"}
                {formatMoney(viewing.amount)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-400">Status</p>
              <p className="mt-0.5">
                <Badge tone={STATUS_TONE[viewing.status] ?? "slate"}>
                  {viewing.status}
                </Badge>
              </p>
              {!FINAL_STATUSES.has(viewing.status) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => checkStatus(viewing.id)}
                  disabled={checking}
                >
                  <RefreshCw size={14} className={checking ? "animate-spin" : ""} />
                  Check payment status
                </Button>
              )}
              {pollError && (
                <p className="mt-1.5 text-xs text-red-600">{pollError}</p>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-400">Invoice</p>
              <p className="mt-0.5 font-mono text-sm text-slate-800">
                {invoiceBySaleId.get(viewing.saleId ?? "") ?? "—"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-400">
                Provider reference
              </p>
              <p className="mt-0.5 font-mono text-xs text-slate-800">
                {viewing.providerReference ?? "—"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-400">
                Provider transaction ID
              </p>
              <p className="mt-0.5 font-mono text-xs text-slate-800">
                {viewing.providerTransactionId ?? "—"}
              </p>
            </div>
            {viewing.customerReference && (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-medium text-slate-400">
                  Customer reference
                </p>
                <p className="mt-0.5 font-mono text-xs text-slate-800">
                  {viewing.customerReference}
                </p>
              </div>
            )}
            {viewing.failureReason && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-medium text-amber-700">
                  Failure reason
                </p>
                <p className="mt-0.5 text-sm text-amber-800">
                  {viewing.failureReason}
                </p>
              </div>
            )}
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2">
              <ReceiptText size={15} className="text-slate-400" />
              <p className="text-sm font-semibold text-slate-800">
                Provider event timeline
              </p>
            </div>
            {timeline.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">
                No provider events recorded for this transaction.
              </p>
            ) : (
              <ol className="space-y-2">
                {timeline.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm"
                  >
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-pharma-500" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-700">
                          {e.eventType}
                        </span>
                        <Badge tone={STATUS_TONE[e.status] ?? "slate"}>
                          {e.status}
                        </Badge>
                      </div>
                      <p className="mt-0.5 break-all font-mono text-xs text-slate-500">
                        {e.raw}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {formatDateTime(e.receivedAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2">
              <ShieldCheck size={15} className="text-emerald-500" />
              <p className="text-sm font-semibold text-slate-800">
                Provider confirmations
              </p>
            </div>
            {confirmations.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">
                No provider confirmation recorded. Money is not counted as
                collected until a verified confirmation exists.
              </p>
            ) : (
              <ol className="space-y-2">
                {confirmations.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-lg border border-slate-100 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          c.providerStatus === "SUCCESS"
                            ? "green"
                            : c.providerStatus === "FAILED" ||
                                c.providerStatus === "DECLINED" ||
                                c.providerStatus === "CANCELLED" ||
                                c.providerStatus === "TIMEOUT" ||
                                c.providerStatus === "EXPIRED"
                              ? "red"
                              : "amber"
                        }
                      >
                        {c.providerStatus}
                      </Badge>
                      {c.verified ? (
                        <Badge tone="green">VERIFIED</Badge>
                      ) : (
                        <Badge tone="slate">NOT VERIFIED</Badge>
                      )}
                      {c.confirmationReference && (
                        <span className="font-mono text-xs text-slate-600">
                          {c.confirmationReference}
                        </span>
                      )}
                    </div>
                    {c.providerTransactionId && (
                      <p className="mt-1 font-mono text-xs text-slate-500">
                        Provider txn: {c.providerTransactionId}
                      </p>
                    )}
                    {typeof c.amount === "number" && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        Amount: {formatMoney(c.amount)}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-slate-400">
                      {formatDateTime(c.verifiedAt ?? c.createdAt)}
                      {c.verified
                        ? " · verified"
                        : " · awaiting verification"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
