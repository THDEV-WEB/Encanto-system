# REF-BUSINESS-HOURS-04 — Cronograma semanal administrável — progresso

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui.

Detalhe arquitetural completo em `docs/adr/REF-BUSINESS-HOURS-04-cronograma-administravel.md`.

## Estado atual

🟡 **Código pronto e testado localmente. Migration NÃO aplicada em produção — próximo passo obrigatório.**

Todas as ondas de implementação (1 a 6) concluídas. Onda 7 (aplicar migration + verificação ao vivo)
é uma **ação do dono** (aplicação manual no SQL editor do Supabase, mesma situação de toda migration
anterior deste projeto — o ambiente desta sessão não tem credenciais de escrita no banco).

## Onda 1 — Auditoria (concluída)

Como o sistema decidia aberto/fechado: engine puro (`businessHours.js`) + cronograma HARDCODED em
`schedule.js` (`SEMANA`, array de 7 posições, minutos). O override (AUTO/OPEN/CLOSED) já vivia no
Supabase desde a HB-03 — só o cronograma em si (dias/horários/períodos) continuava em código. Achado:
precedente arquitetural direto e já provado 3x (`store_mode`/`delivery_eta_min`/`company_info`) —
`REF-COMPANY-01` em particular (objeto JSON inteiro numa chave só) é o molde mais próximo do que a
grade semanal precisa. Detalhe completo apresentado e aprovado pelo dono no chat desta REF.

## Onda 2 — Arquitetura + refinamentos (concluída)

Dono aprovou a arquitetura com refinamentos explícitos: manter o padrão `settings`+RPC+cache+hook
único+botão Salvar (sem tabela nova); engine 100% puro (recebe só cronograma/data-hora/override);
interface pública de `useBusinessHours()` preservada integralmente; JSON com dias por NOME (não
índice) + `version`/`timezone`/`exceptions` (vazio, preparado p/ feriados futuros); UI agradável
(cards por dia, switch, N períodos, "Copiar horários para..."); validação cliente+servidor; testes
ampliados. Renomeado para **REF-BUSINESS-HOURS-04** (evita colisão com HB-01/02/03, já existentes e
em produção).

## Onda 3 — Implementação (concluída)

- **Banco:** `migrations/REF-BUSINESS-HOURS-04-schedule-rpc.sql` (+rollback) — chave
  `business_hours_schedule` em `public.settings`, RPCs `get_business_hours_schedule()` (público) e
  `set_business_hours_schedule(jsonb)` (admin, substituição total com revalidação completa). Semeia
  o horário ATUAL (zero mudança de comportamento no deploy).
- **Engine** (`services/businessHours/businessHours.js`): `avaliar`/`getStoreStatus`/`horarioSemanal`/
  `periodosDoDia`/`proximaAbertura` ganharam parâmetros OPCIONAIS de cronograma (default = fallback
  local `SEMANA`) — 100% aditivo, zero regressão nos golden tests existentes. Novo `semanaFromSchedule`
  (único adaptador JSON-persistido ↔ formato interno). `schedule.js` documentado com o novo papel
  (fallback de resiliência, não mais fonte de verdade).
- **Serviço** (`services/businessHours/cronograma.js`): cache em memória + `sincronizarCronograma`/
  `definirCronograma` (truthful, sem otimismo — espelha `deliveryEta.js`) + `SCHEDULE_EVENT`.
- **Hooks:** `useBusinessHours.js` agora também sincroniza o cronograma (interface pública intocada);
  novo `useBusinessHoursSchedule.js` (documento oficial reativo, espelha `useCompanyInfo.js`).
- **Consumidores:** `SobreScreen.jsx` migrado de `horarioSemanal()` hardcoded para o hook reativo.
- **Admin:** `AdminBusinessHours.jsx` (nova aba dentro de "Status da Loja", ao lado de `AdminStatus`)
  — 7 cards por dia, switch aberto/fechado, N períodos com `<input type="time">`, validação inline,
  "Copiar horários para..." (modal), botão único "Salvar Alterações". Lógica pura extraída para
  `services/businessHours/scheduleForm.js` (testável sem montar React).

## Onda 4 — Testes (concluída)

- `tests/business-hours.golden.mjs` — seção (D)/(D.1) nova: `semanaFromSchedule` + `getStoreStatus`/
  `horarioSemanal` com cronograma CUSTOM (múltiplos períodos, dia fechado, dia aberto, próxima
  abertura cruzando dias com horários diferentes do fallback).
- `tests/business-hours-schedule.golden.mjs` (novo) — `scheduleForm.js`: carregar/salvar (round-trip),
  validar (9 casos: inválido, fim<=início, fora de faixa, sobreposto, duplicado, toque permitido,
  3 períodos, lista vazia), copiar horários (inclusive p/ múltiplos dias de uma vez).
- `tests/business-hours-schedule.guard.mjs` (novo) — estrutural: RPCs só em `cronograma.js`;
  `useBusinessHours` realmente sincroniza o cronograma (não fica órfão); `AdminBusinessHours` delega
  a escrita (nunca fala com Supabase direto); engine continua sem importar React/Supabase/hooks.
- `scripts/business-hours-schedule-rpc-test.mjs` (novo, `test:hours-schedule-rpc`) — suite net-zero
  contra o Supabase real (leitura anon, bloqueio de escrita p/ não-admin, escrita válida por admin,
  revalidação server-side de payload malformado). **Ainda não executada** — depende da migration
  aplicada (Onda 7).

## Onda 5 — Validação local (concluída)

- `npm run build` — limpo.
- `npm run test:hours` / `test:hours-schedule` / `test:hours-schedule-guard` / `test:store-status` —
  todos verdes.
- `npm run test:domain` — todos os gates rodados individualmente (34 scripts) ficaram verdes, **exceto
  1 falha pré-existente e não-relacionada** em `test:render` (`ValionCredit.jsx` — edição não commitada
  de outra sessão/ator no repositório, presente ANTES desta REF começar; não tocada aqui). `deps.audit`
  confirmou o isolamento de camada dos módulos novos (engine só importa `schedule.js`; `cronograma.js`/
  `scheduleForm.js` sem ciclos nem dependência invertida).

## Onda 6 — Documentação (concluída)

Este arquivo + `docs/adr/REF-BUSINESS-HOURS-04-cronograma-administravel.md` + entrada no índice
`docs/adr/README.md`.

## Onda 7 — Aplicação da migration (PENDENTE — ação do dono)

1. Aplicar `migrations/REF-BUSINESS-HOURS-04-schedule-rpc.sql` no SQL editor do Supabase de produção.
2. Rodar `npm run test:hours-schedule-rpc` (net-zero, sem escrita persistida) — confirma leitura
   pública, bloqueio de escrita para não-admin/anon, escrita válida por admin e revalidação server-side.
3. Verificar ao vivo via REST (`anon` key): `POST /rest/v1/rpc/get_business_hours_schedule` deve
   devolver o objeto semeado.
4. Abrir Admin → Status da Loja → conferir cronograma exibido, editar um dia de teste, salvar, e
   confirmar no SQL editor que `settings.business_hours_schedule` refletiu a mudança.
5. Se tudo confirmado: commit (local, sem push — 1 commit por onda, seguindo a disciplina do projeto).

## Commits desta REF

Nenhum ainda — código pronto, aguardando revisão do dono + aplicação da migration antes do commit
(disciplina do projeto: apresentar resultados e rodar a suíte antes de commitar).
