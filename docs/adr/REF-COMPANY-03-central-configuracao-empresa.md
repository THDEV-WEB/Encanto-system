# ADR REF-COMPANY-03 — Central de Configuração da Empresa

- **Status:** ✅ **Implementada no código. Sem migration — zero risco de deploy.**
- **Escopo:** a aba "Empresa" do Admin deixa de ser um formulário simples de contato e vira a **Central de Configuração Institucional** — identidade, contato, texto "Sobre nós", redes sociais, endereço institucional, dados legais e configurações de preparo (timezone/idioma/moeda), tudo num único lugar, tudo em `company_info`.
- **Histórico da ref:** começou como "só adicionar o campo Sobre" (v1, ver §6), ampliada pelo dono no mesmo dia para a Central completa antes de qualquer deploy — o código de v1 (`sobre`) foi absorvido integralmente na v2, nada foi refeito.
- **Relacionado:** [[REF-COMPANY-01]] (fundação: `company_info` em `public.settings`, RPCs `get/set_company_info`) · [[REF-COMPANY-02]] (nome dividido curto/completo) · [[REF-BUSINESS-HOURS-04]] (SobreScreen também exibe a grade de horário administrável, mesma tela) · [[REF-CHECKOUT-ADDRESS-01]] (endereço de RETIRADA do checkout — entidade independente, ver §2.5).

## 1. Contexto

Dados institucionais viviam espalhados: `nome/telefone/whatsapp/email` já em `company_info` (REF-COMPANY-01), mas `SOBRE_TEXTO` hardcoded, redes sociais hardcoded (e já renderizadas ao vivo no `SideDrawer.jsx` da loja, com URLs placeholder falsas), endereço institucional inexistente, CNPJ/razão social inexistentes, sem espaço para timezone/idioma/moeda. Cada informação nova exigiria decidir de novo "onde isso mora" — exatamente o problema que a REF-COMPANY-01 tinha começado a resolver, mas sem terminar.

## 2. Decisão

**Nenhuma migration nova, nenhuma tabela nova, nenhuma RPC nova.** `set_company_info(p_patch jsonb)` já faz merge raso no servidor e aceita qualquer chave sem regra de validação especial ("campos futuros sem regra específica são aceitos como estão", ADR REF-COMPANY-01 §6). A Central inteira — 25 campos — cabe nessa arquitetura já existente. Toda a mudança fica na camada JS + no formulário do Admin.

### 2.1 Campos FLAT, nunca aninhados

`set_company_info` faz merge **raso** (`COALESCE(atual,'{}') || p_patch` — operador `jsonb ||`, substitui chaves de nível 1 inteiras, não mescla dentro delas). Se os 6 campos de redes sociais fossem um sub-objeto `social: {...}`, um patch parcial desse sub-objeto **apagaria** os campos não enviados dentro dele. Solução: todos os 25 campos ficam **flat**, no mesmo nível de `nomeCurto`/`telefone` — mesmo padrão já usado desde a REF-COMPANY-01, sem exceção. O botão "Salvar Alterações" único da tela sempre envia o patch **completo** (todos os campos editáveis de uma vez), então esse risco nem chegaria a se manifestar na prática — mas o shape flat evita a armadilha estruturalmente, não só por disciplina de uso.

### 2.2 Grupos (só organização visual — o dado continua flat)

| Bloco no Admin | Campos | Observação |
|---|---|---|
| 🏷️ Identidade | `nomeCurto`, `nomeCompleto` | Logo/Favicon: só **cards "Em breve"** — sem campo de dado, sem upload nesta entrega (layout reservado para não precisar reorganizar o bloco depois) |
| 📞 Contato | `telefone`, `whatsapp`, `email`, `whatsappFloatEnabled` | Inalterado desde a REF-COMPANY-01 |
| 📝 Sobre a Empresa | `sobre` | Ver §2.4 |
| 🌐 Redes Sociais | `instagram`, `facebook`, `tiktok`, `site`, `cardapio`, `googleMaps` | Todos opcionais; ver §2.3 sobre o consumo no `SideDrawer` |
| 📍 Endereço Institucional | `cep`, `rua`, `numero`, `bairro`, `cidade`, `estado` | Independente do endereço de retirada — ver §2.5 |
| 📄 Institucional | `cnpj`, `razaoSocial`, `nomeFantasia` | Texto/documento livre, sem consumidor ainda |
| ⚙️ Configurações | `timezone`, `idioma`, `moeda` | Persistidos desde já; **sem nenhuma ligação funcional** — ver §2.6 |

### 2.3 Redes sociais: hardcode real eliminado, ícone some se vazio

Achado da auditoria: `STORE_INFO.social` (Instagram/Facebook) **já era renderizado ao vivo** no `SideDrawer.jsx` da loja — com URLs placeholder (`'https://instagram.com/'`, nunca o perfil real). Isso contava como hardcode ativo, não um resíduo morto. `SideDrawer.jsx` passou a consumir `useCompanyInfo()`; cada ícone só aparece se o campo correspondente estiver preenchido (`LINKS_SOCIAIS.filter(l => companyInfo[l.campo])`) — nunca mais um link vazio ou apontando pra lugar nenhum. Os 6 campos têm default `''` (nunca um placeholder fake): no primeiro deploy, o drawer não mostra nenhum ícone até o admin preencher de verdade.

### 2.4 "Sobre" — formatação preservada EXATAMENTE como digitada

Decisão revisada durante a implementação: a v1 desta ref fazia `sobre.split('\n\n')` e renderizava `<p>` por parágrafo (normalizando espaços/quebras). O dono pediu explicitamente para preservar a formatação **exatamente como digitada**, incluindo quebras de linha simples dentro de um "parágrafo". Trocado para: **um único bloco** com `white-space: pre-wrap` (`SobreScreen.jsx`), sem nenhum split — o texto salvo é renderizado literal, byte a byte (só `trim()` nas pontas, para não persistir uma linha em branco acidental do início/fim ao salvar).

### 2.5 Endereço institucional ≠ endereço de retirada

`STORE_INFO.retirada` (`constants/storeInfo.js`) é o endereço de **retirada operacional**, consumido pelo checkout (`CheckoutPage.jsx`) e pelo header (`StoreApp.jsx`) desde a REF-CHECKOUT-ADDRESS-01 — fluxo sagrado, nunca tocado sem pedido explícito. O bloco "📍 Endereço Institucional" desta ref é uma coisa **diferente**: o endereço legal/de correspondência da empresa, vive só em `company_info`, e `AdminEmpresa.jsx` **nunca lê `STORE_INFO`** — as duas fontes são estruturalmente independentes, sem nenhum ponto de acoplamento. (`STORE_INFO.endereco`, um placeholder morto que nunca teve consumidor, foi removido — não tinha relação com nenhuma das duas.)

### 2.6 Timezone/idioma/moeda: persistidos, mas sem efeito funcional

Persistidos desde já (não são só "Em breve" como Logo/Favicon), mas **deliberadamente não conectados a nada**: o motor de horário (`services/businessHours`) já tem seu próprio `TIMEZONE` normalizado no **servidor** desde a REF-BUSINESS-HOURS-04 (`set_business_hours_schedule` força `'America/Sao_Paulo'` independente do que o cliente envie) — essa ref não mexe nisso. `company_info.timezone/idioma/moeda` são só o primeiro passo de uma preparação para multi-loja/i18n futuro (linha direta com o roadmap SaaS já auditado neste projeto).

## 3. Validação e segurança

- **Cliente** (`companyInfoRules.validarPatchCompanyInfo`): campos obrigatórios (nome/telefone/email/sobre) mantêm suas regras da REF-COMPANY-01/03v1. Campos novos são **opcionais e permissivos**: vazio sempre aceito; se preenchidos, validação leve de formato — URLs (`instagram`/`facebook`/`tiktok`/`site`/`cardapio`/`googleMaps`) precisam começar com `http(s)://`; `cep` normaliza para 8 dígitos; `estado` normaliza para 2 letras maiúsculas; `cnpj` normaliza para 14 dígitos; `rua`/`numero`/`bairro`/`cidade`/`razaoSocial`/`nomeFantasia`/`timezone`/`idioma`/`moeda` são texto livre (só trim).
- **Servidor:** `set_company_info` continua exigindo `is_admin()`; os campos novos não têm regra própria no SQL (mesmo princípio dos campos "sem regra conhecida" documentado na REF-COMPANY-01) — o servidor não reforça formato de URL/CEP/CNPJ (só o cliente valida isso, como faz há tempos com telefone/email — o SQL sempre foi a fonte de verdade da AUTORIZAÇÃO, não do FORMATO de cada campo novo). Texto de `sobre` renderizado via `{}` do JSX (React escapa por padrão) — sem risco de XSS mesmo sem sanitização extra.

## 4. UX

Reescrita completa de `AdminEmpresa.jsx`: de uma lista de `<input>` soltos para **blocos** (`admin-card`, mesma linguagem visual de `AdminStatus`/`AdminBusinessHours`), cada um com ícone+título, descrição curta, e espaçamento consistente. Botão **"💾 Salvar Alterações"** único, grande (antes: pequeno, "perdido" no topo da página), centralizado, com separador visual, ao final da página — salva a Central inteira de uma vez (exceto o toggle do botão flutuante do WhatsApp, que continua gravando imediatamente, truthful, como desde a REF-COMPANY-01).

## 5. Testes

- `tests/company-info.golden.mjs` — `DEFAULT_COMPANY_INFO` com os 25 campos (10 obrigatórios sempre preenchidos, 15 opcionais sempre `''` por padrão); validação de cada grupo novo (redes sociais, CEP/UF, CNPJ, texto livre); `sobre` preserva quebra de linha simples (não só parágrafo).
- `tests/company-info.guard.mjs` — invariante novo: `STORE_INFO` sem `social`/`endereco` (migrados), `retirada` **intocado**; `SideDrawer` consome `useCompanyInfo` (nunca mais `STORE_INFO.social`).
- `npm run build` limpo; suíte completa de `test:domain` verde (34 gates, incluindo `test:render`).

## 6. Nota histórica — v1 desta ref (absorvida, não obsoleta)

A primeira aprovação desta REF cobria só o campo `sobre` (textarea simples). Esse código (`DEFAULT_COMPANY_INFO.sobre`, validação, textarea no Admin, `SobreScreen` consumindo `useCompanyInfo`) **não foi descartado** — está 100% presente na Central final, só reorganizado dentro do bloco "📝 Sobre a Empresa" e com a formatação ajustada para `pre-wrap` (§2.4). Os commits de v1 (`feat/test/docs(company-03)`) permanecem no histórico; esta ADR substitui o arquivo anterior (`REF-COMPANY-03-sobre-nos-editavel.md`, renomeado) como registro único e atualizado da decisão.
