import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import {
  Send,
  Sparkles,
  Trash2,
  RefreshCw,
  ShoppingCart,
  User as UserIcon,
} from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { PageHeader } from "../../components/ui/PageHeader";
import {
  loadAssistantContext,
  loadAssistantSettings,
  askAssistant,
  buildBriefing,
  SUGGESTED_QUESTIONS,
  type BriefingCard,
} from "../../lib/assistant";
import { createPurchaseOrder } from "../../lib/procurement";
import { useEnabledModules } from "../../lib/modules";
import { useAuthStore } from "../../store/authStore";
import { formatMoney, formatDate, uid, now } from "../../lib/utils";
import type {
  AnomalyItem,
  AssistantMessage,
  AssistantPayload,
  AttentionSection,
  ExpiryRiskItem,
  FinanceAnalysis,
  ForecastOutcome,
  ManagementReport,
  MedicineKnowledgeProfile,
  PatientSummary,
  PaymentIntelligence,
  ReorderSuggestion,
  SafetyIntelligence,
} from "../../types";

function MessageBody({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed === "") return <div key={i} className="h-2" />;
        if (trimmed.startsWith("•") || trimmed.startsWith("-")) {
          const content = trimmed.replace(/^[•-]\s*/, "");
          return (
            <p key={i} className="flex gap-1.5 text-sm leading-relaxed text-slate-700">
              <span className="text-slate-400">•</span>
              <span>{content}</span>
            </p>
          );
        }
        return (
          <p
            key={i}
            className={`text-sm leading-relaxed ${
              i === 0
                ? "font-semibold text-slate-900"
                : "text-slate-700"
            }`}
          >
            {line}
          </p>
        );
      })}
    </div>
  );
}

function AttentionSectionView({ s }: { s: AttentionSection }) {
  const config = {
    URGENT: { badge: "red" as const, label: "Urgent", border: "border-red-200 bg-red-50/50" },
    ATTENTION: { badge: "amber" as const, label: "Attention", border: "border-amber-200 bg-amber-50/50" },
    BUSINESS: { badge: "blue" as const, label: "Business", border: "border-blue-200 bg-blue-50/50" },
    GOOD: { badge: "green" as const, label: "Good", border: "border-pharma-200 bg-pharma-50/50" },
  }[s.severity];
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${config.border}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold text-slate-900">{s.title}</p>
        <Badge tone={config.badge}>{config.label}</Badge>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.detail}</p>
    </div>
  );
}

function ReorderSuggestionCard({
  r,
  currency,
  creating,
  onCreatePO,
}: {
  r: ReorderSuggestion;
  currency: string;
  creating: boolean;
  onCreatePO: () => void;
}) {
  return (
    <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{r.medicineName}</p>
        {r.currentStock === 0 ? (
          <Badge tone="red">Out of stock</Badge>
        ) : r.daysToOut !== null && r.daysToOut <= 7 ? (
          <Badge tone="red">~{r.daysToOut}d left</Badge>
        ) : r.daysToOut !== null ? (
          <Badge tone="amber">~{r.daysToOut}d left</Badge>
        ) : (
          <Badge tone="slate">No recent sales</Badge>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
        <div>
          <dt className="text-slate-400">In stock</dt>
          <dd className="font-medium text-slate-800">{r.currentStock}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Daily usage</dt>
          <dd className="font-medium text-slate-800">{r.dailyUsage.toFixed(1)}/day</dd>
        </div>
        <div>
          <dt className="text-slate-400">Suggested order</dt>
          <dd className="font-medium text-slate-800">{r.recommendedQty}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Supplier</dt>
          <dd className="font-medium text-slate-800">{r.supplierName ?? "—"}</dd>
        </div>
      </dl>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          {r.lastUnitCost != null
            ? `Est. cost ${formatMoney(r.lastUnitCost * r.recommendedQty, currency)} at ${formatMoney(r.lastUnitCost, currency)}/unit`
            : "No recent unit cost on record."}
        </p>
        <Button
          size="sm"
          variant={r.supplierId ? "primary" : "secondary"}
          disabled={creating || !r.supplierId}
          onClick={onCreatePO}
        >
          <ShoppingCart size={13} />
          {creating ? "Creating…" : "Create PO"}
        </Button>
      </div>
      {!r.supplierId && (
        <p className="mt-1.5 text-[11px] text-slate-400">
          No supplier linked to this medicine yet — add one on the batch or supplier record first.
        </p>
      )}
    </div>
  );
}

function ExpiryRiskCard({ item, currency }: { item: ExpiryRiskItem; currency: string }) {
  const config = {
    SEVERE: { badge: "red" as const, label: "High risk" },
    WATCH: { badge: "amber" as const, label: "Watch" },
    HEALTHY: { badge: "green" as const, label: "Healthy" },
  }[item.severity];
  return (
    <div className="rounded-lg border border-orange-100 bg-orange-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">
          {item.medicineName}
          <span className="ml-2 font-normal text-slate-500">
            batch {item.batchNumber}
          </span>
        </p>
        <Badge tone={config.badge}>{config.label}</Badge>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
        <div>
          <dt className="text-slate-400">Units</dt>
          <dd className="font-medium text-slate-800">{item.quantity}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Expires</dt>
          <dd className="font-medium text-slate-800">
            {item.days}d ({item.expiryDate})
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Sells/day</dt>
          <dd className="font-medium text-slate-800">
            {item.dailyUsage.toFixed(1)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Likely unsold</dt>
          <dd className="font-medium text-slate-800">
            {item.atRisk ? `~${item.likelyLeftover}` : "0"}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-slate-600">
        At current sales, this batch would sell about {item.sellThrough} unit(s)
        before expiry
        {item.atRisk
          ? ` — up to ${formatMoney(item.costAtRisk, currency)} could go to waste`
          : " — expected to clear in time"}.
      </p>
      {item.suggestedActions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.suggestedActions.map((a) => (
            <span
              key={a}
              className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200"
            >
              {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ForecastCard({ f, currency }: { f: ForecastOutcome; currency: string }) {
  return (
    <div className="rounded-lg border border-sky-100 bg-sky-50/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">
          Demand forecast (next {f.horizonDays} days)
        </p>
        <Badge tone="blue">{formatMoney(f.predictedRevenue30, currency)} projected</Badge>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{f.method}</p>
      <div className="mt-2 space-y-1.5">
        {f.items.slice(0, 6).map((i) => (
          <div
            key={i.medicineId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/70 px-2.5 py-1.5 ring-1 ring-inset ring-slate-100"
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-slate-800">
                {i.medicineName}
              </span>
              <Badge
                tone={
                  i.trend === "RISING"
                    ? "green"
                    : i.trend === "FALLING"
                      ? "red"
                      : "slate"
                }
              >
                {i.trend}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span>{i.unitsLast30}u/30d</span>
              <span>predict {i.predicted30}u</span>
              <span className="font-medium text-slate-700">{i.currentStock} in stock</span>
              {i.stockoutRisk && (
                <Badge tone="red">
                  {i.daysToStockout !== null ? `~${i.daysToStockout}d left` : "stockout risk"}
                </Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinanceView({ a, currency }: { a: FinanceAnalysis; currency: string }) {
  const m = (v: number) => formatMoney(v, currency);
  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
      <p className="text-sm font-semibold text-slate-900">
        Financial analysis — {a.month}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
        <div>
          <dt className="text-slate-400">Revenue</dt>
          <dd className="font-medium text-slate-800">{m(a.monthRevenue)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Gross profit</dt>
          <dd className="font-medium text-slate-800">{m(a.grossProfit)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Expenses</dt>
          <dd className="font-medium text-slate-800">{m(a.expenses)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Net</dt>
          <dd className="font-medium text-slate-800">{m(a.netProfit)}</dd>
        </div>
      </dl>
      <div className="mt-2 space-y-1.5">
        {a.explanation.map((line) => (
          <p key={line} className="text-xs leading-relaxed text-slate-600">
            • {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function KnowledgeCard({ p, currency }: { p: MedicineKnowledgeProfile; currency: string }) {
  const m = (v: number) => formatMoney(v, currency);
  return (
    <div className="rounded-lg border border-teal-100 bg-teal-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">
          {p.name}
          {p.strength && (
            <span className="ml-2 font-normal text-slate-500">{p.strength}</span>
          )}
        </p>
        <div className="flex gap-1.5">
          {p.controlCategory === "CDR" && <Badge tone="red">CDR</Badge>}
          {p.prescriptionRequired && <Badge tone="amber">Rx required</Badge>}
        </div>
      </div>
      {p.genericName && (
        <p className="mt-0.5 text-xs text-slate-500">
          {p.genericName}
          {p.therapeuticCategory ? ` · ${p.therapeuticCategory}` : ""}
        </p>
      )}
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
        <div>
          <dt className="text-slate-400">Selling price</dt>
          <dd className="font-medium text-slate-800">{m(p.sellingPrice)}/unit</dd>
        </div>
        <div>
          <dt className="text-slate-400">Stock</dt>
          <dd className="font-medium text-slate-800">
            {p.stockTotal} across {p.stockBatches} batch(es)
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Value (cost)</dt>
          <dd className="font-medium text-slate-800">{m(p.stockValueCost)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Barcodes</dt>
          <dd className="font-medium text-slate-800">
            {p.barcodes.length ? p.barcodes.join(", ") : "—"}
          </dd>
        </div>
      </dl>
      {p.interactions.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Interactions on file
          </p>
          {p.interactions.map((i) => (
            <div key={i.otherMedicineName} className="flex items-start gap-2 text-xs">
              <Badge
                tone={
                  i.severity === "CONTRAINDICATED"
                    ? "red"
                    : i.severity === "MAJOR"
                      ? "red"
                      : i.severity === "MODERATE"
                        ? "amber"
                        : "slate"
                }
              >
                {i.severity}
              </Badge>
              <span className="text-slate-600">
                {i.otherMedicineName} — {i.detail}
              </span>
            </div>
          ))}
        </div>
      )}
      {p.warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Safety warnings
          </p>
          {p.warnings.map((w, idx) => (
            <p key={idx} className="text-xs text-slate-600">
              • {w.type}: {w.message}
            </p>
          ))}
        </div>
      )}
      {p.suppliers.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Suppliers:{" "}
          {p.suppliers
            .map((s) => `${s.name}${s.lastUnitCost != null ? ` (${m(s.lastUnitCost)}/unit)` : ""}`)
            .join(", ")}
        </p>
      )}
      <p className="mt-2 text-[11px] italic text-slate-400">{p.source}</p>
    </div>
  );
}

function AnomalyCard({ item }: { item: AnomalyItem }) {
  const config = {
    HIGH: { badge: "red" as const },
    MEDIUM: { badge: "amber" as const },
    LOW: { badge: "slate" as const },
  }[item.severity];
  return (
    <div className="rounded-lg border border-rose-100 bg-rose-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-slate-900">{item.title}</p>
        <div className="flex items-center gap-1.5">
          <Badge tone="slate">{item.category}</Badge>
          <Badge tone={config.badge}>{item.severity}</Badge>
        </div>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.detail}</p>
      <p className="mt-1.5 text-xs text-slate-500">→ {item.recommendation}</p>
    </div>
  );
}

function ReportView({ r }: { r: ManagementReport }) {
  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
      <p className="text-sm font-semibold text-slate-900">
        Monthly management report — {r.period}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{r.highlight}</p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {r.sections.map((s) => (
          <div key={s.title} className="rounded-md bg-white/70 p-2.5 ring-1 ring-inset ring-slate-100">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {s.title}
            </p>
            <dl className="mt-1 space-y-0.5">
              {s.rows.map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-2 text-xs">
                  <dt className="text-slate-500">{row.label}</dt>
                  <dd
                    className={`font-medium ${
                      row.tone === "bad"
                        ? "text-red-600"
                        : row.tone === "good"
                          ? "text-emerald-600"
                          : "text-slate-800"
                    }`}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaymentIntelView({ p, currency }: { p: PaymentIntelligence; currency: string }) {
  const m = (v: number) => formatMoney(v, currency);
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3">
      <p className="text-sm font-semibold text-slate-900">Payment intelligence</p>
      {p.pendingSales.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Awaiting confirmation ({m(p.pendingTotal)})
          </p>
          {p.pendingSales.slice(0, 5).map((s) => (
            <p key={s.saleId} className="text-xs text-slate-600">
              • {s.invoiceNumber} — {m(s.total)} ({s.method})
              {s.customerName ? ` · ${s.customerName}` : ""}
            </p>
          ))}
        </div>
      )}
      {p.failedRecent.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Failed / declined (30d)
          </p>
          {p.failedRecent.slice(0, 4).map((t, idx) => (
            <p key={idx} className="text-xs text-slate-600">
              • {m(t.amount)} — {t.status}
              {t.provider ? ` (${t.provider})` : ""}
              {t.reason ? `: ${t.reason}` : ""}
            </p>
          ))}
        </div>
      )}
      {p.unmatched.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Unmatched / no provider confirmation
          </p>
          {p.unmatched.slice(0, 4).map((t, idx) => (
            <p key={idx} className="text-xs text-slate-600">
              • {m(t.amount)} — {t.method}
              {t.provider ? ` (${t.provider})` : ""}
            </p>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Refunds (30d): {p.refunds30Count} · {m(p.refunds30Total)}
      </p>
      <div className="mt-1.5 space-y-0.5">
        {p.notes.map((n) => (
          <p key={n} className="text-[11px] text-slate-500">
            • {n}
          </p>
        ))}
      </div>
    </div>
  );
}

function SafetyIntelView({ s }: { s: SafetyIntelligence }) {
  return (
    <div className="rounded-lg border border-fuchsia-100 bg-fuchsia-50/40 p-3">
      <p className="text-sm font-semibold text-slate-900">Drug safety overview</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
        <div>
          <dt className="text-slate-400">Checks</dt>
          <dd className="font-medium text-slate-800">{s.checksTotal}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Warnings</dt>
          <dd className="font-medium text-slate-800">{s.warns}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Overrides</dt>
          <dd className="font-medium text-slate-800">{s.overrides}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Patients w/ allergies</dt>
          <dd className="font-medium text-slate-800">{s.allergyPatients}</dd>
        </div>
      </dl>
      <div className="mt-2 space-y-1">
        {s.openConcerns.map((c) => (
          <div key={c.title} className="rounded-md bg-white/70 px-2.5 py-1.5 ring-1 ring-inset ring-slate-100">
            <p className="text-xs font-semibold text-slate-700">{c.title}</p>
            <p className="text-[11px] text-slate-500">{c.detail}</p>
          </div>
        ))}
      </div>
      {s.overridesRecent.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">
          Recent overrides:{" "}
          {s.overridesRecent.map((o) => `${o.checkType} (${formatDate(o.at)})`).join(", ")}
        </p>
      )}
    </div>
  );
}

function PatientSummaryCard({ s, currency }: { s: PatientSummary; currency: string }) {
  const m = (v: number) => formatMoney(v, currency);
  return (
    <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{s.name}</p>
        <div className="flex gap-1.5">
          <Badge tone="slate">{s.age != null ? `Age ${s.age}` : "Age —"}</Badge>
          <Badge tone="blue">{s.status}</Badge>
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
        <div>
          <dt className="text-slate-400">Allergies</dt>
          <dd className="font-medium text-slate-800">
            {s.allergies.length ? s.allergies.map((a) => a.allergen).join(", ") : "None"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Conditions</dt>
          <dd className="font-medium text-slate-800">
            {s.conditions.length ? s.conditions.join(", ") : "None"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Prescriptions</dt>
          <dd className="font-medium text-slate-800">
            {s.rxTotal} ({s.rxPending} pending)
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Balance</dt>
          <dd className="font-medium text-slate-800">{m(s.balanceDue)}</dd>
        </div>
      </dl>
      {s.rxRecent.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Recent prescriptions
          </p>
          {s.rxRecent.map((rx) => (
            <p key={rx.prescriptionNumber} className="text-xs text-slate-600">
              • {rx.prescriptionNumber} ({formatDate(rx.date)}) — {rx.items.join(", ") || "no items"}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function PayloadSections({
  payload,
  creatingId,
  onCreatePO,
}: {
  payload?: AssistantPayload;
  creatingId: string | null;
  onCreatePO: (r: ReorderSuggestion) => void;
}) {
  const currency = payload?.currency ?? "UGX";
  if (!payload) return null;
  return (
    <>
      {payload.attention && payload.attention.length > 0 && (
        <div className="mt-3 space-y-2">
          {payload.attention.map((s, i) => (
            <AttentionSectionView key={`${s.severity}-${i}`} s={s} />
          ))}
        </div>
      )}
      {payload.reorders && payload.reorders.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-500">
            Reorder recommendations
          </p>
          {payload.reorders.map((r) => (
            <ReorderSuggestionCard
              key={r.medicineId}
              r={r}
              currency={currency}
              creating={creatingId === r.medicineId}
              onCreatePO={() => onCreatePO(r)}
            />
          ))}
        </div>
      )}
      {payload.expiry && payload.expiry.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-orange-500">
            Expiry intelligence
          </p>
          {payload.expiry.map((item) => (
            <ExpiryRiskCard key={item.batchId} item={item} currency={currency} />
          ))}
        </div>
      )}
      {payload.forecast && (
        <div className="mt-3">
          <ForecastCard f={payload.forecast} currency={currency} />
        </div>
      )}
      {payload.finance && (
        <div className="mt-3">
          <FinanceView a={payload.finance} currency={currency} />
        </div>
      )}
      {payload.knowledge && (
        <div className="mt-3">
          <KnowledgeCard p={payload.knowledge} currency={currency} />
        </div>
      )}
      {payload.anomalies && payload.anomalies.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-500">
            Anomaly scan
          </p>
          {payload.anomalies.map((item, i) => (
            <AnomalyCard key={`${item.category}-${i}`} item={item} />
          ))}
        </div>
      )}
      {payload.report && (
        <div className="mt-3">
          <ReportView r={payload.report} />
        </div>
      )}
      {payload.payments && (
        <div className="mt-3">
          <PaymentIntelView p={payload.payments} currency={currency} />
        </div>
      )}
      {payload.safety && (
        <div className="mt-3">
          <SafetyIntelView s={payload.safety} />
        </div>
      )}
      {payload.patients && payload.patients.length > 0 && (
        <div className="mt-3 space-y-2">
          {payload.patients.map((s) => (
            <PatientSummaryCard key={s.patientId} s={s} currency={currency} />
          ))}
        </div>
      )}
    </>
  );
}

function MessageBubble({
  m,
  creatingId,
  onCreatePO,
}: {
  m: AssistantMessage;
  creatingId: string | null;
  onCreatePO: (r: ReorderSuggestion) => void;
}) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] items-start gap-2">
          <div className="rounded-2xl rounded-br-sm bg-pharma-600 px-4 py-2.5 text-sm text-white">
            {m.text}
          </div>
          <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500">
            <UserIcon size={14} />
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
        <Sparkles size={14} />
      </span>
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-2.5">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-violet-700">
            Assistant
          </span>
          {m.source && (
            <Badge tone={m.source === "LLM" ? "blue" : "slate"}>
              {m.source === "LLM" ? "Online · LLM" : "Offline engine"}
            </Badge>
          )}
        </div>
        <MessageBody text={m.text} />
        <PayloadSections
          payload={m.payload}
          creatingId={creatingId}
          onCreatePO={onCreatePO}
        />
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 pl-9">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
          style={{ animationDelay: "300ms" }}
        />
      </div>
      <span className="text-xs text-slate-400">Thinking...</span>
    </div>
  );
}

function WelcomeHint({
  online,
  llmConfigured,
  model,
}: {
  online: boolean;
  llmConfigured: boolean;
  model: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Sparkles size={16} className="text-violet-500" />
        Ask me about your pharmacy
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
        I read your live data and answer in plain language across the whole
        business — revenue, top sellers, stock and reorder recommendations,
        expiries, demand forecasting, financial analysis, medicine knowledge,
        patients, drug safety, payments, anomaly detection and management
        reports. Ask "what needs my attention today?" for a prioritized
        briefing.
      </p>
      <div className="mt-2.5">
        <Badge tone={online && llmConfigured ? "green" : "slate"}>
          {online && llmConfigured
            ? `Online LLM${model ? ` · ${model}` : ""}`
            : "Offline engine (no API key or offline)"}
        </Badge>
        {llmConfigured && !online && (
          <span className="ml-2 text-xs text-slate-500">
            Online mode is configured but there is no network — using the local
            engine.
          </span>
        )}
      </div>
    </div>
  );
}

function SuggestionChips({ onAsk }: { onAsk: (q: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SUGGESTED_QUESTIONS.map((q) => (
        <button
          key={q}
          onClick={() => onAsk(q)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-pharma-300 hover:bg-pharma-50 hover:text-pharma-700"
        >
          {q}
        </button>
      ))}
    </div>
  );
}

function BriefingCardView({ card }: { card: BriefingCard }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {card.title}
        </p>
        <Badge tone={card.tone}>{card.label}</Badge>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
        {card.text}
      </p>
    </div>
  );
}

export function AiAssistantPage() {
  const ctx = useLiveQuery(() => loadAssistantContext(), []);
  const messages =
    useLiveQuery(
      () => pharmaDb.assistantMessages.orderBy("createdAt").toArray(),
      [],
    ) ?? [];
  const settings = useLiveQuery(() => loadAssistantSettings(), []);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const enabled = useEnabledModules();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, busy]);

  const briefing = useMemo(
    () => (ctx ? buildBriefing(ctx) : []),
    [ctx],
  );
  const llmConfigured = Boolean(settings?.apiKey?.trim());

  const send = async (raw?: string) => {
    const question = (raw ?? input).trim();
    if (!question || !ctx || busy) return;
    setBusy(true);
    setInput("");
    try {
      const userId = uid();
      await pharmaDb.assistantMessages.add({
        id: userId,
        role: "user",
        text: question,
        createdAt: now(),
      });
      const history = [
        ...messages.slice(-8).map((m) => ({ role: m.role, content: m.text })),
        { role: "user" as const, content: question },
      ];
      let res;
      try {
        res = await askAssistant(question, ctx, history);
      } catch {
        res = {
          text: "I'm sorry, something went wrong processing your request. Please try again.",
          source: "OFFLINE" as const,
        };
      }
      try {
        await pharmaDb.assistantMessages.add({
          id: uid(),
          role: "assistant",
          text: res.text,
          source: res.source,
          intent: res.intent,
          payload: res.payload,
          createdAt: now(),
        });
      } catch {
        console.error("Failed to save assistant response");
      }
    } finally {
      setBusy(false);
    }
  };

  const createPO = async (r: ReorderSuggestion) => {
    if (!r.supplierId) {
      window.alert(
        "No supplier is linked to this medicine yet. Add one on the batch or supplier record first.",
      );
      return;
    }
    if (enabled && !enabled.has("PROCUREMENT")) {
      window.alert(
        "The Procurement module is disabled. Enable it before creating purchase orders.",
      );
      return;
    }
    if (!user) return;
    setCreatingId(r.medicineId);
    try {
      const po = await createPurchaseOrder({
        supplierId: r.supplierId,
        lines: [
          {
            medicineId: r.medicineId,
            qtyOrdered: r.recommendedQty,
            unitCost: r.lastUnitCost ?? 0,
          },
        ],
        note: `Auto-suggested reorder from AI Assistant (${r.currentStock} in stock, ~${r.daysToOut ?? "no recent sales"} days left)`,
        createdBy: user.id,
        createdByName: user.fullName,
      });
      window.alert(`Purchase order ${po.number} created as a draft.`);
      navigate("/admin/purchase-orders");
    } finally {
      setCreatingId(null);
    }
  };

  const clearChat = async () => {
    if (messages.length === 0) return;
    if (!window.confirm("Clear the assistant conversation?")) return;
    await pharmaDb.assistantMessages.clear();
  };

  const engineLabel =
    online && llmConfigured
      ? "Online LLM"
      : "Offline rule-based engine";

  return (
    <div>
      <PageHeader
        title="AI Assistant"
        subtitle="Natural-language management insights from your live data"
        actions={
          <>
            <Button
              variant="outline"
              disabled={!ctx || busy}
              onClick={() => send(SUGGESTED_QUESTIONS[0])}
            >
              <RefreshCw size={15} />
              Daily briefing
            </Button>
            <Button
              variant="ghost"
              disabled={messages.length === 0}
              onClick={clearChat}
            >
              <Trash2 size={15} />
              Clear
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card
          title="Conversation"
          subtitle={engineLabel}
          className="lg:col-span-2"
        >
          <div className="flex h-[520px] flex-col">
            <div
              ref={scrollRef}
              className="flex-1 space-y-4 overflow-y-auto pr-1"
            >
              {messages.length === 0 ? (
                <WelcomeHint
                  online={online}
                  llmConfigured={llmConfigured}
                  model={settings?.model ?? ""}
                />
              ) : (
                messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    m={m}
                    creatingId={creatingId}
                    onCreatePO={createPO}
                  />
                ))
              )}
              {busy && <TypingIndicator />}
            </div>

            {messages.length === 0 && !busy && (
              <div className="mt-4">
                <SuggestionChips onAsk={(q) => send(q)} />
              </div>
            )}

            <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
                placeholder="Ask about your pharmacy… (e.g. which medicines are low on stock?)"
                disabled={!ctx || busy}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-pharma-500 focus:outline-none focus:ring-1 focus:ring-pharma-500 disabled:bg-slate-100"
              />
              <Button
                onClick={() => send()}
                disabled={!ctx || busy || !input.trim()}
              >
                <Send size={15} />
                Ask
              </Button>
            </div>
          </div>
        </Card>

        <Card
          title="Daily Briefing"
          subtitle="Live insight cards computed from your data"
          action={
            <Button
              size="sm"
              variant="outline"
              disabled={!ctx || busy}
              onClick={() => send(SUGGESTED_QUESTIONS[0])}
            >
              <Sparkles size={13} />
              Ask in chat
            </Button>
          }
        >
          {briefing.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              Loading data…
            </p>
          ) : (
            <div className="space-y-3">
              {briefing.map((card) => (
                <BriefingCardView key={card.id} card={card} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
