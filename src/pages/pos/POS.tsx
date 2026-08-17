import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Search,
  ScanLine,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  CheckCircle2,
  AlertTriangle,
  PackagePlus,
  SearchX,
  Pause,
  History,
} from "lucide-react";
import { pharmaDb } from "../../db";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { TextInput, SelectInput } from "../../components/ui/Input";
import { Alert } from "../../components/ui/Alert";
import { PageHeader } from "../../components/ui/PageHeader";
import { ReceiptModal } from "../../components/sales/ReceiptModal";
import {
  PaymentCenter,
  type ConfirmedPayment,
} from "../../components/sales/PaymentCenter";
import { formatMoney, uid, now } from "../../lib/utils";
import { todayISO } from "../../lib/stock";
import {
  completeSale,
  createSaleDraft,
  finalizeSale,
  cancelSaleDraft,
  round2,
} from "../../lib/sales";
import { useAuthStore, isAdmin } from "../../store/authStore";
import type { HeldSale, MedicineUnit, Sale } from "../../types";

interface CartLine {
  medicineId: string;
  unitId: string;
  unitName: string;
  unitPrice: number;
  unitConversion: number;
  quantity: number;
}

function beep() {
  try {
    if (typeof navigator !== "undefined" && navigator.userActivation && !navigator.userActivation.isActive) {
      return;
    }
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1250;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close();
  } catch {
    /* audio not available */
  }
}

function defaultUnit(units: MedicineUnit[]): MedicineUnit | undefined {
  return (
    units.find((u) => u.isDefault && u.canSell) ??
    units.find((u) => u.canSell) ??
    units[0]
  );
}

function sellableUnits(units: MedicineUnit[]): MedicineUnit[] {
  return units
    .filter((u) => u.canSell)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function PosPage() {
  const user = useAuthStore((s) => s.user);
  const medicines = useLiveQuery(
    () => pharmaDb.medicines.filter((m) => m.status === "ACTIVE").toArray(),
    [],
  ) ?? [];
  const batches = useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []) ?? [];
  const barcodes = useLiveQuery(() => pharmaDb.medicineBarcodes.toArray(), []) ?? [];
  const units = useLiveQuery(() => pharmaDb.medicineUnits.toArray(), []) ?? [];
  const customers = useLiveQuery(() => pharmaDb.customers.toArray(), []) ?? [];
  const heldSales =
    useLiveQuery(
      () =>
        pharmaDb.heldSales.orderBy("createdAt").reverse().toArray(),
      [],
    ) ?? [];
  const settings = useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const currency =
    settings.find((s) => s.settingKey === "currency")?.settingValue ?? "UGX";
  const taxRate = Number(
    settings.find((s) => s.settingKey === "tax_rate")?.settingValue ?? "0",
  );
  const addImmediately =
    (settings.find((s) => s.settingKey === "scanner_add_immediately")
      ?.settingValue ?? "1") !== "0";
  const beepOnScan =
    (settings.find((s) => s.settingKey === "scanner_beep")?.settingValue ??
      "1") !== "0";
  const unknownPrompt =
    (settings.find((s) => s.settingKey === "scanner_unknown_prompt")
      ?.settingValue ?? "1") !== "0";

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discountInput, setDiscountInput] = useState("");
  const [confirmedPayments, setConfirmedPayments] = useState<
    ConfirmedPayment[]
  >([]);
  const [creditMode, setCreditMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [showHold, setShowHold] = useState(false);
  const [showRecall, setShowRecall] = useState(false);
  const [holdLabel, setHoldLabel] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [draftSale, setDraftSale] = useState<Sale | null>(null);
  const [draftFp, setDraftFp] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const pendingPayments =
    useLiveQuery(
      () =>
        pharmaDb.paymentTransactions
          .filter((tx) =>
            ["PENDING", "PROCESSING", "UNKNOWN", "EXPIRED"].includes(
              tx.status,
            ),
          )
          .count(),
      [],
    ) ?? 0;
  const scanInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scanInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!lastSale) return;
    scanInputRef.current?.focus();
  }, [lastSale]);

  const focusScan = () => {
    requestAnimationFrame(() => scanInputRef.current?.focus());
  };

  const medicineMap = useMemo(
    () => new Map(medicines.map((m) => [m.id, m])),
    [medicines],
  );

  const unitsByMedicine = useMemo(() => {
    const map = new Map<string, MedicineUnit[]>();
    for (const u of units) {
      const list = map.get(u.medicineId) ?? [];
      list.push(u);
      map.set(u.medicineId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [units]);

  const effectiveUnits = useMemo(() => {
    const map = new Map<string, MedicineUnit[]>();
    for (const m of medicines) {
      const list = unitsByMedicine.get(m.id);
      if (list && list.length > 0) {
        map.set(m.id, list);
        continue;
      }
      const unitName = m.baseUnit || m.unit || "Unit";
      map.set(m.id, [
        {
          id: `implicit-${m.id}`,
          medicineId: m.id,
          unitName,
          unitCode:
            unitName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() || "UNIT",
          conversionToBase: 1,
          sellingPrice: m.sellingPrice,
          canSell: true,
          canPurchase: true,
          isDefault: true,
          isBase: true,
          sortOrder: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      ]);
    }
    return map;
  }, [medicines, unitsByMedicine]);

  const stockByMedicine = useMemo(() => {
    const today = todayISO();
    const map = new Map<string, number>();
    for (const b of batches) {
      if (b.quantityRemaining > 0 && b.expiryDate >= today) {
        map.set(b.medicineId, (map.get(b.medicineId) ?? 0) + b.quantityRemaining);
      }
    }
    return map;
  }, [batches]);

  const barcodeToMedicine = useMemo(() => {
    const map = new Map<string, { medicineId: string; unitId?: string }>();
    for (const bc of barcodes) {
      if (!map.has(bc.barcode)) {
        map.set(bc.barcode, {
          medicineId: bc.medicineId,
          unitId: bc.unitId,
        });
      }
    }
    return map;
  }, [barcodes]);

  const cartBaseUsage = (medicineId: string) =>
    cart
      .filter((l) => l.medicineId !== medicineId)
      .reduce((sum, l) => sum + l.quantity * l.unitConversion, 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return medicines;
    return medicines.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.genericName ?? "").toLowerCase().includes(q) ||
        (m.strength ?? "").toLowerCase().includes(q),
    );
  }, [medicines, search]);

  const subtotal = round2(
    cart.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0),
  );
  const discount = round2(Math.min(Number(discountInput) || 0, subtotal));
  const tax = round2((Math.max(0, subtotal - discount) * taxRate) / 100);
  const total = round2(Math.max(0, subtotal - discount) + tax);
  const confirmedSum = round2(
    confirmedPayments.reduce((sum, p) => sum + p.amount, 0),
  );
  const remaining = round2(Math.max(0, total - confirmedSum));
  const changeDue = round2(Math.max(0, confirmedSum - total));
  const balanceDue = creditMode ? remaining : 0;

  const cartFingerprint = useMemo(
    () =>
      JSON.stringify({
        lines: cart.map((l) => [
          l.medicineId,
          l.quantity,
          l.unitPrice,
          l.unitId,
        ]),
        customer: customerName.trim(),
        phone: customerPhone.trim(),
        discount: discountInput,
      }),
    [cart, customerName, customerPhone, discountInput],
  );

  useEffect(() => {
    if (!draftSale || !user) return;
    if (draftFp === cartFingerprint) return;
    void cancelSaleDraft(draftSale.id, user.id).catch(() => {});
    setDraftSale(null);
    setDraftFp("");
    setConfirmedPayments([]);
    setInFlight(false);
    setError(
      "Cart changed after an online payment was initiated. The pending draft was cancelled.",
    );
  }, [cartFingerprint, draftFp, draftSale, user]);

  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  const addItem = (medicineId: string, unitId?: string) => {
    setError(null);
    const medicine = medicineMap.get(medicineId);
    if (!medicine) return;
    const availableBase = stockByMedicine.get(medicineId) ?? 0;
    if (availableBase <= 0) {
      setError(`${medicine.name} is out of stock.`);
      return;
    }
    const medUnits = effectiveUnits.get(medicineId) ?? [];
    const unit =
      (unitId ? medUnits.find((u) => u.id === unitId) : undefined) ??
      defaultUnit(medUnits);
    if (!unit) {
      setError(`No sellable unit configured for ${medicine.name}.`);
      return;
    }
    const usedBase = cartBaseUsage(medicineId);
    setCart((prev) => {
      const existing = prev.find((l) => l.medicineId === medicineId);
      if (existing) {
        const nextBase = (existing.quantity + 1) * existing.unitConversion;
        if (nextBase + usedBase > availableBase) {
          setError(
            `Only ${Math.floor((availableBase - usedBase) / existing.unitConversion)} ${existing.unitName}(s) of ${medicine.name} available.`,
          );
          return prev;
        }
        return prev.map((l) =>
          l.medicineId === medicineId
            ? { ...l, quantity: l.quantity + 1 }
            : l,
        );
      }
      if (unit.conversionToBase > availableBase) {
        setError(
          `Only ${availableBase} base unit(s) of ${medicine.name} available.`,
        );
        return prev;
      }
      return [
        ...prev,
        {
          medicineId,
          unitId: unit.id,
          unitName: unit.unitName,
          unitPrice: unit.sellingPrice,
          unitConversion: unit.conversionToBase,
          quantity: 1,
        },
      ];
    });
  };

  const changeQuantity = (medicineId: string, delta: number) => {
    setError(null);
    const availableBase = stockByMedicine.get(medicineId) ?? 0;
    const usedBase = cartBaseUsage(medicineId);
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.medicineId !== medicineId) return l;
          const next = l.quantity + delta;
          const nextBase = next * l.unitConversion;
          if (nextBase + usedBase > availableBase) {
            setError(
              `Only ${Math.floor((availableBase - usedBase) / l.unitConversion)} ${l.unitName}(s) of ${(medicineMap.get(medicineId)?.name) ?? "item"} available.`,
            );
            return l;
          }
          return { ...l, quantity: Math.max(1, next) };
        })
        .filter((l) => l.quantity > 0),
    );
  };

  const changeUnit = (medicineId: string, unitId: string) => {
    setError(null);
    const unit = (effectiveUnits.get(medicineId) ?? []).find(
      (u) => u.id === unitId,
    );
    if (!unit) return;
    setCart((prev) =>
      prev.map((l) => {
        if (l.medicineId !== medicineId) return l;
        const baseQty = l.quantity * l.unitConversion;
        const next = Math.max(1, Math.round(baseQty / unit.conversionToBase));
        return {
          ...l,
          unitId: unit.id,
          unitName: unit.unitName,
          unitPrice: unit.sellingPrice,
          unitConversion: unit.conversionToBase,
          quantity: next,
        };
      }),
    );
  };

  const removeItem = (medicineId: string) => {
    setError(null);
    setCart((prev) => prev.filter((l) => l.medicineId !== medicineId));
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const raw = search.trim();
    if (!raw) {
      focusScan();
      return;
    }
    const match = barcodeToMedicine.get(raw);
    if (match) {
      if (beepOnScan) beep();
      if (addImmediately) {
        addItem(match.medicineId, match.unitId);
        setSearch("");
        focusScan();
      } else {
        const m = medicineMap.get(match.medicineId);
        setSearch(m ? m.name : raw);
        focusScan();
      }
      return;
    }
    const lower = raw.toLowerCase();
    const medicineHit = medicines.some(
      (m) =>
        m.name.toLowerCase().includes(lower) ||
        (m.genericName ?? "").toLowerCase().includes(lower) ||
        (m.strength ?? "").toLowerCase().includes(lower),
    );
    const looksLikeBarcode =
      /^[0-9A-Za-z-]+$/.test(raw) && raw.length >= 3 && !medicineHit;
    if (looksLikeBarcode) {
      if (unknownPrompt) {
        setUnknownBarcode(raw);
      } else {
        setError(`Barcode "${raw}" is not registered to any medicine.`);
      }
      return;
    }
    focusScan();
  };

  const handleComplete = async () => {
    if (!user) return;
    setError(null);
    if (cart.length === 0) {
      setError("Add at least one item to the cart.");
      return;
    }
    if (!creditMode && confirmedSum < total) {
      setError(
        `Amount collected (${formatMoney(confirmedSum, currency)}) is less than the total.`,
      );
      return;
    }
    if (creditMode && !customerName.trim()) {
      setError("A customer name is required for credit sales.");
      return;
    }

    const payments = confirmedPayments.map((p) => ({
      method: p.method,
      amount: p.amount,
      provider: p.provider,
      providerReference: p.providerReference,
      transactionId: p.transactionId,
      currency,
    }));
    if (creditMode && remaining > 0) {
      payments.push({
        method: "CREDIT",
        amount: 0,
        provider: undefined,
        providerReference: undefined,
        transactionId: undefined,
        currency,
      });
    }

    try {
      let sale: Sale;
      if (draftSale) {
        if (draftFp !== cartFingerprint) {
          setError(
            "The cart changed after the online payment draft was created. Clear the cart and try again.",
          );
          return;
        }
        sale = await finalizeSale(draftSale.id, payments);
      } else {
        sale = await completeSale({
          lines: cart.map((l) => ({
            medicineId: l.medicineId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            unitId: l.unitId,
            unitName: l.unitName,
            unitConversion: l.unitConversion,
          })),
          customerName: customerName.trim() || undefined,
          customerPhone: customerPhone.trim() || undefined,
          discount,
          taxRate,
          payments,
          cashierId: user.id,
          cashierName: user.fullName,
        });
      }
      await pharmaDb.auditLogs.add({
        id: uid(),
        userId: user.id,
        action: "SALE_COMPLETE",
        entityType: "sale",
        entityId: sale.id,
        newValues: { invoiceNumber: sale.invoiceNumber, total: sale.total },
        createdAt: now(),
      });
      setLastSale(sale);
      setDraftSale(null);
      setDraftFp("");
      setInFlight(false);
      setCart([]);
      setSearch("");
      setCustomerName("");
      setCustomerPhone("");
      setDiscountInput("");
      setConfirmedPayments([]);
      setCreditMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete sale.");
    }
  };

  const resetCart = () => {
    setError(null);
    if (draftSale && user) {
      void cancelSaleDraft(draftSale.id, user.id).catch(() => {});
    }
    setDraftSale(null);
    setDraftFp("");
    setInFlight(false);
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setDiscountInput("");
    setConfirmedPayments([]);
    setCreditMode(false);
  };

  const handleHold = async () => {
    if (!user) return;
    if (cart.length === 0) return;
    const label = holdLabel.trim() || `Sale ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    await pharmaDb.heldSales.add({
      id: uid(),
      label,
      lines: cart.map((l) => ({ ...l })),
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      discountInput,
      taxRate,
      createdBy: user.id,
      createdAt: now(),
    });
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: user.id,
      action: "HOLD_SALE",
      entityType: "sale",
      newValues: { items: cart.length, total },
      createdAt: now(),
    });
    setHoldLabel("");
    setShowHold(false);
    resetCart();
    setSuccessMessage(`Sale held. You can recall it from the Hold menu.`);
    focusScan();
  };

  const handleRecall = async (held: HeldSale) => {
    setError(null);
    const restored = held.lines.filter((line) => {
      const m = medicineMap.get(line.medicineId);
      if (!m || m.status !== "ACTIVE") return false;
      const medUnits = effectiveUnits.get(line.medicineId) ?? [];
      if (!medUnits.some((u) => u.id === line.unitId)) return false;
      const availableBase = stockByMedicine.get(line.medicineId) ?? 0;
      return line.quantity * line.unitConversion <= availableBase;
    });
    if (restored.length === 0) {
      setError("None of the held items can be restored (out of stock or removed).");
      return;
    }
    await pharmaDb.heldSales.delete(held.id);
    setCart(restored);
    setCustomerName(held.customerName ?? "");
    setCustomerPhone(held.customerPhone ?? "");
    setDiscountInput(held.discountInput ?? "");
    setCreditMode(false);
    setConfirmedPayments([]);
    setShowRecall(false);
    if (restored.length < held.lines.length) {
      setError("Some held items were skipped (out of stock or inactive).");
    }
    focusScan();
  };

  const handleDeleteHeld = async (id: string) => {
    if (!window.confirm("Discard this held sale?")) return;
    await pharmaDb.heldSales.delete(id);
  };


  const shortcutsRef = useRef({
    hasUnknownBarcode: unknownBarcode !== null,
    cartCount,
    complete: handleComplete,
    clear: resetCart,
  });
  shortcutsRef.current = {
    hasUnknownBarcode: unknownBarcode !== null,
    cartCount,
    complete: handleComplete,
    clear: resetCart,
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = shortcutsRef.current;
      if (e.key === "F2") {
        e.preventDefault();
        focusScan();
      } else if (e.key === "F7") {
        e.preventDefault();
        s.complete();
      } else if (e.key === "Escape") {
        if (s.hasUnknownBarcode) {
          setUnknownBarcode(null);
          focusScan();
        } else if (s.cartCount > 0) {
          if (
            window.confirm(
              "Clear the current cart? Press Cancel to keep items.",
            )
          ) {
            s.clear();
          }
          focusScan();
        } else {
          setSearch("");
          focusScan();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div>
      <PageHeader
        title="Point of Sale"
        subtitle="Scan barcodes or search to add items"
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="font-medium text-slate-400">Shortcuts:</span>
        <span>
          <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[10px]">
            F2
          </kbd>{" "}
          focus scan
        </span>
        <span>
          <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[10px]">
            F7
          </kbd>{" "}
          charge / complete
        </span>
        <span>
          <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[10px]">
            ESC
          </kbd>{" "}
          cancel / clear
        </span>
      </div>

      {error && (
        <div className="mb-4">
          <Alert tone="error" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}

      {successMessage && (
        <div className="mb-4">
          <Alert tone="success" onDismiss={() => setSuccessMessage(null)}>
            {successMessage}
          </Alert>
        </div>
      )}

      {pendingPayments > 0 && (
        <div className="mb-4">
          <Alert tone="warning">
            {pendingPayments} online payment request
            {pendingPayments === 1 ? "" : "s"} awaiting provider confirmation.
            Money is not recorded as collected until the provider confirms.
            Track them in Payments &amp; Transactions.
          </Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <form onSubmit={handleSearchSubmit}>
            <div className="relative">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                ref={scanInputRef}
                autoFocus
                className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-12 text-base placeholder:text-slate-400 focus:border-pharma-500 focus:outline-none focus:ring-1 focus:ring-pharma-500"
                placeholder="Search name, generic, strength, or scan barcode then press Enter..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300">
                <ScanLine size={20} />
              </span>
            </div>
          </form>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((m) => {
              const available = stockByMedicine.get(m.id) ?? 0;
              const medUnits = effectiveUnits.get(m.id) ?? [];
              const def = defaultUnit(medUnits);
              const price = def?.sellingPrice ?? m.sellingPrice;
              return (
                <button
                  key={m.id}
                  onClick={() => addItem(m.id, def?.id)}
                  disabled={available <= 0}
                  className={`rounded-xl border bg-white p-3 text-left shadow-sm transition-colors ${
                    available <= 0
                      ? "cursor-not-allowed border-slate-200 opacity-60"
                      : "border-slate-200 hover:border-pharma-400 hover:shadow"
                  }`}
                >
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {m.name}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {m.strength || m.genericName || "—"}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-1">
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-pharma-700">
                      {formatMoney(price, currency)}
                      {def ? (
                        <span className="ml-1 text-xs font-normal text-slate-400">
                          /{def.unitName}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0">
                      <Badge
                        tone={
                          available === 0
                            ? "red"
                            : available <= m.reorderLevel
                              ? "amber"
                              : "green"
                        }
                      >
                        {available}
                      </Badge>
                    </span>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="col-span-full py-10 text-center text-sm text-slate-400">
                No medicines match your search.
              </p>
            )}
          </div>
        </div>

        <Card className="lg:sticky lg:top-0 lg:self-start">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShoppingCart size={18} className="text-pharma-600" />
              <h3 className="text-sm font-semibold text-slate-800">Cart</h3>
            </div>
            <div className="flex items-center gap-1.5">
              {cartCount > 0 && <Badge tone="blue">{cartCount} items</Badge>}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setHoldLabel("");
                  setShowHold(true);
                }}
                disabled={cart.length === 0}
                title="Hold current sale"
              >
                <Pause size={14} />
                Hold
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRecall(true)}
                disabled={heldSales.length === 0}
                title="Recall a held sale"
              >
                <History size={14} />
                Recall
              </Button>
            </div>
          </div>

          {cart.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              Cart is empty. Add items to begin a sale.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {cart.map((l) => {
                const m = medicineMap.get(l.medicineId);
                const medUnits = sellableUnits(
                  m ? effectiveUnits.get(m.id) ?? [] : [],
                );
                return (
                  <li
                    key={l.medicineId}
                    className="flex items-center gap-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {m?.name ?? "Unknown"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatMoney(l.unitPrice, currency)} /{l.unitName}
                      </p>
                    </div>
                    {medUnits.length > 1 && (
                      <SelectInput
                        aria-label="Unit"
                        value={l.unitId}
                        onChange={(e) =>
                          changeUnit(l.medicineId, e.target.value)
                        }
                        className="!w-24 !px-2 !py-1 !text-xs"
                      >
                        {medUnits.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.unitName}
                          </option>
                        ))}
                      </SelectInput>
                    )}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => changeQuantity(l.medicineId, -1)}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                        aria-label="Decrease quantity"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold text-slate-900">
                        {l.quantity}
                      </span>
                      <button
                        onClick={() => changeQuantity(l.medicineId, 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                        aria-label="Increase quantity"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <span className="w-20 text-right text-sm font-semibold text-slate-800">
                      {formatMoney(l.quantity * l.unitPrice, currency)}
                    </span>
                    <button
                      onClick={() => removeItem(l.medicineId)}
                      className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Remove item"
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {cart.length > 0 && (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <TextInput
                  label="Customer name"
                  placeholder="Walk-in"
                  list="customer-names"
                  value={customerName}
                  onChange={(e) => {
                    setCustomerName(e.target.value);
                    const match = customers.find(
                      (c) =>
                        c.name.toLowerCase() === e.target.value.trim().toLowerCase(),
                    );
                    if (match?.phone) setCustomerPhone(match.phone);
                  }}
                />
                <TextInput
                  label="Customer phone"
                  placeholder="Optional"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                />
                <datalist id="customer-names">
                  {customers.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TextInput
                  label="Discount"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                />
                <div className="flex items-end pb-1">
                  <Button
                    variant="outline"
                    size="md"
                    className="flex-1"
                    onClick={() => setDiscountInput("0")}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <PaymentCenter
                currency={currency}
                total={total}
                confirmed={confirmedPayments}
                creditMode={creditMode}
                customerPhone={customerPhone}
                onConfirmedChange={setConfirmedPayments}
                onCreditMode={setCreditMode}
                onError={setError}
                onEnsureDraft={async () => {
                  if (!user) return null;
                  if (draftSale && draftFp === cartFingerprint) {
                    return draftSale.id;
                  }
                  if (draftSale) {
                    await cancelSaleDraft(draftSale.id, user.id).catch(
                      () => {},
                    );
                  }
                  const draft = await createSaleDraft({
                    lines: cart.map((l) => ({
                      medicineId: l.medicineId,
                      quantity: l.quantity,
                      unitPrice: l.unitPrice,
                      unitId: l.unitId,
                      unitName: l.unitName,
                      unitConversion: l.unitConversion,
                    })),
                    customerName: customerName.trim() || undefined,
                    customerPhone: customerPhone.trim() || undefined,
                    discount,
                    taxRate,
                    cashierId: user.id,
                    cashierName: user.fullName,
                  });
                  setDraftSale(draft);
                  setDraftFp(cartFingerprint);
                  return draft.id;
                }}
                onInFlightChange={setInFlight}
              />

              <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span>{formatMoney(subtotal, currency)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Discount</span>
                  <span>-{formatMoney(discount, currency)}</span>
                </div>
                {tax > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Tax ({taxRate}%)</span>
                    <span>{formatMoney(tax, currency)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 text-base font-bold text-slate-900">
                  <span>Total</span>
                  <span>{formatMoney(total, currency)}</span>
                </div>
                {creditMode && balanceDue > 0 ? (
                  <div className="flex justify-between font-medium text-amber-600">
                    <span>Balance due</span>
                    <span>{formatMoney(balanceDue, currency)}</span>
                  </div>
                ) : (
                  <div className="flex justify-between text-slate-600">
                    <span>Change</span>
                    <span>{formatMoney(changeDue, currency)}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={resetCart} className="flex-1">
                  Clear
                </Button>
                <Button
                  onClick={handleComplete}
                  className="flex-[2]"
                  disabled={cart.length === 0 || inFlight}
                  title="Charge / complete sale (F7)"
                >
                  <CheckCircle2 size={16} />
                  {inFlight ? "Confirming payment…" : "Complete Sale"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {lastSale && (
        <ReceiptModal
          sale={lastSale}
          settings={settings}
          onClose={() => setLastSale(null)}
        />
      )}

      {showHold && (
        <Modal
          title="Hold Sale"
          subtitle="Save this cart and clear it for the next customer"
          onClose={() => setShowHold(false)}
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              This sale can be recalled later from the cart. The current cart
              will be cleared.
            </p>
            <TextInput
              label="Label (optional)"
              placeholder="e.g. Mrs. Achieng's order"
              value={holdLabel}
              onChange={(e) => setHoldLabel(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowHold(false)}>
                Cancel
              </Button>
              <Button onClick={handleHold} disabled={cart.length === 0}>
                <Pause size={16} />
                Hold Sale
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {showRecall && (
        <Modal
          title="Recall Held Sale"
          subtitle={`${heldSales.length} held sale(s)`}
          onClose={() => setShowRecall(false)}
        >
          <div className="space-y-2">
            {heldSales.length === 0 && (
              <p className="text-sm text-slate-500">No held sales.</p>
            )}
            {heldSales.map((held) => {
              const items = held.lines.reduce(
                (sum, l) => sum + l.quantity,
                0,
              );
              const heldTotal = held.lines.reduce(
                (sum, l) => sum + l.quantity * l.unitPrice,
                0,
              );
              return (
                <div
                  key={held.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {held.label}
                    </p>
                    <p className="text-xs text-slate-500">
                      {items} item(s) · {formatMoney(heldTotal, currency)}
                      {held.customerName ? ` · ${held.customerName}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteHeld(held.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                    <Button size="sm" onClick={() => handleRecall(held)}>
                      Recall
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {unknownBarcode && (
        <Modal
          title="Unknown Barcode"
          subtitle={unknownBarcode}
          onClose={() => setUnknownBarcode(null)}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-amber-50 p-4">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-slate-800">
                  Barcode not registered.
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  This barcode is not linked to any medicine. Register it under
                  a medicine, or search by name instead.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setUnknownBarcode(null);
                  focusScan();
                }}
              >
                <SearchX size={16} />
                Cancel
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setSearch("");
                  setUnknownBarcode(null);
                  focusScan();
                }}
              >
                <Search size={16} />
                Search
              </Button>
              {isAdmin(user) && (
                <Button
                  className="flex-1"
                  onClick={() => {
                    const barcode = unknownBarcode;
                    setUnknownBarcode(null);
                    sessionStorage.setItem(
                      "prefill_barcode",
                      JSON.stringify({ barcode }),
                    );
                    window.location.hash = "#/admin/medicines";
                  }}
                >
                  <PackagePlus size={16} />
                  Register Medicine
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
