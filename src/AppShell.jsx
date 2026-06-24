/**
 * AppShell
 * Casca raiz do sistema. Fornece UMA única camada de fundo global (BackgroundLayer),
 * compartilhada por loja e admin, e uma camada de conteúdo acima dela.
 * Stacking positivo: .bg-layer (z-index:0) atrás de .app-content-layer (z-index:1).
 * Sem body::before, sem z-index negativo, sem background-attachment.
 */
import BackgroundLayer from './BackgroundLayer.jsx';

export default function AppShell({ children }) {
  return (
    <div className="app-shell">
      <BackgroundLayer />
      <div className="app-content-layer">{children}</div>
    </div>
  );
}
