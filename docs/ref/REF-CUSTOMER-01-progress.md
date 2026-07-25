# REF-CUSTOMER-01 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui.

**Commit-base desta REF:** `6e1f0ed` (REF-AUTH-02, já commitada, pushada e validada em produção).
**Regra do dono:** execução autônoma em ondas, sem interrupção entre elas; commit ao final de cada onda
concluída e validada.

## Estado atual

✅ CONCLUÍDA — 3/3 partes implementadas + revisão pós-implantação da política de limpeza do
guestIdentity, testadas (domínio + E2E completo, 112/112) e commitadas.

## Parte 1 — Persistência inteligente do cliente

**Causa raiz (não é regressão de código nesta base):** busca em todo o histórico do git
(`git log --all -S"form.nome"`, `-S"guest"`) desde o commit-baseline `cade7a4` (App.jsx monolítico,
3753 linhas) mostrou que **nunca existiu** um mecanismo de persistência local de nome/telefone para
visitante (guest) neste repositório. `CheckoutPage.jsx` só pré-preenche esses campos para o cliente
**autenticado** (`isLogged && customer`, via REF-CLIENTE-02, commit `1e3e9d8`) — guest sempre começou
com o formulário vazio, em qualquer commit do projeto. O endereço, por outro lado, já funcionava
corretamente (REF-CHECKOUT-ADDRESS-01: `AddressProvider` é fonte única, compartilhada entre Home e
Checkout) — não havia regressão aí.

**Solução — fonte única de verdade explícita:**
- `src/utils/guestIdentity.js` (novo): cache LOCAL e TEMPORÁRIO (`localStorage`, chave
  `encanto_guest_identity` em `constants/storage.js`) de nome/telefone do visitante. `lerGuestIdentity`/
  `salvarGuestIdentity`/`limparGuestIdentity` — folha pura, mesmo padrão de `constants/storage.js`.
- `CheckoutPage.jsx`: novo efeito que pré-preenche do cache **somente** quando `status === 'anon'`
  (resolvido definitivamente pelo `AuthProvider` — não `!isLogged`, que também é `false` durante
  `'loading'` e criaria uma corrida com o efeito do cliente logado). Grava no cache **somente** quando
  `!isLogged` (guest) e o pedido é criado com sucesso — cliente logado nunca escreve nesse cache (já
  tem o Supabase como fonte).
- `AuthProvider.carregarCustomer`: no EXATO momento em que um `customer` com `phone` carrega de
  verdade (Supabase vira fonte oficial), chama `limparGuestIdentity()` — **nunca mescla, encerra**. É o
  único ponto que limpa; garante que nunca existam duas fontes permanentes para o mesmo dado.
- `CompletarCadastro.jsx` (1º acesso pós-login, coleta nome+telefone): pré-preenche os campos a partir
  do cache de visitante, se existir — reaproveita o que a pessoa já digitou como guest em vez de pedir
  de novo. É o único lugar que ESCREVE no Supabase (via `completarCadastro`/`link_customer_to_auth`);
  o sucesso ali já aciona `carregarCustomer`, que limpa o cache — sem duplicar a limpeza aqui.

**Zero mudança** em `AddressProvider`, `DataService`, RPCs, ou no caminho do cliente já logado
(pré-fill via `customer.name`/`customer.phone` continua idêntico).

**Arquivos:** `src/constants/storage.js`, `src/utils/guestIdentity.js` (novo),
`src/components/checkout/CheckoutPage.jsx`, `src/providers/AuthProvider.jsx`,
`src/components/menu/CompletarCadastro.jsx`, `tests/guestIdentity.golden.mjs` (novo, 7 casos),
`package.json` (`test:guest-identity` no `test:domain`), `e2e/tests/checkout/checkout-guest.spec.js`
(+1: guest lembrado no pedido seguinte), `e2e/tests/checkout/checkout-logado.spec.js` (+1: cache de
visitante divergente nunca sobrescreve o customer logado — prova a fonte única).

### Revisão pós-implantação — política de limpeza do guestIdentity (dispositivo compartilhado)

Perguntado explicitamente pelo dono qual era a política de limpeza do cache (TTL? logout? troca de
usuário?), a resposta honesta na 1ª entrega desta REF era: **nenhuma dedicada**. O único gatilho de
limpeza era `AuthProvider.carregarCustomer` (`if (cust?.phone) limparGuestIdentity()`) — cobre a
transição da MESMA pessoa de visitante para cadastrada, mas não fecha: (a) logout do cliente nunca
limpava o cache; (b) sem TTL, um cache "esquecido" num navegador ficava vivo indefinidamente; (c) numa
troca de usuário onde o novo usuário AINDA não tem telefone vinculado, o cache da pessoa anterior
vazaria para o formulário de 1º acesso dela.

**Aprovado pelo dono para implementar nesta mesma REF** (explicitamente SEM a solução de UX "Não sou
eu?", que fica para uma referência própria caso necessário):
- **Logout limpa o cache** — `AuthProvider.sair()` agora chama `limparGuestIdentity()` além de
  `signOut()`/resetar `customer`. Fecha o caso "usuário loga, usa, desloga — o próximo visitante no
  mesmo aparelho não deveria herdar nada".
- **TTL de 30 dias, validado na LEITURA** (`lerGuestIdentity`, não na escrita) — `salvarGuestIdentity`
  agora grava `savedAt` (epoch ms); ao ler, se `Date.now() - savedAt > 30 dias` (ou `savedAt` ausente —
  formato desconhecido tratado como expirado, falha pro lado seguro), o cache é descartado
  (`limparGuestIdentity()`) e a função devolve `null` — nunca fica "vivo pra sempre".
- **`version` gravado no payload** (valor `1`, não interpretado ainda) — só para permitir uma
  migração/rejeição deliberada se o formato mudar numa REF futura, sem precisar adivinhar payloads
  antigos.
- **Limitação conhecida e aceita conscientemente:** dois VISITANTES diferentes usando o mesmo
  navegador **sem nenhum login entre eles** ainda podem herdar nome/telefone um do outro dentro da
  janela de 30 dias — o TTL reduz a exposição, mas não fecha esse caso por completo. Requer uma
  affordance de UI ("Não sou eu?"/limpar dados), decisão de produto maior, propositalmente fora do
  escopo desta REF.

**Arquivos adicionais desta revisão:** `src/utils/guestIdentity.js` (TTL/version/savedAt),
`src/providers/AuthProvider.jsx` (`sair()` limpa o cache), `tests/guestIdentity.golden.mjs` (+4 casos:
version/savedAt gravados, TTL 29 dias válido, TTL 31 dias expira e remove, `savedAt` ausente expira),
`e2e/tests/auth/logout.spec.js` (+1: logout limpa o cache de visitante, mesmo com um cache "de outra
pessoa" pré-existente no navegador).

**Testes desta revisão:** build limpo; `test:domain` 100% verde (11/11 em `guestIdentity.golden`,
antes 7); suíte E2E completa **112/112** (antes 111 — +1 do logout). Zero regressão.

## Parte 2 — Refinamento visual do Login Admin (sem tocar a REF-AUTH-02)

**Causa raiz:** a máquina de estados da REF-AUTH-02 está correta — `mode='login'` monta
`AdminLogin` imediatamente; só depois do round-trip `getSession()`+`is_admin()` é que promove pra
`'admin'` (se houver sessão válida). Isso causava um "flash" perceptível do formulário antes do
painel aparecer.

**Solução (puramente de apresentação, ZERO mudança na máquina de estados/segurança):** novo estado
`verificandoSessao` em `useAdminSession.js` — `true` apenas quando `mode==='login'` **e** há evidência
de sessão salva (`possivelSessaoAdmin()`); `false` assim que a checagem resolver (positiva ou
negativa). `AdminLogin.jsx` renderiza `AdminSessionChecking` (componente já existente, reaproveitado —
mesmo usado no F5 dentro do painel) enquanto `verificandoSessao` for `true`, em vez do formulário.
`mode` continua exatamente com as mesmas transições/condições de promoção de antes — nenhuma regra de
autorização foi tocada. Sem sessão salva, o formulário aparece imediato (zero atraso).

**Arquivos:** `src/hooks/useAdminSession.js`, `src/components/admin/AdminLogin.jsx`, `src/App.jsx`
(repassa `verificandoSessao`), `e2e/tests/admin/admin-sessao.spec.js` (asserção nova: formulário nunca
aparece, nem por 1 frame, quando já há sessão válida).

## Parte 3 — "Minha Conta" do Admin

Investigação do schema real (`public.admins`, via credencial temporária fornecida pelo dono — usada só
em memória de processo, nunca escrita em arquivo, script apagado após uso) mostrou que a tabela só tem
`id/user_id/created_at` — sem nome/telefone/foto. Mas o Supabase Auth (`session.user`) já traz de graça
`user_metadata.full_name`/`picture` (quando login via Google), `email`, `last_sign_in_at`,
`created_at` — **zero schema novo necessário**. Dado isso, implementei a versão completa (não só a
preparação) nesta REF: aba nova "Minha Conta" no `AdminPanel`, mostrando e-mail/último login/criado-em
(somente leitura, nativos do GoTrue) + nome/telefone editáveis (gravados em `user_metadata` via
`db.auth.updateUser({data:...})`, mesmo padrão já usado para o CLIENTE em `AuthService.atualizarNome`)
+ troca de senha (`db.auth.updateUser({password})`, fluxo oficial, não desloga a sessão atual).
**Gerenciamento de múltiplos administradores explicitamente NÃO implementado** (fora de escopo — a
tabela `admins` não tem papel/permissão nenhum; é uma REF própria).

**Arquivos:** `src/components/admin/AdminMinhaConta.jsx` (novo), `src/components/admin/AdminPanel.jsx`
(nova aba), `src/App.jsx` (repassa `admin` pro painel), `e2e/tests/admin/admin-minha-conta.spec.js`
(novo — 2 specs: dados salvos/restaurados + validação de senha SEM tocar a senha real do fixture),
`e2e/pages/AdminPanel.page.js` (nova aba no `TABS`).

## Testes e evidências

- `npm run build`: limpo (585,65 kB).
- `npm run test:domain`: 100% verde (inclui `test:guest-identity`, 11/11 — 7 do contrato base + 4 da
  revisão de TTL/version/logout).
- `npm run test:e2e` (suíte completa, chromium): **112/112 verdes** (era 107 antes desta REF — 5 specs
  novos: guest lembrado, cache não vaza pro logado, os 2 de Minha Conta do Admin, logout limpa o cache
  de visitante). 1 falha encontrada na 1ª rodada foi bug de asserção do próprio teste novo (locator
  `.or()` casando com 2 elementos simultâneos) — corrigido, não era regressão de produto; rodadas
  seguintes 100% verdes.

## Regressões verificadas

- REF-AUTH-02: `admin-sessao.spec.js` e `admin-permissao.spec.js` inalterados no comportamento,
  59-60/111 verdes; nova asserção anti-flash passou.
- REF-REGRESSION-01: `admin-adicionais.spec.js` (badges de grupo) inalterado, verde.
- Checkout logado/guest, Fidelidade, Meus Pedidos, Minha Conta do cliente: todos verdes, sem
  intersecção de comportamento alterada.

## PRÓXIMO PASSO

Relatório final entregue ao dono nesta mesma sessão (resumo executivo, causa raiz, arquitetura
preservada, ondas, arquivos, decisões técnicas, testes, evidências, commits, limitações, sugestões).
Nenhuma pendência conhecida para o dono nesta REF (ao contrário de REFs anteriores, não há migration
de banco pendente — Parte 3 não exigiu schema novo).
