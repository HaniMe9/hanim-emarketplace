import { useState } from 'react';
import { Bot, CheckCircle2, Cpu, Globe, Package, ShieldAlert, Sparkles, Tags, TrendingUp, XCircle } from 'lucide-react';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { ago } from '../../lib/format.ts';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Field, Select, Spinner, Stat, Tabs, Textarea } from '../../components/ui.tsx';
import type { AiSuggestion, Minor, Product } from '../../../shared/types.ts';

type Task = 'listing' | 'pricing' | 'forecast' | 'translate';
type OfferLite = { id: string; price: Minor };

const TASKS: { id: Task; label: string; icon: React.ReactNode; blurb: string; prompt: string }[] = [
  {
    id: 'listing',
    label: 'Write a listing',
    icon: <Package className="size-4" />,
    blurb: 'Generates title, bullets and description from your notes. Nothing is published automatically.',
    prompt: 'Habesha ceramic coffee set, hand-thrown in Addis, 6 cups and a serving tray. Sold by Habesha Clay Studio.',
  },
  {
    id: 'pricing',
    label: 'Price advice',
    icon: <Tags className="size-4" />,
    blurb: 'Compares your price against the category and tells you what it costs you to compete.',
    prompt: '',
  },
  {
    id: 'forecast',
    label: 'Demand forecast',
    icon: <TrendingUp className="size-4" />,
    blurb: 'Explains what to reorder and why, with the reasoning shown. Suggestion only — it never orders for you.',
    prompt: '',
  },
  {
    id: 'translate',
    label: 'Amharic ⇄ English',
    icon: <Globe className="size-4" />,
    blurb: 'Translates copy both ways so buyers and suppliers can work in their own language.',
    prompt: 'የተጠበሰ ምርት ያለው እጅ የተሠራ የካፒታ ውሃ መጠቢያ',
  },
];

export function SellerAi() {
  const [task, setTask] = useState<Task>('listing');
  const [input, setInput] = useState(TASKS[0].prompt);
  const [offerId, setOfferId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ output: string; suggestion: AiSuggestion } | null>(null);
  const { data: offers } = useQuery<{ items: (OfferLite & { product: Product })[] }>('/seller/listings?status=live');
  const { data: history, loading, error, reload } = useQuery<{ items: AiSuggestion[] }>('/seller/ai/history');

  const active = TASKS.find((t) => t.id === task)!;

  function pick(id: Task) {
    const t = TASKS.find((x) => x.id === id)!;
    setTask(id);
    setInput(t.prompt);
    setResult(null);
    setErr(null);
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.post<{ output: string; suggestion: AiSuggestion }>('/seller/ai/copilot', {
        task,
        input,
        offerId: offerId || undefined,
      });
      setResult(r);
      reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'The assistant could not complete that request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Seller assistant</h1>
        <p className="mt-0.5 text-xs text-ink-3">
          Assists, never decides. Every output passes guardrails before you see it, and nothing is published or ordered
          without your action.
        </p>
      </div>

      <Tabs tabs={TASKS.map((t) => ({ id: t.id, label: t.label }))} value={task} onChange={(v) => pick(v as Task)} />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title={active.label} icon={active.icon} subtitle={active.blurb} />

          {err && <div className="mb-3"><ErrorNote message={err} /></div>}

          <form onSubmit={run} className="space-y-3">
            {task === 'pricing' && (
              <Field label="Which listing?" hint="The assistant reads the live category, not just your own price.">
                <Select value={offerId} onChange={(e) => setOfferId(e.target.value)}>
                  <option value="">Pick my cheapest listing automatically</option>
                  {(offers?.items ?? []).map((o) => (
                    <option key={o.id} value={o.id}>{o.product?.title ?? o.id} — ETB {(o.price / 100).toFixed(2)}</option>
                  ))}
                </Select>
              </Field>
            )}

            <Field
              label={task === 'translate' ? 'Text to translate' : task === 'listing' ? 'What are you selling?' : task === 'forecast' ? 'Optional focus' : 'Context'}
              hint={task === 'forecast' ? 'Leave blank to get the standard reorder forecast.' : undefined}
            >
              <Textarea
                rows={task === 'listing' ? 6 : 4}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={task === 'forecast' ? 'e.g. focus on the coffee line' : active.prompt}
                required={task !== 'forecast'}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" loading={busy} icon={<Sparkles className="size-4" />}>
                Run {active.label.toLowerCase()}
              </Button>
              <span className="text-[10px] text-ink-3">Routed to an Ethiopia-tuned model. Typical latency under 2s.</span>
            </div>
          </form>

          {result && (
            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="muted" icon={<Cpu className="size-3" />}>{result.suggestion.model}</Badge>
                <Badge tone="muted">{result.suggestion.tokensIn}→{result.suggestion.tokensOut} tokens</Badge>
                <Badge tone="muted">{result.suggestion.latencyMs}ms</Badge>
                <Badge tone="muted">{ago(result.suggestion.at)}</Badge>
              </div>

              {result.suggestion.guardrail.decision !== 'allowed' ? (
                <div className="rounded-md border border-bad/40 bg-bad/5 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-bad">
                    <ShieldAlert className="size-4" />
                    Blocked by policy — nothing was saved or published
                  </p>
                  <p className="mt-1 text-xs text-ink-2">{result.suggestion.guardrail.reason}</p>
                  <pre className="mt-2 overflow-x-auto rounded bg-surface-2 p-2.5 text-[11px] whitespace-pre-wrap text-ink-3">
                    {result.output}
                  </pre>
                </div>
              ) : (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-ok">
                    <CheckCircle2 className="size-3.5" /> Passed all guardrails
                  </div>
                  <pre className="overflow-x-auto rounded-md border border-line bg-surface-2 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                    {result.output}
                  </pre>
                  {task === 'listing' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(result.output)}>Copy to clipboard</Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setInput(result.output);
                          setResult(null);
                        }}
                      >
                        Use as listing notes
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-md border border-line p-3">
                <p className="mb-2 text-[11px] font-bold">Guardrail report</p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {result.suggestion.guardrail.checks.map((c) => (
                    <p key={c.id} className="flex items-center gap-1.5 text-[11px]">
                      {c.result === 'pass' ? (
                        <CheckCircle2 className="size-3 text-ok" />
                      ) : c.result === 'warn' ? (
                        <ShieldAlert className="size-3 text-warn" />
                      ) : (
                        <XCircle className="size-3 text-bad" />
                      )}
                      <span className="text-ink-2">{c.name}</span>
                      <span className="ml-auto font-mono text-[10px] text-ink-3">{c.result}</span>
                    </p>
                  ))}
                </div>
                <p className="mt-2 border-t border-line pt-2 text-[10px] leading-relaxed text-ink-3">
                  The assistant cannot see other sellers' private data, cannot contact buyers, and cannot change a price
                  on its own. It is grounded in your own catalogue and flagged as machine-generated wherever it appears.
                </p>
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="What this will not do" icon={<Bot className="size-4" />} />
            <ul className="space-y-2 text-[11px] leading-relaxed text-ink-2">
              <li className="flex gap-2"><XCircle className="mt-0.5 size-3 shrink-0 text-bad" /> Place a purchase order or commit your cash.</li>
              <li className="flex gap-2"><XCircle className="mt-0.5 size-3 shrink-0 text-bad" /> Publish a listing, or mark one as sponsored.</li>
              <li className="flex gap-2"><XCircle className="mt-0.5 size-3 shrink-0 text-bad" /> Write a comparison against a named competitor.</li>
              <li className="flex gap-2"><XCircle className="mt-0.5 size-3 shrink-0 text-bad" /> Include a phone number, email or off-platform link.</li>
              <li className="flex gap-2"><XCircle className="mt-0.5 size-3 shrink-0 text-bad" /> Invent a delivery date, warranty or certification.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" /> Draft copy, translate, and explain a number — with the source shown.</li>
            </ul>
          </Card>

          <Card>
            <CardHeader title="Recent runs" subtitle="Kept for your own audit" />
            {loading ? (
              <Spinner label="Loading history…" />
            ) : error ? (
              <ErrorNote message={error} onRetry={reload} />
            ) : (history?.items.length ?? 0) === 0 ? (
              <Empty title="Nothing yet" message="Your assistant runs will be listed here." />
            ) : (
              <div className="space-y-1.5">
                {history!.items.slice(0, 8).map((h) => (
                  <div key={h.id} className="rounded border border-line p-2">
                    <p className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold">{h.capability.replace(/_/g, ' ')}</span>
                      <span className="text-ink-3">{ago(h.at)}</span>
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-ink-3">{h.inputSummary}</p>
                    <p className="mt-1 flex items-center gap-1.5">
                      <Badge tone={h.guardrail.decision === 'allowed' ? 'ok' : 'bad'}>{h.guardrail.decision}</Badge>
                      <span className="font-mono text-[10px] text-ink-3">cost {(h.costMinor / 100).toFixed(2)} ETB</span>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="bg-surface-2/60">
            <p className="text-[11px] leading-relaxed text-ink-3">
              <b className="text-ink-2">Cost model.</b> Assistant usage is billed per token and shown on every run above.
              It is a fraction of a percent of revenue and is never bundled into a mandatory subscription.
            </p>
            <div className="mt-2">
              <Stat label="Runs this month" value={String(history?.items.length ?? 0)} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
