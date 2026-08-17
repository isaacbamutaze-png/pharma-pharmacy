import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Undo2,
  Search,
  ReceiptText,
  CheckCircle2,
  PackagePlus,
} from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Alert } from "../../components/ui/Alert";
import {
  SelectInput,
  TextInput,
  TextArea,
} from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { formatMoney, formatDateTime } from "../../lib/utils";
import {
  createRefund,
  refundableForItem,
  saleItemSoldBase,
} from "../../lib/refunds";
import { useAuthStore } from "../../store/authStore";
import { PAYMENT_LABEL } from "../../lib/payments/constants";
import type {
  PaymentMethod,
  Refund,
  RefundReason,
  Sale,
} from "../../types";

const REFUND_REASONS: Array<{ value: RefundReason; label: string }> = [
  { value: "CUSTOMER_RETURN", label: "Customer returned item" },
  { value: "WRONG_ITEM", label: "Wrong item dispensed" },
  { value: "DAMAGED", label: "Damaged / defective" },
  { value: "OTHER", label: "Other" },
];

const REFUND_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "MOBILE_MONEY", label: "Mobile Money" },
  { value: "BANK", label: "Bank" },
  { value: "CARD", label: "Card" },
  { value: "OTHER", label: "Other" },
];

export function RefundsPage() {
  const user = useAuthStore((s) => s.user);
  const sales = useLiveQuery(
    () => pharmaDb.sales.orderBy("createdAt").reverse().toArray(),
    [],
  ) ?? [];
  const saleItems = useLiveQuery(() => pharmaDb.saleItems.toArray(), []) ?? [];
  const refunds = useLiveQuery(
    () => pharmaDb.refunds.orderBy("createdAt").reverse().limit(200).toArray(),
    [],
  ) ?? [];
  const refundItems = useLiveQuery(() => pharmaDb.refundItems.toArray(), []) ?? [];
  const settings = useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";

  const [query, setQuery] = useState("");
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<RefundReason>("CUSTOMER_RETURN");
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>("CASH");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [viewingRefund, setViewingRefund] = useState<Refund | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const completed = sales.filter((s) => s.status === "COMPLETED");
    if (!q) return completed.slice(0, 8);
    return completed
      .filter((s) => s.invoiceNumber.toLowerCase().includes(q))
      .slice(0, 12);
  }, [sales, query]);

  const selectedItems = useMemo(
    () =>
      selectedSale
        ? saleItems.filter((i) => i.saleId === selectedSale.id)
        : [],
    [saleItems, selectedSale],
  );

  const alreadyRefundedBase = useMemo(() => {
    const map = new Map<string, number>();
    if (!selectedSale) return map;
    for (const ri of refundItems) {
      if (ri.saleId !== selectedSale.id) continue;
      map.set(ri.saleItemId, (map.get(ri.saleItemId) ?? 0) + ri.baseQuantity);
    }
    return map;
  }, [refundItems, selectedSale]);

  const refundTotal = useMemo(() => {
    let total = 0;
    for (const item of selectedItems) {
      const qty = quantities[item.id] ?? 0;
      if (qty > 0) total += qty * item.unitPrice;
    }
    return Math.round(total * 100) / 100;
  }, [selectedItems, quantities]);

  const todayCount = useMemo(() => {
    const today = new Date().toDateString();
    return refunds.filter(
      (r) => new Date(r.createdAt).toDateString() === today,
    );
  }, [refunds]);

  useEffect(() => {
    setQuantities({});
    setReason("CUSTOMER_RETURN");
    setRefundMethod("CASH");
    setNote("");
    setError("");
    setSuccess("");
  }, [selectedSale?.id]);

  const itemsForRefund = (refundId: string) =>
    refundItems.filter((ri) => ri.refundId === refundId);

  const handleIssue = async () => {
    if (!user || !selectedSale) return;
    const lines = selectedItems
      .map((item) => ({
        saleItemId: item.id,
        quantity: quantities[item.id] ?? 0,
      }))
      .filter((l) => l.quantity > 0);
    if (lines.length === 0) {
      setError("Enter a return quantity for at least one item.");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await createRefund({
        saleId: selectedSale.id,
        lines,
        reason,
        refundMethod,
        note: note || undefined,
        recordedBy: user.id,
        recordedByName: user.fullName,
      });
      setSuccess(
        `Refund of ${formatMoney(refundTotal, currency)} issued for ${selectedSale.invoiceNumber}. Stock was restocked.`,
      );
      setQuantities({});
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to issue refund.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Refunds & Returns"
        subtitle="Verify a receipt, return items, and refund cash, mobile money or bank payment"
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Today's Refunds</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {todayCount.length}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Refunded Today</p>
          <p className="mt-1 text-xl font-bold text-red-600">
            {formatMoney(
              todayCount.reduce((sum, r) => sum + r.amount, 0),
              currency,
            )}
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Returned to Stock</p>
          <p className="mt-1 text-xl font-bold text-green-600">
            {refundItems.reduce((sum, ri) => sum + ri.baseQuantity, 0)}{" "}
            <span className="text-sm font-normal text-slate-400">base units</span>
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card title="Find a sale" subtitle="Search by invoice number to verify the receipt">
            <div className="flex items-end gap-2">
              <TextInput
                label="Invoice number"
                placeholder="e.g. INV-00001"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="lg:max-w-xs"
              />
              <Button variant="secondary">
                <Search size={16} />
                Search
              </Button>
            </div>

            <div className="mt-4 space-y-2">
              {matches.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  No completed sales found.
                </p>
              ) : (
                matches.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelectedSale(s);
                      setQuery("");
                    }}
                    className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                      selectedSale?.id === s.id
                        ? "border-pharma-500 bg-pharma-50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                        <ReceiptText size={15} />
                      </span>
                      <div>
                        <p className="font-mono text-xs font-semibold text-slate-800">
                          {s.invoiceNumber}
                        </p>
                        <p className="text-xs text-slate-400">
                          {formatDateTime(s.saleDate)} ·{" "}
                          {s.customerName || "Walk-in"}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-slate-800">
                      {formatMoney(s.total, currency)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </Card>

          <Card
            title="Refund history"
            subtitle="All refunds and returns issued"
          >
            {refunds.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                No refunds recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {refunds.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-50">
                        <Undo2 size={14} className="text-red-600" />
                      </span>
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {r.invoiceNumber}
                        </p>
                        <p className="text-xs text-slate-400">
                          {formatDateTime(r.createdAt)} ·{" "}
                          {PAYMENT_LABEL[r.refundMethod]} ·{" "}
                          {r.recordedByName || "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone="amber">
                        {formatMoney(r.amount, currency)}
                      </Badge>
                      <button
                        onClick={() => setViewingRefund(r)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-pharma-600"
                        aria-label="View refund details"
                      >
                        <ReceiptText size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div>
          {!selectedSale ? (
            <Card>
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                  <PackagePlus size={22} className="text-slate-400" />
                </span>
                <p className="max-w-sm text-sm text-slate-500">
                  Select a completed sale to return items and issue a refund.
                  Returned stock goes back to the exact batch it was sold from.
                </p>
              </div>
            </Card>
          ) : (
            <Card
              title={`Refund ${selectedSale.invoiceNumber}`}
              subtitle={`${formatDateTime(selectedSale.saleDate)} · ${
                selectedSale.customerName || "Walk-in"
              } · ${PAYMENT_LABEL[selectedSale.paymentMethod]}`}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedSale(null)}
                >
                  Change sale
                </Button>
              }
            >
              {error && (
                <div className="mb-4">
                  <Alert tone="error" onDismiss={() => setError("")}>
                    {error}
                  </Alert>
                </div>
              )}
              {success && (
                <div className="mb-4">
                  <Alert tone="success" onDismiss={() => setSuccess("")}>
                    <span className="flex items-center gap-2">
                      <CheckCircle2 size={16} />
                      {success}
                    </span>
                  </Alert>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-2 font-medium">Item</th>
                      <th className="py-2 pr-2 text-right font-medium">Sold</th>
                      <th className="py-2 pr-2 text-right font-medium">Refundable</th>
                      <th className="py-2 pr-2 text-right font-medium">Unit Price</th>
                      <th className="py-2 pr-2 text-right font-medium">Return Qty</th>
                      <th className="py-2 text-right font-medium">Refund</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedItems.map((item) => {
                      const alreadyBase = alreadyRefundedBase.get(item.id) ?? 0;
                      const maxQty = refundableForItem(item, alreadyBase);
                      const qty = quantities[item.id] ?? 0;
                      return (
                        <tr key={item.id}>
                          <td className="py-3 pr-2">
                            <p className="font-medium text-slate-800">
                              {item.medicineName}
                            </p>
                            <p className="text-xs text-slate-400">
                              {item.unitName || "unit"}
                              {alreadyBase > 0 && (
                                  <span className="ml-1 text-amber-600">
                                    · {saleItemSoldBase(item) - alreadyBase} base left
                                  </span>
                              )}
                            </p>
                          </td>
                          <td className="py-3 pr-2 text-right text-slate-600">
                            {item.quantity}
                          </td>
                          <td className="py-3 pr-2 text-right text-slate-600">
                            {maxQty}
                          </td>
                          <td className="py-3 pr-2 text-right text-slate-700">
                            {formatMoney(item.unitPrice, currency)}
                          </td>
                          <td className="py-3 pr-2 text-right">
                            <input
                              type="number"
                              min={0}
                              max={maxQty}
                              step={0.01}
                              value={qty === 0 ? "" : qty}
                              onChange={(e) => {
                                const parsed = parseFloat(e.target.value);
                                const value = Number.isFinite(parsed)
                                  ? Math.min(Math.max(0, parsed), maxQty)
                                  : 0;
                                setQuantities((prev) => ({
                                  ...prev,
                                  [item.id]: value,
                                }));
                              }}
                              disabled={maxQty <= 0}
                              className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm focus:border-pharma-500 focus:outline-none focus:ring-1 focus:ring-pharma-500 disabled:bg-slate-100"
                            />
                          </td>
                          <td className="py-3 text-right font-semibold text-slate-800">
                            {formatMoney(qty * item.unitPrice, currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200">
                      <td className="py-3 font-semibold text-slate-900" colSpan={5}>
                        Refund total
                      </td>
                      <td className="py-3 text-right text-base font-bold text-red-600">
                        {formatMoney(refundTotal, currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SelectInput
                  label="Reason for return"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as RefundReason)}
                >
                  {REFUND_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </SelectInput>
                <SelectInput
                  label="Refund method"
                  value={refundMethod}
                  onChange={(e) =>
                    setRefundMethod(e.target.value as PaymentMethod)
                  }
                >
                  {REFUND_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </SelectInput>
              </div>
              <div className="mt-3">
                <TextArea
                  label="Note"
                  placeholder="Optional note about this return"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  Returned stock is restored to the batch it was sold from and
                  recorded in the audit log.
                </p>
                <Button
                  variant="danger"
                  disabled={refundTotal <= 0 || submitting}
                  onClick={handleIssue}
                >
                  <Undo2 size={16} />
                  {submitting ? "Issuing..." : "Issue Refund"}
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      {viewingRefund && (
        <Modal
          title={`Refund ${viewingRefund.invoiceNumber}`}
          subtitle={`${formatDateTime(viewingRefund.createdAt)} · ${
            PAYMENT_LABEL[viewingRefund.refundMethod]
          } · ${viewingRefund.recordedByName || "—"}`}
          onClose={() => setViewingRefund(null)}
          size="lg"
        >
          <div className="mb-4 flex items-center justify-between rounded-lg bg-red-50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-red-800">
                {viewingRefund.amount
                  ? formatMoney(viewingRefund.amount, currency)
                  : ""}{" "}
                refunded
              </p>
              <p className="text-xs text-red-700">
                {REFUND_REASONS.find((r) => r.value === viewingRefund.reason)
                  ?.label ?? viewingRefund.reason}
              </p>
            </div>
            <Badge tone="red">
              {formatMoney(viewingRefund.amount, currency)}
            </Badge>
          </div>
          {viewingRefund.note && (
            <p className="mb-3 text-sm text-slate-600">
              Note: {viewingRefund.note}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2 pr-2 font-medium">Item</th>
                  <th className="py-2 pr-2 text-right font-medium">Qty</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itemsForRefund(viewingRefund.id).map((ri) => (
                  <tr key={ri.id}>
                    <td className="py-2 pr-2 text-slate-800">
                      {ri.medicineName}
                    </td>
                    <td className="py-2 pr-2 text-right text-slate-600">
                      {ri.quantity} {ri.unitName || "unit"}
                    </td>
                    <td className="py-2 text-right font-medium text-slate-800">
                      {formatMoney(ri.lineTotal, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => setViewingRefund(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
