# ADR REF-STORE-ONBOARD-01 (Onda 2) — Padrão de domínio para lojas novas: subzona `lojas.valionsistemas.com.br`

- **Status:** 🟢 **Aprovado e implementado (código) — ativação em DNS/Vercel pendente do dono.**
- **Escopo:** padrão de hostname para storefront/admin/convite de toda loja provisionada a partir desta Onda. Não altera o padrão da Encanto (congelado, ver §3).
- **Data:** 2026-08-20.
- **Contexto:** auditoria da REF-STORE-ONBOARD-01 (2026-08-18/19) encontrou que `bar-da-sogra.valionsistemas.com.br` não resolvia DNS. Investigação (2026-08-20) provou, consultando o nameserver autoritativo direto, que **não existe wildcard `*.valionsistemas.com.br`** — cada subdomínio hoje em produção foi criado manualmente, um a um. A premissa da auditoria original ("wildcard já configurado 1x pra plataforma inteira") estava incorreta.

## 1. Opções avaliadas

| | A — wildcard na raiz (`*.valionsistemas.com.br`) | B — registro manual por loja (o que já existia) | **C — wildcard em subzona (`*.lojas.valionsistemas.com.br`)** |
|---|---|---|---|
| Zero-touch por loja nova | Sim | Não — sempre manual | **Sim** |
| Blast radius | Alto — exige migrar os nameservers do domínio inteiro (`valionsistemas.com.br`), afetando e-mail institucional (`mail.<produto>...`) e qualquer produto Valion futuro | Nenhum | **Baixo — só a subzona `lojas`, resto do domínio intocado** |
| Credencial | Registro.br + Vercel, escopo do domínio inteiro | Registro.br + Vercel, por loja | Registro.br + Vercel, escopo estreito (1x) |

Fontes: [Vercel — Working with domains](https://vercel.com/docs/domains/working-with-domains) ("Wildcard domains must be configured with the nameservers method"); [Vercel — Configuring Custom Domains (Multi-Tenant Platforms)](https://vercel.com/docs/platforms/multi-tenant-platforms/configuring-domains); [Vercel KB — wildcard domain without nameservers](https://vercel.com/kb/guide/wildcard-domain-without-vercel-nameservers) (delegação parcial de `_acme-challenge`, válida só para wildcard em subdomínio, não na raiz).

**Decisão: Opção C.** Menor risco de infraestrutura, entrega o objetivo de onboarding sem toque manual, não força decisão sobre o domínio institucional inteiro.

## 2. Padrão definitivo (não é fase de transição — permanente)

```
Storefront:  https://{slug}.lojas.valionsistemas.com.br/
Admin:       https://admin-{slug}.lojas.valionsistemas.com.br/
Convite:     https://admin-{slug}.lojas.valionsistemas.com.br/convite.html
```

Admin usa **hífen**, não ponto (`admin-{slug}`, não `admin.{slug}`): um wildcard DNS estático só cobre 1 nível de profundidade. `*.lojas.valionsistemas.com.br` cobre `{slug}.lojas...` mas não cobriria `admin.{slug}.lojas...` (2 labels). `admin-{slug}` é 1 label só — mesmo wildcard, sem precisar de uma segunda subzona.

**Colisão fechada na origem:** `provision_store()` rejeita qualquer slug que comece com `admin-` (senão uma loja `admin-cafe` colidiria com o host de admin da loja `cafe`).

## 3. Legado preservado (Encanto)

`encanto.valionsistemas.com.br` / `admin.encanto.valionsistemas.com.br` continuam exatamente como estão, para sempre — não é migração pendente, é uma exceção permanente e intencional. Toda função tocada tem o ramo legado como **primeira prioridade** no `COALESCE`, byte-idêntico ao que já rodava antes desta Onda.

## 4. Funções alteradas (`migrations/REF-STORE-ONBOARD-01-onda2-dominio-lojas.sql`)

- **`get_store_by_domain(hostname)`** — ganha 3º ramo (`.lojas.` via regex), depois de `dominio` explícito e do padrão legado.
- **`resolve_store_from_origin()`** — mesmo 3º ramo. **Dependência cross-REF**: esta função pertence à REF-ORDER-TENANT-01 (guest checkout); alterada aqui, com autorização explícita do dono, porque sem isso o checkout guest de qualquer loja nova sob `.lojas.` falharia (fail-closed) mesmo com storefront/Admin funcionando. REF-ORDER-TENANT-01 não foi reaberta como frente — só este ramo aditivo foi tocado.
- **`provision_store()`** — guarda `slug !~ '^admin-'` + preenche `dominio = {slug}.lojas.valionsistemas.com.br` automaticamente na criação (sob o padrão legado, `dominio` ficava `NULL` até confirmação manual de DNS; sob a Opção C isso é desnecessário, o wildcard garante resolução desde a criação).
- Rollback: `migrations/REF-STORE-ONBOARD-01-onda2-dominio-lojas-rollback.sql` (restaura os 3 ramos ao estado anterior). **Risco documentado:** se houver rollback depois de lojas já criadas sob `.lojas.`, elas param de resolver por hostname até alguém setar `dominio` manualmente — nenhum dado é perdido.

## 5. Edge Function `invite-store-admin`

`redirectTo` passa a ramificar por presença de `dominio` no padrão legado (não por slug hardcoded — generaliza pra qualquer exceção legada futura):

```ts
const dominioLegado = dominio?.endsWith('.valionsistemas.com.br') && !dominio?.endsWith('.lojas.valionsistemas.com.br');
redirectTo = dominioLegado ? `admin.${slug}.valionsistemas.com.br/convite.html` : `admin-${slug}.lojas.valionsistemas.com.br/convite.html`;
```

## 6. `vercel.json` — 2 regras aditivas (nenhuma regra existente alterada)

- Redirect storefront: host `^(?!admin-)[a-z0-9-]+\.lojas\.valionsistemas\.com\.br$` → `/encanto`
- Rewrite admin: host `^admin-[a-z0-9-]+\.lojas\.valionsistemas\.com\.br$` → `/admin.html`

## 7. DNS/Vercel — execução manual do dono (fora do alcance desta sessão: sem credencial de Registro.br/Vercel)

| Onde | O quê |
|---|---|
| Registro.br | NS `_acme-challenge.lojas.valionsistemas.com.br` → `ns1.vercel-dns.com.` e `ns2.vercel-dns.com.` |
| Registro.br | CNAME `*.lojas.valionsistemas.com.br` → valor **exato** mostrado pelo painel Vercel ao adicionar o domínio (não usar de memória) |
| Vercel (projeto `encanto-system`) | Add Domain → `*.lojas.valionsistemas.com.br` |

Nenhum registro existente do domínio (`encanto`, `mail.*`, MX, TXT, nameservers) é tocado.

## 8. Auth redirect

`uri_allow_list` ganhou entrada aditiva `https://admin-*.lojas.valionsistemas.com.br/convite.html` (PATCH via Management API, 2026-08-20) — as 10 entradas anteriores permanecem intactas.

## 9. Testes

`scripts/store-onboard-01-onda2-dominio-lojas-test.mjs` (18/18) — cobre resolução de domínio (novo e legado), roteamento `vercel.json`, guest checkout (Origin, fail-closed), guarda de slug, e ausência de mutação líquida. Regressão: `saas01-onda6-1-storefront-dominio-test.mjs` (14/14), `saas01-onda8-provisionamento-test.mjs` (36/36, 1 asserção do modelo antigo atualizada para o novo comportamento — ver comentário no arquivo), `saas02-onda1-platform-console-test.mjs` (25/25), `store-onboard-01-onda1-config-status-test.mjs` (11/11).

## 10. Pendente

Convite real para `baraquarios806@gmail.com` (Bar da Sogra) só depois do DNS ativo (§7) — o convite anterior tem `redirectTo` do padrão antigo e não deve ser reaproveitado como evidência do modelo novo. Ver estado consolidado em memória de sessão / relatório da Onda 2.
