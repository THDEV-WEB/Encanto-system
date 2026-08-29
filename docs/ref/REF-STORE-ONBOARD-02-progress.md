# REF-STORE-ONBOARD-02 — Checklist de lançamento para lojas novas

ADR de referência: `docs/adr/REF-STORE-ONBOARD-01-dominio-lojas.md` — cita o "onboarding guiado" como
frente futura separada (§4, "fora do escopo desta rodada"). Esta REF é essa frente.

## Contexto

Com a REF-AUTH-PLATFORM-ISOLATION-01 fechada (Super Admin sem vínculo operacional na Encanto), ficou mais
fácil desenhar o backlog de onboarding: `public.admins` passou a significar só "admin operacional real",
sem a sobreposição que antes exigia tratamento especial em qualquer tela que listasse admins.

O formulário "➕ Nova loja" do Platform Console (`PlatformTenants.jsx`, `provision_store`) já cria a loja
e semeia uma configuração neutra (`company_info` com nome/paleta próprios, nunca herdados da Encanto).
O que faltava não era a criação em si — era o que vem depois, hoje espalhado por 5 telas diferentes sem
nenhum lugar que resuma "o que falta pra esta loja ir ao ar de verdade":

- catálogo nasce vazio (só `platform_clone_catalog` resolve, e só em catálogo vazio);
- horário e taxa de entrega herdam **em silêncio** os dados reais da Encanto até alguém configurar
  (já tinham banner de aviso — `StatusHorarioLoja`/`StatusPrecoEntrega`, REF-STORE-ONBOARD-01 Onda 1);
- coordenadas da loja ausentes fazem **todo pedido de entrega sair com taxa R$ 0,00**, silenciosamente —
  risco real, e sem nenhum aviso no Platform Console (só dentro do Admin da própria loja,
  `StatusLocalizacaoLoja` em `AdminTaxaEntrega.jsx`);
- ETA de entrega e modo da loja (AUTO/OPEN/CLOSED) herdam fallback genérico sem nenhum aviso em lugar
  nenhum;
- domínio próprio depende de um passo manual fora do app (CNAME no Registro.br — decisão já registrada
  na Onda 2/5 da REF-STORE-ONBOARD-01, wildcard abandonado por limitação real do Registro.br).

Decisão do dono (3 perguntas antes de iniciar): **checklist pós-criação** (não um wizard/stepper —
mantém o formulário atual como está), **incluir o passo de domínio como orientativo** (mostrar os
hostnames exatos, sem automatizar DNS), e **fechar também os avisos que faltavam** (coordenadas/ETA/modo),
já que é o mesmo tipo de risco que horário/entrega já cobriam.

## Onda 1 — Checklist de lançamento (CONCLUÍDA)

**Backend** (`migrations/REF-STORE-ONBOARD-02-onda1-checklist-lancamento.sql` + rollback): estende
`platform_tenant_detail` (aditivo, `RETURNS jsonb` sem mudança de assinatura) com 4 campos novos dentro de
`config`, ao lado dos já existentes (`tem_horario_config`/`tem_delivery_config`/`delivery_eta_min`):

| Campo novo | Deriva de |
|---|---|
| `tem_catalogo` | `count(products) > 0` |
| `tem_coordenadas` | `company_info.lojaLat`/`lojaLng` são números (mesmo critério de `localizacaoLojaConfigurada()`, `companyInfoRules.js`) |
| `tem_eta_customizado` | existe linha própria em `store_settings` (`delivery_eta_min`), não só o fallback |
| `tem_modo_customizado` | existe linha própria em `store_settings` (`store_mode`), não só o fallback |

Só expõe informação já existente — nenhuma tabela nova, nenhuma autorização nova (`is_super_admin()`
continua sendo o único gate). `tem_coordenadas` precisou de `COALESCE(..., false)` explícito: `jsonb_typeof`
de uma chave ausente retorna SQL `NULL`, não `false` — achado no primeiro teste, corrigido antes de aplicar
em E2E de novo.

**Frontend** (`src/components/admin/PlatformTenants.jsx`): novo bloco "🚀 Checklist de lançamento" dentro
de `DetalheTenant` (mesmo painel expansível por loja), acima da grade de 2 colunas já existente. 8 itens
✅/⚠️, cada um com nota curta explicando o risco e apontando para a seção/tela responsável — nenhum item
tem ação própria, é só leitura de `platform_tenant_detail()` + a mesma checagem HTTPS ao vivo (`verif`)
já computada para a seção "Domínios". O item de domínio reaproveita `hosts.storefrontUrl`/`hosts.adminUrl`
(hostnames determinísticos a partir do slug) e explica que o **valor exato do CNAME** só é conhecido depois
de anexar o domínio no projeto Vercel correspondente — não é um valor fixo previsível, então o checklist
não inventa um (achado da auditoria: o CNAME real da Aquarios Bar, `docs/adr/REF-STORE-ONBOARD-01-...md`
§9, é um hash específico por domínio, não um valor genérico).

**Testes**:
- `scripts/store-onboard-02-onda1-checklist-test.mjs` (E2E, dados descartáveis) — 22/22 PASS: loja
  recém-criada via `provision_store` real mostra os 4 campos novos + os 3 pré-existentes todos pendentes;
  mesma loja configurada por baixo (produto, `store_settings` upsert) mostra todos `true`, sem regressão
  nos campos antigos; caller sem sessão continua recusado.
- `e2e/tests/admin/platform-console.spec.js` — 1 teste novo (3/3 no arquivo, sem regressão nos 2 já
  existentes): mesma jornada via UI real — cria loja pela UI, confirma os 7 itens do checklist (exceto
  domínio, que depende de rede externa) como ⚠️, configura por baixo, vincula o admin pela UI (dispara o
  reload que traz o estado atualizado), confirma os 7 itens como ✅.

**Achado corrigido durante os testes** (não é regressão de outra REF, é bug introduzido nesta mesma onda):
o teste novo insere 1 produto descartável na loja de teste; o helper de limpeza `limparLojaDeTeste`
(compartilhado pelos 3 testes do arquivo) não deletava `products` antes de deletar `stores` — a 1ª rodada
completa deixou 1 loja + 1 produto órfãos (FK bloqueou o DELETE da loja, sem lançar erro visível no
resultado do teste). Corrigido adicionando `DELETE FROM products` ao helper antes do `DELETE FROM stores`;
resíduo da 1ª rodada removido manualmente (leitura + delete direto, confirmado 0 linhas depois); reexecução
completa confirmou 0 sobra.

**Verificações estáticas**: lint 0 erros (55 warnings, nenhum dos arquivos tocados — baseline pré-existente);
typecheck limpo; `test:domain` 0 falhas; `npm run build` e `npm run build:admin` OK.

**Não alterado**: `provision_store`, `invite-store-admin`, `platform_clone_catalog`, nenhuma RPC/RLS da
REF-AUTH-PLATFORM-ISOLATION-01, nenhum wizard/stepper novo.

**Estado**: implementado e validado 100% no projeto E2E, commit `a51d1eb` pushed (CI verde, run
33224656590) e **migration aplicada em produção**.

## Deploy em produção

Migration aplicada via `BEGIN...COMMIT` direto contra o Postgres de produção. Confirmado por leitura que
`platform_tenant_detail` passou a expor os 4 campos novos.

**Validação com dados reais** (`BEGIN...ROLLBACK`, líquido zero — nenhuma linha alterada):

| Loja real | `config` retornado |
|---|---|
| Encanto (ativa, totalmente configurada há muito tempo) | `tem_catalogo`/`tem_coordenadas`/`tem_horario_config`/`tem_delivery_config`/`tem_eta_customizado`/`tem_modo_customizado` = `true` (`delivery_eta_min: "60"`) |
| Aquarios Bar (suspensa, nunca configurada) | todos os 4 campos novos + os 2 pré-existentes = `false` (`delivery_eta_min: "45"`, o fallback) |

O resultado da Aquarios Bar é exatamente o cenário real que motivou esta REF: uma loja de produção sem
catálogo, sem coordenadas, sem horário/entrega próprios -- hoje o Platform Console mostra isso com clareza
no checklist, em vez de silêncio. Integridade reconfirmada após o teste: `admins`=2, `super_admins`=1,
status de ambas as lojas inalterado.

## Onda 2 — Transparência de configuração padrão/herdada (P5)

**Origem**: auditoria P5 (turno anterior) confirmou que uma loja sem `business_hours_schedule`/
`delivery_fee_config` próprios herda, em silêncio, o horário/tabela de preço REAIS da Encanto —
`get_business_hours_schedule`/`get_delivery_fee_config` (RPCs públicas, `GRANT EXECUTE TO anon`) nunca
informavam a proveniência do valor. Achado mais grave: o gate `lojaFechada` do Checkout (`!horario.aberto`)
usa exatamente esse horário para **desabilitar o botão de finalizar pedido** — uma loja nova podia ficar
impossibilitada de receber pedidos (ou aceitar fora do que o dono considera aberto) sem nenhum aviso, em
nenhum lugar, para o cliente final.

### O que foi feito

**Backend** (`migrations/REF-STORE-ONBOARD-02-onda2-transparencia-config-padrao.sql` + rollback):
aditivo — um campo novo `configuracao_propria: boolean` mesclado (`||`) ao objeto já retornado por
`get_business_hours_schedule` e `get_delivery_fee_config`, derivado de `EXISTS(...store_settings...)`.
Mesma assinatura, mesmo `SECURITY DEFINER`, mesmos grants (`CREATE OR REPLACE` não reseta grants).
Auditado antes de tocar: nenhum consumidor existente (`semanaFromSchedule`, `AdminBusinessHours`/
`AdminTaxaEntrega` no save) lê o objeto inteiro por igualdade — todos destructuram chaves específicas
ou reconstroem só as chaves que gravam, então o campo novo nunca vaza para o que é persistido.

**Frontend — engine/hooks** (sem tocar o engine puro de horário, como pedido):
- `hooks/useBusinessHours.js`: `calcular()` passa a incluir `configuracaoPropria` (lido do cache do
  cronograma, default `true` — "sem aviso" — enquanto o cache é só o `CRONOGRAMA_PADRAO` pré-1ª-sincronização).
- `services/delivery/deliveryFeeRules.js` (`montarResumoFinanceiro`): todo branch retorna
  `configuracaoPropria` agora, derivado de `config.configuracao_propria`. **Nunca confundido com**
  `status` (`sem_coordenadas`/`fora_de_alcance` continuam sinalizando falta de distância; `configuracaoPropria`
  cobre separadamente "a tabela em si não é da loja", mesmo com `status:'ok'` e cobrança normal).

**Frontend — cliente final** (texto sempre "Esta loja ainda está finalizando suas configurações." —
sem termos técnicos, conforme pedido):
- `StoreApp.jsx`: linha discreta sob a pílula de status do cabeçalho, quando `!horario.configuracaoPropria`.
- `CheckoutPage.jsx`: (a) mesma linha perto do bloqueio "🔒 Loja fechada", qualificando que o horário pode
  não ser definitivo — **sem mudar `lojaFechada` nem o bloqueio em si**; (b) mesma linha quando a loja
  está aberta mas o horário ainda é o padrão; (c) nota nova junto da linha "Entrega", só quando
  `status:'ok' && !configuracaoPropria` (coordenadas existem, tabela não é própria — cobrança segue
  igual, só avisa); (d) "Entrega: A confirmar" (sem coordenadas) ganhou uma frase curta explicando que o
  valor será combinado — comportamento/valor **inalterados**, só a explicação é nova.

**Frontend — Admin da loja**: `AdminStatus.jsx` (tela "Status da Loja", o ponto operacional mais visto no
dia a dia) ganhou um banner de pendências reaproveitando **a mesma fonte já existente**
(`useStoreConfigStatus` → `get_store_config_status`, REF-STORE-ONBOARD-01 · Onda 1) — zero duplicação de
lógica, zero mudança de backend para este banner específico.

**Platform Console (Onda 1)**: intocado — nenhuma mudança em `platform_tenant_detail`/`PlatformTenants.jsx`
nesta onda; regressão confirmada (3/3 em `platform-console.spec.js`).

### Achado colateral (infraestrutura de teste, não é bug de produção)

Ao escrever o teste de `AdminStatus`, `get_store_config_status` (RPC da REF-STORE-ONBOARD-01 · Onda 1,
**já em produção** desde aquela REF) retornou `404 PGRST202` no projeto E2E — nunca tinha sido aplicada
lá. Sem relação com esta onda; aplicada agora ao E2E (mesmo arquivo de migration já existente,
`migrations/REF-STORE-ONBOARD-01-onda1-config-status.sql`, sem alteração) só para meus testes
funcionarem — **não afeta produção** (que já a tinha).

### Testes

- `scripts/store-onboard-02-onda2-transparencia-test.mjs` (RPC real, `anon`, dados descartáveis) —
  **17/17 PASS**: cenários A-F (tudo configurado / sem horário / sem entrega / sem ambos / coordenadas +
  sem tabela própria via `montarResumoFinanceiro` real / restaurado) + isolamento entre 2 lojas
  simultâneas (loja B nunca reflete o que a loja A configurou).
- `tests/deliveryFee.golden.mjs` — 5 casos novos provando `configuracaoPropria` puro (default `true`,
  `false` explícito, não muda `deliveryFee`/`total`, independente de `sem_coordenadas`) + regressão no
  caso pré-existente (`deepStrictEqual` atualizado com o campo novo).
- `e2e/tests/store/config-padrao-transparencia.spec.js` (browser real, loja descartável com domínio
  próprio `{slug}.localhost`, resolvida via `get_store_by_domain`) — **4/4 PASS**: aviso no cabeçalho +
  "Entrega: A confirmar" com explicação (sem bloquear o formulário); loja fechada (forçado) com horário
  não-próprio mostra o aviso qualificando o bloqueio, **sem** alterar a regra (botão continua desabilitado);
  loja totalmente configurada não mostra nenhum aviso; `AdminStatus` mostra as pendências e some quando
  configurado.
- Regressão (specs existentes, sem alteração): `admin-status.spec.js`, `admin-taxa-entrega.spec.js`,
  `platform-console.spec.js`, `checkout-guest/logado/whatsapp.spec.js` (inclui "loja fechada bloqueia o
  checkout"), `admin-fidelidade.spec.js`, `admin-empresa-identidade-visual.spec.js`, `store/boot+catalog.spec.js`
  — **30/30 PASS**, nenhuma quebra.

**Limitação de escopo, deliberada**: o cenário "coordenadas presentes + tabela própria ausente" não tem
prova em navegador real nesta onda — exigiria construir, pela primeira vez, infraestrutura E2E de
endereço/geocoding para checkout com entrega (nenhum spec hoje faz isso; todos usam `retirada` para
evitar essa complexidade). Desproporcional para uma onda de transparência. Esse cenário já está provado
ponta a ponta (RPC real + `montarResumoFinanceiro` real, mesma função do Checkout) no script `.mjs` acima.

### Fora de escopo (conforme autorização)

- **Confiança financeira de `create_order`** (aceita `delivery_fee` do cliente sem recalcular no
  servidor) — achado real da auditoria P5, explicitamente separado para outra frente.
- **P4** (PWA manifest por tenant) — não tocado.
- Nenhuma mudança em `provision_store`, `platform_clone_catalog`, `invite-store-admin`, RLS ou qualquer
  RPC da REF-AUTH-PLATFORM-ISOLATION-01.

### Verificações estáticas

Lint: 0 erros (55 warnings, nenhum dos arquivos tocados — baseline pré-existente idêntico ao da Onda 1).
Typecheck: limpo. `test:domain`: 0 falhas. `npm run build`/`build:admin`: OK.

### Estado

Implementado e validado 100% no projeto E2E (migration da Onda 2 aplicada só lá). **Não aplicado em
produção** — aguardando autorização explícita de deploy. Commit local, push não pedido.
