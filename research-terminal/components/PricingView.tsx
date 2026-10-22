'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { trackEvent } from '../lib/analytics-client';

const plans = [
  {
    key: 'free',
    name: 'Free',
    price: 'Rp0',
    cadence: 'forever',
    summary: 'A complete daily research surface for individual investors getting started.',
    features: [
      'Daily overview, macro regime, market breadth',
      'Personal watchlist and thesis log sync',
      'Portfolio concentration and scenario stress',
      'News, research papers, seasonality, COT',
      'Weekly brief opt-in',
    ],
    cta: 'START FREE',
    href: '/access?returnTo=/',
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 'Rp149k',
    cadence: 'per month',
    summary: 'For serious IDX investors who want deeper workflow and faster review.',
    features: [
      'Everything in Free',
      'Extended thesis history and note export',
      'Portfolio CSV import/export and saved scenarios',
      'Email alerts for regime and watchlist changes',
      'Priority data-refresh lane',
      'Founding-member pricing while checkout is finalized',
    ],
    cta: 'JOIN PRO',
    href: process.env.NEXT_PUBLIC_UPGRADE_URL ?? '',
  },
  {
    key: 'desk',
    name: 'Desk',
    price: 'Custom',
    cadence: 'per team',
    summary: 'For research teams, creators, and communities that need a branded desk.',
    features: [
      'Everything in Pro',
      'White-label workspace and custom domain',
      'Shared watchlists and team notes',
      'Research publishing workflow',
      'API and data-export access',
      'Onboarding and support',
    ],
    cta: 'TALK TO US',
    href: process.env.NEXT_PUBLIC_SALES_EMAIL ? `mailto:${process.env.NEXT_PUBLIC_SALES_EMAIL}` : '',
  },
] as const;

export default function PricingView() {
  useEffect(() => {
    trackEvent('pricing_view');
  }, []);

  const choose = (plan: string, checkoutReady: boolean) => {
    trackEvent('upgrade_click', { source: 'pricing', plan, checkoutReady });
  };

  return (
    <div className="pricing-view">
      <header className="pricing-hero">
        <Link className="pricing-back" href="/">← BACK TO TERMINAL</Link>
        <span className="pricing-kicker">JARVIS / PLANS</span>
        <h1>Research depth without a paywall on the basics.</h1>
        <p>
          Free access stays open and account creation stays free. Paid tiers fund better data,
          deeper workflows, and team tooling—not access to your own watchlist.
        </p>
        <div className="pricing-promise">
          <span>NO PERSONALIZED STOCK ADVICE</span>
          <span>NO LOCKED WATCHLIST</span>
          <span>EXPLICIT DATA FRESHNESS</span>
        </div>
      </header>

      <section className="pricing-grid" aria-label="Subscription plans">
        {plans.map((plan) => {
          const checkoutReady = Boolean(plan.href);
          return (
            <article className={`pricing-card ${plan.key}`} key={plan.key}>
              {plan.key === 'pro' && <span className="pricing-ribbon">MOST USEFUL</span>}
              <header>
                <span>{plan.name.toUpperCase()}</span>
                <div><strong>{plan.price}</strong><small>{plan.cadence}</small></div>
                <p>{plan.summary}</p>
              </header>
              <ul>
                {plan.features.map((feature) => <li key={feature}><i aria-hidden="true">✓</i>{feature}</li>)}
              </ul>
              {checkoutReady ? (
                plan.href.startsWith('/') ? (
                  <Link
                    className={`pricing-cta ${plan.key === 'pro' ? 'primary' : ''}`}
                    href={plan.href}
                    onClick={() => choose(plan.key, true)}
                  >
                    {plan.cta} <span aria-hidden="true">→</span>
                  </Link>
                ) : (
                  <a
                    className={`pricing-cta ${plan.key === 'pro' ? 'primary' : ''}`}
                    href={plan.href}
                    onClick={() => choose(plan.key, true)}
                  >
                    {plan.cta} <span aria-hidden="true">→</span>
                  </a>
                )
              ) : (
                <button
                  className={`pricing-cta ${plan.key === 'pro' ? 'primary' : ''}`}
                  type="button"
                  disabled
                  onClick={() => choose(plan.key, false)}
                >
                  {plan.key === 'pro' ? 'CHECKOUT COMING SOON' : 'CONTACT CHANNEL COMING SOON'}
                </button>
              )}
              {!checkoutReady && plan.key === 'pro' && (
                <small className="pricing-note">Your free workspace remains fully usable while billing is finalized.</small>
              )}
            </article>
          );
        })}
      </section>

      <section className="pricing-faq">
        <div><span>WHY FREE?</span><h2>Trust first, revenue second.</h2><p>A terminal is only useful if it becomes a habit. The core daily briefing stays free so price never blocks a retail investor from checking their own risk.</p></div>
        <div><span>WHAT DOES PRO ADD?</span><h2>Depth, not secret signals.</h2><p>Pro is about history, exports, alerts, and workflow. Jarvis does not sell guaranteed returns or personalized buy/sell recommendations.</p></div>
        <div><span>DATA HONESTY</span><h2>Unavailable means unavailable.</h2><p>When a feed fails, the panel says so. We do not fill production screens with synthetic values that look live.</p></div>
      </section>

      <footer className="pricing-footer">
        <span>JARVIS / RESEARCH USE ONLY · NOT INVESTMENT ADVICE</span>
        <Link href="/access?returnTo=/">SIGN IN OR CREATE ACCOUNT →</Link>
      </footer>
    </div>
  );
}
