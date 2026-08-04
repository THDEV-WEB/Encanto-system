/* services/businessHours/scheduleForm.js — REF-BUSINESS-HOURS-04.
   Logica PURA do formulario do Admin (transformacao + validacao) — separada de AdminBusinessHours.jsx para
   ser testavel em Node sem montar React (mesmo espirito de services/businessHours/businessHours.js: regra
   de negocio pura, componente so renderiza). Espelha, no cliente, a MESMA validacao que
   set_business_hours_schedule (RPC) roda no servidor — o servidor SEMPRE revalida (nunca confia so no
   cliente), mas o cliente da feedback imediato por periodo sem round-trip. */
import { DIA_NOMES } from './schedule.js';

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/* doc.schedule (persistido, sem _id) -> estado local EDITAVEL (com _id sintetico p/ key/React). `nextId` e
   injetado pelo chamador (contador estavel entre renders, ex.: useRef no componente). */
export function paraEditavel(schedule, nextId) {
  const out = {};
  for (const nome of DIA_NOMES) {
    const dia = schedule?.[nome];
    out[nome] = {
      fechado: dia ? !!dia.fechado : true,
      periodos: (dia && Array.isArray(dia.periodos) ? dia.periodos : []).map((p) => ({ _id: nextId(), ini: p.ini, fim: p.fim })),
    };
  }
  return out;
}

/* estado local EDITAVEL -> forma CANONICA p/ salvar/comparar (sem _id, periodos ordenados por inicio,
   filtra periodos com horario mal formatado — a validacao/erro em tela ja cobriu esse caso antes do Salvar
   ficar habilitado; aqui e so defesa em profundidade). */
export function paraPersistir(dias) {
  const out = {};
  for (const nome of DIA_NOMES) {
    const periodos = dias[nome].periodos
      .filter((p) => HHMM_RE.test(p.ini) && HHMM_RE.test(p.fim))
      .slice()
      .sort((a, b) => (a.ini < b.ini ? -1 : a.ini > b.ini ? 1 : 0))
      .map((p) => ({ ini: p.ini, fim: p.fim }));
    out[nome] = { fechado: !!dias[nome].fechado, periodos };
  }
  return out;
}

/* Validacao de UM dia: horario invalido, fim<=inicio, duplicado, sobreposto. Retorna Map(_id -> mensagem),
   so os periodos com problema entram no mapa (mesmas regras do RPC set_business_hours_schedule). */
export function validarDia(periodos) {
  const erros = new Map();
  const vistos = new Set();
  const validos = [];
  periodos.forEach((p) => {
    if (!HHMM_RE.test(p.ini) || !HHMM_RE.test(p.fim)) { erros.set(p._id, 'Horário inválido'); return; }
    const iniMin = toMin(p.ini), fimMin = toMin(p.fim);
    if (fimMin <= iniMin) { erros.set(p._id, 'Fim deve ser depois do início'); return; }
    const chave = `${p.ini}-${p.fim}`;
    if (vistos.has(chave)) { erros.set(p._id, 'Período duplicado'); return; }
    vistos.add(chave);
    validos.push({ _id: p._id, ini: iniMin, fim: fimMin });
  });
  validos.sort((a, b) => a.ini - b.ini);
  for (let i = 1; i < validos.length; i++) {
    if (validos[i].ini < validos[i - 1].fim) erros.set(validos[i]._id, 'Período sobreposto');
  }
  return erros;
}

/* "Copiar horários para..." — replica o dia de ORIGEM (fechado + periodos) para os dias em `alvo` (Set de
   nomes). Pura: devolve o novo objeto `dias`, nao muta o recebido. `nextId` gera _id novos para as copias
   (cada periodo copiado e uma entidade local independente — editar um nao deve afetar o outro). */
export function aplicarCopiaHorarios(dias, origemNome, alvo, nextId) {
  const origem = dias[origemNome];
  const next = { ...dias };
  alvo.forEach((d) => {
    next[d] = { fechado: origem.fechado, periodos: origem.periodos.map((p) => ({ _id: nextId(), ini: p.ini, fim: p.fim })) };
  });
  return next;
}
