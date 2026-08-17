import { useOutlet } from "react-router-dom";
import { AppLayout, type NavSection } from "../layout/AppLayout";
import { ErrorBoundary } from "../ErrorBoundary";
import {
  LayoutDashboard,
  ShoppingCart,
  ReceiptText,
  Pill,
  Package,
  PackagePlus,
  Truck,
  ArrowLeftRight,
  Undo2,
  Users,
  Scale,
  Wallet,
  HandCoins,
  BarChart3,
  Tags,
  Settings,
  ReceiptCent,
  ClipboardList,
  ClipboardCheck,
  PackageCheck,
  Receipt,
  RotateCcw,
  Store,
  Contact,
  ClipboardPlus,
  ShieldAlert,
  ShieldPlus,
  Sparkles,
} from "lucide-react";
import { useEnabledModules, moduleEnabled } from "../../lib/modules";

const adminSections: NavSection[] = [
  {
    title: "Main",
    items: [
      {
        to: "/admin",
        label: "Dashboard",
        icon: LayoutDashboard,
        end: true,
        moduleId: "DASHBOARD",
      },
    ],
  },
  {
    title: "Transactions",
    items: [
      { to: "/admin/pos", label: "New Sale / POS", icon: ShoppingCart, moduleId: "POS" },
      { to: "/admin/sales", label: "Sales History", icon: ReceiptText, moduleId: "SALES" },
      { to: "/admin/medicines", label: "Medicines", icon: Pill, moduleId: "MEDICINES" },
      { to: "/admin/inventory", label: "Inventory", icon: Package, moduleId: "INVENTORY" },
      { to: "/admin/batches", label: "Receive Stock", icon: PackagePlus, moduleId: "BATCHES" },
      { to: "/admin/suppliers", label: "Suppliers", icon: Truck, moduleId: "SUPPLIERS" },
      { to: "/admin/stock-movements", label: "Stock Movements", icon: ArrowLeftRight, moduleId: "STOCK_MOVEMENTS" },
      { to: "/admin/payments", label: "Payments & Transactions", icon: ReceiptCent, moduleId: "PAYMENTS" },
      { to: "/admin/refunds", label: "Refunds & Returns", icon: Undo2, moduleId: "REFUNDS" },
    ],
  },
  {
    title: "Clinical",
    items: [
      { to: "/admin/patients", label: "Patients", icon: Contact, moduleId: "PATIENTS" },
      { to: "/admin/prescriptions", label: "Prescriptions & Dispensing", icon: ClipboardPlus, moduleId: "PRESCRIPTIONS" },
      { to: "/admin/controlled-medicines", label: "Controlled Medicines", icon: ShieldAlert, moduleId: "CONTROLLED_MEDICINES" },
      { to: "/admin/drug-safety", label: "Drug Safety", icon: ShieldPlus, moduleId: "SAFETY_ENGINE" },
    ],
  },
  {
    title: "Purchasing",
    items: [
      { to: "/admin/purchase-requests", label: "Purchase Requests", icon: ClipboardList, moduleId: "PROCUREMENT" },
      { to: "/admin/purchase-orders", label: "Purchase Orders", icon: ClipboardCheck, moduleId: "PROCUREMENT" },
      { to: "/admin/grns", label: "Goods Received", icon: PackageCheck, moduleId: "PROCUREMENT" },
      { to: "/admin/supplier-invoices", label: "Supplier Invoices", icon: Receipt, moduleId: "PROCUREMENT" },
      { to: "/admin/purchase-returns", label: "Purchase Returns", icon: RotateCcw, moduleId: "PROCUREMENT" },
      { to: "/admin/supplier-center", label: "Supplier Center", icon: Store, moduleId: "SUPPLIER_CENTER" },
    ],
  },
  {
    title: "Finance",
    items: [
      { to: "/admin/expenses", label: "Expenses", icon: Wallet, moduleId: "EXPENSES" },
      { to: "/admin/balancing", label: "Book Balancing", icon: Scale, moduleId: "BALANCING" },
      { to: "/admin/reports", label: "Reports & Analytics", icon: BarChart3, moduleId: "REPORTS" },
    ],
  },
  {
    title: "Management",
    items: [
      { to: "/admin/customers", label: "Customers & Credit", icon: HandCoins, moduleId: "CUSTOMERS" },
      { to: "/admin/categories", label: "Categories", icon: Tags, moduleId: "CATEGORIES" },
      { to: "/admin/users", label: "Users", icon: Users, moduleId: "USERS" },
      { to: "/admin/settings", label: "Settings", icon: Settings, moduleId: "SETTINGS" },
      { to: "/admin/assistant", label: "AI Assistant", icon: Sparkles, moduleId: "AI_ASSISTANT" },
    ],
  },
];

export function AdminLayout() {
  const outlet = useOutlet();
  const enabled = useEnabledModules() ?? new Set<string>();
  const sections: NavSection[] = adminSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.moduleId || moduleEnabled(enabled, item.moduleId),
      ),
    }))
    .filter((section) => section.items.length > 0);
  return (
    <AppLayout sections={sections} pageTitle="Admin">
      <ErrorBoundary>{outlet}</ErrorBoundary>
    </AppLayout>
  );
}
