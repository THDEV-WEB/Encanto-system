/* services/loyalty/index.js — REF-LOYALTY-01. Barrel do modulo de fidelidade (fonte unica centralizada). */
export { ESTADO_VAZIO, normalizarEstado, progressoPct, faltam } from './loyalty.js';
export {
  LOYALTY_EVENT, lerCache, limparCache, sincronizar, resgatar,
  adminBuscar, adminAjustar, adminResgatar, adminLerConfig, adminSalvarConfig,
} from './loyaltyService.js';
