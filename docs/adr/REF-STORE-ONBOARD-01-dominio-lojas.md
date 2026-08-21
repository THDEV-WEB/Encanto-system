# ADR REF-STORE-ONBOARD-01 (Onda 2) — Padrão de domínio para lojas novas

- **Status:** 🟡 **Wildcard (Opção C) ABANDONADO (bloqueio real do Registro.br, ver §5) — modelo ATIVO agora é domínio explícito por loja via CNAME, sem wildcard.** Código implementado, domínios adicionados na Vercel, DNS ativa assim que o dono criar os 2 CNAMEs (§9).
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

## 10. Pendente

1. Dono cria os 2 CNAMEs acima no Registro.br.
2. Depois: validar resolução DNS, status Vercel (sai de `misconfigured`), certificado emitido, HTTPS.
3. Convite real NOVO para `baraquarios806@gmail.com` (o anterior tem `redirectTo` de um padrão já abandonado, não reaproveitar).
4. Validar primeiro acesso, login, guest checkout, isolamento — só então declarar Onda 2 = VERDE.
5. **Decisão futura separada, não desta rodada**: revisar `provision_store()`'s auto-preenchimento de `dominio` (§6) e avaliar domínio dedicado (§5) se zero-touch voltar a ser prioridade.
