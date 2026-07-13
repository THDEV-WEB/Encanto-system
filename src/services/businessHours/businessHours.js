/* services/businessHours/businessHours.js — REF-BUSINESS-HOURS-01.
   ENGINE PURO (sem React, sem IO, sem localStorage) do horario de funcionamento. Fonte UNICA da regra:
   qualquer parte do app pergunta AQUI se a loja esta aberta/fechada e o que exibir — nada de calcular
   horario espalhado por componentes. Testavel em Node (tests/business-hours.golden.mjs).

   Camadas:
     partesLocais(date)  -> extrai { dia, minutos, ymd } no fuso da loja (TIMEZONE), robusto ao fuso do device.
     avaliar(dia,min,ps) -> NUCLEO puro e deterministico: dado (dia-da-semana, minutos, periodos-de-hoje),
                            devolve o status completo. E o que os golden tests exercitam sem depender de fuso.
     getStoreStatus(date)-> conveniencia: avaliar(...partesLocais(date)) aplicando excecoes do dia. */
import { SEMANA, EXCECOES, DIAS_CURTOS, DIAS_LONGOS } from './schedule.js';

/* HH:MM local (self-contained: nao importa utils/format p/ respeitar o isolamento de camada services). */
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

/* Extrai dia-da-semana (0-6), minutos-do-dia e a data (YYYY-MM-DD) no fuso da loja. Usa Intl para nao
   depender do fuso do dispositivo — a loja abre/fecha no horario DELA. */
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo', hourCycle: 'h23',
  weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
export function partesLocais(date) {
  const p = {};
  for (const part of FMT.formatToParts(date)) p[part.type] = part.value;
  const dia = WD[p.weekday];
  const minutos = (Number(p.hour) % 24) * 60 + Number(p.minute);
  return { dia, minutos, ymd: `${p.year}-${p.month}-${p.day}` };
}

/* Periodos vigentes de um dia: excecao da data (se houver) sobrescreve o padrao semanal. */
export function periodosDoDia(dia, ymd) {
  const ex = ymd ? EXCECOES[ymd] : null;
  if (ex) {
    if (ex.fechado) return [];
    if (Array.isArray(ex.periodos)) return ex.periodos;
  }
  return SEMANA[dia] || [];
}

const rotuloDia = (offset, wd) => (offset === 0 ? 'hoje' : offset === 1 ? 'amanhã' : DIAS_CURTOS[wd]);

/* Proxima transicao fechado->aberto a partir de (dia, minutos). Se aberto agora, devolve o proximo periodo
   apos o atual (hoje a noite, ou o proximo dia com atendimento). A varredura de dias FUTUROS usa o padrao
   semanal (SEMANA); excecoes de HOJE ja entram via periodosDoDia (getStoreStatus). Ponto de extensao: quando
   feriados/datas especiais forem ativados, esta varredura passa a consultar periodosDoDia por data futura. */
function proximaAbertura(dia, minutos, hoje) {
  const futuroHoje = hoje.find((p) => p.ini > minutos);
  if (futuroHoje) return montar(0, dia, futuroHoje.ini);
  for (let d = 1; d <= 7; d++) {
    const wd = (dia + d) % 7;
    const ps = SEMANA[wd];
    if (ps && ps.length) return montar(d, wd, ps[0].ini);
  }
  return null; // inalcancavel enquanto a semana tiver ao menos 1 periodo
}
const montar = (offset, wd, min) => ({ offsetDias: offset, dia: wd, minutos: min, hora: hhmm(min), rotuloDia: rotuloDia(offset, wd) });

/* NUCLEO puro. `periodosHoje` default = padrao semanal do dia (permite testar sem fuso e sem excecoes). */
export function avaliar(dia, minutos, periodosHoje = SEMANA[dia] || []) {
  const hoje = [...periodosHoje].sort((a, b) => a.ini - b.ini);
  const atual = hoje.find((p) => minutos >= p.ini && minutos < p.fim) || null;
  const aberto = !!atual;
  const domingo = dia === 0;

  const haOutroPeriodoHoje = hoje.some((p) => p.ini > minutos);           // ainda ha periodo mais tarde HOJE
  const expedienteEncerrado = !aberto && !haOutroPeriodoHoje;             // fechado e sem retorno hoje
  const prox = proximaAbertura(dia, minutos, hoje);                       // quando abre de novo
  const fechaAs = atual ? hhmm(atual.fim) : null;                         // fim do periodo atual

  const rotuloCurto = aberto ? 'Aberto agora' : 'Fechado';
  let detalhe = null;
  if (aberto) detalhe = `Aberto até ${fechaAs}`;
  else if (prox) detalhe = `Abre ${prox.rotuloDia} às ${prox.hora}`;

  const mensagemFechado = aberto
    ? null
    : (prox ? `Estamos fechados no momento. Nosso atendimento retorna ${prox.rotuloDia} às ${prox.hora}.` : 'Estamos fechados no momento.');

  return {
    aberto,
    domingo,
    periodoAtual: atual ? { inicio: hhmm(atual.ini), fim: hhmm(atual.fim) } : null,
    fechaAs,
    proximaAbertura: prox,
    haOutroPeriodoHoje,
    expedienteEncerrado,
    rotuloCurto,
    detalhe,
    mensagemFechado,
  };
}

/* API de conveniencia p/ o app: status "agora" (ou numa data dada), ja com excecoes do dia aplicadas. */
export function getStoreStatus(date = new Date()) {
  const { dia, minutos, ymd } = partesLocais(date);
  return avaliar(dia, minutos, periodosDoDia(dia, ymd));
}

/* Grade semanal p/ exibir em "Informacoes da loja" (Sobre nos) — fonte unica: deriva de SEMANA. */
export function horarioSemanal() {
  return SEMANA.map((periodos, dia) => ({
    dia,
    nome: DIAS_LONGOS[dia],
    fechado: periodos.length === 0,
    periodos: periodos.map((p) => ({ inicio: hhmm(p.ini), fim: hhmm(p.fim) })),
  }));
}

/* ── OVERRIDE ADMINISTRATIVO (REF-BUSINESS-HOURS-02) ────────────────────────────────────────────
   Modos: AUTO segue o cronograma; OPEN/CLOSED sobrescrevem TEMPORARIAMENTE o resultado (o cronograma
   em SEMANA permanece intacto). */
export const MODOS = { AUTO: 'AUTO', OPEN: 'OPEN', CLOSED: 'CLOSED' };

/* DECISAO UNICA (pura) do estado final da loja = cronograma + override do Admin. Prioridade EXATA:
     1) OPEN   -> aberta;
     2) CLOSED -> fechada;
     3) AUTO   -> usa integralmente o resultado do cronograma (status), sem alterar NENHUMA mensagem.
   Este e o UNICO lugar do sistema que combina cronograma+override — Home, banner, checkout e Admin
   consomem este resultado (via useBusinessHours) e nunca repetem a regra. */
export function resolverOverride(status, modo = MODOS.AUTO) {
  /* Em modo FORCADO, o estado nao e mais governado pelo cronograma — entao zeramos TODOS os campos
     derivados do cronograma (fechaAs/periodoAtual/proximaAbertura/haOutroPeriodoHoje/expedienteEncerrado)
     p/ o objeto nunca carregar um "proximo horario"/"fecha as" que contradiga o override (o mesmo tipo de
     armadilha que causou o bug do banner no HB-01). Resultado sempre internamente coerente. */
  if (modo === MODOS.OPEN) {
    return {
      ...status, aberto: true, modo: MODOS.OPEN, forcado: true, origem: 'forcado-admin',
      rotuloCurto: 'Aberto agora', detalhe: null, mensagemFechado: null,
      fechaAs: null, periodoAtual: null, proximaAbertura: null,
      haOutroPeriodoHoje: false, expedienteEncerrado: false,
    };
  }
  if (modo === MODOS.CLOSED) {
    return {
      ...status, aberto: false, modo: MODOS.CLOSED, forcado: true, origem: 'forcado-admin',
      rotuloCurto: 'Fechado', detalhe: 'Fechado no momento',
      mensagemFechado: 'Estamos fechados no momento.',   // fechamento manual: sem "proximo horario" (o Admin reabre quando quiser)
      fechaAs: null, periodoAtual: null, proximaAbertura: null,
      haOutroPeriodoHoje: false, expedienteEncerrado: false,
    };
  }
  // AUTO — cronograma intacto (mensagens aprovadas preservadas byte-a-byte); so anota a origem.
  return { ...status, modo: MODOS.AUTO, forcado: false, origem: 'automatico' };
}
