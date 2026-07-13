/* services/loyalty/loyalty.js — REF-LOYALTY-01. Nucleo PURO da fidelidade (sem React/IO/Supabase).
   Normaliza o payload de get_my_loyalty/admin_* num formato estavel e deriva o que a UI precisa.
   A FONTE DE VERDADE e o Supabase (RPCs); aqui so ha formatacao/derivacao deterministica. */

export const ESTADO_VAZIO = Object.freeze({
  enabled: true,
  stamps: 0,
  required: 10,
  discount: 50,
  rewardAvailable: false,
  rewardsRedeemed: 0,
  hasAccount: false,
});

const inteiro = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

/* Converte o jsonb do RPC (snake_case) no estado canonico (camelCase) com defaults seguros. */
export function normalizarEstado(raw) {
  if (!raw || typeof raw !== 'object') return { ...ESTADO_VAZIO };
  const required = Math.max(1, inteiro(raw.required, ESTADO_VAZIO.required));
  const stamps = Math.max(0, inteiro(raw.stamps, 0));
  return {
    enabled: raw.enabled !== false,
    stamps,
    required,
    discount: Math.max(0, inteiro(raw.discount, ESTADO_VAZIO.discount)),
    rewardAvailable: (typeof raw.reward_available === 'boolean') ? raw.reward_available : (stamps >= required),
    rewardsRedeemed: Math.max(0, inteiro(raw.rewards_redeemed, 0)),
    hasAccount: raw.has_account === true,
  };
}

/* Derivacoes de UI (puras). */
export const progressoPct = (stamps, required) => required > 0 ? Math.min(100, Math.round((stamps / required) * 100)) : 0;
export const faltam       = (stamps, required) => Math.max(0, required - stamps);
