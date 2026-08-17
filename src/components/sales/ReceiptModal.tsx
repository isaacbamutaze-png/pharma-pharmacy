import { useLiveQuery } from "dexie-react-hooks";
import { Printer, FileText } from "lucide-react";
import { pharmaDb } from "../../db";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { formatMoney, formatDateTime, formatDate } from "../../lib/utils";
import { PAYMENT_LABEL } from "../../lib/payments/constants";
import type { Sale, SystemSetting, PaymentStatus } from "../../types";

function paymentTone(status: PaymentStatus): "green" | "red" | "amber" | "slate" | "blue" {
  if (status === "SUCCESS") return "green";
  if (status === "PROCESSING") return "blue";
  if (status === "PENDING") return "amber";
  if (
    status === "FAILED" ||
    status === "DECLINED" ||
    status === "CANCELLED" ||
    status === "TIMEOUT" ||
    status === "EXPIRED" ||
    status === "REFUNDED"
  )
    return "red";
  return "slate";
}

interface ReceiptModalProps {
  sale: Sale;
  settings: SystemSetting[];
  onClose: () => void;
}

function settingValue(settings: SystemSetting[], key: string, fallback = ""): string {
  return settings.find((s) => s.settingKey === key)?.settingValue ?? fallback;
}

export function ReceiptModal({ sale, settings, onClose }: ReceiptModalProps) {
  const items = useLiveQuery(
    () => pharmaDb.saleItems.where("saleId").equals(sale.id).toArray(),
    [sale.id],
  );

  const payments = useLiveQuery(
    () => pharmaDb.payments.where("saleId").equals(sale.id).toArray(),
    [sale.id],
  );
  const collectedPayments = (payments ?? []).filter((p) => p.amount > 0);

  const batches = useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []);

  const refunds = useLiveQuery(
    () => pharmaDb.refunds.where("saleId").equals(sale.id).toArray(),
    [sale.id],
  );

  const batchById = new Map((batches ?? []).map((b) => [b.id, b]));

  const currency = settingValue(settings, "currency", "UGX");
  const pharmacyName = settingValue(settings, "pharmacy_name", "My Pharmacy");
  const address = settingValue(settings, "pharmacy_address");
  const phone = settingValue(settings, "pharmacy_phone");
  const footer = settingValue(
    settings,
    "receipt_footer",
    "Thank you for your purchase.",
  );

  return (
    <Modal
      title="Receipt"
      subtitle={sale.invoiceNumber}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => window.print()}>
            <Printer size={16} />
            Print
          </Button>
        </>
      }
    >
      <div className="print-area rounded-lg border border-slate-200 p-5 text-sm">
        {sale.status === "VOIDED" && (
          <div className="mb-3 flex justify-center">
            <Badge tone="red">VOIDED</Badge>
          </div>
        )}
        {sale.status === "PENDING_PAYMENT" && (
          <div className="mb-3 flex justify-center">
            <Badge tone="amber">PENDING PAYMENT</Badge>
          </div>
        )}
        <div className="border-b border-dashed border-slate-300 pb-3 text-center">
          <p className="text-lg font-bold text-slate-900">{pharmacyName}</p>
          {address && <p className="text-xs text-slate-500">{address}</p>}
          {phone && <p className="text-xs text-slate-500">Tel: {phone}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
          <div>
            <p className="font-medium text-slate-700">Invoice: {sale.invoiceNumber}</p>
            <p className="text-slate-500">{formatDateTime(sale.saleDate)}</p>
          </div>
          <div className="text-right">
            {sale.cashierName && (
              <p className="text-slate-500">Cashier: {sale.cashierName}</p>
            )}
            {sale.customerName && (
              <p className="text-slate-500">Customer: {sale.customerName}</p>
            )}
            {sale.customerPhone && (
              <p className="text-slate-500">Phone: {sale.customerPhone}</p>
            )}
          </div>
        </div>

        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-y border-slate-200 text-slate-500 uppercase">
              <th className="py-1.5 pr-2 font-medium">Item</th>
              <th className="py-1.5 pr-2 text-center font-medium">Qty</th>
              <th className="py-1.5 pr-2 text-right font-medium">Price</th>
              <th className="py-1.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(items ?? []).map((item) => (
              <tr key={item.id}>
                <td className="py-1.5 pr-2 text-slate-800">{item.medicineName}</td>
                <td className="py-1.5 pr-2 text-center text-slate-600">
                  {item.quantity}
                  {item.unitName ? ` × ${item.unitName}` : ""}
                </td>
                <td className="py-1.5 pr-2 text-right text-slate-600">
                  {formatMoney(item.unitPrice, currency)}
                </td>
                <td className="py-1.5 text-right font-medium text-slate-800">
                  {formatMoney(item.lineTotal, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 space-y-1 border-t border-dashed border-slate-300 pt-3 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>{formatMoney(sale.subtotal, currency)}</span>
          </div>
          {sale.discount > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Discount</span>
              <span>-{formatMoney(sale.discount, currency)}</span>
            </div>
          )}
          {sale.tax > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Tax ({sale.taxRate}%)</span>
              <span>{formatMoney(sale.tax, currency)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold text-slate-900">
            <span>Total</span>
            <span>{formatMoney(sale.total, currency)}</span>
          </div>
          {collectedPayments.length > 0 && (
            <div className="space-y-0.5">
              {collectedPayments.map((p) => (
                <div key={p.id} className="flex justify-between text-slate-600">
                  <span>
                    {PAYMENT_LABEL[p.method]}
                    {p.paymentReference ? ` · ${p.paymentReference}` : ""}
                    {p.providerReference
                      ? ` · ${p.provider} ${p.providerReference}`
                      : ""}
                  </span>
                  <span>{formatMoney(p.amount, currency)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between text-slate-600">
            <span>Paid ({sale.paymentMethod})</span>
            <span>{formatMoney(sale.amountPaid, currency)}</span>
          </div>
          {sale.balanceDue > 0 ? (
            <div className="flex justify-between font-medium text-amber-600">
              <span>Balance Due</span>
              <span>{formatMoney(sale.balanceDue, currency)}</span>
            </div>
          ) : (
            <div className="flex justify-between text-slate-600">
              <span>Change</span>
              <span>{formatMoney(sale.changeDue, currency)}</span>
            </div>
          )}
        </div>

        {footer && (
          <p className="mt-4 border-t border-dashed border-slate-300 pt-3 text-center text-xs text-slate-500">
            {footer}
          </p>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-slate-200">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <FileText size={16} className="text-slate-400" />
          <p className="text-sm font-semibold text-slate-800">
            Invoice details
          </p>
          <span className="text-xs text-slate-400">
            (staff-only, not printed)
          </span>
        </div>

        <div className="divide-y divide-slate-100 px-4 py-2 text-sm">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 py-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-slate-400">Sale ID</p>
              <p className="font-mono text-xs text-slate-700">{sale.id}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Invoice</p>
              <p className="text-slate-700">{sale.invoiceNumber}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Sale date</p>
              <p className="text-slate-700">{formatDateTime(sale.saleDate)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Created</p>
              <p className="text-slate-700">{formatDateTime(sale.createdAt)}</p>
            </div>
            {sale.completedAt && (
              <div>
                <p className="text-xs text-slate-400">Completed</p>
                <p className="text-slate-700">
                  {formatDateTime(sale.completedAt)}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-slate-400">Cashier</p>
              <p className="text-slate-700">
                {sale.cashierName || sale.cashierId || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Status</p>
              <p className="text-slate-700">{sale.status}</p>
            </div>
            {sale.paymentStatus && (
              <div>
                <p className="text-xs text-slate-400">Payment status</p>
                <p className="text-slate-700">{sale.paymentStatus}</p>
              </div>
            )}
            {sale.receiptStatus && (
              <div>
                <p className="text-xs text-slate-400">Receipt status</p>
                <p className="text-slate-700">{sale.receiptStatus}</p>
              </div>
            )}
            {sale.stockStatus && (
              <div>
                <p className="text-xs text-slate-400">Stock status</p>
                <p className="text-slate-700">{sale.stockStatus}</p>
              </div>
            )}
            {sale.customerId && (
              <div>
                <p className="text-xs text-slate-400">Customer ID</p>
                <p className="font-mono text-xs text-slate-700">
                  {sale.customerId}
                </p>
              </div>
            )}
          </div>

          <div className="py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Items ({items?.length ?? 0})
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-400 uppercase">
                    <th className="py-1 pr-2 font-medium">Item</th>
                    <th className="py-1 pr-2 text-center font-medium">Qty</th>
                    <th className="py-1 pr-2 text-right font-medium">Unit</th>
                    <th className="py-1 pr-2 text-right font-medium">Line</th>
                    <th className="py-1 pr-2 text-right font-medium">Cost</th>
                    <th className="py-1 text-right font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(items ?? []).map((item) => {
                    const usedBatches = (item.batches ?? [])
                      .map((ib) => batchById.get(ib.batchId))
                      .filter((b): b is NonNullable<typeof b> => Boolean(b));
                    const lineCost = (item.costPrice ?? 0) * item.quantity;
                    const profit = item.lineTotal - lineCost;
                    return (
                      <tr key={item.id}>
                        <td className="py-1.5 pr-2">
                          <p className="font-medium text-slate-800">
                            {item.medicineName}
                          </p>
                          {usedBatches.length > 0 && (
                            <p className="text-[11px] text-slate-400">
                              {usedBatches
                                .map(
                                  (b) =>
                                    `${b.batchNumber}${b.expiryDate ? ` (exp ${formatDate(new Date(b.expiryDate).getTime())})` : ""}`,
                                )
                                .join(", ")}
                            </p>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-center text-slate-600">
                          {item.quantity}
                          {item.unitName ? ` ${item.unitName}` : ""}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-slate-600">
                          {formatMoney(item.unitPrice, currency)}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-medium text-slate-800">
                          {formatMoney(item.lineTotal, currency)}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-slate-500">
                          {formatMoney(lineCost, currency)}
                        </td>
                        <td
                          className={`py-1.5 text-right font-medium ${profit >= 0 ? "text-pharma-700" : "text-red-600"}`}
                        >
                          {formatMoney(profit, currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Payments ({payments?.length ?? 0})
            </p>
            {(payments ?? []).length === 0 ? (
              <p className="text-xs text-slate-500">No payment records.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-400 uppercase">
                      <th className="py-1 pr-2 font-medium">Method</th>
                      <th className="py-1 pr-2 text-right font-medium">Amount</th>
                      <th className="py-1 pr-2 font-medium">Status</th>
                      <th className="py-1 pr-2 font-medium">Provider</th>
                      <th className="py-1 pr-2 font-medium">References</th>
                      <th className="py-1 pr-2 font-medium">Initiated</th>
                      <th className="py-1 text-right font-medium">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(payments ?? []).map((p) => (
                      <tr key={p.id}>
                        <td className="py-1.5 pr-2 text-slate-700">
                          {PAYMENT_LABEL[p.method]}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-medium text-slate-800">
                          {formatMoney(p.amount, p.currency || currency)}
                        </td>
                        <td className="py-1.5 pr-2">
                          <Badge tone={paymentTone(p.status)}>
                            {p.status}
                          </Badge>
                        </td>
                        <td className="py-1.5 pr-2 text-slate-600">
                          {p.provider || "—"}
                        </td>
                        <td className="py-1.5 pr-2 text-slate-600">
                          <div className="space-y-0.5">
                            {p.paymentReference && (
                              <p className="font-mono text-[11px]">
                                ref {p.paymentReference}
                              </p>
                            )}
                            {p.providerReference && (
                              <p className="font-mono text-[11px]">
                                prov {p.providerReference}
                              </p>
                            )}
                            {p.transactionId && (
                              <p className="font-mono text-[11px]">
                                tx {p.transactionId}
                              </p>
                            )}
                            {p.confirmationId && (
                              <p className="font-mono text-[11px]">
                                conf {p.confirmationId}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="py-1.5 pr-2 text-slate-600">
                          <p>{formatDateTime(p.initiatedAt)}</p>
                          {p.completedAt && (
                            <p className="text-[11px] text-slate-400">
                              done {formatDateTime(p.completedAt)}
                            </p>
                          )}
                        </td>
                        <td className="py-1.5 text-right text-slate-600">
                          {p.recordedBy || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {(refunds ?? []).length > 0 && (
            <div className="py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Refunds ({refunds?.length ?? 0})
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-400 uppercase">
                      <th className="py-1 pr-2 font-medium">Amount</th>
                      <th className="py-1 pr-2 font-medium">Method</th>
                      <th className="py-1 pr-2 font-medium">Reason</th>
                      <th className="py-1 pr-2 font-medium">Note</th>
                      <th className="py-1 pr-2 font-medium">When</th>
                      <th className="py-1 text-right font-medium">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(refunds ?? []).map((r) => (
                      <tr key={r.id}>
                        <td className="py-1.5 pr-2 font-medium text-red-600">
                          -{formatMoney(r.amount, currency)}
                        </td>
                        <td className="py-1.5 pr-2 text-slate-700">
                          {PAYMENT_LABEL[r.refundMethod]}
                        </td>
                        <td className="py-1.5 pr-2 text-slate-600">{r.reason}</td>
                        <td className="py-1.5 pr-2 text-slate-600">{r.note || "—"}</td>
                        <td className="py-1.5 pr-2 text-slate-600">
                          {formatDateTime(r.createdAt)}
                        </td>
                        <td className="py-1.5 text-right text-slate-600">
                          {r.recordedByName || r.recordedBy || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {sale.note && (
            <div className="py-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Note
              </p>
              <p className="text-slate-700">{sale.note}</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
