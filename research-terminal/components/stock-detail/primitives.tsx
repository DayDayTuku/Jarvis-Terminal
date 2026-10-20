"use client";

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
      <span style={{ color: "#778596", fontSize: "11px" }}>{label}</span>
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
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div
        style={{
          height: "32px",
          backgroundColor: color,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          color: "#ffffff",
          fontSize: "11px",
          fontWeight: 700,
          borderRadius: "2px",
          paddingBottom: "3px",
        }}
      >
        {value ?? 0}
      </div>
      <div
        style={{
          color: "#778596",
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
