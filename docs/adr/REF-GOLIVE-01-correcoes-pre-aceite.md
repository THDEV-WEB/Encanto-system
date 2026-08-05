# REF-GOLIVE-01 — Correções finais pré-aceite oficial do Go Live

**Status:** Implementada no código (2 bloqueadores). Migration SQL pendente de aplicação manual no
Supabase (mesmo procedimento de todas as migrations anteriores deste projeto).
**Commits:** `35eea1b` (bloqueador 1) · `78e48f0` (bloqueador 2).

## Contexto

A auditoria técnica completa pré-aceite (relatório de 05/08/2026, cobrindo código-fonte, segurança,
configuração, arquitetura e artefatos de produção) encontrou exatamente dois problemas classificados
como bloqueadores reais para o aceite oficial — os dois eram bugs funcionais **ativos**, não hipotéticos,
atingindo 100% dos pedidos concluídos:

1. `SuccessPage.jsx` exibia um horário de funcionamento fixo ("Seg–Dom 11:00 às 22:30"), incorreto e
   divergente do cronograma administrável (o próprio fallback do sistema tem domingo fechado).
2. O tempo de entrega mostrado na mensagem automática de WhatsApp e na comanda impressa não acompanhava
   o valor configurado pelo Admin (REF-DELIVERY-01) — a auditoria já havia notado duas cópias hardcoded
   ("35 a 45 min") em `messageTemplates.js` e `comandaModel.js`.

O restante dos achados da auditoria (documentação desatentada, duplicação de regra de negócio menor,
`console.log` em produção, etc.) permanece registrado como backlog pós-Go-Live, fora do escopo desta REF.

## Decisão

### Bloqueador 1 — horário na SuccessPage

`SuccessPage` deixou de ter **qualquer** informação operacional hardcoded. `StoreApp.jsx` já chama
`useBusinessHours()` uma única vez (mesmo hook que alimenta o pill de status do header) — o objeto
`horario` resultante passou a ser repassado por prop, no mesmo padrão SSoT-via-props já usado para
`deliveryEta`/`whatsapp`. A tela agora exibe `horario.rotuloCurto` + `horario.detalhe`, os mesmos campos
do header — texto sempre consistente com STORE_MODE (override AUTO/OPEN/CLOSED), o cronograma semanal
administrável (REF-BUSINESS-HOURS-04) e o gancho de exceções (`EXCECOES`/`exceptions`, ainda vazio, mas já
respeitado pelo engine caso seja populado).

Nenhuma lógica nova foi criada — é reuso do mesmo hook e dos mesmos campos que o header já usava.

### Bloqueador 2 — tempo de entrega em 3 cópias (não 2)

Investigando os dois pontos indicados pela auditoria (`messageTemplates.js`, `comandaModel.js`), a
auditagem de "qualquer formatter/helper relacionado" (pedida explicitamente nesta REF) encontrou uma
**terceira** cópia, mais crítica que as duas primeiras: a função SQL `enc_tempo_estimado(p_address)`
(`migrations/REF-ORDER-01-order-ops.sql`), que resolve o placeholder `{{tempo}}` no momento em que
`enc_enqueue_notification` enfileira a notificação automática de "recebido". Essa fila é lida por **dois**
dispatchers (o `enc_render_message` via `pg_cron` — o caminho realmente ativo em produção — e a Edge
Function `whatsapp-notify`), mas ambos leem o mesmo `vars.tempo` já resolvido no enqueue — ou seja,
`enc_tempo_estimado()` era a única fonte real do "tempo" nas notificações automáticas ao cliente, e
continuava fixa em "35 a 45 min" independente do que o Admin configurasse.

**Causa raiz:** cada uma das 3 cópias foi escrita antes de existir uma fonte administrável
(`settings.delivery_eta_min`, REF-DELIVERY-01/01a) e nunca foi migrada para lê-la — o padrão se repetiu
3 vezes de forma independente porque não havia uma camada compartilhada de *texto* sobre esse valor
(a camada de *dados* já existia e estava correta desde a REF-DELIVERY-01a).

**Correção — camada compartilhada nova:** `src/services/delivery/deliveryEtaFormat.js`, módulo puro e
**sem nenhum import**, exporta `textoTempoEntrega(tipo, etaMin)`. Deliberadamente não importa
`services/delivery/deliveryEta.js` (que lê/escreve no Supabase) para não arrastar `lib/supabase.js` para
dentro de `messageTemplates.js`/`comandaModel.js` — ambos precisam continuar 100% Node-puro, pois rodam
sem Vite nos golden tests (`import.meta.env` não existe nesse runtime; confirmado experimentalmente: o
runtime do `DataService.js` já falha do mesmo jeito em `tests/dataservice.micro.mjs`, comportamento
esperado e documentado, não regressão).

Consumidores atualizados para propagar o valor real (`useDeliveryEta()`, já em uso em toda a app):

| Arquivo | Antes | Depois |
|---|---|---|
| `comandaModel.js` (`buildComanda`) | `PREVISAO[tipo]` local, fixo | `textoTempoEntrega(tipo, opts.deliveryEtaMin)` |
| `ComandaModal.jsx` (Admin) | não passava tempo de entrega | `useDeliveryEta()` → `opts.deliveryEtaMin` |
| `CheckoutPage.jsx` → `orderPayload.js` (mensagem do cliente) | não passava tempo de entrega | prop `deliveryEta` (de `StoreApp`) → `opts.deliveryEtaMin` |
| `messageTemplates.js` | `TEMPO_ESTIMADO` local, fixo | removido (concern movido para `deliveryEtaFormat.js`) |
| `PedidoNotificacoes.jsx` (preview Admin) | `TEMPO_ESTIMADO[tipo]` | `useDeliveryEta()` + `textoTempoEntrega(tipo, deliveryEta)` |
| `enc_tempo_estimado()` (SQL) | `'35 a 45 min'` fixo, `IMMUTABLE` | `'até ' \|\| get_setting('delivery_eta_min','45') \|\| ' min'`, `STABLE` |

`get_setting()` dentro de `enc_tempo_estimado()` é seguro porque essa função só é chamada de dentro de
`enc_enqueue_notification` (`SECURITY DEFINER`) — mesmo padrão já em produção nas funções de fidelidade
(`loyalty_required`/`loyalty_enabled`/`loyalty_discount`, REF-LOYALTY-01). A lição da REF-DELIVERY-01a
("`get_setting` só funciona server-side, dentro de outra função `SECURITY DEFINER`") foi respeitada.
`IMMUTABLE` → `STABLE`: a função agora lê uma tabela mutável; `IMMUTABLE` seria semanticamente incorreto.

**Retirada não muda:** "cerca de 20 min" permanece uma constante de negócio nas 3 cópias, sem ligação ao
`delivery_eta_min` administrável — fora do escopo desta correção (o pedido do dono foi sobre "tempo de
entrega", e retirada nunca teve configuração no Admin).

## Consequências

- Nenhuma arquitetura nova: reuso de hooks/padrões já existentes (`useBusinessHours`, `useDeliveryEta`,
  SSoT-via-props).
- Nenhuma regra de negócio alterada além do descrito (retirada intocada; checkout/pricing/fidelidade/
  RLS/`create_order` intocados).
- Uma migration nova (`REF-GOLIVE-01-tempo-entrega-unico.sql` + rollback) — **aplicação manual pendente**
  no SQL editor do Supabase. Até a aplicação, a notificação automática de "recebido" continua enviando
  "35 a 45 min"; a mensagem que o cliente envia à loja (SuccessPage/WhatsApp) e a comanda impressa **já**
  mostram o valor correto, pois dependem só do código já commitado (não da migration).
- `test:domain` 34/34 verde (suíte completa, zero regressão); novo caso de regressão em
  `render.smoke.mjs` (SuccessPage) e novos casos em `comanda.golden.mjs`/`whatsapp-templates.golden.mjs`
  travando a frase canônica e a paridade do SQL.

## Testes

- `render.smoke.mjs`: caso `SuccessPage(entrega, aberto)` — trava que o markup deriva de `horario`, nunca
  mais de texto fixo.
- `comanda.golden.mjs`: `previsao` (entrega) reflete `opts.deliveryEtaMin`; retirada permanece constante;
  fallback sem `deliveryEtaMin` nunca reintroduz "35 a 45 min".
- `whatsapp-templates.golden.mjs`: `textoTempoEntrega` travado (entrega dinâmico, retirada fixo, fallback);
  novo check lê `migrations/REF-GOLIVE-01-tempo-entrega-unico.sql` e confirma que o corpo da função usa
  `get_setting('delivery_eta_min', ...)` e não contém mais o literal antigo.

## Pendência (ação exclusiva do dono)

Aplicar `migrations/REF-GOLIVE-01-tempo-entrega-unico.sql` no SQL editor do Supabase (produção), depois
validar manualmente conforme o roteiro no progress doc ([REF-GOLIVE-01-progress.md](../ref/REF-GOLIVE-01-progress.md)).
