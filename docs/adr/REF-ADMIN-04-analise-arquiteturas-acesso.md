# REF-ADMIN-04 — Análise comparativa de arquiteturas de acesso ao Painel Administrativo

- **Status:** 📋 Análise técnica — insumo para o ADR `REF-ADMIN-04-redesenho-acesso-painel.md`. Nada
  implementado.
- **Escopo:** comparar arquiteturas possíveis para o acesso administrativo do Encanto, hoje feito via
  engrenagem visível no cabeçalho da loja. Este documento NÃO decide — apenas mede, compara e recomenda.
  A decisão formal (com trade-offs assumidos) vive no ADR irmão.
- **Relacionado:** `REF-ADMIN-01/02/03` (robustez/refinamento/escala do painel em si — este REF não mexe
  no *conteúdo* do painel, só em *como se chega até ele*), `REF-MOBILE-01` (fundação PWA da loja, base
  técnica reaproveitada aqui), `REF-BRAND-01/02` (arquitetura de domínios da loja).

---

## 1. Estado atual (auditoria)

| Dimensão | Estado hoje |
|---|---|
| **Domínio canônico da aplicação** | `https://encanto.valionsistemas.com.br` (subdomínio próprio, projeto Vercel `encanto-system`, serve sob `/encanto/*`) |
| **Entrada visual** | Ícone ⚙️ sempre visível no cabeçalho da loja (`src/pages/StoreApp.jsx:234-236`), `title="Painel Admin"` — a própria tooltip anuncia o que é, `data-testid="header-admin-btn"` usado pelos testes E2E |
| **Entradas paralelas (não documentadas ao usuário)** | 5 cliques rápidos na logo (`StoreApp.jsx:171-186`, `/* Acesso oculto */`) e link direto via hash `#admin-encanto` (`src/hooks/useAdminSession.js:44-50`) — todas convergem para o mesmo `mode='login'` |
| **Roteamento** | **Nenhum.** Sem `react-router-dom` no `package.json`. Navegação é 100% estado em memória (`mode: 'store'|'login'|'admin'`) trocado em `App.jsx`. A única exceção é uma pseudo-rota hardcoded (`/encanto/download`, via `useDownloadPage()` + rewrite no `vercel.json`) — não é um roteador, é um `if` sobre `window.location.pathname` |
| **Build** | Um único `vite.config.js`, gate único por `mode` (`vite build` vs `vite build --mode capacitor`), um único `index.html`, um único bundle JS/CSS para loja **e** admin juntos |
| **Tamanho do código admin** | `src/components/admin/*.jsx`: 16 arquivos, 2342 linhas, **nenhum `React.lazy`/code-splitting** — todo esse código baixa no navegador de **qualquer** visitante da loja, admin ou não, tenha ele clicado na engrenagem ou não |
| **Autenticação admin** | Formulário próprio (`AdminLogin.jsx`, e-mail/senha via `db.auth.signInWithPassword`), **separado** do login do cliente (OTP/Google, dentro de `AuthProvider`). Autorização checada à parte via RPC `is_admin()` (`SECURITY DEFINER`) — sessão válida no Supabase não basta, precisa constar em `public.admins` |
| **Achado colateral (higiene, não é arquitetura de acesso, mas relevante para este REF):** | `AdminLogin.jsx:8` pré-preenche o campo e-mail com um endereço real (`useState('<email-real-admin-encanto>')` — redigido) — expõe a identidade do administrador a qualquer um que abra o DevTools, independente de qual arquitetura for escolhida. **Nota (2026-08-24): já corrigido — `AdminLogin.jsx:8` hoje usa `useState('')` vazio.** |
| **PWA da loja** | `public/manifest.json` único, `scope`/`start_url`="/encanto/", um único `sw.js` (Workbox/`vite-plugin-pwa`, `generateSW`, sem `runtimeCaching`) |
| **Domínios Vercel** | 2 projetos: `valion-sistemas-site` (landing institucional, dono de `valionsistemas.com.br`) e `encanto-system` (este repo, dono de `encanto.valionsistemas.com.br` e do fallback `encanto-system.vercel.app`) |
| **Capacitor/Android** | APK do cliente já homologado e encerrado (`REF-CAP-01`, "não revisitar"); nenhum deep link ou app nativo relacionado a admin existe |

**Leitura central:** hoje, "esconder o admin" e "esconder o código do admin" são dois problemas
diferentes, e a engrenagem só toca o primeiro (mal, porque tem tooltip). O segundo — o bundle de
~2300 linhas de admin sendo baixado por todo mundo — não é resolvido por nenhuma opção que só troque
a *entrada visual*; só é resolvido por opções que separam o *bundle*.

---

## 2. Alternativas avaliadas

### A. Manter a engrenagem, só refinar (baseline / status quo)
Trocar o ícone por algo mais discreto, remover a tooltip, manter tudo no mesmo bundle/estado.
- **Vantagens:** esforço quase zero.
- **Desvantagens:** não resolve nenhum dos 5 problemas citados na RFC; o ícone (discreto ou não) continua
  sendo uma pista visual permanente da existência do painel; zero ganho de segurança (bundle continua
  exposto).
- **Veredito:** não atende ao objetivo ("solução definitiva"). Serve só como piso de comparação.

### B. Rota dedicada `/admin` (pseudo-rota, sem React Router)
Estender o padrão que já existe para `/encanto/download` (`useDownloadPage()`): checar
`window.location.pathname` no boot e, se terminar em `/admin`, forçar `mode='login'` direto, sem
mostrar a loja.
- **Vantagens:** zero dependência nova, reaproveita um padrão já validado no próprio código; URL
  digitável/favoritável.
- **Desvantagens:** `/admin` é literalmente a URL mais óbvia de adivinhar que existe (pior, nesse
  aspecto, que o atual `#admin-encanto`); **não resolve o problema do bundle** — o painel inteiro
  continua dentro do mesmo JS que a loja baixa; qualquer visitante curioso que abra o Network tab ou
  tente `/admin` na barra de endereço encontra o painel na hora.
- **Esforço:** baixo. **Risco:** baixo, mas resolve pouco.

### C. Subdomínio dedicado (`admin.encanto.valionsistemas.com.br`)
Anexar um subdomínio adicional ao mesmo projeto Vercel, servindo o **mesmo bundle**, com um check de
`location.hostname` no boot para pular direto pro admin (variante "leve") — ou apontando para um
**bundle separado** (variante "completa", ver opção D).
- **C1 (leve — mesmo bundle):** vantagem de URL/identidade sem separar código. Ainda expõe o painel
  inteiro no bundle da loja. Esforço baixo (adicionar domínio no Vercel + 1 `uri_allow_list` novo no
  Supabase Auth + 1 checagem de hostname), mas resolve só metade do problema.
- **C2 (completa — bundle próprio):** ver opção D, da qual o subdomínio é uma peça.
- **Observação de segurança real, independente da variante:** subdomínio é uma **origem diferente**
  para fins de `localStorage`/cookies do navegador. Isso isola de graça a sessão do admin da sessão do
  cliente — hoje elas já são logicamente separadas (`AuthProvider` só envolve a loja), mas ficam também
  *fisicamente* separadas no armazenamento do navegador, reduzindo a superfície de um eventual XSS na
  loja alcançar a sessão do admin.
- **Esforço:** baixo (infraestrutura Vercel/DNS para múltiplos domínios em um projeto é recurso padrão
  de plataforma, não exige código novo por si só).

### D. Aplicação administrativa independente (bundle próprio, mesmo repositório)
Um segundo ponto de entrada de build (ex.: `admin.html`, ou `vite build` com um segundo
`rollupOptions.input`/config dedicado) que monta **só** `AdminLogin`/`AdminPanel`/`useAdminSession` —
sem `StoreApp`, sem `AuthProvider` do cliente, sem o mode-switch atual. Publicado como um **terceiro
projeto Vercel**, importando o **mesmo repositório GitHub** (Root Directory/Build Command/Output
Directory apontando para a saída nova) — exatamente o padrão que a Valion já opera hoje entre
`valion-sistemas-site` e `encanto-system` (dois projetos Vercel, um repositório cada, deploy
independente).
- **Vantagens:** resolve os dois problemas de uma vez — o cliente final **nunca baixa** uma linha do
  código do admin (isolamento real de bundle, não só de UI); deploy do admin passa a ser independente
  do deploy da loja (um typo no painel não arrisca quebrar o checkout, e vice-versa); reaproveita ~100%
  do código existente (`AdminLogin`, `AdminPanel`, `useAdminSession`, cliente Supabase, tokens de
  design) — não é reescrita, é um novo ponto de montagem; mantém a filosofia "zero roteador" do projeto
  (a separação acontece por *qual domínio serve qual build*, não por rotas dentro de um SPA).
- **Desvantagens:** é a opção de maior esforço das que envolvem só este repositório (config de build
  multi-entrada no Vite + terceiro projeto Vercel + `uri_allow_list` novo no Supabase Auth); a suíte E2E
  que hoje navega até o admin clicando na engrenagem (`data-testid="header-admin-btn"`) precisa ser
  reescrita para apontar para o novo domínio/build.
- **Esforço:** médio. **Risco:** baixo-médio (mudança de infraestrutura de build, não de lógica de
  negócio; reversível — o bundle antigo com engrenagem pode continuar existindo até a migração ser
  validada).
- **Não avaliado, mas registrado:** um repositório totalmente separado (monorepo com workspace, ou dois
  repositórios Git) traria os mesmos benefícios com esforço bem maior (duplicação ou extração de
  dependências compartilhadas — cliente Supabase, tokens, utils) sem ganho adicional relevante para o
  tamanho atual do projeto. Não recomendado agora; ver §4 do ADR.

### E. PWA dedicado do Admin / múltiplas instalações PWA (Loja + Admin)
Responde diretamente à pergunta 1 da RFC — ver §3 abaixo para o aprofundamento técnico. Resumo: **é
possível e é uma prática documentada**, mas exige que Loja e Admin tenham `scope`/`start_url`/`id`
próprios e não sobrepostos — o que só é garantido de forma limpa quando Admin já é um bundle/domínio
separado (opção D/C2). Combinar E com D é o que dá "ícone próprio, nome próprio, abertura direta,
comportamento independente" pedido na RFC.
- **Esforço incremental sobre D:** baixo (mais um `manifest.json`, mais um registro de Service Worker,
  reaproveitando a mesma infraestrutura Workbox já validada em `REF-MOBILE-01`).

### F. Atalho simples na tela inicial (bookmark, sem manifest dedicado)
Sem manifest/SW próprio: só um ícone (`apple-touch-icon`/favicon) numa página de admin, adicionada à
tela inicial. No iOS, isso já funciona hoje (Safari trata "Adicionar à Tela de Início" por página, com
as tags `apple-mobile-web-app-*` que o projeto já tem desde `REF-MOBILE-01`), abrindo em modo
`standalone`. No Android/Chrome, sem manifest válido o "atalho" abre uma aba comum do navegador, não um
app standalone.
- **Veredito:** não é uma arquitetura concorrente, é um **subconjunto/fallback** da opção E — vale
  como rede de segurança caso o manifest dedicado tenha algum problema pontual num navegador específico,
  não como solução principal.

### G. Deep link nativo (Capacitor/Android)
O app nativo do cliente já tem um deep link customizado (`br.com.valionsistemas.encanto://login-callback`,
`AndroidManifest.xml`) — mas é exclusivo do retorno do OAuth do cliente, dentro do **mesmo** APK que o
cliente instala. Um deep link de admin dentro desse mesmo APK reintroduziria o problema do bundle
exposto (o código do admin iria dentro do APK que qualquer cliente baixa). Um app nativo **separado**
"Encanto Admin" (novo `appId`, novo APK) é o equivalente nativo da opção D — mas isso é trabalho de
Capacitor/build Android novo, e o REF-CAP-01 do app do cliente foi encerrado com instrução explícita do
dono de "não revisitar" essa frente.
- **Veredito:** fora de escopo agora. A opção E (PWA instalável) já entrega a experiência de "ícone na
  tela inicial, abertura direta, sem barra de navegador" pedida na RFC, sem tocar em Capacitor/Android.
  Fica registrado como evolução natural futura se um dia a operação diária do admin justificar um app
  nativo dedicado (ex.: notificações push nativas de novo pedido).

### H. Login administrativo separado / Rotas protegidas
Já implementado (`AdminLogin.jsx` + `is_admin()`) e é ortogonal às opções acima — continua existindo
qual for a arquitetura de acesso escolhida. Não é uma alternativa competindo com as outras, é a camada
de autorização que qualquer opção acima precisa manter.

---

## 3. Aprofundamento: múltiplas instalações PWA do mesmo projeto (pergunta 1 da RFC)

**Sim, é possível instalar duas PWAs (Loja e Admin) com ícone, nome e comportamento próprios, sem criar
um segundo repositório.** O mecanismo, por plataforma:

- **Android (Chrome/Edge) e Desktop (Chrome/Edge):** o navegador decide "isso é um app instalável
  diferente" com base na combinação `scope` + `start_url` + `id` do `manifest.json`. Dois manifests com
  `scope`s **não sobrepostos** (ex.: `scope:"/encanto/"` para a loja e `scope:"/admin/"` — ou, melhor
  ainda, um domínio inteiro diferente — para o admin) são reconhecidos como duas instalações
  independentes, cada uma com seu próprio ícone na gaveta de apps, seu próprio nome, e abrindo direto no
  respectivo `start_url` em janela `standalone` própria. O campo `id` do manifest existe especificamente
  para desambiguar isso quando `start_url` muda de versão para versão. **Risco técnico real:** se os dois
  `scope`s ficassem aninhados sob o mesmo caminho (ex.: ambos sob `/encanto/`), o navegador pode ficar em
  dúvida sobre qual app "dono" deve abrir um link daquele caminho — por isso a recomendação é isolar o
  admin em domínio próprio (opção C/D), que elimina esse risco por completo (origens diferentes nunca
  colidem).
- **iOS (Safari):** mais simples e mais antigo que o mecanismo de manifest — cada página tem suas
  próprias tags `apple-touch-icon`/`apple-mobile-web-app-title` no `<head>`; "Adicionar à Tela de Início"
  cria um ícone independente por URL, já com comportamento standalone, sem exigir `scope` distinto. Ou
  seja, no iOS o "problema" nem existe: dois `index.html` diferentes (loja e admin) já resultam em dois
  ícones e duas janelas totalmente independentes hoje, sem mudança nenhuma além de servir o admin como
  página própria.
- **Service Worker:** cada bundle registra o seu próprio `sw.js` dentro do seu próprio `scope`. Isso já
  é exatamente o desenho que `REF-MOBILE-01` deixou pronto (Workbox via `vite-plugin-pwa`,
  `registerType:'prompt'`, zero `runtimeCaching`) — só precisa ser instanciado uma segunda vez para o
  bundle do admin, sem mudar a estratégia.

**Conclusão da pergunta 1:** viável, documentado, e a Valion já tem toda a infraestrutura (Workbox,
padrão de ícones, `usePwaUpdate`) para replicar no admin com esforço incremental baixo — desde que o
admin ganhe seu próprio domínio/`scope` (o que aponta de novo para a opção D como pré-requisito real,
não para "só adicionar um segundo manifest.json dentro do mesmo `/encanto/`").

---

## 4. Como grandes players separam admin de público (pergunta 4 da RFC)

Padrão observado de forma consistente em plataformas SaaS/marketplace maduras — **domínio próprio +
aplicação/bundle próprio + (quando o uso móvel diário é intenso) app nativo próprio**, com zero link
visível a partir do produto voltado ao público:

- **Shopify:** o painel do lojista vive em superfície própria (`admin.shopify.com`), completamente
  separada da loja pública do lojista (que roda no domínio dele); o app móvel "Shopify" para o
  lojista é distinto de qualquer app de consumo do cliente final.
- **iFood:** cliente usa o app "iFood"; o restaurante/entregador usa apps totalmente separados
  ("iFood Parceiro"/"Painel do Parceiro"/app do entregador) — domínio, login, design system e bundle
  próprios, sem sobreposição de UI com o app do consumidor.
- **Mercado Pago:** o painel/dashboard do vendedor fica em superfície própria dentro do ecossistema,
  segregado do fluxo de Checkout que o comprador vê — comprador e vendedor nunca compartilham a mesma
  tela ou o mesmo bundle de frontend.
- **Stripe:** `dashboard.stripe.com` (uso do lojista) é uma aplicação separada de `checkout.stripe.com`/
  `js.stripe.com` (o que o comprador final enxerga) — bundles, login e domínios inteiramente distintos.
- **Tiny ERP / Bling:** por serem ERPs, o "painel" é o produto inteiro — mesmo assim, a eventual loja
  virtual gerada para o cliente final do lojista roda em domínio do **lojista**, nunca dividindo
  domínio/app com o painel de gestão da plataforma.

**Padrão comum extraído (5 elementos):** (1) domínio/subdomínio próprio; (2) aplicação/bundle
inteiramente separado do público; (3) app nativo dedicado quando o uso móvel diário é intenso;
(4) sessão/autenticação isolada; (5) **zero pista** no produto público de que a superfície administrativa
existe — nenhum link, nenhum ícone, nenhuma tooltip. É exatamente o padrão que a opção D (+ E) replica
para o Encanto, na escala apropriada para o tamanho atual do projeto (sem precisar de um segundo
repositório/monorepo).

---

## 5. Tabela-síntese

| Critério | A. Status quo refinado | B. Rota `/admin` | C1. Subdomínio (mesmo bundle) | D. App admin própria (+ C2 subdomínio) | E. PWA dedicado (sobre D) |
|---|---|---|---|---|---|
| Esconde a *existência* do painel | ✗ | ✗ (pior — óbvio) | ✓ | ✓ | ✓ |
| Esconde o *código* (bundle) do painel | ✗ | ✗ | ✗ | ✓ | ✓ |
| Isola sessão admin/cliente (origem diferente) | ✗ | ✗ | ✓ | ✓ | ✓ |
| Deploy independente (typo no admin não arrisca a loja) | ✗ | ✗ | ✗ | ✓ | ✓ |
| Abertura direta (1 toque, sem digitar URL) | ✗ | ✗ | parcial | parcial | ✓ |
| Esforço | zero | baixo | baixo | médio | baixo (incremental sobre D) |
| Risco de regressão | zero | baixo | baixo | baixo-médio | baixo |
| Compatível com PWA | atual | atual | atual | sim, melhora | sim, é o ponto central |
| Compatível com mobile (Android/iOS) | sim | sim | sim | sim | sim (iOS até mais simples) |
| Compatível com desktop | sim | sim | sim | sim | sim (Chrome/Edge instalam como app) |
| Manutenção contínua | baixa | baixa | baixa | baixa (2 deploys Vercel, já é o padrão da Valion) | baixa |

---

## 6. Recomendação técnica final

Combinar **D (aplicação administrativa independente, mesmo repositório) + C2 (subdomínio próprio) + E
(PWA/manifest dedicado)** em uma única arquitetura-alvo: um terceiro projeto Vercel, importando este
mesmo repositório GitHub, com um segundo ponto de entrada de build que monta só o admin, publicado em
`admin.encanto.valionsistemas.com.br` (nome exato a confirmar com o dono), com manifest/Service Worker
próprios ("Encanto Admin", ícone distinto). A engrenagem, o easter-egg de 5 cliques e o hash
`#admin-encanto` são removidos do bundle da loja — o cliente final deixa de ter qualquer pista visual ou
de código de que o painel existe.

Esta é a única combinação que atende integralmente aos 9 critérios obrigatórios da RFC ao mesmo tempo
(experiência do admin, segurança, simplicidade operacional, baixa manutenção, escalabilidade, arquitetura
limpa, UX profissional, uso diário, compatibilidade futura) e replica o padrão observado nos players
maduros (§4), na escala certa para o tamanho atual do Encanto — sem exigir monorepo, sem exigir React
Router, sem exigir um novo app nativo. Detalhamento formal da decisão e das alternativas descartadas no
ADR `REF-ADMIN-04-redesenho-acesso-painel.md`.
