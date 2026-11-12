import { useState } from 'react';
import { Eye, EyeOff, Save, Settings2, ToggleLeft, ToggleRight, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { ago, birr, dateTime } from '../../lib/format.ts';
import { Badge, Button, Card, CardHeader, ErrorNote, Field, Grid, Input, KeyValue, Notice, Select, Spinner, Stat, Tabs } from '../../components/ui.tsx';
import type { FeatureFlags, PlatformSettings } from '../../../shared/types.ts';

type Data = { settings: PlatformSettings; flags: FeatureFlags; updatedBy: string };

type Audit = { items: { id: string; at: string; actor: string; action: string; target: string; before?: string; after?: string; ip: string }[] };

const FLAG_HELP: Record<keyof Omit<FeatureFlags, 'updatedAt'>, string> = {
  assistedListing: 'Seller assistant can draft listing copy. Guardrails still apply and nothing publishes itself.',
  pricingCopilot: 'Pricing advice against the live category. Advisory only — it cannot change a price.',
  demandForecast: 'Reorder forecasting with visible reasoning. Suggestion only, never an automatic purchase order.',
  b2bCredit: 'Assessed credit lines for B2B buyers. A limit always requires a completed assessment.',
  cod: 'Cash on delivery. Turning this off removes COD from checkout and blocks new COD orders immediately.',
  promotions: 'Sponsored placements. Always labelled and never allowed to displace the organic Buy Box.',
  referralProgram: 'Referral credits. Credit is issued after the referred order is delivered, not on signup.',
  shadowRecommendations: 'Shadow evaluation only. Never serves buyer traffic while enabled.',
};

export function AdminSettings() {
  const [tab, setTab] = useState('fees');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Settings</h1>
        <p className="mt-0.5 text-xs text-ink-3">Fee, tax and feature configuration. Every change is audited with before and after state.</p>
      </div>
      <Tabs
        tabs={[
          { id: 'fees', label: 'Fees & tax' },
          { id: 'delivery', label: 'Delivery & disputes' },
          { id: 'plans', label: 'Subscription plans' },
          { id: 'flags', label: 'Feature flags' },
          { id: 'audit', label: 'Audit log' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'audit' ? <AuditLog /> : <SettingsForm section={tab} />}
    </div>
  );
}

function SettingsForm({ section }: { section: string }) {
  const { data, loading, error, reload } = useQuery<Data>('/admin/settings');
  const [form, setForm] = useState<PlatformSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const s = form ?? data?.settings ?? null;

  if (loading || !s) return <Spinner label="Loading settings…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  function set<K extends keyof PlatformSettings>(k: K, v: PlatformSettings[K]) {
    setForm({ ...(form ?? data!.settings), [k]: v });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.patch<{ message: string }>('/admin/settings', { settings: s });
      setMsg(r.message);
      setForm(null);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save those settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      {section === 'fees' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader title="Tax and withholding" subtitle="Applies to new orders only — existing orders keep the rate they were placed at" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="VAT rate (%)" hint="Standard Ethiopian VAT">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={s.vatRate}
                  onChange={(e) => set('vatRate', Number(e.target.value))}
                />
              </Field>
              <Field label="Withholding tax (%)" hint="Deducted at source from seller settlements">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={s.withholdingRate}
                  onChange={(e) => set('withholdingRate', Number(e.target.value))}
                />
              </Field>
              <Field label="VAT registration threshold (ETB)" hint="Above this turnover a seller must be VAT registered">
                <Input
                  type="number"
                  min="0"
                  value={s.vatRegistrationThreshold / 100}
                  onChange={(e) => set('vatRegistrationThreshold', Math.round(Number(e.target.value) * 100))}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Effective now" />
            <KeyValue k="VAT" v={`${s.vatRate}%`} />
            <KeyValue k="Withholding" v={`${s.withholdingRate}%`} />
            <KeyValue k="Registration threshold" v={birr(s.vatRegistrationThreshold)} />
            <KeyValue k="Last updated" v={dateTime(s.updatedAt)} />
            <KeyValue k="By" v={data?.updatedBy ?? '—'} />
          </Card>
        </div>
      )}

      {section === 'delivery' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Delivery pricing" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Flat delivery fee (ETB)">
                <Input
                  type="number"
                  min="0"
                  value={s.deliveryFlat / 100}
                  onChange={(e) => set('deliveryFlat', Math.round(Number(e.target.value) * 100))}
                />
              </Field>
              <Field label="Free delivery above order value (ETB)">
                <Input
                  type="number"
                  min="0"
                  value={s.freeDeliveryThreshold / 100}
                  onChange={(e) => set('freeDeliveryThreshold', Math.round(Number(e.target.value) * 100))}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Settlements and disputes" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Payout schedule">
                <Select value={s.payoutSchedule} onChange={(e) => set('payoutSchedule', e.target.value as PlatformSettings['payoutSchedule'])}>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every two weeks</option>
                  <option value="monthly">Monthly</option>
                </Select>
              </Field>
              <Field label="Settlement hold (days)" hint="Escrow tail between delivery and payout">
                <Input
                  type="number"
                  min="0"
                  value={s.settlementHoldDays}
                  onChange={(e) => set('settlementHoldDays', Number(e.target.value))}
                />
              </Field>
              <Field label="Dispute SLA (hours)" hint="After this the case is escalated automatically">
                <Input
                  type="number"
                  min="1"
                  value={s.disputeSlaHours}
                  onChange={(e) => set('disputeSlaHours', Number(e.target.value))}
                />
              </Field>
              <Field label="Support phone" hint="Shown to buyers and agents; never a personal number">
                <Input value={s.supportPhone} onChange={(e) => set('supportPhone', e.target.value)} />
              </Field>
            </div>
          </Card>
        </div>
      )}

      {section === 'plans' && (
        <Card>
          <CardHeader
            title="Subscription plans"
            subtitle="Secondary revenue only. Commission on transactions remains the primary mechanism."
            action={<Badge tone="warn" icon={<TriangleAlert className="size-3" />}>Never the primary model</Badge>}
          />
          <div className="space-y-2">
            {s.subscriptionPlans.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-3">
                <div>
                  <p className="text-xs font-bold">{p.name}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{p.features.join(' · ')}</p>
                </div>
                <p className="font-display text-base font-bold">{birr(p.monthly)}<span className="text-[10px] font-normal text-ink-3">/mo</span></p>
              </div>
            ))}
          </div>
          <Notice tone="info" className="mt-3" title="What a plan must never do">
            A seller must be able to list, sell and get paid without subscribing. A plan buys visibility and tooling, never
            the ability to trade.
          </Notice>
        </Card>
      )}

      {section === 'flags' && <Flags />}

      {section !== 'flags' && (
        <div className="flex items-center gap-2">
          <Button variant="primary" loading={busy} onClick={() => void save()} icon={<Save className="size-4" />} disabled={!form}>
            Save settings
          </Button>
          {form && <Button variant="ghost" onClick={() => setForm(null)}>Discard</Button>}
          {!form && <span className="text-[11px] text-ink-3">No unsaved changes.</span>}
        </div>
      )}
    </div>
  );
}

function Flags() {
  const { data, loading, error, reload } = useQuery<Data>('/admin/settings');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (loading || !data) return <Spinner label="Loading flags…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  const flags = data.flags;

  async function toggle(key: keyof FeatureFlags) {
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.patch<{ message: string }>('/admin/feature-flags', { flags: { [key]: !flags[key] } });
      setMsg(r.message);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not toggle that flag.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      <Grid cols={4}>
        <Stat label="Enabled" value={String(Object.entries(data.flags).filter(([k, v]) => k !== 'updatedAt' && v).length)} tone="ok" />
        <Stat label="Disabled" value={String(Object.entries(data.flags).filter(([k, v]) => k !== 'updatedAt' && !v).length)} />
        <Stat label="Shadow flags" value={String(Object.entries(data.flags).filter(([k, v]) => k === 'shadowRecommendations' && v).length)} tone="gold" icon={<EyeOff className="size-4" />} />
        <Stat label="Last changed" value={ago(data.flags.updatedAt)} />
      </Grid>

      <div className="space-y-2">
        {(Object.keys(data.flags) as (keyof FeatureFlags)[])
          .filter((k) => k !== 'updatedAt')
          .map((k) => {
            const on = data.flags[k];
            return (
              <Card key={k}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-bold">{k}</span>
                      {k === 'shadowRecommendations' && <Badge tone="gold" icon={<Eye className="size-3" />}>shadow</Badge>}
                      {k === 'cod' && !on && <Badge tone="bad">buyers cannot check out</Badge>}
                      {k === 'promotions' && on && <Badge tone="warn">labelled layer active</Badge>}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-2">{FLAG_HELP[k]}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={on ? 'secondary' : 'ghost'}
                    loading={busy === k}
                    onClick={() => void toggle(k)}
                    icon={on ? <ToggleRight className="size-4" /> : <ToggleLeft className="size-4" />}
                  >
                    {on ? 'On' : 'Off'}
                  </Button>
                </div>
              </Card>
            );
          })}
      </div>

      <Notice tone="warn" title="Turning off COD is immediate and irreversible in effect">
        Existing COD orders in flight still need to be collected and remitted. Only new checkouts are affected.
      </Notice>
    </div>
  );
}

function AuditLog() {
  const { data, loading, error, reload } = useQuery<Audit>('/admin/audit?limit=50');
  if (loading) return <Spinner label="Loading audit log…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  const items = data?.items ?? [];
  return (
    <Card>
      <CardHeader title="Audit log" icon={<Settings2 className="size-4" />} subtitle="Newest first. Written on every privileged action." />
      {items.length === 0 ? (
        <p className="text-xs text-ink-3">Nothing logged yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[11px]">
            <thead>
              <tr className="text-ink-3">
                <th className="pb-1.5 font-semibold">When</th>
                <th className="pb-1.5 font-semibold">Actor</th>
                <th className="pb-1.5 font-semibold">Action</th>
                <th className="pb-1.5 font-semibold">Target</th>
                <th className="pb-1.5 font-semibold">Change</th>
                <th className="pb-1.5 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t border-line/60 align-top">
                  <td className="py-1.5 whitespace-nowrap text-ink-3">{ago(a.at)}</td>
                  <td className="py-1.5 font-semibold">{a.actor}</td>
                  <td className="py-1.5 font-mono">{a.action}</td>
                  <td className="py-1.5 font-mono text-[10px] text-ink-3">{a.target}</td>
                  <td className="py-1.5">
                    {a.before && a.after ? (
                      <details>
                        <summary className={clsx('cursor-pointer text-[10px] font-semibold text-brand hover:underline')}>
                          view diff
                        </summary>
                        <pre className="mt-1 max-w-sm overflow-x-auto rounded bg-surface-2 p-1.5 font-mono text-[9px] whitespace-pre-wrap">
                          {a.before}
                          {'\n→ '}
                          {a.after}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="py-1.5 font-mono text-[10px] text-ink-3">{a.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Notice tone="info" className="mt-3" title="Why this is not editable">
        The audit log is append-only by design. There is no endpoint that edits or deletes an entry, and a privileged
        action that bypassed a check would still leave a record here.
      </Notice>
    </Card>
  );
}
