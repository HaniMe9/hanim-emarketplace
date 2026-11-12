import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, PackageSearch, RotateCcw, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.ts';
import { birr } from '../lib/format.ts';
import { t } from '../lib/i18n/index.ts';
import { useSession } from '../lib/session.tsx';
import type { ProductSummary } from '../../shared/types.ts';

interface AssistantReply {
  answer: string;
  products: ProductSummary[];
  suggestions: string[];
  followUp: boolean;
  lang: 'am' | 'en';
}

interface ChatTurn {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  products?: ProductSummary[];
  suggestions?: string[];
  failed?: boolean;
}

const STARTERS = [
  'headphones under ETB 5,000',
  'best rated coffee',
  'ከ2000 ብር በታች ስማርት',
];

/**
 * Buyer assistant. A conversation, not a search box: the turn history is sent
 * with each question so a follow-up like "cheaper?" resolves against what was
 * already discussed, and every answer is followed by the grounded products it
 * was derived from.
 */
export function Assistant() {
  const { lang } = useSession();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  // Pin to the newest turn; layout effect so it happens before paint.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  const starters = lang === 'am' ? ['ከ5000 ብር በታች ሰርጣ', 'ከፍተኛ ደረጃ ያለው ቡና', 'ስማርት'] : STARTERS;

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    const userTurn: ChatTurn = { id: nextId.current++, role: 'user', content };
    const history = turns.map((x) => ({ role: x.role, content: x.content }));
    setTurns((prev) => [...prev, userTurn]);
    setDraft('');
    setBusy(true);

    try {
      const res = await api.post<AssistantReply>('/ai/assistant', { message: content, history, lang });
      setTurns((prev) => [
        ...prev,
        {
          id: nextId.current++,
          role: 'assistant',
          content: res.answer,
          products: res.products ?? [],
          suggestions: res.suggestions ?? [],
        },
      ]);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status !== 0
          ? e.message
          : t('The assistant is unreachable right now. Try again in a moment.');
      // The failed question stays in the transcript so the user can retry it
      // in place instead of retyping.
      setTurns((prev) => [
        ...prev,
        { id: nextId.current++, role: 'assistant', content: msg, suggestions: [], failed: true },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  }

  const last = turns[turns.length - 1];
  const showStarters = turns.length === 0;

  return (
    <section
      aria-label={t('Ask the marketplace')}
      className="card flex min-h-[22rem] flex-col bg-surface-2/60"
    >
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-brand" />
        <p className="min-w-0 flex-1 truncate text-sm font-bold">{t('Ask the marketplace')}</p>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => setTurns([])}
            title={t('Start a new conversation')}
            aria-label={t('Start a new conversation')}
            className="shrink-0 rounded p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </div>

      <div ref={scrollRef} className="no-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {showStarters && (
          <div className="mb-3 flex flex-col items-center gap-2 py-6 text-center">
            <PackageSearch className="size-6 text-ink-3" />
            <p className="max-w-[22rem] text-xs leading-relaxed text-ink-3">
              {t('Ask about a budget, a category or a brand. I only answer from the live catalog.')}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {turns.map((turn) => (
            <div key={turn.id}>
              {turn.role === 'user' ? (
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-lg rounded-br-sm bg-brand px-3 py-2 text-xs leading-relaxed text-white">
                    {turn.content}
                  </p>
                </div>
              ) : (
                <div
                  className={clsx(
                    'rounded-lg rounded-bl-sm px-3 py-2 text-xs leading-relaxed',
                    turn.failed ? 'border border-bad/25 bg-bad-soft text-bad' : 'bg-surface text-ink-2',
                  )}
                >
                  <RichText text={turn.content} />

                  {!!turn.products?.length && (
                    <div className="mt-2 space-y-1.5">
                      {turn.products.map((p) => (
                        <Link
                          key={p.id}
                          to={`/product/${p.slug}`}
                          className="flex items-center gap-2 rounded-md border border-line bg-surface-2 p-1.5 transition-colors hover:border-brand/40"
                        >
                          <img src={p.image} alt="" className="size-8 shrink-0 rounded object-cover" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-semibold text-ink">
                              {lang === 'am' ? p.titleAm : p.title}
                            </span>
                            <span className="block truncate text-[10px] text-ink-3">
                              {lang === 'am' ? p.categoryName : p.categoryName} · ★ {p.rating.toFixed(1)}
                            </span>
                          </span>
                          <span className="shrink-0 text-[11px] font-bold tabular-nums">
                            {birr(p.price, { decimals: false })}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-1.5 px-1 text-[11px] text-ink-3">
              <span className="size-1.5 animate-pulse-ring rounded-full bg-brand" />
              <span className="size-1.5 animate-pulse-ring rounded-full bg-brand [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse-ring rounded-full bg-brand [animation-delay:300ms]" />
            </div>
          )}
        </div>
      </div>

      {/* Follow-up chips ride on the latest answer, or seed an empty thread. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(showStarters ? starters : last?.role === 'assistant' ? last.suggestions ?? [] : []).map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={busy}
            onClick={() => void send(chip)}
            className="rounded-full border border-line bg-surface px-2.5 py-1 text-[10px] font-semibold text-ink-2 transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50"
          >
            {chip}
          </button>
        ))}
      </div>

      <form
        className="mt-2 flex items-end gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={t('Ask the marketplace')}
          placeholder={t('What do I need for a 500-guest wedding in Hawassa?')}
          className="max-h-24 min-h-9 w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          aria-label={t('Send')}
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand text-white transition-colors hover:bg-brand-strong disabled:opacity-40"
        >
          <ArrowUp className="size-4" />
        </button>
      </form>

      <p className="mt-1.5 text-[10px] leading-relaxed text-ink-3">
        {t('Answers are grounded in the live catalog. The model is not allowed to invent prices or stock, so if it does not know, it says so.')}
      </p>
    </section>
  );
}

/** Renders the `**bold**` product name the assistant wraps around its answer. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-bold text-ink">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}