import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_SECTIONS,
  PILLARS,
  navShortcut,
  pillarForSection,
  sectionFromHashValue,
  sectionSlug,
} from "../lib/navigation.ts";

test("the shell exposes exactly four primary pillars in product order", () => {
  assert.deepEqual(PILLARS.map((pillar) => pillar.id), ["HOME", "DISCOVER", "INTELLIGENCE", "PORTFOLIO"]);
  assert.deepEqual(PILLARS.map((pillar) => pillar.slug), ["home", "discover", "intelligence", "portfolio"]);
});

test("every existing section is reachable exactly once", () => {
  const labels = ALL_SECTIONS.map((item) => item.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.deepEqual(
    [...labels].sort(),
    [
      "OVERVIEW",
      "MACRO",
      "MARKETS",
      "NEWS",
      "RESEARCH DESK",
      "QUANT LAB",
      "QUANTAMENTAL",
      "PORTFOLIO",
      "RISK MAP",
      "RESEARCH PAPERS",
      "SEASONALITY",
      "MARKET PARTICIPANT",
    ].sort(),
  );
});

test("each section resolves to the pillar that owns it", () => {
  for (const pillar of PILLARS) {
    for (const item of pillar.sections) {
      assert.equal(pillarForSection(item.label), pillar.id);
    }
  }
});

test("legacy section hashes keep working", () => {
  for (const item of ALL_SECTIONS) {
    assert.equal(sectionFromHashValue(`#${sectionSlug(item.label)}`), item.label);
  }
});

test("pillar hashes resolve to their default section", () => {
  assert.equal(sectionFromHashValue("#home"), "OVERVIEW");
  assert.equal(sectionFromHashValue("#discover"), "MARKETS");
  assert.equal(sectionFromHashValue("#intelligence"), "RESEARCH DESK");
  assert.equal(sectionFromHashValue("#portfolio"), "PORTFOLIO");
});

test("unknown or empty hashes fall back to the daily overview", () => {
  assert.equal(sectionFromHashValue(""), "OVERVIEW");
  assert.equal(sectionFromHashValue("#not-a-section"), "OVERVIEW");
});

test("section labels generate stable slugs", () => {
  assert.equal(sectionSlug("QUANT LAB"), "quant-lab");
  assert.equal(sectionSlug("MARKET PARTICIPANT"), "market-participant");
});

test("number shortcuts are scoped to a pillar's section count", () => {
  assert.equal(navShortcut(0), "1");
  assert.equal(navShortcut(4), "5");
  assert.equal(navShortcut(9), "0");
  assert.equal(navShortcut(10), "—");
});
