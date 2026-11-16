/**
 * arthara API client — Indonesian exchange data beyond what Yahoo carries.
 *
 * Yahoo gives us bars. It does not give us *who* traded: foreign net flow,
 * broker inventory, KSEI ownership composition, IDX filings, or the macro
 * series the local desks watch. Those are the inputs that can plausibly
 * separate a breakout that holds from one that fails, so they are worth a feed
 * of their own.
 *
 * ## Contract
 *
 * - Base URL `https://data.arthara.id`, auth `Authorization: Bearer <key>`.
 * - One page of a call costs exactly **one** request, whatever the row count.
 *   Pagination is *not* free: following `meta.next_cursor` spends another
 *   request. A sandbox key has 100 requests for its whole lifetime, so a
 *   runaway pager is not a bug, it is a drained quota.
 * - `meta.cost` reports what the call actually charged and `meta.as_of` the
 *   newest data date it covers. Both are surfaced on every result instead of
 *   assumed.
 * - The response `meta` also carries `clamped_from` / `clamped_to` when the
 *   server silently narrowed the window (e.g. to the plan's history depth).
 *   Those are passed through, never hidden, because a clamped window looks like
 *   missing data if you do not know it was cut.
 *
 * ## Honesty rules this module follows
 *
 * - Nothing is zero-filled. A figure the vendor has no value for comes back as
 *   `null` and stays `null`.
 * - A call that runs out of pages raises `truncated` rather than returning a
 *   short list that looks complete.
 * - An error is an `ArtharaError` carrying the stable `code`, the HTTP status
 *   and the `request_id`, so callers branch on the code and can quote the id to
 *   support.
 * - Retries are OFF by default. A retried request can still be billed, and on a
 *   metered plan a silent retry is a silent cost; the caller opts in.
 *
 * ## Licence
 *
 * The plan's `licence` is `evaluation` (sandbox) or `personal` — neither allows
 * redistributing the raw rows. Keep this server-side (the key is not
 * `NEXT_PUBLIC_`), derive signals from it, and do not publish the vendor's
 * tables back to users.
 */

import { fetchUpstream } from "./upstream.ts";

export const ARTHARA_BASE_URL = "https://data.arthara.id";

/** Sandbox caps rows per page at 500; asking for more is clamped, not an error. */
export const ARTHARA_SANDBOX_ROWS_PER_PAGE = 500;
/** Sandbox allows one ticker per call and five calls a minute. */
export const ARTHARA_SANDBOX_RATE_PER_MIN = 5;

const MAX_PAGES_CEILING = 50;

export type ArtharaMeta = {
  request_id: string;
  as_of: string | null;
  cost: number;
  licence: string;
  next_cursor: string | null;
  from?: string;
  to?: string;
  adjusted?: boolean;
  clamped_from?: string;
  clamped_to?: string;
  excluded_partial?: string[];
  partial?: unknown[];
  reason?: string;
  period?: string;
};

/** Every response is `{ data, meta }`; `data` is a list on list endpoints and an object on the free status calls. */
export type ArtharaResponse<T> = { data: T; meta: ArtharaMeta };
/** A list response: one page of rows plus the page's metadata. */
export type ArtharaPage<T> = ArtharaResponse<T[]>;

export class ArtharaError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly requiredPlan: string | null;

  constructor(message: string, options: { code: string; status: number; requestId?: string | null; requiredPlan?: string | null }) {
    super(message);
    this.name = "ArtharaError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId ?? null;
    this.requiredPlan = options.requiredPlan ?? null;
  }
}

/** True when a key is present. Never exposes or logs the value. */
export function artharaConfigured(): boolean {
  return Boolean(process.env.ARTHARA_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.ARTHARA_API_KEY?.trim();
  if (!key) {
    throw new ArtharaError("ARTHARA_API_KEY is not set; no arthara call was made.", {
      code: "not_configured",
      status: 0,
    });
  }
  return key;
}

export type ArtharaQuery = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query: ArtharaQuery = {}): string {
  const url = new URL(path, ARTHARA_BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RequestOptions = {
  /** Total attempts for a transient failure or a 429. Defaults to 1 (no retry). */
  attempts?: number;
  /** Wait between attempts; grows linearly. Defaults to 1000ms. */
  retryDelayMs?: number;
  /** Per-attempt ceiling. Defaults to 20s; some pages are large. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** One call, one page, one billed request. */
export async function artharaRequest<T>(path: string, query: ArtharaQuery = {}, options: RequestOptions = {}): Promise<ArtharaResponse<T>> {
  const { attempts = 1, retryDelayMs = 1000, timeoutMs = 20_000, signal } = options;
  const url = buildUrl(path, query);
  const maxAttempts = Math.max(1, attempts);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchUpstream(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey()}`,
        "user-agent": "Jarvis-Research-Terminal",
      },
      timeoutMs,
      attempts: 1,
      signal,
    });

    if (response.ok) {
      const body = (await response.json()) as ArtharaResponse<T>;
      if (!body?.meta || body.data === undefined || body.data === null) {
        throw new ArtharaError(`arthara returned an unexpected body for ${path}.`, {
          code: "invalid_body",
          status: response.status,
          requestId: response.headers.get("x-request-id"),
        });
      }
      return body;
    }

    // Drain the body so the socket is released before we may retry.
    const text = await response.text().catch(() => "");
    let detail: { code?: string; message?: string; request_id?: string; required_plan?: string } = {};
    try {
      detail = (JSON.parse(text) as { error?: typeof detail }).error ?? {};
    } catch {
      // A non-JSON error page still has a status; keep the text short.
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < maxAttempts) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : retryDelayMs * attempt;
      await sleep(wait);
      continue;
    }

    throw new ArtharaError(detail.message ?? `arthara answered ${response.status} for ${path}${text ? `: ${text.slice(0, 200)}` : ""}`, {
      code: detail.code ?? `http_${response.status}`,
      status: response.status,
      requestId: detail.request_id ?? response.headers.get("x-request-id"),
      requiredPlan: detail.required_plan ?? null,
    });
  }

  // Unreachable: the loop either returns or throws.
  throw new ArtharaError(`arthara call to ${path} failed.`, { code: "unknown", status: 0 });
}

export type PagedOptions = {
  /** Rows per page; the server clamps to the plan's cap. Defaults to 500. */
  limit?: number;
  /**
   * Hard stop on billed pages. Defaults to 1 — a single page — because the
   * sandbox quota is metered and an unbounded pager can spend it in seconds.
   */
  maxPages?: number;
  /** Pause between pages; keeps a sandbox key under 5 requests/minute. */
  pauseMs?: number;
} & Pick<RequestOptions, "attempts" | "retryDelayMs" | "timeoutMs" | "signal">;

export type PagedResult<T> = {
  rows: T[];
  /** Pages actually billed. Each page is one request. */
  pages: number;
  /** Sum of `meta.cost`, i.e. requests charged. */
  cost: number;
  /** Newest data date across the pages, or null when the feed has none. */
  asOf: string | null;
  licence: string | null;
  /** True when `maxPages` cut the read short: the rows are NOT the full window. */
  truncated: boolean;
  /** Set when the server narrowed the requested window to the plan's depth. */
  clampedFrom: string | null;
  clampedTo: string | null;
  meta: ArtharaMeta | null;
};

export async function artharaPaged<T>(path: string, query: ArtharaQuery, options: PagedOptions = {}): Promise<PagedResult<T>> {
  const { limit = ARTHARA_SANDBOX_ROWS_PER_PAGE, maxPages = 1, pauseMs = 0 } = options;
  const rows: T[] = [];
  let cursor: string | null = null;
  let pages = 0;
  let cost = 0;
  let asOf: string | null = null;
  let licence: string | null = null;
  let meta: ArtharaMeta | null = null;
  let clampedFrom: string | null = null;
  let clampedTo: string | null = null;
  const pageCap = Math.max(1, Math.min(maxPages, MAX_PAGES_CEILING));

  while (pages < pageCap) {
    if (pages > 0 && pauseMs > 0) await sleep(pauseMs);
    const page: ArtharaResponse<T[]> = await artharaRequest<T[]>(path, { ...query, limit, cursor }, options);
    pages += 1;
    rows.push(...page.data);
    cost += page.meta.cost ?? 0;
    asOf = page.meta.as_of ?? asOf;
    licence = page.meta.licence ?? licence;
    meta = page.meta;
    clampedFrom = page.meta.clamped_from ?? clampedFrom;
    clampedTo = page.meta.clamped_to ?? clampedTo;
    cursor = page.meta.next_cursor;
    if (!cursor) break;
  }

  return {
    rows,
    pages,
    cost,
    asOf,
    licence,
    truncated: Boolean(cursor),
    clampedFrom,
    clampedTo,
    meta,
  };
}

// --- Row types --------------------------------------------------------------
// Mirrors of the OpenAPI schemas. Fields the vendor marks nullable stay
// nullable here; do not narrow them to `number` and fill with zero.

export type PriceBar = {
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Shares, never lots. */
  volume: number;
  /** Traded value in `currency` (IDR). */
  value: number;
  trade_count: number | null;
  currency: string;
};

export type ForeignFlowRow = {
  ticker: string;
  date: string;
  currency: string;
  foreign_buy_value: number;
  foreign_sell_value: number;
  /** Buy minus sell; negative when foreigners were net sellers. */
  foreign_net_value: number;
};

export type BrokerSummaryRow = {
  ticker: string;
  broker_code: string;
  date: string | null;
  period_start: string | null;
  period_end: string | null;
  currency: string;
  buy_volume: number;
  buy_value: number;
  buy_avg_price: number | null;
  sell_volume: number;
  sell_value: number;
  sell_avg_price: number | null;
  net_volume: number;
  net_value: number;
  residency: string;
};

export type FundamentalsFigure = {
  ticker: string;
  field: string;
  name: string;
  field_group: string;
  unit: string;
  currency: string | null;
  period: string | null;
  period_type: string | null;
  period_end: string | null;
  /** Null where the ticker has no figure. Never coerced to 0. */
  value: number | null;
};

export type OwnershipCompositionMonth = {
  ticker: string;
  date: string;
  period_start: string;
  holding_date: string | null;
  master_date: string | null;
  isin: string | null;
  issued_shares: number | null;
  scripless_shares: number | null;
  outside_scripless_shares: number | null;
  data_quality: string;
  local_total_shares: number | null;
  foreign_total_shares: number | null;
  local_issued_pct: number | null;
  foreign_issued_pct: number | null;
  [key: string]: string | number | null;
};

export type Disclosure = {
  disclosure_id: number;
  ticker: string | null;
  title_id: string;
  subject_id: string | null;
  category: string;
  categories: string[];
  published_at: string;
  first_seen_at: string | null;
  announcement_no: string | null;
  attachments: Array<{
    attachment_id: number;
    file_name: string;
    is_main: boolean;
    status: string;
    pages: number | null;
    bytes: number | null;
    source_url: string;
  }>;
};

export type MacroSeriesRow = {
  series_id: string;
  date: string;
  value: number | null;
  unit: string;
  currency: string | null;
};

export type MacroSeries = {
  series_id: string;
  name: string;
  family: string;
  source: string;
  frequency: string;
  unit: string;
  currency: string | null;
  transform_kind: string;
  first_date: string | null;
};

export type DatasetStatus = { dataset: string; as_of: string };

// --- Usage / status (free) --------------------------------------------------

export type Usage = {
  plan: { code: string; name: string; tier: string; licence: string };
  status: string;
  period: { start: string; end: string };
  quota: {
    limit: number | null;
    used: number;
    remaining: number;
    lifetime: boolean;
    resets_at: string | null;
    topup_remaining: number;
    daily: unknown;
    families: Record<string, unknown>;
  };
  limits: {
    batch_max: number;
    concurrency: number;
    history_years: number;
    rate_per_min: number;
    rows_per_page: number;
    stream_connections: number;
    stream_tickers: number;
  };
};

/** Costs 0 requests. Read it before and after any spend. */
export async function fetchUsage(options?: RequestOptions): Promise<Usage> {
  const page = await artharaRequest<Usage>("/v1/usage", {}, options);
  return page.data;
}

/** Costs 0 requests. `as_of` per dataset, so staleness is visible, not guessed. */
export async function fetchStatus(options?: RequestOptions): Promise<DatasetStatus[]> {
  const page = await artharaRequest<DatasetStatus[]>("/v1/status", {}, options);
  return page.data;
}

// --- Metered reads ----------------------------------------------------------

export type SeriesQuery = {
  ticker: string;
  from?: string;
  to?: string;
  limit?: number;
  maxPages?: number;
  pauseMs?: number;
};

export function fetchDailyPrices(query: SeriesQuery & { adjusted?: boolean }, options?: RequestOptions): Promise<PagedResult<PriceBar>> {
  return artharaPaged<PriceBar>(
    "/v1/prices/daily",
    { ticker: query.ticker, from: query.from, to: query.to, adjusted: query.adjusted ?? true },
    { limit: query.limit, maxPages: query.maxPages ?? 1, pauseMs: query.pauseMs ?? 0, ...options },
  );
}

export function fetchForeignFlow(query: SeriesQuery, options?: RequestOptions): Promise<PagedResult<ForeignFlowRow>> {
  return artharaPaged<ForeignFlowRow>(
    "/v1/foreign-flow",
    { ticker: query.ticker, from: query.from, to: query.to },
    { limit: query.limit, maxPages: query.maxPages ?? 1, pauseMs: query.pauseMs ?? 0, ...options },
  );
}

export type ForeignFlowMarketDay = {
  date: string;
  currency: string;
  foreign_buy_value: number;
  foreign_sell_value: number;
  foreign_net_value: number;
};

/**
 * Exchange-wide foreign net flow: one series, no ticker. One page covers a year
 * on a sandbox key, which makes it the cheapest possible read of whether
 * foreign money is coming in or going out.
 */
export function fetchMarketForeignFlow(
  query: { from?: string; to?: string; limit?: number; maxPages?: number; pauseMs?: number } = {},
  options?: RequestOptions,
): Promise<PagedResult<ForeignFlowMarketDay>> {
  return artharaPaged<ForeignFlowMarketDay>(
    "/v1/foreign-flow/market",
    { from: query.from, to: query.to },
    { limit: query.limit, maxPages: query.maxPages ?? 1, pauseMs: query.pauseMs ?? 0, ...options },
  );
}

export type BrokerSummaryQuery = {
  ticker?: string;
  broker?: string;
  from?: string;
  to?: string;
  granularity?: "daily" | "period";
  board?: "rg" | "ng" | "all";
  residency?: "all" | "local" | "foreign" | "split";
  limit?: number;
  maxPages?: number;
  pauseMs?: number;
};

export function fetchBrokerSummary(query: BrokerSummaryQuery, options?: RequestOptions): Promise<PagedResult<BrokerSummaryRow>> {
  return artharaPaged<BrokerSummaryRow>(
    "/v1/broker-summary",
    { ...query },
    { limit: query.limit, maxPages: query.maxPages ?? 1, pauseMs: query.pauseMs ?? 0, ...options },
  );
}

/** One page by construction: the snapshot endpoint has no cursor. */
export async function fetchFundamentalsSnapshot(
  ticker: string,
  fields?: { fields?: string; fieldGroup?: string },
  options?: RequestOptions,
): Promise<{ rows: FundamentalsFigure[]; meta: ArtharaMeta }> {
  const page = await artharaRequest<FundamentalsFigure[]>(
    "/v1/fundamentals/snapshot",
    { ticker, fields: fields?.fields, field_group: fields?.fieldGroup },
    options,
  );
  return { rows: page.data, meta: page.meta };
}

export function fetchOwnershipComposition(query: SeriesQuery, options?: RequestOptions): Promise<PagedResult<OwnershipCompositionMonth>> {
  return artharaPaged<OwnershipCompositionMonth>(
    "/v1/ownership/composition",
    { ticker: query.ticker, from: query.from, to: query.to },
    { limit: query.limit, maxPages: query.maxPages ?? 1, pauseMs: query.pauseMs ?? 0, ...options },
  );
}

export type DisclosureQuery = {
  ticker?: string;
  category?: string;
  from?: string;
  to?: string;
  limit?: number;
  maxPages?: number;
  pauseMs?: number;
};

export function fetchDisclosures(query: DisclosureQuery, options?: RequestOptions): Promise<PagedResult<Disclosure>> {
  return artharaPaged<Disclosure>(
    "/v1/disclosures",
    { ticker: query.ticker, category: query.category, from: query.from, to: query.to },
    { limit: query.limit ?? 100, maxPages: query.maxPages ?? 1, pauseMs: query.pauseMs ?? 0, ...options },
  );
}

export function fetchMacroSeries(
  seriesId: string,
  query: { from?: string; to?: string; transform?: "level" | "mom" | "qoq" | "yoy" | "chg"; limit?: number; maxPages?: number; pauseMs?: number } = {},
  options?: RequestOptions,
): Promise<PagedResult<MacroSeriesRow>> {
  return artharaPaged<MacroSeriesRow>(
    `/v1/macro/series/${encodeURIComponent(seriesId)}`,
    { from: query.from, to: query.to, transform: query.transform },
    { limit: query.limit, maxPages: query.maxPages ?? 1, pauseMs: query.pauseMs ?? 0, ...options },
  );
}

export function fetchMacroCatalogue(options?: RequestOptions): Promise<PagedResult<MacroSeries>> {
  return artharaPaged<MacroSeries>("/v1/macro/series", {}, { limit: ARTHARA_SANDBOX_ROWS_PER_PAGE, maxPages: 1, ...options });
}
