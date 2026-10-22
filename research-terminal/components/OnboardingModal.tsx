'use client';

import { useEffect, useState } from 'react';
import { useDialogFocus } from '../lib/use-dialog-focus';

const STARTER_TICKERS = ['BBCA', 'BMRI', 'ADRO', 'AMMN', 'BUMI', 'TLKM', 'ANTM', 'ITMG'];

export default function OnboardingModal({
  open,
  onClose,
  onComplete,
  onAddTickers,
  onOpenNotes,
  onOpenSettings,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: (addedTickers: string[]) => void;
  onAddTickers: (tickers: string[]) => void;
  onOpenNotes: () => void;
  onOpenSettings: () => void;
}) {
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<string[]>(['BBCA', 'ADRO', 'BUMI']);
  const dialogRef = useDialogFocus<HTMLElement>(open, onClose);

  useEffect(() => {
    if (open) {
      setStep(1);
    }
  }, [open]);

  if (!open) return null;

  const toggle = (ticker: string) => {
    setSelected((current) =>
      current.includes(ticker)
        ? current.filter((item) => item !== ticker)
        : [...current, ticker],
    );
  };

  const finish = () => {
    if (selected.length) onAddTickers(selected);
    onComplete(selected);
  };

  return (
    <div
      className="overlay onboarding-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="onboarding-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <header className="onboarding-head">
          <div>
            <span>JARVIS / FIRST RUN</span>
            <h2 id="onboarding-title">Set up your research desk</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close onboarding">ESC</button>
        </header>

        <div className="onboarding-progress" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((item) => <i key={item} className={item <= step ? 'active' : ''} />)}
          <span>STEP {step} / 3</span>
        </div>

        {step === 1 && (
          <div className="onboarding-step">
            <span className="onboarding-kicker">01 · WATCHLIST</span>
            <h3>Start with the names you actually follow.</h3>
            <p>
              A short, intentional watchlist makes the dashboard useful on day one. You can add or
              remove tickers at any time, and your list syncs across devices.
            </p>
            <div className="onboarding-tickers">
              {STARTER_TICKERS.map((ticker) => (
                <button
                  type="button"
                  key={ticker}
                  className={selected.includes(ticker) ? 'selected' : ''}
                  onClick={() => toggle(ticker)}
                  aria-pressed={selected.includes(ticker)}
                >
                  {ticker}
                  <span>{selected.includes(ticker) ? '✓' : '+'}</span>
                </button>
              ))}
            </div>
            <small className="onboarding-note">{selected.length} selected · you can change this later</small>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-step">
            <span className="onboarding-kicker">02 · THESIS</span>
            <h3>Write down what would prove you wrong.</h3>
            <p>
              Jarvis works best as a research log, not a prediction machine. Save a falsifiable thesis
              so future-you can see what changed and why.
            </p>
            <div className="onboarding-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  if (selected.length) onAddTickers(selected);
                  onOpenNotes();
                }}
              >
                WRITE FIRST THESIS
              </button>
              <span>Optional · your note stays private to your account</span>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-step">
            <span className="onboarding-kicker">03 · CADENCE</span>
            <h3>Choose how Jarvis reaches you.</h3>
            <p>
              The weekly brief is opt-in only. You can enable it now or keep everything inside the
              terminal. Market data remains visible with an explicit freshness label.
            </p>
            <div className="onboarding-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  if (selected.length) onAddTickers(selected);
                  onOpenSettings();
                }}
              >
                OPEN NOTIFICATION SETTINGS
              </button>
              <span>No email is sent unless you explicitly opt in.</span>
            </div>
          </div>
        )}

        <footer className="onboarding-footer">
          <button type="button" className="quiet-button" onClick={onClose}>SKIP FOR NOW</button>
          <div>
            {step > 1 && <button type="button" onClick={() => setStep((value) => value - 1)}>BACK</button>}
            {step < 3 ? (
              <button type="button" className="primary-button" onClick={() => setStep((value) => value + 1)}>
                CONTINUE
              </button>
            ) : (
              <button type="button" className="primary-button" onClick={finish}>
                ENTER TERMINAL
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
