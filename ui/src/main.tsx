import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@fontsource-variable/geist';
import './index.css';

const App = lazy(() => import('./App'));
const LandingPage = lazy(() => import('./LandingPage'));

const root = document.getElementById('root');
if (root === null) throw new Error('Nodus UI root element was not found');

const path = window.location.pathname.replace(/\/+$/, '') || '/';
const isWorkspace = path === '/app';

createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <Suspense fallback={<div className="min-h-screen bg-background px-4 py-6 text-sm text-muted-foreground" role="status">Loading Nodus…</div>}>
        {isWorkspace ? <App /> : <LandingPage />}
      </Suspense>
    </TooltipProvider>
  </StrictMode>,
);
