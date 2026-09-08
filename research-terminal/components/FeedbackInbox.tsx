'use client';

import { useEffect, useState } from 'react';

type FeedbackItem = {
  id: string;
  created_at: string;
  user_email: string | null;
  category: string;
  message: string;
  section: string;
  ticker: string | null;
  contact_ok: boolean;
  status: 'new' | 'reviewing' | 'resolved';
};

export default function FeedbackInbox({ active }: { active: boolean }) {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = async () => {
    const response = await fetch('/api/feedback?limit=30', { cache: 'no-store' });
    if (response.status === 403) {
      setForbidden(true);
      return;
    }
    if (!response.ok) return;
    const data = (await response.json()) as { feedback?: FeedbackItem[] };
    setItems(Array.isArray(data.feedback) ? data.feedback : []);
  };

  useEffect(() => {
    if (active && !forbidden) void load();
  }, [active, forbidden]);

  if (forbidden || items === null) return null;

  const updateStatus = async (id: string, status: FeedbackItem['status']) => {
    setItems((current) => current?.map((item) => item.id === id ? { ...item, status } : item) ?? []);
    const response = await fetch('/api/feedback', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (!response.ok) void load();
  };

  const newCount = items.filter((item) => item.status === 'new').length;

  return (
    <div className="setting-block feedback-inbox">
      <div className="feedback-inbox-title">
        <div>
          <h3>FEEDBACK INBOX</h3>
          <p>Private reports from terminal users.</p>
        </div>
        {newCount > 0 && <span>{newCount} NEW</span>}
      </div>
      {!items.length ? (
        <div className="feedback-empty">NO FEEDBACK YET</div>
      ) : (
        <div className="feedback-list">
          {items.map((item) => (
            <article key={item.id} className={`feedback-item status-${item.status}`}>
              <header>
                <strong>{item.category}</strong>
                <span>{item.section}{item.ticker ? ` · ${item.ticker.replace('.JK', '')}` : ''}</span>
                <time>{new Date(item.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} WIB</time>
              </header>
              <p>{item.message}</p>
              <footer>
                <span>{item.contact_ok && item.user_email ? item.user_email : 'NO FOLLOW-UP REQUESTED'}</span>
                <select value={item.status} onChange={(event) => void updateStatus(item.id, event.target.value as FeedbackItem['status'])} aria-label="Feedback status">
                  <option value="new">NEW</option>
                  <option value="reviewing">REVIEWING</option>
                  <option value="resolved">RESOLVED</option>
                </select>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
