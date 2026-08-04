/* services/businessHours/schedule.js — REF-BUSINESS-HOURS-01 (papel revisto na REF-BUSINESS-HOURS-04).
   ATE A HB-03, este arquivo era a fonte UNICA do horario oficial. A partir da HB-04, a fonte oficial e o
   Supabase (settings.business_hours_schedule, via cronograma.js) — o cronograma e administravel pelo
   Admin, nao mais editado aqui. SEMANA passa a ser so o FALLBACK DE RESILIENCIA: o valor usado enquanto o
   cache de cronograma.js ainda nao sincronizou (1a pintura) ou se o Supabase estiver inacessivel — mesmo
   papel que ETA_DEFAULT tem em services/delivery/deliveryEta.js. Continua sendo o DEFAULT que os testes do
   engine usam quando chamam avaliar()/getStoreStatus() sem cronograma explicito. Camada de dados PURA:
   sem imports, sem React, sem IO — apenas estrutura declarativa; nenhum componente calcula horario
   manualmente (toda a regra vive em ./businessHours.js).

   PREPARADO PARA CRESCER (estrutura, NAO implementado agora): feriados, datas especiais, horarios
   excepcionais e fechamento temporario entram via EXCECOES (por data YYYY-MM-DD). O engine ja consulta
   as excecoes do DIA CORRENTE (getStoreStatus -> periodosDoDia), entao marcar hoje como fechado/especial
   ja funciona sem mexer nos consumidores. A varredura de "proxima abertura" sobre dias FUTUROS ainda usa
   o padrao semanal — passa a honrar excecoes futuras quando o recurso for ativado (extensao localizada no
   engine, sem tocar UI). Mantido vazio de proposito nesta entrega (o objeto persistido no Supabase ja
   reserva a chave "exceptions", tambem vazia — ver migrations/REF-BUSINESS-HOURS-04-schedule-rpc.sql). */

/* Minutos desde a meia-noite — mantem a tabela de horarios legivel. */
const hm = (h, m = 0) => h * 60 + m;

/* Fuso do estabelecimento — o status e SEMPRE calculado no horario local da loja, independente do
   fuso do dispositivo do cliente (evita "aberto/fechado" errado p/ quem viaja ou tem relogio torto). */
export const TIMEZONE = 'America/Sao_Paulo';

/* Rotulos por indice de dia (0=domingo ... 6=sabado), alinhado a Date.getDay()/Intl weekday.
   Texto voltado ao usuario final -> portugues acentuado (o resto do app tambem e acentuado). */
export const DIAS_CURTOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const DIAS_LONGOS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

/* REF-BUSINESS-HOURS-04 — chaves de dia (ASCII, sem acento) usadas pelo cronograma administravel (JSON
   persistido no Supabase e formulario do Admin). Mesmo indice 0-6 de DIAS_CURTOS/DIAS_LONGOS/Date.getDay() —
   so a REPRESENTACAO muda (nome legivel em vez de indice numerico); a ORDEM e identica. */
export const DIA_NOMES = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

/* HORARIO OFICIAL — cada dia -> lista de periodos { ini, fim } em minutos, ORDENADOS e sem sobreposicao.
   Domingo: fechado (lista vazia). Segunda: so o periodo da manha. Terca a sabado: manha + noite. */
const MANHA = { ini: hm(10), fim: hm(15) };   // 10:00 - 15:00
const NOITE = { ini: hm(17), fim: hm(22) };   // 17:00 - 22:00
export const SEMANA = [
  [],                 // 0 domingo — fechado o dia inteiro
  [MANHA],            // 1 segunda — 10:00-15:00
  [MANHA, NOITE],     // 2 terca  — 10:00-15:00 e 17:00-22:00
  [MANHA, NOITE],     // 3 quarta
  [MANHA, NOITE],     // 4 quinta
  [MANHA, NOITE],     // 5 sexta
  [MANHA, NOITE],     // 6 sabado
];

/* GANCHO DE EXTENSAO (estrutura, sem regra ativa nesta entrega): excecoes por data (chave YYYY-MM-DD)
   que sobrescrevem SEMANA[dia] para AQUELE dia. Formatos aceitos pelo engine:
     '2026-12-25': { fechado: true, motivo: 'Natal' }                       // feriado -> fechado
     '2026-12-24': { periodos: [{ ini: 600, fim: 840 }], motivo: '...' }    // horario especial
   Mantido vazio de proposito. */
export const EXCECOES = {};
