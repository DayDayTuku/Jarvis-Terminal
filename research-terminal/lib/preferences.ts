export const SCHEMES = ["default", "deuteranopia", "protanopia", "tritanopia"] as const;
export type Scheme = (typeof SCHEMES)[number];

export function isScheme(value: unknown): value is Scheme {
  return typeof value === "string" && (SCHEMES as readonly string[]).includes(value);
}

export type SavedNote = { text: string; savedAt: string | null };

/** Parse a note from localStorage without trusting old or malformed payloads. */
export function parseSavedNote(raw: string | null): SavedNote | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) return null;
    const savedAt =
      typeof record.savedAt === "string" && !Number.isNaN(Date.parse(record.savedAt))
        ? record.savedAt
        : null;
    return { text, savedAt };
  } catch {
    return null;
  }
}

export function formatNoteTimestamp(savedAt: string | null) {
  if (!savedAt) return "NOT YET SAVED";
  return (
    new Date(savedAt)
      .toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Jakarta",
      })
      .toUpperCase() + " WIB"
  );
}
