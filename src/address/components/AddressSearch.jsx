/* address/components/AddressSearch.jsx — REF-ADDRESS-01 (+ REF-ADDRESS-02 · Onda 5).
   Aba "Buscar endereço" (apresentacional): campo de busca + GPS + estados (loading/sugestões/não
   encontrado/dicas). Extraído VERBATIM do bloco `tab==='search'` do AddressModal. Toda lógica (busca,
   GPS, seleção) vem por props do motor useAddressSearch; a formatação das sugestões vem de utils/. O foco
   automático no campo ao entrar na aba é preservado (o componente monta quando a aba fica ativa).

   Onda 5a: escolher uma sugestão não confirma mais direto — `pickedItem` (truthy) troca a lista de
   sugestões por AddressDetalhesEntrega (número/complemento/referência), igual às outras 2 abas (ADR §6).
   Com `pickedItem` nulo o markup do estado idle é BYTE-IGUAL ao de antes (prova: GOLDEN_MODAL_SEARCH,
   o âncora do monólito original, continua passando sem mudar uma linha).

   Onda 5b: `erro` (ADR §7) substitui os `alert()` de GPS por uma notícia inline; quando a sugestão
   escolhida não tem confiança 'exact' (achado do ADR §0.2 — match só de rua, número não confirmado pelo
   provedor), um aviso equivalente aparece na tela de detalhes, sem bloquear a confirmação. */
import { useEffect, useRef } from 'react';
import { sugestaoMain, sugestaoSub, recenteMain, recenteSub } from '../utils/addressFormat.js';
import { AddressDetalhesEntrega } from './AddressDetalhesEntrega.jsx';
import { useAuth } from '../../hooks/useAuth.js';

const AVISO_ESTILO = {
  padding: '8px 10px', background: '#FEF3C7', border: '1px solid #FDE68A',
  borderRadius: 8, fontSize: 12, color: '#92400E', lineHeight: 1.5, marginBottom: 10,
};

export function AddressSearch({
  query, onQueryChange, status, suggestions, onGPS, onPick, onGoCep, onGoMap, erro,
  pickedItem, onVoltar, numero, onNumeroChange, complemento, onComplementoChange,
  referencia, onReferenciaChange, onConfirm, recentes, onUsarRecente,
}) {
  const { isLogged } = useAuth();
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);   // foco ao entrar na aba (= efeito [tab] original)

  if (pickedItem) {
    return (
      <>
        <div style={{
          padding: '8px 12px', background: 'var(--grape-pale)', borderRadius: 8,
          fontSize: 13, color: 'var(--amarelo)', fontWeight: 600, marginBottom: 8,
        }}>
          📍 {sugestaoMain(pickedItem)}
        </div>
        <button type="button" onClick={onVoltar} style={{
          background: 'none', border: 'none', color: 'var(--grape)', fontSize: 12, fontWeight: 700,
          cursor: 'pointer', padding: 0, marginBottom: 10, fontFamily: 'var(--font-body)',
        }}>
          ← Escolher outro endereço
        </button>
        {pickedItem._confidence && pickedItem._confidence !== 'exact' && (
          <div style={AVISO_ESTILO}>⚠️ Encontramos a rua, mas não confirmamos o número exato — confira o número abaixo.</div>
        )}
        <AddressDetalhesEntrega
          numero={numero} onNumeroChange={onNumeroChange}
          complemento={complemento} onComplementoChange={onComplementoChange}
          referencia={referencia} onReferenciaChange={onReferenciaChange}
          onConfirm={onConfirm} confirmLabel="✅ Confirmar endereço" />
      </>
    );
  }

  return (
    <>
      <input ref={inputRef} className="addr-search-input"
        placeholder="Rua, número, bairro ou local..." value={query}
        onChange={e => onQueryChange(e.target.value)} />
      <button className="addr-gps-btn" onClick={onGPS}>
        {status === 'gps'
          ? <><span style={{ display: 'inline-block', animation: 'spin .8s linear infinite' }}>⏳</span> Obtendo localização...</>
          : <><span>🎯</span> Usar minha localização atual</>}
      </button>
      {erro && <div style={{ ...AVISO_ESTILO, marginTop: 10 }}>⚠️ {erro.mensagem}</div>}
      {status === 'loading' && (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--gray-400)' }}>
          <div className="spinner" style={{ margin: '0 auto 8px' }} /><p style={{ fontSize: 13 }}>Buscando...</p>
        </div>
      )}
      {status === 'found' && (
        <div className="addr-suggestions" style={{ marginTop: 10 }}>
          {suggestions.map((s, i) => {
            const main = sugestaoMain(s);
            const sub = sugestaoSub(s);
            return (
              <div key={i} className="addr-suggestion-item" onClick={() => onPick(s)}>
                <span className="addr-suggestion-icon">📍</span>
                <div className="addr-suggestion-text">
                  <div className="addr-suggestion-main">{main}</div>
                  {sub && <div className="addr-suggestion-sub">{sub}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {status === 'notfound' && (
        <div className="addr-not-found">
          <div style={{ fontSize: 28, marginBottom: 6 }}>🔍</div>
          <p><b>Endereço não encontrado.</b><br />Tente buscar pelo CEP ou marque no mapa.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <button className="addr-map-btn" onClick={onGoCep}>📮 Buscar por CEP</button>
            <button className="addr-map-btn" onClick={onGoMap}>🗺️ Ver no mapa</button>
          </div>
        </div>
      )}
      {status === 'idle' && !query && (
        <div style={{ marginTop: 12 }}>
          {isLogged && recentes && recentes.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="addr-section-label">Endereços recentes</div>
              <div className="addr-suggestions">
                {recentes.map((r) => (
                  <div key={r.id} className="addr-suggestion-item" onClick={() => onUsarRecente(r)}>
                    <span className="addr-suggestion-icon">📍</span>
                    <div className="addr-suggestion-text">
                      <div className="addr-suggestion-main">{recenteMain(r)}</div>
                      <div className="addr-suggestion-sub">{recenteSub(r)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {isLogged && (!recentes || recentes.length === 0) && (
            <p style={{ fontSize: 12.5, color: 'var(--gray-500)', margin: '0 0 12px' }}>Nenhum endereço salvo ainda.</p>
          )}
          {isLogged && recentes && recentes.length > 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--gray-500)', margin: '0 0 8px', fontWeight: 600 }}>Digite um novo endereço</p>
          )}
          <div className="addr-section-label">Dicas de busca</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.8, padding: '4px 0' }}>
            • Ex: <b>Rua das Flores, 123</b><br />
            • Ex: <b>João Schlay 77</b><br />
            • Ex: <b>Nome do bairro ou ponto de referência</b>
          </div>
        </div>
      )}
    </>
  );
}
