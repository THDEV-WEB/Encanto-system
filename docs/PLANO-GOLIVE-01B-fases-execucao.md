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
| **B1** | **Confirmado em 2026-07-31 (A1 encontrou o gap):** aplicar `REF-ADMIN-03-categoria-delete-guard.sql` | Convenção já estabelecida no projeto: migrations em produção são sempre aplicadas manualmente por você (SQL editor/Management API); meu classificador bloqueia DDL/escrita mesmo com autonomia delegada. Trigger de integridade (bloqueia DELETE de categoria ainda em uso) nunca foi aplicada — hoje só existe o guard de aplicação (`DS.delCat`), não o backstop de banco | Rodar `migrations/REF-ADMIN-03-categoria-delete-guard.sql` (já pronto, idempotente, rollback em arquivo separado) no SQL editor do Supabase | Assim que possível — não é urgente (sem incidente ativo, o guard de aplicação já cobre o caminho normal do Admin), mas deveria fechar antes do go-live formal | Não bloqueia nada do Bloco 1; bloqueia só o fechamento 100% de P0.1 no checklist de Go-Live | Nenhuma — é proteção de integridade de dados, não tem substituto equivalente fora do banco |
| **B2** | Credenciais Meta (WhatsApp Cloud API) + inserir 2 secrets no Vault | Cadastro em plataforma externa (Meta for Developers/WhatsApp Business), exige verificação de negócio — não é algo que eu consiga fazer; e escrita de secrets no Supabase é bloqueada para mim mesmo com autonomia delegada | Obter token permanente + `phone_number_id` na Meta; inserir os 2 valores no Vault (SQL editor ou Management API) | Pode ser feito **a qualquer momento**, em paralelo à Fase A inteira | **Zero** para o resto da implementação — o sistema já roda sem isso (fila fica `pending` com segurança); só bloqueia a *funcionalidade* de notificação automática | Ir ao ar sem notificação automática — já documentado como aceitável no plano original |
| **B3** | Decisão + token Mapbox | Contratação de serviço pago (billing), decisão de negócio | Decidir se quer contratar; se sim, gerar o token e configurar `VITE_MAPBOX_TOKEN` na Vercel | A qualquer momento | Zero — fallback Nominatim→Photon já funciona e já foi validado como melhoria real | Manter o fallback atual indefinidamente — é a decisão default deste plano |
| **B4** | QA física completa em Android real (checklist `REF-MOBILE-01`) | Exige aparelho físico, observação humana de comportamento visual/sensorial (splash, instalação, notificação push chegando de verdade) | Seguir o checklist completo (instalação, standalone, ícone/splash, login e-mail+Google, catálogo, checkout entrega/retirada, notificação, atualização, offline) em pelo menos 1 aparelho | Depois que o Bloco 1 (Fase A) estiver concluído, para testar a build mais atual | Bloqueia só a Onda 5 (go-live formal); o resto avança em paralelo | Nenhuma real — reaproveitar a homologação antiga do `REF-CAP-01` D10 cobre só instalação/catálogo, não o checklist inteiro (risco assumido, não recomendado) |
| **B5** | Smoke test manual (humano) do fluxo de negócio em produção | A parte técnica (bundle/hash/páginas carregando) eu cubro sozinho em A4; mas confirmar que o fluxo real "sente" certo — preço, WhatsApp chegando no seu número real — exige alguém validando com dados reais. Também é princípio já estabelecido do projeto nunca testar contra o banco de PRODUÇÃO via automação (só o projeto E2E dedicado) | Fazer 1 pedido de teste real ponta a ponta (cliente + admin) direto no site em produção | Perto do fim, depois do Bloco 1 concluído | Bloqueia só a Onda 5 | Nenhuma recomendada — é o último gate antes de "operação definitiva" |
| **B6** | Aprovação final / assinatura da checklist de Go-Live | É uma decisão de negócio (declarar o sistema em operação definitiva), não uma questão técnica | Revisar a checklist do `PLANO-GOLIVE-01` §4 e dar o aceite | Por último, depois de tudo | N/A — é o fim | N/A |

---

## Matriz de dependências

| Onda | Depende do usuário? | Se sim: ação | Tempo da ação | Quando fazer |
|---|---|---|---|---|
| **Onda 1** — Auditoria de fechamento | **Não**, exceto contingência | B1 só se A1 encontrar gap | Minutos (SQL pronto) | Só se sinalizado |
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
