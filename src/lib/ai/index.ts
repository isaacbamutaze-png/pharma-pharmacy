import { buildForecast } from "./forecast";
import { buildFinanceAnalysis } from "./finance";
import { buildPaymentIntelligence } from "./payments";
import { buildAnomalyDetection } from "./anomaly";
import { buildSafetyIntelligence } from "./safety";
import { buildManagementReport } from "./report";
import { buildReorderSuggestions } from "./inventory";
import { buildExpiryIntelligence } from "./expiry";
import type { AssistantContext } from "../assistant";

export interface AiService {
  id: string;
  group: "Business AI" | "Pharmacy AI" | "Analytics AI" | "Safety AI";
  label: string;
  description: string;
  run: (ctx: AssistantContext) => unknown;
}

/**
 * The PHARMA AI layer. Each service is a specialised, data-grounded module
 * behind the assistant/orchestrator. The application stays the authority for
 * transactions; these services only recommend, explain, predict and flag.
 */
export const AI_SERVICES: AiService[] = [
  {
    id: "inventory",
    group: "Pharmacy AI",
    label: "Inventory Assistant",
    description: "Reorder recommendations with quantities, suppliers and estimated cost.",
    run: (ctx) => buildReorderSuggestions(ctx),
  },
  {
    id: "expiry",
    group: "Pharmacy AI",
    label: "Expiry Intelligence",
    description: "Risk-adjusted sell-through prediction with suggested actions.",
    run: (ctx) => buildExpiryIntelligence(ctx),
  },
  {
    id: "forecast",
    group: "Analytics AI",
    label: "Demand Forecasting",
    description: "Recency-weighted 30-day demand forecast and stock-out risk.",
    run: (ctx) => buildForecast(ctx),
  },
  {
    id: "finance",
    group: "Business AI",
    label: "Financial Analysis",
    description: "Why revenue/profit moved, product deltas and cost drivers.",
    run: (ctx) => buildFinanceAnalysis(ctx),
  },
  {
    id: "payments",
    group: "Business AI",
    label: "Payment AI",
    description: "Pending, failed, unmatched and refund activity monitoring.",
    run: (ctx) => buildPaymentIntelligence(ctx),
  },
  {
    id: "anomaly",
    group: "Analytics AI",
    label: "Anomaly Detection",
    description: "Unusual inventory, sales, refund, payment and audit activity.",
    run: (ctx) => buildAnomalyDetection(ctx),
  },
  {
    id: "safety",
    group: "Safety AI",
    label: "Drug Safety",
    description: "Grounded safety overview: overrides, allergies, interaction rules.",
    run: (ctx) => buildSafetyIntelligence(ctx),
  },
  {
    id: "report",
    group: "Business AI",
    label: "Report Generator",
    description: "Monthly management report with revenue, stock, payments and compliance.",
    run: (ctx) => buildManagementReport(ctx),
  },
];
