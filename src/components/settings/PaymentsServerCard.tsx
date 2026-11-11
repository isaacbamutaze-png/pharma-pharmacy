import { useEffect, useState } from "react";
import { CheckCircle2, Save, Server, XCircle } from "lucide-react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { TextInput } from "../ui/Input";
import { pharmaDb } from "../../db";
import { setSetting } from "../../lib/setup";
import { PAYMENTS_SETTING_KEYS } from "../../lib/payments/remote";
import { uid, now } from "../../lib/utils";

interface Health {
  ok: boolean;
  flutterwave: boolean;
  flutterwaveWebhook: boolean;
  paypal: boolean;
  ai: boolean;
  authConfigured: boolean;
}

export function PaymentsServerCard({ actorId }: { actorId?: string }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<
    { ok: true; health: Health } | { ok: false; error: string } | null
  >(null);

  useEffect(() => {
    void (async () => {
      const rows = await pharmaDb.systemSettings.toArray();
      const get = (k: string) =>
        rows.find((r) => r.settingKey === k)?.settingValue ?? "";
      setUrl(get(PAYMENTS_SETTING_KEYS.url));
      setKey(get(PAYMENTS_SETTING_KEYS.key));
    })();
  }, []);

  const cleanUrl = url.trim().replace(/\/+$/, "");

  const save = async () => {
    await setSetting(PAYMENTS_SETTING_KEYS.url, cleanUrl, actorId);
    await setSetting(PAYMENTS_SETTING_KEYS.key, key.trim(), actorId);
    await pharmaDb.auditLogs.add({
      id: uid(),
      userId: actorId ?? "system",
      action: "UPDATE",
      entityType: "payments_server",
      newValues: { url: cleanUrl, keySet: Boolean(key.trim()) },
      createdAt: now(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch(`${cleanUrl}/health`, {
        signal: AbortSignal.timeout(15000),
      });
      const health = (await res.json()) as Health;
      if (!res.ok || !health.ok) throw new Error("Unexpected response.");
      setResult({ ok: true, health });
    } catch {
      setResult({
        ok: false,
        error:
          "Could not reach the server. Check the URL and your internet connection.",
      });
    }
    setTesting(false);
  };

  const flag = (on: boolean, label: string) => (
    <span className="flex items-center gap-1 text-xs">
      {on ? (
        <CheckCircle2 size={13} className="text-emerald-600" />
      ) : (
        <XCircle size={13} className="text-slate-400" />
      )}
      {label}
    </span>
  );

  return (
    <Card
      title="Payments Server"
      subtitle="Secure server that sends the PIN prompt and confirms MTN / Airtel, card, bank and PayPal payments"
      className="lg:col-span-2"
      action={
        <Badge tone={cleanUrl && key.trim() ? "green" : "amber"}>
          {cleanUrl && key.trim() ? "Configured" : "Not configured"}
        </Badge>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput
          label="Server URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-payments-server.onrender.com"
        />
        <TextInput
          label="App access key"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Same value as PHARMA_API_KEY on the server"
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={save}>
          <Save size={16} />
          Save
        </Button>
        <Button variant="outline" onClick={test} disabled={!cleanUrl || testing}>
          <Server size={16} />
          {testing ? "Testing..." : "Test connection"}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-emerald-600">
            <CheckCircle2 size={15} /> Saved
          </span>
        )}
      </div>
      {result && result.ok && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
          <span className="text-xs font-semibold">Server reachable</span>
          {flag(result.health.flutterwave, "Flutterwave (MTN/Airtel/card/bank)")}
          {flag(result.health.flutterwaveWebhook, "Webhook secret")}
          {flag(result.health.paypal, "PayPal")}
          {flag(result.health.ai, "AI assistant")}
          {flag(result.health.authConfigured, "Access key set")}
        </div>
      )}
      {result && !result.ok && (
        <p className="mt-3 text-sm text-red-600">{result.error}</p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Provider secrets (Flutterwave, PayPal, AI) are stored only on the
        server, never in this app. Without a server, only cash, credit and
        manual bank verification are available. Online payments are never
        approved by the app itself.
      </p>
    </Card>
  );
}
