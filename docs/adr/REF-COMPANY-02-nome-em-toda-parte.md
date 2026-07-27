# ADR REF-COMPANY-02 — Consolidação da identidade institucional (nome em toda parte)

- **Status:** ✅ **Implementada no código (9/9 subfases, `test:domain` 29/29 verde).** As duas migrations SQL novas (split do nome + `{{empresa}}` nas notificações) seguem **pendentes de aplicação manual** pelo dono no SQL editor do Supabase — mesma limitação de ambiente de toda ref anterior deste projeto (sem credencial de escrita no banco neste ambiente de trabalho).
- **Escopo:** transformar `company_info.nomeCurto`/`nomeCompleto` na fonte única real da identidade visual do sistema (header, sidebar do Admin, login, comanda, notificações WhatsApp) — não apenas um campo administrável sem efeito visível, como ficou após a REF-COMPANY-01.
- **Relacionado:** [[REF-AUDIT-COMPANY-01]] (auditoria que motivou esta ref) · [[REF-COMPANY-01]] (fundação: `company_info`, RPCs, `useCompanyInfo`) · [[REF-ORDER-01]]/[[REF-ORDER-01b]] (outbox de notificações, dispatcher SQL-nativo) · [[REF-APP-01]] (G-CK3, purity guard que moldou a Decisão C).

---

## 1. Contexto

A REF-AUDIT-COMPANY-01 (auditoria isolada, sem implementação) provou que `company_info.nome` — administrável desde a REF-COMPANY-01 — nunca era lido por nenhuma UI além do próprio formulário que o editava. Todo nome institucional realmente exibido era um literal `"Encanto"` hardcoded em **9 pontos**: cabeçalho da loja (alt + texto), barra sticky (alt), sidebar do Admin, tela de login, mensagem WhatsApp do checkout, comanda impressa (cabeçalho **e** um rodapé independentemente hardcoded — bug pré-existente) e **três cópias** manualmente sincronizadas das notificações automáticas de status (`messageTemplates.js` canônico, `templates.ts` da Edge Function, e `enc_render_message` — função SQL do dispatcher nativo via `pg_cron`, achado que a auditoria original não tinha mapeado).

Esta ref fecha essa lacuna, preservando integralmente a arquitetura da REF-COMPANY-01 (JSON schemaless em `company_info`, RPCs `SECURITY DEFINER` dedicadas, hook `useCompanyInfo`, cache em memória + evento) — nenhuma fonte de configuração nova, nenhuma duplicação de regra de negócio.

## 2. Decisão A — split `nome` em `nomeCurto` + `nomeCompleto`

O cabeçalho da loja já mostra o nome ao lado de uma tagline ("Marmita e Açaí") e da cidade ("Timbó"); o valor até então salvo em `nome` ("Encanto — Açaí & Marmitas") duplicaria a tagline e estouraria as superfícies compactas (sidebar do Admin, título do login, comanda térmica 50/72mm). A tarefa proibiu explicitamente derivar o nome curto do completo via `substring()`/`split()` (truncamento local) — a única solução sem gambiarra é dois campos independentes e administráveis pelo dono, com custo zero de RPC nova (o objeto já é JSON schemaless desde a REF-COMPANY-01 §2.1; um campo a mais é só mais um `IF p_patch ? 'x'` em `set_company_info`).

Ambos os campos usam a mesma regra de validação do antigo `nome` (trim, mínimo 2 caracteres) — sem inventar um teto de tamanho arbitrário (o cuidado com comprimento fica na UI/copy do Admin, não numa trava de servidor que poderia rejeitar um nome completo legítimo e mais longo no futuro).

**Migration** (`migrations/REF-COMPANY-02-nome-split.sql`): `UPDATE settings` idempotente (só roda se a chave `nome` ainda existir) renomeia `nome`→`nomeCompleto` preservando o valor **já gravado em produção**, e acrescenta `nomeCurto` com o default `'Encanto'` (o literal que já estava, hardcoded, em todo lugar — a migração fica visualmente byte-idêntica ao que já estava no ar). `get_company_info`/`set_company_info` são redefinidas via `CREATE OR REPLACE` (mesma assinatura/grants). **Desvio proposital do padrão de rollback anterior:** rollbacks até aqui só faziam `DROP FUNCTION` (funções eram novas); aqui `get_company_info`/`set_company_info` são RPCs vivas consumidas pela loja inteira — o rollback restaura os corpos anteriores via `CREATE OR REPLACE`, nunca `DROP`.

## 3. Decisão B — notificações: snapshot no enqueue, não busca ao vivo no dispatch

`enc_enqueue_notification` (SQL, `SECURITY DEFINER`, mesmo banco) passa a incluir `'empresa': get_company_info()->>'nomeCurto'` no `vars` jsonb — o mesmo ponto único que já monta `cliente`/`numero`/`tempo` para a fila `notification_outbox`. Os dois disparadores (`enc_render_message` SQL e a Edge Function `templates.ts`) apenas fazem substituição genérica de `{{empresa}}` a partir do `vars` recebido — nenhum dos dois consulta `company_info` por conta própria.

| | Snapshot no enqueue (escolhida) | Busca ao vivo no dispatch (rejeitada) |
|---|---|---|
| Defasagem | Até ~30s (janela do `pg_cron`); pior caso ~15min (janela de reclaim de `sending` preso) se o admin renomear com a fila cheia | Quase zero |
| Código tocado | 1 função (`enc_enqueue_notification`); os dois disparadores só trocam o texto do template, zero lógica nova | Os dois disparadores (SQL **e** Deno) ganhariam uma dependência nova em `company_info`, cada um por conta própria |
| Consistência | Mesmo modelo de frescor de `cliente`/`numero`/`tempo`, já snapshots | Introduz um segundo modelo de frescor só para este campo |

Renomear a empresa é uma ação administrativa rara e deliberada; um atraso cosmético de poucos minutos num envio assíncrono best-effort é um preço aceitável por não duplicar a dependência em dois runtimes independentes (Postgres e Deno). **Validada — mantida.**

## 4. Decisão C — comanda permanece pura

`buildComanda(order, opts)` passa a ler `opts.companyInfo?.nomeCurto` (fallback local `'Encanto'`, mesmo idioma defensivo já usado em `PAGAMENTO_LABEL`/`PREVISAO` no próprio arquivo) — **nunca** importa `services/company/*`. Quem busca e injeta é `ComandaModal.jsx` (chama `useCompanyInfo()` e passa via `opts.companyInfo`). Isso não é só estilo: `tests/deps.audit.mjs` (G-CK3) proíbe o `order-domain` (`utils/orderPayload.js`, mesma regra se aplicaria a um `comandaModel.js` que importasse hooks) de importar React/IO/hooks — qualquer violação quebraria o gate de dependências herdado da REF-APP-01.

O sufixo `"DELIVERY"`/`"Delivery"` permanece fixo no código, tratado como rótulo de tipo de documento (mesmo papel de `tipoLabel: 'ENTREGA'`/`'RETIRADA'`), não como parte do nome institucional — candidato a revisão futura se a cozinha algum dia precisar torná-lo configurável, registrado aqui e não implementado agora.

De brinde, esta decisão corrige um bug pré-existente: o rodapé da comanda (`comandaHtml.js`/`comandaTexto.js`) hardcodeava `"Encanto Delivery"` **independentemente** do cabeçalho (`loja.nome`) — os dois nunca estavam de fato sincronizados por código, só coincidiam por serem ambos literais iguais. Agora os dois derivam do mesmo `nomeCurto` via `loja.nome`/`loja.nomeFooter`.

## 5. Decisão D — limitações documentadas, não contornadas

- **`index.html`** (`<title>` + texto do loader "Carregando..."): HTML estático servido **antes** do React montar — exigiria SSR, prerender ou injeção em build-time para consumir `company_info`. Fora de escopo desta ref.
- **`src/main.jsx`** (texto do Error Boundary de boot): deliberadamente independente da camada de dados, que pode ser a própria causa da falha que o boundary existe para capturar — amarrar a `useCompanyInfo()` seria circular (o boundary existe justamente para o caso em que hooks/Supabase falham).

Nenhum dos dois é uma pendência: são limitações arquiteturais aceitas, registradas aqui e na auditoria final (§7) para não ficarem "esquecidas sem classificação".

## 6. Notificações — as três cópias, hoje

`messageTemplates.js` (canônico JS) e `templates.ts` (espelho da Edge Function) trocam o literal `"Encanto Delivery"` por `{{empresa}}` nos 5 templates de status — o renderer de ambos já fazia substituição genérica de `{{chave}}`, então nenhuma lógica nova, só o texto. `enc_render_message` (SQL, `migrations/REF-COMPANY-02-notify-empresa.sql`) recebe o mesmo tratamento, mais uma linha de `replace` para `{{empresa}}` com fallback defensivo `'Encanto'` (cobre linhas `pending` antigas, enfileiradas antes desta migration, cujo `vars` ainda não tem a chave `empresa`).

`PedidoNotificacoes.jsx` (prévia ao vivo no Admin, **fora** do fluxo de outbox — recomputa a mensagem no cliente para mostrar "o que será enviado") passa `empresa: companyInfo.nomeCurto` explicitamente via `useCompanyInfo()`, já que não passa pelo snapshot do enqueue.

## 7. Auditoria final

| Site | Classificação |
|---|---|
| `StoreApp.jsx` (header: alt + texto) | Migrado → `companyInfo.nomeCurto` |
| `StickyBar.jsx` (alt do logo) | Migrado → prop `brandName` |
| `AdminPanel.jsx` (sidebar) | Migrado → `useCompanyInfo()` |
| `AdminLogin.jsx` (`<h2>`, pré-auth) | Migrado → `useCompanyInfo()` (`get_company_info` é público) |
| `orderPayload.js` (mensagem WhatsApp do checkout) | Migrado → parâmetro `nomeCurto` (default `'Encanto'`, permanece puro) |
| `comandaModel.js` (`loja.nome`) + rodapé (`comandaHtml.js`/`comandaTexto.js`, 2º hardcode independente) | Migrado → `loja.nome`/`loja.nomeFooter` derivados de `nomeCurto` |
| `messageTemplates.js` (canônico) | Migrado → `{{empresa}}` |
| `templates.ts` (Edge Function) | Migrado → `{{empresa}}` |
| `enc_render_message` (SQL, dispatcher via `pg_cron` — caminho provavelmente ativo em produção) | Migrado → `{{empresa}}` + checagem de paridade nova |
| `enc_enqueue_notification` (fonte do `vars`) | Migrado → snapshot de `nomeCurto` |
| `PedidoNotificacoes.jsx` (prévia ao vivo) | Migrado → `useCompanyInfo()` própria |
| `index.html` (`<title>` + loader) | **Limitação documentada** (HTML estático pré-mount) |
| `src/main.jsx` (Error Boundary de boot) | **Limitação documentada** (independência deliberada da camada de dados) |
| `STORE_INFO` (taglines, `SOBRE_TEXTO`, `social`) | **Fora de escopo** (já excluído desde a REF-COMPANY-01 §6; não é o "nome") |
| `data/mockCatalog.js` ("Encanto Mineiro" etc.) | **Fora de escopo** (nomes de produto, não identidade institucional) |
| `console.log('[Encanto] ...')` (tags de debug) | **Fora de escopo** (nunca visível ao usuário) |
| `migrations/REF-ORDER-01b-whatsapp-dispatch.sql`, `migrations/REF-COMPANY-01-institutional-info.sql` | **Fora de escopo** (migrations antigas congeladas como registro histórico; nunca editadas em vigor) |

Nenhum hardcode institucional ficou sem classificação.

## 8. Testes e qualidade

- `tests/company-info.golden.mjs` — atualizado: `DEFAULT_COMPANY_INFO` com 6 campos, validação independente de `nomeCurto`/`nomeCompleto`.
- `tests/checkout.golden.mjs` — snapshot de 3 argumentos intocado (default do parâmetro reproduz o literal antigo); novo caso prova que `nomeCurto` não é código morto.
- `tests/comanda.golden.mjs` — casos existentes continuam passando (fallback reproduz `"ENCANTO DELIVERY"`/`"Encanto Delivery"`); novo caso com nome customizado prova a fiação ponta-a-ponta cabeçalho+rodapé.
- `tests/whatsapp-templates.golden.mjs` — casos de render atualizados com `empresa` em `vars`; paridade JS↔TS mantida; **paridade nova** JS↔SQL contra `enc_render_message` (fecha uma lacuna pré-existente — a 3ª cópia nunca tinha sido conferida por nenhum golden).
- `tests/company-name.guard.mjs` (**novo**) — 9 invariantes, uma por ponto migrado, checagem por arquivo/padrão conhecido (nunca um scan cego de `"Encanto"`, que daria falso positivo em nomes de produto/taglines/logs). Adicionado a `test:domain` (29/29 verde).

## 9. Migrations — pendentes de aplicação manual

- `migrations/REF-COMPANY-02-nome-split.sql` (+ rollback)
- `migrations/REF-COMPANY-02-notify-empresa.sql` (+ rollback)

Mesma situação de toda migration anterior deste projeto: aplicação manual pelo dono no SQL editor do Supabase de produção (o ambiente de trabalho desta sessão não tem credenciais de escrita no banco). Verificação ao vivo recomendada, mesmo método já usado em REF-COMPANY-01/REF-DELIVERY-01: `POST /rest/v1/rpc/get_company_info` deve devolver `nomeCurto`/`nomeCompleto` (não mais `nome`); uma notificação de teste deve trazer `{{empresa}}` renderizado.
