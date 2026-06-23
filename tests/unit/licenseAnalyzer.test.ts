import { describe, it, expect } from "vitest";
import { analyzeLicense } from "../../src/analyzers/licenseAnalyzer.js";

const base = { repository: "o/r", name: null as string | null, key: null as string | null };
const classify = (spdxId: string) => analyzeLicense({ repository: "o/r", spdxId, name: null });

describe("analyzeLicense", () => {
  it("classifies MIT as permissive/low", () => {
    const r = analyzeLicense({ ...base, spdxId: "MIT" });
    expect(r.category).toBe("permissive");
    expect(r.riskLevel).toBe("low");
    expect(r.commercialUse).toBe("yes");
    expect(r.spdxId).toBe("MIT");
  });

  it("classifies Apache-2.0 / BSD / ISC as permissive", () => {
    for (const id of ["Apache-2.0", "BSD-3-Clause", "ISC", "BSD-2-Clause"]) {
      expect(analyzeLicense({ ...base, spdxId: id }).category).toBe("permissive");
    }
  });

  it("classifies GPL as strong-copyleft/medium", () => {
    const r = analyzeLicense({ ...base, spdxId: "GPL-3.0" });
    expect(r.category).toBe("strong-copyleft");
    expect(r.riskLevel).toBe("medium");
  });

  it("classifies AGPL as strong-copyleft/high", () => {
    const r = analyzeLicense({ ...base, spdxId: "AGPL-3.0" });
    expect(r.category).toBe("strong-copyleft");
    expect(r.riskLevel).toBe("high");
  });

  it("emphasises AGPL risk for SaaS use", () => {
    const r = analyzeLicense({ ...base, spdxId: "AGPL-3.0-only" }, { saasUseCase: true });
    expect(r.riskLevel).toBe("high");
    expect(r.notes.join(" ").toLowerCase()).toContain("saas");
  });

  it("classifies LGPL / MPL as weak-copyleft/medium", () => {
    expect(analyzeLicense({ ...base, spdxId: "LGPL-3.0" }).category).toBe("weak-copyleft");
    expect(analyzeLicense({ ...base, spdxId: "MPL-2.0" }).category).toBe("weak-copyleft");
    expect(analyzeLicense({ ...base, spdxId: "LGPL-3.0" }).riskLevel).toBe("medium");
  });

  it("classifies no license as none/high with no rights", () => {
    const r = analyzeLicense({ ...base, spdxId: null });
    expect(r.category).toBe("none");
    expect(r.riskLevel).toBe("high");
    expect(r.commercialUse).toBe("no");
    expect(r.detected).toBeNull();
  });

  it("classifies unrecognized SPDX as unknown/high", () => {
    const r = analyzeLicense({ ...base, spdxId: "FOOBAR-1.0" });
    expect(r.category).toBe("unknown");
    expect(r.riskLevel).toBe("high");
  });

  it("treats NOASSERTION with a name as unknown", () => {
    const r = analyzeLicense({ ...base, spdxId: "NOASSERTION", name: "Custom License" });
    expect(r.category).toBe("unknown");
    expect(r.riskLevel).toBe("high");
  });
});

describe("analyzeLicense — unidentified, none and copyleft note strings", () => {
  it("treats NOASSERTION with no name as unknown/high with the unidentified note", () => {
    const r = analyzeLicense({ repository: "x/y", spdxId: "NOASSERTION", name: null });
    expect(r.category).toBe("unknown");
    expect(r.riskLevel).toBe("high");
    expect(r.commercialUse).toBe("unclear");
    expect(r.modification).toBe("unclear");
    expect(r.distribution).toBe("unclear");
    expect(r.privateUse).toBe("unclear");
    expect(r.notes[0]).toMatch(/could not be identified to a known SPDX license/);
  });

  it('treats the literal name "Other" with no SPDX id as unknown', () => {
    const r = analyzeLicense({ repository: "x/y", spdxId: null, name: "Other" });
    expect(r.category).toBe("unknown");
    expect(r.riskLevel).toBe("high");
  });

  it("treats a truly absent license as none/high with no rights and the exact note", () => {
    const r = analyzeLicense({ repository: "x/y", spdxId: null, name: null });
    expect(r.category).toBe("none");
    expect(r.riskLevel).toBe("high");
    expect(r.detected).toBeNull();
    expect(r.commercialUse).toBe("no");
    expect(r.modification).toBe("no");
    expect(r.distribution).toBe("no");
    expect(r.privateUse).toBe("unclear");
    expect(r.notes[0]).toMatch(/No license detected\. Default copyright applies/);
  });

  it("emits distinct GPL notes for SaaS vs distribution use (and defaults to non-SaaS)", () => {
    const saas = analyzeLicense(
      { repository: "x/y", spdxId: "GPL-3.0", name: null },
      { saasUseCase: true },
    );
    expect(saas.category).toBe("strong-copyleft");
    expect(saas.riskLevel).toBe("medium");
    expect(saas.notes[0]).toMatch(/GPL is strong copyleft/);
    expect(saas.notes[1]).toMatch(/Pure SaaS use/);

    const dist = analyzeLicense({ repository: "x/y", spdxId: "GPL-3.0", name: null });
    expect(dist.notes[1]).toMatch(/Distributing a product that links GPL code/);
  });

  it("emits distinct AGPL notes and escalates for SaaS", () => {
    const saas = analyzeLicense(
      { repository: "x/y", spdxId: "AGPL-3.0", name: null },
      { saasUseCase: true },
    );
    expect(saas.category).toBe("strong-copyleft");
    expect(saas.riskLevel).toBe("high");
    expect(saas.notes[0]).toMatch(/AGPL is strong copyleft/);
    expect(saas.notes[1]).toMatch(/High risk for a proprietary SaaS/);

    const nonSaas = analyzeLicense({ repository: "x/y", spdxId: "AGPL-3.0", name: null });
    expect(nonSaas.notes[1]).toMatch(/Review obligations carefully/);
  });

  it("emits the LGPL weak-copyleft note", () => {
    const r = analyzeLicense({ repository: "x/y", spdxId: "LGPL-3.0", name: null });
    expect(r.category).toBe("weak-copyleft");
    expect(r.riskLevel).toBe("medium");
    expect(r.notes[0]).toMatch(/LGPL is weak copyleft/);
  });

  it("emits the generic weak-copyleft note for MPL and the unknown note for junk", () => {
    expect(analyzeLicense({ repository: "x/y", spdxId: "MPL-2.0", name: null }).notes[0]).toMatch(
      /Weak copyleft: modifications to the covered files/,
    );
    expect(
      analyzeLicense({ repository: "x/y", spdxId: "TOTALLY-MADE-UP-1.0", name: null }).notes[0],
    ).toMatch(/Unrecognized license identifier/);
  });

  it("emits the permissive note for MIT", () => {
    expect(analyzeLicense({ repository: "x/y", spdxId: "MIT", name: null }).notes[0]).toMatch(
      /Permissive license: broad commercial, modification and distribution rights/,
    );
  });
});

describe("analyzeLicense — name vs SPDX resolution and `detected`", () => {
  it("classifies a custom (non-Other) name via classify() → 'Unrecognized' note", () => {
    const r = analyzeLicense({ repository: "x/y", spdxId: null, name: "Weird Custom License" });
    expect(r.category).toBe("unknown");
    expect(r.notes[0]).toMatch(/Unrecognized license identifier/);
  });

  it("routes the literal name 'Other' through the unidentified branch", () => {
    const r = analyzeLicense({ repository: "x/y", spdxId: null, name: "Other" });
    expect(r.category).toBe("unknown");
    expect(r.notes[0]).toMatch(/could not be identified to a known SPDX license/);
  });

  it("preserves `detected` through the fallback chain", () => {
    expect(analyzeLicense({ repository: "x/y", spdxId: "MIT", name: null }).detected).toBe("MIT");
    expect(analyzeLicense({ repository: "x/y", spdxId: "NOASSERTION", name: null }).detected).toBe(
      "NOASSERTION",
    );
    expect(analyzeLicense({ repository: "x/y", spdxId: "MIT", name: "MIT License" }).detected).toBe(
      "MIT License",
    );
  });

  it("normalizes -only / -or-later suffixes", () => {
    expect(analyzeLicense({ repository: "x/y", spdxId: "GPL-3.0-only", name: null }).category).toBe(
      "strong-copyleft",
    );
    expect(
      analyzeLicense({ repository: "x/y", spdxId: "LGPL-2.1-or-later", name: null }).category,
    ).toBe("weak-copyleft");
  });

  it.each(["MPL-9.9", "EPL-9.9", "CDDL-9.9"])(
    "classifies unknown %s version via prefix as weak-copyleft",
    (id) => {
      expect(classify(id).category).toBe("weak-copyleft");
    },
  );

  it.each(["OSL-3.0", "MS-PL", "EUPL-1.2"])("classifies %s via the set as weak-copyleft", (id) => {
    expect(classify(id).category).toBe("weak-copyleft");
  });

  it("classifies a bare 'Apache' as permissive", () => {
    expect(classify("Apache").category).toBe("permissive");
  });
});

describe("analyzeLicense — full SPDX classification table", () => {
  it.each([
    "MIT",
    "MIT-0",
    "Apache-2.0",
    "Apache-1.1",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSD-3-Clause-Clear",
    "ISC",
    "0BSD",
    "Unlicense",
    "Zlib",
    "BSL-1.0",
    "BOOST-1.0",
    "WTFPL",
    "CC0-1.0",
    "NCSA",
    "X11",
    "PSF-2.0",
    "PostgreSQL",
  ])("classifies %s as permissive/low", (id) => {
    const r = classify(id);
    expect(r.category).toBe("permissive");
    expect(r.riskLevel).toBe("low");
    expect(r.notes[0]).toBe(
      "Permissive license: broad commercial, modification and distribution rights with minimal obligations (typically attribution).",
    );
  });

  it.each([
    "MPL-2.0",
    "MPL-1.1",
    "EPL-1.0",
    "EPL-2.0",
    "CDDL-1.0",
    "CDDL-1.1",
    "OSL-3.0",
    "MS-PL",
    "EUPL-1.2",
  ])("classifies %s as weak-copyleft/medium", (id) => {
    const r = classify(id);
    expect(r.category).toBe("weak-copyleft");
    expect(r.riskLevel).toBe("medium");
  });

  it.each(["LGPL-2.1", "LGPL-3.0", "LGPL-3.0-only", "LGPL-2.1-or-later"])(
    "classifies %s as weak-copyleft",
    (id) => {
      expect(classify(id).category).toBe("weak-copyleft");
    },
  );

  it.each(["GPL-2.0", "GPL-3.0", "GPL-3.0-only", "GPL-2.0-or-later"])(
    "classifies %s as strong-copyleft/medium",
    (id) => {
      const r = classify(id);
      expect(r.category).toBe("strong-copyleft");
      expect(r.riskLevel).toBe("medium");
    },
  );

  it.each(["AGPL-3.0", "AGPL-3.0-only", "AGPL-1.0"])(
    "classifies %s as strong-copyleft/high",
    (id) => {
      const r = classify(id);
      expect(r.category).toBe("strong-copyleft");
      expect(r.riskLevel).toBe("high");
    },
  );
});
