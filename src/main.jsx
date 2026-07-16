import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

/* REF-BOOT-02 (instrumentacao TEMPORARIA): registra a sequencia de boot no coletor ES5 do index.html.
   Guardado: se __ENC_BOOT__ nao existir, vira no-op. Se este modulo NAO fizer parse/eval (WebView antigo),
   nenhum destes passos e registrado -> a ausencia deles JA e a evidencia (o coletor inline prova a causa). */
const boot = (code, msg) => { try { const b = window.__ENC_BOOT__; if (b && b.step) b.step(code, msg); } catch { /* noop */ } };
boot('BOOT-100', 'main.jsx avaliado (imports do bundle OK)');

/* REF-BOOT-01 Onda 2 (defesa em profundidade): captura QUALQUER erro na fase de render para que o usuario
   nunca fique preso no loader "Carregando Encanto...". Transparente quando nao ha erro. Observacao: erros
   de AVALIACAO de modulo (import) nao passam por Error Boundaries — por isso a blindagem do Intl em
   businessHours.js e a correcao PRIMARIA; este boundary cobre erros da fase de render (defesa extra). */
class RootBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidMount() { boot('BOOT-140', 'RootBoundary montou'); try { const b = window.__ENC_BOOT__; if (b && b.markMounted) b.markMounted(); } catch { /* noop */ } }
  componentDidCatch(err) { try { console.error('[Encanto] erro no bootstrap (render):', err); } catch { /* noop */ } try { const b = window.__ENC_BOOT__; if (b && b.step) b.step('BOOT-ERR-RENDER', String(err && err.message || err)); } catch { /* noop */ } }
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

boot('BOOT-110', 'antes de createRoot');
const _root = createRoot(document.getElementById('root'));
boot('BOOT-120', 'root criado');
_root.render(
  <RootBoundary><App /></RootBoundary>
);
boot('BOOT-130', 'render() chamado (aguardando commit)');
