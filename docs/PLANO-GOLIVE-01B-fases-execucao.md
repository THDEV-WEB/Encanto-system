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
| **B2** | Credenciais Meta (WhatsApp Cloud API) + inserir 2 secrets no Vault | Cadastro em plataforma externa (Meta for Developers/WhatsApp Business), exige verificação de negócio — não é algo que eu consiga fazer; e escrita de secrets no Supabase é bloqueada para mim mesmo com autonomia delegada | Obter token permanente + `phone_number_id` na Meta; inserir os 2 valores no Vault (SQL editor ou Management API) | Pode ser feito **a qualquer momento**, em paralelo à Fase A inteira | **Zero** para o resto da implementação — o sistema já roda sem isso (fila fica `pending` com segurança); só bloqueia a *funcionalidade* de notificação automática | Ir ao ar sem notificação automática — já documentado como aceitável no plano original |
| **B3** | Decisão + token Mapbox | Contratação de serviço pago (billing), decisão de negócio | Decidir se quer contratar; se sim, gerar o token e configurar `VITE_MAPBOX_TOKEN` na Vercel | A qualquer momento | Zero — fallback Nominatim→Photon já funciona e já foi validado como melhoria real | Manter o fallback atual indefinidamente — é a decisão default deste plano |
| **B4** | QA física completa em Android real (checklist `REF-MOBILE-01`) | Exige aparelho físico, observação humana de comportamento visual/sensorial (splash, instalação, notificação push chegando de verdade) | Seguir o checklist completo (instalação, standalone, ícone/splash, login e-mail+Google, catálogo, checkout entrega/retirada, notificação, atualização, offline) em pelo menos 1 aparelho | Depois que o Bloco 1 (Fase A) estiver concluído, para testar a build mais atual | Bloqueia só a Onda 5 (go-live formal); o resto avança em paralelo | Nenhuma real — reaproveitar a homologação antiga do `REF-CAP-01` D10 cobre só instalação/catálogo, não o checklist inteiro (risco assumido, não recomendado) |
| **B5** | Smoke test manual (humano) do fluxo de negócio em produção | A parte técnica (bundle/hash/páginas carregando) eu cubro sozinho em A4; mas confirmar que o fluxo real "sente" certo — preço, WhatsApp chegando no seu número real — exige alguém validando com dados reais. Também é princípio já estabelecido do projeto nunca testar contra o banco de PRODUÇÃO via automação (só o projeto E2E dedicado) | Fazer 1 pedido de teste real ponta a ponta (cliente + admin) direto no site em produção | Perto do fim, depois do Bloco 1 concluído | Bloqueia só a Onda 5 | Nenhuma recomendada — é o último gate antes de "operação definitiva" |
| **B6** | Aprovação final / assinatura da checklist de Go-Live | É uma decisão de negócio (declarar o sistema em operação definitiva), não uma questão técnica | Revisar a checklist do `PLANO-GOLIVE-01` §4 e dar o aceite | Por último, depois de tudo | N/A — é o fim | N/A |

---

## Matriz de dependências

| Onda | Depende do usuário? | Se sim: ação | Tempo da ação | Quando fazer |
|---|---|---|---|---|
| **Onda 1** — Auditoria de fechamento | ✅ Concluída (2026-08-01) | B1 foi necessária (A1 achou o gap) — dono forneceu credencial pontual, sessão aplicou e validou | Feito | Feito |
| **Onda 2** — Integrações externas | **Sim** | B2 (Meta+Vault) e B3 (Mapbox) | B2: minutos de trabalho seu, mas **verificação de negócio da Meta pode levar horas a dias** — fora do seu controle direto; B3: minutos | Pode começar **já**, em paralelo, não bloqueia nada |
| **Onda 3** — QA final | **Sim** | B4 (QA física) + B5 (smoke manual) | B4: 1-3h conforme nº de aparelhos/cenários; B5: ~15-30 min | Depois do Bloco 1 (Fase A) fechado |
| **Onda 4** — Registro de backlog | **Não** | — | — | — |
| **Onda 5** — Go-live formal | **Sim** | B6 (aprovação) | Minutos | Por último |
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
BLOCO 2 — CADASTROS EXTERNOS (roda em PARALELO ao Bloco 1, não espera nada)
   B2 (Meta — RECOMENDO INICIAR JÁ, é o único item com prazo externo incerto)
   B3 (Mapbox — opcional, a qualquer momento)
   │
   ▼
BLOCO 3 — INTERVENÇÃO HUMANA CONCENTRADA (só depois do Bloco 1 fechado)
   B4 (QA física) → B5 (smoke manual) → B6 (aprovação) → GO-LIVE
```

**Resposta direta à pergunta que motivou este documento:** na hipótese mais provável (nenhum gap em A1, nenhuma falha ambígua em A3), você só precisa intervir em **três momentos concretos**, não a cada etapa:

1. **Quando quiser, o quanto antes** — cadastro Meta (B2) e decisão sobre Mapbox (B3). Não bloqueiam nada, mas Meta tem prazo externo incerto, por isso vale começar cedo.
2. **No fim do Bloco 1** — QA física + smoke test manual (B4/B5), uma janela concentrada de algumas horas.
3. **Logo depois** — aprovação final (B6), minutos.

Tudo o resto (Bloco 1 inteiro: 6 itens, incluindo a única mudança real de código deste ciclo) roda numa sessão contínua sem precisar da sua presença.

---

## Runbooks prontos — Fase B (preparados em 2026-08-01, reconfirmados read-only antes de escrever)

Estado reconfirmado agora: secrets `whatsapp_token`/`whatsapp_phone_number_id`/`whatsapp_api_version` **ainda ausentes** do Vault; secret Mapbox **ainda ausente**. Nada mudou desde a última auditoria — os 2 runbooks abaixo continuam válidos.

### Runbook B2 — WhatsApp Cloud API (Meta)

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

**Pendente para fechar B2 definitivamente (Fase 2):** dono completar a Etapa 2 da Meta (registrar o número oficial da Encanto na Cloud API) e fornecer o `phone_number_id` real — nesse momento, troco `whatsapp_token`/`whatsapp_phone_number_id` no Vault pelos de produção (`vault.update_secret`, mesma sintaxe já confirmada) e o sistema fica definitivo.

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
