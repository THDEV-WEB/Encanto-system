import { createRoot } from 'react-dom/client';
import { RootBoundary } from './RootBoundary.jsx';
import { ConviteApp } from './ConviteApp.jsx';
import './index.css';

/* REF-STORE-ONBOARD-01 · Onda 2: ponto de entrada PRÓPRIO de convite.html — bundle isolado (vite.config.js,
   2o entry do mode 'admin'), sem AdminApp/useAdminSession/lib/supabase.js. Ver ConviteApp.jsx pro porquê
   do isolamento. */
const _root = createRoot(document.getElementById('root'));
_root.render(
  <RootBoundary><ConviteApp /></RootBoundary>
);
