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

**Estado**: implementado e validado 100% no projeto E2E. **Migration NÃO aplicada em produção** — aguardando
autorização explícita de deploy (regra do projeto: nenhuma mutação de produção sem pedido específico).
Commit local, push não pedido.
