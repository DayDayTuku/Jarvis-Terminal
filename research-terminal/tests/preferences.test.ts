import test from "node:test";
import assert from "node:assert/strict";
import { SCHEMES, formatNoteTimestamp, isScheme, parseSavedNote } from "../lib/preferences.ts";

test("only known color schemes are accepted", () => {
  for (const scheme of SCHEMES) assert.equal(isScheme(scheme), true);
  assert.equal(isScheme("rainbow"), false);
  assert.equal(isScheme(""), false);
  assert.equal(isScheme(null), false);
});

test("saved notes are parsed defensively", () => {
  assert.deepEqual(
    parseSavedNote(JSON.stringify({ text: "  Watch Core PCE.  ", savedAt: "2026-10-20T12:00:00.000Z" })),
    { text: "Watch Core PCE.", savedAt: "2026-10-20T12:00:00.000Z" },
  );
  assert.deepEqual(parseSavedNote(JSON.stringify({ text: "No timestamp" })), {
    text: "No timestamp",
    savedAt: null,
  });
  assert.equal(parseSavedNote(null), null);
  assert.equal(parseSavedNote("not-json"), null);
  assert.equal(parseSavedNote(JSON.stringify({ text: "   " })), null);
  assert.equal(parseSavedNote(JSON.stringify({ savedAt: "2026-10-20T12:00:00.000Z" })), null);
});

test("invalid timestamps fall back to an unsaved label", () => {
  assert.equal(formatNoteTimestamp(null), "NOT YET SAVED");
  assert.match(formatNoteTimestamp("2026-10-20T12:00:00.000Z"), /2026.*WIB$/);
});
