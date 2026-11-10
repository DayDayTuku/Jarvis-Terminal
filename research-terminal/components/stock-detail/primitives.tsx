"use client";

import type { CSSProperties } from "react";

export function Row({
  label,
  value,
  na,
}: {
  label: string;
  value: string;
  na?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "4px 0",
        borderBottom: "1px solid #101722",
      }}
    >
      <span style={{ color: "var(--muted)", fontSize: "11px" }}>{label}</span>
      <span
        style={{
          color: na ? "#4a5568" : "#ffffff",
          fontWeight: 600,
          fontSize: "11px",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function RatingBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null;
  color: string;
}) {
  // Keep the tally legible on both bright and dark bar tints: dark ink on the
  // bright green/red bars, white ink on the deep ones.
  const channels = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4),
  );
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  const darkLuminance = 0.006;
  const whiteContrast = 1.05 / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / (darkLuminance + 0.05);
  const ink = whiteContrast >= darkContrast ? "#ffffff" : "#0b1220";
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div
        className="rating-bar-value"
        style={{
          "--rating-ink": ink,
          height: "32px",
          backgroundColor: color,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          color: ink,
          fontSize: "11px",
          fontWeight: 700,
          borderRadius: "2px",
          paddingBottom: "3px",
        } as CSSProperties}
      >
        {value ?? 0}
      </div>
      <div
        style={{
          color: "var(--muted)",
          fontSize: "8px",
          marginTop: "4px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
    </div>
  );
}
