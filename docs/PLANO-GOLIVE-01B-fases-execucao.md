# PLANO-GOLIVE-01B — Reorganização por Fase (Autonomia de Execução)

**Base:** `docs/PLANO-GOLIVE-01-execucao-final.md`. Este documento não adiciona nem remove nenhum item do plano original — só reclassifica cada um pela pergunta "isso precisa de uma decisão sua, ou eu consigo levar do início ao fim sozinho?". Nenhuma implementação acontece aqui, é só reorganização.

**Regra usada para classificar:** um item vai para a Fase A somente se eu conseguir completar o ciclo inteiro (Auditoria → Implementação → Testes → Commit → Documentação) sem precisar de uma credencial que não tenho, um acesso que me é bloqueado, ou uma decisão de negócio/produto. Se qualquer uma dessas três coisas aparece no meio do caminho, o item é Fase B — mesmo que 90% do trabalho seja automatizável.

---

## FASE A — Execução Autônoma

| # | Onda (plano original) | Objetivo | O que será feito | Dependências | Risco | Critério de conclusão | Esforço |
|---|---|---|---|---|---|---|---|
| **A1** | Onda 1 (P0.1) | Eliminar a incerteza restante sobre quais migrations sensíveis estão de fato aplicadas em produção | Rodar, via a ferramenta local de introspecção read-only já usada nesta sessão, uma consulta de confirmação (existência de coluna/constraint/trigger/grant) para cada migration em `migrations/` que ainda não foi confirmada ao vivo — hoje já confirmei `REF-ORDER-01c` e o CHECK de `orders`; faltam as demais (`REF-COMPANY-02`, `REF-COMANDA-ENDERECO-01`, `REF-DATETIME-01b`, `REF-ADDRESS-02` ondas 1-6, etc.). Produzir tabela final por migration | Acesso já existente (`C:\Users\00thi\.encanto\db.env`), só leitura | Praticamente zero — nenhuma escrita | Cada migration sensível marcada CONFIRMADA (com a query que provou) ou GAP | Baixo — ~30-45 min |
| **A2** | Onda 1 (P1.2) | Fechar a última pendência documental do ciclo Android/Capacitor | Escrever a Onda 8 do `REF-CAP-01` (registrar as 3 formas oficiais de uso: Navegador/PWA/APK), sem alterar comportamento nenhum | Nenhuma — os fatos já existem, é só registrar | Zero — markdown puro | `docs/ref/REF-CAP-01-progress.md` com Onda 8 marcada concluída + commit | Baixo — ~15 min |
| **A3** | Onda 5 (P0.4) | Confirmar que o código está 100% saudável, sem depender de memória | Rodar `test:domain` (32 scripts), `test:db-guards`, `test:e2e:all-browsers` (contra o projeto E2E **dedicado**, nunca produção), `build` (web + capacitor) | Nenhuma — ambiente já configurado | Zero em si; **ver nota de escape abaixo** se algo falhar | Todos os gates verdes, ou lista clara e nomeada do que não ficou verde | Baixo-médio — ~30 min |
| **A4** | Onda 3 (metade técnica do P0.3) | Confirmar que o que está publicado na Vercel é de fato o build esperado — a lição já registrada é que "push ≠ deploy no ar" não pode ser assumido | Checar por HTTP o hash do bundle publicado contra o build local do commit atual; confirmar que as páginas centrais carregam sem 404/500 e sem exceção JS síncrona | Nenhuma — URLs públicas | Zero — só leitura HTTP | Hash bate, páginas carregam limpo | Baixo — ~15 min |
| **A5** | (P1.3, sem onda fixa no plano original) | Fechar o item de acessibilidade que você já definiu como escopo aceitável (fluxos críticos, não WCAG completo) | Auditar aria-label/role/foco/contraste em Login, Checkout (guest e logado) e Checkout do Admin; aplicar correções aditivas seguindo a disciplina já usada no projeto (1 commit por subfase, gates existentes) | Nenhuma decisão de negócio — escopo já definido por você nesta conversa | **Baixo, mas é a única atividade autônoma que toca código de produção diretamente** (mudanças tipicamente aditivas/não-visuais) | Achados corrigidos, suíte + `render.smoke` verdes, commit + doc | Médio — ~1-2h conforme volume de achados |
| **A6** | Onda 4 (P2.2/P2.3/P2.4/P2.5) | Registrar formalmente as decisões de "não fazer agora" (code splitting, divisão do StoreApp, WCAG completo, navegação por URL) como decisão tomada, não dúvida em aberto | Escrever entrada de ADR/backlog com a justificativa já elaborada no `PLANO-GOLIVE-01` §1 | Nenhuma — é formalização da análise já feita e já compartilhada com você | Zero | Entrada registrada em `docs/adr` ou `docs/ref` | Baixo — ~15 min |

**Nota de escape (vale para A3, e em menor grau para A1 e A5):** "autônomo" não significa "sem julgamento". Se uma verificação revelar algo que exige uma decisão real — um teste falhando por um motivo ambíguo (não um fix mecânico óbvio), ou um gap de migration que pareça mais sério do que o esperado — eu paro, sinalizo o achado especificamente, e sigo com o resto do bloco em paralelo em vez de travar tudo esperando resposta. Isso é diferente de pedir permissão a cada passo pequeno; é pausar só quando a decisão é genuinamente sua.

---

## FASE B — Execução Assistida

| # | Item | Por que depende de você | O que você precisa fazer exatamente | Quando é necessário | Quanto tempo o resto fica bloqueado | Alternativa temporária |
|---|---|---|---|---|---|---|
| **B1** | ✅ **CONCLUÍDA em 2026-08-01.** Aplicada via Management API (token fornecido pelo dono para esta etapa), validada 2x por caminhos independentes, zero regressão (`test:f1b` idêntico ao baseline). Detalhes completos em `PLANO-GOLIVE-01-execucao-final.md` §0.2.2/§0.2.3. Token já revogado pelo dono após o uso. | ~~Convenção já estabelecida no projeto...~~ (superada — dono decidiu fornecer credencial pontual em vez de aplicar manualmente) | ~~Rodar a migration no SQL editor~~ — feito pela sessão | — | — | — |
| **B2** | ⏸️ **REESCOPADA E ADIADA (2026-08-04) — ver ADR [`REF-WHATSAPP-01`](adr/REF-WHATSAPP-01-coexistence-arquitetura.md).** Deixou de ser "trocar 2 secrets no Vault" — vira integração completa em modo **Coexistence** (App + bot + Cloud API no mesmo número), que depende de aprovação externa da Meta como **Tech Provider** (verificação de identidade da empresa, 2–5 dias úteis, fora do controle do projeto). Decisão do dono: **não aguardar essa aprovação** — funcionalidades centrais e pendências da aplicação (B3–B6) têm prioridade. Vira iniciativa futura, desacoplada do go-live | Cadastro em plataforma externa (Meta), exige verificação de negócio — não é algo que eu consiga fazer | Quando o dono decidir retomar: iniciar o cadastro de Tech Provider na Meta; o resto (onboarding Coexistence + bot) é trabalho de implementação normal depois disso | **Sem prazo definido** — só quando o sistema estiver estabilizado E a aprovação Meta sair | **Zero** para o resto da implementação — o sistema já roda sem isso (fila fica `pending` com segurança); só bloqueia a *funcionalidade* de notificação automática/bot, que nunca foi requisito do go-live | Ir ao ar sem notificação automática — já documentado como aceitável no plano original; segue válido indefinidamente agora |
| **B3** | ⏸️ **ADIADA (2026-08-03), decisão do dono.** Contratação de serviço pago (billing) fica pra depois — mesmo tratamento do B2. | Contratação de serviço pago (billing), decisão de negócio | Quando decidir: gerar o token e configurar `VITE_MAPBOX_TOKEN` na Vercel | Sem prazo — a qualquer momento no futuro | **Zero** — fallback Nominatim→Photon já funciona e já foi validado como melhoria real | Manter o fallback atual indefinidamente — é a decisão default deste plano, agora confirmada pelo dono |
| **B4** | ✅ **CONCLUÍDA (2026-08-03), confirmada pelo dono.** QA física completa em Android real (checklist `REF-MOBILE-01`) validada. | ~~Exige aparelho físico...~~ — feito pelo dono | ~~Seguir o checklist completo~~ — feito | Feito | — | — |
| **B5** | ✅ **CONCLUÍDA (2026-08-03), confirmada pelo dono.** Smoke test manual do fluxo de negócio em produção realizado. | ~~Exige alguém validando com dados reais~~ — feito pelo dono | ~~Fazer 1 pedido de teste real ponta a ponta~~ — feito | Feito | — | — |
| **B6** | ⏳ **Único item pendente.** Aprovação final / assinatura da checklist de Go-Live | É uma decisão de negócio (declarar o sistema em operação definitiva), não uma questão técnica | Revisar a checklist do `PLANO-GOLIVE-01` §4 e dar o aceite | Por último, depois de tudo | N/A — é o fim | N/A |

---

## Matriz de dependências

| Onda | Depende do usuário? | Se sim: ação | Tempo da ação | Quando fazer |
|---|---|---|---|---|
| **Onda 1** — Auditoria de fechamento | ✅ Concluída (2026-08-01) | B1 foi necessária (A1 achou o gap) — dono forneceu credencial pontual, sessão aplicou e validou | Feito | Feito |
| **Onda 2** — Integrações externas | **Adiado, fora do go-live** (B2 e B3) | B2 (Meta Coexistence) e B3 (Mapbox) viraram iniciativas futuras — ver ADR `REF-WHATSAPP-01`; B3 sem prazo definido | — | Ambos ficam em espera até o dono retomar, sem bloquear nada |
| **Onda 3** — QA final | ✅ Concluída (2026-08-03) | B4 (QA física) + B5 (smoke manual), ambas confirmadas pelo dono | Feito | Feito |
| **Onda 4** — Registro de backlog | **Não** | — | — | — |
| **Onda 5** — Go-live formal | **Sim** | B6 (aprovação) — ÚNICO item restante em todo o plano | Minutos | Por último |
| *(sem onda fixa)* — Acessibilidade P1.3 | **Não** | — | — | — |

---

## Blocos de execução (reorganizados para minimizar interrupções)

```
BLOCO 1 — AUTÔNOMO, CONTÍNUO (posso rodar numa sessão longa sem parar)
   A1 (auditoria migrations) → A3 (suítes+build) → A4 (verificação deploy ao vivo)
        → A5 (acessibilidade — único item que gera código de produto, por isso vai
               depois de toda a verificação pura) → A2 + A6 (documentação de fechamento)
   │
   │  único ponto de pausa possível: A1 encontra gap real, ou A3 revela falha
   │  ambígua — sinalizo e sigo com o resto do bloco em paralelo, não travo tudo
   ▼
BLOCO 2 — ADIADO (2026-08-03, decisão do dono) — B3 (Mapbox) junto com B2, fora do caminho crítico
   │
   ▼
BLOCO 3 — INTERVENÇÃO HUMANA CONCENTRADA — B4 e B5 ✅ CONCLUÍDAS (2026-08-03)
   B4 (QA física) ✅ → B5 (smoke manual) ✅ → B6 (aprovação) ⏳ ÚNICO PASSO RESTANTE → GO-LIVE

BLOCO 4 — FUTURO, FORA DO CAMINHO CRÍTICO (retomar só quando o dono decidir)
   B2 / REF-WHATSAPP-01 (Tech Provider Meta → onboarding Coexistence → bot)
   B3 / Mapbox (token pago, decisão de billing)
```

**ATUALIZAÇÃO (2026-08-03):** B3 e B2 adiados por decisão do dono (fora do caminho crítico); B4 e B5
**concluídos** (QA física + smoke test manual confirmados pelo dono). **Só falta B6** (aprovação final)
para declarar o sistema em operação definitiva.

~~**Resposta direta à pergunta que motivou este documento** (histórico): na hipótese mais provável
(nenhum gap em A1, nenhuma falha ambígua em A3), você só precisa intervir em três momentos concretos:
1. Quando quiser — decisão sobre Mapbox (B3). 2. No fim do Bloco 1 — QA física + smoke test manual
(B4/B5). 3. Logo depois — aprovação final (B6).~~ — os 3 momentos já passaram; só falta o 3º (B6).

**B2 (WhatsApp Coexistence) saiu dessa contagem (2026-08-04):** decisão do dono foi não aguardar a aprovação externa da Meta como Tech Provider (prazo incerto) para fechar o go-live. Vira Bloco 4, retomado só depois do sistema estabilizado — ver ADR `REF-WHATSAPP-01` e runbook abaixo.

---

## Runbooks prontos — Fase B (preparados em 2026-08-01, reconfirmados read-only antes de escrever)

Estado reconfirmado agora: secrets `whatsapp_token`/`whatsapp_phone_number_id`/`whatsapp_api_version` **ainda ausentes** do Vault; secret Mapbox **ainda ausente**. Nada mudou desde a última auditoria — os 2 runbooks abaixo continuam válidos.

### Runbook B2 — WhatsApp Cloud API (Meta)

**STATUS (2026-08-04): ADIADO — iniciativa futura, fora do caminho crítico do go-live.** Ao avançar na Etapa 2 original (registrar o número oficial), identificou-se que essa migração desativaria o WhatsApp Business App no número oficial — quebra de requisito de negócio (atendimento humano precisa continuar no app). A arquitetura correta é **Coexistence** (App + bot + Cloud API no mesmo número), documentada em `docs/adr/REF-WHATSAPP-01-coexistence-arquitetura.md`, mas ela exige a Encanto virar **Tech Provider** da Meta primeiro (verificação de identidade da empresa, 2–5 dias úteis — prazo externo, fora do controle do projeto). Decisão do dono: não aguardar essa aprovação agora; fechar primeiro as pendências centrais da aplicação (B3–B6) e só retomar B2 depois, com a arquitetura já validada. O runbook abaixo (Fase 1, validado com número de teste) permanece como registro histórico — a Fase 2 nele descrita ("trocar pelo número oficial via OTP simples") está **superada** pelo ADR; quando B2 for retomado, o passo seguinte é abrir o cadastro de Tech Provider, não repetir este runbook.

<details>
<summary>Runbook original (histórico, pré-pivô para Coexistence)</summary>

1. Na Meta for Developers (app WhatsApp Business já existente ou novo): gerar um **token permanente** (não o temporário de 24h) + copiar o **Phone Number ID**.
2. No SQL Editor do Supabase (projeto de produção, `hvbcdxsagkjtfjwvnslo` — nunca `encanto-e2e`), rodar (sintaxe já confirmada contra o schema `vault` real deste projeto):
   ```sql
   select vault.create_secret('SEU_TOKEN_AQUI', 'whatsapp_token', 'Token permanente WhatsApp Cloud API');
   select vault.create_secret('SEU_PHONE_NUMBER_ID_AQUI', 'whatsapp_phone_number_id', 'Phone Number ID WhatsApp Cloud API');
   ```
   (Opcional, só se precisar fixar uma versão específica da Cloud API — sem isso o dispatcher usa o default já codificado: `select vault.create_secret('v20.0', 'whatsapp_api_version', 'Versao da Cloud API');`)
3. **Nenhum deploy necessário** — o `pg_cron enc-dispatch-whatsapp` já está ativo (roda a cada 30s) e passa a operar assim que os secrets existirem.
4. Validação: a fila `notification_outbox` já tem ~36 mensagens acumuladas em `pending` (pedidos reais desde que o sistema foi ao ar) — dentro de minutos após inserir os secrets, o Admin (aba "💬 Mensagens") deve mostrar essas linhas migrando para `sent`. Teste ponta a ponta real: mudar o status de 1 pedido no Admin e confirmar que a mensagem chega no WhatsApp do número de teste.

#### Execução B2 — Fase 1: validação com credenciais de AMBIENTE DE TESTE (2026-08-03)

Decisão do dono: inserir as credenciais do **número de teste** da Meta (Etapa 1 — Experimente) no Vault de produção agora, mesmo sabendo que isso drenaria a fila real de ~40 notificações pendentes contra um número que não pode alcançar clientes reais — objetivo era validar o pipeline completo antes da Etapa 2 (número oficial). Risco aceito explicitamente pelo dono.

**Credenciais usadas (ambiente de teste, substituídas na Fase 2 pelas de produção):**
- `whatsapp_token`: token de System User (tipo `SYSTEM_USER`, permanente — `expires_at:0`, confirmado via `debug_token` da própria Graph API antes de usar), app "Encanto System" (`app_id 2129796580974664`), escopos `whatsapp_business_management`+`whatsapp_business_messaging`.
- `whatsapp_phone_number_id`: `1237917372740335` (número de teste).
- Inseridos via Management API (token fornecido pelo dono para esta etapa, mesmo padrão de segurança da migration B1 — revogar após uso).

**Resultado — pipeline mecânico (Vault → pg_cron → Cloud API → gravação de status):**

| Etapa | Resultado |
|---|---|
| Secrets no Vault | Confirmados presentes (`whatsapp_token`, `whatsapp_phone_number_id`) |
| Drenagem da fila real | As 40 notificações pendentes (pedidos reais) foram claimed pelo `pg_cron` em 1 ciclo (`pending`→`sending`), e resolvidas no ciclo seguinte (`sending`→`failed`) — comportamento exatamente esperado |
| Erro retornado | `http_400 (#131030) Recipient phone number not in allowed list` — erro **real e específico da Meta**, não timeout/erro de rede: prova que a chamada saiu do Postgres, chegou na Cloud API de verdade, e a resposta foi processada e gravada corretamente pelo dispatcher |
| Teste de entrega real | Dono adicionou `+55 47 99272-2920` como destinatário verificado (Etapa 1). Disparei 1 mensagem via chamada direta à Graph API (fora do Supabase, template `hello_world`, único aceito para abrir conversa nova) → **HTTP 200, `message_status:"accepted"`, `wamid` real gerado** |

**Conclusão: pipeline 100% validado ponta a ponta** — mecanismo de banco (grants, Vault, cron, dispatch, gravação de status) e a integração real com a Cloud API da Meta (autenticação, formato de chamada, entrega) ambos confirmados com evidência real, não suposição.

**Nota técnica registrada (não é bug, é comportamento padrão da plataforma):** mensagens de texto livre (como os templates de status de pedido do Encanto) só podem ser enviadas dentro de uma janela de 24h de conversa já aberta pelo cliente — não é possível "esfriar" uma conversa nova com texto livre, só com template pré-aprovado (como o `hello_world` usado no teste). O checkout do Encanto já lida com isso corretamente: o fluxo gera a mensagem inicial via `wa.me` que o próprio cliente envia ao confirmar o pedido, o que abre essa janela antes de qualquer notificação automática de status tentar usá-la.

**Pendente para fechar B2 (superado — ver STATUS acima):** ~~dono completar a Etapa 2 da Meta (registrar o número oficial da Encanto na Cloud API) e fornecer o `phone_number_id` real~~. Substituído pelo fluxo Coexistence do ADR `REF-WHATSAPP-01`: quando retomado, o próximo passo real é o cadastro de Tech Provider, não uma troca simples de secret.

</details>

### Runbook B3 — Mapbox

1. Decidir se quer contratar (o fallback atual Nominatim→Photon já é funcional e validado — essa é a decisão default deste plano, sem prazo).
2. Se sim: gerar o token em mapbox.com → Access Tokens.
3. Vercel → Project Settings → Environment Variables → adicionar `VITE_MAPBOX_TOKEN`, ambiente Production.
4. **Importante:** variáveis `VITE_*` são embutidas no build (não lidas em runtime) — depois de salvar, é preciso disparar um novo deploy (push qualquer, ou "Redeploy" manual no dashboard da Vercel) para o token entrar de fato no bundle publicado.
5. Validação: buscar um endereço no checkout e conferir na aba Network do navegador se a chamada passa a ir para `api.mapbox.com`.

### Checklist B4 — QA física (consolidado, evita retestar o que já foi validado)

**Já confirmado fisicamente (não precisa repetir):** instalação do APK em Android real, catálogo carregando dentro do APK, ícone do APK, login Google nativo via deep link (D5/D10 do `REF-CAP-01`).

**Ainda pendente de validação real (nunca foi feito, registrado como pendência honesta nos próprios ADRs):**
- [ ] Checkout completo dentro do APK (entrega e retirada) — instalação/catálogo já testados, mas o fluxo de compra ponta a ponta no app nativo ainda não tem confirmação registrada.
- [ ] Splash screen do APK.
- [ ] Comportamento offline (sem internet: o app deve mostrar um estado de erro sensato, não travar — o Service Worker é desativado no APK por design, então "offline" aqui significa "sem rede alguma", não cache).
- [ ] Notificações — só depois de B2 estar concluído (sem os secrets, a fila fica `pending`, comportamento esperado, não é bug).
- [ ] **Checklist original da PWA (`REF-MOBILE-01`, nunca executado, registrado como pendência desde o encerramento daquela REF):** instalar via Android Chrome, via Samsung Internet, via Safari iOS (conferir ícone + modo standalone + safe-area no notch), via Chrome/Edge Desktop; confirmar que o aviso "Nova versão disponível" aparece e funciona após um deploy novo.

### Roteiro B5 — Smoke test manual em produção

1. **Cliente (guest):** buscar um produto → adicionar ao carrinho → checkout sem login → confirmar que o pedido é criado e a mensagem de WhatsApp (ou o link `wa.me`) é gerada corretamente.
2. **Cliente (logado):** login (e-mail OTP ou Google) → telefone travado no checkout → pedido concluído → confirmar em "Meus Pedidos" que aparece vinculado à conta.
3. **Fidelidade:** confirmar que o selo é concedido após o pedido (ver no chip de fidelidade ou em "Minha Conta").
4. **Admin:** login → ver o pedido novo no Dashboard/Pedidos → avançar status → conferir que `order_events`/timeline reflete corretamente → imprimir/copiar a comanda.
5. Se B2 já estiver concluído nesse momento: confirmar que a notificação de WhatsApp chegou de verdade no número real do cliente de teste em cada mudança de status.

---
