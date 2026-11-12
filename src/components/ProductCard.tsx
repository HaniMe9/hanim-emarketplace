import { Link } from 'react-router-dom';
import { Heart, Star, Truck } from 'lucide-react';
import clsx from 'clsx';
import type { ProductSummary } from '../../shared/types.ts';
import { birr, enumLabel, money } from '../lib/format.ts';
import { t } from '../lib/i18n/index.ts';
import { Badge, Dot } from './ui.tsx';

export function ProductCard({
  p,
  sponsored = false,
  onHover,
}: {
  p: ProductSummary;
  sponsored?: boolean;
  onHover?: () => void;
}) {
  const off = p.compareAtPrice && p.compareAtPrice > p.price
    ? Math.round((1 - p.price / p.compareAtPrice) * 100)
    : 0;

  return (
    <Link
      to={`/product/${p.slug}`}
      onMouseEnter={onHover}
      className="group card animate-rise flex flex-col overflow-hidden transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-4/3 overflow-hidden bg-surface-2">
        <img
          src={p.image}
          alt={p.title}
          loading="lazy"
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          {sponsored && (
            <Badge tone="gold" className="shadow-sm">
              {t('Sponsored')}
            </Badge>
          )}
          {off > 0 && <Badge tone="bad" className="shadow-sm">{t('{n}% off', { n: off })}</Badge>}
          {p.promotion?.label && !off && (
            <Badge tone="violet" className="shadow-sm">{p.promotion.label}</Badge>
          )}
        </div>
        <button
          className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-surface/85 text-ink-3 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 hover:text-bad"
          onClick={(e) => e.preventDefault()}
          aria-label={t('Save for later')}
        >
          <Heart className="size-3.5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="text-[10px] font-semibold tracking-wide text-ink-3 uppercase">{p.categoryName}</p>
        <h3 className="clamp-2 text-[13px] leading-snug font-semibold text-ink group-hover:text-brand">{p.title}</h3>

        <div className="mt-auto space-y-1.5 pt-1">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span className="font-display text-[15px] font-bold text-ink">{birr(p.price)}</span>
            {off > 0 && <span className="text-[11px] text-ink-3 line-through">{birr(p.compareAtPrice!)}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3">
            <span className="flex items-center gap-0.5">
              <Star className="size-3 fill-gold text-gold" />
              <span className="font-semibold text-ink-2">{p.rating.toFixed(1)}</span>
              <span>({p.reviewCount})</span>
            </span>
            {p.soldCount > 0 && <span>· {t('{n} sold', { n: p.soldCount })}</span>}
          </div>
          {p.etaDays && (
            <p className="flex items-center gap-1 text-[11px] text-ink-3">
              <Truck className="size-3" />
              {t('{a}–{b} days', { a: p.etaDays[0], b: p.etaDays[1] })}
            </p>
          )}
          {p.sellerName && (
            <p className="flex items-center gap-1.5 truncate text-[11px] text-ink-3">
              <Dot tone={p.badge ? 'ok' : 'muted'} />
              <span className="truncate">{p.sellerName}</span>
              {p.badge && <Badge tone="ok" className="shrink-0">{p.badge}</Badge>}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

export function ProductGrid({ items, sponsoredFirst = false }: { items: ProductSummary[]; sponsoredFirst?: boolean }) {
  if (!items.length) {
    return <p className="py-10 text-center text-sm text-ink-3">{t('No products to show here yet.')}</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((p, i) => (
        <ProductCard key={p.id} p={p} sponsored={sponsoredFirst && i < 2} />
      ))}
    </div>
  );
}

export function ProductRow({ items, sponsored = false }: { items: ProductSummary[]; sponsored?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
      {items.map((p) => (
        <div key={p.id} className="w-44 shrink-0 sm:w-52">
          <ProductCard p={p} sponsored={sponsored} />
        </div>
      ))}
    </div>
  );
}

export function SellerChip({ name, badge, trust }: { name: string; badge?: string; trust?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-3">
      <Dot tone={badge ? 'ok' : 'muted'} />
      <span className="truncate">{name}</span>
      {badge ? <Badge tone="ok">{badge}</Badge> : null}
      {trust !== undefined && <span className="shrink-0">· {t('trust {n}', { n: Math.round(trust) })}</span>}
    </span>
  );
}

export function ConditionLabel({ condition }: { condition: string }) {
  return <Badge tone={condition === 'new' ? 'ok' : 'muted'}>{enumLabel(condition)}</Badge>;
}

export function MoneyText({ value, className }: { value: number; className?: string }) {
  return <span className={clsx('tabular-nums', className)}>{money(value)}</span>;
}
