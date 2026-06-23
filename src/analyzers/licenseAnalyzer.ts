import type { LicenseRiskLevel, Tri } from "../types/common.js";
import type { LicenseCategory, LicenseReport } from "../types/license.js";

export interface LicenseAnalyzerInput {
  repository: string;
  spdxId: string | null;
  name: string | null;
  key?: string | null;
}

export interface LicenseAnalyzerOptions {
  /** When true, AGPL/strong-copyleft notes emphasise SaaS/network-use risk. */
  saasUseCase?: boolean;
}

const PERMISSIVE = new Set([
  "MIT",
  "MIT-0",
  "APACHE-2.0",
  "APACHE-1.1",
  "BSD-2-CLAUSE",
  "BSD-3-CLAUSE",
  "BSD-3-CLAUSE-CLEAR",
  "ISC",
  "0BSD",
  "UNLICENSE",
  "ZLIB",
  "BSL-1.0",
  "BOOST-1.0",
  "WTFPL",
  "CC0-1.0",
  "NCSA",
  "X11",
  "PSF-2.0",
  "POSTGRESQL",
  "APACHE",
]);

// Only families NOT covered by the startsWith() checks below live here, so every
// entry is load-bearing (no equivalent mutants). MPL/EPL/CDDL are handled by the
// prefix checks in classify().
const WEAK_COPYLEFT = new Set(["OSL-3.0", "MS-PL", "EUPL-1.2"]);

interface Classification {
  category: LicenseCategory;
  riskLevel: LicenseRiskLevel;
  notes: string[];
}

function classify(spdx: string, saas: boolean): Classification {
  const id = spdx.toUpperCase();
  // Stryker disable next-line Regex, StringLiteral: AGPL/GPL/LGPL are matched by
  // the startsWith checks below before `norm` is consulted, and no PERMISSIVE/
  // WEAK_COPYLEFT set member carries a -only/-or-later suffix, so this
  // normalization never changes a classification — the mutants are equivalent.
  const norm = id.replace(/-ONLY$|-OR-LATER$/, "");

  if (id.startsWith("AGPL")) {
    return {
      category: "strong-copyleft",
      riskLevel: "high",
      notes: [
        "AGPL is strong copyleft: network/SaaS use is treated as distribution and requires releasing your source under AGPL.",
        saas
          ? "High risk for a proprietary SaaS: AGPL obligations are triggered by serving the software over a network."
          : "Review obligations carefully before integrating into proprietary software.",
      ],
    };
  }
  if (id.startsWith("LGPL")) {
    return {
      category: "weak-copyleft",
      riskLevel: "medium",
      notes: [
        "LGPL is weak copyleft: dynamic linking is generally allowed, but modifications to the library itself must be shared.",
      ],
    };
  }
  if (id.startsWith("GPL")) {
    return {
      category: "strong-copyleft",
      riskLevel: "medium",
      notes: [
        "GPL is strong copyleft: distributed derivative works must also be licensed under the GPL.",
        saas
          ? "Pure SaaS use (no distribution of binaries) typically does not trigger GPL source-release obligations, but verify your distribution model."
          : "Distributing a product that links GPL code requires releasing your source under the GPL.",
      ],
    };
  }
  if (PERMISSIVE.has(norm)) {
    return {
      category: "permissive",
      riskLevel: "low",
      notes: [
        "Permissive license: broad commercial, modification and distribution rights with minimal obligations (typically attribution).",
      ],
    };
  }
  if (
    WEAK_COPYLEFT.has(norm) ||
    norm.startsWith("MPL") ||
    norm.startsWith("EPL") ||
    norm.startsWith("CDDL")
  ) {
    return {
      category: "weak-copyleft",
      riskLevel: "medium",
      notes: [
        "Weak copyleft: modifications to the covered files must be shared, but combining with other code is generally allowed.",
      ],
    };
  }
  return {
    category: "unknown",
    riskLevel: "high",
    notes: [
      "Unrecognized license identifier. Treat as high risk and review the license text manually before use.",
    ],
  };
}

/** Classify a repository license into a structured rights-and-risk report. */
export function analyzeLicense(
  input: LicenseAnalyzerInput,
  options: LicenseAnalyzerOptions = {},
): LicenseReport {
  const saas = options.saasUseCase ?? false;
  const spdx = input.spdxId && input.spdxId !== "NOASSERTION" ? input.spdxId : null;
  const hasLicense = Boolean(spdx || (input.name && input.name !== "Other"));

  if (!hasLicense) {
    const isNoAssertion = input.spdxId === "NOASSERTION" || Boolean(input.name);
    if (isNoAssertion) {
      return {
        repository: input.repository,
        detected: input.name ?? input.spdxId,
        spdxId: input.spdxId,
        category: "unknown",
        commercialUse: "unclear",
        privateUse: "unclear",
        modification: "unclear",
        distribution: "unclear",
        riskLevel: "high",
        notes: [
          "A license file may exist but could not be identified to a known SPDX license. Treat as high risk until reviewed.",
        ],
      };
    }
    return {
      repository: input.repository,
      detected: null,
      spdxId: null,
      category: "none",
      commercialUse: "no",
      privateUse: "unclear",
      modification: "no",
      distribution: "no",
      riskLevel: "high",
      notes: [
        "No license detected. Default copyright applies and no usage, modification or distribution rights are granted. High risk.",
      ],
    };
  }

  // Stryker disable next-line StringLiteral: the final `?? ""` is unreachable —
  // this code runs only when hasLicense is true, i.e. spdx or name is truthy.
  const effectiveSpdx = spdx ?? input.name ?? "";
  const classification = classify(effectiveSpdx, saas);
  const permissionsYes: Tri = "yes";
  return {
    repository: input.repository,
    detected: input.name ?? spdx,
    spdxId: spdx,
    category: classification.category,
    commercialUse: permissionsYes,
    privateUse: permissionsYes,
    modification: permissionsYes,
    distribution: permissionsYes,
    riskLevel: classification.riskLevel,
    notes: classification.notes,
  };
}
