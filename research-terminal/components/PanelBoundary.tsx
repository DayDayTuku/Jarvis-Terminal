'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  label: string;
  resetKey?: string;
};

type State = { error: Error | null };

/**
 * Keep one failing panel from blanking the whole terminal. The boundary resets
 * when the active section changes or when the user presses Retry.
 */
export default class PanelBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Panel "${this.props.label}" failed to render`, error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section
        role="alert"
        aria-label={`${this.props.label} unavailable`}
        style={{
          border: '1px solid #5a2a2a',
          background: '#12090b',
          color: '#e8edf3',
          padding: '28px',
          margin: '18px 0',
          fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
        }}
      >
        <span style={{ display: 'block', color: '#ff6678', fontSize: 10, letterSpacing: '.1em' }}>
          {this.props.label.toUpperCase()} · PANEL ERROR
        </span>
        <h2 style={{ margin: '10px 0 8px', fontSize: 18 }}>This section could not be displayed.</h2>
        <p style={{ margin: 0, color: '#93a0af', fontSize: 12, lineHeight: 1.7 }}>
          The rest of the terminal is still available. Retry the section, or switch to another view.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          style={{
            marginTop: 16,
            background: '#48a6ff',
            border: 0,
            color: '#03111f',
            padding: '9px 16px',
            font: 'inherit',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          RETRY SECTION
        </button>
      </section>
    );
  }
}
