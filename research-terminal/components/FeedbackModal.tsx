'use client';

import { FormEvent, useState } from 'react';
import { useDialogFocus } from '../lib/use-dialog-focus';

type FeedbackKind = 'BUG' | 'DATA' | 'FEATURE' | 'OTHER';
type SubmitState = 'idle' | 'sending' | 'sent' | 'error';

export default function FeedbackModal({
  open,
  section,
  ticker,
  onClose,
}: {
  open: boolean;
  section: string;
  ticker?: string | null;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>('BUG');
  const [message, setMessage] = useState('');
  const [contactOkay, setContactOkay] = useState(true);
  const [state, setState] = useState<SubmitState>('idle');
  const [error, setError] = useState('');

  const dialogRef = useDialogFocus<HTMLElement>(open, () => {
    if (state !== 'sending') onClose();
  });

  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (message.trim().length < 10 || state === 'sending') return;
    setState('sending');
    setError('');

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          message: message.trim(),
          section,
          ticker: ticker || null,
          contactOkay,
          website: form.get('website') || '',
          url: window.location.href,
        }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Feedback could not be sent.');
      setState('sent');
      setMessage('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Feedback could not be sent.');
      setState('error');
    }
  };

  return (
    <div className="feedback-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && state !== 'sending') onClose();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <header className="feedback-head">
          <div>
            <span>HELP SHAPE JARVIS</span>
            <h2 id="feedback-title">SEND FEEDBACK</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close feedback form">ESC</button>
        </header>

        {state === 'sent' ? (
          <div className="feedback-success">
            <i aria-hidden="true">✓</i>
            <strong>FEEDBACK RECEIVED</strong>
            <p>Thanks. Your context was attached automatically, so you do not need to repeat where the issue happened.</p>
            <button type="button" className="primary-button full" onClick={onClose}>BACK TO TERMINAL</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <fieldset>
              <legend>WHAT IS THIS ABOUT?</legend>
              <div className="feedback-kinds">
                {(['BUG', 'DATA', 'FEATURE', 'OTHER'] as FeedbackKind[]).map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={kind === item ? 'selected' : ''}
                    aria-pressed={kind === item}
                    onClick={() => setKind(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </fieldset>

            <label htmlFor="feedback-message">WHAT HAPPENED OR WHAT SHOULD IMPROVE?</label>
            <textarea
              id="feedback-message"
              autoFocus
              required
              minLength={10}
              maxLength={1200}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={kind === 'BUG' ? 'What did you expect, and what happened instead?' : 'Describe the improvement and why it would help your investing workflow.'}
            />
            <div className="feedback-meta">
              <span>{section}{ticker ? ` · ${ticker.replace('.JK', '')}` : ''} · CONTEXT ATTACHED</span>
              <span>{message.length}/1200</span>
            </div>

            <label className="feedback-contact">
              <input
                type="checkbox"
                checked={contactOkay}
                onChange={(event) => setContactOkay(event.target.checked)}
              />
              <span>You may contact me about this feedback</span>
            </label>
            <input className="feedback-honey" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />

            {error && <p className="feedback-error" role="alert">{error}</p>}
            <div className="feedback-actions">
              <button type="button" onClick={onClose} disabled={state === 'sending'}>CANCEL</button>
              <button type="submit" className="primary-button" disabled={message.trim().length < 10 || state === 'sending'}>
                {state === 'sending' ? 'SENDING…' : 'SEND FEEDBACK'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
