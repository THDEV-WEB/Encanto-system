/* hooks/useLoyalty.js — REF-LOYALTY-01. Estado reativo da fidelidade do PROPRIO cliente.
   Pinta na hora pelo cache (por customer_id) e PUXA o oficial (get_my_loyalty) no mount, ao focar a
   aba, e quando LOYALTY_EVENT dispara (ex.: apos finalizar um pedido) -> re-sincroniza do servidor
   (nunca le cache velho). A fonte de verdade e sempre o Supabase; o cache local so evita flash.
   Guarda de obsolescencia por-execucao: um get_my_loyalty em voo do cliente A nunca pinta sobre o
   cliente B (compara o customerId capturado com o atual) nem apos desmontar. */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth.js';
import { ESTADO_VAZIO, lerCache, limparCache, sincronizar, resgatar, LOYALTY_EVENT } from '../services/loyalty/index.js';

export function useLoyalty() {
  const { isLogged, customer } = useAuth();
  const customerId = customer?.id ?? null;
  const [estado, setEstado] = useState(() => (customerId ? lerCache(customerId) : { ...ESTADO_VAZIO }));

  const montadoRef = useRef(true);
  const customerIdRef = useRef(customerId);
  customerIdRef.current = customerId;   // sempre reflete o cliente ATUAL (para a guarda de obsolescencia)

  // ciclo de vida real do componente (nao por-efeito): so vira false no unmount
  useEffect(() => { montadoRef.current = true; return () => { montadoRef.current = false; }; }, []);

  const puxar = useCallback(() => {
    if (!isLogged || !customerId) { setEstado({ ...ESTADO_VAZIO }); return; }
    const cid = customerId;   // captura: so aplica se ainda for o cliente atual e o componente vivo
    sincronizar(cid).then((e) => { if (montadoRef.current && customerIdRef.current === cid) setEstado(e); });
  }, [isLogged, customerId]);

  useEffect(() => {
    // pintura imediata pelo cache do proprio cliente; ao deslogar, limpa o cache e zera o estado
    if (customerId) setEstado(lerCache(customerId));
    else { limparCache(); setEstado({ ...ESTADO_VAZIO }); }
    puxar();
    const onEvento = () => puxar();                 // re-sincroniza do servidor (nao le cache velho)
    const onFoco = () => puxar();
    window.addEventListener(LOYALTY_EVENT, onEvento);
    window.addEventListener('focus', onFoco);
    document.addEventListener('visibilitychange', onFoco);
    return () => {
      window.removeEventListener(LOYALTY_EVENT, onEvento);
      window.removeEventListener('focus', onFoco);
      document.removeEventListener('visibilitychange', onFoco);
    };
  }, [puxar, customerId]);

  const resgatarRecompensa = useCallback(async () => {
    if (!customerId) return { ok: false, error: 'nao autenticado' };
    const cid = customerId;
    const r = await resgatar(cid);
    if (r.ok && montadoRef.current && customerIdRef.current === cid) setEstado(r.estado);
    return r;
  }, [customerId]);

  return { estado, isLogged, temCadastro: !!customerId, refresh: puxar, resgatar: resgatarRecompensa };
}
