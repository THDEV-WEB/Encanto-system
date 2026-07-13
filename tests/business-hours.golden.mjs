/* tests/business-hours.golden.mjs — REF-BUSINESS-HOURS-01. Roda: node tests/business-hours.golden.mjs
   GOLDEN do horario de funcionamento. Congela a regra do engine PURO (services/businessHours) contra
   TODOS os casos do escopo: segunda, terca-a-sabado, o intervalo 15h-17h, domingo e a virada de dia.

   Duas camadas, sem banco/rede/React/localStorage:
     (A) NUCLEO deterministico: avaliar(dia, minutos) — independe de fuso; exercita aberto/fechado,
         periodo atual, proximo horario, "ha outro periodo hoje", "expediente encerrado" e as mensagens.
     (B) FUSO da loja: getStoreStatus(date)/partesLocais(date) com instantes UTC fixos, provando que o
         status e calculado no horario de America/Sao_Paulo, nao no fuso do dispositivo. */
import assert from 'node:assert/strict';
import { avaliar, getStoreStatus, partesLocais, periodosDoDia, horarioSemanal, resolverOverride, MODOS } from '../src/services/businessHours/index.js';
import { SEMANA } from '../src/services/businessHours/schedule.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };
const m = (h, mm = 0) => h * 60 + mm;
/* Indices de dia: 0=domingo 1=segunda 2=terca 3=quarta 4=quinta 5=sexta 6=sabado */
const [DOM, SEG, TER, SAB] = [0, 1, 2, 6];

console.error('— (A) NUCLEO: avaliar(dia, minutos)');

/* ── SEGUNDA (so periodo da manha 10:00-15:00) ── */
check('SEG 09:30 -> fechado, abre hoje 10:00', () => {
  const s = avaliar(SEG, m(9, 30));
  assert.equal(s.aberto, false);
  assert.equal(s.proximaAbertura.rotuloDia, 'hoje');
  assert.equal(s.proximaAbertura.hora, '10:00');
  assert.equal(s.haOutroPeriodoHoje, true);
  assert.equal(s.expedienteEncerrado, false);
});
check('SEG 11:00 -> aberto, fecha 15:00', () => {
  const s = avaliar(SEG, m(11));
  assert.equal(s.aberto, true);
  assert.equal(s.fechaAs, '15:00');
  assert.equal(s.detalhe, 'Aberto até 15:00');
  assert.deepEqual(s.periodoAtual, { inicio: '10:00', fim: '15:00' });
});
check('SEG 16:00 -> fechado, expediente encerrado, abre terca 10:00', () => {
  const s = avaliar(SEG, m(16));
  assert.equal(s.aberto, false);
  assert.equal(s.haOutroPeriodoHoje, false);
  assert.equal(s.expedienteEncerrado, true);
  assert.equal(s.proximaAbertura.dia, TER);      // segunda nao tem noite -> proxima e terca
  assert.equal(s.proximaAbertura.hora, '10:00');
  assert.equal(s.proximaAbertura.offsetDias, 1);
});

/* ── TERCA A SABADO (manha 10-15 + noite 17-22) — casos exemplificados na terca ── */
check('TER 09:00 -> fechado, abre hoje 10:00', () => {
  const s = avaliar(TER, m(9));
  assert.equal(s.aberto, false);
  assert.equal(s.proximaAbertura.rotuloDia, 'hoje');
  assert.equal(s.proximaAbertura.hora, '10:00');
});
check('TER 11:30 -> aberto, fecha 15:00', () => {
  const s = avaliar(TER, m(11, 30));
  assert.equal(s.aberto, true);
  assert.equal(s.fechaAs, '15:00');
});
check('TER 15:20 (intervalo) -> fechado, retorna hoje 17:00, NAO encerrado', () => {
  const s = avaliar(TER, m(15, 20));
  assert.equal(s.aberto, false);
  assert.equal(s.haOutroPeriodoHoje, true);
  assert.equal(s.expedienteEncerrado, false);
  assert.equal(s.proximaAbertura.rotuloDia, 'hoje');
  assert.equal(s.proximaAbertura.hora, '17:00');
  assert.equal(s.mensagemFechado, 'Estamos fechados no momento. Nosso atendimento retorna hoje às 17:00.');
});
check('TER 18:40 -> aberto, fecha 22:00', () => {
  const s = avaliar(TER, m(18, 40));
  assert.equal(s.aberto, true);
  assert.equal(s.fechaAs, '22:00');
  assert.equal(s.detalhe, 'Aberto até 22:00');
});
check('TER 22:30 -> fechado, encerrado, abre amanha 10:00', () => {
  const s = avaliar(TER, m(22, 30));
  assert.equal(s.aberto, false);
  assert.equal(s.expedienteEncerrado, true);
  assert.equal(s.proximaAbertura.dia, 3);        // quarta
  assert.equal(s.proximaAbertura.offsetDias, 1);
  assert.equal(s.proximaAbertura.rotuloDia, 'amanhã');
  assert.equal(s.proximaAbertura.hora, '10:00');
});

/* ── DOMINGO (fechado o dia inteiro) ── */
check('DOM 12:00 -> fechado, domingo=true, proxima segunda 10:00', () => {
  const s = avaliar(DOM, m(12));
  assert.equal(s.aberto, false);
  assert.equal(s.domingo, true);
  assert.equal(s.haOutroPeriodoHoje, false);
  assert.equal(s.expedienteEncerrado, true);
  assert.equal(s.proximaAbertura.dia, SEG);
  assert.equal(s.proximaAbertura.hora, '10:00');
});

/* ── VIRADA DE DIA / nomeacao de dia (offset >= 2) ── */
check('SAB 22:30 -> fechado, proxima SEGUNDA 10:00 (pula domingo)', () => {
  const s = avaliar(SAB, m(22, 30));
  assert.equal(s.aberto, false);
  assert.equal(s.proximaAbertura.dia, SEG);
  assert.equal(s.proximaAbertura.offsetDias, 2);
  assert.equal(s.proximaAbertura.rotuloDia, 'segunda');
  assert.equal(s.proximaAbertura.hora, '10:00');
});

/* ── BORDAS exatas (inclusivo no inicio, exclusivo no fim) ── */
check('SEG 10:00 exato -> aberto (>= inicio)', () => assert.equal(avaliar(SEG, m(10)).aberto, true));
check('SEG 15:00 exato -> fechado (< fim)', () => assert.equal(avaliar(SEG, m(15)).aberto, false));
check('TER 15:00 exato -> fechado mas retorna hoje 17:00 (nao encerrado)', () => {
  const s = avaliar(TER, m(15));
  assert.equal(s.aberto, false);
  assert.equal(s.expedienteEncerrado, false);
  assert.equal(s.proximaAbertura.hora, '17:00');
});
check('TER 17:00 exato -> aberto', () => assert.equal(avaliar(TER, m(17)).aberto, true));
check('TER 22:00 exato -> fechado, encerrado', () => {
  const s = avaliar(TER, m(22));
  assert.equal(s.aberto, false);
  assert.equal(s.expedienteEncerrado, true);
});

/* ── periodosDoDia: sem excecao cai no padrao semanal (gancho de feriados pronto, inativo) ── */
check('periodosDoDia sem excecao = SEMANA[dia]', () => {
  assert.deepEqual(periodosDoDia(DOM, '2099-01-01'), []);
  assert.deepEqual(periodosDoDia(TER, '2099-01-01'), SEMANA[TER]);
});

/* ── horarioSemanal: grade p/ "Informacoes da loja" ── */
check('horarioSemanal: 7 dias, domingo fechado, segunda 1 periodo, terca 2', () => {
  const g = horarioSemanal();
  assert.equal(g.length, 7);
  assert.equal(g[DOM].fechado, true);
  assert.equal(g[SEG].periodos.length, 1);
  assert.deepEqual(g[TER].periodos, [{ inicio: '10:00', fim: '15:00' }, { inicio: '17:00', fim: '22:00' }]);
});

console.error('— (B) FUSO da loja (America/Sao_Paulo, UTC-3): getStoreStatus/partesLocais com instantes UTC');
/* SP = UTC-3 (sem horario de verao desde 2019). Instante UTC = hora-SP + 3.
   Semana ancora: 2026-07-06 (segunda) ... 2026-07-11 (sabado), 2026-07-12 (domingo). */
const utc = (day, hh, mm = 0) => new Date(Date.UTC(2026, 6, day, hh + 3, mm));
check('partesLocais mapeia p/ horario da loja (SEG 11:00)', () => {
  const p = partesLocais(utc(6, 11, 0));
  assert.equal(p.dia, SEG);
  assert.equal(p.minutos, m(11));
  assert.equal(p.ymd, '2026-07-06');
});
check('getStoreStatus SEG 11:00 SP -> aberto', () => assert.equal(getStoreStatus(utc(6, 11)).aberto, true));
check('getStoreStatus TER 15:20 SP -> fechado, retorna hoje 17:00', () => {
  const s = getStoreStatus(utc(7, 15, 20));
  assert.equal(s.aberto, false);
  assert.equal(s.proximaAbertura.hora, '17:00');
  assert.equal(s.proximaAbertura.rotuloDia, 'hoje');
});
check('getStoreStatus virada TER 22:30 SP (UTC rola p/ o dia seguinte) -> fechado, amanha 10:00', () => {
  const p = partesLocais(utc(7, 22, 30));     // UTC 2026-07-08T01:30, mas SP 2026-07-07 22:30
  assert.equal(p.dia, TER);
  assert.equal(p.ymd, '2026-07-07');
  const s = getStoreStatus(utc(7, 22, 30));
  assert.equal(s.aberto, false);
  assert.equal(s.expedienteEncerrado, true);
  assert.equal(s.proximaAbertura.rotuloDia, 'amanhã');
});
check('getStoreStatus DOM 12:00 SP -> fechado, domingo', () => {
  const s = getStoreStatus(utc(12, 12));
  assert.equal(s.aberto, false);
  assert.equal(s.domingo, true);
});

console.error('— (C) OVERRIDE do Admin: resolverOverride(status, modo) — fonte unica de decisao (REF-BUSINESS-HOURS-02)');
const seg16 = avaliar(SEG, m(16));   // AUTO -> fechado
const ter11 = avaliar(TER, m(11));   // AUTO -> aberto
const dom12 = avaliar(DOM, m(12));   // AUTO -> fechado

/* Casos OBRIGATORIOS do escopo */
check('AUTO   Seg 16:00 -> fechada', () => assert.equal(resolverOverride(seg16, MODOS.AUTO).aberto, false));
check('OPEN   Seg 16:00 -> aberta',  () => assert.equal(resolverOverride(seg16, MODOS.OPEN).aberto, true));
check('CLOSED Ter 11:00 -> fechada', () => assert.equal(resolverOverride(ter11, MODOS.CLOSED).aberto, false));
check('AUTO   Ter 11:00 -> aberta',  () => assert.equal(resolverOverride(ter11, MODOS.AUTO).aberto, true));
check('Domingo + OPEN   -> aberta',  () => assert.equal(resolverOverride(dom12, MODOS.OPEN).aberto, true));
check('Domingo + AUTO   -> fechada', () => assert.equal(resolverOverride(dom12, MODOS.AUTO).aberto, false));
check('Domingo + CLOSED -> fechada', () => assert.equal(resolverOverride(dom12, MODOS.CLOSED).aberto, false));

/* Prioridade + coerencia dos campos */
check('AUTO preserva o status do cronograma (mensagens aprovadas intactas)', () => {
  const r = resolverOverride(ter11, MODOS.AUTO);
  assert.equal(r.forcado, false);
  assert.equal(r.origem, 'automatico');
  assert.equal(r.detalhe, ter11.detalhe);                 // "Aberto até 15:00" intacto
  assert.equal(r.mensagemFechado, ter11.mensagemFechado); // null (aberto) intacto
});
check('OPEN fora do cronograma: aberta, forcada, sem mensagemFechado', () => {
  const r = resolverOverride(seg16, MODOS.OPEN);
  assert.equal(r.aberto, true); assert.equal(r.forcado, true);
  assert.equal(r.modo, 'OPEN'); assert.equal(r.origem, 'forcado-admin');
  assert.equal(r.rotuloCurto, 'Aberto agora');
  assert.equal(r.mensagemFechado, null);
});
check('CLOSED dentro do cronograma: fechada, forcada, mensagem generica (sem proximo horario)', () => {
  const r = resolverOverride(ter11, MODOS.CLOSED);
  assert.equal(r.aberto, false); assert.equal(r.forcado, true);
  assert.equal(r.modo, 'CLOSED'); assert.equal(r.origem, 'forcado-admin');
  assert.equal(r.rotuloCurto, 'Fechado');
  assert.equal(r.detalhe, 'Fechado no momento');
  assert.equal(r.mensagemFechado, 'Estamos fechados no momento.');
});
check('modo ausente/desconhecido -> tratado como AUTO', () => {
  assert.equal(resolverOverride(ter11).aberto, ter11.aberto);
  assert.equal(resolverOverride(ter11, 'xyz').modo, 'AUTO');
});
check('estado FORCADO nao carrega campos de cronograma contraditorios (coerencia interna)', () => {
  const o = resolverOverride(seg16, MODOS.OPEN);   // cronograma: fechado/encerrado -> forcado aberto
  assert.equal(o.proximaAbertura, null);
  assert.equal(o.fechaAs, null);
  assert.equal(o.expedienteEncerrado, false);
  assert.equal(o.haOutroPeriodoHoje, false);
  const c = resolverOverride(ter11, MODOS.CLOSED); // cronograma: aberto -> forcado fechado
  assert.equal(c.proximaAbertura, null);
  assert.equal(c.periodoAtual, null);
  assert.equal(c.fechaAs, null);
  assert.equal(c.haOutroPeriodoHoje, false);
});

console.log(fail === 0
  ? '\nOK business-hours.golden — engine + override congelados (cronograma + AUTO/OPEN/CLOSED, fonte unica)'
  : `\nFALHA business-hours.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
