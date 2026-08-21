# ADR REF-STORE-ONBOARD-01 (Onda 2) — Padrão de domínio para lojas novas: subzonas `lojas.valionsistemas.com.br` / `admin.lojas.valionsistemas.com.br`

- **Status:** 🟢 **Aprovado e implementado (código) — ativação em DNS/Vercel pendente do dono.**
- **Escopo:** padrão de hostname para storefront/admin/convite de toda loja provisionada a partir desta Onda. Não altera o padrão da Encanto (congelado, ver §3).
- **Data:** 2026-08-20, corrigido 2026-08-21 (ver §5.1).
- **Contexto:** auditoria da REF-STORE-ONBOARD-01 (2026-08-18/19) encontrou que o storefront da segunda loja da plataforma não resolvia DNS. Investigação (2026-08-20) provou, consultando o nameserver autoritativo direto, que **não existe wildcard `*.valionsistemas.com.br`** — cada subdomínio hoje em produção foi criado manualmente, um a um. A premissa da auditoria original ("wildcard já configurado 1x pra plataforma inteira") estava incorreta.
- **Loja de referência**: a loja usada como caso real ao longo desta REF foi renomeada em 2026-08-21 — identidade comercial correta é **Aquarios Bar** (slug `aquariosbar`), não "Bar da Sogra" (slug `bar-da-sogra`, nome provisório usado até então). Mesmo `store_id` (`776a01c8-f836-417a-a957-a0e1109f90a2`) o tempo todo — troca de nome/slug/domínio, nunca de identidade. Auditoria completa do impacto do rename em `scripts/store-onboard-01-rename-aquariosbar.mjs`.

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
Admin:       https://{slug}.admin.lojas.valionsistemas.com.br/
Convite:     https://{slug}.admin.lojas.valionsistemas.com.br/convite.html
```

Exemplo real (Aquarios Bar): `aquariosbar.lojas.valionsistemas.com.br` / `aquariosbar.admin.lojas.valionsistemas.com.br`.

**Duas subzonas, não uma — corrigido em 2026-08-21, ver §5.1.** O desenho original (`admin-{slug}.lojas...`, hífen em vez de ponto) partia de uma suposição nunca verificada: que `encanto-system` serve tanto storefront quanto Admin. Investigação com token real da Vercel provou que são **dois projetos Vercel separados** (`encanto-system` e `encanto-admin`) — um wildcard só roteia pra um projeto, então um único `*.lojas.` não consegue cobrir os dois. Corrigido pra duas subzonas independentes, uma por projeto.

A guarda `provision_store()` contra slug começando com `admin-` (fechava colisão entre `admin-{slug}.lojas...` e o host de admin) **ficou desnecessária** com o desenho de 2 subzonas — mantida mesmo assim, como defesa adicional sem custo.

## 3. Legado preservado (Encanto)

`encanto.valionsistemas.com.br` / `admin.encanto.valionsistemas.com.br` continuam exatamente como estão, para sempre — não é migração pendente, é uma exceção permanente e intencional. Toda função tocada tem o ramo legado como **primeira prioridade** no `COALESCE`, byte-idêntico ao que já rodava antes desta Onda.

## 4. Correção 2026-08-21: topologia real da Vercel (achado via token pessoal do dono)

O dono forneceu um token pessoal da Vercel para investigação read-only (só `GET`, nenhuma alteração). Achados que corrigem o plano original:

- **3 projetos Vercel, não 2** (memória antiga só registrava `encanto-system` + `valion-sistemas-site`): `encanto-system` (storefront), **`encanto-admin`** (Admin — `npm run build:admin`, projeto próprio), `valion-sistemas-site` (landing institucional).
- `*.valionsistemas.com.br` **já estava cadastrado** em `encanto-system` (`verified:true`) mas **`misconfigured:true`, `acceptedChallenges:[]`** — ownership do domínio provado, mas o desafio DNS-01 do certificado wildcard nunca foi completado. Explica a origem do engano da auditoria original: alguém começou a Opção A no passado e não terminou.
- `GET /v6/domains/{dominio}/config` confirmou ao vivo (não de memória) o CNAME exato que a Vercel pede para qualquer subzona nova: **`cname.vercel-dns.com.`** — mesmo valor pra `*.lojas.valionsistemas.com.br` e `*.admin.lojas.valionsistemas.com.br`, testado nos dois.
- **Consequência arquitetural**: como Admin e storefront são projetos diferentes, e a Vercel liga 1 wildcard a 1 projeto só, um único `*.lojas.` não cobre os dois hosts. Corrigido pra 2 subzonas independentes (§2), cada uma delegada a um dos dois projetos (§8).

## 5. Funções/arquivos alterados (`migrations/REF-STORE-ONBOARD-01-onda2-dominio-lojas.sql` + correções de 2026-08-21)

- **`get_store_by_domain(hostname)`** — ganha 3º ramo (`.lojas.` via regex), depois de `dominio` explícito e do padrão legado.
- **`resolve_store_from_origin()`** — mesmo 3º ramo. **Dependência cross-REF**: esta função pertence à REF-ORDER-TENANT-01 (guest checkout); alterada aqui, com autorização explícita do dono, porque sem isso o checkout guest de qualquer loja nova sob `.lojas.` falharia (fail-closed) mesmo com storefront/Admin funcionando. REF-ORDER-TENANT-01 não foi reaberta como frente — só este ramo aditivo foi tocado.
- **`provision_store()`** — guarda `slug !~ '^admin-'` (agora defesa redundante, ver §2) + preenche `dominio = {slug}.lojas.valionsistemas.com.br` automaticamente na criação (sob o padrão legado, `dominio` ficava `NULL` até confirmação manual de DNS; sob a Opção C isso é desnecessário, o wildcard garante resolução desde a criação).
- Rollback: `migrations/REF-STORE-ONBOARD-01-onda2-dominio-lojas-rollback.sql` (restaura os 3 ramos ao estado anterior). **Risco documentado:** se houver rollback depois de lojas já criadas sob `.lojas.`, elas param de resolver por hostname até alguém setar `dominio` manualmente — nenhum dado é perdido.

## 6. Edge Function `invite-store-admin`

`redirectTo` ramifica por presença de `dominio` no padrão legado (não por slug hardcoded — generaliza pra qualquer exceção legada futura):

```ts
const dominioLegado = dominio?.endsWith('.valionsistemas.com.br') && !dominio?.endsWith('.lojas.valionsistemas.com.br');
redirectTo = dominioLegado ? `admin.${slug}.valionsistemas.com.br/convite.html` : `${slug}.admin.lojas.valionsistemas.com.br/convite.html`;
```

Redeployada em 2026-08-21 com a correção (version 4, ACTIVE).

## 7. `vercel.json` — 2 regras aditivas (nenhuma regra existente alterada)

- Redirect storefront: host `^[a-z0-9-]+\.lojas\.valionsistemas\.com\.br$` → `/encanto`
- Rewrite admin: host `^[a-z0-9-]+\.admin\.lojas\.valionsistemas\.com\.br$` → `/admin.html`

## 8. DNS/Vercel — execução manual do dono (fora do alcance desta sessão: sem credencial de Registro.br)

| Local | Tipo | Nome/FQDN | Valor exato | Observação |
|---|---|---|---|---|
| Registro.br | NS | `_acme-challenge.lojas.valionsistemas.com.br` | `ns1.vercel-dns.com.` / `ns2.vercel-dns.com.` | Documentado pela Vercel, valor estável (não exposto por API, não muda por conta) |
| Registro.br | CNAME | `*.lojas.valionsistemas.com.br` | `cname.vercel-dns.com.` | **Confirmado ao vivo** via API, token do dono |
| Registro.br | NS | `_acme-challenge.admin.lojas.valionsistemas.com.br` | `ns1.vercel-dns.com.` / `ns2.vercel-dns.com.` | Nova subzona (correção §5.1) |
| Registro.br | CNAME | `*.admin.lojas.valionsistemas.com.br` | `cname.vercel-dns.com.` | **Confirmado ao vivo** via API |
| Vercel — projeto `encanto-system` | Add Domain | — | `*.lojas.valionsistemas.com.br` | `prj_Ki4HYw6zVF0P5jKRFLdfibWxdvRi` |
| Vercel — projeto `encanto-admin` | Add Domain | — | `*.admin.lojas.valionsistemas.com.br` | `prj_pq2Pjj3NOJB9wwXPdk9UcROb4CVj` — **não** `encanto-system` |

Nenhum registro existente do domínio (`encanto`, `mail.*`, MX, TXT, nameservers) é tocado.

## 9. Auth redirect

`uri_allow_list` tem a entrada `https://*.admin.lojas.valionsistemas.com.br/convite.html` (corrigida em 2026-08-21, substituindo a entrada errada `admin-*.lojas...` do dia anterior) — 11 entradas no total, nenhuma removida além da correção.

## 10. Testes

`scripts/store-onboard-01-onda2-dominio-lojas-test.mjs` (18/18) — cobre resolução de domínio (novo e legado), roteamento `vercel.json`, guest checkout (Origin, fail-closed), guarda de slug, e ausência de mutação líquida. Regressão: `saas01-onda6-1-storefront-dominio-test.mjs` (14/14), `saas01-onda8-provisionamento-test.mjs` (36/36), `saas02-onda1-platform-console-test.mjs` (25/25), `store-onboard-01-onda1-config-status-test.mjs` (11/11, corrigido pra buscar a loja de referência por UUID em vez de slug).

## 11. Pendente

Convite real para `baraquarios806@gmail.com` (Aquarios Bar) só depois do DNS ativo (§8) — o convite anterior tem `redirectTo` de um padrão abandonado e não deve ser reaproveitado como evidência do modelo novo. Ver estado consolidado em memória de sessão / relatório da Onda 2.
