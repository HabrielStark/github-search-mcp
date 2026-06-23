import type { LicenseRiskLevel, Tri } from "./common.js";

export type LicenseCategory =
  | "permissive"
  | "weak-copyleft"
  | "strong-copyleft"
  | "unknown"
  | "none";

export interface LicenseReport {
  repository: string;
  detected: string | null;
  spdxId: string | null;
  category: LicenseCategory;
  commercialUse: Tri;
  privateUse: Tri;
  modification: Tri;
  distribution: Tri;
  riskLevel: LicenseRiskLevel;
  notes: string[];
}
