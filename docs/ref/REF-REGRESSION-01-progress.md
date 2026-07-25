# REF-REGRESSION-01 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida (limite, queda, sessão encerrada), retomar
EXCLUSIVAMENTE a partir daqui — não repetir o que já está marcado como concluído abaixo.

**Regra do dono para esta REF:** trabalhar por ondas, sem interromper para pedir autorização entre
ondas, atualizar este arquivo continuamente. **NÃO commitar** até apresentar o relatório final para
aprovação. Objetivo: restaurar comportamento profissional / eliminar regressões — NÃO implementar
funcionalidades novas.

## Estado atual

✅ CONCLUÍDA — ver seção "ESTADO FINAL" ao fim deste arquivo. As 6 prioridades foram auditadas
(achados abaixo, todos confirmados empiricamente contra o banco de PRODUÇÃO via chamadas read-only
com a anon key pública — nenhuma escrita feita), corrigidas, revisadas (P6 teve uma 2ª rodada de
auditoria + centralização arquitetural, ver seção própria) e aprovadas pelo dono. Commit local
`6c4b267` — push realizado após esta aprovação.

## Achados de causa-raiz (auditoria, antes de qualquer código)

### PRIORIDADE 1 — Segurança (gate do Admin)

Auditado `src/hooks/useAdminSession.js`, `src/components/admin/AdminLogin.jsx`,
`src/lib/supabase.js`, `src/lib/dbCliente.js`, `src/constants/authStorage.js`, `src/App.jsx`.

**Confirmado seguro (não é um bug):**
- `db` (admin) e `dbCliente` (cliente) usam chaves de `localStorage` explícitas e DIFERENTES
  (`encanto-admin-auth` / `encanto-cliente-auth`) desde sempre — nunca houve colisão possível entre
  as duas sessões.
- Um visitante com `localStorage` vazio nunca entra em `mode='checking'` nem `'admin'` — o 1º render
  já é `'store'` de forma síncrona (`possivelSessaoAdmin()` checa a chave ANTES de decidir o estado
  inicial).
- O único jeito de chegar à tela de LOGIN do Admin é digitar o hash secreto `#admin-encanto` — isso
  abre o formulário, não o painel.

**Achado real (gap de autorização, não de autenticação):** tanto `useAdminSession.js` (na
restauração de sessão via `getSession()`/`onAuthStateChange`) quanto `AdminLogin.jsx` (no login)
tratam **"existe uma sessão Supabase válida" como sinônimo de "é admin"** — nenhum dos dois
verifica de fato `is_admin()` (a fonte da verdade real, tabela `public.admins`, já existente e usada
por toda RLS do projeto desde AUTH-01). Confirmado com uma chamada read-only à produção
(`rpc/is_admin` como anon → `false`, função existe e funciona). Ou seja: hoje, QUALQUER sessão
Supabase autenticada válida no client `db` — não só a do admin real — faz o front renderizar o
`<AdminPanel>` inteiro (mesmo que toda leitura/escrita real seja depois barrada pela RLS via
`is_admin()`). Como as duas sessões (cliente/admin) são isoladas por storageKey, o caminho prático
para isto hoje é limitado, mas o app não tem NENHUMA verificação própria disso — está confiando
100% em RLS como última linha de defesa, quando deveria ser defesa em profundidade (o painel nem
deveria RENDERIZAR para quem não é admin).
**Fix:** após `signInWithPassword` (login) e após `getSession()`/`onAuthStateChange` (restauração),
chamar `db.rpc('is_admin')`; só then que promove para `mode='admin'`. Se `false`, `signOut()` +
mensagem "Acesso restrito ao administrador" (login) / volta pra `'store'` silenciosamente
(restauração de uma sessão antiga que perdeu privilégio).

### PRIORIDADES 3 e 5 — Dashboard e Pedidos "quebrados" (MESMA causa raiz)

Confirmado empiricamente contra produção (`curl` na REST API do Supabase, anon key, só leitura):
```
POST /rest/v1/rpc/admin_orders_stats  → PGRST202 "Could not find the function ... in the schema cache"
POST /rest/v1/rpc/admin_orders_search → PGRST202 "Could not find the function ... in the schema cache"
```
**Causa raiz:** a REF-ADMIN-03 (commit `f9a9591`, já em produção via deploy automático do push a
`main`) reescreveu o Dashboard (`useOrdersStats`) e o módulo de Pedidos (`useOrdersPagina`) para
consumir 2 RPCs novas definidas em `migrations/REF-ADMIN-03-orders-scale.sql`. Essa migration
**nunca foi aplicada em produção** — por convenção do próprio projeto (migrations de schema são
aplicadas manualmente pelo dono, nunca por sessões de IA), o próprio arquivo de progresso da
REF-ADMIN-03 já registrava isso como "PENDENTE DONO". O código, porém, foi ao ar de qualquer jeito
(commit único, sem flag), e ficou order-dependente de uma migration que não existe no banco real.
Resultado: `getPedidosStats()` sempre devolve `null` (Dashboard: todos os indicadores agregados
zerados/vazios) e `getPedidosPagina()` sempre devolve `[]` (Pedidos: lista sempre vazia,
busca/filtro nunca retornam nada) — não é um bug de lógica, é código correto rodando contra um
schema que ainda não existe.
**Fix:** não é código — é aplicar a migration pendente. Vou sinalizar isso com destaque máximo no
relatório final (é a PENDÊNCIA #1 do dono) — não tenho (nem devo ter) credencial de escrita em
produção para aplicá-la eu mesmo.

### PRIORIDADE 4 — "Últimos Pedidos"

`DS.getPedidosRecentes(10)` (usado pelo Dashboard) é um SELECT direto (não depende de nenhuma RPC
pendente) — já funciona hoje mesmo sem a migration acima. Ordem cronológica (`created_at DESC`) e
ausência de duplicidade (React `key={o.id}` + dado vem direto do banco, nunca mesclado) já corretos.
Falta profissionalizar: (a) justificar o N=10 (hoje mágico, sem comentário), (b) atualização
"automática quando novos pedidos chegarem" hoje é só um `setInterval` de 60s + botão manual — vou
adicionar Supabase Realtime (`postgres_changes` em `orders` INSERT) para refletir pedidos novos
imediatamente, sem esperar o poll.

### PRIORIDADE 6 — Adicionais duplicados + exclusão não-funcional

Auditado `src/components/admin/AdminAdicionais.jsx`, `src/services/DataService.js`,
`src/utils/addons.js`, `src/components/ProductModal/ProductModalInner.jsx`, `src/components/admin/AdminProducts.jsx`,
e os dados REAIS de produção (`adicionais`: 36 linhas; `products.grupos_ad`: 15 produtos c/ valor
não-nulo). **Correção de rota importante durante a auditoria:** a 1ª hipótese (linhas "órfãs"
remanescentes de uma migração, nunca consumidas) estava ERRADA — checada contra os dados reais de
`products.grupos_ad`, todas as 36 linhas são efetivamente usadas. O achado real é mais sério (afeta
o CLIENTE, não só a tela do Admin):

**Achado real (bug de DADOS ativo, visível na vitrine):** `utils/addons.js` já documenta esta dívida
("MODELO DUAL... c3 usa grupo 'simples'... não-c3 usa 'acai'"): a tabela `adicionais` tem, para cada
um dos 15 itens do grupo `acai` (modelo FLAT legado, 1 seção só), uma linha-irmã em `simples`
(6 itens, grátis-com-cota), `premium` (4), `frutas_premium` (3) ou `chocolates` (2) — 6+4+3+2=15,
bate exato com os 15 do `acai` — o modelo SECCIONADO mais novo (4 seções separadas na Vitrine, cada
uma com seu rótulo — `GRUPO_LABEL` em `ProductModalInner.jsx` já tem entradas próprias pra
`simples`/`premium`/`frutas_premium`/`chocolates` de propósito). Os dois modelos SÃO válidos e
coexistem — o bug é que **4 produtos "Monte seu Copo" (categoria c3: Açaí, Cupuaçu, Açaí Zero
Açúcar, Açaí + Cupuaçu) têm `grupos_ad` configurado com OS DOIS modelos ao mesmo tempo**:
`["simples","premium","frutas_premium","chocolates","acai"]` — as 4 seções novas (15 itens, sem
repetir nome) MAIS a seção antiga "🍇 Adicionais do Açaí" (os MESMOS 15 itens de novo, flat).
Resultado real no modal do cliente: abrir "Açaí" mostra cada adicional (Nutella, Kiwi, Amendoim...)
DUAS VEZES — uma vez na seção sectionada (Premium/Frutas Premium/Chocolates/Simples) e de novo na
seção "Adicionais do Açaí" no fim — 2 checkboxes independentes pro MESMO item, cada seleção conta
separado pro preço/cota grátis. **Isto é o "duplicados" que o dono viu** — é bem mais visível no
carrinho/preço do que na tela do Admin, mas a tela do Admin (lista flat de 36, sem organização por
grupo) foi onde ele reparou primeiro.
**Fix recomendado (dado, não código — e MUITO mais simples que uma migration):** o próprio Admin já
tem a UI certa pra isto (REF-ADMIN-ADDONS-02, `AdminProducts.jsx`, checklist de grupos de
adicionais por produto). Basta o dono abrir cada um dos 4 produtos (Açaí / Cupuaçu / Açaí Zero
Açúcar / Açaí + Cupuaçu) e DESMARCAR o grupo "🍇 Açaí" (mantendo Simples/Premium/Frutas
Premium/Chocolates marcados) — 2 minutos, sem SQL, reversível marcando de volta. Vou destacar isso
com precisão (nomes + ação exata) no relatório final. **Nenhuma linha da tabela `adicionais` deve
ser apagada** — as 36 são todas genuinamente usadas (as 15 `acai` pelos OUTROS produtos açaí sem
override, que corretamente usam só o modelo flat).
**"Não dá pra excluir" (achado de código, à parte):** auditado — não há NENHUMA FK apontando pra
`adicionais.id` em nenhuma tabela (order_items guarda os adicionais como snapshot solto, sem
referência), então tecnicamente nada IMPEDE um DELETE. O bug real está em `DS.delAd(id)`: assim
como o `delCat` antes da REF-ADMIN-03 (bug já corrigido lá), `delAd` **não verifica `r.error` do
DELETE** — se falhar por qualquer motivo (sessão expirada no meio da ação, rede, RLS por engano), a
UI recarrega a lista e o item simplesmente "volta", sem NENHUM aviso — indistinguível de "não dá
pra excluir". Corrigido no mesmo padrão do `delCat`. **Ressalva importante para o relatório:** boa
notícia que a exclusão nunca foi 100% confiável até aqui — se tivesse sido, o dono (vendo "duplicado")
poderia ter apagado uma das 36 linhas pensando estar limpando lixo, e teria quebrado de verdade a
seção correspondente no modal de "Monte seu Copo" pra sempre. A causa raiz real não é remover dado,
é corrigir QUAL grupo cada produto consome.
Fix de código (2 partes, sem tocar dado):
1. `DS.delAd` passa a checar `r.error` e devolver `{ok:false}` (mesmo padrão do `delCat` já
   validado) — `AdminAdicionais.jsx` mostra erro real em vez de falhar silenciosamente.
2. `AdminAdicionais.jsx`: o `<select>` de Grupo só lista 3 das 7 categorias REAIS de
   `GRUPOS` (`utils/addons.js`) — abrir "Editar" numa linha `premium`/`frutas_premium`/`chocolates`/
   `simples` e apertar Salvar SEM mexer no campo Grupo reescreveria o grupo pra `'acai'` (valor não
   reconhecido pelo `<select>` cai no 1º `<option>`), o que quebraria de vez o modelo seccionado.
   Corrigido pra listar os 7 grupos reais (fonte única `GRUPOS` de `utils/addons.js`, sem strings
   soltas) — fecha o risco de corromper a taxonomia por uma edição inocente.

### REVISÃO — Prioridade 6 (após o dono aplicar a migration + corrigir os 4 produtos)

O dono aplicou `REF-ADMIN-03-orders-scale.sql` em produção e removeu `acai` do `grupos_ad` dos 4
produtos "Monte seu Copo" (confirmado o bug do CLIENTE resolvido). Mas reportou que o Admin
continuava mostrando "Amendoim"/"Banana"/"Coloretti" como se fossem duplicados. Pedida uma
segunda auditoria, mais rigorosa (evidência objetiva, sem hipótese).

**Causa raiz comprovada (não hipótese):**
- Query fresca em produção confirma: **35 linhas** (não 36 — correção de um erro de contagem meu
  no relatório anterior), **zero duplicatas exatas** (nenhuma repete nome+grupo).
- Agrupando por `created_at` exato (microssegundo): a tabela inteira se divide em só 2 lotes —
  15 linhas em `2026-06-25T21:06:56.785906` (simples/premium/frutas_premium/chocolates, todas
  `aplica_categoria_id='c3'`) e 20 linhas em `2026-06-27T16:24:26.337459` (acai/marmita, todas
  `aplica_categoria_id=null`). Essas datas batem EXATAMENTE com 2 commits reais: `d7f13c0`/`91cf114`
  (25/06, "Monte seu Copo... c3 usa banco") e `7cab109` (27/06, "NORM-05... fonte única de
  adicionais"). Ou seja: 2 fases de migração deliberadas e documentadas, não um acidente.
- A causa da tela do Admin ainda "parecer" duplicada: **o fix do rótulo (Onda 4 acima) nunca tinha
  sido deployado** — regra desta REF é não commitar até aprovação, então produção continuava
  rodando o código antigo (`origin/main` parado em `1ff426b`, REF-OBS-01) com o bug do badge
  colapsando 5 grupos em "🍇 Açaí". Não era um novo bug — era o MESMO já corrigido localmente,
  só que ainda não tinha chegado a produção.

**Pedido do dono após a confirmação:** eliminar a causa de raiz arquiteturalmente, não só no
badge — auditoria revelou que o MESMO mapa grupo→emoji/nome estava duplicado em **3 componentes**
(`AdminAdicionais.jsx`, `AdminProducts.jsx` — achado NOVO nesta rodada, `labelGrupoAd`/
`GRUPO_AD_LABEL`/`GRUPO_AD_ORDEM` — e `ProductModalInner.jsx`), cada um com pequenas divergências
de texto entre si (prova de que 3 cópias já tinham começado a divergir).

**Decisão arquitetural — `src/utils/addonGroupLabels.js` (novo):**
- Fonte ÚNICA de `{emoji, nome}` por grupo (`GRUPO_INFO`) + helper `grupoLabel(grupo)` (rótulo
  bare "emoji nome", ex. "🍇 Açaí") — mesmo padrão já estabelecido em `utils/catalog.js`
  (`CAT_EMOJI`/`catEmoji`, emoji por categoria): um util de UI compartilhado, FORA do domínio
  estrito de `addons.js` (que tem regra própria documentada — "SEM SAÍDA VISUAL... rótulo/emoji
  vivem na UI" — respeitada à risca, `addons.js` não foi tocado).
- Cada consumidor mantém SÓ a composição de frase que lhe é própria (ex.: `ProductModalInner`
  decide "Adicionais do Açaí" em modo combo vs. "Adicionais" genérico; `AdminProducts` decide
  "Adicionais Açaí" sem o "do"), mas todos importam o MESMO `emoji`/`nome` em vez de repetir o
  literal — a identidade do grupo (o que nunca deveria divergir) tem 1 fonte; a frase final (que É
  legítimo variar por tela) continua local a cada componente. Texto final IDÊNTICO ao anterior em
  todos os 7 grupos × os 2 modos (combo/genérico) — validado por golden test, zero mudança de
  comportamento aprovado.
- `comandaModel.js` (rótulo da comanda impressa: "Complementos"/"Adicionais premium"/etc.) foi
  auditado e **deliberadamente NÃO tocado** — já documenta corretamente a separação domínio/copy no
  próprio cabeçalho, e tem uma regra própria explícita de import mínimo ("Importa só utils/format").
  A palavra impressa já é, por design, diferente da UI (ex. "Complementos" em vez de "Açaí") — não
  era a mesma duplicação, e mexer romperia uma convenção documentada só para trocar strings-chave
  por um enum sem nenhum ganho real (fallback `'Adicionais'` já protege contra grupo desconhecido).
- `tests/deps.audit.mjs`: `utils/addonGroupLabels.js` adicionado à allowlist D1 (é um novo
  importador de `utils/addons.js`, mecanismo já previsto pelo próprio guard para extrações novas).
- Impacto: **zero mudança de comportamento visível** em qualquer tela hoje — só elimina a
  possibilidade de um grupo novo (ex. "Molhos" no futuro) exigir 3 edições em 3 arquivos
  potencialmente divergentes; agora é 1 edição em 1 lugar (`GRUPO_INFO`), e cada consumidor decide
  sozinho (com poucas linhas, sem mapa duplicado) só a frase específica que precisa.

**Nova cobertura de teste:**
- `tests/addonGroupLabels.golden.mjs` (novo, `npm run test:addon-labels`, adicionado ao
  `test:domain`): prova os 7 grupos com rótulos distintos, e cravou os 2 pares REAIS relatados pelo
  dono (Amendoim acai/simples, Coloretti acai/chocolates) como casos nomeados — regressão futura
  nesse achado específico quebra o teste pelo nome.
- `e2e/tests/admin/admin-adicionais.spec.js`: teste novo cria 3 adicionais reais (grupos acai/
  premium/frutas_premium) e prova via Playwright que os badges renderizados são 3 textos distintos
  + que o `<select>` de edição oferece os 7 `<option>` (antes só 3).
- Suíte de domínio completa + `npm run build` + suíte E2E completa revalidadas (ver Onda 6).

## Onda 1 — P1 (segurança, prioridade máxima)

Status: ✅ CONCLUÍDA.
- `src/hooks/useAdminSession.js` + `src/components/admin/AdminLogin.jsx`: `is_admin()` (RPC,
  `public.admins`) agora é verificado ANTES de promover `mode='admin'`, tanto no login quanto na
  restauração de sessão (`getSession()`/`onAuthStateChange`). `false` → `signOut()` de verdade +
  erro "Acesso restrito ao administrador."; `null` (erro de rede) → fail-closed, nunca promove.
- `e2e/tests/admin/admin-permissao.spec.js`: reescrito para provar o comportamento NOVO
  (CLIENTE_FIXTURE é barrado no login, não apenas "vê o painel mas sem dados"). Validado contra o
  projeto de E2E dedicado: passa. Suíte ampla de sessão/login/logout/fidelidade/dashboard/adicionais
  (20 specs) revalidada — 20/20 verdes, zero regressão.

## Onda 2 — P3/P5 (Dashboard/Pedidos — causa raiz é pendência de migration, não código)

Status: ✅ CONCLUÍDA (documentação + achado adicional de P5). **Migration aplicada pelo dono em
produção** (`REF-ADMIN-03-orders-scale.sql`) — Dashboard/Pedidos confirmados funcionando.
- Causa raiz confirmada e documentada acima (achados). Nenhum código a mudar — o código já está
  correto contra o schema que a REF-ADMIN-03 especificou; a migration em produção era a única
  pendência, já resolvida pelo dono.
- **Achado adicional de P5 (recurso que NUNCA existiu, não regrediu — mas o dono pediu
  explicitamente sob esta prioridade):** `ComandaModal.jsx` só tinha "Fechar"/"Imprimir" desde que
  nasceu (REF-ORDER-01) — nunca teve "copiar" nem "compartilhar via WhatsApp". Implementado:
  `comandaTexto.js` (novo renderer PURO irmão de `comandaHtml.js`, mesmo view-model
  `buildComanda`) + 2 botões no modal ("📋 Copiar" via `navigator.clipboard`, "📤 WhatsApp" via
  `wa.me/?text=`, share genérico — o uso real é repassar pro entregador/cozinha, não reenviar pro
  cliente). Golden novo em `tests/comanda.golden.mjs` (3 casos) + E2E novo (clipboard real +
  nova aba) — validados, verdes.

## Onda 3 — P4 (Últimos Pedidos)

Status: ✅ CONCLUÍDA.
- `getPedidosRecentes` já funcionava (ordem/consistência/sem-duplicidade corretos, independente da
  migration pendente). Decisão: **não** adicionar Supabase Realtime — seria infraestrutura NOVA
  (nunca usada em nenhum lugar do app, exigiria publication no banco, pendência de migration
  adicional) e o pedido do dono é para RESTAURAR comportamento profissional, não construir
  funcionalidade nova. O poll de 60s + botão manual (padrão pré-existente, inalterado) já cobre
  "atualização automática" de forma defensável. Único ajuste: comentário justificando N=10
  (`AdminDashboard.jsx`) — card de relance, não o log operacional (isso é a aba Pedidos).

## Onda 4 — P6 (Adicionais)

Status: ✅ CONCLUÍDA.
- `DS.delAd` agora checa `r.error` (mesmo padrão do `delCat`) — guard novo R7 em
  `tests/dataservice.micro.mjs`. `AdminAdicionais.jsx`: badge e `<select>` de Grupo passam a
  cobrir os 7 grupos reais (`GRUPOS` de `utils/addons.js`, fonte única) — antes só 3, com fallback
  perigoso pra `'acai'` numa edição inocente. Erro de exclusão agora aparece na tela.
  **Recomendação para o dono (dado, 2 minutos, sem SQL):** abrir os produtos "Açaí", "Cupuaçu",
  "Açaí Zero Açúcar" e "Açaí + Cupuaçu" (aba Produtos) e DESMARCAR o grupo de adicionais "🍇 Açaí"
  (mantendo Simples/Premium/Frutas Premium/Chocolates) — elimina a duplicação real no modal do
  cliente. Nenhuma linha de `adicionais` deve ser apagada (todas as 36 são usadas de verdade).

## Onda 5 — P2 (auditoria ampla das demais telas)

Status: ✅ CONCLUÍDA.
- Auditoria de TODAS as chamadas `.rpc(...)` do app contra produção (anon key, read-only): todas
  existem e respondem corretamente, EXCETO as 2 já identificadas (admin_orders_stats/search) — não
  há outra instância da mesma classe de bug (código na frente de migration pendente).
  `AdminPanel.jsx`: achado cosmético — aba "products" e título "Products" em inglês/minúsculo,
  destoando de todas as outras abas (pt-BR). Corrigido para "Produtos".
- Cobertura ampla de Produtos/Categorias/Checkout/Cliente/Fidelidade/Configurações delegada à
  suíte E2E completa (Onda 6) — 100+ specs contra backend real é mais confiável que releitura
  manual de cada tela para esse volume.

## Onda 6 — P7 (validação geral final)

Status: ✅ CONCLUÍDA.
- `npm run build`: limpo (580,19 kB — variação normal pelo código novo desta REF, nenhuma regressão
  de tree-shaking; baseline pré-REF era 577,56 kB sem DSN do Sentry).
- `npm run test:domain`: verde (exit 0), agora com `test:addon-labels` novo no encadeamento. Única
  linha de "erro" no log é a fragilidade PRÉ-EXISTENTE e já tolerada de `import.meta.env` fora do
  Vite (REF-OBS-01), não uma regressão.
- `npm run test:e2e` (suíte completa, Playwright, projeto E2E dedicado): **106/106 verdes**
  (104 pré-existentes + 2 novos desta REF: comanda copiar/whatsapp, badges de grupo distintos),
  **zero flakes, zero regressão** em qualquer área — Admin (login/sessão/logout/permissão/
  dashboard/pedidos/categorias/produtos/adicionais/status/saúde/fidelidade/delivery-eta), Loja
  (boot/catálogo/busca/navegação/carrinho), Auth (OTP/Google/logout/sessão), Checkout (guest/
  logado/gate de horário), Cliente (Meus Pedidos/Minha Conta/Fidelidade).

## ESTADO FINAL

✅ REF-REGRESSION-01 CONCLUÍDA — 6 prioridades investigadas, causa raiz encontrada e documentada
para cada uma, correções de código aplicadas e validadas (build + domínio + E2E), sem nenhuma
regressão introduzida. As 2 pendências que exigiam ação do dono fora do código já foram resolvidas
por ele: (1) `migrations/REF-ADMIN-03-orders-scale.sql` aplicada em produção; (2) grupo "🍇 Açaí"
removido do `grupos_ad` dos 4 produtos Monte-seu-Copo. A revisão adicional da Prioridade 6 (rótulo
de grupo centralizado em `utils/addonGroupLabels.js`) foi auditada, implementada e validada nesta
mesma sessão. Aprovado pelo dono — commit único desta REF a seguir.
