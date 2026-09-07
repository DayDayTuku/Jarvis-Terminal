"use client";

import { useEffect, useRef, useState } from "react";

type IDXStock = { ticker: string; name: string; sector: string };

const SECTOR_COLORS: Record<string, string> = {
  Energy: "#ff9840",
  "Basic Materials": "#d9ac54",
  Industrials: "#d8c75f",
  "Consumer Cyclicals": "#ef78ad",
  "Consumer Non-Cyclicals": "#ff7f8d",
  Healthcare: "#43d4a3",
  Financials: "#48a6ff",
  "Properties & Real Estate": "#b58aff",
  Technology: "#4fd7e8",
  Infrastructures: "#49c8bd",
  "Transportation & Logistics": "#9fd65c",
};

const DEFAULT_COLOR = "#778596";

export default function StockSearch({
  onSelect,
  placeholder = "Search ticker or company name...",
}: {
  onSelect: (stock: IDXStock) => void;
  placeholder?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IDXStock[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setResults([]);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(normalized)}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error("Search request failed");
        const data = (await response.json()) as { results?: IDXStock[] };
        setResults(Array.isArray(data.results) ? data.results : []);
        setActiveIndex(-1);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  const selectStock = (stock: IDXStock) => {
    onSelect(stock);
    setQuery("");
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
  };

  const showDropdown = open && query.trim().length > 0;

  return (
    <div ref={containerRef} className="stock-search-wrap">
      <div
        className={`stock-search-bar ${open ? "is-focused" : ""}`}
        onClick={() => inputRef.current?.focus()}
      >
        <span className="stock-search-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
            <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </span>

        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
              return;
            }
            if (event.key === "ArrowDown" && results.length) {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % results.length);
            }
            if (event.key === "ArrowUp" && results.length) {
              event.preventDefault();
              setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
            }
            if (event.key === "Enter" && activeIndex >= 0 && results[activeIndex]) {
              event.preventDefault();
              selectStock(results[activeIndex]);
            }
          }}
          placeholder={placeholder}
          className="stock-search-input"
          aria-label="Search IDX stocks"
          aria-expanded={showDropdown}
          aria-controls="stock-search-results"
          aria-autocomplete="list"
          autoComplete="off"
        />

        {query ? (
          <button
            type="button"
            className="stock-search-clear"
            aria-label="Clear search"
            onClick={(event) => {
              event.stopPropagation();
              setQuery("");
              setResults([]);
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        ) : (
          <span className="stock-search-keycap" aria-hidden="true">/</span>
        )}
      </div>

      {showDropdown && (
        <div
          id="stock-search-results"
          role="listbox"
          className="stock-search-dropdown"
          style={{ minWidth: "min(440px, calc(100vw - 84px))" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "8px 11px",
              borderBottom: "1px solid #1f2d3d",
              color: "#778596",
              fontSize: "8px",
              letterSpacing: ".1em",
            }}
          >
            <span>IDX EQUITY SEARCH</span>
            <span>{loading ? "SCANNING…" : `${results.length} MATCH${results.length === 1 ? "" : "ES"}`}</span>
          </div>

          <div className="stock-search-list" style={{ maxHeight: 272, overflowY: "auto" }}>
            {!loading && results.length === 0 ? (
              <div style={{ padding: "18px 11px", color: "#778596", fontSize: "10px" }}>
                NO MATCHING IDX TICKER
              </div>
            ) : (
              results.map((stock, index) => {
                const color = SECTOR_COLORS[stock.sector] || DEFAULT_COLOR;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    key={stock.ticker}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectStock(stock)}
                    style={{
                      width: "100%",
                      minHeight: 48,
                      display: "grid",
                      gridTemplateColumns: "74px minmax(0, 1fr) auto",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 11px",
                      border: 0,
                      borderBottom: "1px solid #151e29",
                      background: index === activeIndex ? "#0e1824" : "transparent",
                      color: "#e8edf3",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <strong style={{ color, letterSpacing: ".06em" }}>
                      {stock.ticker.replace(".JK", "")}
                    </strong>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#a3adba", fontSize: 10 }}>
                      {stock.name}
                    </span>
                    <span style={{ color, border: `1px solid ${color}66`, padding: "3px 5px", fontSize: 7, whiteSpace: "nowrap" }}>
                      {stock.sector.toUpperCase()}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div style={{ padding: "7px 11px", color: "#536171", fontSize: 7, letterSpacing: ".08em" }}>
            ↑↓ NAVIGATE · ENTER OPEN · ESC CLOSE
          </div>
        </div>
      )}
    </div>
  );
}
