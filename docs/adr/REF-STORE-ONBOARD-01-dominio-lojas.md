# ADR REF-STORE-ONBOARD-01 (Onda 2) — Padrão de domínio para lojas novas

- **Status:** 🟢 **Onda 2 = VERDE/FECHADA e Onda 3 = VERDE/FECHADA (2026-08-23, ver §12).** Wildcard (Opção C) ABANDONADO (bloqueio real do Registro.br, ver §5) — modelo ATIVO é domínio explícito por loja via CNAME, sem wildcard. Aquarios Bar validada de ponta a ponta em produção real.
- **Escopo:** hostname de storefront/admin/convite da Aquarios Bar (segunda loja real da plataforma). Não altera o padrão da Encanto (congelado, ver §3). Arquitetura de domínio dedicado + wildcard pra onboarding zero-touch fica para avaliação futura separada — fora do escopo desta rodada.
- **Data:** 2026-08-20, corrigido 2026-08-21 (topologia Vercel, §4), pivotado 2026-08-21 (wildcard abandonado, §5).
- **Loja de referência**: renomeada em 2026-08-21 — identidade comercial correta é **Aquarios Bar** (slug `aquariosbar`), não "Bar da Sogra". Mesmo `store_id` (`776a01c8-f836-417a-a957-a0e1109f90a2`) o tempo todo. Auditoria do rename em `scripts/store-onboard-01-rename-aquariosbar.mjs`.

## 1. Opções avaliadas (histórico — Opção C foi a escolha original, depois abandonada, ver §5)

| | A — wildcard na raiz (`*.valionsistemas.com.br`) | B — registro manual por loja | C — wildcard em subzona (`*.lojas.valionsistemas.com.br`) |
|---|---|---|---|
| Zero-touch por loja nova | Sim | Não — sempre manual | Sim (na teoria — depois provado inviável, §5) |
| Blast radius | Alto — nameservers do domínio inteiro, e-mail institucional em risco | Nenhum | Baixo, mas inexecutável no Registro.br atual |
| Credencial | Registro.br + Vercel, domínio inteiro | Registro.br + Vercel, por loja | Registro.br + Vercel, escopo estreito — bloqueado (§5) |

Fontes: [Vercel — Working with domains](https://vercel.com/docs/domains/working-with-domains); [Vercel — Configuring Custom Domains (Multi-Tenant Platforms)](https://vercel.com/docs/platforms/multi-tenant-platforms/configuring-domains); [Vercel KB — wildcard domain without nameservers](https://vercel.com/kb/guide/wildcard-domain-without-vercel-nameservers).

**Decisão original (2026-08-20): Opção C.** **Revertida em 2026-08-21 — ver §5.** Modelo ativo agora é B (registro explícito por loja), que já era suportado pelo código desde o início (§6).

## 2. Padrão de hosts (Aquarios Bar, caso real ativo)

```
Storefront:  https://aquariosbar.lojas.valionsistemas.com.br/
Admin:       https://aquariosbar.admin.lojas.valionsistemas.com.br/
Convite:     https://aquariosbar.admin.lojas.valionsistemas.com.br/convite.html
```

O formato do hostname (`{slug}.lojas...` / `{slug}.admin.lojas...`, dois projetos Vercel diferentes) continua o mesmo desenhado para a Opção C — só o *mecanismo de DNS* mudou (CNAME explícito em vez de wildcard). Se um dia o zero-touch for retomado (domínio dedicado, ver §5), os hosts já provisionados assim continuam funcionando sem mudança.

## 3. Legado preservado (Encanto)

`encanto.valionsistemas.com.br` / `admin.encanto.valionsistemas.com.br` continuam exatamente como estão, para sempre. Toda função tocada tem o ramo legado como **primeira prioridade** no `COALESCE`, byte-idêntico ao que já rodava antes desta Onda.

## 4. Correção 2026-08-21: topologia real da Vercel (achado via token pessoal do dono)

- **3 projetos Vercel, não 2**: `encanto-system` (storefront), **`encanto-admin`** (Admin — `npm run build:admin`, projeto próprio), `valion-sistemas-site` (landing institucional). Corrige [[encanto-ref-brand-01-dominio]].
- **Consequência**: como Admin e storefront são projetos diferentes, e a Vercel liga cada domínio (wildcard ou explícito) a 1 projeto só, o host de admin precisa estar numa forma que resolva num único label (`{slug}.admin.lojas...`, não `admin.{slug}.lojas...`) — decisão preservada mesmo depois do pivô do §5, porque não depende de wildcard pra ser válida.

## 5. PIVÔ 2026-08-21: wildcard abandonado — Registro.br não permite NS no editor de zona

Ao tentar aplicar a delegação `_acme-challenge` via NS (necessária pra qualquer wildcard, §1), o dono confirmou no painel real do Registro.br ("Configurar Zona DNS", modo avançado) que o editor só oferece **A, AAAA, CNAME, MX, TXT, TLSA** — **NS não é uma opção**. Confirmado por busca na documentação oficial e em múltiplos guias de terceiros: nenhum lista NS como tipo criável no "Nova Entrada" desse editor. É um limite estrutural da interface, não falta de credencial.

**Consequência**: o mecanismo do qual a Opção C inteira dependia não é executável. Restam só duas saídas pra wildcard de verdade: nameservers do domínio **inteiro** pra Vercel (rejeitado — e-mail institucional em risco, ver auditoria anterior) ou um domínio **novo e separado**, com nameservers próprios (viável, mas é decisão de arquitetura futura, fora desta rodada).

**Decisão do dono**: abandonar wildcard por enquanto. Usar **domínio explícito por loja via CNAME convencional** — o mesmo mecanismo HTTP-01 que já roda em produção pra Encanto hoje, sem nada de novo a validar. Não é zero-touch, mas destrava a Aquarios Bar imediatamente com risco zero.

**Zero mudança de código foi necessária.** A resolução por `stores.dominio` explícito já era o **1º ramo** (maior prioridade) do `COALESCE` em `get_store_by_domain`/`resolve_store_from_origin` desde a concepção original da Onda 2 — o modelo nunca dependeu de wildcard pra funcionar, só de `dominio` estar preenchido corretamente. Reauditado fresco em 2026-08-21 (não assumido): confirmado nos dois. O 3º ramo (regex `.lojas.` genérico, pensado pra wildcard) fica no código, inerte — não atrapalha nem ajuda no modelo atual, é usado só se `dominio` não estiver setado.

## 6. Funções/arquivos (auditados frescos em 2026-08-21, nenhuma mudança nova necessária)

- **`get_store_by_domain(hostname)`**: `dominio` explícito tem prioridade 1 no `COALESCE`. Confirmado que resolve `aquariosbar.lojas.valionsistemas.com.br` → Aquarios Bar, e que o slug antigo (`bar-da-sogra.lojas...`) não resolve mais nada.
- **`resolve_store_from_origin()`**: mesma prioridade, mesma confirmação (guest checkout). **Nota cross-REF**: pertence à REF-ORDER-TENANT-01, alterada nesta REF só no 3º ramo aditivo (dependência técnica registrada anteriormente), não tocada de novo nesta rodada.
- **`provision_store()`**: **achado não corrigido nesta rodada, decisão futura separada** — ainda preenche `dominio` automaticamente no padrão `.lojas.` pra qualquer loja nova, mesmo sem wildcard ativo. Sem DNS manual pra essa loja nova, o domínio gravado não resolve de verdade — comportamento enganoso que precisa ser revisto quando a arquitetura de onboarding for definida (zero-touch real vs. manual assumido).
- **Edge Function `invite-store-admin`**: `redirectTo` ramifica por presença de `dominio` legado — confirmado que gera `https://aquariosbar.admin.lojas.valionsistemas.com.br/convite.html` pra Aquarios Bar e o host antigo pra Encanto. Deployada (version 4, ACTIVE, confirmado via API — deploy de produção mais recente de `encanto-system`/`encanto-admin` bate com o commit `1b69717`/`97c4db1`).
- **`vercel.json`**: 2 regras aditivas (`^[a-z0-9-]+\.lojas\.valionsistemas\.com\.br$` → storefront, `^[a-z0-9-]+\.admin\.lojas\.valionsistemas\.com\.br$` → admin) — regex funciona igual pra domínio explícito ou wildcard, nenhuma mudança necessária.
- **`uri_allow_list`**: já tinha `https://*.admin.lojas.valionsistemas.com.br/convite.html` (wildcard na string do allow-list, não no DNS — cobre `aquariosbar` sem mudança).

## 7. Vercel — domínios explícitos adicionados (2026-08-21, via API, token do dono)

| Host | Projeto | Status |
|---|---|---|
| `aquariosbar.lojas.valionsistemas.com.br` | `encanto-system` (`prj_Ki4HYw6zVF0P5jKRFLdfibWxdvRi`) | `verified:true`, `misconfigured:true` até o CNAME existir |
| `aquariosbar.admin.lojas.valionsistemas.com.br` | `encanto-admin` (`prj_pq2Pjj3NOJB9wwXPdk9UcROb4CVj`) | `verified:true`, `misconfigured:true` até o CNAME existir |

## 8. Testes

`scripts/store-onboard-01-onda2-dominio-lojas-test.mjs` — 21/21 (18 originais + 3 novos: slug antigo não resolve mais, redirect correto pra Aquarios Bar e pra Encanto). Regressão: `saas01-onda6-1` 14/14, `saas01-onda8` 36/36, `saas02-onda1` 25/25, `onda1-config-status` 11/11. Builds admin+storefront ok.

## 9. Registro.br — pendência única, execução manual do dono

| Local | Tipo | Nome/FQDN | Valor exato | Observação |
|---|---|---|---|---|
| Registro.br | CNAME | `aquariosbar.lojas.valionsistemas.com.br` | `6b42aaefa3930841.vercel-dns-017.com.` | **Confirmado ao vivo pós-attach no projeto `encanto-system`** — não é o valor genérico |
| Registro.br | CNAME | `aquariosbar.admin.lojas.valionsistemas.com.br` | `7e0ee76337724a8d.vercel-dns-017.com.` | **Confirmado ao vivo pós-attach no projeto `encanto-admin`** |

Nenhum NS, nenhuma troca de nameservers, nenhum registro existente tocado.

## 10. Pendente (Onda 2, todos os itens fechados)

1. ~~Dono cria os 2 CNAMEs acima no Registro.br.~~ Feito 2026-08-22.
2. ~~Validar resolução DNS, status Vercel, certificado emitido, HTTPS.~~ Confirmado 2026-08-22 (cert Let's Encrypt real, HTTPS funcionando nos 2 hosts).
3. ~~Convite real NOVO para o e-mail real do admin da Aquarios Bar (`<email-real-admin-aquariosbar>` — redigido).~~ Feito 2026-08-22.
4. ~~Validar primeiro acesso, login, guest checkout, isolamento.~~ 25/26 real (`scripts/store-onboard-01-onda2-validacao-final.mjs`), Onda 2 declarada VERDE em 2026-08-22.
5. Item 5 (revisar auto-preenchimento de `dominio` em `provision_store()`) — **resolvido na Onda 3, §11 abaixo** (não da forma originalmente cogitada: em vez de mudar o autofill, o Console agora prova o status real em vez de confiar na string).

## 11. Onda 3 (2026-08-22/23) — P2 (falso-positivo de domínio), P3 (UI de domínio), P1 (clonagem de catálogo)

Auditoria prévia (read-only) identificou 4 pendências candidatas (P1-P4) a partir da nota de memória original da Onda 0 + do item 5 do §10. Aprovado pelo dono: P1+P2+P3 nesta REF; P4 (PWA manifest por tenant) e P5 (fallback de horário/entrega sem aviso ao cliente final) registrados como dependência cross-REF, não implementados aqui.

**P2 — falso-positivo de domínio corrigido.** `statusEndereco()` (renomeada `hostsEsperados()`) comparava só a string gravada em `dominio` contra o padrão esperado e mostrava "✓ padrão confirmado" para **qualquer** loja nova, mesmo com zero CNAME criado — confirmado como bug real em produção nesta auditoria (não hipotético: `provision_store()` grava esse padrão incondicionalmente na criação). Corrigido com uma checagem HTTPS real: `fetch(https://{host}/, {mode:'no-cors'})` — a promise só resolve depois de DNS+TCP+TLS+HTTP completarem de verdade; rejeita se qualquer etapa falhar. O Console agora mostra ✅ respondendo / ❌ não responde ainda / ⏳ verificando, nunca mais uma suposição a partir do texto gravado. Nenhuma migration — 100% frontend.

**P3 — UI de domínio.** Nova RPC `platform_set_store_dominio(p_store_id, p_dominio)` (SECURITY DEFINER, `is_super_admin()`), validação de formato, aproveitando a constraint `UNIQUE(dominio)` já existente em `stores` como proteção anti-takeover (traduzida para mensagem amigável em vez de vazar `unique_violation` cru). Vazio/NULL limpa o domínio personalizado, loja volta a resolver só pelo padrão automático. Campo de edição adicionado ao detalhe da loja no Platform Console.

**P1 — clonagem/seed de catálogo.** Nova RPC `platform_clone_catalog(p_source_store_id, p_target_store_id)` (SECURITY DEFINER, `is_super_admin()`). Decisões de design registradas (nenhuma decisão de produto pré-existente foi encontrada — escolhas feitas com o critério "mais segura, coerente com a arquitetura já existente"):
- **Só clona para catálogo vazio** (nunca merge) — evita duplicar/misturar catálogo de uma loja que já criou o próprio.
- **`categories.id`/`products.id` são PK global (não por loja)** — a clonagem nunca reusa o id de origem, sempre gera um novo (`gen_random_uuid()`) e remapeia toda referência (`products.categoria_id`, `products.categoria_ids[]`, `adicionais.aplica_categoria_id`, `product_collections.product_id`/`collection_id`) para o novo id — zero referência cruzada para a loja de origem, confirmado por teste.
- **Produtos clonados nascem `disponivel=false`** — mesmo espírito do "seed neutro" de `company_info` (Onda 8): loja nova não aparenta operacional de verdade até o dono revisar/ativar cada item.
- **Imagens**: URL copiada como referência (aponta pro mesmo arquivo do Storage da loja de origem até o tenant trocar) — não duplica o objeto físico.
- **Nunca toca** `orders`/`customers`/`addresses`/`admins`/`auth.users` — essas tabelas nem são referenciadas pela função.
- Seção de clonagem no Platform Console só aparece quando a loja de destino está vazia (mesma guarda da RPC, checada também no frontend por UX).

**Testes**: `scripts/store-onboard-01-onda3-test.mjs`, 35/35 (grants das 2 RPCs, todos os caminhos de erro — não-super-admin/origem=destino/destino não-vazio/loja inexistente/domínio inválido/domínio duplicado —, clonagem real com verificação completa de integridade referencial incluindo uma categoria `tipo='collection'`, zero mutação líquida). Regressão: `onda1-config-status` 11/11, `onda2-dominio-lojas` 21/21, `saas01-onda8` 36/36, `saas02-onda1` 25/25 — idênticos à baseline, zero drift. Build admin+storefront ok.

**Commits**: `ebdba14` (migration + `DataService.js`), `71d6a0e` (`PlatformTenants.jsx` + teste), `cead802` (esta doc). Push confirmado em `origin/main` 2026-08-23 (ver §12).

**Pendências registradas, fora do escopo desta Onda**: P4 (PWA manifest por tenant — depende de REF-MOBILE-01/REF-SAAS-02); P5 (fallback hardcoded de horário/entrega sem aviso ao cliente final — depende de REF-BUSINESS-HOURS-0x/REF-DELIVERY-01).

## 12. Fechamento formal (2026-08-23) — REF-STORE-ONBOARD-01 · Onda 3 = 🟢 VERDE / FECHADA

**Push**: `origin/main` confirmado em `c7102b5..cead802` (fast-forward, só os 3 commits desta Onda — `ebdba14`, `71d6a0e`, `cead802`). Nenhum commit de outra REF/sessão foi incluído (confirmado via `git rev-list --left-right --count origin/main...main` = `0 3` antes do push).

**Deploy**: confirmado com conteúdo real, não só status HTTP — o bundle Admin ao vivo (`admin.encanto.valionsistemas.com.br`) contém `platform_set_store_dominio`, `platform_clone_catalog` e a checagem `no-cors` da correção do P2.

**CI do commit `cead802`**:
| Check | Resultado |
|---|---|
| Build | ✅ success |
| Lint + typecheck | ✅ success |
| Lighthouse CI | ✅ success |
| Testes de domínio | ✅ success |
| E2E (Playwright · Chromium) | ⚠️ **CANCELLED** (não FAILED) por `concurrency: cancel-in-progress: true` — outro commit de outra sessão (`f978859`) iniciou 3s após o cancelamento |

**Sobre o E2E — fato comprovado**: E2E possui falhas pré-existentes reproduzidas em commits consecutivos de REFs diferentes e não relacionadas às alterações da Onda 3. Evidência: os mesmos 5 testes (`admin-empresa-identidade-visual`, `admin-relatorios`, `platform-console` ×2, `checkout-logado`) já falhavam no E2E do commit imediatamente anterior (`c7102b5`, REF-PERF-02), executado e concluído mais de 30 minutos antes desta Onda sequer começar, e voltaram a falhar de forma idêntica no commit seguinte (`f978859`, REF-CI-02 — mudança só em config de Lighthouse CI). Nenhum dos testes afetados exercita `PlatformTenants.jsx`, `platform_set_store_dominio` ou `platform_clone_catalog` de forma que explique as falhas observadas (mensagens de erro são sobre contagens/valores de pedidos pré-existentes, não sobre domínio ou catálogo).

**Sobre a causa raiz — hipótese técnica, não fechada**: o padrão dos sintomas (valores/contagens de pedidos maiores que o esperado, "Nenhum pedido" não aparecendo quando deveria) é consistente com contaminação de dados num banco de E2E compartilhado entre execuções concorrentes. Esta é uma hipótese forte, **não uma causa raiz definitivamente encerrada** — só a REF responsável pela infraestrutura de E2E (REF-E2E-01/E2E-03) pode confirmar. Não investigada mais a fundo nesta rodada, por instrução explícita do dono. Registrada como **dependência externa/pré-existente**, não como pendência desta REF.

**Critério de fechamento (todos comprovados)**: P2 corrigido · P3 implementado · P1 implementado · RPCs validadas (35/35) · multi-tenancy preservada (`store_id`/`slug`/`dominio`/RLS/`get_store_by_domain()`/`resolve_store_from_origin()` intactos) · regressões funcionais verdes (93/93 nas 4 suites relacionadas) · builds verdes (admin+storefront) · Lighthouse CI verde · deploy confirmado por conteúdo real · Encanto e Aquarios Bar preservadas (nenhuma chamada real contra elas) · nenhum dado real alterado · nenhuma regressão atribuível à Onda 3.

**REF-STORE-ONBOARD-01 — Onda 3 = 🟢 VERDE / FECHADA.**
