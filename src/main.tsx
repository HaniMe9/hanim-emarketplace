import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { injectSpeedInsights } from '@vercel/speed-insights';
import { App } from './App.tsx';
import { SessionProvider } from './lib/session.tsx';
import { I18nBridge } from './lib/I18nBridge.tsx';
import './index.css';

injectSpeedInsights();

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <I18nBridge>
          <App />
        </I18nBridge>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
