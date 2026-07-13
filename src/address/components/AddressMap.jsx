/* address/components/AddressMap.jsx — REF-ADDRESS-01.
   Aba "Ver no mapa": mapa Leaflet interativo + número + confirmar. Extraído do bloco `tab==='map'` do
   AddressModal. A inicialização/destruição do Leaflet e o reverse-geocode saem para services
   (mapService/geocodingService via o motor useAddressSearch) — o componente não faz `fetch` nem carrega o
   CDN à mão. Ciclo de vida correto: como este componente só existe enquanto a aba mapa está ativa, o
   efeito [] cria o mapa ao montar e o destrói ao desmontar (fecha o vazamento de listeners do original,
   que não limpava quando o Leaflet já estava carregado). Aparência/parâmetros do mapa inalterados. */
import { useEffect, useRef } from 'react';
import { carregarLeaflet, criarMapa, destruirMapa } from '../services/mapService.js';
import { formatarCoord } from '../utils/coordinates.js';
import { AddressActions } from './AddressActions.jsx';

export function AddressMap({ mapPin, mapAddr, cepNumero, onNumeroChange, onConfirm, aoArrastarPino, aoClicarPino }) {
  const mapRef = useRef(null);
  const leafRef = useRef(null);

  useEffect(() => {
    let cancelado = false;
    const init = () => {
      if (cancelado || !window.L || !mapRef.current || leafRef.current) return;   // sem init duplicado
      leafRef.current = criarMapa(mapRef.current, {
        lat: mapPin.lat, lng: mapPin.lng, zoom: 15,
        aoArrastar: aoArrastarPino, aoClicar: aoClicarPino,
      });
    };
    carregarLeaflet(init);
    return () => { cancelado = true; destruirMapa(leafRef.current); leafRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- monta/desmonta com a aba (mapPin/handlers estáveis por sessão da aba)
  }, []);

  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 8, lineHeight: 1.5 }}>
        Clique ou arraste o marcador para marcar seu endereço.
      </p>
      <div className="addr-map-container" style={{ height: 300 }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      </div>
      {mapAddr && (
        <div style={{
          marginTop: 8, padding: '8px 12px', background: 'var(--grape-pale)',
          borderRadius: 8, fontSize: 13, color: 'var(--amarelo)', fontWeight: 600,
        }}>
          📍 {mapAddr}
        </div>
      )}
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-600)', display: 'block', margin: '10px 0 4px' }}>
        Número da residência
      </label>
      <input className="addr-search-input" style={{ marginBottom: 10 }}
        placeholder="Ex: 77" value={cepNumero}
        onChange={e => onNumeroChange(e.target.value)} />
      <AddressActions onConfirm={onConfirm} label="✅ Confirmar localização no mapa" />
      <p style={{ fontSize: 10, color: 'var(--gray-400)', textAlign: 'center', marginTop: 6 }}>
        Lat: {formatarCoord(mapPin.lat)} · Lng: {formatarCoord(mapPin.lng)}
      </p>
    </>
  );
}
