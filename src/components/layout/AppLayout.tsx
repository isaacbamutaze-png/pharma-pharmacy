import { useMemo, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  Bell,
  ChevronDown,
  LogOut,
  Maximize,
  Menu,
  Minimize,
  Pill,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import type { ComponentType, ReactNode } from "react";
import { useAuthStore, isAdmin } from "../../store/authStore";
import { pharmaDb } from "../../db";
import { todayISO, daysUntil } from "../../lib/stock";

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  end?: boolean;
  badge?: string;
  moduleId?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

interface AppLayoutProps {
  sections: NavSection[];
  children: ReactNode;
  pageTitle: string;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function AppLayout({ sections, children, pageTitle }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const medicines =
    useLiveQuery(() => pharmaDb.medicines.toArray(), []) ?? [];
  const batches =
    useLiveQuery(() => pharmaDb.medicineBatches.toArray(), []) ?? [];
  const settings =
    useLiveQuery(() => pharmaDb.systemSettings.toArray(), []) ?? [];

  const warningDays = Number(
    settings.find((s) => s.settingKey === "expiry_warning_days")?.settingValue ??
      "60",
  );
  const today = todayISO();

  const stockByMedicine = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of batches) {
      if (b.quantityRemaining > 0 && b.expiryDate >= today) {
        map.set(
          b.medicineId,
          (map.get(b.medicineId) ?? 0) + b.quantityRemaining,
        );
      }
    }
    return map;
  }, [batches, today]);

  const alertStats = useMemo(() => {
    let low = 0;
    let out = 0;
    for (const m of medicines) {
      if (m.status !== "ACTIVE") continue;
      const qty = stockByMedicine.get(m.id) ?? 0;
      if (qty === 0) out += 1;
      else if (m.reorderLevel > 0 && qty <= m.reorderLevel) low += 1;
    }
    let expiring = 0;
    let expired = 0;
    for (const b of batches) {
      if (b.quantityRemaining <= 0) continue;
      if (b.expiryDate < today) expired += 1;
      else if (daysUntil(b.expiryDate) <= warningDays) expiring += 1;
    }
    return { low, out, expiring, expired };
  }, [medicines, batches, stockByMedicine, warningDays, today]);

  const notifItems = useMemo(() => {
    const items: Array<{
      id: string;
      severity: "critical" | "warning";
      title: string;
      count: number;
      to: string;
    }> = [];
    if (alertStats.expired > 0)
      items.push({
        id: "expired",
        severity: "critical",
        title: "Expired medicines need attention",
        count: alertStats.expired,
        to: "/admin/batches",
      });
    if (alertStats.out > 0)
      items.push({
        id: "out",
        severity: "critical",
        title: "Medicines out of stock",
        count: alertStats.out,
        to: "/admin/inventory",
      });
    if (alertStats.expiring > 0)
      items.push({
        id: "expiring",
        severity: "warning",
        title: `Medicines expiring within ${warningDays} days`,
        count: alertStats.expiring,
        to: "/admin/batches",
      });
    if (alertStats.low > 0)
      items.push({
        id: "low",
        severity: "warning",
        title: "Medicines below reorder level",
        count: alertStats.low,
        to: "/admin/inventory",
      });
    return items;
  }, [alertStats, warningDays]);

  const criticalCount = notifItems.filter(
    (n) => n.severity === "critical",
  ).length;

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return { medicines: [], batches: [] };
    const meds = medicines
      .filter(
        (m) =>
          String(m.name ?? "").toLowerCase().includes(q) ||
          String(m.genericName ?? "").toLowerCase().includes(q),
      )
      .slice(0, 5);
    const bch = batches
      .filter((b) => String(b.batchNumber ?? "").toLowerCase().includes(q))
      .slice(0, 4);
    return { medicines: meds, batches: bch };
  }, [searchQuery, medicines, batches]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch {
      setIsFullscreen(false);
    }
  };

  const admin = isAdmin(user);
  const medicineBase = admin ? "/admin/medicines" : "/medicines";

  const sidebar = (
    <div className="flex h-full flex-col bg-white">
      <Link
        to={admin ? "/admin" : "/"}
        className="flex items-center gap-2.5 px-5 py-5"
        onClick={() => setSidebarOpen(false)}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
          <Pill size={20} className="text-white" />
        </span>
        <div>
          <p className="text-lg font-bold leading-tight text-slate-900">
            PHARMA
          </p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Pharmacy Management
          </p>
        </div>
      </Link>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {sections.map((section) => {
          const isCollapsed = collapsed.has(section.title);
          return (
            <div key={section.title}>
              <button
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(section.title)) next.delete(section.title);
                    else next.add(section.title);
                    return next;
                  })
                }
                className="flex w-full items-center justify-between px-3 pb-1 pt-2"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {section.title}
                </span>
                <ChevronDown
                  size={14}
                  className={`text-slate-400 transition-transform ${
                    isCollapsed ? "-rotate-90" : ""
                  }`}
                />
              </button>
              {!isCollapsed && (
                <div className="mt-1 space-y-0.5">
                  {section.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-blue-50 text-blue-700"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        }`
                      }
                    >
                      <item.icon
                        size={18}
                        className={
                          isAdmin(user)
                            ? ""
                            : ""
                        }
                      />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {item.badge}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 px-3 py-4">
        {user && (
          <div className="mb-3 flex items-center gap-3 px-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
              {initials(user.fullName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">
                {user.fullName}
              </p>
              <p className="flex items-center gap-1 text-[11px] text-slate-400">
                <ShieldCheck size={11} />
                {user.role}
              </p>
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </div>
  );

  const sidebarShell = (
    <>
      <aside className="hidden w-[260px] shrink-0 border-r border-slate-200 lg:block">
        {sidebar}
      </aside>
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[260px] border-r border-slate-200">
            {sidebar}
          </aside>
        </div>
      )}
    </>
  );

  return (
    <div className="flex h-screen bg-slate-50">
      {sidebarShell}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-10 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <h1 className="text-base font-semibold text-slate-800 lg:hidden">
              {pageTitle}
            </h1>

            <div className="relative hidden sm:block">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                placeholder="Search medicines, barcodes, invoices, customers..."
                className="w-[320px] rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 lg:w-[380px]"
              />
              {searchOpen && searchQuery.trim() && (
                <div className="absolute left-0 right-0 top-full mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                  {searchResults.medicines.length === 0 &&
                    searchResults.batches.length === 0 && (
                      <p className="px-4 py-3 text-sm text-slate-400">
                        No results for "{searchQuery}"
                      </p>
                    )}
                  {searchResults.medicines.length > 0 && (
                    <div>
                      <p className="bg-slate-50 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Medicines
                      </p>
                      {searchResults.medicines.map((m) => (
                        <Link
                          key={m.id}
                          to={medicineBase}
                          onClick={() => {
                            setSearchOpen(false);
                            setSearchQuery("");
                          }}
                          className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-blue-50"
                        >
                          <span className="font-medium text-slate-800">
                            {m.name}
                          </span>
                          <span className="text-xs text-slate-400">
                            {stockByMedicine.get(m.id) ?? 0} in stock
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                  {searchResults.batches.length > 0 && (
                    <div className="border-t border-slate-100">
                      <p className="bg-slate-50 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Batches
                      </p>
                      {searchResults.batches.map((b) => (
                        <Link
                          key={b.id}
                          to={admin ? "/admin/batches" : "/alerts"}
                          onClick={() => {
                            setSearchOpen(false);
                            setSearchQuery("");
                          }}
                          className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-blue-50"
                        >
                          <span className="font-mono text-xs font-medium text-slate-700">
                            {b.batchNumber}
                          </span>
                          <span className="text-xs text-slate-400">
                            {b.quantityRemaining} units
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={toggleFullscreen}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>

            <div className="relative">
              <button
                onClick={() => {
                  setNotifOpen((v) => !v);
                  setProfileOpen(false);
                }}
                className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                title="Notifications"
              >
                <Bell size={18} />
                {criticalCount > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-800">
                      Notifications
                    </p>
                    <span className="text-xs text-slate-400">
                      {notifItems.length} alert(s)
                    </span>
                  </div>
                  {notifItems.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-slate-400">
                      All clear — no alerts right now.
                    </p>
                  ) : (
                    <ul className="max-h-72 overflow-y-auto">
                      {notifItems.map((n) => (
                        <li key={n.id} className="border-b border-slate-50 last:border-0">
                          <Link
                            to={n.to}
                            onClick={() => setNotifOpen(false)}
                            className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50"
                          >
                            <span
                              className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                                n.severity === "critical"
                                  ? "bg-red-500"
                                  : "bg-amber-500"
                              }`}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-slate-700">{n.title}</p>
                              <p className="text-xs text-slate-400">
                                {n.count} item(s) affected
                              </p>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => {
                  setProfileOpen((v) => !v);
                  setNotifOpen(false);
                }}
                className="ml-1 flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                  {user ? initials(user.fullName) : "?"}
                </span>
                <span className="hidden text-left md:block">
                  <span className="block text-sm font-medium leading-tight text-slate-800">
                    {user?.fullName}
                  </span>
                  <span className="block text-[11px] leading-tight text-slate-400">
                    {user?.role}
                  </span>
                </span>
                <ChevronDown size={14} className="text-slate-400" />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-800">
                      {user?.fullName}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-slate-400">
                      <ShieldCheck size={12} />
                      {user?.role === "ADMIN" ? "Administrator" : "Pharmacist / User"}
                    </p>
                  </div>
                  <div className="p-1">
                    <Link
                      to={admin ? "/admin/users" : "/alerts"}
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                    >
                      <UserRound size={16} />
                      {admin ? "User Management" : "My Alerts"}
                    </Link>
                    <Link
                      to={admin ? "/admin/settings" : "/pos"}
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                    >
                      <Settings size={16} />
                      {admin ? "System Settings" : "Point of Sale"}
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <LogOut size={16} />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
