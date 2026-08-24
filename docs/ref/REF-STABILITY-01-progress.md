# REF-STABILITY-01 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui.

**Regra do dono:** execução autônoma, causa raiz antes de qualquer código, nenhum workaround/gambiarra,
preservar arquitetura existente. Interromper só em risco de perda de dados, mudança arquitetural
imprevista ou decisão de produto ambígua — nenhum desses casos ocorreu.

## Estado atual

✅ CONCLUÍDA — 2 problemas relatados investigados até a causa raiz, corrigidos, com testes novos que
protegem especificamente contra a volta de cada um. `build` limpo, `test:domain` 100% verde,
`test:e2e` **114/114** verde (2 specs novos desta REF).

## Problema 1 — Exclusão de adicionais

### Auditoria (antes de qualquer código)

Investigação em ordem, cada camada verificada com evidência real (nunca suposição):

1. **Frontend** (`AdminAdicionais.jsx`): botão 🗑 já chama `window.confirm` → `DS.delAd(it.id)` → mostra
   `erroExclusao` se `!r.ok` → `load()`. Código correto na superfície.
2. **DataService** (`delAd`): checava `r.error`, mas retornava `{ok:true}` sempre que a chamada não
   lançasse exceção — **não verificava se alguma linha foi de fato excluída**.
3. **RLS/policies**: `DELETE` em `public.adicionais` exige `is_admin()`. Testado DIRETO contra
   produção (conexão Postgres do dono, `BEGIN...ROLLBACK`, zero escrita persistida): `is_admin()`
   avalia `true` para o admin real; um `DELETE` de uma linha sintética E de duas linhas REAIS
   existentes (uma com `aplica_categoria_id` preenchido, outra `NULL`) afetou `rowCount=1` em todos os
   casos — **RLS não bloqueia a exclusão**.
4. **FK/constraints/triggers**: consulta direta ao catálogo do Postgres (`information_schema`,
   `pg_constraint`, `pg_trigger`) confirma que **nada referencia `adicionais.id`** (nenhuma FK de
   qualquer outra tabela aponta para lá); o único trigger da tabela (`trg_sti_adicional_categoria`)
   dispara só em `INSERT/UPDATE`, nunca em `DELETE` (documentado explicitamente na migration NORM-06
   F1B: "DELETE/TRUNCATE não podem CRIAR inconsistência de tipo, só removem linhas"). CHECK constraints
   validam domínio de valor (`grupo`/`tipo`), não bloqueiam exclusão.
5. **Identidade do admin**: confirmado que `public.admins.user_id` corresponde exatamente ao usuário
   `<email-real-admin-encanto>` (redigido; único admin cadastrado), o mesmo usado no teste de RLS acima — sem
   ambiguidade sobre "qual admin" foi testado.

### Causa raiz

`DataService.delAd()` não conseguia distinguir **"excluído com sucesso"** de **"RLS filtrou o DELETE
para 0 linhas, sem gerar nenhum erro"** — no Postgres/PostgREST, um `DELETE` cujo `WHERE` (aqui, a
policy `USING(is_admin())`) não casa nenhuma linha **não é uma condição de erro**, é só um `DELETE` que
afetou 0 linhas; o supabase-js só devolve essa contagem se a query pedir explicitamente
`.select()` (`Prefer: return=representation`). Sem isso, **qualquer momento em que a sessão do admin
não satisfaça `is_admin()`** (token expirado, corrida de refresh, qualquer instabilidade transitória de
auth) produz exatamente o sintoma relatado: nenhum erro aparece, e o item reaparece no próximo `load()`
— indistinguível de "não dá pra excluir".

**Desde quando:** o padrão existe desde a criação de `delAd` (REF-APP-01 · Onda 2, move puro do
App.jsx) — a REF-REGRESSION-01 (`5480f5f`) melhorou parcialmente (parou de ignorar `r.error`), mas não
fechou este ângulo específico (falso-positivo de sucesso), que sobrevive até hoje. `delProd`/`delCat`
compartilham a MESMA classe de lacuna (achado documentado abaixo, fora de escopo desta correção — ver
"Achados não corrigidos").

### Solução

`delAd` agora encadeia `.select('id')` no `.delete()` (força o PostgREST a devolver as linhas
efetivamente excluídas) e distingue os 3 desfechos possíveis: erro real (`r.error`), exclusão
silenciosamente filtrada (`!r.data?.length` — mensagem clara, orienta a atualizar a página) e sucesso
genuíno. Nenhuma proteção existente foi tocada (não havia nenhuma proteção de integridade referencial
real para remover ou preservar — a investigação confirmou que não existe FK/trigger de bloqueio).

**Arquivo:** `src/services/DataService.js` (`delAd`).

### Teste novo (gap de cobertura fechado)

`scripts/norm06-1-rls-test.mjs` (`test:rls`) nunca testava `DELETE` sob `authenticated`/admin para
NENHUMA tabela — só media "não deu erro" (`expectAllowed`), o que não distingue de um `DELETE`
filtrado. Adicionados `BW5`/`BW6`: criam uma linha própria (adicionais/products) e medem `rowCount`
real do `DELETE` — provam mecanicamente que a exclusão afeta linha de verdade, não só "sem erro".
Rodado contra produção (BEGIN/ROLLBACK, net-zero): **17/17 PASS**.

### Achado não corrigido (fora de escopo, documentado por transparência)

`delProd`/`delCat` têm a MESMA lacuna estrutural (`delProd` nem checa `r.error`; `delCat` checa erro
mas não verifica `data.length` no caminho de sucesso). Não fazem parte do problema relatado
("adicionais") e corrigi-los exigiria tocar os componentes chamadores (`AdminProducts.jsx`/
`AdminCategorias.jsx`) para propagar a nova mensagem — decidido deixar de fora desta REF para não
aumentar o raio de mudança além do necessário. Recomenda-se uma REF futura dedicada se o dono quiser
fechar essa classe de bug de ponta a ponta.

## Problema 2 — Regressão da transição Loja → Admin (flash/"vulto")

### Auditoria e causa raiz

REF-CUSTOMER-01 · Parte 2 já tinha corrigido o flash ORIGINAL (tela inteira da Loja piscando) — o
"vulto" relatado agora é um remanescente MENOR, com DUAS causas distintas, ambas em
`hooks/useAdminSession.js`:

1. **Achado 1/2 — liga tarde demais:** `verificandoSessao` (o sinal que troca o formulário de login por
   "Verificando sessão...") nascia `false` e só virava `true` dentro de um `useEffect` — que roda
   DEPOIS do commit/1º paint do React. Toda vez que `mode` virava `'login'` (clique na engrenagem OU
   hash `#admin-encanto`), havia exatamente 1 frame onde `AdminLogin` já estava montado com
   `verificandoSessao` ainda `false` — o formulário real (com os campos de e-mail/senha) chegava a
   pintar antes do efeito corrigir. Isso é o "vulto": menor que o flash original (que mostrava a Loja
   inteira), mas ainda uma pintura errada.
2. **Achado 2/2 — desliga cedo demais (achado só depois, pelo teste novo):** ao corrigir o (1),
   escrevi um teste com `MutationObserver` (deliberadamente mais rigoroso que os testes por polling já
   existentes — ver seção de testes) que PEGOU um segundo problema, pré-existente desde a própria
   REF-CUSTOMER-01 · Parte 2 e nunca detectado: o efeito que resolve a checagem desligava
   `verificandoSessao` assim que `getSession()` respondia — **antes** de `promoverSeAutorizado` (que
   ainda faz um round-trip de rede real para `is_admin()`) terminar. Nessa janela (a chamada de rede
   inteira, não 1 frame), o formulário de verdade reaparecia por baixo enquanto o hook ainda esperava
   a confirmação de admin.

### Por que os testes antigos não pegavam isso

Os testes existentes de anti-flash usam `toHaveCount(0)`/`toBeVisible()` — asserções com *polling*
(o Playwright reavalia em intervalos). Um "vulto" de ~16ms (1 frame) ou até uma janela de rede que o
polling não amostra no instante certo pode nunca ser observado por essas asserções, mesmo com o bug
presente — foi exatamente o que aconteceu (a suíte ficava 100% verde com a regressão ativa).

### Solução

- **Achado 1/2:** o valor inicial de `verificandoSessao` passou a ser calculado de forma SÍNCRONA, no
  mesmo instante/render em que `mode` passa a `'login'` — no `useState` inicial (entrada por hash) e em
  `abrirLogin()` (clique na engrenagem), sempre via `possivelSessaoAdmin()`. React 18 agrupa os
  `setState`s de cada um desses pontos num único render — a 1ª pintura de `AdminLogin` já nasce
  correta, sem depender de nenhum efeito.
- **Achado 2/2:** o efeito que resolve a checagem agora `await`s `promoverSeAutorizado(...)` (ou o
  fallback de sessão ausente) **antes** de desligar `verificandoSessao` — só sai da tela de
  "Verificando sessão..." quando o desfecho real (promovido a admin, recusado, ou mantido em `'login'`
  para digitar credencial) já está decidido, nunca no meio do caminho.

Nenhuma mudança na máquina de estados (`mode`), nas regras de promoção/autorização, ou na arquitetura
do hook — só o TIMING de quando `verificandoSessao` liga/desliga.

**Arquivo:** `src/hooks/useAdminSession.js`.

### Testes novos (protegem contra a volta do bug)

`e2e/tests/admin/admin-sessao.spec.js` — 2 specs novos, usando `MutationObserver` ligado ANTES do
gatilho (clique/navegação) para gravar se o formulário `[data-testid="admin-login-senha"]` alguma vez
entrou no DOM, não importa por quantos ms — não depende de o polling do Playwright "acertar" o
instante certo:
- "gear com sessão já válida: formulário de login NUNCA entra no DOM, nem por 1 frame"
- "hash #admin-encanto já autenticado: formulário de login NUNCA entra no DOM, nem por 1 frame"

Achado 2/2 só foi descoberto porque esses testes novos são estruturalmente mais rigorosos — rodados
uma 1ª vez, capturaram o problema (`viu === true`); corrigido; rodados de novo, verdes.

## Auditoria extra

Revisão focada nos arquivos mais recentemente alterados (REF-AUTH-02/CUSTOMER-01/SENTRY-01):
`AuthProvider.jsx` (sessão do cliente) — mesmo padrão de restauração (`getSession()` +
`onAuthStateChange`), com `status='loading'` como estado próprio (nunca renderiza a tela errada
enquanto carrega, diferente do bug do Admin) — sem sinal de flash equivalente. `StoreApp.jsx` — botão
da engrenagem chama `onAdmin` (=`abrirLogin`) diretamente, sem wrapper assíncrono, confirmando que o
agrupamento de `setState` do fix acima realmente se aplica. Nenhuma outra regressão funcional
perceptível encontrada dentro do escopo revisado.

## Testes e evidências

- `npm run build`: limpo, 585,85 kB (variação desprezível vs. antes desta REF).
- `npm run test:domain`: 100% verde (nenhum teste novo de domínio necessário — as duas correções são
  puramente de integração/timing, cobertas por E2E e pelo guard de RLS).
- `npm run test:rls` (contra produção, BEGIN/ROLLBACK, net-zero): **17/17 PASS** (2 novos: BW5/BW6).
- `npm run test:e2e`: **114/114 verde** (2 novos). 1ª rodada teve 2 falhas: (a)
  `admin-produtos-tamanhos.spec.js` — falha de infraestrutura (script `main.jsx` não carregou,
  diagnóstico do próprio REF-BOOT-02 confirmou; instabilidade transitória do servidor de dev, não
  relacionada ao código desta REF — reconfirmado verde na 2ª rodada); (b) o novo teste anti-flash de
  gear-click — pegou o achado 2/2 real (ver acima), corrigido, verde na 2ª rodada.

## Regressões verificadas

- Suíte E2E completa 114/114 — nenhuma quebra em checkout/login/fidelidade/CRUDs administrativos/
  navegação/busca.
- `test:rls` 17/17 — nenhuma mudança de comportamento em nenhuma policy além do que já existia; os
  testes novos são só medição adicional (rowCount), não alteram nenhuma policy.

## Nota — outro trabalho em andamento no repositório

Durante a execução desta REF, o `git status` mostrou alterações NÃO relacionadas já presentes no
working tree (atualização de telefone/WhatsApp para `(47) 99272-2920` em `AdminFidelidade.jsx`,
`constants/storeInfo.js`, `lib/supabase.js`, `pages/StoreApp.jsx`, e `.gitignore`) — claramente
trabalho de outra sessão/ator, não tocado por esta REF. Staging desta REF foi feito por NOME DE
ARQUIVO explícito (nunca `git add -A`), preservando esse trabalho intacto e não commitado por mim.

## PRÓXIMO PASSO

Nenhuma pendência conhecida. Relatório final entregue ao dono nesta sessão. Sugestão para o futuro
(não implementada, fora de escopo): aplicar a mesma verificação de `rowCount` real (`.select()`) a
`delProd`/`delCat`, fechando a mesma classe de bug nos outros 2 CRUDs administrativos.
