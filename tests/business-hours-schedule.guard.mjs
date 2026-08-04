/* tests/business-hours-schedule.guard.mjs — REF-BUSINESS-HOURS-04. Roda: node tests/business-hours-schedule.guard.mjs
   GUARDA ESTRUTURAL do cronograma administravel. Falha se alguem reintroduzir horario hardcoded no caminho
   de decisao, ou desconectar uma peca da cadeia Supabase -> cache -> hook -> UI. Analise estatica pura
   (sem banco/rede). Espelha tests/store-status.guard.mjs (mesmo espirito, agora para o CRONOGRAMA em vez
   do override). Invariantes:
     (1) cronograma.js e o UNICO lugar que fala com os RPCs get/set_business_hours_schedule.
     (2) useBusinessHours (hook PUBLICO e ja consumido por StoreApp/Checkout) sincroniza o cronograma —
         garante que HB-04 realmente entrou no caminho de decisao "aberto agora", nao ficou orfao.
     (3) AdminBusinessHours consome o cache/hook compartilhado e delega a escrita a definirCronograma — nao
         chama supabase/RPC direto, nao duplica a regra de validacao do engine.
     (4) o engine (businessHours.js) continua sem conhecer React/Supabase/RPC/hooks — recebe cronograma so
         como PARAMETRO (semanaFromSchedule e as demais funcoes puras nao importam nada alem de schedule.js). */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const files = readdirSync(SRC, { recursive: true }).map((f) => String(f).replace(/\\/g, '/')).filter((f) => /\.(js|jsx)$/.test(f)).sort();
const read = (f) => readFileSync(SRC + f, 'utf8');
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/* (1) get/set_business_hours_schedule so aparecem em cronograma.js (fonte unica dos RPCs do cronograma) */
check('(1) get/set_business_hours_schedule chamados so em services/businessHours/cronograma.js', () => {
  const chamadores = files.filter((f) => /business_hours_schedule/.test(strip(read(f))));
  assert.deepStrictEqual(chamadores, ['services/businessHours/cronograma.js'], `arquivos com a chamada: ${JSON.stringify(chamadores)}`);
});

/* (2) o hook PUBLICO useBusinessHours (StoreApp/Checkout/AdminStatus) sincroniza o cronograma oficial —
   sem isso, "aberto agora" continuaria decidido so pelo fallback local, e a HB-04 nunca chegaria na loja. */
check('(2) useBusinessHours sincroniza o cronograma oficial (sincronizarCronograma + semanaFromSchedule)', () => {
  const code = strip(read('hooks/useBusinessHours.js'));
  assert.ok(/sincronizarCronograma/.test(code), 'useBusinessHours deve puxar o cronograma oficial (sincronizarCronograma)');
  assert.ok(/semanaFromSchedule/.test(code), 'useBusinessHours deve converter o cronograma p/ o formato do engine (semanaFromSchedule)');
  assert.ok(/SCHEDULE_EVENT/.test(code), 'useBusinessHours deve reagir ao evento de cronograma salvo (SCHEDULE_EVENT)');
});

/* (3) AdminBusinessHours consome o cache/hook compartilhado e delega a escrita — nunca fala com supabase
   direto nem reimplementa a regra de "aberto agora" (isso e papel exclusivo do engine). */
check('(3) AdminBusinessHours consome useBusinessHoursSchedule e delega a escrita a definirCronograma', () => {
  const code = strip(read('components/admin/AdminBusinessHours.jsx'));
  assert.ok(/useBusinessHoursSchedule/.test(code), 'AdminBusinessHours deve consumir useBusinessHoursSchedule (mesmo cronograma da loja)');
  assert.ok(/definirCronograma/.test(code), 'AdminBusinessHours deve escrever via definirCronograma (servico)');
  assert.ok(!/from ['"].*lib\/supabase/.test(code), 'AdminBusinessHours NAO deve importar lib/supabase direto (delega ao servico)');
  assert.ok(!/\.rpc\(/.test(code), 'AdminBusinessHours NAO deve chamar RPC direto (delega a cronograma.js)');
});

/* (4) o engine permanece puro: nenhuma linha de businessHours.js importa React/Supabase/RPC/hooks/componentes. */
check('(4) businessHours.js (engine) nao importa React, Supabase, hooks nem componentes', () => {
  const code = read('services/businessHours/businessHours.js'); // import fica fora de comentario, nao precisa strip
  assert.ok(!/from ['"]react/i.test(code), 'engine nao deve importar react');
  assert.ok(!/lib\/supabase/.test(code), 'engine nao deve importar lib/supabase');
  assert.ok(!/\.rpc\(/.test(code), 'engine nao deve chamar RPC');
  assert.ok(!/from ['"]\.\.\/\.\.\/hooks/.test(code), 'engine nao deve importar hooks');
  assert.ok(!/from ['"]\.\.\/\.\.\/components/.test(code), 'engine nao deve importar componentes');
  // unico import permitido: o proprio schedule.js (fallback local + DIA_NOMES), tambem sem IO.
  const imports = [...code.matchAll(/^import .* from ['"](.+)['"];?$/gm)].map((m) => m[1]);
  assert.deepStrictEqual(imports, ['./schedule.js'], `imports encontrados: ${JSON.stringify(imports)}`);
});

console.log(fail === 0
  ? '\nOK business-hours-schedule.guard — cadeia Supabase->cache->hook->UI integra, engine continua puro'
  : `\nFALHA business-hours-schedule.guard — ${fail} invariante(s)`);
process.exit(fail ? 1 : 0);
