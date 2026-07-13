/* services/businessHours/index.js — REF-BUSINESS-HOURS-01. API publica do modulo de horario.
   Ponto UNICO de importacao p/ o app: os consumidores usam SEMPRE este barrel (nunca alcancam
   schedule.js/businessHours.js direto), mantendo a regra encapsulada e o import estavel. */
export { getStoreStatus, avaliar, partesLocais, periodosDoDia, horarioSemanal } from './businessHours.js';
export { TIMEZONE, SEMANA, DIAS_CURTOS, DIAS_LONGOS, EXCECOES } from './schedule.js';
