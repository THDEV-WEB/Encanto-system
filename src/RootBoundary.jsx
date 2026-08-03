import { Component } from 'react';
import { capturarErroReact } from './lib/sentry.js'; // REF-OBS-01: no-op sem VITE_SENTRY_DSN

/* REF-BOOT-01 Onda 2 (defesa em profundidade): captura QUALQUER erro na fase de render para que o usuario
   nunca fique preso no loader inicial. Transparente quando nao ha erro. Observacao: erros de AVALIACAO
   de modulo (import) nao passam por Error Boundaries — por isso a blindagem do Intl em businessHours.js
   e a correcao PRIMARIA; este boundary cobre erros da fase de render (defesa extra).
   REF-ADMIN-04: extraido de main.jsx (era definido inline, so' consumido ali) para ser compartilhado
   tambem por admin-main.jsx — mesmo comportamento, zero mudanca, dois pontos de entrada. */
export class RootBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    try { console.error('[Encanto] erro no bootstrap (render):', err); } catch { /* noop */ }
    capturarErroReact(err, info); // REF-OBS-01: no-op sem VITE_SENTRY_DSN
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: 12, fontFamily: 'sans-serif', color: '#6B21A8', padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>😕</div>
          <strong>Não foi possível carregar o Encanto.</strong>
          <span style={{ color: '#6B7280', fontSize: 14 }}>Verifique sua conexão e tente novamente.</span>
          <button onClick={() => { try { window.location.reload(); } catch { /* noop */ } }}
            style={{ marginTop: 8, padding: '10px 22px', borderRadius: 10, border: 'none', background: '#6B21A8', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
