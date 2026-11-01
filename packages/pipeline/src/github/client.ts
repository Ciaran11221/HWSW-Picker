// Small GitHub HTTP client for the pipeline. It does three jobs the callers should not repeat:
//   1. Rate limits: on HTTP 403/429 with `retry-after` or `x-ratelimit-remaining: 0`, wait
//      until the reset time. A wait longer than 15 minutes stops the whole run (RunAborted).
//   2. Search throttle: the search API allows 30 calls a minute, so searches are spaced out.
//   3. Counting every HTTP call, so a run can report how many API calls it used.
// `fetch`, the clock and `sleep` are injected, so tests never touch the network or wait.
// Nothing here throws except RunAborted; every other failure comes back as a value.

import type { PipelineError } from '@hwsw/core';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  /** GitHub token. Required for real runs; tests pass a dummy. */
  token: string;
  fetch?: FetchFn;
  /** Milliseconds since epoch. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum gap between two search calls. Default 2100 ms (under 30 a minute). */
  searchIntervalMs?: number;
  /** Longest single rate-limit wait before the run stops. Default 15 minutes. */
  maxWaitMs?: number;
  /** Per-request timeout. Default 60 s. */
  timeoutMs?: number;
}

/** Thrown only when the run cannot continue (rate-limit wait too long, bad token). */
export class RunAborted extends Error {
  constructor(readonly error: PipelineError) {
    super(error.message);
    this.name = 'RunAborted';
  }
}

/** The result of one HTTP call. `status` 0 means the request failed before a response (network, timeout). */
export interface HttpResult {
  status: number;
  headers: Headers;
  text: string;
  /** Set when status is 0. */
  networkError?: string;
}

export type CallKind = 'rest' | 'search' | 'graphql';

/** Calls that returned or failed at the HTTP level, by API. */
export type CallCounts = Record<CallKind, number>;

const API = 'https://api.github.com';
const MAX_RATE_LIMIT_WAITS = 10;
/** Used when GitHub says "rate limit" in the body but sends no headers to say when it ends. */
const BLIND_WAIT_MS = 60_000;

/** True for results worth one retry: network failure, timeout or a 5xx. */
export function isTransient(r: HttpResult): boolean {
  return r.status === 0 || r.status >= 500;
}

/**
 * Milliseconds to wait for a rate-limited response, or null when the response is not a
 * rate limit at all. Pure, so tests can feed it headers directly.
 */
export function rateLimitWaitMs(r: HttpResult, nowMs: number): number | null {
  if (r.status !== 403 && r.status !== 429) return null;
  const retryAfter = r.headers.get('retry-after');
  if (retryAfter !== null) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
  }
  if (r.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(r.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - nowMs) + 1000;
    return BLIND_WAIT_MS;
  }
  if (/rate limit/i.test(r.text)) return BLIND_WAIT_MS;
  return null;
}

export class GitHubClient {
  readonly calls: CallCounts = { rest: 0, search: 0, graphql: 0 };
  readonly now: () => number;
  private readonly fetchFn: FetchFn;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly token: string;
  private readonly searchIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly timeoutMs: number;
  private lastSearchAt = Number.NEGATIVE_INFINITY;
  private aborted: PipelineError | null = null;

  constructor(opts: ClientOptions) {
    this.token = opts.token;
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? (() => Date.now());
    this.sleepFn = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.searchIntervalMs = opts.searchIntervalMs ?? 2100;
    this.maxWaitMs = opts.maxWaitMs ?? 15 * 60_000;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  /** The error that stopped the run, or null. */
  get abortedWith(): PipelineError | null {
    return this.aborted;
  }

  private abort(error: PipelineError): never {
    this.aborted ??= error;
    throw new RunAborted(this.aborted);
  }

  /** One HTTP call with rate-limit handling. Throws RunAborted when the run must stop. */
  async send(kind: CallKind, url: string, init: RequestInit = {}): Promise<HttpResult> {
    let waits = 0;
    for (;;) {
      if (this.aborted) throw new RunAborted(this.aborted);
      if (kind === 'search') await this.throttleSearch();
      this.calls[kind]++;
      const result = await this.once(url, init);

      if (result.status === 401) {
        this.abort({ kind: 'fetch', message: 'GitHub rejected the token (HTTP 401); stopping the run', detail: url });
      }
      const wait = rateLimitWaitMs(result, this.now());
      if (wait === null) return result;
      if (wait > this.maxWaitMs) {
        this.abort({
          kind: 'rate_limit',
          message: `rate limit resets in ${Math.ceil(wait / 60_000)} min, longer than the ${Math.round(this.maxWaitMs / 60_000)} min cap; stopping the run`,
          detail: url,
        });
      }
      if (++waits > MAX_RATE_LIMIT_WAITS) {
        this.abort({ kind: 'rate_limit', message: `still rate limited after ${MAX_RATE_LIMIT_WAITS} waits; stopping the run`, detail: url });
      }
      await this.sleepFn(wait);
    }
  }

  private async throttleSearch(): Promise<void> {
    const wait = this.lastSearchAt + this.searchIntervalMs - this.now();
    if (wait > 0) await this.sleepFn(wait);
    this.lastSearchAt = this.now();
  }

  private async once(url: string, init: RequestInit): Promise<HttpResult> {
    try {
      const res = await this.fetchFn(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'hwsw-picker-pipeline',
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await res.text();
      return { status: res.status, headers: res.headers, text };
    } catch (e) {
      return { status: 0, headers: new Headers(), text: '', networkError: e instanceof Error ? e.message : String(e) };
    }
  }

  /** GET a REST path (or full URL). Retries once on a network failure, timeout or 5xx. */
  async get(pathOrUrl: string, kind: 'rest' | 'search' = 'rest'): Promise<HttpResult> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
    const first = await this.send(kind, url);
    return isTransient(first) ? this.send(kind, url) : first;
  }

  /**
   * POST one GraphQL query. No retry here: the caller splits a failed batch in half.
   * Returns `data` and `errors` as GitHub sent them; `transient` is true when the call
   * failed in a way worth retrying with a smaller batch (502, timeout, resource limits).
   */
  async graphql(query: string): Promise<GraphqlResult> {
    const r = await this.send('graphql', `${API}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (isTransient(r)) {
      return { ok: false, transient: true, message: r.status === 0 ? `request failed: ${r.networkError}` : `HTTP ${r.status}` };
    }
    if (r.status !== 200) {
      return { ok: false, transient: false, message: `HTTP ${r.status}: ${r.text.slice(0, 200)}` };
    }
    let body: unknown;
    try {
      body = JSON.parse(r.text);
    } catch {
      return { ok: false, transient: true, message: 'response was not JSON' };
    }
    const obj = (typeof body === 'object' && body !== null ? body : {}) as { data?: unknown; errors?: unknown };
    const errors = Array.isArray(obj.errors) ? (obj.errors as GraphqlError[]) : [];
    if (typeof obj.data !== 'object' || obj.data === null) {
      const first = errors[0];
      const msg = first?.message ?? 'no data in response';
      const transient = errors.some((e) => e.type === 'RESOURCE_LIMITS_EXCEEDED' || /timeout|something went wrong/i.test(e.message ?? ''));
      return { ok: false, transient, message: msg };
    }
    return { ok: true, data: obj.data as Record<string, unknown>, errors };
  }
}

export interface GraphqlError {
  message?: string;
  type?: string;
  path?: (string | number)[];
}

export type GraphqlResult =
  | { ok: true; data: Record<string, unknown>; errors: GraphqlError[] }
  | { ok: false; transient: boolean; message: string };
