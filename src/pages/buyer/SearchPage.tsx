import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Filter, Info, Search as SearchIcon, SlidersHorizontal, X } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { qs } from '../../lib/api.ts';
import { moneyShort, titleCase } from '../../lib/format.ts';
import { Badge, Button, Card, Checkbox, Empty, ErrorNote, Input, Select, Spinner } from '../../components/ui.tsx';
import { ProductCard } from '../../components/ProductCard.tsx';
import type { ProductSummary } from '../../../shared/types.ts';

interface FacetValue { value: string; label: string; count: number; selected: boolean }
interface Facet {
  key: string;
  label: string;
  type: 'range' | 'checkbox';
  min?: number;
  max?: number;
  values?: FacetValue[];
}
interface SearchResult {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
  took: number;
  facets: Facet[];
  suggestions: string[];
  engine: string;
  applied: Record<string, unknown>;
  rankingSignals: { name: string; weight: number; note: string }[];
}

const SORTS = [
  { v: 'relevance', l: 'Best match' },
  { v: 'price_asc', l: 'Price: low to high' },
  { v: 'price_desc', l: 'Price: high to low' },
  { v: 'rating', l: 'Top rated' },
  { v: 'sales', l: 'Best selling' },
  { v: 'newest', l: 'Newest first' },
];

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const [minInput, setMinInput] = useState(params.get('min') ?? '');
  const [maxInput, setMaxInput] = useState(params.get('max') ?? '');

  const q = params.get('q') ?? '';
  const page = Number(params.get('page') ?? 1);
  const activeCount = ['category', 'brand', 'condition', 'fulfillment', 'min', 'max', 'minRating', 'inStock', 'b2bOnly', 'seller']
    .filter((k) => params.get(k)).length;

  const path = useMemo(() => {
    const query: Record<string, string | number> = { page, pageSize: 24 };
    for (const [k, v] of params) {
      if (k === 'page' || k === 'pageSize' || !v) continue;
      query[k] = v;
    }
    return `/search${qs(query)}`;
  }, [params, page]);

  const { data, loading, error, reload } = useQuery<SearchResult>(path);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  function toggleMulti(key: string, value: string) {
    const next = new URLSearchParams(params);
    const current = (next.get(key) ?? '').split(',').filter(Boolean);
    const idx = current.indexOf(value);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(value);
    if (current.length) next.set(key, current.join(','));
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-bold">
            {q ? <>Results for “<span className="text-brand">{q}</span>”</> : 'Browse everything'}
          </h1>
          <p className="mt-0.5 text-xs text-ink-3">
            {data ? `${data.total.toLocaleString()} products · ${data.took}ms` : 'Searching…'}
            {data && data.total > 0 && ' · sponsored placements are labelled'}
          </p>
        </div>
        <Button
          variant="secondary"
          className="lg:hidden"
          icon={<SlidersHorizontal className="size-4" />}
          onClick={() => setShowFilters((v) => !v)}
        >
          Filters{activeCount > 0 && ` (${activeCount})`}
        </Button>
        <Select value={params.get('sort') ?? 'relevance'} onChange={(e) => setParam('sort', e.target.value)} className="w-44">
          {SORTS.map((s) => (
            <option key={s.v} value={s.v}>{s.l}</option>
          ))}
        </Select>
      </div>

      {data && data.suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-3">Did you mean:</span>
          {data.suggestions.map((s) => (
            <button key={s} onClick={() => setParam('q', s)} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-brand/40 hover:text-brand">
              {s}
            </button>
          ))}
        </div>
      )}

      {activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {['category', 'brand', 'condition', 'fulfillment', 'min', 'max', 'minRating', 'inStock', 'b2bOnly', 'seller'].map((k) => {
            const v = params.get(k);
            if (!v) return null;
            return (
              <Badge key={k} tone="brand">
                {k === 'inStock' ? 'In stock' : k === 'b2bOnly' ? 'Wholesale' : `${k}: ${v.split(',').map(titleCase).join(', ')}`}
                <button className="ml-0.5 opacity-70 hover:opacity-100" onClick={() => setParam(k, null)} aria-label="Remove filter">
                  <X className="size-3" />
                </button>
              </Badge>
            );
          })}
          <button className="text-[11px] font-semibold text-ink-3 underline hover:text-ink" onClick={() => setParams(new URLSearchParams(q ? { q } : {}), { replace: true })}>
            Clear all
          </button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <aside className={clsx('space-y-4', !showFilters && 'hidden lg:block')}>
          <FacetPanel
            facets={data?.facets ?? []}
            params={params}
            onSet={setParam}
            onToggle={toggleMulti}
            minInput={minInput}
            maxInput={maxInput}
            setMinInput={setMinInput}
            setMaxInput={setMaxInput}
          />
        </aside>

        <div>
          {loading && <Spinner label="Searching…" />}
          {error && <ErrorNote message={error} onRetry={reload} />}
          {data && data.items.length === 0 && (
            <Empty
              icon={<SearchIcon className="size-5" />}
              title="Nothing matched that"
              message="Try a broader term, remove a filter, or search in Amharic — ስልክናዊ and Latin transliterations both work."
              action={<Link to="/search"><Button>Reset search</Button></Link>}
            />
          )}
          {data && data.items.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {data.items.map((p, i) => (
                  <ProductCard key={p.id} p={p} sponsored={i < 2} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2">
                  <Button
                    size="sm"
                    disabled={page <= 1}
                    icon={<ChevronLeft className="size-3.5" />}
                    onClick={() => setParam('page', String(page - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-ink-3">Page {page} of {totalPages}</span>
                  <Button
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setParam('page', String(page + 1))}
                  >
                    Next <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              )}
            </>
          )}

          {data && data.items.length > 0 && (
            <Card className="mt-6">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-ink-2">
                <Info className="size-3.5 text-brand" /> How this ranking was built
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.rankingSignals.map((s) => (
                  <div key={s.name} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="text-ink-2">{s.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-ink-3">{s.weight}%</span>
                  </div>
                ))}
              </div>
              <p className="mt-2.5 text-[10px] leading-relaxed text-ink-3">
                A paid placement can win the Buy Box, but it is always labelled Sponsored and never outranks price,
                stock or seller performance on its own. Engine: {data.engine}.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function FacetPanel({
  facets,
  params,
  onSet,
  onToggle,
  minInput,
  maxInput,
  setMinInput,
  setMaxInput,
}: {
  facets: Facet[];
  params: URLSearchParams;
  onSet: (k: string, v: string | null) => void;
  onToggle: (k: string, v: string) => void;
  minInput: string;
  maxInput: string;
  setMinInput: (v: string) => void;
  setMaxInput: (v: string) => void;
}) {
  return (
    <>
      <Card>
        <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold">
          <Filter className="size-3.5 text-brand" /> Refine
        </p>
        <div className="space-y-1.5">
          <Checkbox
            checked={params.get('inStock') === 'true'}
            onChange={(v) => onSet('inStock', v ? 'true' : null)}
            label="In stock only"
            hint="Hide listings that cannot ship today"
          />
          <Checkbox
            checked={params.get('b2bOnly') === 'true'}
            onChange={(v) => onSet('b2bOnly', v ? 'true' : null)}
            label="Wholesale available"
            hint="Products with a minimum order quantity"
          />
        </div>
      </Card>

      {facets.filter((f) => f.type === 'range').map((f) => (
        <Card key={f.key}>
          <p className="mb-2.5 text-xs font-bold">{f.label}</p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              placeholder="Min"
              value={minInput}
              onChange={(e) => setMinInput(e.target.value)}
              onBlur={() => onSet('min', minInput ? String(Math.round(Number(minInput) * 100)) : null)}
              className="h-9 text-xs"
            />
            <span className="text-ink-3">–</span>
            <Input
              type="number"
              inputMode="numeric"
              placeholder="Max"
              value={maxInput}
              onChange={(e) => setMaxInput(e.target.value)}
              onBlur={() => onSet('max', maxInput ? String(Math.round(Number(maxInput) * 100)) : null)}
              className="h-9 text-xs"
            />
          </div>
          <p className="mt-1.5 text-[10px] text-ink-3">Enter amounts in birr, not santim.</p>
        </Card>
      ))}

      {facets.filter((f) => f.type === 'checkbox' && f.values?.length).map((f) => (
        <Card key={f.key}>
          <p className="mb-2.5 text-xs font-bold">{f.label}</p>
          <div className="space-y-1.5">
            {f.values!.map((v) => (
              <Checkbox
                key={v.value}
                checked={v.selected}
                onChange={() => onToggle(f.key, v.value)}
                label={
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="truncate">{v.label}</span>
                    <span className="shrink-0 text-[10px] text-ink-3">{v.count}</span>
                  </span>
                }
              />
            ))}
          </div>
        </Card>
      ))}

      <Card>
        <p className="mb-2.5 text-xs font-bold">Minimum rating</p>
        <Select value={params.get('minRating') ?? ''} onChange={(e) => onSet('minRating', e.target.value || null)} className="h-9 text-xs">
          <option value="">Any rating</option>
          <option value="4">4 stars and up</option>
          <option value="4.5">4.5 stars and up</option>
        </Select>
        <p className="mt-1.5 text-[10px] text-ink-3">
          {moneyShort(0)} = free. Minimum rating uses published reviews from verified purchases only.
        </p>
      </Card>
    </>
  );
}
