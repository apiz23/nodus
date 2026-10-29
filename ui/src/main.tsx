import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@fontsource-variable/geist';
import App from './App';
import LandingPage from './LandingPage';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Nodus UI root element was not found');

const path = window.location.pathname.replace(/\/+$/, '') || '/';
const isWorkspace = path === '/app';

createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      {isWorkspace ? <App /> : <LandingPage />}
    </TooltipProvider>
  </StrictMode>,
);
