import './lib/sentry.js'; // REF-OBS-01: 1o import — Sentry.init roda antes do resto do bundle (side-effect só; consumo real fica em RootBoundary.jsx, mesmo módulo cacheado pelo ESM)
import { createRoot } from 'react-dom/client';
import { RootBoundary } from './RootBoundary.jsx'; // REF-ADMIN-04: extraido (compartilhado com admin-main.jsx)
import App from './App.jsx';

const _root = createRoot(document.getElementById('root'));
_root.render(
  <RootBoundary><App /></RootBoundary>
);
