/* address/components/AddressSearch.jsx — REF-ADDRESS-01.
   Aba "Buscar endereço" (apresentacional): campo de busca + GPS + estados (loading/sugestões/não
   encontrado/dicas). Extraído VERBATIM do bloco `tab==='search'` do AddressModal. Toda lógica (busca,
   GPS, seleção) vem por props do motor useAddressSearch; a formatação das sugestões vem de utils/. O foco
   automático no campo ao entrar na aba é preservado (o componente monta quando a aba fica ativa). */
import { useEffect, useRef } from 'react';
import { sugestaoMain, sugestaoSub } from '../utils/addressFormat.js';

export function AddressSearch({ query, onQueryChange, status, suggestions, onGPS, onPick, onGoCep, onGoMap }) {
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);   // foco ao entrar na aba (= efeito [tab] original)

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
          <div className="addr-section-label">Dicas de busca</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.8, padding: '4px 0' }}>
            • Ex: <b>Rua das Flores, 123</b><br />
            • Ex: <b>João Schlay 77</b><br />
            • Ex: <b>Testo Central, Timbó</b>
          </div>
        </div>
      )}
    </>
  );
}
