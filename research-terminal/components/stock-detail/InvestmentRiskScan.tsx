"use client";

import { fmtBig, fmtPct, type Detail } from "./shared";

type RiskTone = "strong" | "watch" | "risk";

type RiskCheck = {
  label: string;
  detail: string;
  tone: RiskTone;
  value: string;
};

export default function InvestmentRiskScan({ data }: { data: Detail }) {
  const sector = String(data.sector ?? "").toLowerCase();
  const isFinancial = sector.includes("financial") || sector.includes("bank");
  const checks: RiskCheck[] = [];

  const addCheck = (
    label: string,
    rawValue: unknown,
    formatter: (value: number) => string,
    classify: (value: number) => { tone: RiskTone; detail: string }
  ) => {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) return;
    const result = classify(rawValue);
    checks.push({ label, value: formatter(rawValue), ...result });
  };

  addCheck("Return on equity", data.returnOnEquity, (value) => fmtPct(value), (value) =>
    value < 0
      ? { tone: "risk", detail: "Negative ROE: shareholder capital is not producing profit." }
      : value < 0.12
        ? { tone: "watch", detail: "Positive, but below the 12% quality reference." }
        : { tone: "strong", detail: "Above the 12% quality reference." }
  );
  addCheck("Profit margin", data.profitMargin, (value) => fmtPct(value), (value) =>
    value < 0
      ? { tone: "risk", detail: "The business is loss-making on a trailing basis." }
      : value < 0.08
        ? { tone: "watch", detail: "Positive but thin; small shocks can erase profit." }
        : { tone: "strong", detail: "Healthy positive margin above 8%." }
  );
  addCheck("Revenue momentum", data.revenueGrowth, (value) => fmtPct(value), (value) =>
    value < -0.05
      ? { tone: "risk", detail: "Revenue is contracting by more than 5%." }
      : value < 0.05
        ? { tone: "watch", detail: "Revenue is broadly flat; verify the growth catalyst." }
        : { tone: "strong", detail: "Revenue growth is above 5%." }
  );
  addCheck("Free cash flow", data.freeCashflow, (value) => fmtBig(value), (value) =>
    value < 0
      ? { tone: "risk", detail: "Negative free cash flow can raise funding or dilution risk." }
      : { tone: "strong", detail: "The business generated positive free cash flow." }
  );
  addCheck("Operating cash flow", data.operatingCashflow, (value) => fmtBig(value), (value) =>
    value < 0
      ? { tone: "risk", detail: "Core operations consumed cash in the latest period." }
      : { tone: "strong", detail: "Core operations generated cash." }
  );

  if (!isFinancial) {
    addCheck("Current ratio", data.currentRatio, (value) => `${value.toFixed(2)}×`, (value) =>
      value < 0.8
        ? { tone: "risk", detail: "Short-term assets may not comfortably cover liabilities." }
        : value < 1.2
          ? { tone: "watch", detail: "Liquidity buffer is narrow." }
          : { tone: "strong", detail: "Short-term liquidity is above the 1.2× reference." }
    );
    addCheck("Debt to equity", data.debtToEquity, (value) => `${value.toFixed(0)}%`, (value) =>
      value > 200
        ? { tone: "risk", detail: "Leverage is above 200% of equity." }
        : value > 100
          ? { tone: "watch", detail: "Leverage is meaningful; check debt maturity and interest cover." }
          : { tone: "strong", detail: "Leverage is below 100% of equity." }
    );
  }

  addCheck("Earnings valuation", data.trailingPE, (value) => `${value.toFixed(2)}×`, (value) =>
    value <= 0
      ? { tone: "risk", detail: "P/E is not meaningful because trailing earnings are non-positive." }
      : value > 40
        ? { tone: "watch", detail: "High multiple requires strong, durable growth to justify it." }
        : { tone: "strong", detail: "Positive earnings with P/E below the 40× risk threshold." }
  );

  const riskCount = checks.filter((item) => item.tone === "risk").length;
  const watchCount = checks.filter((item) => item.tone === "watch").length;
  const strongCount = checks.filter((item) => item.tone === "strong").length;
  const possibleChecks = isFinancial ? 6 : 8;
  const coverage = Math.round((checks.length / possibleChecks) * 100);
  const verdict =
    checks.length < 3
      ? "INSUFFICIENT DATA"
      : riskCount >= 2
        ? "MULTIPLE RED FLAGS"
        : riskCount === 1
          ? "ONE MATERIAL RED FLAG"
          : watchCount >= 3
            ? "NEEDS DEEPER REVIEW"
            : "NO MAJOR FLAGS DETECTED";
  const verdictColor =
    checks.length < 3 ? "#778596" : riskCount ? "#ff6678" : watchCount >= 3 ? "#ffb45e" : "#43d4a3";
  const toneStyles: Record<RiskTone, { color: string; label: string; bg: string }> = {
    strong: { color: "#43d4a3", label: "CLEAR", bg: "#071510" },
    watch: { color: "#ffb45e", label: "WATCH", bg: "#171108" },
    risk: { color: "#ff6678", label: "RED FLAG", bg: "#19090d" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ color: "#48a6ff", fontSize: 9, fontWeight: 700, letterSpacing: ".08em" }}>
          INVESTMENT RISK SCAN · RULE-BASED
        </div>
        <div style={{ marginTop: 5, color: "#778596", fontSize: 9, lineHeight: 1.55 }}>
          A fast pre-mortem before valuation work. Every signal shows its rule; this is a checklist, not a buy or sell recommendation.
          {isFinancial ? " Liquidity and debt/equity tests are excluded for financial companies because their balance sheets are structurally different." : ""}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.35fr repeat(3, .65fr)", border: "1px solid #235886", background: "linear-gradient(90deg, #091522, #071019)" }}>
        <div style={{ padding: "12px 13px", borderRight: "1px solid #1d344a" }}>
          <span style={{ display: "block", color: "#536171", fontSize: 7, letterSpacing: ".08em" }}>OVERALL READ</span>
          <strong style={{ display: "block", marginTop: 5, color: verdictColor, fontSize: 11 }}>{verdict}</strong>
          <span style={{ display: "block", marginTop: 4, color: "#778596", fontSize: 8 }}>{coverage}% DATA COVERAGE</span>
        </div>
        {[
          ["CLEAR", strongCount, "#43d4a3"],
          ["WATCH", watchCount, "#ffb45e"],
          ["RED FLAGS", riskCount, "#ff6678"],
        ].map(([label, value, color]) => (
          <div key={String(label)} style={{ padding: "12px 10px", borderRight: "1px solid #1d344a", textAlign: "center" }}>
            <strong style={{ display: "block", color: String(color), fontSize: 17 }}>{value}</strong>
            <span style={{ display: "block", marginTop: 4, color: "#778596", fontSize: 7 }}>{label}</span>
          </div>
        ))}
      </div>

      {checks.length ? (
        <div style={{ display: "grid", gap: 7 }}>
          {checks
            .sort((a, b) => ({ risk: 0, watch: 1, strong: 2 }[a.tone] - { risk: 0, watch: 1, strong: 2 }[b.tone]))
            .map((item) => {
              const style = toneStyles[item.tone];
              return (
                <div key={item.label} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, padding: "10px 11px", border: "1px solid #182332", background: style.bg }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <strong style={{ color: "#e8edf3", fontSize: 10 }}>{item.label}</strong>
                      <span style={{ color: style.color, fontSize: 7, fontWeight: 800, letterSpacing: ".07em" }}>{style.label}</span>
                    </div>
                    <div style={{ marginTop: 4, color: "#778596", fontSize: 8, lineHeight: 1.45 }}>{item.detail}</div>
                  </div>
                  <strong style={{ color: style.color, fontSize: 12, alignSelf: "center" }}>{item.value}</strong>
                </div>
              );
            })}
        </div>
      ) : (
        <div style={{ minHeight: 190, display: "grid", placeContent: "center", textAlign: "center", color: "#778596", fontSize: 10, lineHeight: 1.6 }}>
          Risk scan needs live fundamental data.<br />Retry when the data connection is available.
        </div>
      )}

      <div style={{ color: "#536171", fontSize: 7, lineHeight: 1.5 }}>
        THRESHOLDS ARE GENERAL SCREENING REFERENCES · REVIEW FILINGS, DEBT MATURITY, ONE-OFF ITEMS, AND SECTOR-SPECIFIC ACCOUNTING BEFORE INVESTING
      </div>
    </div>
  );
}
