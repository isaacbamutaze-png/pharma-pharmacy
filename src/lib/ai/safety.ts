import type { AssistantContext } from "../assistant";
import type { SafetyIntelligence } from "../../types";

export function buildSafetyIntelligence(
  ctx: AssistantContext,
): SafetyIntelligence {
  const checks = ctx.safetyAlertChecks;
  const overrides = checks.filter((c) => c.outcome === "OVERRIDE");
  const warns = checks.filter((c) => c.outcome === "WARN");
  const overridesRecent = [...overrides]
    .sort((a, b) => b.checkedAt - a.checkedAt)
    .slice(0, 4)
    .map((c) => ({
      checkType: c.checkType,
      detail: c.detail,
      reason: c.overrideReason || c.detail,
      at: c.checkedAt,
    }));

  const allergyPatients = new Set(ctx.patientAllergies.map((a) => a.patientId))
    .size;

  const majorRules = ctx.drugInteractions.filter(
    (d) => d.severity === "MAJOR" || d.severity === "CONTRAINDICATED",
  ).length;

  const openConcerns: SafetyIntelligence["openConcerns"] = [];
  if (overrides.length > 0) {
    openConcerns.push({
      title: `${overrides.length} safety override(s) on record`,
      detail:
        "Overrides are never silent — review them in Drug Safety to confirm the documented reasons are valid.",
    });
  }
  if (allergyPatients > 0) {
    openConcerns.push({
      title: `${allergyPatients} patient(s) with recorded allergies`,
      detail:
        "Allergy screening runs automatically at dispensing; confirm patients are re-checked when new medicines are added.",
    });
  }
  if (majorRules > 0) {
    openConcerns.push({
      title: `${majorRules} major/contraindicated interaction rule(s) defined`,
      detail:
        "These combinations will warn at dispensing — keep the knowledge data current.",
    });
  }
  if (warns.length > 0) {
    openConcerns.push({
      title: `${warns.length} warning(s) recorded without override`,
      detail: "Recent dispensing flagged warnings that were not overridden — review the outcomes.",
    });
  }
  if (openConcerns.length === 0) {
    openConcerns.push({
      title: "No open safety concerns",
      detail: "No overrides, un-reviewed warnings or knowledge gaps are outstanding.",
    });
  }

  return {
    checksTotal: checks.length,
    warns: warns.length,
    overrides: overrides.length,
    overridesRecent,
    allergyPatients,
    interactionRules: ctx.drugInteractions.length,
    warningRules: ctx.medicineWarnings.length,
    openConcerns,
  };
}
