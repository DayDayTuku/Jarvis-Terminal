'use client';

import { useEffect, useState } from 'react';
import { createClient } from '../utils/supabase/client';
import { PLAN_LABELS, planFromMetadata, type Plan } from '../lib/entitlements';
import { trackEvent } from '../lib/analytics-client';

export default function PlanCard() {
  const [plan, setPlan] = useState<Plan>('free');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    try {
      const supabase = createClient();
      supabase.auth.getUser()
        .then(({ data }) => {
          if (cancelled) return;
          setPlan(planFromMetadata(data.user?.user_metadata));
          setEmail(data.user?.email ?? '');
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } catch {
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="setting-block plan-card">
      <h3>PLAN &amp; BILLING</h3>
      <p>Free access stays open. Paid tiers add workflow depth and team features; no existing research surface is locked.</p>
      <div className="plan-summary">
        <div>
          <span>CURRENT PLAN</span>
          <strong>{loading ? 'CHECKING...' : PLAN_LABELS[plan].toUpperCase()}</strong>
          <small>{email || 'Signed-in account'}</small>
        </div>
        <span className={`plan-badge ${plan}`}>{plan === 'free' ? 'FREE' : 'ACTIVE'}</span>
      </div>
      <a
        className="plan-link"
        href="/pricing"
        onClick={() => trackEvent('upgrade_click', { source: 'settings', currentPlan: plan })}
      >
        {plan === 'free' ? 'COMPARE PLANS & UPGRADE' : 'MANAGE PLAN'}
        <span aria-hidden="true">→</span>
      </a>
      {plan === 'free' && (
        <small className="plan-note">
          Checkout is being finalized. Your free workspace remains fully usable in the meantime.
        </small>
      )}
    </div>
  );
}
