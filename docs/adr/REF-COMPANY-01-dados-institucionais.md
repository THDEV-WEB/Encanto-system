# ADR REF-COMPANY-01 — Dados institucionais da empresa (módulo "Dados da Empresa" no Admin)

- **Status:** ✅ **LIVE.** Migration aplicada pelo dono no SQL editor do Supabase e **verificada ao vivo** via REST (`get_company_info()` devolve o objeto seedado correto; `set_company_info()` via `anon` devolve `42501 permission denied` — escrita corretamente restrita a admin). Ver §7.
- **Escopo:** nome da empresa, telefone principal, WhatsApp oficial, e-mail institucional, toggle do botão flutuante do WhatsApp. Fundação para crescer (Instagram/Facebook/CNPJ/endereço comercial/PIX/... — ver §6).
- **Relacionado:** [[REF-CONTACT-01]] (troca pontual do número antigo pelo oficial, imediatamente anterior a esta ref) · [[REF-BUSINESS-HOURS-03]] (store_mode) · [[REF-DELIVERY-01]]/[[REF-DELIVERY-01a]] (delivery_eta_min — molde direto desta arquitetura) · [[REF-LOYALTY-01]] (set_loyalty_config — precedente de RPC multi-campo).

---

## 1. Contexto

Até esta ref, "dados da empresa" (telefone, WhatsApp, e-mail) viviam em **dois lugares hardcoded e divergentes**:

- `src/lib/supabase.js` — `WHATSAPP = import.meta.env.VITE_WHATSAPP || '<literal>'` (env var + fallback no bundle).
- `src/constants/storeInfo.js` — `STORE_INFO.telefoneDisplay` / `telefoneDigits` / `email` / `nome` (constantes puras).

Trocar o número da loja (REF-CONTACT-01, imediatamente anterior) exigiu editar código em **4 arquivos diferentes** e um `.env`. Qualquer novo campo institucional (Instagram, CNPJ, endereço comercial...) repetiria esse padrão — exatamente o problema que esta ref elimina: a empresa precisa alterar esses dados **sem depender de desenvolvedor nem de deploy**.

## 2. Decisão

**Reaproveitar a tabela `public.settings`** (já usada por `store_mode` e `delivery_eta_min`), guardando **um único objeto JSON** sob a chave `company_info`, administrado por um par de RPCs `SECURITY DEFINER`:

- `get_company_info() RETURNS jsonb` — leitura **pública** (loja anônima precisa exibir telefone/WhatsApp/botão). Lê `settings` direto, ignora RLS (mesma técnica de `get_store_mode`/`get_delivery_eta`).
- `set_company_info(p_patch jsonb) RETURNS jsonb` — escrita restrita a `is_admin()`. Faz **merge raso** (`COALESCE(atual,'{}') || p_patch`) e persiste o resultado; retorna o objeto **mergeado e já salvo** (nunca o que foi enviado — truthful, mesmo princípio de `definirEta`/`toggleEnabled` já usados no projeto).

### 2.1 Por que UM objeto JSON, e não uma linha por campo (como `store_mode`/`delivery_eta_min`)?

| Opção | Como cresce | Trade-off |
|---|---|---|
| **B — objeto JSON único, RPC com `p_patch jsonb`** ✅ escolhida | Campo novo (ex. `instagram`) = só o formulário do Admin passar a ler/escrever essa chave. **Zero migration** para campos sem regra de validação própria. | RPC levemente mais genérica; validação por campo fica dentro de `IF p_patch ? 'campo'` (ainda explícita e auditável). |
| A — uma linha/chave por campo (`company_nome`, `company_telefone`, ...), RPC multi-parâmetro (molde `set_loyalty_config`) | Campo novo = nova migration alterando a assinatura da RPC (adicionar mais um `p_xxx`). | Consistente 100% com o padrão pré-existente, mas a lista de parâmetros cresceria indefinidamente (o pedido explicitamente lista ~15 campos futuros) — uma função com 15+ parâmetros não é "nascer preparado para crescer naturalmente". |

A tarefa pede explicitamente que a arquitetura suporte dezenas de campos futuros **sem exigir refatoração**. A Opção B satisfaz isso literalmente: adicionar `"instagram": "https://..."` ao objeto não toca em SQL nenhum (a menos que se queira validação server-side dedicada para esse campo — aí sim vira uma migration pequena e aditiva, nunca uma refatoração).

### 2.2 Por que NÃO usar a `get_setting()` genérica já existente?

`get_setting(chave, default)` já existe e é usada pelo Admin (`loyaltyService.adminLerConfig`) — mas **não é `SECURITY DEFINER`**. A RLS de `settings` é travada, então chamada do navegador **anônimo** ela nunca enxerga a linha e sempre devolve o `default` — bug real já documentado e corrigido em [[REF-DELIVERY-01a]] (`set_delivery_eta` gravava certo, a loja sempre mostrava o fallback). Como telefone/WhatsApp/toggle são **públicos** (a loja anônima precisa exibi-los), `get_company_info()` é seu **próprio** leitor `SECURITY DEFINER` — não repete essa armadilha.

### 2.3 Reaproveitamento de normalização (sem 4º normalizador de telefone)

O projeto já tem uma dívida registrada (`PEND-PHONE-SSOT`, ver [docs/adr/README.md](README.md)) sobre `normalizePhoneBR` (JS) / `enc_normalize_phone_br` (SQL) / `normalize_phone` (SQL) coexistindo. `set_company_info` **reusa `public.enc_normalize_phone_br`** (já aplicada em produção via [[REF-ORDER-01b]]) para telefone/whatsapp — não cria uma quarta regra. No cliente, `services/company/companyInfoRules.js` reusa `WhatsAppService.normalizePhoneBR` pelo mesmo motivo.

## 3. Arquitetura implementada

```
Supabase: public.settings (chave='company_info', valor=JSON texto)
   ├─ get_company_info()            SECURITY DEFINER · anon+authenticated · leitura pública
   └─ set_company_info(p_patch)     SECURITY DEFINER · authenticated + is_admin() · escrita (merge)
              │
src/services/company/
   ├─ companyInfoRules.js           PURO (zero IO) — DEFAULT_COMPANY_INFO, formatarTelefoneBR,
   │                                 validarPatchCompanyInfo. Testável em Node puro (sem Vite).
   └─ companyInfo.js                IO — db.rpc(get/set_company_info), cache em memória (geração
                                     anti-race, mesma técnica de deliveryEta.js), COMPANY_INFO_EVENT.
              │
src/hooks/useCompanyInfo.js         Estado reativo: mount + focus + visibilitychange + poll 60s +
                                     evento — espelha useDeliveryEta.js 1:1 (padrão já provado).
              │
        ┌─────┴──────────────────────────────────────────────┐
        │                                                     │
src/pages/StoreApp.jsx (único ponto de consumo)      src/components/menu/ContatoScreen.jsx
  → botão flutuante (condicional a                   src/components/admin/AdminFidelidade.jsx
    whatsappFloatEnabled)                               (leafs de mount independente — chamam
  → link "contato" do modal Fidelidade                  useCompanyInfo() direto, como já faziam
  → passa `whatsapp` via PROP p/ SuccessPage             com STORE_INFO/WHATSAPP antes)
              │
src/components/admin/AdminEmpresa.jsx     Aba "Empresa" no AdminPanel — formulário (nome/telefone/
                                           whatsapp/email) + toggle do botão flutuante com preview
                                           🟢 Ativo / 🔴 Desativado.
```

Por que `StoreApp` distribui por prop para `SuccessPage` mas `ContatoScreen`/`AdminFidelidade` chamam o hook direto? Mesmo critério já usado para `deliveryEta`: `StoreApp` é o único ponto que **orquestra** a página de sucesso do checkout (evita 2 sincronizações redundantes na mesma navegação); `ContatoScreen`/`AdminFidelidade` são telas que montam **sob demanda** (o usuário abre "Contato"; o admin abre "Fidelidade") em árvores React separadas — chamar o hook ali é o consumo natural, não uma duplicação de fonte de verdade (a fonte é sempre `settings.company_info`; o hook só cacheia em memória de módulo, compartilhada entre todas as instâncias).

## 4. Migração dos hardcodes (auditoria completa)

| Antes | Depois |
|---|---|
| `src/lib/supabase.js` — `export const WHATSAPP` (env var + fallback) | **Removido.** Nenhum consumidor restante (guard test trava regressão). |
| `src/constants/storeInfo.js` — `STORE_INFO.{nome,telefoneDisplay,telefoneDigits,email}` | **Removidos.** `STORE_INFO` mantém só `cidade`/`endereco`/`retirada`/`social` (ainda estáticos — próximos candidatos naturais, ver §6). |
| `StoreApp.jsx` — botão flutuante incondicional, `wa.me/${WHATSAPP}` | Condicional a `companyInfo.whatsappFloatEnabled`; `wa.me/${companyInfo.whatsapp}`. |
| `StoreApp.jsx` — link "contato" do modal Fidelidade hardcoded (`wa.me/5538992203620`, nem usava a constante do próprio arquivo) | `wa.me/${companyInfo.whatsapp}`. |
| `SuccessPage.jsx` — `import { WHATSAPP }` | Prop `whatsapp` (vindo de `StoreApp`). Checkout **sempre** usa o cadastro da empresa — nunca mais hardcoded. |
| `ContatoScreen.jsx` — `STORE_INFO.telefoneDisplay/telefoneDigits/email` + `WHATSAPP` | `useCompanyInfo()` (telefone/whatsapp/email) + `formatarTelefoneBR` p/ exibição. |
| `AdminFidelidade.jsx` — regulamento com `STORE_INFO.telefoneDigits/telefoneDisplay` hardcoded | `useCompanyInfo()` + `formatarTelefoneBR`. |
| `.env` / `.env.example` / `.env.e2e(.example)` / `ci.yml` / `README.md` — `VITE_WHATSAPP` | Removida (variável órfã; nada mais a lê). |

**O que NÃO migrou (intencional, preparado para depois):** `STORE_INFO.endereco`/`retirada`/`social` (Instagram/Facebook placeholders) e os textos institucionais (`SOBRE_TEXTO`/`TERMOS_SECOES`/`FIDELIDADE_TEXTO`). A tarefa pediu explicitamente para **não** implementar essas telas agora — só preparar a arquitetura (ver §6).

## 5. Validação e segurança

- **Cliente** (`companyInfoRules.validarPatchCompanyInfo`): evita round-trip óbvio (nome ≥2 chars, telefone/whatsapp normalizados via `normalizePhoneBR` + tamanho 12-13, e-mail via regex `/.+@.+\..+/` — mesmo padrão já usado em `useMinhaConta.js`/`LoginScreen.jsx`).
- **Servidor** (`set_company_info`, fonte de verdade real): revalida tudo de novo — `is_admin()` obrigatório (senão `RAISE EXCEPTION 42501`), telefone/whatsapp via `enc_normalize_phone_br` + `length BETWEEN 12 AND 13`, e-mail via regex SQL, `whatsappFloatEnabled` via `jsonb_typeof(...) = 'boolean'`.
- **Grants:** `get_company_info` → `anon, authenticated` (leitura pública); `set_company_info` → só `authenticated` (com `REVOKE ... FROM anon` explícito — defense-in-depth, `is_admin()` já bloqueia mesmo assim). Clientes só leem; só admins escrevem.
- **Toggle do botão flutuante:** grava imediatamente ao clicar, mas é **truthful** — só reflete o novo estado se o servidor confirmar (se a escrita falhar, a UI volta ao estado anterior; nunca mostra um estado que não persistiu). Mesma técnica de `AdminFidelidade.toggleEnabled`.

## 6. Como adicionar um campo institucional novo (o "crescer sem refatoração")

Exemplo: adicionar "Instagram" no futuro.

1. **Sem regra de validação especial:** só o formulário do Admin passa a ler/escrever `info.instagram` via `salvarCompanyInfo({ instagram: '...' })`. `set_company_info` já aceita qualquer chave desconhecida no patch (merge raso) — **zero SQL novo**.
2. **Com regra de validação (ex.: exigir URL válida):** uma migration pequena e **aditiva** — só acrescenta um `IF p_patch ? 'instagram' THEN ... END IF;` dentro de `set_company_info` (`CREATE OR REPLACE FUNCTION`, idempotente). Nunca é uma refatoração: a tabela, o objeto JSON e todos os outros campos continuam intocados.
3. Consumidores leem o campo novo via `useCompanyInfo().instagram` — o hook já devolve o objeto inteiro.

Os próximos candidatos naturais (já com estrutura preparada em `STORE_INFO`, só aguardando a mesma migração): `endereco` (comercial), `social.instagram/facebook`, e os textos institucionais de Sobre/Termos/Fidelidade.

## 7. Testes e qualidade

- `tests/company-info.golden.mjs` (`npm run test:company`) — congela `DEFAULT_COMPANY_INFO`, `formatarTelefoneBR` (E.164 → exibição) e `validarPatchCompanyInfo` (15 casos). Importa só `companyInfoRules.js` (puro, sem `lib/supabase.js`/`import.meta.env` — mesmo cuidado de `business-hours.golden.mjs` com `override.js`).
- `tests/company-info.guard.mjs` (`npm run test:company-guard`) — guarda estrutural: `WHATSAPP` nunca reaparece; `STORE_INFO` não volta a guardar nome/telefone/e-mail; `useCompanyInfo` definido em 1 lugar só; os 4 pontos de contato do cliente nunca hardcodeiam `wa.me`/`tel:`; botão flutuante sempre condicional; `companyInfo.js` usa os RPCs dedicados (nunca `get_setting` genérico).
- Ambos incluídos em `npm run test:domain` (28/28 verde) e `npm run build` limpo.

## 8. Migration — aplicada e verificada ao vivo

A migration [`migrations/REF-COMPANY-01-institutional-info.sql`](../../migrations/REF-COMPANY-01-institutional-info.sql) (+ [rollback](../../migrations/REF-COMPANY-01-institutional-info-rollback.sql)) foi aplicada pelo dono no SQL editor do Supabase de produção (o ambiente de trabalho desta sessão não tinha credenciais de escrita no banco — aplicação manual, mesma situação de toda migration anterior neste projeto).

**Verificação ao vivo via REST (anon key), mesmo método usado em REF-DELIVERY-01:**

```
POST /rest/v1/rpc/get_company_info
→ {"nome":"Encanto — Açaí & Marmitas","email":"contato@encantoacai.com.br",
   "telefone":"5547992722920","whatsapp":"5547992722920","whatsappFloatEnabled":true}

POST /rest/v1/rpc/set_company_info  (com anon key)
→ {"code":"42501","message":"permission denied for function set_company_info"}
```

Confirma: (a) o objeto seedado está correto e a leitura pública funciona (não cai na armadilha de RLS do `get_setting` genérico); (b) a escrita está corretamente bloqueada para `anon` — só `authenticated` + `is_admin()` consegue gravar. O Admin (`AdminEmpresa`) já pode ser usado normalmente em produção.
