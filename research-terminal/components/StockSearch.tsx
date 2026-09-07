// components/StockSearch.tsx (v2 — sector color coding)
"use client";

import { useState, useEffect } from "react";

type IDXStock = { ticker: string; name: string; sector: string };

// One color per sector — adjust hex values to match the terminal's existing palette if needed
const SECTOR_COLORS: Record<string, string> = {
  "Energy": "text-orange-400",
  "Basic Materials": "text-amber-400",
  "Industrials": "text-yellow-400",
  "Consumer Cyclicals": "text-pink-400",
  "Consumer Non-Cyclicals": "text-rose-400",
  "Healthcare": "text-emerald-400",
  "Financials": "text-blue-400",
  "Properties & Real Estate": "text-purple-400",
  "Technology": "text-cyan-400",
  "Infrastructures": "text-teal-400",
  "Transportation & Logistics": "text-lime-400",
};

const DEFAULT_COLOR = "text-neutral-400";

function sectorColor(sector: string) {
  return SECTOR_COLORS[sector] || DEFAULT_COLOR;
}

export default function StockSearch({
  onSelect,
  placeholder = "Search ticker or company name...",
}: {
  onSelect: (stock: IDXStock) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IDXStock[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
       const data = await res.json() as { results: IDXStock[] };
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full bg-black border border-neutral-800 text-white px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-black border border-neutral-800 max-h-64 overflow-y-auto">
          {results.map((stock) => (
            <button
              key={stock.ticker}
              onClick={() => {
                onSelect(stock);
                setQuery("");
                setResults([]);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-neutral-900 flex justify-between items-center text-sm"
            >
              <span className={`font-mono font-bold ${sectorColor(stock.sector)}`}>
                {stock.ticker.replace(".JK", "")}
              </span>
              <span className="text-neutral-500 text-xs truncate ml-2 flex-1">
                {stock.name}
              </span>
              <span
                className={`text-[10px] ml-2 px-1.5 py-0.5 border border-current ${sectorColor(
                  stock.sector
                )}`}
              >
                {stock.sector}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
