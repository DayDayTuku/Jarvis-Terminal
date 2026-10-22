'use client';

export type FeedStatus = 'live' | 'partial' | 'stale' | 'unavailable';

export type FeedReading = {
  label: string;
  status: FeedStatus;
  detail: string;
};

const STATUS_LABEL: Record<FeedStatus, string> = {
  live: 'LIVE',
  partial: 'PARTIAL',
  stale: 'STALE',
  unavailable: 'OFFLINE',
};

export default function DataStatusBar({
  feeds,
  checkedAt,
}: {
  feeds: FeedReading[];
  checkedAt: string | null;
}) {
  const offline = feeds.filter((feed) => feed.status === 'unavailable');
  const partial = feeds.filter((feed) => feed.status === 'partial' || feed.status === 'stale');
  const degraded = offline.length > 0 || partial.length > 0;

  return (
    <section
      className={`data-status-bar ${degraded ? 'degraded' : 'healthy'}`}
      aria-label="Data connection status"
      role="status"
    >
      <div className="data-status-summary">
        <span className="data-status-dot" aria-hidden="true" />
        <strong>{degraded ? 'DEGRADED DATA' : 'ALL SYSTEMS LIVE'}</strong>
        <span>
          {degraded
            ? `${offline.length} offline · ${partial.length} partial · unavailable panels are withheld, not estimated`
            : 'Every primary feed returned a valid response'}
        </span>
      </div>
      <div className="data-status-feeds">
        {feeds.map((feed) => (
          <span className={`data-status-feed ${feed.status}`} key={feed.label} title={feed.detail}>
            <i aria-hidden="true" />
            {feed.label}
            <b>{STATUS_LABEL[feed.status]}</b>
          </span>
        ))}
      </div>
      <small>{checkedAt ? `CHECKED ${checkedAt}` : 'CHECKING CONNECTIONS...'}</small>
    </section>
  );
}
