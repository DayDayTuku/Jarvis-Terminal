"use client";

import { useEffect, useState } from "react";
import type { Section } from "../../lib/navigation";
import WeeklyShortlist from "../WeeklyShortlist";
import TrackRecord from "../TrackRecord";
import type { BreadthRead } from "@/lib/market-breadth";

/**
 * Model Portfolio is deliberately a separate surface from My Portfolio.
 *
 * The weekly V5 shortlist and its track record are hypothetical model output.
 * They are not the signed-in user's holdings, and this component never fetches
 * or displays account positions. My Portfolio owns that data.
 */

type Setup = {
  ticker: string;
  setup: string;
  score: number;
  close: number;
  entryLow: number;
  entryHigh: number;
  invalidation: number;
  target: number;
  riskReward: number;
  sector?: string;
};

type ScannerPayload = {
  status?: string;
  asOf?: string;
  setups?: Setup[];
  breadth?: BreadthRead | null;
  message?: string;
};

type ScannerState =
  | { kind: "loading" }
  | { kind: "ready"; setups: Setup[]; breadth: BreadthRead | null; asOf: string | null; status: string }
  | { kind: "unavailable"; message: string };

export default function ModelPortfolio({
  onNavigate,
}: {
  onNavigate: (section: Section) => void;
}) {
  const [scanner, setScanner] = useState<ScannerState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/swing-setups", { signal: controller.signal, credentials: "same-origin" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as ScannerPayload;
        if (!response.ok) throw new Error(payload.message || `Scanner returned HTTP ${response.status}`);
        return payload;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setScanner({
          kind: "ready",
          setups: Array.isArray(payload.setups) ? payload.setups : [],
          breadth: payload.breadth ?? null,
          asOf: typeof payload.asOf === "string" ? payload.asOf : null,
          status: typeof payload.status === "string" ? payload.status : "live",
        });
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setScanner({
          kind: "unavailable",
          message: reason instanceof Error ? reason.message : "Setup scanner unavailable",
        });
      });
    return () => controller.abort();
  }, []);

  const setups = scanner.kind === "ready" ? scanner.setups : [];
  const breadth = scanner.kind === "ready" ? scanner.breadth : null;

  return (
    <section className="model-portfolio-page">
      <header className="panel model-portfolio-hero">
        <div className="model-portfolio-copy">
          <span className="model-portfolio-kicker">PORTFOLIO / MODEL PORTFOLIO</span>
          <h2>Model picks and the published track record.</h2>
          <p>
            The weekly V5 shortlist is a hypothetical research model with Rp10m of model capital. It is
            not your account, not your holdings, and not an instruction to trade. Your saved positions
            stay under My Portfolio.
          </p>
          <button type="button" className="quiet-button" onClick={() => onNavigate("PORTFOLIO")}>
            OPEN MY PORTFOLIO →
          </button>
        </div>
        <div className="model-portfolio-badges" aria-label="Model portfolio disclosures">
          <span><i />OWNERSHIP<b>MODEL · NOT YOURS</b></span>
          <span><i />MODEL CAPITAL<b>Rp10,000,000</b></span>
          <span><i />DECISION CADENCE<b>FRIDAY REBALANCE</b></span>
        </div>
      </header>

      <div className="model-portfolio-strip">
        <div><span>WHAT THIS PAGE IS</span><strong>Hypothetical weekly picks, changes, and realised model performance.</strong></div>
        <div><span>WHAT IT IS NOT</span><strong>Your holdings, your cost basis, or personalised advice.</strong></div>
        <div><span>LIVE SCANNER</span><strong>{scanner.kind === "loading" ? "CHECKING…" : scanner.kind === "unavailable" ? "UNAVAILABLE" : `${scanner.setups.length} SETUPS · ${scanner.status.toUpperCase()}`}</strong></div>
        <div><span>LAST SCAN</span><strong>{scanner.kind === "ready" && scanner.asOf ? new Date(scanner.asOf).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) + " WIB" : "—"}</strong></div>
      </div>

      {scanner.kind === "unavailable" && (
        <div className="model-portfolio-warning">
          <strong>LIVE SETUP SCANNER UNAVAILABLE</strong>
          <span>{scanner.message}</span>
          <span>The stored weekly run and track record below are still shown. No current-scanner pick is invented.</span>
        </div>
      )}

      <WeeklyShortlist setups={setups} breadth={breadth} />

      <TrackRecord />

      <p className="model-portfolio-footnote">
        Weekly picks use closing-price structure, trend, momentum, and volume. Track-record returns are
        model outcomes, not returns earned by any user. Cash is a valid model position. Verify liquidity,
        corporate actions, and borrow availability before acting on any idea.
      </p>
    </section>
  );
}
