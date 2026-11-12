import { Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell.tsx';
import { Spinner, ErrorNote, Button } from './components/ui.tsx';
import { ROLE_HOME, useSession } from './lib/session.tsx';
import type { Role, ReactNode } from './react/types.ts';
import { LoginPage } from './pages/LoginPage.tsx';

import { HomePage } from './pages/buyer/HomePage.tsx';
import { SearchPage } from './pages/buyer/SearchPage.tsx';
import { ProductPage } from './pages/buyer/ProductPage.tsx';
import { SellerPage } from './pages/buyer/SellerPage.tsx';
import { CartPage } from './pages/buyer/CartPage.tsx';
import { CheckoutPage } from './pages/buyer/CheckoutPage.tsx';
import { OrdersPage } from './pages/buyer/OrdersPage.tsx';
import { OrderPage } from './pages/buyer/OrderPage.tsx';
import { TrackPage } from './pages/buyer/TrackPage.tsx';
import { DisputesPage } from './pages/buyer/DisputesPage.tsx';

import { SellerDashboard } from './pages/seller/SellerDashboard.tsx';
import { SellerOrders } from './pages/seller/SellerOrders.tsx';
import { SellerListings } from './pages/seller/SellerListings.tsx';
import { SellerFinance } from './pages/seller/SellerFinance.tsx';
import { SellerAi } from './pages/seller/SellerAi.tsx';
import { SellerBuyBox } from './pages/seller/SellerBuyBox.tsx';

import { B2BDashboard } from './pages/b2b/B2BDashboard.tsx';
import { B2BRfqs } from './pages/b2b/B2BRfqs.tsx';
import { B2BOrders } from './pages/b2b/B2BOrders.tsx';
import { B2BInvoices } from './pages/b2b/B2BInvoices.tsx';

import { AgentToday } from './pages/agent/AgentToday.tsx';
import { AgentRoutes } from './pages/agent/AgentRoutes.tsx';
import { AgentCash } from './pages/agent/AgentCash.tsx';

import { AdminPlatform } from './pages/admin/AdminPlatform.tsx';
import { AdminDirectory } from './pages/admin/AdminDirectory.tsx';
import { AdminModeration } from './pages/admin/AdminModeration.tsx';
import { AdminFinance } from './pages/admin/AdminFinance.tsx';
import { AdminReconciliation } from './pages/admin/AdminReconciliation.tsx';
import { AdminRisk } from './pages/admin/AdminRisk.tsx';
import { AdminAi } from './pages/admin/AdminAi.tsx';
import { AdminSettings } from './pages/admin/AdminSettings.tsx';

function Guard({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();

  if (loading) return <Spinner label="Starting HaniMarket…" />;
  if (!session?.user) return <ErrorNote message="No session. The API may still be booting." />;

  // Admins can inspect any surface; everyone else lands on their own home.
  if (session.user.role === 'admin' || allow.includes(session.user.role)) return <>{children}</>;
  return <Navigate to={ROLE_HOME[session.user.role]} replace state={{ from: location.pathname }} />;
}

export function App() {
  const { session, loading, error, refresh } = useSession();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Spinner label="Starting HaniMarket…" />
      </div>
    );
  }

  // An API that is down is a retry problem. A session with no user is a sign-in
  // problem, and must not be dressed up as an error.
  if (error || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-md space-y-3">
          <ErrorNote message={error ?? 'Could not reach the HaniMarket API. Is the server running on port 4000?'} onRetry={() => void refresh()} />
          <Button block onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!session.authenticated || !session.user) return <LoginPage />;

  return (
    <Shell>
      <Suspense fallback={<Spinner />}>
        <Routes>
          {/* buyer */}
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/product/:idOrSlug" element={<ProductPage />} />
          <Route path="/sellers/:id" element={<SellerPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:code" element={<OrderPage />} />
          <Route path="/track/:code" element={<TrackPage />} />
          <Route path="/track" element={<TrackPage />} />
          <Route path="/disputes" element={<DisputesPage />} />

          {/* seller */}
          <Route path="/seller" element={<Guard allow={['seller']}><SellerDashboard /></Guard>} />
          <Route path="/seller/orders" element={<Guard allow={['seller']}><SellerOrders /></Guard>} />
          <Route path="/seller/listings" element={<Guard allow={['seller']}><SellerListings /></Guard>} />
          <Route path="/seller/finance" element={<Guard allow={['seller']}><SellerFinance /></Guard>} />
          <Route path="/seller/ai" element={<Guard allow={['seller']}><SellerAi /></Guard>} />
          <Route path="/seller/buybox" element={<Guard allow={['seller']}><SellerBuyBox /></Guard>} />

          {/* b2b */}
          <Route path="/b2b" element={<Guard allow={['business_buyer']}><B2BDashboard /></Guard>} />
          <Route path="/b2b/rfqs" element={<Guard allow={['business_buyer']}><B2BRfqs /></Guard>} />
          <Route path="/b2b/orders" element={<Guard allow={['business_buyer']}><B2BOrders /></Guard>} />
          <Route path="/b2b/invoices" element={<Guard allow={['business_buyer']}><B2BInvoices /></Guard>} />

          {/* agent */}
          <Route path="/agent" element={<Guard allow={['agent']}><AgentToday /></Guard>} />
          <Route path="/agent/routes" element={<Guard allow={['agent']}><AgentRoutes /></Guard>} />
          <Route path="/agent/cash" element={<Guard allow={['agent']}><AgentCash /></Guard>} />

          {/* admin */}
          <Route path="/admin" element={<Guard allow={['admin']}><AdminPlatform /></Guard>} />
          <Route path="/admin/directory" element={<Guard allow={['admin']}><AdminDirectory /></Guard>} />
          <Route path="/admin/moderation" element={<Guard allow={['admin']}><AdminModeration /></Guard>} />
          <Route path="/admin/finance" element={<Guard allow={['admin']}><AdminFinance /></Guard>} />
          <Route path="/admin/reconciliation" element={<Guard allow={['admin']}><AdminReconciliation /></Guard>} />
          <Route path="/admin/risk" element={<Guard allow={['admin']}><AdminRisk /></Guard>} />
          <Route path="/admin/ai" element={<Guard allow={['admin']}><AdminAi /></Guard>} />
          <Route path="/admin/settings" element={<Guard allow={['admin']}><AdminSettings /></Guard>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="font-display text-5xl font-bold text-brand">404</p>
      <h1 className="mt-2 text-lg font-bold">This page does not exist</h1>
      <p className="mt-1 text-sm text-ink-3">The link may be old, or the item may have been removed.</p>
      <a href="/" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
        Back to the marketplace
      </a>
    </div>
  );
}
