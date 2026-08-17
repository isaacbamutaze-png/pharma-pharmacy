import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  HeartPulse,
  Pill,
  SkipForward,
  Sparkles,
  Store,
  Users,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import {
  Checkbox,
  SelectInput,
  TextInput,
} from "../../components/ui/Input";
import { Badge } from "../../components/ui/Badge";
import { useAuthStore } from "../../store/authStore";
import {
  BUSINESS_TYPES,
  BUSINESS_SIZES,
  saveBusinessSetup,
  type BusinessSize,
  type BusinessType,
} from "../../lib/setup";
import {
  SETUP_REQUIREMENTS,
  TIER_META,
  resolveTier,
  type Tier,
} from "../../lib/modules";

const STEP_LABELS = [
  "Welcome",
  "Business",
  "Size",
  "Locations",
  "Users",
  "Features",
  "Identity",
  "Review",
];

const TYPE_PRESETS: Record<BusinessType, string[]> = {
  DRUG_SHOP: [],
  PHARMACY: ["SUPPLIERS_PROCUREMENT", "PATIENTS", "PRESCRIPTIONS"],
  HOSPITAL_CLINIC: ["PATIENTS", "PRESCRIPTIONS", "CONTROLLED", "SAFETY"],
  PHARMACY_GROUP: SETUP_REQUIREMENTS.map((r) => r.key),
};

const CURRENCIES = ["UGX", "KES", "TZS", "RWF", "USD", "EUR", "GBP"];

const TYPE_ICON: Record<BusinessType, React.ReactNode> = {
  DRUG_SHOP: <Store size={22} />,
  PHARMACY: <Pill size={22} />,
  HOSPITAL_CLINIC: <HeartPulse size={22} />,
  PHARMACY_GROUP: <Building2 size={22} />,
};

export function SetupWizard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [step, setStep] = useState(0);
  const [businessType, setBusinessType] = useState<BusinessType | null>(null);
  const [size, setSize] = useState<BusinessSize | null>(null);
  const [locations, setLocations] = useState<number>(1);
  const [branchNames, setBranchNames] = useState("");
  const [users, setUsers] = useState<number>(2);
  const [requirements, setRequirements] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [currency, setCurrency] = useState("UGX");
  const [invoicePrefix, setInvoicePrefix] = useState("INV");
  const [receiptFooter, setReceiptFooter] = useState(
    "Thank you for your purchase. Get well soon!",
  );
  const [saving, setSaving] = useState(false);

  const selectType = (type: BusinessType) => {
    setBusinessType(type);
    setRequirements(new Set(TYPE_PRESETS[type]));
  };

  const toggleRequirement = (key: string) => {
    setRequirements((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const previewModules = useMemo(() => {
    const ids = new Set<string>();
    for (const key of requirements) {
      const req = SETUP_REQUIREMENTS.find((r) => r.key === key);
      req?.modules.forEach((m) => ids.add(m));
    }
    return ids;
  }, [requirements]);

  const tier: Tier = resolveTier(previewModules);
  const tierMeta = TIER_META[tier];

  const selectedTypeLabel =
    BUSINESS_TYPES.find((t) => t.value === businessType)?.label ?? "";
  const selectedSizeLabel =
    BUSINESS_SIZES.find((s) => s.value === size)?.label ?? "";

  const buildModules = () => {
    const ids = new Set<string>();
    for (const key of requirements) {
      const req = SETUP_REQUIREMENTS.find((r) => r.key === key);
      req?.modules.forEach((m) => ids.add(m));
    }
    if (locations > 1) {
      ids.add("BRANCHES");
      ids.add("TRANSFERS");
    }
    return [...ids];
  };

  const handleFinish = async (skip = false) => {
    setSaving(true);
    try {
      await saveBusinessSetup({
        businessType: skip ? "DRUG_SHOP" : (businessType ?? "DRUG_SHOP"),
        businessTypeLabel: skip
          ? "Drug Shop"
          : (selectedTypeLabel || "Drug Shop"),
        size: skip ? "SMALL" : (size ?? "SMALL"),
        sizeLabel: skip ? "Small" : (selectedSizeLabel || "Small"),
        locations: skip ? 1 : locations,
        users: skip ? 2 : users,
        branchNames: branchNames
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        modules: skip ? [] : buildModules(),
        pharmacyName: name || undefined,
        pharmacyAddress: address || undefined,
        pharmacyPhone: phone || undefined,
        currency,
        invoicePrefix,
        receiptFooter,
        actorId: user?.id,
      });
      navigate(user ? "/admin/settings" : "/login");
    } finally {
      setSaving(false);
    }
  };

  const canNext =
    step === 1
      ? businessType !== null
      : step === 2
        ? size !== null
        : step === 6
          ? name.trim().length > 0
          : true;

  const stepTitle = [
    "Welcome to PHARMA",
    "What type of business do you operate?",
    "Tell us about your operation",
    "How many locations do you operate?",
    "How many people will use PHARMA?",
    "What would you like PHARMA to manage?",
    "Tell us about your business",
    "Review your configuration",
  ][step];

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
            <Pill size={22} className="text-white" />
          </span>
          <div>
            <p className="text-xl font-bold leading-tight text-slate-900">
              PHARMA
            </p>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Pharmacy Operations Management
            </p>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-center gap-1.5">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex items-center gap-1.5">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${
                  i < step
                    ? "bg-emerald-500 text-white"
                    : i === step
                      ? "bg-blue-600 text-white"
                      : "bg-slate-200 text-slate-400"
                }`}
              >
                {i < step ? <Check size={12} /> : i + 1}
              </span>
              {i < STEP_LABELS.length - 1 && (
                <span
                  className={`h-0.5 w-5 rounded-full ${
                    i < step ? "bg-emerald-400" : "bg-slate-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900">{stepTitle}</h2>
            <Badge tone={tierMeta.badge}>
              {tierMeta.label} configuration
            </Badge>
          </div>

          {step === 0 && (
            <div className="space-y-4 text-center">
              <p className="text-sm leading-relaxed text-slate-600">
                Let's set up your pharmacy management system. PHARMA adapts to
                your business — whether you run a small drug shop or a large
                multi-branch pharmacy group. This only takes a minute and you
                can change it anytime from Settings.
              </p>
              <div className="flex flex-col items-center justify-center gap-3 pt-2 sm:flex-row">
                <Button size="lg" onClick={() => setStep(1)}>
                  Get Started
                  <ArrowRight size={16} />
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => handleFinish(true)}
                  disabled={saving}
                >
                  <SkipForward size={16} />
                  Skip — use the standard setup
                </Button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {BUSINESS_TYPES.map((t) => {
                const active = businessType === t.value;
                return (
                  <button
                    key={t.value}
                    onClick={() => selectType(t.value)}
                    className={`rounded-xl border-2 p-4 text-left transition-colors ${
                      active
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 bg-white hover:border-blue-300"
                    }`}
                  >
                    <span
                      className={`mb-2 flex h-11 w-11 items-center justify-center rounded-lg ${
                        active
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {TYPE_ICON[t.value]}
                    </span>
                    <p className="font-semibold text-slate-800">{t.label}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {t.description}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {BUSINESS_SIZES.map((s) => {
                const active = size === s.value;
                return (
                  <button
                    key={s.value}
                    onClick={() => setSize(s.value)}
                    className={`rounded-xl border-2 p-4 text-left transition-colors ${
                      active
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 bg-white hover:border-blue-300"
                    }`}
                  >
                    <p className="font-semibold text-slate-800">{s.label}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {s.description}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <SelectInput
                label="How many locations do you operate?"
                value={String(locations)}
                onChange={(e) => setLocations(Number(e.target.value))}
              >
                <option value="1">1 — one location</option>
                <option value="2">2 – 5 — multiple locations</option>
                <option value="6">6+ — many locations</option>
              </SelectInput>
              {locations > 1 && (
                <>
                  <p className="text-sm text-slate-600">
                    Multiple locations will enable the multi-branch framework
                    (branches, warehouses, stock transfers and consolidated
                    reports).
                  </p>
                  <TextInput
                    label="Branch names (comma-separated, optional)"
                    value={branchNames}
                    onChange={(e) => setBranchNames(e.target.value)}
                    placeholder="e.g. Kampala, Jinja, Entebbe, Warehouse"
                  />
                </>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                  <Users size={20} />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">
                    How many people will use PHARMA?
                  </p>
                  <p className="text-xs text-slate-500">
                    Cashiers, pharmacists, storekeepers, managers and
                    administrators.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {[1, 2, 3, 5, 10, 20].map((n) => (
                  <button
                    key={n}
                    onClick={() => setUsers(n)}
                    className={`h-10 w-10 rounded-lg border-2 text-sm font-semibold transition-colors ${
                      users === n
                        ? "border-blue-500 bg-blue-600 text-white"
                        : "border-slate-200 text-slate-600 hover:border-blue-300"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">
                Core operations (sales, stock, expiry, payments, reports,
                refunds and balancing) are always included. Select the
                additional capabilities your business needs.
              </p>
              {SETUP_REQUIREMENTS.map((req) => {
                const active = requirements.has(req.key);
                return (
                  <label
                    key={req.key}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                      active
                        ? "border-blue-300 bg-blue-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <Checkbox
                      checked={active}
                      onChange={() => toggleRequirement(req.key)}
                      label=""
                      className="mt-0.5"
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-slate-800">
                        {req.label}
                        <Badge tone={TIER_META[req.tier].badge} >
                          <span className="ml-1">{TIER_META[req.tier].label}</span>
                        </Badge>
                      </span>
                      <span className="block text-xs text-slate-500">
                        {req.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {step === 6 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextInput
                label="Pharmacy / business name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My Pharmacy"
              />
              <TextInput
                label="Phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +256 700 000000"
              />
              <TextInput
                label="Address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street, City"
                className="sm:col-span-2"
              />
              <SelectInput
                label="Currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </SelectInput>
              <TextInput
                label="Invoice Number Prefix"
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value)}
                placeholder="e.g. INV"
              />
              <TextInput
                label="Receipt Footer"
                value={receiptFooter}
                onChange={(e) => setReceiptFooter(e.target.value)}
                placeholder="Thank you for your purchase!"
                className="sm:col-span-2"
              />
            </div>
          )}

          {step === 7 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: "Business", value: selectedTypeLabel || "—" },
                  { label: "Size", value: selectedSizeLabel || "—" },
                  { label: "Locations", value: String(locations) },
                  { label: "Users", value: String(users) },
                  {
                    label: "Configuration",
                    value: tierMeta.label,
                  },
                  { label: "Modules", value: String(previewModules.size) },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      {row.label}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      {row.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="flex items-center gap-1.5 text-sm font-medium text-blue-800">
                  <Sparkles size={15} />
                  {tierMeta.label} configuration — {tierMeta.blurb}
                </p>
                <p className="mt-1 text-xs text-blue-700">
                  PHARMA will keep your core sales and stock screens exactly as
                  they are. Additional modules are activated when you upgrade.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  size="lg"
                  onClick={() => handleFinish(false)}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Finish Setup"}
                  <Check size={16} />
                </Button>
              </div>
            </div>
          )}

          {step > 0 && (
            <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-4">
              <Button
                variant="outline"
                onClick={() => setStep((s) => s - 1)}
                disabled={saving}
              >
                <ArrowLeft size={16} />
                Back
              </Button>
              {step < 7 && (
                <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext || saving}>
                  Next
                  <ArrowRight size={16} />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
