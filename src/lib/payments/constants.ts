import type { PaymentMethod } from "../../types";

export const PAYMENT_METHODS: Array<{
  value: PaymentMethod;
  label: string;
  shortLabel: string;
  color: string;
}> = [
  { value: "CASH", label: "Cash", shortLabel: "Cash", color: "#0f766e" },
  { value: "MOBILE_MONEY", label: "Mobile Money", shortLabel: "Mobile", color: "#2563eb" },
  { value: "BANK", label: "Bank Payment", shortLabel: "Bank", color: "#0891b2" },
  { value: "CARD", label: "Card Payment", shortLabel: "Card", color: "#7c3aed" },
  { value: "PAYPAL", label: "PayPal", shortLabel: "PayPal", color: "#0369a1" },
  { value: "CREDIT", label: "Credit", shortLabel: "Credit", color: "#d97706" },
  { value: "OTHER", label: "Other", shortLabel: "Other", color: "#64748b" },
];

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CASH: "Cash",
  MOBILE_MONEY: "Mobile Money",
  BANK: "Bank",
  CARD: "Card",
  PAYPAL: "PayPal",
  CREDIT: "Credit",
  OTHER: "Other",
};

export const PAYMENT_SHORT: Record<PaymentMethod, string> = {
  CASH: "Cash",
  MOBILE_MONEY: "Mobile",
  BANK: "Bank",
  CARD: "Card",
  PAYPAL: "PayPal",
  CREDIT: "Credit",
  OTHER: "Other",
};

export const PAYMENT_COLOR: Record<PaymentMethod, string> = {
  CASH: "#0f766e",
  MOBILE_MONEY: "#2563eb",
  BANK: "#0891b2",
  CARD: "#7c3aed",
  PAYPAL: "#0369a1",
  CREDIT: "#d97706",
  OTHER: "#64748b",
};

export function emptyMethodTotals(): Record<PaymentMethod, number> {
  return {
    CASH: 0,
    MOBILE_MONEY: 0,
    BANK: 0,
    CARD: 0,
    PAYPAL: 0,
    CREDIT: 0,
    OTHER: 0,
  };
}
