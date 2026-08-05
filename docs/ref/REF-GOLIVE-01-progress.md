# REF-GOLIVE-01 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui.

**Ponto de partida:** auditoria técnica completa pré-aceite (05/08/2026) encontrou exatamente 2
bloqueadores reais para o aceite oficial do Go Live — ambos bugs funcionais ativos, não hipotéticos. O
restante dos achados (documentação desatualizada, duplicação de regra de negócio menor, `console.log`
esquecidos, etc.) foi deliberadamente deixado como backlog pós-Go-Live, fora do escopo desta REF.

## Estado atual

✅ **Código dos dois bloqueadores CONCLUÍDO e testado (2 commits locais, sem push).**
⏳ **1 ação pendente do dono:** aplicar a migration SQL no Supabase (produção) + validação manual —
ver roteiro abaixo. Sem ela, a notificação automática de WhatsApp ("recebido") continua enviando o tempo
antigo; a mensagem que o cliente envia à loja e a comanda impressa já mostram o valor correto (dependem
só do código, já commitado).

## Bloqueador 1 — horário hardcoded na SuccessPage

**Commit:** `35eea1b`.

- Causa raiz: `SuccessPage.jsx` tinha uma string fixa ("Seg–Dom 11:00 às 22:30"), nunca migrada para o
  domínio de horário de funcionamento (`services/businessHours`, REF-BUSINESS-HOURS-01..04) que o resto
  da app já usa.
- Fix: `StoreApp.jsx` passou a repassar o objeto `horario` (já calculado por `useBusinessHours()`, mesmo
  usado no header) como prop; `SuccessPage` exibe `horario.rotuloCurto` + `horario.detalhe`.
- Teste: novo caso `SuccessPage(entrega, aberto)` em `render.smoke.mjs`, com snapshot do markup dinâmico.
- Gate: `npm run test:domain` completo (34/34) + `npm run build` — verde, sem push.

## Bloqueador 2 — tempo de entrega em 3 cópias hardcoded (não 2)

**Commit:** `78e48f0`.

- A auditoria original apontou 2 cópias (`messageTemplates.js`/`comandaModel.js`). Investigando "qualquer
  helper relacionado" (pedido explícito da REF), apareceu uma 3ª cópia — `enc_tempo_estimado()` (SQL,
  `migrations/REF-ORDER-01-order-ops.sql`) — que é a que de fato alimenta a notificação automática de
  "recebido" **realmente disparada em produção** via `pg_cron`. Era a cópia mais crítica das três.
- Fix JS: nova camada pura `src/services/delivery/deliveryEtaFormat.js` (zero imports, para não arrastar
  `lib/supabase.js` para dentro de módulos Node-puros) — `textoTempoEntrega(tipo, etaMin)` é a fonte
  única da frase. `comandaModel.js`/`ComandaModal.jsx`/`CheckoutPage.jsx`/`orderPayload.js`/
  `PedidoNotificacoes.jsx` passaram a propagar o valor real (`useDeliveryEta()`).
- Fix SQL: `migrations/REF-GOLIVE-01-tempo-entrega-unico.sql` (+ rollback) — `enc_tempo_estimado()` passa
  a ler `settings.delivery_eta_min` via `get_setting()` (seguro dentro do `SECURITY DEFINER` de
  `enc_enqueue_notification`) e troca `IMMUTABLE` por `STABLE`.
- Retirada **não muda**: "cerca de 20 min" continua constante de negócio nas 3 cópias.
- Testes: `comanda.golden.mjs` (previsão dinâmica/fallback/retirada constante) e
  `whatsapp-templates.golden.mjs` (`textoTempoEntrega` + paridade do corpo da migration SQL).
- Gate: `npm run test:domain` completo (34/34) + `npm run build` — verde, sem push.

## Ação pendente do dono — aplicar migration + validar

1. **Aplicar** `migrations/REF-GOLIVE-01-tempo-entrega-unico.sql` no SQL editor do Supabase (produção) —
   mesmo procedimento manual de todas as migrations anteriores deste projeto.
2. **Validar** (repetir 2x, com 2 valores diferentes de ETA no Admin — ex.: 45 depois 60):
   - Admin → aba Status → alterar "Tempo de entrega" e salvar.
   - Loja (`DeliveryBar`): "Entregar em, até N min" reflete o novo valor.
   - Checkout → finalizar um pedido de ENTREGA → SuccessPage mostra "N min" (e o horário, não mais um
     texto fixo).
   - Mensagem que abre no WhatsApp do cliente (a que ele envia à loja): "Entrega prevista: até N min".
   - Comanda impressa do Admin (ComandaModal): "Previsão: até N min".
   - (Após aplicar a migration) Admin → aba do pedido → "Mensagens automáticas" (`PedidoNotificacoes`):
     prévia do "recebido" mostra "até N min" — e, na prática, a notificação real que o pg_cron dispara
     também, pois lê a mesma `enc_tempo_estimado()`.
3. Repetir para RETIRADA: todas as superfícies acima devem continuar mostrando "20 min"/"cerca de 20 min"
   sem nenhuma mudança, em qualquer valor de ETA configurado (retirada não é administrável).

Se os passos 2 e 3 baterem para os dois valores testados, os dois bloqueadores estão eliminados e o
projeto está apto para o aceite oficial do Go Live (quanto a estes dois itens — o parecer final completo
está no relatório de auditoria).
