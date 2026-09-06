"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type IDXStock = {
  ticker: string;
  name: string;
  sector: string;
};

type SearchResponse = {
  results?: IDXStock[];
};

const POPULAR_IDX: IDXStock[] = [
  { ticker: "BBCA.JK", name: "PT Bank Central Asia Tbk", sector: "FINANCIALS" },
  { ticker: "BBRI.JK", name: "PT Bank Rakyat Indonesia Tbk", sector: "FINANCIALS" },
  { ticker: "BUMI.JK", name: "PT Bumi Resources Tbk", sector: "ENERGY" },
  { ticker: "AMMN.JK", name: "PT Amman Mineral Internasional Tbk", sector: "BASIC MATERIALS" },
  { ticker: "ADRO.JK", name: "PT Alamtri Resources Indonesia Tbk", sector: "ENERGY" },
  { ticker: "TLKM.JK", name: "PT Telkom Indonesia Tbk", sector: "INFRASTRUCTURE" },
  { ticker: "ASII.JK", name: "PT Astra International Tbk", sector: "INDUSTRIALS" },
];

export default function StockSearch({
  onSelect,
  onViewDetail,
  placeholder = "Search IDX tickers, companies (e.g. ABMM, BBCA)...",
}: {
  onSelect: (stock: IDXStock) => void;
  onViewDetail?: (stock: IDXStock) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IDXStock[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch search results with debounce
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setResults([]);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        setLoading(true);
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`
        );

        if (!res.ok) {
          setResults([]);
          return;
        }

        const data = (await res.json()) as SearchResponse;
        setResults(Array.isArray(data.results) ? data.results : []);
        setActiveIndex(-1);
      } catch (error) {
        console.error("Stock search failed:", error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => clearTimeout(timeout);
  }, [query]);

  // Keep active keyboard item visible in scroll view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("li");
      if (items[activeIndex]) {
        items[activeIndex].scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }
  }, [activeIndex]);

  const displayedList =
    query.trim().length > 0 ? results : POPULAR_IDX;

  const handleSelect = useCallback(
    (stock: IDXStock) => {
      onSelect(stock);
      setQuery("");
      setResults([]);
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    },
    [onSelect]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((prev) =>
        prev < displayedList.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((prev) =>
        prev > 0 ? prev - 1 : displayedList.length - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && displayedList[activeIndex]) {
        handleSelect(displayedList[activeIndex]);
      } else if (displayedList.length > 0) {
        handleSelect(displayedList[0]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  return (
    <div
      ref={containerRef}
      className="stock-search-wrap"
      style={{
        position: "relative",
        width: "100%",
        maxWidth: "460px",
        height: "34px",
      }}
    >
      {/* Search Input Bar */}
      <div
        className={`stock-search-bar ${open ? "is-focused" : ""}`}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          height: "100%",
          background: "#05070a",
          border: open ? "1px solid #48a6ff" : "1px solid #28323e",
          borderRadius: "2px",
          padding: "0 8px 0 10px",
          boxShadow: open
            ? "0 0 0 1px rgba(72,166,255,0.25), 0 4px 16px rgba(0,0,0,0.5)"
            : "none",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
          cursor: "text",
        }}
      >
        <span
          className="stock-search-icon"
          style={{
            color: "#48a6ff",
            fontSize: "14px",
            lineHeight: 1,
            marginRight: "8px",
            userSelect: "none",
            display: "flex",
            alignItems: "center",
          }}
        >
          ⌕
        </span>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="stock-search-input"
          style={{
            flex: 1,
            height: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#e8edf3",
            fontFamily:
              "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "11px",
            padding: 0,
            margin: 0,
          }}
        />

        {query.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="stock-search-clear"
            title="Clear search"
            style={{
              background: "transparent",
              border: "none",
              color: "#778596",
              fontSize: "15px",
              lineHeight: 1,
              padding: "2px 6px",
              cursor: "pointer",
              borderRadius: "2px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>
        )}

        <span
          className="stock-search-keycap"
          style={{
            fontSize: "8px",
            color: "#4d5b6a",
            border: "1px solid #1c2734",
            borderRadius: "2px",
            padding: "1px 4px",
            marginLeft: "6px",
            userSelect: "none",
            fontFamily:
              "var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace",
          }}
        >
          ESC
        </span>
      </div>

      {/* Results Dropdown Popover */}
      {open && (
        <div
          className="stock-search-dropdown"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            width: "100%",
            minWidth: "440px",
            background: "#080d14fa",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            border: "1px solid #1f2d3d",
            borderRadius: "3px",
            boxShadow:
              "0 20px 40px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.05)",
            zIndex: 1000,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header Row */}
          <div
            className="stock-search-header"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "6px 12px",
              background: "#0b121b",
              borderBottom: "1px solid #1a2533",
              fontSize: "8px",
              letterSpacing: "0.08em",
              color: "#778596",
              textTransform: "uppercase",
              userSelect: "none",
              fontFamily:
                "var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace",
            }}
          >
            <span>
              {query.trim().length > 0
                ? `IDX EQUITY RESULTS · ${results.length} FOUND`
                : "POPULAR IDX SECURITIES"}
            </span>
            <span style={{ color: "#485868" }}>
              ↑↓ NAVIGATE · ↵ SELECT
            </span>
          </div>

          {/* Loading Indicator */}
          {loading && (
            <div
              className="stock-search-loading"
              style={{
                padding: "18px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                color: "#778596",
                fontSize: "10px",
                fontFamily:
                  "var(--font-geist-mono), ui-monospace, monospace",
                letterSpacing: "0.05em",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "#48a6ff",
                  boxShadow: "0 0 8px #48a6ff",
                  display: "inline-block",
                  animation: "pulse 1s infinite alternate",
                }}
              />
              SEARCHING IDX DATABASE...
            </div>
          )}

          {/* No Results Found */}
          {!loading && query.trim().length > 0 && results.length === 0 && (
            <div
              className="stock-search-empty"
              style={{
                padding: "20px 16px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                color: "#778596",
              }}
            >
              <div
                style={{
                  color: "#e8edf3",
                  fontSize: "11px",
                  fontWeight: 600,
                  fontFamily:
                    "var(--font-geist-mono), ui-monospace, monospace",
                }}
              >
                NO IDX SECURITIES MATCHING &ldquo;{query.toUpperCase()}&rdquo;
              </div>
              <div
                style={{
                  fontSize: "9px",
                  color: "#607080",
                  lineHeight: 1.4,
                  fontFamily:
                    "var(--font-geist-sans), -apple-system, sans-serif",
                }}
              >
                Try searching with a 4-letter Indonesian ticker (e.g. BBCA,
                BUMI, ADRO) or company name.
              </div>
            </div>
          )}

          {/* Results List */}
          {!loading && displayedList.length > 0 && (
            <ul
              ref={listRef}
              className="stock-search-list"
              style={{
                listStyle: "none",
                margin: 0,
                padding: "4px 0",
                maxHeight: "280px",
                overflowY: "auto",
              }}
            >
              {displayedList.map((stock, index) => {
                const isSelected = activeIndex === index;
                const cleanTicker = stock.ticker
                  .replace(".JK", "")
                  .toUpperCase();

                return (
                  <li
                    key={stock.ticker}
                    style={{ margin: 0, padding: 0 }}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(stock)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`stock-search-item ${
                        isSelected ? "selected" : ""
                      }`}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        background: isSelected ? "#0f1c2d" : "transparent",
                        border: "none",
                        borderLeft: isSelected
                          ? "3px solid #48a6ff"
                          : "3px solid transparent",
                        cursor: "pointer",
                        textAlign: "left",
                        transition:
                          "background 0.12s ease, border-color 0.12s ease",
                        gap: "12px",
                      }}
                    >
                      {/* Left: Ticker & Badge & Company Name */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        <span
                          style={{
                            fontFamily:
                              "var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace",
                            fontSize: "12px",
                            fontWeight: 700,
                            color: isSelected ? "#48a6ff" : "#ffffff",
                            letterSpacing: "0.06em",
                            minWidth: "48px",
                          }}
                        >
                          {cleanTicker}
                        </span>

                        <span
                          style={{
                            fontSize: "8px",
                            fontWeight: 600,
                            color: "#48a6ff",
                            background: "rgba(72, 166, 255, 0.12)",
                            padding: "1px 5px",
                            borderRadius: "2px",
                            border: "1px solid rgba(72, 166, 255, 0.25)",
                            fontFamily:
                              "var(--font-geist-mono), ui-monospace, monospace",
                            letterSpacing: "0.05em",
                          }}
                        >
                          IDX
                        </span>

                        <span
                          style={{
                            fontFamily:
                              "var(--font-geist-sans), -apple-system, sans-serif",
                            fontSize: "11px",
                            color: isSelected ? "#cfd7e2" : "#83909f",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                          }}
                        >
                          {stock.name}
                        </span>
                      </div>

                      {/* Right: Action or Sector Hint */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          flexShrink: 0,
                        }}
                      >
                        {stock.sector && stock.sector !== "IDX" && (
                          <span
                            style={{
                              fontSize: "8px",
                              color: "#5b6b7c",
                              fontFamily:
                                "var(--font-geist-mono), ui-monospace, monospace",
                              letterSpacing: "0.04em",
                            }}
                          >
                            {stock.sector}
                          </span>
                        )}
                        {onViewDetail && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewDetail(stock);
                            }}
                            title={`View fundamentals for ${stock.ticker}`}
                            style={{
                              fontSize: "8px",
                              fontWeight: 600,
                              color: "#8393a6",
                              backgroundColor: "#111822",
                              border: "1px solid #233041",
                              padding: "2px 5px",
                              borderRadius: "2px",
                              cursor: "pointer",
                              fontFamily:
                                "var(--font-geist-mono), ui-monospace, monospace",
                              letterSpacing: "0.04em",
                              transition: "all 0.12s ease",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = "#48a6ff";
                              e.currentTarget.style.borderColor = "#48a6ff";
                              e.currentTarget.style.backgroundColor = "#162334";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = "#8393a6";
                              e.currentTarget.style.borderColor = "#233041";
                              e.currentTarget.style.backgroundColor = "#111822";
                            }}
                          >
                            DETAIL
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: "9px",
                            fontWeight: 600,
                            color: "#48a6ff",
                            opacity: isSelected ? 1 : 0,
                            transition: "opacity 0.12s ease",
                            fontFamily:
                              "var(--font-geist-mono), ui-monospace, monospace",
                            letterSpacing: "0.05em",
                          }}
                        >
                          SELECT ↵
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
