"use client";

import { useEffect, useState } from "react";

type IDXStock = {
  ticker: string;
  name: string;
  sector: string;
};

type SearchResponse = {
  results?: IDXStock[];
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
    if (query.trim().length < 1) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        setLoading(true);

        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`
        );

        if (!res.ok) {
          setResults([]);
          return;
        }

        const data = (await res.json()) as SearchResponse;

        setResults(Array.isArray(data.results) ? data.results : []);
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
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full bg-black border border-neutral-800 text-white px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
      />

      {open && query.trim().length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-black border border-neutral-800 max-h-64 overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-xs text-neutral-500 font-mono">
              SEARCHING...
            </div>
          )}

          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-neutral-600 font-mono">
              NO RESULTS
            </div>
          )}

          {!loading &&
            results.map((stock) => (
              <button
                key={stock.ticker}
                type="button"
                onClick={() => {
                  onSelect(stock);
                  setQuery("");
                  setResults([]);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-neutral-900 flex justify-between items-center text-sm"
              >
                <span className="text-white font-mono">
                  {stock.ticker.replace(".JK", "")}
                </span>

                <span className="text-neutral-500 text-xs truncate ml-2">
                  {stock.name}
                </span>

                <span className="text-neutral-600 text-xs ml-2">
                  {stock.sector}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
