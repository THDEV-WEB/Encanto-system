/* tests/business-hours-schedule.golden.mjs — REF-BUSINESS-HOURS-04. Roda: node tests/business-hours-schedule.golden.mjs
   GOLDEN da logica PURA do cronograma administravel: services/businessHours/scheduleForm.js (formulario do
   Admin: transformar/validar/copiar) e services/businessHours/businessHours.js (semanaFromSchedule, ja
   coberto em profundidade por business-hours.golden.mjs — aqui so o que e especifico do FORMULARIO).
   Sem banco/rede/React: exercita as MESMAS regras que o RPC set_business_hours_schedule reaplica no
   servidor (fim>inicio, sem sobreposicao, sem duplicata, HH:MM 00:00-23:59), a transformacao ida-e-volta
   (documento persistido <-> estado editavel) e a funcionalidade de "copiar horarios para...". */
import assert from 'node:assert/strict';
import { paraEditavel, paraPersistir, validarDia, aplicarCopiaHorarios } from '../src/services/businessHours/scheduleForm.js';
import { DIA_NOMES } from '../src/services/businessHours/schedule.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

let seq = 0;
const nextId = () => (seq += 1);

/* Documento CANONICO de referencia — mesmo shape que get_business_hours_schedule devolve. */
const DOC = {
  version: 1,
  timezone: 'America/Sao_Paulo',
  schedule: {
    domingo: { fechado: true, periodos: [] },
    segunda: { fechado: false, periodos: [{ ini: '10:00', fim: '15:00' }] },
    terca: { fechado: false, periodos: [{ ini: '10:00', fim: '15:00' }, { ini: '17:00', fim: '22:00' }] },
    quarta: { fechado: false, periodos: [{ ini: '10:00', fim: '15:00' }, { ini: '17:00', fim: '22:00' }] },
    quinta: { fechado: false, periodos: [{ ini: '10:00', fim: '15:00' }, { ini: '17:00', fim: '22:00' }] },
    sexta: { fechado: false, periodos: [{ ini: '10:00', fim: '15:00' }, { ini: '17:00', fim: '22:00' }] },
    sabado: { fechado: false, periodos: [{ ini: '10:00', fim: '15:00' }, { ini: '17:00', fim: '22:00' }] },
  },
  exceptions: {},
};

console.error('— (A) CARREGAR cronograma: paraEditavel (documento persistido -> estado editavel do form)');

check('paraEditavel: 7 dias, cada periodo ganha um _id local', () => {
  const dias = paraEditavel(DOC.schedule, nextId);
  assert.equal(Object.keys(dias).length, 7);
  assert.equal(dias.domingo.fechado, true);
  assert.deepEqual(dias.domingo.periodos, []);
  assert.equal(dias.terca.periodos.length, 2);
  assert.ok(Number.isInteger(dias.terca.periodos[0]._id));
  assert.equal(dias.terca.periodos[0].ini, '10:00');
});
check('paraEditavel: dia ausente no documento vira fechado (defensivo, mesmo comportamento do engine)', () => {
  const dias = paraEditavel({ segunda: DOC.schedule.segunda }, nextId);
  assert.equal(dias.segunda.fechado, false);
  assert.equal(dias.domingo.fechado, true); // ausente -> fechado, nunca "aberto por omissao"
  assert.deepEqual(dias.domingo.periodos, []);
});

console.error('— (B) SALVAR cronograma: paraPersistir (estado editavel -> documento canonico p/ enviar ao RPC)');

check('paraPersistir: remove _id, ordena periodos por inicio', () => {
  const dias = paraEditavel(DOC.schedule, nextId);
  // embaralha a ordem local (simula o admin adicionando fora de ordem)
  dias.terca.periodos = [dias.terca.periodos[1], dias.terca.periodos[0]];
  const persistido = paraPersistir(dias);
  assert.deepEqual(persistido.terca.periodos, [{ ini: '10:00', fim: '15:00' }, { ini: '17:00', fim: '22:00' }]);
  assert.deepEqual(Object.keys(persistido.terca.periodos[0]).sort(), ['fim', 'ini']); // sem _id (interno do form, nao vai ao servidor)
});
check('paraPersistir: ida-e-volta preserva o documento (compatibilidade round-trip)', () => {
  const dias = paraEditavel(DOC.schedule, nextId);
  assert.deepEqual(paraPersistir(dias), DOC.schedule);
});
check('paraPersistir: dia aberto SEM periodos persiste como aberto com lista vazia (nao inventa horario)', () => {
  const dias = paraEditavel({ segunda: { fechado: false, periodos: [] } }, nextId);
  const persistido = paraPersistir(dias);
  assert.equal(persistido.segunda.fechado, false);
  assert.deepEqual(persistido.segunda.periodos, []);
});

console.error('— (C) VALIDAÇÃO por dia — mesmas regras do RPC set_business_hours_schedule');

check('validarDia: periodo valido -> sem erro', () => {
  const periodos = [{ _id: 1, ini: '10:00', fim: '15:00' }];
  assert.equal(validarDia(periodos).size, 0);
});
check('validarDia: fim <= inicio -> erro', () => {
  const periodos = [{ _id: 1, ini: '15:00', fim: '10:00' }];
  const erros = validarDia(periodos);
  assert.equal(erros.get(1), 'Fim deve ser depois do início');
});
check('validarDia: fim === inicio -> erro (periodo vazio)', () => {
  const periodos = [{ _id: 1, ini: '10:00', fim: '10:00' }];
  assert.ok(validarDia(periodos).has(1));
});
check('validarDia: horario fora de 00:00-23:59 -> erro', () => {
  const periodos = [{ _id: 1, ini: '24:00', fim: '25:00' }];
  assert.equal(validarDia(periodos).get(1), 'Horário inválido');
});
check('validarDia: dois periodos sobrepostos -> erro no segundo', () => {
  const periodos = [{ _id: 1, ini: '10:00', fim: '15:00' }, { _id: 2, ini: '14:00', fim: '18:00' }];
  const erros = validarDia(periodos);
  assert.equal(erros.get(2), 'Período sobreposto');
  assert.ok(!erros.has(1));
});
check('validarDia: periodos duplicados (identicos) -> erro', () => {
  const periodos = [{ _id: 1, ini: '10:00', fim: '15:00' }, { _id: 2, ini: '10:00', fim: '15:00' }];
  const erros = validarDia(periodos);
  assert.equal(erros.get(2), 'Período duplicado');
});
check('validarDia: periodos que se TOCAM (10-14 e 14-18) sao permitidos (nao e sobreposicao)', () => {
  const periodos = [{ _id: 1, ini: '10:00', fim: '14:00' }, { _id: 2, ini: '14:00', fim: '18:00' }];
  assert.equal(validarDia(periodos).size, 0);
});
check('validarDia: TRES periodos no mesmo dia, todos validos e ordenados fora de sequencia -> sem erro', () => {
  const periodos = [
    { _id: 1, ini: '20:00', fim: '23:00' },
    { _id: 2, ini: '10:00', fim: '14:00' },
    { _id: 3, ini: '15:00', fim: '19:00' },
  ];
  assert.equal(validarDia(periodos).size, 0);
});
check('validarDia: lista vazia (dia sem periodo) -> sem erro (loja fechada o dia todo, estado valido)', () => {
  assert.equal(validarDia([]).size, 0);
});

console.error('— (D) COPIAR HORÁRIOS — aplicarCopiaHorarios (produtividade do Admin)');

check('aplicarCopiaHorarios: replica dia de origem (fechado + periodos) para os dias-alvo', () => {
  const dias = paraEditavel(DOC.schedule, nextId);
  const antes = JSON.stringify(paraPersistir(dias));
  const alvo = new Set(['quarta', 'quinta', 'sexta']);
  const depois = aplicarCopiaHorarios(dias, 'terca', alvo, nextId);
  assert.deepEqual(depois.quarta.periodos.map((p) => ({ ini: p.ini, fim: p.fim })), depois.terca.periodos.map((p) => ({ ini: p.ini, fim: p.fim })));
  assert.equal(depois.quinta.fechado, depois.terca.fechado);
  assert.equal(depois.sabado, dias.sabado); // dia NAO selecionado fica intocado (mesma referencia)
  assert.equal(JSON.stringify(paraPersistir(dias)), antes); // funcao pura: nao mutou o objeto original
});
check('aplicarCopiaHorarios: copia o estado "fechado" tambem (nao so periodos)', () => {
  const dias = paraEditavel(DOC.schedule, nextId); // domingo fechado
  const depois = aplicarCopiaHorarios(dias, 'domingo', new Set(['segunda']), nextId);
  assert.equal(depois.segunda.fechado, true);
  assert.deepEqual(depois.segunda.periodos, []);
});
check('aplicarCopiaHorarios: periodos copiados ganham _id NOVOS (independentes do original)', () => {
  const dias = paraEditavel(DOC.schedule, nextId);
  const depois = aplicarCopiaHorarios(dias, 'terca', new Set(['quarta']), nextId);
  const idsOriginais = new Set(dias.terca.periodos.map((p) => p._id));
  depois.quarta.periodos.forEach((p) => assert.ok(!idsOriginais.has(p._id)));
});
check('aplicarCopiaHorarios: copiar para MULTIPLOS dias de uma vez (todos os selecionados no menu)', () => {
  const dias = paraEditavel(DOC.schedule, nextId);
  const todos = new Set(DIA_NOMES.filter((d) => d !== 'terca'));
  const depois = aplicarCopiaHorarios(dias, 'terca', todos, nextId);
  todos.forEach((d) => {
    assert.deepEqual(depois[d].periodos.map((p) => p.ini), dias.terca.periodos.map((p) => p.ini));
  });
});

console.log(fail === 0
  ? '\nOK business-hours-schedule.golden — formulario do cronograma (carregar/validar/copiar/salvar) congelado'
  : `\nFALHA business-hours-schedule.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
