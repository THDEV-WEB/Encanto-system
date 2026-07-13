/* address/AddressProvider.jsx — REF-CHECKOUT-ADDRESS-01.
   FONTE UNICA do endereco de entrega em toda a loja. Antes existiam DOIS estados paralelos: o
   `deliveryAddress` do header (dominio Address) e o `<textarea>` livre do checkout (form.endereco) —
   podiam divergir e o pedido usava o do checkout. Este provider (mesmo padrao do AuthProvider) mantem
   UM unico objeto de endereco, consumido por Header, Checkout e Pedido; a edicao ocorre sempre pelo
   MESMO AddressModal (renderizado aqui uma vez), sobre o MESMO objeto. Sem sincronizacao manual, sem
   estados duplicados. Persistencia: uma unica chave JSON (encanto_delivery), com migracao dos legados
   (encanto_delivery_address/_meta da REF-ADDRESS-01). localStorage e so persistencia local — a verdade
   em runtime e este contexto. */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { AddressContext } from './AddressContext.js';
import { AddressModal } from './components/AddressModal.jsx';
import { montarEndereco, enderecoPreenchido, ENDERECO_VAZIO } from './utils/addressModel.js';
import { STORAGE_KEYS } from '../constants/storage.js';

/* Leitura tolerante do endereco persistido. Preferencia: chave unica nova; senao, migra dos legados.
   Em blocos try SEPARADOS: se a chave unica estiver corrompida, ainda cai na migracao do legado (nao
   perde o endereco antigo). */
function lerPersistido() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DELIVERY);
    if (raw) { const o = JSON.parse(raw); if (enderecoPreenchido(o)) return o; }
  } catch { /* DELIVERY corrompido: tenta o legado abaixo */ }
  try {
    const label = localStorage.getItem(STORAGE_KEYS.DELIVERY_ADDRESS);   // legado REF-ADDRESS-01
    if (label) {
      let meta = {};
      try { const m = localStorage.getItem(STORAGE_KEYS.DELIVERY_META); if (m) meta = JSON.parse(m); } catch { /* meta corrompido: ignora */ }
      return montarEndereco(label, meta);
    }
  } catch { /* legado ilegivel */ }
  return ENDERECO_VAZIO;
}

export function AddressProvider({ children }) {
  const [endereco, setEndereco] = useState(lerPersistido);
  const [modalAberto, setModalAberto] = useState(false);

  /* Consolida a migracao: grava o objeto unico na chave nova (sobrescrevendo ate uma DELIVERY corrompida)
     e SO entao remove os legados — nunca apaga o legado antes de garantir a chave unica valida. */
  useEffect(() => {
    try {
      if (endereco) localStorage.setItem(STORAGE_KEYS.DELIVERY, JSON.stringify(endereco));
      localStorage.removeItem(STORAGE_KEYS.DELIVERY_ADDRESS);
      localStorage.removeItem(STORAGE_KEYS.DELIVERY_META);
    } catch { /* storage indisponivel: segue so em memoria */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consolidacao unica no mount
  }, []);

  /* Unica forma de mudar o endereco: recebe (label, meta) do AddressModal, normaliza e persiste. */
  const selecionar = useCallback((addr, meta) => {
    const e = montarEndereco(addr, meta);
    setEndereco(e);
    try { localStorage.setItem(STORAGE_KEYS.DELIVERY, JSON.stringify(e)); } catch { /* segue em memoria */ }
    return e;
  }, []);

  const abrirModal = useCallback(() => setModalAberto(true), []);
  const fecharModal = useCallback(() => setModalAberto(false), []);

  const value = useMemo(() => ({
    endereco,
    temEndereco: enderecoPreenchido(endereco),
    selecionar,
    abrirModal,
  }), [endereco, selecionar, abrirModal]);

  return (
    <AddressContext.Provider value={value}>
      {children}
      {/* AddressModal renderizado UMA vez, no topo da loja: overlay sobre o Header ou o Checkout —
          a edicao acontece sempre pelo mesmo modal, sobre o mesmo objeto. */}
      {modalAberto && (
        <AddressModal
          onClose={fecharModal}
          onSelect={(addr, meta) => { selecionar(addr, meta); fecharModal(); }}
        />
      )}
    </AddressContext.Provider>
  );
}
