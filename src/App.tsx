import { useEffect, useState } from "react";
import {
  HashRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { useAuthStore, isAdmin } from "./store/authStore";
import { pharmaDb } from "./db";
import { seedDatabase } from "./db/seed";
import { useEnabledModules, moduleEnabled } from "./lib/modules";
import { seedDemoData } from "./db/demoSeed";
import { ensureBaseUnitsForAll } from "./lib/units";
import { LoginPage } from "./pages/auth/LoginPage";
import { SetupWizard } from "./pages/setup/SetupWizard";
import { AdminLayout } from "./components/layout/AdminLayout";
import { UserLayout } from "./components/layout/UserLayout";
import { AdminDashboard } from "./pages/admin/Dashboard";
import { MedicinesPage } from "./pages/admin/Medicines";
import { InventoryPage } from "./pages/admin/Inventory";
import { BatchesPage } from "./pages/admin/Batches";
import { SuppliersPage } from "./pages/admin/Suppliers";
import { StockMovementsPage } from "./pages/admin/StockMovements";
import { CategoriesPage } from "./pages/admin/Categories";
import { UsersPage } from "./pages/admin/Users";
import { SettingsPage } from "./pages/admin/Settings";
import { CustomersPage } from "./pages/admin/Customers";
import { ExpensesPage } from "./pages/admin/Expenses";
import { RefundsPage } from "./pages/admin/Refunds";
import { PaymentsPage } from "./pages/admin/Payments";
import { BalancingPage } from "./pages/admin/Balancing";
import { ReportsPage } from "./pages/admin/Reports";
import { PurchaseRequestsPage } from "./pages/admin/PurchaseRequests";
import { PurchaseOrdersPage } from "./pages/admin/PurchaseOrders";
import { GrnsPage } from "./pages/admin/Grns";
import { SupplierInvoicesPage } from "./pages/admin/SupplierInvoices";
import { PurchaseReturnsPage } from "./pages/admin/PurchaseReturns";
import { SupplierCenterPage } from "./pages/admin/SupplierCenter";
import { PosPage } from "./pages/pos/POS";
import { SalesPage } from "./pages/pos/Sales";
import { PatientsPage } from "./pages/admin/Patients";
import { PatientDetailPage } from "./pages/admin/PatientDetail";
import { PrescriptionsPage } from "./pages/admin/Prescriptions";
import { ControlledMedicinesPage } from "./pages/admin/ControlledMedicines";
import { DrugSafetyPage } from "./pages/admin/DrugSafety";
import { AiAssistantPage } from "./pages/admin/Assistant";
import { AuditTrailPage } from "./pages/admin/AuditTrail";
import { StockTakesPage } from "./pages/admin/StockTakes";
import { UserDashboard } from "./pages/user/Dashboard";
import { UserMedicinesPage } from "./pages/user/Medicines";
import { UserAlertsPage } from "./pages/user/Alerts";
import { UserPaymentsPage } from "./pages/user/Payments";
import { UserRefundsPage } from "./pages/user/Refunds";
import { UserPatientsPage } from "./pages/user/Patients";
import { UserPatientDetailPage } from "./pages/user/PatientDetail";
import { UserPrescriptionsPage } from "./pages/user/Prescriptions";

function RequireAuth({
  role,
  children,
}: {
  role?: "ADMIN" | "USER";
  children: React.ReactNode;
}) {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (role && !isAdmin(user) && role === "ADMIN") {
    return <Navigate to="/" replace />;
  }
  if (role === "USER" && isAdmin(user)) {
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}

function SetupGuard({ children }: { children: React.ReactNode }) {
  const setupComplete = useLiveQuery(async () => {
    const row = await pharmaDb.systemSettings
      .where("settingKey")
      .equals("setup_complete")
      .first();
    return row?.settingValue === "true";
  }, []);
  const location = useLocation();

  if (setupComplete === undefined) {
    return <LoadingScreen />;
  }
  if (!setupComplete && location.pathname !== "/setup") {
    return <Navigate to="/setup" replace />;
  }
  return <>{children}</>;
}

function ModuleGuard({
  moduleId,
  children,
}: {
  moduleId: string;
  children: React.ReactNode;
}) {
  const enabled = useEnabledModules();
  if (enabled === undefined) {
    return <LoadingScreen />;
  }
  if (!moduleEnabled(enabled, moduleId)) {
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupWizard />} />
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/admin"
        element={
          <RequireAuth role="ADMIN">
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="pos" element={<PosPage />} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="medicines" element={<MedicinesPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="batches" element={<BatchesPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="stock-movements" element={<StockMovementsPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="refunds" element={<RefundsPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="balancing" element={<BalancingPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route
          path="purchase-requests"
          element={
            <ModuleGuard moduleId="PROCUREMENT">
              <PurchaseRequestsPage />
            </ModuleGuard>
          }
        />
        <Route
          path="purchase-orders"
          element={
            <ModuleGuard moduleId="PROCUREMENT">
              <PurchaseOrdersPage />
            </ModuleGuard>
          }
        />
        <Route
          path="grns"
          element={
            <ModuleGuard moduleId="PROCUREMENT">
              <GrnsPage />
            </ModuleGuard>
          }
        />
        <Route
          path="supplier-invoices"
          element={
            <ModuleGuard moduleId="PROCUREMENT">
              <SupplierInvoicesPage />
            </ModuleGuard>
          }
        />
        <Route
          path="purchase-returns"
          element={
            <ModuleGuard moduleId="PROCUREMENT">
              <PurchaseReturnsPage />
            </ModuleGuard>
          }
        />
        <Route
          path="supplier-center"
          element={
            <ModuleGuard moduleId="SUPPLIER_CENTER">
              <SupplierCenterPage />
            </ModuleGuard>
          }
        />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit" element={<AuditTrailPage />} />
        <Route
          path="stock-takes"
          element={
            <ModuleGuard moduleId="STOCK_TAKES">
              <StockTakesPage />
            </ModuleGuard>
          }
        />
        <Route
          path="patients"
          element={
            <ModuleGuard moduleId="PATIENTS">
              <PatientsPage />
            </ModuleGuard>
          }
        />
        <Route
          path="patients/:id"
          element={
            <ModuleGuard moduleId="PATIENTS">
              <PatientDetailPage />
            </ModuleGuard>
          }
        />
        <Route
          path="prescriptions"
          element={
            <ModuleGuard moduleId="PRESCRIPTIONS">
              <PrescriptionsPage />
            </ModuleGuard>
          }
        />
        <Route
          path="controlled-medicines"
          element={
            <ModuleGuard moduleId="CONTROLLED_MEDICINES">
              <ControlledMedicinesPage />
            </ModuleGuard>
          }
        />
        <Route
          path="drug-safety"
          element={
            <ModuleGuard moduleId="SAFETY_ENGINE">
              <DrugSafetyPage />
            </ModuleGuard>
          }
        />
        <Route
          path="assistant"
          element={
            <ModuleGuard moduleId="AI_ASSISTANT">
              <AiAssistantPage />
            </ModuleGuard>
          }
        />
      </Route>

      <Route
        path="/"
        element={
          <RequireAuth>
            <UserLayout />
          </RequireAuth>
        }
      >
        <Route index element={<UserDashboard />} />
        <Route path="pos" element={<PosPage />} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="medicines" element={<UserMedicinesPage />} />
        <Route path="alerts" element={<UserAlertsPage />} />
        <Route path="payments" element={<UserPaymentsPage />} />
        <Route path="refunds" element={<UserRefundsPage />} />
        <Route
          path="patients"
          element={
            <ModuleGuard moduleId="PATIENTS">
              <UserPatientsPage />
            </ModuleGuard>
          }
        />
        <Route
          path="patients/:id"
          element={
            <ModuleGuard moduleId="PATIENTS">
              <UserPatientDetailPage />
            </ModuleGuard>
          }
        />
        <Route
          path="prescriptions"
          element={
            <ModuleGuard moduleId="PRESCRIPTIONS">
              <UserPrescriptionsPage />
            </ModuleGuard>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <div className="flex flex-col items-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-pharma-200 border-t-pharma-600" />
        <p className="mt-4 text-sm font-medium text-slate-500">
          Starting PHARMA...
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    seedDatabase()
      .then(() => seedDemoData())
      .then(() => ensureBaseUnitsForAll())
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return <LoadingScreen />;
  }

  return (
    <HashRouter>
      <SetupGuard>
        <AppRoutes />
      </SetupGuard>
    </HashRouter>
  );
}
