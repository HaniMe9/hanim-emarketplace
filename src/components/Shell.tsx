import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Bell, ChevronDown, LayoutDashboard, LogOut, Menu, Moon, Search, Settings2, ShieldCheck,
  ShoppingCart, Sparkles, Store, Sun, Truck, Users, X, Boxes, Receipt,
} from 'lucide-react';
import clsx from 'clsx';
import { ROLE_HOME, ROLE_LABEL_KEY, useSession, useUser } from '../lib/session.tsx';
import { t } from '../lib/i18n/index.ts';
import type { Role } from '../../shared/types.ts';
import { Avatar, Badge } from './ui.tsx';
import { LangSwitch } from './LangSwitch.tsx';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Store;
  end?: boolean;
}

const NAV: Record<string, NavItem[]> = {
  buyer: [
    { to: '/', label: 'Home', icon: Store, end: true },
    { to: '/search', label: 'Browse', icon: Search },
    { to: '/orders', label: 'Orders', icon: Boxes },
    { to: '/disputes', label: 'Disputes', icon: ShieldCheck },
  ],
  business_buyer: [
    { to: '/b2b', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/b2b/rfqs', label: 'RFQs', icon: Receipt },
    { to: '/b2b/orders', label: 'Purchase orders', icon: Boxes },
    { to: '/b2b/invoices', label: 'Invoices', icon: Receipt },
    { to: '/orders', label: 'My orders', icon: ShoppingCart },
  ],
  seller: [
    { to: '/seller', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/seller/orders', label: 'Orders', icon: Boxes },
    { to: '/seller/listings', label: 'Listings', icon: Store },
    { to: '/seller/finance', label: 'Finance', icon: Receipt },
    { to: '/seller/ai', label: 'AI tools', icon: Sparkles },
    { to: '/seller/buybox', label: 'Buy Box', icon: ShieldCheck },
  ],
  agent: [
    { to: '/agent', label: 'Today', icon: Truck, end: true },
    { to: '/agent/routes', label: 'Routes', icon: Truck },
    { to: '/agent/cash', label: 'Cash & POD', icon: Receipt },
  ],
  admin: [
    { to: '/admin', label: 'Platform', icon: LayoutDashboard, end: true },
    { to: '/admin/directory', label: 'Directory', icon: Users },
    { to: '/admin/moderation', label: 'Moderation', icon: ShieldCheck },
    { to: '/admin/finance', label: 'Finance', icon: Receipt },
    { to: '/admin/reconciliation', label: 'Reconciliation', icon: Receipt },
    { to: '/admin/risk', label: 'Risk', icon: ShieldCheck },
    { to: '/admin/ai', label: 'AI governance', icon: Sparkles },
    { to: '/admin/settings', label: 'Settings', icon: Settings2 },
  ],
};

export function Shell({ children }: { children: ReactNode }) {
  const { session, users, switchUser, logout, theme, toggleTheme } = useSession();
  const user = useUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const location = useLocation();
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    setUserOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!userOpen && !notifOpen) return;
    const close = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [userOpen, notifOpen]);

  const role: Role = user.role;
  const items = NAV[role] ?? NAV.buyer!;
  const home = ROLE_HOME[role];

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Link to={home} className="flex shrink-0 items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">H</span>
            <span className="hidden font-display text-[15px] font-bold tracking-tight sm:block">
              Hani<span className="text-brand">Market</span>
            </span>
          </Link>

          <form
            className="hidden min-w-0 flex-1 md:block"
            onSubmit={(e) => {
              e.preventDefault();
              const q = new FormData(e.currentTarget).get('q');
              window.location.assign(`/search?q=${encodeURIComponent(String(q ?? ''))}`);
            }}
          >
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
              <input
                name="q"
                placeholder={t('Search products, sellers, categories…')}
                className="h-9 w-full rounded-md border border-line bg-surface-2 pr-3 pl-9 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:bg-surface focus:outline-none"
              />
            </div>
          </form>

          <div className="ml-auto flex items-center gap-1">
            <LangSwitch />
            <button
              onClick={toggleTheme}
              title={t(theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode')}
              aria-label={t('Toggle theme')}
              className="flex size-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>

            {role === 'buyer' || role === 'business_buyer' ? (
              <Link
                to="/cart"
                className="relative flex size-9 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                aria-label={t('Cart')}
              >
                <ShoppingCart className="size-4" />
                {(session?.cartCount ?? 0) > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                    {session?.cartCount}
                  </span>
                )}
              </Link>
            ) : null}

            <div className="relative">
              <button
                className="relative flex size-9 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label={t('Notifications')}
              >
                <Bell className="size-4" />
                {(session?.unread ?? 0) > 0 && (
                  <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-bad" />
                )}
              </button>
              {notifOpen && <NotificationPanel onClose={() => setNotifOpen(false)} />}
            </div>

            <div className="relative" ref={userRef}>
              <button
                onClick={() => setUserOpen((v) => !v)}
                className="ml-1 flex items-center gap-2 rounded-md py-1 pr-1.5 pl-1 transition-colors hover:bg-surface-2"
              >
                <Avatar name={user.name} hue={user.avatarHue} size={28} />
                <span className="hidden text-left sm:block">
                  <span className="block max-w-32 truncate text-xs leading-tight font-semibold">{user.name}</span>
                  <span className="block text-[10px] leading-tight text-ink-3">{t(ROLE_LABEL_KEY[user.role])}</span>
                </span>
                <ChevronDown className="size-3.5 text-ink-3" />
              </button>
              {userOpen && (
                <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-lg border border-line bg-surface shadow-xl">
                  <div className="border-b border-line px-3 py-2.5">
                    <p className="text-sm font-semibold">{user.name}</p>
                    <p className="truncate text-[11px] text-ink-3">{user.email}</p>
                    {session?.org && (
                      <Badge tone="brand" className="mt-1.5">
                        {session.org.name}
                      </Badge>
                    )}
                  </div>
                  {users.length > 0 && (
                    <div className="p-1.5">
                      <p className="px-2 py-1 text-[10px] font-bold tracking-wider text-ink-3 uppercase">{t('View as')}</p>
                      {users.map((u) => (
                        <button
                          key={u.id}
                          className={clsx(
                            'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2',
                            u.id === user.id && 'bg-brand-soft',
                          )}
                          onClick={() => void switchUser(u.id).catch(() => setUserOpen(false))}
                        >
                          <Avatar name={u.name} hue={u.avatarHue} size={24} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold">{u.name}</span>
                            <span className="block text-[10px] text-ink-3">{t(ROLE_LABEL_KEY[u.role])}</span>
                          </span>
                          {u.id === user.id && <span className="size-1.5 rounded-full bg-brand" />}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="border-t border-line p-1.5">
                    <button
                      onClick={() => {
                        setUserOpen(false);
                        void logout();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-bad"
                    >
                      <LogOut className="size-4" />
                      {t('Sign out')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              className="ml-1 flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 md:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t('Menu')}
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="border-t border-line bg-surface px-4 py-2 md:hidden">
            {items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-semibold',
                    isActive ? 'bg-brand-soft text-brand-ink' : 'text-ink-2',
                  )
                }
              >
                <it.icon className="size-4" />
                {t(it.label)}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <div className="hidden border-b border-line bg-surface md:block">
        <nav className="mx-auto flex max-w-7xl gap-1 px-4">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                clsx(
                  'relative px-3 py-2.5 text-[13px] font-semibold transition-colors',
                  isActive ? 'text-brand' : 'text-ink-3 hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {t(it.label)}
                  {isActive && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:py-6">{children}</main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-display text-sm font-bold">
                Hani<span className="text-brand">Market</span>
              </p>
              <p className="mt-0.5 text-[11px] text-ink-3">
                ሀኒማርኬት · {t("Ethiopia's B2C and B2B marketplace")}
              </p>
            </div>
            <p className="max-w-md text-[11px] leading-relaxed text-ink-3">
              {t('Prices exclude VAT. Seller funds are held in escrow until delivery is confirmed — capture is not the same as payable. Cash on delivery is the primary payment method in Ethiopia; card and mobile money follow.')}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<
    { id: string; title: string; body: string; severity: string; at: string; link?: string }[] | null
  >(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/notifications')
      .then((r) => r.json())
      .then((d: { items?: typeof items }) => {
        if (alive) setItems(d.items ?? []);
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const tone: Record<string, string> = {
    info: 'bg-info', success: 'bg-ok', warn: 'bg-warn', critical: 'bg-bad',
  };

  return (
    <div className="absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-y-auto rounded-lg border border-line bg-surface shadow-xl">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <p className="text-xs font-bold">{t('Notifications')}</p>
        <button className="text-ink-3 hover:text-ink" onClick={onClose} aria-label={t('Close')}>
          <X className="size-3.5" />
        </button>
      </div>
      {!items ? (
        <p className="px-3 py-6 text-center text-xs text-ink-3">{t('Loading…')}</p>
      ) : items.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-ink-3">{t('Nothing new.')}</p>
      ) : (
        items.slice(0, 12).map((n) => (
          <Link
            key={n.id}
            to={n.link ?? '#'}
            className="flex gap-2.5 border-b border-line px-3 py-2.5 transition-colors last:border-0 hover:bg-surface-2"
          >
            <span className={clsx('mt-1.5 size-1.5 shrink-0 rounded-full', tone[n.severity] ?? 'bg-ink-3')} />
            <span className="min-w-0">
              <span className="block text-xs font-semibold">{n.title}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">{n.body}</span>
              <span className="mt-0.5 block text-[10px] text-ink-3">{new Date(n.at).toLocaleString()}</span>
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
