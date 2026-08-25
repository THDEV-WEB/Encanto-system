# REF-PROD-READINESS-01 — Auditoria pré-go-live (registro de rastreabilidade)

**Status: histórico/reconstruído.** Esta auditoria foi originalmente somente-leitura e não deixou
um artifact ou documento próprio versionado no repositório — só é citada de passagem em
`docs/ref/REF-PROD-GOLIVE-01-fechamento.md`. Este documento existe para fechar essa lacuna de
rastreabilidade, identificada no CHECKUP GERAL pós-sessões-paralelas de 2026-08-24. Reconstruído
inteiramente a partir de evidência já existente (o próprio fechamento da GOLIVE-01 + investigação
direta do código/banco) — nada abaixo foi inventado; onde a informação original não pôde ser
recuperada, isso está declarado explicitamente.

## O que se sabe da auditoria original

Rodada somente-leitura, por volta de 2026-08-23, coberta pelo contexto da retomada de produção real
da Encanto. Encontrou **4 achados classificados como bloqueadores reais**:

| # | Achado | Disposição |
|---|---|---|
| 1 | **MT-01/MT-02** — `create_order`/`link_customer_to_auth` confiavam no `p_store_id` cru do cliente quando o JWT não tinha `tenant_id` | 🟢 Corrigido e ao vivo em produção — [REF-PROD-GOLIVE-01-fechamento.md §1](./REF-PROD-GOLIVE-01-fechamento.md) |
| 2 | **CHECKOUT-TENANT-02** — catálogo podia misturar produtos de lojas diferentes durante o boot (resolução assíncrona da loja) | 🟢 Corrigido e ao vivo em produção — [REF-PROD-GOLIVE-01-fechamento.md §2](./REF-PROD-GOLIVE-01-fechamento.md) |
| 3 | **A2** — PII (e-mails pessoais reais) commitada em múltiplos arquivos deste repositório **público** | 🟠 Aberto — decisão de governança do dono. Ver análise abaixo |
| 4 | **A6** — senha real do admin da Aquarios Bar impressa em texto puro no console durante o onboarding assistido | 🟠 Aberto — decisão de governança do dono. Ver análise abaixo |

Um 5º item (sobrescrita de nome via telefone em `create_order`, o "vetor secundário") foi encontrado
**depois** do fechamento inicial, não fazia parte destes 4 — também já corrigido (addendum do mesmo
documento).

Não há artifact, relatório ou anotação adicional da auditoria original além do que está registrado
acima — se ela cobriu mais do que estes 4 itens, essa parte não foi preservada em lugar nenhum
identificável.

## A2 — PII em repositório público (análise, 2026-08-24)

**O que existe:** 3 e-mails pessoais reais hardcoded em 8 arquivos (12 ocorrências), todos
rastreáveis via `git grep`:
- E-mail pessoal real do admin de produção da Encanto — em 6 arquivos (`docs/adr/AUTH-01-*.md`,
  `docs/adr/REF-ADMIN-04-*.md`, `docs/adr/REF-E2E-01-*.md` ×3, `docs/adr/REF-E2E-03-*.md`,
  `docs/ref/REF-STABILITY-01-progress.md`).
- E-mail pessoal real do dono — em `docs/ref/REF-AUTH-03-progress.md:64`.
- E-mail pessoal real do admin real da Aquarios Bar — em `docs/adr/REF-STORE-ONBOARD-01-dominio-lojas.md`
  e 2 scripts (`scripts/store-onboard-01-onda2-validacao-final.mjs`,
  `scripts/store-onboard-01-rename-aquariosbar.mjs`).

12 commits históricos distintos tocaram essas strings (8 + 3 + 1). O repositório GitHub
(`THDEV-WEB/Encanto-system`) é **público**, confirmado via API (`"private": false`).

**Verificação importante:** o único ponto onde um desses e-mails aparecia no **código-fonte
shipado** (`AdminLogin.jsx`, pré-preenchendo o campo de login — achado já registrado pela auditoria
da REF-E2E-03) **já não existe mais** — conferido agora, `useState('')` vazio. A exposição atual está
100% confinada a documentação/scripts versionados, não ao bundle que roda no navegador do visitante.

**Risco real:** esses e-mails são o identificador de login (metade da credencial email+senha) das
contas reais de administrador. Exposição pública reduz o esforço de phishing/engenharia social
direcionado e de tentativas de credential-stuffing contra essas contas especificamente — não é, por
si só, uma tomada de conta.

**Correção recomendada (2 camadas independentes, com riscos muito diferentes):**
1. **Baixo risco, zero impacto em produção:** editar os 8 arquivos atuais para substituir o e-mail
   literal por um placeholder/referência (ex. variável de ambiente nos scripts, texto genérico nos
   docs). Isso não afeta login, RPC ou comportamento algum — é só prosa/valor de teste. **Não remove
   o histórico** (quem já tem um clone, ou usar `git log -S`, ainda encontra os valores antigos).
2. **Alto risco, requer planejamento:** reescrever o histórico do git (BFG/`git filter-repo` +
   force-push) para purgar de vez. Destrutivo — invalida todos os clones existentes, e neste momento
   **há evidência concreta de outra sessão operando neste mesmo working directory** (o commit
   `b39bfa1` apareceu no HEAD local sem eu ter rodado pull/merge). Fazer isso agora arriscaria
   corromper o estado de qualquer sessão paralela ativa. Recomendo tratar como uma operação separada,
   agendada para um momento sem atividade concorrente confirmada.
3. **Opcional:** rotacionar o e-mail de login das contas reais (dissociar identidade pública do
   e-mail de acesso) — decisão de produto/governança, não uma correção técnica obrigatória.

**Não exige mudança em produção** (camada 1); **não quebra a Encanto** (nenhum destes arquivos é
lido em runtime pelo app). Ordem recomendada: 1 → 3 (se decidido) → 2 (só isolado, sem sessões
concorrentes).

**Atualização (2026-08-24): camada 1 aplicada.** As 12 ocorrências nos 8 arquivos foram mascaradas
(placeholder `<email-real-...>` nos docs; `scripts/store-onboard-01-onda2-validacao-final.mjs`
passou a ler `ADMIN_REAL_EMAIL` de `process.env.ADMIN_REAL_EMAIL_AQUARIOS` em vez de hardcoded).
Camada 2 (histórico do git) e camada 3 (rotação de e-mail de login) continuam **não feitas**,
por decisão explícita do dono — permanecem como risco residual aceito nesta rodada.

## A6 — senha do admin da Aquarios Bar (análise, 2026-08-24)

**O que existe:** `scripts/store-onboard-01-onda2-validacao-final.mjs` executa de verdade o fluxo de
"primeiro acesso" contra a conta real do admin da Aquarios Bar (via Admin API, já que não havia acesso
à caixa de e-mail para abrir o convite manualmente) e **define uma senha nova, real, gerada em
runtime** (`randomBytes`, não hardcoded no script). O próprio comentário do script admite: "reportada
no final, não escondida" — ou seja, a senha real foi impressa em texto puro no console na única
execução real deste script, em ~2026-08-22.

**Risco real:** o script em si não contém segredo algum (a senha é gerada a cada execução, nunca
fixa). O risco está no **destino daquele console output**: se aquela execução aconteceu dentro de uma
sessão de IA (Claude Code ou outra), a senha em texto puro passou a fazer parte do transcript daquela
sessão — que pode estar persistido em disco localmente e/ou ter trafegado por uma API de LLM. Não há
como este documento confirmar se isso de fato aconteceu ou se esse transcript foi preservado/exposto
em algum lugar — é uma pergunta que só o dono pode responder.

**Mitigação do impacto imediato:** a Aquarios Bar está `status='suspenso'` (confirmado agora, ao
vivo) — mesmo que a senha atual esteja comprometida, não há storefront público nem dados reais
expostos por trás dela hoje.

**Correção recomendada:** independente de confirmar ou não a exposição, a ação mais simples e segura
é **forçar um reset de senha pelo fluxo padrão "esqueci minha senha"** para a conta real do admin da
Aquarios Bar, deixando o próprio dono da loja definir a senha nova pelo e-mail dele — nunca gerando
e imprimindo uma nova senha por script outra vez. Isso não exige migration nem mudança de código,
só uma ação operacional no Supabase Auth. **Não quebra a Encanto** (tenant completamente separado,
hoje suspenso). Requer coordenação com o dono real da Aquarios Bar — por isso é decisão dele, não
técnica.

**Atualização (2026-08-25): capacidade nova construída, dono autorizou puxar a frente.** Nova Edge
Function `supabase/functions/platform-set-store-admin-password/` (segundo ponto do sistema que usa
`service_role`, mesmo desenho de `invite-store-admin`: autorização 100% delegada a `is_super_admin()`
com o JWT do caller, alvo restrito a quem já está em `public.admins`, senha nunca logada em lugar
nenhum) — substitui o padrão antigo (script que gerava e imprimia a senha no console) por um botão
"🔑 Definir senha" no detalhe da loja no Platform Console (`PlatformTenants.jsx`). Testada de ponta a
ponta contra o projeto E2E com dados 100% descartáveis (`scripts/prod-readiness-01-a6-set-password-
test.mjs`, 8/8 cenários: sem autenticação, não-super-admin, senha curta, alvo não-admin, sucesso real +
verificação de login com a senha nova) — nunca tocou `ADMIN_FIXTURE`/`ADMIN_B_FIXTURE` nem qualquer
fixture compartilhada.

Reset da senha real da Aquarios Bar (a ação operacional em si) ainda depende de decisão/coordenação do
dono sobre quando e como comunicar a nova senha ao admin real da loja — não executado
unilateralmente por este commit.

**Atualização (2026-08-25): reset feito, login falhava, causa raiz achada e corrigida.** O dono usou
"Definir senha" para o e-mail correto do admin real (`aquariosbar806@gmail.com`, user_id
`c3d3dbe9-b454-4c42-869e-7731cd7a2fd6`, vinculado a `public.admins` da Aquarios Bar) — mas o login em
`admin.valionsistemas.com.br` continuava recusando com "Invalid login credentials". Investigação
(somente leitura) achou a causa raiz **confirmada**: esta conta nunca teve o e-mail confirmado
(`confirmed_at`/`email_confirmed_at = null`, `last_sign_in_at = null` — nunca logou nem uma vez) e o
projeto de produção exige confirmação de e-mail para login (`MAILER_AUTOCONFIRM: false`, confirmado
via Management API) — o Supabase Auth recusa `signInWithPassword` para e-mail não confirmado
**independente da senha estar certa**. Não é bug de código (a Edge Function `platform-set-store-admin-
password` e o fluxo de vínculo funcionaram exatamente como desenhado) — é um estado de dado que a
própria conta ficou sem confirmar (criada sem passar pelo fluxo de convite por e-mail, que teria
enviado a confirmação).

**Correção aplicada (autorizada pelo dono, escopo único e explícito):** `email_confirmed_at` definido
administrativamente via UPDATE direto e cirúrgico (`WHERE id = ... AND email = ... AND
email_confirmed_at IS NULL`, 1 linha afetada, confirmada por reconsulta) — `confirmed_at` (coluna
gerada, `LEAST(email_confirmed_at, phone_confirmed_at)`) se propagou automaticamente. Revalidado
depois: mesmo `user_id`, mesmo e-mail, mesmo vínculo com a Aquarios Bar em `public.admins` — nada mais
foi tocado (senha, vínculo, código, RLS, RPCs, Edge Functions e qualquer outro usuário permaneceram
intactos). **Login real no Admin de produção ainda não foi confirmado nesta sessão** (a senha nunca
foi conhecida por esta sessão — só o dono/quem definiu a senha pode testar).

## Pendências

A2 camada 2 (histórico do git) permanece **aberta**, por decisão explícita do dono. A6: capacidade
técnica pronta, senha redefinida, causa do login corrigida (e-mail confirmado) — **aguardando
confirmação do dono de que o login real funcionou** para declarar esta pendência encerrada de fato.
