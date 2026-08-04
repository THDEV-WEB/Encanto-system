# ADR REF-BUSINESS-HOURS-04 — Cronograma semanal de funcionamento administrável pelo Admin

- **Status:** 🟡 **Código pronto, migration NÃO aplicada.** Todo o código (engine, serviço, hooks, UI do Admin, testes) está implementado e os gates locais estão verdes. A migration `migrations/REF-BUSINESS-HOURS-04-schedule-rpc.sql` precisa ser aplicada manualmente no SQL editor do Supabase de produção (o ambiente desta sessão não tem credenciais de escrita no banco — mesma situação de toda migration anterior deste projeto) e depois verificada ao vivo. Ver §7.
- **Escopo:** o cronograma SEMANAL (quais dias abrem, em quais horários, quantos períodos por dia) deixa de ser hardcoded em código e passa a ser 100% administrável pelo painel Admin. O override manual (AUTO/OPEN/CLOSED, já persistido no Supabase desde a HB-03) **não muda** — os dois painéis (`AdminStatus` e o novo `AdminBusinessHours`) continuam se combinando só no engine (`resolverOverride`).
- **Relacionado:** [[REF-BUSINESS-HOURS-01]] (engine puro original, horário hardcoded em `schedule.js`) · [[REF-BUSINESS-HOURS-02]] (unificação Admin+loja, override 3-estados) · [[REF-BUSINESS-HOURS-03]] (`store_mode` persistido no Supabase — precedente arquitetural direto para a HB-04) · [[REF-DELIVERY-01]]/[[REF-COMPANY-01]] (mesmo padrão `settings`+RPC, objeto JSON inteiro numa chave).

---

## 1. Contexto

Até a HB-03, só o **override** (AUTO/OPEN/CLOSED) tinha saído do código para o Supabase. O **cronograma em si** — quais dias a loja abre, em quais horários, quantos períodos — continuava hardcoded em `src/services/businessHours/schedule.js` (`SEMANA`, um array de 7 posições com períodos em minutos). Qualquer mudança de horário (novo período, dia fechado, ajuste sazonal) exigia editar código e fazer deploy.

O pedido: eliminar essa dependência por completo. Todo o cronograma deve virar administrável pelo painel, com suporte a múltiplos períodos por dia, switch aberto/fechado por dia, validação (cliente + servidor) e uma funcionalidade de produtividade ("copiar horários para...") para o admin não precisar reconfigurar dia por dia.

## 2. Decisão

**Mesmo padrão já consolidado 3x no projeto** (`store_mode`, `delivery_eta_min`, `company_info`): reaproveitar `public.settings` (chave/valor), sem tabela nova, com um par de RPCs `SECURITY DEFINER` dedicados:

- `get_business_hours_schedule() RETURNS jsonb` — leitura pública (a loja anônima precisa decidir aberto/fechado).
- `set_business_hours_schedule(p_schedule jsonb) RETURNS jsonb` — escrita restrita a `is_admin()`. Ao contrário de `set_company_info` (que faz *patch*/merge raso), esta função faz **substituição total** do cronograma: o objeto é uma unidade coesa (7 dias, cada um com sua lista de períodos), então salvar parcialmente não faz sentido — o Admin sempre envia a semana inteira. Revalida tudo no servidor (7 dias presentes, `fechado` booleano, períodos `HH:MM` 00:00-23:59, fim>início, sem sobreposição/duplicata) e devolve o objeto **canônico** persistido (períodos ordenados por horário) — mesmo princípio *truthful* de `definirEta`/`set_company_info`.

### 2.1 Formato do documento — nomes de dia, não índices

```json
{
  "version": 1,
  "timezone": "America/Sao_Paulo",
  "schedule": {
    "domingo": { "fechado": true,  "periodos": [] },
    "segunda": { "fechado": false, "periodos": [{ "ini": "10:00", "fim": "15:00" }] },
    "terca":   { "fechado": false, "periodos": [{ "ini": "10:00", "fim": "15:00" }, { "ini": "17:00", "fim": "22:00" }] },
    "quarta":  { "...": "..." }, "quinta": { "...": "..." }, "sexta": { "...": "..." }, "sabado": { "...": "..." }
  },
  "exceptions": {}
}
```

Decisão explícita do dono: nomes de dia (ASCII, sem acento — `terca`, não `terça`) em vez de índices `0..6`, para o documento ser legível direto no banco/SQL editor sem precisar decorar a convenção `Date.getDay()`. `version`/`timezone` já preparam o documento para evoluir (troca de fuso, versionamento de schema) sem quebrar consumidores antigos. `exceptions` é um objeto vazio **reservado** para feriados/datas especiais — não implementado nesta entrega (mesmo gancho que `EXCECOES` já tinha em `schedule.js` desde a HB-01, agora também presente no documento persistido).

### 2.2 Por que substituição total, e não PATCH (diferente de `company_info`)?

| | `set_company_info` (patch) | `set_business_hours_schedule` (replace) |
|---|---|---|
| Unidade de dado | Campos independentes (nome, telefone, email...) — editar um não exige saber os outros | 7 dias interdependentes por natureza (a UI sempre edita a semana inteira numa tela só) |
| Risco de PATCH parcial | Nenhum — campos não relacionados | Um patch por-dia teria que reimplementar merge profundo (substituir só o dia X, preservando os outros 6) — complexidade sem benefício real, já que o formulário do Admin sempre tem a semana inteira carregada |

O Admin sempre parte do documento oficial completo (`useBusinessHoursSchedule`), edita localmente, e salva a semana inteira de uma vez — não há cenário de "salvar só um campo" como há em `company_info`.

## 3. Arquitetura implementada

```
Supabase: public.settings (chave='business_hours_schedule', valor=JSON texto)
   ├─ get_business_hours_schedule()        SECURITY DEFINER · anon+authenticated · leitura publica
   └─ set_business_hours_schedule(jsonb)   SECURITY DEFINER · authenticated + is_admin() · substituicao total (valida tudo)
              │
src/services/businessHours/
   ├─ schedule.js          PURO, zero IO. Papel revisto na HB-04: SEMANA/DIA_NOMES viram o FALLBACK DE
   │                        RESILIENCIA (1a pintura / Supabase fora do ar) — MESMO papel de ETA_DEFAULT em
   │                        deliveryEta.js. Nao e mais a fonte de verdade.
   ├─ businessHours.js     ENGINE PURO — nao conhece React/Supabase/RPC/hooks/componentes (trava por guard
   │                        estrutural). avaliar/getStoreStatus/horarioSemanal/periodosDoDia ganharam
   │                        parametros OPCIONAIS de cronograma (default = fallback local => zero mudanca de
   │                        comportamento p/ quem nao passa nada). Novo: semanaFromSchedule(json) — UNICO
   │                        adaptador entre o formato PERSISTIDO (dias por nome, "HH:MM") e o formato
   │                        INTERNO do engine (indice 0-6, minutos) — puro, sem IO.
   ├─ cronograma.js         IO — db.rpc(get/set_business_hours_schedule), cache em memoria (geracao
   │                        anti-race, mesma tecnica de override.js/deliveryEta.js), SCHEDULE_EVENT.
   │                        Espelha deliveryEta.js: SEM pintura otimista (formulario com botao Salvar,
   │                        so reflete o que o servidor confirmar).
   └─ scheduleForm.js       PURO — logica do FORMULARIO do Admin (paraEditavel/paraPersistir/validarDia/
                            aplicarCopiaHorarios), extraida do componente p/ ser testavel em Node sem
                            montar React. Espelha, no cliente, a MESMA validacao que a RPC roda no servidor.
              │
src/hooks/useBusinessHours.js        Interface publica PRESERVADA integralmente (StoreApp/Checkout/
                                      AdminStatus nao mudaram uma linha). Por dentro, agora TAMBEM
                                      sincroniza o cronograma oficial (sincronizarCronograma) alem do modo
                                      (sincronizarModo), e converte via semanaFromSchedule antes de
                                      chamar getStoreStatus — a decisao final continua 100% no engine.
src/hooks/useBusinessHoursSchedule.js Novo — documento OFICIAL reativo (mount/foco/evento/poll 60s),
                                      espelha useCompanyInfo.js 1:1. Usado por SobreScreen (grade) e
                                      AdminBusinessHours (formulario) — MESMO cache/fonte.
              │
        ┌─────┴──────────────────────────────────────────┐
src/components/menu/SobreScreen.jsx          src/components/admin/AdminBusinessHours.jsx
  grade da "Informacoes da loja" —              Nova aba dentro de "Status da Loja" (ao lado de
  useBusinessHoursSchedule + horarioSemanal     AdminStatus): 7 cards (um por dia), switch aberto/
  (antes: horarioSemanal() sem argumento,       fechado, N periodos com <input type="time">,
  direto de SEMANA hardcoded)                   +Adicionar periodo, remover periodo, "Copiar
                                                 horarios para..." (modal), validacao inline por
                                                 periodo, botao unico "Salvar Alteracoes".
```

## 4. Compatibilidade — o que NÃO mudou

- **Interface pública de `useBusinessHours()`:** o objeto retornado (`aberto`, `domingo`, `periodoAtual`, `fechaAs`, `proximaAbertura`, `haOutroPeriodoHoje`, `expedienteEncerrado`, `rotuloCurto`, `detalhe`, `mensagemFechado`, `modo`, `forcado`, `origem`) é **byte-idêntico** ao pré-HB-04. `StoreApp.jsx`, `CheckoutPage.jsx` e `AdminStatus.jsx` não precisaram de nenhuma alteração.
- **Prioridade do override** (`OPEN > CLOSED > AUTO`, em `resolverOverride`): intocada — HB-04 só troca a origem do cronograma que alimenta `getStoreStatus`; a combinação cronograma+override continua no mesmo lugar único.
- **Banner/checkout/gate:** continuam consumindo `mensagemFechado`/`detalhe`/`aberto` — nenhuma lógica de horário duplicada neles (guard estrutural trava regressão).
- **`schedule.js` não foi removido:** virou o fallback de resiliência (1ª pintura antes da 1ª sincronização, ou Supabase fora do ar), com os MESMOS números que sempre teve — mesmo papel que `ETA_DEFAULT = 45` já tem em `deliveryEta.js`. Isso significa que, se o Supabase cair, a loja continua decidindo aberto/fechado pelo último cronograma sincronizado (cache em memória) e, na pior hipótese (nunca sincronizou), pelo fallback local — nunca "quebra".

## 5. Validação e segurança

- **Cliente** (`scheduleForm.validarDia`, por período, feedback imediato): horário fora de `00:00-23:59`, `fim<=início`, período duplicado, período sobreposto. `<input type="time">` já restringe o formato na origem (o navegador só entrega `HH:MM` válido).
- **Servidor** (`set_business_hours_schedule`, fonte de verdade real): revalida tudo de novo — `is_admin()` obrigatório, os 7 dias presentes, `fechado` booleano, cada período com regex `HH:MM` 00:00-23:59, `fim>início`, sem sobreposição/duplicata (varre em ordem crescente de início). `version`/`timezone` são **normalizados no servidor** — nunca confia no que o cliente mandar nesses dois campos.
- **Grants:** `get_business_hours_schedule` → `anon, authenticated` (leitura pública); `set_business_hours_schedule` → só `authenticated` (com `REVOKE ... FROM anon` explícito, defense-in-depth — `is_admin()` já bloqueia mesmo assim).
- **Sem auto-save:** toda edição (switch, horários, adicionar/remover período, copiar horários) fica pendente na tela; só o botão "Salvar Alterações" grava — mesmo padrão de `AdminDeliveryEta`/`AdminEmpresa`. O botão fica desabilitado se não houver alteração pendente OU se houver algum período com erro.
- **"Copiar horários para...":** operação 100% local/pendente (não grava sozinha) — só reduz o trabalho de reconfigurar dia por dia; o Salvar continua sendo o único ponto de escrita.

## 6. Testes e qualidade

- `tests/business-hours.golden.mjs` (`npm run test:hours`) — estendido com a seção (D): `semanaFromSchedule` (múltiplos períodos, dia fechado, dia ausente/defensivo) e (D.1) `getStoreStatus`/`horarioSemanal` com cronograma **custom**, provando que a decisão de "aberto agora" e a "próxima abertura" (inclusive varrendo dias futuros) respeitam o cronograma recebido — não caem no fallback local quando um cronograma é passado.
- `tests/business-hours-schedule.golden.mjs` (novo, `npm run test:hours-schedule`) — lógica pura do formulário: carregar (`paraEditavel`), salvar (`paraPersistir`, round-trip), validar (`validarDia` — 9 casos incluindo períodos que se tocam vs. sobrepõem) e copiar horários (`aplicarCopiaHorarios` — inclusive para múltiplos dias de uma vez).
- `tests/business-hours-schedule.guard.mjs` (novo, `npm run test:hours-schedule-guard`) — guarda estrutural: os RPCs do cronograma só são chamados em `cronograma.js`; `useBusinessHours` realmente sincroniza o cronograma oficial (garante que a HB-04 entrou no caminho de decisão, não ficou órfã); `AdminBusinessHours` delega a escrita a `definirCronograma` (nunca fala com Supabase/RPC direto); o engine (`businessHours.js`) continua sem importar React/Supabase/hooks/componentes — só importa `schedule.js`.
- `scripts/business-hours-schedule-rpc-test.mjs` (novo, `npm run test:hours-schedule-rpc`) — suite net-zero (`BEGIN...ROLLBACK`) contra o Supabase real: `anon` lê via RPC; `anon`/`authenticated` não-admin não escrevem (`42501`); admin escreve um cronograma válido e recebe o objeto canônico (períodos ordenados); a RPC revalida tudo no servidor mesmo com payload malformado (dia ausente, `fim<=início`, fora de faixa, sobreposto, duplicado, `fechado` não-booleano → `22023`). **Depende da migration já aplicada** — ver §7.
- Todos os gates pré-existentes de `npm run test:domain` (build, pricing, addons, checkout, deps, price-domain, recompra, auth-lock, store-status, loyalty, address, catalog, comanda, whatsapp, company, datetime-format-guard...) permanecem verdes — rodados individualmente nesta sessão (o `test:render` tem 1 falha pré-existente e não-relacionada em `ValionCredit.jsx`, causada por edição não commitada de outra sessão/ator; não tocada por esta ref).

## 7. Migration — pendente de aplicação

A migration [`migrations/REF-BUSINESS-HOURS-04-schedule-rpc.sql`](../../migrations/REF-BUSINESS-HOURS-04-schedule-rpc.sql) (+ [rollback](../../migrations/REF-BUSINESS-HOURS-04-schedule-rpc-rollback.sql)) **ainda não foi aplicada** em produção. Semeia `business_hours_schedule` com o horário atual (Seg 10-15; Ter-Sáb 10-15+17-22; Dom fechado — os mesmos números que `schedule.js` sempre teve, zero mudança de comportamento no deploy) e cria os dois RPCs.

Depois de aplicada, verificar ao vivo:

1. `npm run test:hours-schedule-rpc` (net-zero, sem escrita persistida) — confirma leitura pública, bloqueio de escrita para não-admin, escrita válida por admin e revalidação de payload malformado.
2. `POST /rest/v1/rpc/get_business_hours_schedule` com a chave `anon` deve devolver o objeto semeado (mesmo método de verificação já usado em REF-DELIVERY-01/REF-COMPANY-01).
3. Abrir o Admin → Status da Loja → conferir que o cronograma exibido bate com o horário real da loja, editar um dia de teste, salvar, e confirmar no SQL editor que `settings.business_hours_schedule` refletiu a mudança.
