"use client";

import { useEffect, useState } from "react";

type IDXStock = {
  ticker: string;
  name: string;
  sector: string;
};

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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();

    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        setLoading(true);

        const response = await fetch(
          `/api/search?q=${encodeURIComponent(q)}`
        );

        if (!response.ok) {
          setResults([]);
          return;
        }

        const data = await response.json();

        setResults(
          Array.isArray(data.results) ? data.results : []
        );
      } catch (error) {
        console.error("Stock search failed:", error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="relative w-full">
      <input
        type="text"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
        }}
        aria-label="Search ticker or company"
        placeholder={placeholder}
        autoComplete="off"
        className="w-full bg-black border border-neutral-800 text-white px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
      />

      {open && query.trim() !== "" && (
        <div className="absolute left-0 right-0 top-full z-[9999] mt-1 max-h-72 overflow-y-auto bg-black border border-neutral-800 shadow-2xl">
          {loading && (
            <div className="px-3 py-3 text-xs font-mono text-neutral-500">
              Searching...
            </div>
          )}

          {!loading && results.length === 0 && (
            <div className="px-3 py-3 text-xs font-mono text-neutral-500">
              No Indonesian stocks found
            </div>
          )}

          {!loading &&
            results.map((stock) => (
              <button
                key={stock.ticker}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  onSelect(stock);
                  setQuery("");
                  setResults([]);
                  setOpen(false);
                }}
                className="w-full px-3 py-2 text-left hover:bg-neutral-900 border-b border-neutral-900 last:border-b-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sm text-white">
                    {stock.ticker.replace(".JK", "")}
                  </span>

                  <span className="flex-1 truncate text-xs text-neutral-400">
                    {stock.name}
                  </span>

                  <span className="text-[10px] text-neutral-600">
                    {stock.sector}
                  </span>
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
