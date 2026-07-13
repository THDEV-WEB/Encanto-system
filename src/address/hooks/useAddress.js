/* address/hooks/useAddress.js — REF-ADDRESS-01.
   Hook APP-LEVEL do endereço de entrega: dono do "endereço atual" + coordenadas + persistência
   (sincronização com o localStorage). Antes essa lógica vivia espalhada no StoreApp (useState inicial +
   três localStorage.setItem no onSelect + import de STORAGE_KEYS). Consolidá-la aqui remove a
   responsabilidade de endereço do StoreApp, que passa a só consumir o domínio.

   O localStorage é apenas persistência local do que o cliente escolheu (mesmas chaves de antes) — não é
   fonte de verdade de negócio. A lógica de escrita é BYTE-IGUAL ao onSelect original (grava o endereço;
   grava o meta só quando há lat). A leitura do meta é tolerante (JSON inválido nunca derruba o mount —
   caminho novo, por isso protegido). */

import { useState, useCallback } from 'react';
import { STORAGE_KEYS } from '../../constants/storage.js';

/* Leitura tolerante do meta persistido (coordenadas). */
function lerCoordenadas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DELIVERY_META);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function useAddress() {
  const [endereco, setEndereco] = useState(() => localStorage.getItem(STORAGE_KEYS.DELIVERY_ADDRESS) || '');
  const [coordenadas, setCoordenadas] = useState(lerCoordenadas);

  /* Persiste a seleção — mesma lógica do onSelect original do StoreApp (endereço sempre; meta só com lat). */
  const selecionar = useCallback((addr, meta) => {
    setEndereco(addr);
    localStorage.setItem(STORAGE_KEYS.DELIVERY_ADDRESS, addr);
    if (meta && meta.lat) {
      localStorage.setItem(STORAGE_KEYS.DELIVERY_META, JSON.stringify(meta));
      setCoordenadas(meta);
    }
  }, []);

  return { endereco, coordenadas, selecionar };
}
