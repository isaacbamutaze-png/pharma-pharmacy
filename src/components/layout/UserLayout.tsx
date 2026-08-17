import { useOutlet } from "react-router-dom";
import { AppLayout, type NavSection } from "../layout/AppLayout";
import { ErrorBoundary } from "../ErrorBoundary";
import {
  LayoutDashboard,
  ShoppingCart,
  ReceiptText,
  Pill,
  Bell,
  ReceiptCent,
  Undo2,
  Contact,
  ClipboardPlus,
} from "lucide-react";
import { useEnabledModules, moduleEnabled } from "../../lib/modules";

const userSections: NavSection[] = [
  {
    title: "Main",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/pos", label: "New Sale / POS", icon: ShoppingCart },
      { to: "/sales", label: "Sales History", icon: ReceiptText },
      { to: "/medicines", label: "Medicines", icon: Pill },
      { to: "/payments", label: "Payments & Transactions", icon: ReceiptCent },
      { to: "/refunds", label: "Refunds & Returns", icon: Undo2 },
      { to: "/alerts", label: "Alerts", icon: Bell },
    ],
  },
  {
    title: "Clinical",
    items: [
      { to: "/patients", label: "Patients", icon: Contact, moduleId: "PATIENTS" },
      { to: "/prescriptions", label: "Prescriptions & Dispensing", icon: ClipboardPlus, moduleId: "PRESCRIPTIONS" },
    ],
  },
];

export function UserLayout() {
  const outlet = useOutlet();
  const enabled = useEnabledModules() ?? new Set<string>();
  const sections: NavSection[] = userSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.moduleId || moduleEnabled(enabled, item.moduleId),
      ),
    }))
    .filter((section) => section.items.length > 0);
  return (
    <AppLayout sections={sections} pageTitle="Pharmacy">
      <ErrorBoundary>{outlet}</ErrorBoundary>
    </AppLayout>
  );
}
