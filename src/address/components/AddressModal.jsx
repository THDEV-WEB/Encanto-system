/* address/components/AddressModal.jsx — REF-ADDRESS-01.
   Orquestrador do modal de endereço: overlay + cabeçalho + abas, delegando o corpo às abas
   (AddressSearch / AddressForm / AddressMap). Todo o estado/lógica vive no motor useAddressSearch; este
   componente só compõe. API pública INALTERADA (props onClose/onSelect) — o StoreApp continua usando
   igual. Cabeçalho e barra de abas são BYTE-IGUAIS ao AddressModal original; o corpo é o mesmo markup,
   agora montado a partir das abas. */
import { useAddressSearch } from '../hooks/useAddressSearch.js';
import { AddressSearch } from './AddressSearch.jsx';
import { AddressForm } from './AddressForm.jsx';
import { AddressMap } from './AddressMap.jsx';

const TABS = [
  { id: 'search', label: '🔍 Buscar endereço' },
  { id: 'cep', label: '📮 Buscar por CEP' },
  { id: 'map', label: '🗺️ Ver no mapa' },
];

export function AddressModal({ onClose, onSelect }) {
  const eng = useAddressSearch({ onSelect });

  return (
    <div className="addr-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="addr-modal" style={{ maxWidth: 500 }}>

        {/* Header */}
        <div className="addr-modal-head">
          <span className="addr-modal-title">📍 Onde receber seu pedido?</span>
          <button className="addr-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Abas */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => eng.setTab(t.id)} style={{
              flex: 1, padding: '10px 4px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-body)',
              borderBottom: eng.tab === t.id ? '2px solid var(--grape)' : '2px solid transparent',
              color: eng.tab === t.id ? 'var(--grape)' : 'var(--gray-500)',
              transition: 'all .15s',
            }}>{t.label}</button>
          ))}
        </div>

        <div className="addr-modal-body">

          {eng.tab === 'search' && (
            <AddressSearch
              query={eng.query}
              onQueryChange={eng.setQuery}
              status={eng.status}
              suggestions={eng.suggestions}
              onGPS={eng.usarGPS}
              onPick={eng.pick}
              onGoCep={() => eng.setTab('cep')}
              onGoMap={() => eng.setTab('map')}
            />
          )}

          {eng.tab === 'cep' && (
            <AddressForm
              cepQuery={eng.cepQuery}
              onCepChange={eng.mudarCep}
              status={eng.status}
              cepData={eng.cepData}
              cepNumero={eng.cepNumero}
              onNumeroChange={eng.setCepNumero}
              complemento={eng.complemento}
              onComplementoChange={eng.setComplemento}
              onConfirm={eng.confirmCEP}
            />
          )}

          {eng.tab === 'map' && (
            <AddressMap
              mapPin={eng.mapPin}
              mapAddr={eng.mapAddr}
              cepNumero={eng.cepNumero}
              onNumeroChange={eng.setCepNumero}
              onConfirm={eng.confirmMap}
              aoArrastarPino={eng.aoArrastarPino}
              aoClicarPino={eng.aoClicarPino}
            />
          )}

        </div>
      </div>
    </div>
  );
}
