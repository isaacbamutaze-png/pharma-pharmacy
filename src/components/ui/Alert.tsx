import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import type { ReactNode } from "react";

type AlertTone = "success" | "error" | "info" | "warning";

const toneConfig = {
  success: { icon: CheckCircle2, classes: "border-pharma-200 bg-pharma-50 text-pharma-800" },
  error: { icon: AlertCircle, classes: "border-red-200 bg-red-50 text-red-800" },
  info: { icon: Info, classes: "border-blue-200 bg-blue-50 text-blue-800" },
  warning: { icon: AlertCircle, classes: "border-amber-200 bg-amber-50 text-amber-800" },
};

interface AlertProps {
  tone?: AlertTone;
  children: ReactNode;
  onDismiss?: () => void;
}

export function Alert({ tone = "info", children, onDismiss }: AlertProps) {
  const config = toneConfig[tone];
  const Icon = config.icon;
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${config.classes}`}
    >
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="rounded p-0.5 opacity-60 hover:opacity-100"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
