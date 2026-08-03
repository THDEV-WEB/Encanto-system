import './lib/sentry.js'; // REF-OBS-01: 1o import — Sentry.init roda antes do resto do bundle (mesmo padrao de main.jsx)
import { createRoot } from 'react-dom/client';
import { RootBoundary } from './RootBoundary.jsx';
import AdminApp from './AdminApp.jsx';

/* REF-ADMIN-04 · Onda 1: ponto de entrada PRÓPRIO do bundle administrativo (admin.html), montado
   separado de main.jsx/App.jsx — build isolado (vite.config.js, mode:'admin'), sem StoreApp, sem
   AuthProvider do cliente, sem os hooks exclusivos da loja (useDownloadPage, useCapacitorBackButton). */
const _root = createRoot(document.getElementById('root'));
_root.render(
  <RootBoundary><AdminApp /></RootBoundary>
);
