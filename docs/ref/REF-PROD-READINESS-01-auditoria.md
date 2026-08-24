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

## Pendências

Ambos os itens (A2, A6) permanecem **abertos, aguardando decisão do dono** — nenhuma correção foi
aplicada por este documento, conforme escopo desta rodada (investigação, não implementação).
