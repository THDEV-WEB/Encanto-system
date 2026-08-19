/* hooks/useStoreConfigStatus.js — REF-STORE-ONBOARD-01 · Onda 1.
   Status "tem configuração própria ou está usando o padrão compartilhado" para horário/entrega da loja
   ATIVA do Admin. Puramente informativo (alimenta o banner ✅/❌ em AdminBusinessHours/AdminTaxaEntrega,
   mesmo espírito de StatusLocalizacaoLoja em AdminTaxaEntrega.jsx) — não é a fonte de verdade do
   horário/entrega em si, só sinaliza se o valor exibido é próprio ou herdado. Falha silenciosa
   (tem_horario_config/tem_delivery_config ficam null): as telas tratam null como "status desconhecido"
   e simplesmente não mostram o banner, nunca bloqueiam a edição normal. */
import { useState, useEffect, useCallback } from 'react';
import { DS } from '../services/DataService.js';

export function useStoreConfigStatus() {
  const [status, setStatus] = useState(null);

  const refresh = useCallback(async () => {
    try { setStatus(await DS.getStoreConfigStatus()); }
    catch { /* ignore -- telas tratam null como status desconhecido */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...(status || { tem_horario_config: null, tem_delivery_config: null }), refresh };
}
