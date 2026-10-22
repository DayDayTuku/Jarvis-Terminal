'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { trackEvent } from '../lib/analytics-client';
import { useDialogFocus } from '../lib/use-dialog-focus';

type SectionCommand = { label: string; description: string };

type StockResult = { ticker: string; name: string; sector: string };

export default function CommandPalette({
  sections,
  onNavigate,
  onOpenStock,
  onOpenNotes,
  onOpenSettings,
  onOpenPricing,
  onOpenFeedback,
  open,
  onOpenChange,
}: {
  sections: SectionCommand[];
  onNavigate: (label: string) => void;
  onOpenStock: (ticker: string) => void;
  onOpenNotes: () => void;
  onOpenSettings: () => void;
  onOpenPricing: () => void;
  onOpenFeedback: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [stocks, setStocks] = useState<StockResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus<HTMLElement>(open, () => onOpenChange(false));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      trackEvent('command_palette_open');
      setQuery('');
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setStocks([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(normalized)}`, { credentials: 'same-origin' })
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data: { results?: StockResult[] }) => {
          if (!cancelled) setStocks((data.results ?? []).slice(0, 6));
        })
        .catch(() => {
          if (!cancelled) setStocks([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const actions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const navigationCommands = sections
      .filter((section) => !normalized || section.label.toLowerCase().includes(normalized) || section.description.toLowerCase().includes(normalized))
      .map((section) => ({
        key: `nav-${section.label}`,
        label: section.label,
        hint: section.description,
        run: () => onNavigate(section.label),
      }));

    const utilityCommands = [
      { label: 'OPEN RESEARCH NOTES', hint: 'Write or review your thesis log', run: onOpenNotes },
      { label: 'OPEN SETTINGS', hint: 'Data connections, accessibility, notifications', run: onOpenSettings },
      { label: 'VIEW PLANS & PRICING', hint: 'Free, Pro, and Desk options', run: onOpenPricing },
      { label: 'SEND FEEDBACK', hint: 'Report a data issue or request a feature', run: onOpenFeedback },
    ]
      .filter((command) => !normalized || command.label.toLowerCase().includes(normalized) || command.hint.toLowerCase().includes(normalized))
      .map((command) => ({ ...command, key: `action-${command.label}` }));

    const stockCommands = stocks.map((stock) => ({
      key: `stock-${stock.ticker}`,
      label: stock.ticker,
      hint: `${stock.name} · ${stock.sector}`,
      run: () => onOpenStock(stock.ticker),
    }));

    return [...navigationCommands, ...utilityCommands, ...stockCommands];
  }, [query, sections, stocks, onNavigate, onOpenNotes, onOpenSettings, onOpenPricing, onOpenFeedback, onOpenStock]);

  useEffect(() => {
    setActiveIndex(0);
  }, [actions.length]);

  if (!open) return null;

  const run = (index: number) => {
    const action = actions[index];
    if (!action) return;
    onOpenChange(false);
    action.run();
  };

  return (
    <div
      className="overlay command-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="command-input-row">
          <span aria-hidden="true">⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.min(actions.length - 1, index + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                run(activeIndex);
              }
            }}
            placeholder="Jump to a section, ticker, or action..."
            aria-label="Search commands"
            aria-controls="command-results"
            aria-activedescendant={actions[activeIndex] ? `command-${actions[activeIndex].key}` : undefined}
          />
          {searching && <small>SEARCHING TICKERS...</small>}
          <kbd>ESC</kbd>
        </div>
        <div className="command-results" id="command-results" role="listbox" aria-label="Command results">
          {actions.length === 0 && (
            <p className="command-empty">
              No match. Try a ticker such as BBCA, or a section such as MACRO.
            </p>
          )}
          {actions.map((action, index) => (
            <button
              type="button"
              key={action.key}
              id={`command-${action.key}`}
              role="option"
              aria-selected={activeIndex === index}
              className={activeIndex === index ? 'active' : ''}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => run(index)}
            >
              <span>
                <strong>{action.label}</strong>
                <small>{action.hint}</small>
              </span>
              <b aria-hidden="true">↵</b>
            </button>
          ))}
        </div>
        <footer className="command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>⌘</kbd><kbd>K</kbd> toggle</span>
        </footer>
      </section>
    </div>
  );
}
