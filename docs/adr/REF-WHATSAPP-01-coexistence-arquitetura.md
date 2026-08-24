# ADR REF-WHATSAPP-01 — Canal WhatsApp: App + Bot + Cloud API no mesmo número (Coexistence)

**Status:** Pesquisa e decisão arquitetural **CONCLUÍDAS** (2026-08-04). Implementação **ADIADA — iniciativa futura**, não é mais parte do ciclo de go-live atual (decisão do dono, 2026-08-04): depende de aprovação externa da Meta como Tech Provider (§2.6) e de as funcionalidades centrais/pendências da aplicação serem fechadas primeiro. Retomar só quando ambas as condições estiverem satisfeitas.
**Escopo:** revisão arquitetural do canal WhatsApp, substitui o entendimento anterior da "Etapa 2" em `PLANO-GOLIVE-01B-fases-execucao.md` (runbook B2). Não altera Checkout, Catálogo, Loja, Admin.
**Gatilho:** ao avançar na "Etapa 2" da Meta (registrar o número oficial), identificou-se que a arquitetura assumida até aqui (migração exclusiva do número para a Cloud API) tiraria o número do WhatsApp Business App — quebra de requisito de negócio não documentado antes.

---

## 1. Contexto

A arquitetura vigente (REF-ORDER-01/01b, LIVE) é **só saída**: `notification_outbox` → `pg_cron` (30s) → `pg_net` → Cloud API, credenciais no Vault (`whatsapp_token`, `whatsapp_phone_number_id`), Meta App próprio da Encanto, sem BSP. Validada ponta a ponta contra o número de teste (`1237917372740335`), pipeline mecânico 100% confirmado (ver `PLANO-GOLIVE-01B-fases-execucao.md` §Runbook B2).

O plano original previa fechar B2 trocando o `phone_number_id` de teste pelo **número oficial da Encanto** direto no Vault — o que na Cloud API "pura" significa **registrar esse número como recurso da Cloud API**, operação que historicamente (pré-2024) desativava o uso normal do WhatsApp Business App nesse número.

O dono corrigiu a premissa: o número oficial **já está em uso ativo no WhatsApp Business App** (atendimento humano). O requisito é **manter o app funcionando** e **adicionar** bot + notificações automáticas no mesmo número — não substituir.

---

## 2. As 6 perguntas

### 1) Essa arquitetura é tecnicamente possível?

**Sim.** A Meta lançou oficialmente o modo **Coexistence** ("API Solutions for WhatsApp Business App Users"): permite registrar um número **já ativo no WhatsApp Business App** na Cloud API **sem desativar o app**. As duas superfícies ficam sincronizadas em tempo real no mesmo número. Não é gambiarra nem uso de API não documentada — é fluxo oficial de onboarding (Embedded Signup, variante "conectar conta existente").

### 2) Qual é a arquitetura correta?

```
Cliente
  │
  ▼
WhatsApp Business App (número oficial, mantido)
  │  sincronizado em tempo real (Coexistence)
  ▼
WhatsApp Business Platform / Cloud API
  │
  ├─ Webhook de mensagem recebida ──▶ Bot layer (NOVO — não existe hoje)
  │                                     • boas-vindas / FAQ / menu
  │                                     • detecta "sem resposta do bot cabe" → marca conversa para atendente humano
  │                                     • link para o Cardápio Digital (Encanto System)
  │
  └─ notification_outbox (JÁ EXISTE, REF-ORDER-01b) ──▶ pg_cron/pg_net ──▶ Cloud API
                                                          • Recebido / Preparo / Pronto / Saída / Entregue
```

Peças:
- **Onboarding:** Embedded Signup v4, opção "conectar WhatsApp Business App existente" (não o fluxo simples de OTP que estava no runbook original). O dono abre o app, recebe uma mensagem oficial da Meta, toca em "Conectar à Plataforma", confirma compartilhar histórico (opcional), cola um código de confirmação. Isso é interativo — segue exigindo ação do dono, mas **não é mais "migração destrutiva"**, é vínculo.
- **Saída (status de pedido):** reaproveita 100% o que já existe (`enc_dispatch_notifications`, Vault, pg_cron) — só troca o `phone_number_id` de teste pelo oficial, como já estava planejado.
- **Entrada (bot):** componente novo. Precisa de um endpoint que receba os webhooks da Cloud API (`messages`, `history`, `smb_app_state_sync`) e decida a resposta. Como o resto do sistema roda direto no Postgres (sem Edge Function em produção — decisão da REF-ORDER-01b), o caminho consistente é um webhook receiver mínimo (Edge Function **só como porta de entrada HTTP pública**, já que `pg_net`/`pg_cron` não recebem chamadas de fora) que grava a mensagem numa fila e deixa a lógica de resposta em SQL/RPC, no mesmo padrão outbox já usado — mas isso é decisão de implementação para quando este ADR for aprovado, não algo a construir agora.

### 3) A Cloud API não suporta X — qual limitação?

A arquitetura em si é suportada. As limitações reais do modo Coexistence, confirmadas na documentação oficial:

| Limitação | Detalhe |
|---|---|
| Grupos e Channels | Não sincronizam com a Cloud API — ficam só no app |
| Mensagens efêmeras | "Ver uma vez", mensagens temporárias e localização ao vivo são **desativadas** em 1:1 após habilitar Coexistence |
| Listas de transmissão | Viram somente-leitura; não é possível criar novas |
| Dispositivos vinculados | Máx. 4 companion devices; todos são desvinculados no onboarding e precisam ser revinculados manualmente; WhatsApp Windows/WearOS **não suportados** |
| Throughput | Fixo em 20 mensagens/segundo quando o número está em uso simultâneo (app + API) — não é o gargalo da Encanto |
| Janela de atividade | O app precisa ser aberto **pelo menos 1x a cada 14 dias**, senão a Meta pode remover a conexão |
| Histórico sincronizado | Só 1:1, só últimos 6 meses, mídia só dos últimos 14 dias após o onboarding |
| Cobertura geográfica | Coexistence **não disponível para números da Nigéria ou África do Sul** — irrelevante para o Brasil |

Nenhuma dessas impede o fluxo pedido pelo dono (bot + notificações + atendimento humano no app).

### 4) Quais soluções oficiais/parceiras cobrem isso?

Duas rotas oficiais, ambas válidas:

**A. Self-service como Tech Provider (consistente com a arquitetura atual, sem BSP)**
A Encanto já opera um Meta App próprio ("Encanto System", `app_id 2129796580974664`) que gerencia a própria WABA diretamente — é assim que REF-ORDER-01b funciona hoje, e isso foi feito **sem** precisar de status de Tech Provider (o guia geral do Cloud API é explícito: "If you are building an app that will not be used by other businesses, refer to our Cloud API Get Started guide instead" — uso só da própria conta não exige Partner/Tech Provider).

**CONFIRMADO (2026-08-04) — o requisito de Tech Provider é real e não tem exceção para autoatendimento.** A página oficial "Onboard WhatsApp Business app users" (o documento específico do fluxo Coexistence) lista na seção de Requisitos, **verbatim**: *"You must already be a Solution Partner or Tech Provider."* Esse requisito é apresentado como critério de elegibilidade geral, **sem distinção entre integrar só o próprio número ou integrar números de terceiros** — ou seja, não existe atalho de autoatendimento dentro do próprio WhatsApp Manager que pule essa exigência só porque a Encanto vai conectar apenas a própria conta. Isso está isolado ao fluxo de Coexistence: o restante da integração já feita (REF-ORDER-01b, número de teste) continua válido e não precisa ser refeito.

**B. Via BSP (Business Solution Provider)**
Parceiros oficiais da Meta já credenciados como Tech Provider (ex.: 360dialog, Twilio, Gupshup, Zenvia, Take Blip — vários com presença forte no Brasil) oferecem o onboarding de Coexistence pronto no próprio painel, sem a Encanto precisar se credenciar. Troca-se: velocidade de ativação e suporte por uma taxa adicional por mensagem (tipicamente USD 0,003–0,010 acima do custo Meta) e uma camada extra de dependência de terceiro.

### 5) Existe combinação de componentes oficiais que atende exatamente esse fluxo?

Sim: **WhatsApp Business App (mantido) + Embedded Signup v4 modo Coexistence + WhatsApp Business Platform/Cloud API + bot próprio (webhook + lógica de decisão, a construir) + outbox já existente (REF-ORDER-01b) para as notificações de status**. Não há necessidade de nenhum produto adicional da Meta (não precisa de "WhatsApp Flows", "Click-to-WhatsApp Ads" etc. para este escopo) — o bot de atendimento é responsabilidade da Encanto (mensagens de template/sessão simples via Cloud API), não um produto pronto da Meta.

### 6) Qual arquitetura recomendo (custo, escala, manutenção, UX, conformidade)?

**Rota A (self-service, sem BSP)**, pelos mesmos motivos que já guiaram REF-ORDER-01b (evitar dependência de servidor/serviço externo, manter credenciais e lógica dentro da própria infraestrutura):

- **Custo:** só a tarifa da Meta por mensagem entregue (Utility ~R$0,05–0,15/msg conforme categoria; mensagens dentro da janela de atendimento de 24h e mensagens do app continuam gratuitas). Sem markup de BSP.
- **Escala:** throughput de 20 mps é ordens de grandeza acima do volume da Encanto.
- **Manutenção:** reaproveita 100% o pipeline de saída já testado (Vault/pg_cron/pg_net); só a entrada (bot) é código novo.
- **UX:** preserva exatamente o que o dono pediu — atendente humano continua no app, cliente não percebe troca de canal.
- **Conformidade:** fluxo 100% documentado e suportado pela Meta, sem uso de API não oficial.

**Ação necessária antes do onboarding Coexistence (confirmado, não é mais incerteza):** a Encanto precisa completar o cadastro como **Tech Provider** da Meta antes de rodar o Embedded Signup na variante "conectar app existente". Pelo guia oficial "Become a Tech Provider", o processo é:

1. Portfólio de negócios + conta de desenvolvedor Meta — **já existe** (App "Encanto System").
2. Verificação de identidade da empresa (documentos oficiais + verificação de domínio) — **2–5 dias úteis**, prazo da Meta, fora do nosso controle.
3. Autenticação de dois fatores (2FA) na Business Manager — **já ativa** (ligada durante o desbloqueio do cadastro Meta em 2026-08-03).
4. App Review para Advanced Access de `whatsapp_business_messaging`/`whatsapp_business_management` — o texto oficial descreve isso como "necessário para enviar mensagens em nome de clientes" / "acessar WABAs de clientes", redigido para cenário multi-cliente; não há tier documentado publicamente mais leve para quem só vai usar a própria WABA, então o caminho prático é seguir o processo padrão de Tech Provider mesmo assim.

**Impacto no cronograma:** é um item de espera externa (verificação da Meta), não bloqueio técnico — mesmo padrão já visto no cadastro do Meta App (Fase B). Ação recomendada: dono abre o cadastro de Tech Provider o quanto antes (prazo incerto, como já ocorreu antes), enquanto o desenho do bot pode ser preparado em paralelo. Se travar por burocracia, a Rota B (BSP brasileiro já credenciado) é o fallback — troca-se markup por mensagem por velocidade, sem precisar redesenhar nada além do ponto de onboarding.

---

## 3. Decisão

Adotar **Coexistence** como arquitetura do canal WhatsApp da Encanto, mantendo o WhatsApp Business App como canal primário de atendimento humano e adicionando bot + notificações via Cloud API no mesmo número, seguindo a **Rota A** como primeira tentativa.

**Não decidido ainda / fora deste ADR:** desenho detalhado do bot (árvore de decisão, textos, quando escalar para humano), formato exato do webhook receiver. Isso vira uma referência de implementação separada quando este ADR for retomado.

**Adiamento explícito (2026-08-04):** o dono decidiu não aguardar a aprovação da Meta como Tech Provider (§2.6, prazo externo incerto) para avançar o restante do sistema. Esta arquitetura fica **congelada como decisão válida** para quando for retomada — nenhuma implementação (Cloud API definitiva, webhook, bot) começa antes disso. Prioridade agora: fechar funcionalidades centrais e pendências da aplicação (ver `PLANO-GOLIVE-01B-fases-execucao.md`, Blocos 1–3). B2/Coexistence passa a ser o Bloco 4 desse plano — retomado só quando o sistema estiver estabilizado e o cadastro de Tech Provider aprovado.

## 4. Impacto no que já existe

- `notification_outbox` / `enc_dispatch_notifications` / Vault / pg_cron: **inalterados**, só apontam para o `phone_number_id` oficial quando o onboarding Coexistence terminar (mesma troca de secret já prevista no runbook B2).
- "Etapa 2" do plano original: **substituída** — não é mais "registrar número novo via OTP simples", é "onboarding Coexistence via Embedded Signup, conectando o app já ativo".
- Nenhum código de bot existe ainda — é escopo 100% novo, não estava em nenhuma referência anterior.

## 5. Fontes

- [Onboard WhatsApp Business app users (Coexistence) — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- [Pricing on the WhatsApp Business Platform — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Become a Tech Provider — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
- [Embedded Signup — Overview — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview)
- [Solution Partner — Overview — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview) — confirma que autointegração (só o próprio número) **não** exige Partner/Tech Provider para o Cloud API padrão; a exigência é específica do fluxo Coexistence
- [WhatsApp Cloud API — Get Started — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
