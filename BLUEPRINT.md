# PHARMA — Product Blueprint (Upgraded)

> Pharmacy Operations Management System
> POS · Inventory · Procurement · Dispensing · Patient Management · Finance · Compliance · Analytics · Automation

**Version:** 2.0 (Full System Audit)
**Status:** Blueprint — design only, not final code
**Guiding rule:** the current PHARMA system is the base and is never removed, simplified, or replaced. Everything in this blueprint is additive.

---

## 1. Strategy & Positioning

### 1.1 Goal shift
We stop thinking of PHARMA as *"a pharmacy billing and stock application"* and treat it as a **complete Pharmacy Operations Management System** that can serve every category of medical facility — from a small drug shop to a multi-branch pharmacy group — from a **single product and a single database**.

### 1.2 One platform, all business sizes

```
                          💊 PHARMA
                             │
              ┌──────────────┴───────────────┐
              │                              │
    CURRENT PHARMA MODEL              ADVANCED MODULES
       (BASE SYSTEM)                  (ADDITIVE LAYERS)
              │                              │
     Small Drug Shops            Medium Pharmacy
     Small Pharmacies            Large Pharmacy
              │                  Multi-Branch, Warehouse
              └───────────────┬──────────────┘
                              │
                   SAME PHARMA PLATFORM
```

### 1.3 Growth without migration
A drug shop that starts on PHARMA today can grow into a multi-branch enterprise **without ever migrating its data**. The database schema is designed up-front for all modules; modules are *activated*, not installed separately.

---

## 2. Architecture: Core + Tiers

### 2.1 The tier model

| Tier | Name | What it means |
|------|------|---------------|
| 🟢 **Essential** | The everyday PHARMA | Sales, medicines, inventory, payments, expiry, refunds, reports, balancing. **This is the current system, unchanged.** |
| 🟠 **Professional** | Growing businesses | Procurement, supplier center, purchase orders/GRN, supplier accounts, advanced inventory (stock takes, locations, transfers, quarantine), customer credit, corporate accounts, shifts/cash drawer, profitability. **Patient profiles + prescriptions + dispensing** (outpatient pharmacy workflow). |
| 🔵 **Advanced** | Professional pharmacy | **Inpatient support**: admissions, wards, beds, transfers, discharge, medication orders, medication administration records (MAR). Controlled medicines, drug safety engine, medicine knowledge base, smart expiry + loss prediction, recall, traceability, ADR, **patient billing + insurance**. |
| 🔴 **Enterprise** | Large / multi-site | Branches, warehouses, stock transfers, central purchasing, consolidated reports, cold chain, demand forecasting, BI analytics, AI assistant, **multi-facility patient/pharmacy operations + centralized reporting + integrations**. |

### 2.2 Module activation (feature registry)

Modules are controlled by a **feature registry** stored in `systemSettings` (key `enabled_modules`). Structure:

```
enabled_modules = {
  "PROCUREMENT": true,
  "SUPPLIER_CENTER": true,
  "PATIENTS": false,
  "PRESCRIPTIONS": false,
  "ADMISSIONS": false,
  "WARDS": false,
  "MEDICATION_ORDERS": false,
  "MEDICATION_ADMIN": false,
  "PATIENT_BILLING": false,
  "INSURANCE": false,
  "CONTROLLED_MEDICINES": false,
  "SAFETY_ENGINE": false,
  "KNOWLEDGE_BASE": false,
  "RECALL": false,
  "STOCK_TAKES": false,
  "LOCATIONS": false,
  "TRANSFERS": false,
  "QUARANTINE": false,
  "CREDIT_ACCOUNTS": false,
  "CORPORATE_ACCOUNTS": false,
  "SHIFTS": false,
  "CASH_DRAWER": false,
  "COLD_CHAIN": false,
  "BRANCHES": false,
  "ANALYTICS": false,
  "AI_ASSISTANT": false,
  "EXPIRY_RECALL": false,
  "NOTIFICATIONS": false,
  "DOCUMENTS": false,
  "RETURNS_MANAGEMENT": false,
  "RECONCILIATION": false,
  "INVENTORY_CONTROL": false,
  "AUDIT_COMPLIANCE": false,
}
```

- Every module in the audit (section 5.0) maps to exactly one registry key; **Core modules have no key — they are always on and cannot be disabled.**
- Cross-system engines (`NOTIFICATIONS`, `RETURNS_MANAGEMENT`, `RECONCILIATION`, `INVENTORY_CONTROL`, `AUDIT_COMPLIANCE`, `DOCUMENTS`) activate automatically with any module that depends on them (e.g., `RECALL`/`EXPIRY_RECALL` forces `NOTIFICATIONS` + `RETURNS_MANAGEMENT`).

- Nav sections, dashboard widgets, POS behaviors, and reports read the registry.
- **Essential modules are always on and cannot be disabled.**
- A small business sees only their familiar base screens; the database is already ready for everything else.

### 2.3 Single database, additive schema
All new stores are added via new Dexie schema versions. **No existing table is dropped or reshaped in a breaking way.** Migrations are additive + backfill (the pattern already used in `db/index.ts` v6→v8).

---

## 3. Configuration Model

### 3.1 Business setup (first-time onboarding)
On first run, PHARMA runs a **Business Setup Wizard** (skippable; admin can re-run from Settings → Configuration). The wizard asks **business questions, not technical ones**:

**Step 1 — Business type**
`Drug Shop` · `Pharmacy` · `Hospital / Clinic Pharmacy` · `Pharmacy Group`

**Step 2 — Business size**
`Small (1 location, small team)` · `Medium (1 location, several employees)` · `Large (large inventory, departments)` · `Multiple locations`

**Step 3 — Number of locations** (1 / 2–5 / 6+) — if >1, activates branch framework and asks branch names.

**Step 4 — Number of users** — informs permission scaffolding (cashier, pharmacist, storekeeper, manager, admin).

**Step 5 — What do you want PHARMA to manage?** — pre-ticked core requirements + optional module checkboxes:
- Core (always): Medicine Sales · Stock · Expiry Dates · Payments · Sales Reports · Book Balancing · Refunds
- Optional: Suppliers & Procurement · Patients · Prescriptions · Customer Credit · Corporate/Insurance · Multiple Branches · Warehouse · Advanced Accounting · Controlled Medicines · Cold Chain · Advanced Analytics

**Step 6 — Business identity** — pharmacy name, address, phone, currency, invoice prefix, receipt footer (reuses existing Settings fields).

**Outcome** — PHARMA maps the answers to a configuration:

| Example business | Answers | Resulting config |
|---|---|---|
| Small drug shop | Drug Shop, Small, 1 loc, 2 users, core needs | **Essential** |
| Medium pharmacy | Pharmacy, Medium, 1 loc, 8 users, +suppliers/patients/prescriptions | **Essential + Professional + Advanced** |
| Large group | Pharmacy Group, Large, 3 loc, 35 users, everything | **Essential + Professional + Advanced + Enterprise** |

### 3.2 Upgrade path
`Settings → Configuration` can re-run the wizard at any time. Upgrading a business activates more modules **in place** — no data loss, no re-setup of medicines, batches, sales, or payments.

### 3.3 Roles
The current `ADMIN` / `USER` model stays intact and remains the access layer. Advanced tiers introduce **permission groups** (cashier, pharmacist, storekeeper, manager) as an additive role system, never replacing the existing Admin/User roles.

---

## 4. Current System Inventory (Essential — unchanged)

### 4.1 What ships today (verified against code)
- **Accounts:** Admin / User roles, password auth, protected routes.
- **Medicine management:** name, generic, strength, category, barcode, batch, expiry, sell/purchase price, minimum stock, reorder level; dosage-form categories (Tablet, Capsule, Syrup, Injection, Cream, Ointment, Drops, Suspension, Sachet).
- **Packaging intelligence:** box → strip → tablet with stock held in the **base unit**; per-unit sell/purchase flags, prices, barcodes, conversion factors.
- **Barcode / POS:** USB & Bluetooth scanner-ready input, 1D/2D lookup, auto-add + quantity accumulation, unknown-barcode handling, duplicate-barcode protection, internal barcode generation, barcode printing, manual search/code/quantity/unit, hold/recall sales, POS shortcuts, offline local DB.
- **Payments:** Cash, Mobile Money (MTN/Airtel-style gateway architecture), Bank, Card, PayPal, Other; split payments; full lifecycle statuses (PENDING…SUCCESS/FAILED/DECLINED/CANCELLED/TIMEOUT/UNKNOWN/EXPIRED); PAY-`date`-`seq` references; provider references; gateway config per provider; provider event timelines. **PINs are never handled by PHARMA** — providers own authentication.
- **Refunds & Returns (customer):** verify receipt/batch/condition, partial or full refund, restock to batch, negative payment + REFUND transaction with its own PAY reference, REFUND audit log.
- **Inventory:** batch tracking, FEFO pick, expiry dates, low/out-of-stock, barcode receiving, adjustments, stock movements (PURCHASE/SALE/RETURN/ADJUSTMENT/DAMAGE/EXPIRY/TRANSFER), packaging conversion.
- **Suppliers:** basic supplier register (name, contact, phone, email, address, TIN, status).
- **Customers:** register + credit (customer payments) foundation.
- **Expenses:** categories, amounts, dates, recorded-by.
- **Finance:** Book Balancing page, period stats (sales/refunds/expenses), profitability view.
- **Payments & Transactions page:** recent transactions, filters, provider timeline.
- **Reports & Analytics:** revenue, payment split, top sellers, period reports.
- **Settings:** pharmacy identity, currency, low-stock threshold, invoice prefix, receipt footer, gateway configuration.

### 4.2 Database stores today (all retained)
`roles · users · medicineCategories · medicines · medicineBarcodes · medicineUnits · suppliers · medicineBatches · stockMovements · customers · sales · saleItems · customerPayments · expenses · systemSettings · auditLogs · payments · paymentTransactions · paymentProviderEvents · paymentGateways · heldSales · refunds · refundItems`

---

## 5. Module Specifications (additive)

Each module lists: tier, purpose, key UX, data-model additions, rules, and reporting hooks.

### 5.0 Complete Module Audit — the official module map

The table below is the **master checklist**. Every row is an official PHARMA module. Nothing here is an optional idea; rows marked ⚠️ or "must expand" are fully specified in their own subsection below. All advanced modules sit **above the same core database** and activate via `enabled_modules` — a small drug shop never sees them, a hospital pharmacy can enable them all without a different system.

| Module | Level | Status | What it must contain |
|---|---|---|---|
| 🏠 Dashboard | Core | ✅ | KPIs, charts, alerts, activity |
| 🛒 POS / Sales | Core | ✅ | Manual + barcode sales, cart, returns |
| 💊 Medicines | Core | ✅ | Registration, categories, pricing, packaging |
| 📦 Inventory | Core | ✅ | Stock, batches, movements, adjustments |
| 💳 Payments | Core | ✅ | Cash, mobile money, bank, card, online |
| 🧾 Billing / Invoices | Core | ✅ | Invoices, receipts, refunds |
| 👥 Customers | Core | ✅ | Customer profiles, history, credit |
| 🏭 Suppliers | Core | ✅ | Supplier management |
| 🛍 Procurement | Professional | ✅ | Purchase orders, receiving, returns |
| 💰 Finance | Professional | ✅ | Revenue, expenses, receivables/payables |
| 📊 Reports | Core | ✅ | Sales, stock, finance, payments |
| ⚖️ Book Balancing | Core | ✅ | Cash/session reconciliation |
| 👤 Users & Roles | Core | ✅ | Admin/User + permissions |
| 🔐 Audit Trail | Professional | ✅ | Complete activity tracking |
| 🔔 Notifications | Core | ✅ | Stock, expiry, payment alerts (central engine, §5.24.4) |
| 👨‍⚕️ Patients | Advanced | ✅ Must expand | Profiles, history, admissions (§5.10–5.11) |
| 📋 Prescriptions & Dispensing | Advanced | ✅ Must expand | Prescription → pharmacy → dispensing (§5.12) |
| 🔒 Controlled Medicines | Advanced | ⚠️ Needs full module | Restricted-drug register and controls (§5.13) |
| ⚠️ Drug Safety Alerts | Advanced | ⚠️ Needs full module | Allergies, interactions, warnings (§5.14) |
| 📚 Medicine Knowledge Base | Advanced | ⚠️ Needs full module | Structured medicine information (§5.15) |
| 🚨 Expiry & Recall | Advanced | ⚠️ Needs full module | Recall, quarantine, sale holds (§5.7) |
| ❄️ Cold Chain | Enterprise | ⚠️ Needs full module | Temperature monitoring (§5.22) |
| 🏢 Multiple Branches | Enterprise | ✅ Must expand | Branches, warehouses, transfers (§5.23) |
| 📈 Analytics | Enterprise | ⚠️ Needs full module | Demand forecasting, expiry risk, slow movers, anomaly flags (§5.21) |
| 🤖 AI Assistant | Enterprise | ⚠️ Needs full module | Pharma Intelligence chat over PHARMA data — flag-only, cannot change records; depends on Analytics (§5.21) |

**Cross-system engines** (formally accounted for, §5.24): Payment/Reconciliation Engine · Inventory Control Engine · Returns Management · Notification Engine · Document Management · Audit/Compliance Engine.

**Master design rule:** modules may be activated per facility, but they all operate on the same PHARMA database and the same core workflows. A hospital pharmacy enabling everything still uses the exact same POS, medicines, inventory, and payments the small drug shop uses.

### 5.1 Procurement (Professional) — highest-priority gap

**Lifecycle**
```
Supplier
  ↓
Purchase Request (internal need, optional approvals)
  ↓
Purchase Order (PO) → sent to supplier
  ↓
Supplier Confirmation
  ↓
Goods Received → Batch/Expiry verification → GRN
  ↓
Stock updated (batches created/restocked, FEFO-ready)
  ↓
Supplier Invoice → Supplier Account
  ↓
Payment (ties into existing payment engine) / Credit
```

**Screens:** Purchase Requests · Purchase Orders · Goods Received Notes (GRN) · Supplier Invoices · Supplier Payments · Purchase Returns · Supplier Statements.

**Data-model additions**
- `purchaseRequests` (lines, status, requestedBy, approvals)
- `purchaseOrders` (supplierId, status, expectedDate, terms) + `purchaseOrderItems`
- `grns` (poId, receivedAt, receivedBy, lines) + `grnItems`
- `supplierInvoices` (grnId, amount, tax, dueDate, status)
- `supplierPayments` (invoiceId, amount, method → payment engine ref)
- `purchaseReturns` (supplierId, grnId, lines, creditNoteRef, reason)

**Rules:** No stock increase without a GRN; GRN requires batch number + expiry verification; FEFO enforced on receive; purchase returns generate **credit notes** and negative stock movement; supplier balance = sum(invoices) − sum(payments) − sum(credit notes).

### 5.2 Supplier Center (Professional)

**Screens:** Supplier list/detail; per-supplier: products supplied, price history, average delivery time, returns, performance rating, outstanding balance, payment terms, credit limit, contact/TIN.

**Data-model additions**
- `supplierProducts` (supplierId, medicineId, latestUnitCost)
- `supplierPriceHistory` (supplierId, medicineId, unitId, price, effectiveFrom, raisedBy)
- `supplierPerformance` (supplierId, onTimeDeliveries, returns, avgLeadDays, rating)

**Purchasing intelligence:** price-comparison matrix per medicine across suppliers ("Amoxicillin: A 4,500 · B 4,300 · C 4,600"), best-price & best-reliability ranking. Flags supplier **price increases** (e.g. "Amoxicillin +12%").

### 5.3 Automatic Reordering & Demand Forecasting (Professional + Enterprise)

**Logic:** `qty to order = (avgDailySales × leadTimeDays + safetyStock) − currentStock − onOrder`.
- Safety stock from `reorderLevel`/`minimumStock`.
- Lead time averaged from `supplierPerformance.avgLeadDays` per supplier-product.
- Renders **"Order recommended"** with a one-click **Purchase Order Draft**.
- Enterprise tier: trend-based forecasting (moving average of last N weeks by `saleDateKey`).

**Data-model additions:** `reorderRecommendations` (generated snapshots) · fields on `supplierProducts` (`leadTimeDays`, `safetyStock`).

### 5.4 Stock Taking & Variance (Professional)

**Screens:** Create Stock Take (scope by location/category) → list SYSTEM vs PHYSICAL per medicine → variance → reason → **Submit for Approval**.

**Data-model additions**
- `stockTakes` (status, createdBy, approvedBy, countedAt, approvedAt)
- `stockTakeItems` (stockTakeId, medicineId, batchId, systemQty, physicalQty, variance, reason)

**Rules:** Variance approved → applies adjustment via existing `stockMovements` (ADJUSTMENT type) + audit log; unapproved takes do not touch stock. Feeds **Book Balancing**.

### 5.5 Locations / Bins (Professional)

**Model:** `MAIN PHARMACY → Front Counter | Prescription Store | Warehouse | Cold Room | Controlled Drug Store`, each with Shelf/Bin addressing. Medicine batches get `locationId`; POS shows "Stock available — Warehouse A / Shelf 04 / Bin 12".

**Data-model additions**
- `storageLocations` (parentId, name, type: COUNTER|SHELF|BIN|COLD|CONTROLLED|QUARANTINE, temperatureZone?)
- `medicineBatches.locationId` (additive field)

### 5.6 Transfers & Quarantine (Professional)

**Screens:** Stock Transfer (source → destination location/branch, lines, reason, approval), Quarantine bin (hold batch pending investigation).

**Data-model additions**
- `stockTransfers` + `stockTransferItems` (fromLocation/toLocation/branch, status, approvedBy)
- Uses existing `MovementType.TRANSFER` in `stockMovements`.

**Rules:** Transfer reduces source and increases destination atomically; quarantine blocks the batch from sale (see recall).

### 5.7 Expiry & Recall (Advanced + Enterprise)

A full safety module that owns **expiry**, **recall**, **quarantine**, **sale holds**, **supplier returns**, and **disposal** — and coordinates with Cold Chain (§5.22) and the Notification Engine (§5.24.4). The SAFETY ENGINE rule (§5.14) is: recall → **SALE HOLD**, cold-chain excursion → **QUARANTINE**, both blocking sale until authorized review.

```
Expiry & Recall
│
├── Expiring Soon
├── Expired
├── Recall Notices
├── Affected Batches
├── Quarantine
├── Sale Holds
├── Supplier Returns
├── Disposal
└── Recall History
```

**Expiry classification (replaces flat "expiring soon"):**

```
🟢 Safe            beyond 6 months
🟡 Amber           6 months
🟠 Warning         3 months
🔴 Critical        30 days
⛔ Expired         past expiry date
```

**Screens:** Expiry Management summary buckets (Next 30 days / 31–60 / 61–90 / 3–6 months / Expired). **Expired batches are blocked from sale** at POS and by the service layer (defense in depth).

**Expiry loss prediction:** per batch `stock, monthly sales rate, months-to-expiry → expected unsold`. Outputs **expiry risk** (low/medium/high) + suggestions: contact supplier for return, flag for review, clearance strategy. Snapshots stored for trend reporting.

**Recall Center:** search batch/medicine; shows where received, current stock per location/branch, how much sold, which transactions involved, customers affected. Actions:
- Place batch(es) on **SALE HOLD** across every branch/warehouse holding the batch.
- Record recall reference, reason, scope, status, initiator.
- Generate **Recall Notices** for affected customers/transactions (derived from sale/batch traces).
- Route affected stock to **Quarantine** → then **Supplier Return** or **Disposal**.

**Rules:**
- A batch on hold **cannot be sold** — POS and the service layer both block it (defense in depth).
- Quarantine is a location state, not a sale: quarantined stock is excluded from sellable FEFO picking.
- A manufacturer recall of `AMX-2026-0031` that exists in Warehouse, Branch A, and Branch B automatically places the batch on hold in **all** of them.
- Recall history retained for NDA inspection (§7).

**Data-model additions**
- `recalls` (medicineId, batchId, reference, reason, scope, status, initiatedBy, date)
- `recallNotices` (recallId, customerId, saleId, notifiedAt) — derived from sale/batch traces
- `expiryRiskSnapshots` (batchId, stockAtRisk, riskLevel, generatedAt)
- `quarantineRecords` (batchId, locationId, reason: RECALL|COLD_CHAIN|QUALITY|OTHER, startedAt, resolvedAt, resolvedBy, resolution: RELEASE|RETURN|DISPOSE)
- `saleHolds` (batchId, reason, placedBy, placedAt, liftedBy, liftedAt)

### 5.8 Traceability & Inventory Audit Trail (Advanced)

Every unit gets a life: `Received → Sold → Returned → Damaged → Expired → Current`. Every movement records who/what/when/why + before/after quantities (already largely present in `stockMovements` + `auditLogs`; extend with `beforeQty`/`afterQty` on batch where missing).

### 5.9 Adjustment Control (Professional)

**Screens:** Stock Adjustment form showing *current → new → reason* with reason codes (Damaged, Expired, Lost, Theft, Counting correction, Return, Other) + comment. Sensitive adjustments (Theft, large negative) require **Admin approval**.

**Rules:** No direct "set stock = N". Adjustments are movements with reason + approver.

### 5.10 Patient Management (Professional + Advanced)

> **Architectural boundary:** PHARMA remains a pharmacy management platform with a powerful healthcare/patient module — not a full Hospital Information System. Clinical systems (laboratory, radiology, surgery scheduling, nursing documentation) remain separate; PHARMA integrates with them where relevant.

**Tier scope:**
- **Professional** (outpatient): patient profiles, medication history, prescription history, allergies, referring doctor, dispensing. Pharmacy workflow: Registration → Consultation → Prescription → Pharmacy → Payment → Exit.
- **Advanced** (inpatient): admissions, wards, beds, transfers, discharge, medication orders, medication administration records (MAR), patient billing, insurance. Full lifecycle: Registration → Admission → Ward → Bed → Treatment → Prescription → Pharmacy → Medication Administration → Billing → Discharge.

#### 5.10.1 Patient Registration

**Auto-generated Patient Number** — `PAT-YYYY-NNNNNN` (e.g., `PAT-2026-000146`). Never reused, never editable by normal users. Internal ID (`patientId`) is a UUID for database uniqueness; Patient Number is the human-facing identifier.

**Registration form:**
```
Patient Number    PAT-2026-000146  🔒 AUTO GENERATED
First Name        [____________]
Middle Name       [____________]
Last Name         [____________]
Date of Birth     [____________]
Sex               [____________]
Phone             [____________]
Email             [____________]
Address           [____________]
Nationality       [____________]
Emergency Contact [____________]
National ID       [____________]
Insurance Number  [____________]
Blood Group       [____________]
Known Allergies   [____________]
Medical Conditions[____________]
Chronic Conditions[____________]
```

**Duplicate detection:** before creating, PHARMA checks name + DOB + phone against existing patients and shows "Possible existing patient found" with option to open existing or register new.

**Patient statuses:** `REGISTERED` · `OUTPATIENT` · `ADMITTED` · `TRANSFERRED` · `DISCHARGED` · `DECEASED`. Sensitive statuses are permission-controlled.

#### 5.10.2 Patient Dashboard

When staff open a patient record (e.g., `PAT-2026-000145`):

```
PATIENT: John Doe                    PAT-000145
Age: 46   Sex: Male   Phone: XXXXXXX
Allergies: Penicillin

┌────────────┬────────────┬──────────────┐
│ Visits     │ Prescriptions │ Admissions  │
│ 18         │ 27            │ 3           │
└────────────┴────────────┴──────────────┘

Current Medications · Medication History · Recent Visits
```

#### 5.10.3 Patient Timeline

Chronological view of all patient events across encounters:

```
04 Aug 2026
├── Admitted — Medical Ward, Bed B-24
├── Doctor consultation — Dr. Smith
├── Prescription RX-2026-000421 created
├── Medicines dispensed (Amoxicillin x15, Paracetamol x20)
├── Payment completed — UGX 75,000
└── Medication administered — Amoxicillin 500mg oral

05 Aug 2026
├── Medication administered — Amoxicillin 500mg oral
├── New prescription RX-2026-000422
└── Medicine dispensed (Metformin x30)
```

#### 5.10.4 Patient Search

Multi-field search: Patient Number · Name · Phone · National ID · Insurance Number · Admission Number · Prescription Number. Barcode/QR on patient cards for instant lookup.

**Data-model additions**
- `patients` (patientNumber, firstName, middleName, lastName, dob, sex, phone, email, address, nationality, emergencyContact, nationalId, insuranceNumber, bloodGroup, medicalConditions, chronicConditions, status, branchId)
- `patientContacts` (patientId, type, name, phone, relationship)
- `patientIdentifiers` (patientId, type, value) — for barcode/QR/external IDs
- `patientAllergies` (patientId, allergen, severity, reaction, recordedBy)
- `patientMedicalHistory` (patientId, condition, onsetDate, resolutionDate, notes, recordedBy)

### 5.11 Admission Management (Advanced)

#### 5.11.1 Admissions

**Admission Number** — `ADM-YYYY-NNNNN` (e.g., `ADM-2026-00182`). Auto-generated, permanent, non-reusable.

```
Admission Number    ADM-2026-00182
Patient             PAT-2026-000145 — John Doe
Admission Date      04 Aug 2026
Admission Time      09:42
Reason              [____________]
Department          [____________]
Ward                Medical Ward
Bed                 B-24
Attending Clinician [____________]
Status              ADMITTED
```

#### 5.11.2 Ward Management

```
WARD                 BEDS    OCCUPIED   AVAILABLE   RESERVED
Medical Ward         40      31         7           2
Surgical Ward        30      22         6           2
Pediatric Ward       25      17         8           0
Maternity            20      14         5           1
Emergency            15      12         3           0
ICU                  10      9          1           0
Private Ward         8       5          2           1
```

**Data-model additions:** `wards` (name, totalBeds, department, status) · `beds` (wardId, bedNumber, status: AVAILABLE|OCCUPIED|RESERVED|CLEANING|MAINTENANCE)

#### 5.11.3 Bed Management

Each bed tracks status. Admission flow: Select Ward → Select Available Bed → Assign Bed. PHARMA records the assignment.

#### 5.11.4 Patient Transfer

Between wards: old ward/bed → new ward/bed + reason + authorized user + timestamp. Previous location remains in history. Bed auto-freed at old ward.

#### 5.11.5 Discharge

**Discharge Number** — `DSC-YYYY-NNNNN`. Records: patient, admission, date/time, reason, condition, discharge instructions, responsible clinician. Bed automatically becomes available.

**Data-model additions**
- `admissions` (admissionNumber, patientId, admissionDate, admissionTime, reason, department, wardId, bedId, attendingClinician, status, admittedBy)
- `discharges` (dischargeNumber, admissionId, dischargeDate, dischargeTime, reason, condition, instructions, clinician, dischargedBy)
- `transfers` (admissionId, fromWardId, fromBedId, toWardId, toBedId, reason, authorizedBy, transferredAt)
- `bedAssignments` (admissionId, wardId, bedId, assignedAt, releasedAt)

### 5.12 Prescriptions, Medication Orders & Dispensing (Advanced)

#### 5.12.1 Enhanced Prescription Workflow

**Prescription Number** — `RX-YYYY-NNNNN`. Auto-generated, permanent.

For **outpatients**: Prescription → Verification → Patient → Availability → Pharmacist review → Dispensing → Payment → Receipt.

For **inpatients**: Prescription → Admission → Clinical Encounter → Prescription → Medication Order → Pharmacy → Dispensing → Medication Administration.

#### 5.12.2 Medication Orders

Clinician prescribes with full detail:

```
Medicine        Amoxicillin 500mg
Dose            500mg
Route           Oral
Frequency       3 times daily
Duration        5 days
Quantity        15
Start Date      04 Aug 2026
End Date        08 Aug 2026
Instructions    Take after food
```

#### 5.12.3 Pharmacy Verification

Before dispensing: Patient → Prescription → Medicine → Stock → Batch → Expiry → Allergy warning → Dispense. Pharmacist verifies before release.

#### 5.12.4 Medication Administration Records (MAR)

For admitted patients, dispensing ≠ administration. Flow: Pharmacy dispenses → Ward receives → Nurse administers → Administration recorded.

```
PATIENT: PAT-000145

Medication        08:00   12:00   16:00   20:00
──────────────────────────────────────────────────
Amoxicillin 500mg   ✓       ✓       ✓       ○
Paracetamol 500mg   ✓       ○       ✓       ○

✓ = Administered   ○ = Pending   ✕ = Not administered
```

Each action records: user, date, time, dose, route, reason if not administered.

**Data-model additions**
- `prescriptions` (prescriptionNumber, patientId, admissionId?, doctorId/name, status, fileAttachment, prescribedDate)
- `prescriptionItems` (medicineId, strength, dosage, frequency, duration, quantity, instructions, dispensedQty, batchId)
- `medicationOrders` (prescriptionItemId, dose, route, frequency, duration, startDate, endDate, status, prescribedBy)
- `dispensingRecords` (prescriptionItemId, batchId, qty, dispensedBy, dispensedAt)
- `medicationAdministration` (medicationOrderId, administeredBy, administeredAt, dose, route, status: GIVEN|OMITTED|DELAYED, reason, wardId)
- `referringDoctors` (name, practice, phone, license)

**Rules:** dispensing records satisfy Ugandan prescription-record requirements (date, ingredients/quantity, patient, prescriber). Prescription lines flow into POS as a dispensable cart. MAR is the authoritative record for inpatient medication tracking.

### 5.13 Controlled Medicines (Advanced)

Its own sidebar module: **Controlled Medicines** — much more than tagging a medicine "restricted."

**Medicine registration adds `controlCategory`:**

```
○ General Sale (OTC)
○ Pharmacy Only (P)
○ Prescription Only (POM)
○ Controlled / Restricted (CDR)
```

**Controlled Drug Register** — the authoritative ledger for every CDR movement:

```
Controlled Drug Register
Medicine    Batch    Received    Dispensed    Returned    Destroyed    Current Balance
Opium tincture  OP-001  1,000       350          10          20           620
```

**Every register transaction records:** Patient · Prescription · Prescriber · Pharmacist · Date · Time · Quantity · Batch · Reason.

**Extra controls:**
- **Restricted access** — only users with the controlled-medicine permission group see/use the register.
- **Authorized users** — named, recorded on every transaction.
- **Dual authorization where required** — e.g., a second authorized user must confirm disposal, significant returns, or balance adjustments.
- **Controlled stock adjustments** — never a raw stock edit; adjustments go through the register with reason + second approver.
- **Returns** (customer returns of controlled items), **Loss/damage**, **Disposal** (witnessed, dual-authorized, documented), and **Balance reconciliation** (periodic count vs register balance; discrepancies create an incident + audit entry).
- **Complete audit trail** — every action lands in the Audit & Compliance Engine (§5.24.6).

**Workflow:** dispensing a CDR line → pharmacist authorization required → registers the movement against the batch running balance → deduction ties to both the register and the inventory batch (single source of truth for stock). POS blocks CDR sales without pharmacist authorization.

**Internal issue/receive:** `controlRequisitions` moves stock between the controlled store and counters; each leg is a register entry.

**Data-model additions**
- `Medicine.controlCategory` (additive field; default "GENERAL")
- `controlledDrugRegister` (batchId, transactionType: RECEIVED|DISPENSED|RETURNED|DESTROYED|ADJUSTMENT, openingBalance, quantity, balanceAfter, patientId, prescriptionId, prescriberId, pharmacistId, secondAuthorizerId, reason, recordedAt)
- `controlRequisitions` (internal issue/receive between controlled store and counters)
- `controlledDrugCounts` (batchId, countedBalance, registerBalance, variance, countedBy, countedAt, status)

### 5.14 Drug Safety Alerts (Advanced)

Clinical **decision-support only** — never diagnosis or prescribing. The pharmacist remains responsible. These are the automated checks:

**Screens:** on dispensing (and on prescription creation), PHARMA evaluates the patient + medicine set and shows:

- **Allergy** — patient allergy (e.g., Penicillin) vs selected medicine (e.g., Amoxicillin) → `⚠ ALLERGY ALERT` (hard warning + authorized override).
- **Interaction** — medicine A + B → `⚠ POTENTIAL INTERACTION` with severity + detail [View details] [Continue — pharmacist override].
- **Duplicate therapy** — same active ingredient / ATC class already on the prescription → `⚠ DUPLICATE THERAPY WARNING`.
- **Dose-related** alerts where supported (max daily dose vs frequency × strength).
- **Age-related** warnings (adult/pediatric/geriatric dosing notes).
- **Pregnancy / lactation** warnings where appropriate.
- **Contraindication** information from the Knowledge Base (§5.15).

```
             SAFETY ENGINE
                  │
       ┌──────────┼──────────┐
       ↓          ↓          ↓
   Allergy     Recall     Cold Chain
       │          │          │
       ↓          ↓          ↓
   WARNING     SALE HOLD   QUARANTINE
```

The same engine drives §5.7 (recall → sale hold) and §5.22 (cold chain → quarantine); drug-safety checks add warnings without stopping the flow.

**Overrides:** every override records who, when, and why to `auditLogs` (§5.24.6). No override is silent.

**Data-model additions**
- `drugInteractions` (medicineAId/ATC, medicineBId/ATC, severity, detail)
- `medicineWarnings` (medicineId, warningType: AGE|PREGNANCY|DOSE|LACTATION|CONTRAINDICATION, condition, message)
- `safetyAlertChecks` (patientId, prescriptionId, checkType, severity, outcome: PASS|WARN|OVERRIDE, overriddenBy, overrideReason, checkedAt)
- Overrides recorded to `auditLogs`.

### 5.15 Medicine Knowledge Base (Advanced)

**Separate from the inventory record.** Inventory tells PHARMA what you own; the Knowledge Base tells PHARMA what the medicine is.

```
Inventory record                       Knowledge Base
Amoxicillin 500mg                      AMOXICILLIN
Batch: AMX001                          Generic name
Expiry: 2027                           Active ingredient
Stock: 500                             Drug class
Purchase price: X                      Dosage forms · Strengths
Selling price: X                       Indications
                                       Contraindications
                                       Common/serious adverse effects
                                       Interactions
                                       Storage requirements
                                       Administration information
                                       Warnings
                                       Prescription category
                                       Manufacturer · Country of origin
```

Structured profile per medicine with fields: generic name, active ingredient, drug class, dosage forms, strengths, indications, contraindications, common + serious adverse effects, interactions, storage requirements, administration information, warnings, prescription category, manufacturer, country of origin.

**Master data sourcing:** aligned with the **NDA National Drug Register** / approved product information — not scraped from random internet sources. Each profile records `source` + `lastReviewedAt` so content provenance is auditable.

**Links:** a profile attaches to one or more inventory records via generic name/active ingredient; the Safety Engine (§5.14) reads indications, contraindications, interactions, and warnings from here.

**Data-model additions:** `medicineProfiles` (medicineId, structured fields, source, lastReviewedAt).

### 5.16 Customer Credit / Book (Professional)

**Screens:** Customer Account — opening balance, purchases, payments, current balance; credit limit, due dates, statements, partial payments, credit sales, account suspension.

**Data-model additions**
- `Customer.creditLimit`, `Customer.suspendedUntil` (additive)
- `customerAccountEntries` (customerId, type: SALE|PAYMENT|CREDIT_NOTE|ADJUSTMENT, amount, saleId, dueDate, balanceAfter, recordedBy)
- `customerStatements` (generated snapshots, period, opening, closing)

**Rules:** balance = SUM(entries) per customer; POS blocks credit sale when limit exceeded or account suspended; credit sales appear on Book Balancing as receivable.

### 5.17 Corporate / Insurance Accounts (Professional)

**Screens:** Company/School/Hospital/Insurer accounts with credit limit, current balance, invoice & statement generation, per-payer billing (e.g., insurance card/coverage per patient).

**Data-model additions**
- `corporateAccounts` (name, type, creditLimit, contact, status)
- `corporateInvoices` + `corporateInvoiceLines` (period, sales attached, payer, status)
- Coverage link: `patients.payerAccountId`, `sales.payerAccountId`, `sales.coverageAmount`, `sales.patientResponsibility`.

### 5.18 Refunds (Core — retained, enhanced linkage)

**Already core.** Enhance (without breaking): every refund already produces a negative payment + REFUND transaction + PAY reference + batch restock. Add: refund **authorization** (supervisor for > threshold), refund method = original payment method default, and full linkage of `original sale ↔ original transaction ↔ refund amount ↔ method ↔ reason ↔ user ↔ provider reference` (mostly present; expose on one Refund detail view).

### 5.19 Shifts & Cash Drawer (Professional)

**Screens:** Open Shift (cashier, opening cash, time) → during shift log cash sales, cash refunds, cash expenses, withdrawals, deposits → Close Shift showing:

```
EXPECTED CASH       COUNTED CASH       VARIANCE
UGX 2,450,000       UGX 2,440,000      −10,000
```

**Data-model additions**
- `shifts` (cashierId, openedAt, closedAt, openingCash, expectedCash, countedCash, variance, status)
- `cashDrawerMovements` (shiftId, type: SALE|REFUND|EXPENSE|WITHDRAWAL|DEPOSIT, amount, paymentId/refId, performedBy)

**Rules:** variance investigated/flagged for admin; feeds Book Balancing per shift.

### 5.20 Expenses & Profitability (Professional — build on existing)

**Screens:** Expense Center (category, amount, date, description, paid by, approved by, receipt). **Profit view:** `Sales Revenue − COGS − Expenses = Gross/Net Profit`; per-medicine margin table (purchase price, selling price, margin, units, total profit).

**Data-model additions:** `Expense.approvedBy`, `Expense.receiptRef`; profit computed from existing saleItem.costPrice + batch purchasePrice.

### 5.21 Analytics & AI (Enterprise)

Analyzes **PHARMA's own data** — not "AI on the dashboard." Engines:

```
Demand forecasting     Historical sales → trends → seasonality → forecast → suggested reorder
Expiry prediction      Current stock + sales velocity + expiry date → expiry risk
Slow-moving stock      Medicine + low sales velocity → "Slow-moving stock"
Profit insights        Top selling, highest profit, margin per medicine, period trends
Anomaly detection      Deviation from normal → ⚠ flag (never silent modification)
```

**Anomaly detection example:** normal daily adjustment 5–10 units; today 250 units → `⚠ UNUSUAL STOCK ADJUSTMENT`. The engine **flags** the anomaly and routes it for review; it never silently modifies financial or inventory records. Analytics output is advisory only.

**Pharma Intelligence assistant (chat-style):**
- "Which medicines are likely to run out next week?" → reorder/forecast engine
- "Which medicines are at risk of expiring?" → expiry engine
- "What did we sell yesterday?" → sales aggregation
- "Which supplier has increased prices?" → price history
- "Why did today's profit fall?" → revenue/COGS/expense deltas
- "Show the five slowest-moving medicines." → analytics

**Constraint:** the assistant answers from PHARMA's data only; it does **not** give medical advice and it cannot change records — flag-only.

**Data-model additions:** aggregation views built from existing `finance.ts`/`stockMovements` + `analyticsSnapshots` (period, metrics, generatedAt) + `anomalyFlags` (entity, metric, expected, actual, severity, reviewedBy, reviewedAt, status).

### 5.22 Cold Chain (Enterprise)

For products requiring controlled storage temperatures. **Must be connected to inventory** (§5.24.2): when a unit exceeds its range, PHARMA knows *which medicines, which batches, how many units, which location, which branches* — then quarantine → sale hold → authorized review.

```
Cold Chain
│
├── Storage Units        (Refrigerators · Freezers)
├── Temperature Sensors
├── Temperature Logs
├── Temperature Limits
├── Alerts
├── Excursions
├── Quarantine
└── Reports
```

**Screens:** Cold Chain monitor — storage location, min/max temp, current temp, status:

```
Vaccine Refrigerator 01
Required: +2°C → +8°C
Current:  +5.2°C
Status:   ✓ NORMAL
```

Outside the configured range:

```
⚠ TEMPERATURE EXCURSION
Current: +10.4°C   Allowed: +2°C – +8°C
Storage: Refrigerator 01
ACTION REQUIRED
```

**Integration flow (excursion → quarantine → review):**

```
TEMPERATURE EXCURSION
        ↓
AFFECTED BATCH
        ↓
QUARANTINE        (QUARANTINED — DO NOT SELL)
        ↓
SALE HOLD
        ↓
AUTHORIZED REVIEW (release · return · dispose)
```

Affected stock is automatically marked **QUARANTINED — DO NOT SELL** until authorized staff review it. Quarantine blocks FEFO picking and POS; release/return/dispose is a controlled action recorded in `quarantineRecords` (§5.7). Excursion history retained for cold-chain regulatory records (§7).

**Data-model additions**
- `coldChainLocations` (name, type: REFRIGERATOR|FREEZER|AMBIENT, minTemp, maxTemp, unit)
- `coldChainSensors` (locationId, name, source: MANUAL|SENSOR, lastReadingAt, active)
- `coldChainReadings` (locationId, sensorId, temp, source, recordedAt)
- `coldChainIncidents` (locationId, from, to, min/max, correctiveAction, reportedBy, quarantineBatchIds)
- `coldChainAlerts` (locationId, type: EXCURSION|SENSOR_OFFLINE|LOW_BATTERY, severity, status, resolvedAt, resolvedBy)

### 5.23 Branches & Warehouses (Enterprise)

More than multiple branches — an org tree:

```
HEAD OFFICE
│
├── Branch A
│   ├── Pharmacy
│   └── Warehouse
│
├── Branch B
│   ├── Pharmacy
│   └── Warehouse
│
└── Branch C
    ├── Pharmacy
    └── Warehouse
```

**Each branch has:** users, stock, sales, payments, expenses, customers, suppliers, reports. **Head office gets:** consolidated dashboard —

```
TOTAL GROUP SALES    TOTAL STOCK    TOTAL PROFIT
BRANCH PERFORMANCE   TOTAL EXPENSES TOTAL INVENTORY VALUE
```

**Capabilities:**
- Branch inventory (batches per branch), branch users, branch sales.
- **Stock transfers** between branches/warehouses (atomic reduce/increase, reason + approver; §5.6).
- **Central purchasing** — group PO distributed to branches.
- **Consolidated reports** across the group; per-branch drill-down.
- Shared master data (suppliers, medicines, knowledge base) vs branch-scoped data (stock, users, sales).

**Data-model additions**
- `branches` (name, type: HEAD_OFFICE|RETAIL|WAREHOUSE, parentBranchId, active)
- Additive keys on core entities: `sale.branchId`, `medicineBatches.branchId`, `users.branchId`, `Expense.branchId`, `stockTransfers.branchId`
- `branchConsolidations` (aggregated report snapshots by period/branch)

**Design note:** branch framework enabled only when Locations > 1 in setup; single-branch installations carry `branchId = null` and are unaffected.

### 5.24 Cross-system Engines

System-wide layers. Each is formally accounted for and activates with any module that depends on it.

#### 5.24.1 Payment & Reconciliation Engine

Owns the money flow end to end — including the critical rule that **PHARMA never marks an online payment received until the provider confirms it and PHARMA verifies the confirmation** (confirmed + amount match → `finalizeSale` → COMPLETED).

```
PAYMENTS
├── Cash · Mobile Money · Card · Bank · Online
├── Payment Requests
├── Provider Confirmation
├── Pending · Failed · Declined
├── Refunds
└── Reconciliation
```

**Reconciliation (separate from ordinary reports):** compares

```
PHARMA SALES → PHARMA PAYMENTS → PAYMENT PROVIDERS → BANK/MOBILE MONEY → CASH
```

then shows **EXPECTED vs ACTUAL** and identifies discrepancies (unmatched provider transactions, pending sales, refunds without linkage, cash drawer variance). Reconciliation runs per shift (§5.19), per payment provider, and per period; discrepancies become review items, never silent fixes.

#### 5.24.2 Inventory Control Engine

The single authority over stock movement. Every movement gets a **reason** and an **approver**.

```
Purchasing → Receiving → Batch → Inventory → Sale → Stock Deduction → Return → Adjustment → Reconciliation
```

- No direct "set stock = N" — adjustments are movements with reason codes + approver (§5.9).
- FEFO dispatch; expired and quarantined batches excluded from sellable picking.
- Every batch has a life: `Received → Sold → Returned → Damaged → Expired → Current` (§5.8).
- Cold Chain and Expiry & Recall plug into this engine: excursions auto-quarantine affected batches; recalls auto-hold them (§5.7, §5.22).

#### 5.24.3 Returns Management

**Distinguishes customer returns from supplier returns — returned medicines never automatically go back into sellable stock.**

```
Customer return          Supplier return
Customer                 Pharmacy
 ↓                       ↓
Return medicine          Return batch
 ↓                       ↓
Inspect                  Supplier
 ↓                       ↓
Refund / credit          Credit / replacement
 ↓
Stock decision (restock · quarantine · dispose)
```

- Customer return: verify receipt/batch/condition → refund or credit → **stock decision** recorded (restock to sellable only after inspection; otherwise quarantine/dispose).
- Supplier return: batch back to supplier → credit note or replacement on the supplier account.
- Controlled medicines returns follow §5.13 register rules.
- Full linkage `original sale ↔ original transaction ↔ refund ↔ method ↔ reason ↔ user ↔ provider reference` (§5.18).

#### 5.24.4 Notification Engine

One central system feeds all alert surfaces (dashboard, in-app center, optional email/notification channels), sourced from the other engines:

```
Low stock · Expiry · Expired stock · Recall · Cold-chain excursion
Payment pending · Payment failure · Payment verification
Supplier due · Customer credit due
Prescription issue · Safety alert · System alerts
```

Each notification carries: type, severity, entity link, acknowledgedBy/at. It activates automatically with any module that emits alerts (stock, expiry, recall, cold chain, payments, credit, prescriptions, safety).

**Data-model additions:** `notifications` (type, severity, title, body, entityType, entityId, read, acknowledgedBy, acknowledgedAt, createdAt).

#### 5.24.5 Document Management

Attachments + a document register for professional records, where appropriate linked to their source record:

```
Invoices · Receipts · Purchase Orders · Supplier Invoices
Credit Notes · Debit Notes
Prescription documents · Insurance documents · Patient documents
```

**Data-model additions:** `documents` (entityType, entityId, name, kind, fileRef, uploadedBy, uploadedAt) + `Document.attachments` where applicable.

#### 5.24.6 Audit & Compliance Engine

System-wide, nothing important disappears from the database:

```
WHO   WHAT   WHEN   WHERE   OLD VALUE   NEW VALUE   WHY
Admin  Stock Adjustment  Paracetamol  500 → 450  Reason: Damaged stock  04/08/2026 14:31
```

- Extends the existing `auditLogs` with before/after values and reason where missing.
- Consumed by every controlled action: adjustments (§5.9), controlled-drug register (§5.13), safety overrides (§5.14), recalls/quarantine (§5.7), cold-chain incidents (§5.22), refunds (§5.18), branch transfers (§5.23).
- Feeds compliance reporting for NDA inspection (§7) and the traceability trail (§5.8).

**Data-model additions:** `auditLogDetails` (auditLogId, entityType, entityId, field, oldValue, newValue, reason) — additive to existing `auditLogs`.

### 5.25 The Complete PHARMA Module Structure

```
PHARMA
│
├── 🏠 DASHBOARD
├── 🛒 SALES & POS
├── 💊 MEDICINES            Medicine Registration · Barcode · Packaging · Medicine Knowledge Base
├── 📦 INVENTORY            Stock · Batches · Stock Movements · Stock Counts · Transfers · Expiry & Recall
├── 👥 PATIENTS             Patient Profiles · History · Admissions · Wards · Beds · Transfers · Discharges
├── 📋 PRESCRIPTIONS        Prescriptions · Medication Orders · Dispensing · Medication Administration
├── ⚠️ DRUG SAFETY          Allergies · Interactions · Warnings · Safety Alerts
├── 🔒 CONTROLLED MEDICINES Controlled Register · Dispensing · Adjustments · Returns · Disposal
├── 🏭 PROCUREMENT          Suppliers · Purchase Orders · Goods Receiving · Purchase Returns
├── ❄️ COLD CHAIN           Storage Units · Temperature Monitoring · Alerts · Quarantine
├── 💳 PAYMENTS             Cash · Mobile Money · Bank · Card · Online · Refunds · Reconciliation
├── 💰 FINANCE              Revenue · Expenses · Receivables · Payables · Book Balancing
├── 🧾 BILLING              Invoices · Receipts · Credit Notes · Refunds
├── 🏢 BRANCHES             Branches · Warehouses · Transfers · Consolidated Management
├── 📊 REPORTS              Sales · Inventory · Finance · Payments · Patients · Procurement · Compliance
├── 📈 ANALYTICS & AI       Forecasting · Demand · Expiry Risk · Profit Insights · Anomaly Detection · Recommendations
├── 🔔 NOTIFICATIONS
├── 👤 USERS & PERMISSIONS
├── 🔐 AUDIT & SECURITY
└── ⚙️ SETTINGS
```

**Conclusion:** the previously under-specified modules — Controlled Medicines, Drug Safety Alerts, Medicine Knowledge Base, Expiry & Recall, Cold Chain, Multiple Branches, Analytics & AI — and the cross-system engines — Payment/Reconciliation, Inventory Control, Returns Management, Notification, Document Management, Audit/Compliance — are now official modules with specifications and data models. They sit above the same core PHARMA database and activate per facility; the simple drug-shop workflow (POS + inventory + payments + basic reports) is unchanged and remains the base for every tier.

---

## 6. Data Model Summary (all additive)

| Module | New stores |
|---|---|
| Procurement | purchaseRequests, purchaseOrders, purchaseOrderItems, grns, grnItems, supplierInvoices, supplierPayments, purchaseReturns |
| Supplier Center | supplierProducts, supplierPriceHistory, supplierPerformance |
| Reordering | reorderRecommendations |
| Stock taking | stockTakes, stockTakeItems |
| Locations/transfers | storageLocations, stockTransfers, stockTransferItems |
| Expiry & Recall | recalls, recallNotices, expiryRiskSnapshots, quarantineRecords, saleHolds |
| Patients | patients, patientContacts, patientIdentifiers, patientAllergies, patientMedicalHistory |
| Admissions | admissions, wards, beds, bedAssignments, discharges, transfers |
| Prescriptions | prescriptions, prescriptionItems, medicationOrders, dispensingRecords, medicationAdministration, referringDoctors |
| Controlled meds | controlledDrugRegister, controlRequisitions, controlledDrugCounts |
| Safety | drugInteractions, medicineWarnings, safetyAlertChecks |
| Knowledge base | medicineProfiles |
| Credit | customerAccountEntries, customerStatements |
| Corporate | corporateAccounts, corporateInvoices, corporateInvoiceLines |
| Shifts/cash | shifts, cashDrawerMovements |
| Cold chain | coldChainLocations, coldChainSensors, coldChainReadings, coldChainIncidents, coldChainAlerts |
| Branches | branches, branchConsolidations |
| Analytics & AI | analyticsSnapshots, anomalyFlags |
| Notifications | notifications |
| Documents | documents |
| Audit/Compliance | auditLogDetails |
| Setup | systemSettings `enabled_modules`, `business_profile`, `setup_complete` |

Additive field changes (no table drops): `Medicine.controlCategory`, `Customer.creditLimit`, `Customer.suspendedUntil`, `Customer.branchId`, `medicineBatches.locationId`, `medicineBatches.branchId`, `Sale.branchId`, `Sale.payerAccountId`, `Sale.coverageAmount`, `Expense.approvedBy`, `Expense.branchId`, `users.branchId`.

---

## 7. Compliance & Regulatory Alignment (Uganda)

| Requirement | Module |
|---|---|
| NDA Drug Register alignment | Knowledge Base master data |
| Restricted-drug dispensing records (date, ingredients/qty, patient, prescriber) | Controlled Medicines Register + Dispensing Records |
| Controlled drug balance reconciliation + dual authorization | Controlled Drug Register + counts |
| Prescription retention | Prescriptions + attachments |
| Expiry control / expired stock not sold | Expiry & Recall (blocks expired batches) |
| Recall & safety alerts traceability | Expiry & Recall + traceability |
| Recall holds applied across all branches holding the batch | Expiry & Recall (sale holds per branch) |
| Inventory audit trail (WHO/WHAT/WHEN/OLD/NEW/WHY) | Inventory Control + Audit & Compliance Engine |
| Controlled storage / cold chain records | Cold Chain + incident records |
| Cold-chain excursion → affected batch quarantine | Cold Chain + Inventory Control Engine |
| Disposal/loss/damage documentation | Controlled Medicines register + Returns Management |

---

## 8. Roadmap

| Phase | Content | Exit criteria |
|---|---|---|
| **A — Foundation** | This blueprint ratified; business setup wizard + `enabled_modules` registry; Settings → Configuration; nav renders from registry (Essential-only installs look identical to today); **engine foundations**: Notification Engine (§5.24.4) + Audit & Compliance Engine (§5.24.6) skeleton | Wizard runs, upgrade re-run works, no regression on current E2E suite |
| **B — Professional** | Procurement lifecycle, Supplier Center + price comparison, auto-reorder, stock takes, locations/bins, transfers, quarantine, credit accounts, corporate accounts, shifts & cash drawer, profitability; **Inventory Control Engine** (§5.24.2) + **Returns Management** (§5.24.3) + **Payment/Reconciliation Engine** (§5.24.1) | Purchase Request → PO → GRN → invoice → payment → balance → credit-note flow works E2E; refund linkage (§5.18) verified E2E |
| **C — Advanced** | Patients, admissions/wards/beds, prescriptions + dispensing, medication orders + MAR, controlled medicines register, drug safety alerts, knowledge base, **Expiry & Recall** (sale holds, quarantine, supplier returns), traceability, document management | Dispensing with controlled-drug register + interaction/allergy checks verified E2E; recall hold blocks sale E2E |
| **D — Enterprise** | Branches, warehouses, transfers, central purchasing, consolidated reports, **Cold Chain** (+ batch quarantine link), **Analytics & AI** (forecasting, expiry risk, slow movers, anomaly detection) | Multi-branch consolidated report + cold-chain excursion → quarantine flow verified E2E |

**Sequencing note:** Phase A includes two small but important gaps in the current Essential base that must be closed before moving to Phase B: (1) refund route in user layout (currently admin-only; users cannot issue refunds), and (2) refund-to-payment-engine linkage for gateway refunds (MTN/Airtel provider-side refund via `refund()` on adapters, creating a REFUND `paymentTransaction` with provider reference). Both are **already closed in the current codebase** (user `#/refunds` route + provider-side refund linkage). Engine ordering: Notification + Audit/Compliance foundations land with Phase A; Inventory Control + Returns + Payment/Reconciliation land with Phase B so every later module (recall, cold chain, controlled drugs, branches) automatically gets movement reason, return handling, and reconciliation.

---

## 9. Non-Negotiables

1. **The current system never changes behavior for Essential users.** Every existing feature, screen, and store remains.
2. **Additive schema only.** New Dexie versions may add stores/fields + backfill; never destructive.
3. **One database, one app, one login.** Setup selects visible capabilities; it does not fork products.
4. **PHARMA never handles customer PINs or payment credentials.**
5. **Clinical features are decision support, not diagnosis or prescribing.**
6. **All master data (medicine info, interactions) is sourced from or aligned with authoritative regulatory references (NDA) where available.**
7. **Analytics & AI flag anomalies; they never silently modify financial or inventory records.**
8. **Returned medicines never automatically return to sellable stock** — they pass inspection and a recorded stock decision (restock · quarantine · dispose).
9. **No "set stock = N".** Every stock movement has a reason and an approver.
10. **Nothing important disappears.** Every controlled action lands in the Audit & Compliance Engine (WHO/WHAT/WHEN/OLD/NEW/WHY).
