import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Database, Save, Settings2, Wallet, Trash2 } from "lucide-react";
import { pharmaDb } from "../../db";
import { clearAllData, clearDemoData } from "../../db";
import { seedDemoData } from "../../db/demoSeed";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { TextInput, SelectInput, TextArea } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Alert } from "../../components/ui/Alert";
import { Badge } from "../../components/ui/Badge";
import { uid, now } from "../../lib/utils";
import { useAuthStore } from "../../store/authStore";
import {
  GATEWAY_PROVIDERS,
  gatewayEnvLabel,
} from "../../lib/payments/gateway";
import { saveGatewayConfig } from "../../lib/payments/service";
import { PaymentsServerCard } from "../../components/settings/PaymentsServerCard";
import {
  TIER_META,
  TIER_MODULES,
  isEssential,
  resolveTier,
  useEnabledModules,
  type Tier,
} from "../../lib/modules";
import {
  getBusinessProfile,
  setSetting,
} from "../../lib/setup";
import type { GatewayEnvironment, PaymentGateway } from "../../types";

const CURRENCIES = ["UGX", "KES", "TZS", "RWF", "USD", "EUR", "GBP"];

const SIM_OUTCOMES = [
  { value: "", label: "Random (demo only)" },
  { value: "SUCCESS", label: "Always succeed" },
  { value: "FAILED", label: "Always fail" },
  { value: "TIMEOUT", label: "Always time out" },
] as const;

function GatewayConfigCard({
  provider,
  label,
  methodLabel,
  gateway,
  actorId,
}: {
  provider: string;
  label: string;
  methodLabel: string;
  gateway?: PaymentGateway;
  actorId: string;
}) {
  const [enabled, setEnabled] = useState(gateway?.enabled ?? false);
  const [environment, setEnvironment] = useState<GatewayEnvironment>(
    gateway?.environment ?? "sandbox",
  );
  const [demo, setDemo] = useState(gateway?.config?.["demoMode"] === "true");
  const [simOutcome, setSimOutcome] = useState(
    gateway?.config?.["simOutcome"] ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setEnabled(gateway?.enabled ?? false);
    setEnvironment(gateway?.environment ?? "sandbox");
    setDemo(gateway?.config?.["demoMode"] === "true");
    setSimOutcome(gateway?.config?.["simOutcome"] ?? "");
  }, [gateway]);

  const connected = enabled && !demo;

  const handleSave = async () => {
    setSaving(true);
    const config: Record<string, string> = {};
    if (demo) config["demoMode"] = "true";
    if (demo && simOutcome) config["simOutcome"] = simOutcome;
    // Provider secrets live on the payments server only. Saving clears any
    // key that an older version stored in this browser.
    await saveGatewayConfig({
      provider,
      label,
      enabled,
      environment,
      config,
    });
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: actorId,
      action: "UPDATE",
      entityType: "payment_gateways",
      newValues: { provider, enabled, environment },
      createdAt: now(),
    });
    setSaving(false);
    setMessage("Gateway settings saved.");
    setTimeout(() => setMessage(""), 3000);
  };

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-medium text-slate-800">
            <Wallet size={16} className="text-slate-400" />
            {label}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                demo
                  ? "bg-amber-50 text-amber-600"
                  : connected
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {demo ? "Demo simulation" : connected ? "Live" : "Disabled"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {methodLabel} · {gatewayEnvLabel(environment)}
          </p>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save size={14} />
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      {message && (
        <div className="mb-3 flex items-center gap-1.5 text-sm text-emerald-600">
          <CheckCircle2 size={15} />
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectInput
          label="Status"
          value={enabled ? "true" : "false"}
          onChange={(e) => setEnabled(e.target.value === "true")}
        >
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </SelectInput>
        <SelectInput
          label="Environment"
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as GatewayEnvironment)}
        >
          <option value="sandbox">Sandbox (test)</option>
          <option value="production">Production (live)</option>
        </SelectInput>
        <SelectInput
          label="Mode"
          value={demo ? "demo" : "live"}
          onChange={(e) => setDemo(e.target.value === "demo")}
        >
          <option value="live">Live (real provider via server)</option>
          <option value="demo">Demo simulation (no real money)</option>
        </SelectInput>
        <SelectInput
          label="Demo outcome"
          value={simOutcome}
          disabled={!demo}
          onChange={(e) => setSimOutcome(e.target.value)}
        >
          {SIM_OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectInput>
      </div>
    </div>
  );
}

function BusinessConfigurationCard({ actorId }: { actorId?: string }) {
  const navigate = useNavigate();
  const enabled = useEnabledModules();
  const profile = useLiveQuery(() => getBusinessProfile(), []);
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  useEffect(() => {
    if (enabled && draft === null) setDraft(new Set(enabled));
  }, [enabled, draft]);

  const tier: Tier = enabled ? resolveTier(enabled) : "ESSENTIAL";
  const tierMeta = TIER_META[tier];

  const toggle = (id: string) => {
    setDraft((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    const nonEssential = [...draft].filter((m) => !isEssential(m));
    await setSetting(
      "enabled_modules",
      JSON.stringify(nonEssential),
      actorId,
    );
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: actorId ?? "system",
      action: "UPDATE",
      entityType: "enabled_modules",
      newValues: { modules: nonEssential },
      createdAt: now(),
    });
    setSaving(false);
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 3000);
  };

  const summaryRows = profile
    ? [
        { label: "Business", value: profile.businessTypeLabel },
        { label: "Size", value: profile.sizeLabel },
        { label: "Locations", value: String(profile.locations) },
        { label: "Users", value: String(profile.users) },
      ]
    : [];

  return (
    <Card
      title="Business Configuration"
      subtitle="Tier and modules active for this PHARMA installation"
      className="lg:col-span-2"
      action={
        <Button variant="outline" onClick={() => navigate("/setup")}>
          <Settings2 size={14} />
          Run Setup Wizard
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={tierMeta.badge}>{tierMeta.label}</Badge>
        <span className="text-sm text-slate-500">{tierMeta.blurb}</span>
      </div>

      {profile ? (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {summaryRows.map((row) => (
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
      ) : (
        <p className="mb-4 text-sm text-slate-500">
          PHARMA has not been configured for a business profile yet. Run the
          setup wizard to tailor the system to your pharmacy.
        </p>
      )}

      {savedMsg && (
        <div className="mb-3">
          <Alert tone="success" onDismiss={() => setSavedMsg(false)}>
            Module configuration saved.
          </Alert>
        </div>
      )}

      <div className="mb-2 text-sm font-medium text-slate-700">
        Active modules
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Essential modules (sales, stock, payments, refunds, reports, balancing)
        are always active. Toggle the additional modules you want enabled.
      </p>

      {(Object.keys(TIER_MODULES) as Array<Exclude<Tier, "ESSENTIAL">>).map(
        (tierKey) => (
          <div key={tierKey} className="mb-4">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <Badge tone={TIER_META[tierKey].badge}>
                {TIER_META[tierKey].label}
              </Badge>
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {TIER_MODULES[tierKey].map((mod) => {
                const checked = draft?.has(mod.id) ?? false;
                return (
                  <label
                    key={mod.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(mod.id)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-pharma-600 focus:ring-pharma-500"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">
                        {mod.label}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {mod.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ),
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving || !draft}>
          <Save size={14} />
          {saving ? "Saving..." : "Save Module Configuration"}
        </Button>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const settings = useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];
  const gateways = useLiveQuery(() => pharmaDb.paymentGateways.toArray(), []) ?? [];

  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearingDemo, setClearingDemo] = useState(false);

  const demoSeeded = settings.some((s) => s.settingKey === "demo_seeded");

  const loadDemo = async () => {
    setLoadingDemo(true);
    await seedDemoData();
    window.location.reload();
  };

  const handleClearAll = async () => {
    if (!window.confirm("This will delete ALL medicines, sales, patients, prescriptions, expenses, and other data. Your login account and settings will be kept. Continue?")) return;
    setClearing(true);
    await clearAllData();
    window.location.reload();
  };

  const handleClearDemo = async () => {
    if (!window.confirm("This will remove the demo sales, expenses, patients and prescriptions. Your medicines, suppliers and customers will be kept. Continue?")) return;
    setClearingDemo(true);
    await clearDemoData();
    window.location.reload();
  };

  useEffect(() => {
    const map: Record<string, string> = {};
    for (const s of settings) map[s.settingKey] = s.settingValue;
    setValues(map);
  }, [settings]);

  const update = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!user) return;
    const keys = Object.keys(values);
    for (const key of keys) {
      const existing = settings.find((s) => s.settingKey === key);
      const nextValue = values[key];
      if (existing) {
        if (existing.settingValue !== nextValue) {
          await pharmaDb.systemSettings.update(existing.id, {
            settingValue: nextValue,
            updatedBy: user.id,
            updatedAt: now(),
          });
        }
      } else {
        await pharmaDb.systemSettings.add({
          id: uid(),
          settingKey: key,
          settingValue: nextValue,
          updatedBy: user.id,
          updatedAt: now(),
        });
      }
    }
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: user.id,
      action: "UPDATE",
      entityType: "system_settings",
      newValues: { ...values },
      createdAt: now(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Pharmacy configuration"
        actions={
          <Button onClick={handleSave}>
            <Save size={16} />
            Save Settings
          </Button>
        }
      />

      {saved && (
        <div className="mb-4">
          <Alert tone="success" onDismiss={() => setSaved(false)}>
            Settings saved successfully.
          </Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BusinessConfigurationCard actorId={user?.id} />

        <Card title="Pharmacy Information" subtitle="Shown on receipts and reports">
          <div className="space-y-4">
            <TextInput
              label="Pharmacy Name"
              value={values.pharmacy_name ?? ""}
              onChange={(e) => update("pharmacy_name", e.target.value)}
              placeholder="e.g. My Pharmacy"
            />
            <TextInput
              label="Address"
              value={values.pharmacy_address ?? ""}
              onChange={(e) => update("pharmacy_address", e.target.value)}
              placeholder="Street, City"
            />
            <TextInput
              label="Phone"
              value={values.pharmacy_phone ?? ""}
              onChange={(e) => update("pharmacy_phone", e.target.value)}
              placeholder="e.g. +256 700 000000"
            />
          </div>
        </Card>

        <Card title="Billing & Alerts" subtitle="Defaults used across the system">
          <div className="space-y-4">
            <SelectInput
              label="Currency"
              value={values.currency ?? "UGX"}
              onChange={(e) => update("currency", e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectInput>
            <TextInput
              label="Tax Rate (%)"
              type="number"
              min="0"
              step="0.01"
              value={values.tax_rate ?? "0"}
              onChange={(e) => update("tax_rate", e.target.value)}
            />
            <TextInput
              label="Expiry Warning Days"
              type="number"
              min="1"
              value={values.expiry_warning_days ?? "60"}
              onChange={(e) => update("expiry_warning_days", e.target.value)}
            />
            <TextInput
              label="Low Stock Threshold"
              type="number"
              min="1"
              value={values.low_stock_threshold ?? "10"}
              onChange={(e) => update("low_stock_threshold", e.target.value)}
            />
            <TextInput
              label="Invoice Number Prefix"
              value={values.invoice_prefix ?? "INV"}
              onChange={(e) => update("invoice_prefix", e.target.value)}
              placeholder="e.g. INV"
            />
          </div>
        </Card>

        <Card title="Receipt" subtitle="Receipt customization" className="lg:col-span-2">
          <TextArea
            label="Receipt Footer"
            rows={2}
            value={values.receipt_footer ?? ""}
            onChange={(e) => update("receipt_footer", e.target.value)}
            placeholder="Thank you for your purchase!"
          />
        </Card>

        <Card
          title="Barcode Scanner"
          subtitle="Behavior of barcode scanning in the POS and stock receiving"
          className="lg:col-span-2"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SelectInput
              label="Add item immediately on scan"
              value={values.scanner_add_immediately ?? "1"}
              onChange={(e) =>
                update("scanner_add_immediately", e.target.value)
              }
            >
              <option value="1">Yes (add straight to cart)</option>
              <option value="0">No (prefill search, press Enter)</option>
            </SelectInput>
            <SelectInput
              label="Beep on successful scan"
              value={values.scanner_beep ?? "1"}
              onChange={(e) => update("scanner_beep", e.target.value)}
            >
              <option value="1">Enabled</option>
              <option value="0">Disabled</option>
            </SelectInput>
            <SelectInput
              label="Prompt for unknown barcodes"
              value={values.scanner_unknown_prompt ?? "1"}
              onChange={(e) =>
                update("scanner_unknown_prompt", e.target.value)
              }
            >
              <option value="1">Show dialog</option>
              <option value="0">Show inline error only</option>
            </SelectInput>
          </div>
        </Card>

        <Card
          title="AI Assistant"
          subtitle="Optional online mode — the offline insight engine always works"
          className="lg:col-span-2"
        >
          <div className="mb-3 flex items-center gap-2">
            <Badge
              tone={values.assistant_api_key?.trim() ? "green" : "slate"}
            >
              {values.assistant_api_key?.trim()
                ? "Online LLM configured"
                : "Offline engine only"}
            </Badge>
            <span className="text-xs text-slate-500">
              When an API key is set and the device is online, questions are
              answered by an OpenAI-compatible chat model using a live snapshot
              of your data. If the call fails or the device is offline, the
              built-in offline engine answers instead.
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextInput
              label="API Base URL"
              value={values.assistant_api_url ?? ""}
              onChange={(e) => update("assistant_api_url", e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
            <TextInput
              label="API Key"
              type="password"
              value={values.assistant_api_key ?? ""}
              onChange={(e) => update("assistant_api_key", e.target.value)}
              placeholder="sk-…"
            />
            <TextInput
              label="Model"
              value={values.assistant_model ?? ""}
              onChange={(e) => update("assistant_model", e.target.value)}
              placeholder="e.g. gpt-4o-mini"
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            The API key is stored in this browser's local database only. Use a
            service compatible with the OpenAI chat completions API (OpenAI,
            Groq, OpenRouter, Ollama, LM Studio, etc.).
          </p>
        </Card>

        <Card
          title="Sample Data"
          subtitle="Populate the system with demo medicines, batches, sales and expenses"
          className="lg:col-span-2"
        >
          {demoSeeded ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">
                Sample data is loaded. You can clear just the demo sales/expenses
                (keeping your medicines, suppliers and customers) or start completely fresh.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={handleClearDemo} disabled={clearingDemo}>
                  <Trash2 size={16} />
                  {clearingDemo ? "Clearing..." : "Clear demo data only"}
                </Button>
                <Button variant="outline" onClick={handleClearAll} disabled={clearing}>
                  <Trash2 size={16} />
                  {clearing ? "Clearing..." : "Clear everything"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-slate-500">
                Add sample medicines, batches, customers, sales and expenses so
                the dashboard and reports are populated for demonstration.
              </p>
              <div className="flex gap-2">
                <Button onClick={loadDemo} disabled={loadingDemo}>
                  <Database size={16} />
                  {loadingDemo ? "Loading..." : "Load sample data"}
                </Button>
                <Button variant="outline" onClick={handleClearAll} disabled={clearing}>
                  <Trash2 size={16} />
                  {clearing ? "Clearing..." : "Clear all data"}
                </Button>
              </div>
            </div>
          )}
        </Card>

        <PaymentsServerCard actorId={user?.id} />

        <Card
          title="Payment Gateways"
          subtitle="Enable each provider, or switch it to demo simulation for staff training"
          className="lg:col-span-2"
        >
          {!user ? (
            <p className="text-sm text-slate-500">
              You must be signed in to manage gateway configuration.
            </p>
          ) : (
            <div className="space-y-4">
              {GATEWAY_PROVIDERS.map((p) => (
                <GatewayConfigCard
                  key={p.id}
                  provider={p.id}
                  label={p.label}
                  methodLabel={`Payment method: ${p.method}`}
                  gateway={gateways.find((g) => g.provider === p.id)}
                  actorId={user.id}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
