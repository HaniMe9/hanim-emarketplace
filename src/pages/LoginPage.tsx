import { useState } from 'react';
import { AlertTriangle, Lock, LogIn, Mail, ShieldCheck, Store } from 'lucide-react';
import { useSession } from '../lib/session.tsx';
import { t } from '../lib/i18n/index.ts';
import { Button, Field, Input } from '../components/ui.tsx';
import { LangSwitch } from '../components/LangSwitch.tsx';

/**
 * Seeded accounts, listed so a reviewer can walk all five roles without
 * knowing an address. The password is the same for every demo account and is
 * shown here on purpose — these are fixtures, not real customers.
 */
const DEMO_ACCOUNTS = [
  { email: 'abebe@example.et', name: 'Abebe Kebede', role: 'Buyer' },
  { email: 'marta@selamtech.et', name: 'Marta Tesfaye', role: 'Seller' },
  { email: 'dawit@lemlemtrading.et', name: 'Dawit Alemu', role: 'Business buyer' },
  { email: 'kalkidan@courier.et', name: 'Kalkidan Tadesse', role: 'Delivery agent' },
  { email: 'selam@hanimarket.et', name: 'Selam Worku', role: 'Platform admin' },
];

const DEMO_PASSWORD = 'Demo#2026!';

export function LoginPage() {
  const { login, authError, signingIn, theme, toggleTheme } = useSession();
  const [email, setEmail] = useState(DEMO_ACCOUNTS[0]!.email);
  const [password, setPassword] = useState(DEMO_PASSWORD);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login(email, password);
    } catch {
      // `authError` already carries the message the form shows.
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">H</span>
          <span className="font-display text-[15px] font-bold tracking-tight">
            Hani<span className="text-brand">Market</span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            <LangSwitch />
            <Button size="sm" variant="ghost" onClick={toggleTheme} aria-label={t('Toggle theme')}>
              <span className="text-[11px] font-bold">{theme === 'dark' ? t('Light') : t('Dark')}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-6 px-4 py-10 md:flex-row md:items-start md:gap-10 md:pt-20">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-2xl font-bold tracking-tight">{t('Sign in')}</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{t('Your account decides what you can see. Sellers see their own orders, agents see their round, admins see the whole platform.')}</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label={t('Email')} required>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
                <Input
                  type="email"
                  name="email"
                  autoComplete="username"
                  required
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.et"
                />
              </div>
            </Field>

            <Field label={t('Password')} required>
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
                <Input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  className="pl-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            </Field>

            {authError && (
              <p className="flex items-start gap-2 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-xs leading-relaxed font-medium text-bad">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                {authError}
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" block loading={signingIn} icon={<LogIn className="size-4" />}>
              {signingIn ? t('Signing in…') : t('Sign in')}
            </Button>
          </form>

          <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
            <ShieldCheck className="mt-px size-3.5 shrink-0" />
            {t('The session is an httpOnly cookie — page scripts cannot read it, and signing out clears it server-side.')}
          </p>
        </div>

        <div className="w-full max-w-sm">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-ink-3 uppercase">
            <Store className="size-3" />
            {t('Demo accounts')}
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(a.email);
                    setPassword(DEMO_PASSWORD);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{a.name}</span>
                    <span className="block truncate text-[10px] text-ink-3">{a.email}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold text-brand-ink">
                    {t(a.role)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            {t('Every demo account uses the password')}{' '}
            <code className="font-mono font-semibold text-ink-2">{DEMO_PASSWORD}</code>. {t('Tap an account to fill the form.')}
          </p>
        </div>
      </main>
    </div>
  );
}
