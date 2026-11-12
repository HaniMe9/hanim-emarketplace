/**
 * In-process metrics, exposed in Prometheus text format.
 *
 * Counters and histograms are enough to answer the questions that actually page
 * someone: is the API up, how slow is it, are payments failing, is the queue
 * backing up. Percentiles are computed from a bounded reservoir of recent
 * observations rather than a streaming sketch, because the sample is small
 * enough at this scale and an exact answer is easier to trust than an estimate.
 *
 * Everything is local to one process. Running more than one instance means each
 * exposes its own figures and the scraper aggregates them; that is the right
 * trade for counters, and the only one that works without shipping a shared
 * metrics store.
 */

export interface HistogramSnapshot {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

type Labels = Record<string, string>;

/**
 * Render a label set in Prometheus exposition format.
 *
 * Values are quoted and escaped. A raw value interpolated straight into the
 * line lets a label carrying a quote or newline forge additional samples — and
 * label values here come from request paths and provider names, so they are not
 * something the code fully controls.
 */
const labelKey = (labels: Labels) =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}="${escapeLabel(String(labels[k]))}"`)
    .join(',');

export class Metrics {
  private readonly counters = new Map<string, { labels: Labels; value: number }>();
  private readonly gauges = new Map<string, { labels: Labels; value: number }>();
  private readonly histograms = new Map<string, { labels: Labels; values: number[] }>();
  private readonly help = new Map<string, string>();
  private readonly types = new Map<string, 'counter' | 'gauge' | 'histogram'>();
  /** Upper bound on retained observations per histogram series. */
  private readonly maxSamples = 2048;
  readonly startedAt = new Date();

  private declare(name: string, type: 'counter' | 'gauge' | 'histogram', help: string) {
    if (!this.types.has(name)) {
      this.types.set(name, type);
      this.help.set(name, help);
    }
  }

  increment(name: string, labels: Labels = {}, by = 1) {
    this.declare(name, 'counter', this.help.get(name) ?? name);
    const key = `${name}{${labelKey(labels)}}`;
    const cur = this.counters.get(key);
    if (cur) cur.value += by;
    else this.counters.set(key, { labels, value: by });
  }

  setGauge(name: string, value: number, labels: Labels = {}) {
    this.declare(name, 'gauge', this.help.get(name) ?? name);
    this.gauges.set(`${name}{${labelKey(labels)}}`, { labels, value });
  }

  observe(name: string, value: number, labels: Labels = {}) {
    this.declare(name, 'histogram', this.help.get(name) ?? name);
    const key = `${name}{${labelKey(labels)}}`;
    const cur = this.histograms.get(key);
    if (cur) {
      cur.values.push(value);
      if (cur.values.length > this.maxSamples) cur.values.splice(0, cur.values.length - this.maxSamples);
    } else {
      this.histograms.set(key, { labels, values: [value] });
    }
  }

  /** Seconds, as Prometheus expects durations. */
  time<T>(name: string, labels: Labels, fn: () => T): T {
    const started = performance.now();
    try {
      return fn();
    } finally {
      this.observe(name, (performance.now() - started) / 1000, labels);
    }
  }

  async timeAsync<T>(name: string, labels: Labels, fn: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await fn();
    } finally {
      this.observe(name, (performance.now() - started) / 1000, labels);
    }
  }

  describe(name: string, help: string) {
    this.help.set(name, help);
  }

  snapshot(name: string, labels: Labels = {}): HistogramSnapshot | null {
    const series = this.histograms.get(`${name}{${labelKey(labels)}}`);
    if (!series || !series.values.length) return null;
    return summarize(series.values);
  }

  counterValue(name: string, labels: Labels = {}): number {
    return this.counters.get(`${name}{${labelKey(labels)}}`)?.value ?? 0;
  }

  /** Prometheus exposition format. */
  render(): string {
    const lines: string[] = [];
    const emitted = new Set<string>();

    const typeOf = (name: string) => this.types.get(name) ?? 'counter';

    for (const [key, entry] of [...this.counters.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const name = key.slice(0, key.indexOf('{'));
      if (!emitted.has(name)) {
        lines.push(`# HELP ${name} ${this.help.get(name) ?? name}`);
        lines.push(`# TYPE ${name} ${typeOf(name)}`);
        emitted.add(name);
      }
      lines.push(`${key} ${entry.value}`);
    }

    for (const [key, entry] of [...this.gauges.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const name = key.slice(0, key.indexOf('{'));
      if (!emitted.has(name)) {
        lines.push(`# HELP ${name} ${this.help.get(name) ?? name}`);
        lines.push(`# TYPE ${name} gauge`);
        emitted.add(name);
      }
      lines.push(`${key} ${entry.value}`);
    }

    for (const [key, series] of [...this.histograms.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const base = key.slice(0, key.indexOf('{'));
      if (!emitted.has(base)) {
        lines.push(`# HELP ${base} ${this.help.get(base) ?? base}`);
        lines.push(`# TYPE ${base} summary`);
        emitted.add(base);
      }
      const s = summarize(series.values);
      // `key` already carries the series labels, so the quantile has to be merged
      // into that one label set. Appending a second `{...}` would produce
      // `name{method="GET"}{quantile="0.5"}`, which a Prometheus scraper rejects
      // outright, taking the whole scrape down with it.
      const withQuantile = (q: string) => `${base}{${labelKey({ ...series.labels, quantile: q })}}`;
      lines.push(`${key}_count ${s.count}`);
      lines.push(`${key}_sum ${round(s.sum)}`);
      lines.push(`${withQuantile('0.5')} ${round(s.p50)}`);
      lines.push(`${withQuantile('0.95')} ${round(s.p95)}`);
      lines.push(`${withQuantile('0.99')} ${round(s.p99)}`);

      // Min and max are not part of the summary type. Emitting them as extra
      // series of the same family is invalid, so they are published as their own
      // gauges with their own HELP/TYPE declarations.
      const minMaxName = `${base}_minmax`;
      if (!emitted.has(minMaxName)) {
        lines.push(`# HELP ${minMaxName} Minimum and maximum observed values for ${base}.`);
        lines.push(`# TYPE ${minMaxName} gauge`);
        emitted.add(minMaxName);
      }
      lines.push(`${minMaxName}{${labelKey({ ...series.labels, stat: 'min' })}} ${round(s.min)}`);
      lines.push(`${minMaxName}{${labelKey({ ...series.labels, stat: 'max' })}} ${round(s.max)}`);
    }

    lines.push('# HELP process_uptime_seconds Seconds since this process started.');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${round((Date.now() - this.startedAt.getTime()) / 1000)}`);
    return lines.join('\n') + '\n';
  }

  /** JSON snapshot for the admin dashboard. */
  toJSON() {
    const histograms: Record<string, HistogramSnapshot> = {};
    for (const [key, series] of this.histograms) histograms[key] = summarize(series.values);
    const counters: Record<string, number> = {};
    for (const [key, entry] of this.counters) counters[key] = entry.value;
    const gauges: Record<string, number> = {};
    for (const [key, entry] of this.gauges) gauges[key] = entry.value;
    return { uptimeSeconds: Math.round((Date.now() - this.startedAt.getTime()) / 1000), counters, gauges, histograms };
  }
}

function summarize(values: number[]): HistogramSnapshot {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  return {
    count: sorted.length,
    sum: round(sum),
    min: round(sorted[0] ?? 0),
    max: round(sorted[sorted.length - 1] ?? 0),
    avg: round(sorted.length ? sum / sorted.length : 0),
    p50: round(q(0.5)),
    p95: round(q(0.95)),
    p99: round(q(0.99)),
  };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

const escapeLabel = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/** The metrics every deployment gets for free. */
export function createMetrics(): Metrics {
  const m = new Metrics();
  m.describe('http_requests_total', 'HTTP requests handled, by method, route and status.');
  m.describe('http_request_duration_seconds', 'HTTP request duration in seconds, by method and route.');
  m.describe('http_errors_total', 'HTTP responses with a 4xx or 5xx status, by route and code.');
  m.describe('payment_attempts_total', 'Payment capture attempts, by provider, method and outcome.');
  m.describe('payment_amount_minor_total', 'Payment amount captured, in minor units, by provider.');
  m.describe('provider_requests_total', 'Outbound calls to external providers, by provider, operation and outcome.');
  m.describe('provider_request_duration_seconds', 'Outbound provider call duration in seconds.');
  m.describe('webhook_events_total', 'Inbound provider webhooks, by provider and outcome.');
  m.describe('db_flush_total', 'Database snapshot writes, by outcome.');
  m.describe('db_flush_duration_seconds', 'Database snapshot write duration in seconds.');
  m.describe('checkout_total', 'Checkout attempts, by outcome.');
  m.describe('auth_login_total', 'Sign-in attempts, by outcome.');
  m.describe('orders_placed_total', 'Orders placed, by channel and payment method.');
  m.describe('ledger_balanced', 'Whether the double-entry ledger balances: 1 balanced, 0 not.');
  m.describe('session_count', 'Live sessions in this process.');
  m.describe('persistence_pending', 'Whether a snapshot write is queued: 1 pending, 0 flushed.');
  return m;
}

export const metrics = createMetrics();

