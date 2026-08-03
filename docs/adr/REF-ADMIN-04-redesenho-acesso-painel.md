# ADR REF-ADMIN-04 — Redesenho do acesso ao Painel Administrativo

- **Status:** 🟢 Aprovado — Ondas 0-5 concluídas (2026-08-03): subdomínio
  `admin.encanto.valionsistemas.com.br` no ar em produção, bundle da loja sem código do admin
  (615→522 kB), suíte E2E completa adaptada e verde (109-111/111 local + CI real). Onda 6 parcial —
  só falta o checklist de dispositivo físico do dono (bloqueio externo, sem hardware neste ambiente).
  Ver `docs/ref/REF-ADMIN-04-plano-ondas.md` para detalhe onda a onda.
- **Depende de:** `REF-ADMIN-01` (robustez do painel), `REF-ADMIN-02` (refinamentos), `REF-ADMIN-03`
  (escala) — este REF não altera nada do *conteúdo* dessas três, só o *caminho de acesso*.
- **Relacionado:** `REF-MOBILE-01-fundacao-mobile.md` (infraestrutura PWA/Workbox reaproveitada),
  `REF-BRAND-01-dominio-institucional.md` (arquitetura de domínios/Vercel da loja, precedente direto
  para o terceiro projeto Vercel proposto aqui), `REF-UX-SESSION-01-confirmacao-de-sessao-admin.md`
  (fluxo de sessão do admin, preservado sem alteração de comportamento).
- **Substitui:** a análise comparativa completa está em
  `docs/adr/REF-ADMIN-04-analise-arquiteturas-acesso.md` — este documento assume as conclusões de lá e
  registra a decisão formal.

---

## 1. Objetivo

Substituir a engrenagem visível no cabeçalho da loja (entrada única, hoje com tooltip "Painel Admin" e
`data-testid` público) por uma arquitetura definitiva de acesso administrativo: invisível ao usuário
comum, profissional, segura, de baixa manutenção e confortável para uso diário — sem regressão em
nenhuma funcionalidade de loja ou de admin já existente.

## 2. Auditoria (estado inicial — resumo; detalhe completo no documento de análise)

- Acesso hoje: ícone ⚙️ sempre visível (`src/pages/StoreApp.jsx:234-236`) + easter-egg de 5 cliques na
  logo (`StoreApp.jsx:171-186`) + link por hash `#admin-encanto` (`src/hooks/useAdminSession.js:44-50`).
  Todos convergem para o mesmo `mode='login'` em memória — não existe roteador (`react-router-dom` não é
  dependência do projeto).
- Bundle único: `src/components/admin/*` (16 arquivos, 2342 linhas) é importado estaticamente por
  `AdminPanel.jsx`, sem `React.lazy` — todo visitante da loja baixa esse código, use-o ou não.
- Autenticação/autorização do admin (`AdminLogin.jsx` + RPC `is_admin()`) já é separada da autenticação
  do cliente e **não muda** neste REF.
- Achado colateral fora do escopo de arquitetura, mas que este REF corrige por estar na mesma área de
  código: `AdminLogin.jsx:8` pré-preenche um e-mail real como valor padrão do formulário, expondo a
  identidade do admin a quem inspecionar o bundle.
- Domínio canônico atual da aplicação: `encanto.valionsistemas.com.br` (projeto Vercel `encanto-system`).
  Não existe hoje nenhum subdomínio administrativo — essa possibilidade foi avaliada e descartada em
  fase anterior do projeto (`REF-BRAND-01`) e volta agora como uma das alternativas comparadas.

## 3. Decisões

### D1 — Arquitetura-alvo: aplicação administrativa própria, mesmo repositório, subdomínio e PWA dedicados
Adotar a combinação **D + C2 + E** da análise comparativa: um segundo ponto de entrada de build neste
mesmo repositório (ex.: `admin.html`, montando só `AdminLogin`/`AdminPanel`/`useAdminSession`, sem
`StoreApp`/`AuthProvider` do cliente), publicado como um **terceiro projeto Vercel** (mesmo GitHub repo,
Root Directory/Build Command/Output Directory apontando para a saída nova), em subdomínio próprio
(`admin.encanto.valionsistemas.com.br`, nome a confirmar — ver D7), com manifest/Service Worker
dedicados ("Encanto Admin", ícone e `scope` próprios).

**Por que não uma opção isolada:** nenhuma alternativa sozinha (rota `/admin`, subdomínio com bundle
compartilhado, ou PWA dedicado sem domínio próprio) resolve os dois problemas centrais ao mesmo tempo —
esconder a *existência* do painel do usuário comum **e** esconder o *código* do painel do bundle público.
Só a combinação das três resolve ambos, replicando o padrão observado em Shopify/iFood/Mercado
Pago/Stripe (domínio próprio + bundle próprio + sessão isolada + zero pista no produto público).

**Por que não um repositório/monorepo separado:** traria o mesmo benefício de isolamento com esforço
maior (duplicação ou extração de dependências compartilhadas — cliente Supabase, tokens de design,
utils) sem ganho adicional mensurável no tamanho atual do projeto. Fica registrado como evolução válida
se o admin um dia crescer a ponto de justificar squad/CI próprios.

### D2 — Remoção completa da engrenagem, do easter-egg e do hash de acesso
`onAdmin`/gear icon (`StoreApp.jsx:234-236`), o listener de 5 cliques na logo (`StoreApp.jsx:171-186`) e
o listener de `#admin-encanto` (`useAdminSession.js:44-50`) são removidos do bundle da loja. O único
caminho de acesso passa a ser o subdomínio/app dedicado. Não sobra nenhuma pista textual, visual ou de
código no bundle público.

### D3 — Sem React Router; a separação acontece por build/domínio, não por rota
Mantém-se a filosofia já registrada em `REF-BRAND-01` ("este app não usa roteamento por URL algum") —
não se introduz `react-router-dom` nem para a loja nem para o admin. A "rota" do admin é, na prática,
*qual domínio serve qual build*, decidido na configuração dos projetos Vercel, não em tempo de execução
no navegador.

### D4 — Login e autorização do admin preservados sem mudança de comportamento
`AdminLogin.jsx` (e-mail/senha) e a checagem de `is_admin()` continuam exatamente como são — este REF
não altera a camada de autenticação/autorização, só onde ela é servida. Único ajuste: remoção do e-mail
hardcoded como valor padrão do formulário (achado do §2), sem qualquer outra mudança de UX de login.

### D5 — Deploy: novo projeto Vercel apontando para o mesmo repositório GitHub
Reaproveita exatamente o padrão já operado pela Valion entre `valion-sistemas-site` e `encanto-system`
(dois projetos Vercel independentes, um repositório cada, deploy próprio). Descartada a alternativa de
Edge Middleware fazendo *host-based rewrite* dentro de um único projeto: tecnicamente viável, mas
introduziria uma ferramenta (Vercel Edge Middleware) nunca usada neste projeto, para resolver um problema
que o padrão de "projeto por domínio" já resolve com zero ferramenta nova.

### D6 — Supabase Auth: isolamento de sessão como benefício automático; `uri_allow_list` provavelmente dispensável
Como subdomínio é origem distinta para `localStorage`, a sessão do admin passa a ficar fisicamente
isolada da sessão do cliente no navegador — reforço de segurança que vem de graça da arquitetura
escolhida, sem exigir nenhuma mudança de código na lógica de sessão (`useAdminSession.js`, incluindo o
fluxo de confirmação de `REF-UX-SESSION-01`, permanece intacto).

**Correção registrada durante a Onda 3:** ao contrário do que este documento presumia inicialmente, o
`uri_allow_list` do Supabase Auth **provavelmente não precisa** incluir o novo domínio — esse mecanismo
existe para validar destinos de *redirect* (OAuth do cliente, magic link), e o login do admin
(`AdminLogin.jsx` → `db.auth.signInWithPassword`) roda com `detectSessionInUrl:false`, sem redirect
nenhum. Item passa de "ação obrigatória" para "confirmar empiricamente assim que o domínio estiver no
ar" — ver `docs/ref/REF-ADMIN-04-plano-ondas.md`, Onda 3.

### D7 — Nome do subdomínio: decisão de produto, não técnica
Proposto `admin.encanto.valionsistemas.com.br` (aninhado sob o subdomínio já existente do produto,
seguindo o padrão "cada sistema da Valion tem seu subdomínio" já estabelecido). Alternativas possíveis
(`painel.encanto...`, `gestor.encanto...`) são equivalentes tecnicamente — **fica como pergunta aberta
para o dono confirmar antes da Onda 3 do plano de implementação**, não bloqueia o restante do desenho.

### D8 — Suíte E2E precisa ser adaptada, não descartada
Os specs que hoje clicam em `data-testid="header-admin-btn"` para chegar ao admin (parte do
`test:e2e`, 113+ specs) deixam de ter esse elemento no DOM da loja. Precisam passar a navegar
diretamente para o novo domínio/build do admin (`baseURL` próprio no Playwright, ou um segundo projeto
de config, espelhando como o E2E já trata `dist/capacitor` de forma diferenciada). Este é o maior item
de esforço não relacionado a produto do REF — tratado como onda própria no plano de implementação.

### D9 — App nativo dedicado de admin: fora de escopo, registrado para o futuro
A PWA instalável (D1 + manifest próprio) já entrega "ícone na tela inicial, abertura direta, sem barra
de navegador" em Android, iOS e Desktop sem tocar em Capacitor/Android. Um app nativo "Encanto Admin"
separado (novo `appId`, novo APK) traria pouco ganho adicional hoje e o `REF-CAP-01` do app do cliente
foi encerrado com instrução explícita do dono de não revisitar essa frente. Fica registrado como
evolução futura natural (ex.: se um dia notificação push nativa de novo pedido for necessária no
dia a dia do admin).

## 4. Ondas de execução

Nenhuma onda foi iniciada. Plano completo, com critérios de entrada/saída por onda e 1 commit por
subfase (disciplina padrão do projeto, ver `REF-APP-01-discipline`), em
`docs/ref/REF-ADMIN-04-plano-ondas.md`. Execução começa somente após aprovação explícita do dono deste
ADR.

## 5. Verificação

Não aplicável — nada implementado. O plano de ondas define os critérios de verificação por onda
(`test:domain`, `test:e2e` com `baseURL` novo, checklist de instalação PWA lado a lado em
Android/iOS/Desktop, confirmação de deploy ao vivo por conteúdo — mesmo rigor usado em todo REF anterior
deste projeto).

## 6. Limitações conhecidas

- A separação de bundle (D1) não impede que alguém que descubra a URL do subdomínio tente forçar
  `is_admin()` — a arquitetura resolve *descoberta casual*, não substitui a autorização no banco, que
  continua sendo a linha de defesa real.
- iOS Safari não expõe API de "prompt de instalação" (diferente de Android/Desktop Chrome) — a
  instalação da PWA do admin no iPhone continua sendo manual ("Adicionar à Tela de Início"), como já é
  hoje para a loja.
- Um terceiro projeto Vercel implica uma terceira env var set a manter em sincronia manual (mesma
  fricção operacional que já existe hoje entre `valion-sistemas-site` e `encanto-system`) — não é
  automatizável sem ferramenta nova, e não foi considerado motivo suficiente para preferir Edge
  Middleware (D5).

## 7. Recomendações para futuras REFs

- Se o painel crescer a ponto de precisar de CI/squad próprios, reavaliar repositório separado
  (descartado por ora em D1).
- Se notificação push nativa de pedido novo virar necessidade operacional, reavaliar app nativo dedicado
  (D9).
- Ao adicionar qualquer domínio novo ao ecossistema Valion, seguir o mesmo checklist já estabelecido em
  `REF-BRAND-01`/`REF-AUTH-03-SMTP` (subdomínio por produto, `uri_allow_list`, nunca compartilhar
  reputação entre produtos).

## 8. Encerramento

Aguardando aprovação do dono. Ao aprovar, este ADR muda de Status para "Aprovado — em execução" e o
plano de ondas correspondente é iniciado onda a onda, com commit e verificação a cada subfase, sem push
automático (push só mediante pedido explícito, mesma disciplina de todo REF anterior).
