/* services/businessHours/index.js — REF-BUSINESS-HOURS-01/02/04. API publica do modulo de horario.
   Ponto UNICO de importacao p/ o app: os consumidores usam SEMPRE este barrel (nunca alcancam
   schedule.js/businessHours.js/override.js/cronograma.js direto), mantendo a regra encapsulada e o import
   estavel. */
export { getStoreStatus, avaliar, partesLocais, periodosDoDia, horarioSemanal, resolverOverride, semanaFromSchedule, MODOS } from './businessHours.js';
export { lerModoCache, sincronizarModo, definirModo, MODE_EVENT } from './override.js';
export { lerCronogramaCache, sincronizarCronograma, definirCronograma, CRONOGRAMA_PADRAO, SCHEDULE_EVENT } from './cronograma.js';
export { TIMEZONE, SEMANA, DIAS_CURTOS, DIAS_LONGOS, DIA_NOMES, EXCECOES } from './schedule.js';
