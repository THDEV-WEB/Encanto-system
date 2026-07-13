/* services/businessHours/index.js — REF-BUSINESS-HOURS-01/02. API publica do modulo de horario.
   Ponto UNICO de importacao p/ o app: os consumidores usam SEMPRE este barrel (nunca alcancam
   schedule.js/businessHours.js/override.js direto), mantendo a regra encapsulada e o import estavel. */
export { getStoreStatus, avaliar, partesLocais, periodosDoDia, horarioSemanal, resolverOverride, MODOS } from './businessHours.js';
export { lerModo, definirModo, MODE_EVENT } from './override.js';
export { TIMEZONE, SEMANA, DIAS_CURTOS, DIAS_LONGOS, EXCECOES } from './schedule.js';
