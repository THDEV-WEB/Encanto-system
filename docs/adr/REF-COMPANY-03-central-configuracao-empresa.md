# ADR REF-COMPANY-03 — Texto "Sobre nós" administrável pelo Admin

- **Status:** ✅ **Implementada no código. Sem migration — zero risco de deploy.**
- **Escopo:** o parágrafo institucional exibido na tela "Sobre nós" da loja passa a ser editável em Admin → Dados da Empresa, junto dos demais campos institucionais.
- **Relacionado:** [[REF-COMPANY-01]] (fundação: `company_info` em `public.settings`, RPCs `get/set_company_info`) · [[REF-BUSINESS-HOURS-04]] (SobreScreen também exibe a grade de horário administrável, mesma tela).

## 1. Contexto

`SOBRE_TEXTO` (array de 3 parágrafos) vivia hardcoded em `constants/storeInfo.js`, consumido só por `SobreScreen.jsx`. A própria REF-COMPANY-01 já tinha registrado esse texto como "próximo candidato natural" à migração para `company_info`.

## 2. Decisão

**Nenhuma migration nova.** `set_company_info(p_patch jsonb)` já faz merge raso no servidor e aceita qualquer chave sem regra de validação especial ("campos futuros sem regra específica são aceitos como estão", ADR REF-COMPANY-01 §6) — exatamente o caso de `sobre`. A mudança inteira fica na camada JS:

- `companyInfoRules.js` — `DEFAULT_COMPANY_INFO.sobre` (mesmo texto de hoje, garante zero mudança visual até o 1º save) + validação em `validarPatchCompanyInfo` (não-vazio, mínimo 10 caracteres — nunca deixa a tela "Sobre nós" em branco).
- `AdminEmpresa.jsx` — novo `<textarea>`, mesmo fluxo pendente + botão "Salvar" dos demais campos.
- `SobreScreen.jsx` — troca `SOBRE_TEXTO` (import estático) por `useCompanyInfo().sobre` (reativo, mesma fonte da loja/Admin).
- `constants/storeInfo.js` — `SOBRE_TEXTO` removido (sem duplicar fonte de verdade).

### 2.1 Representação: string única, não array

`SOBRE_TEXTO` era um array de parágrafos; um `<textarea>` de Admin edita texto livre, não uma lista. Escolhido: **string única com parágrafos separados por linha em branco** (`"\n\n"`) — o admin digita normalmente (Enter duas vezes = novo parágrafo); `SobreScreen.jsx` faz `sobre.split('\n\n')` só na hora de renderizar. Evita inventar uma UI de "lista de parágrafos" (adicionar/remover item) para um caso de uso que é só texto corrido.

## 3. Validação e segurança

- **Cliente:** não-vazio, mínimo 10 caracteres (evita salvar acidentalmente um texto vazio/residual).
- **Servidor:** `set_company_info` continua exigindo `is_admin()`; o campo `sobre` em si não tem regra própria no SQL (mesmo princípio dos campos "sem regra conhecida" já documentado) — é texto institucional livre, sem formato a validar. Renderizado via `{p}` do JSX (React escapa por padrão) — sem risco de XSS mesmo sem sanitização extra no servidor.

## 4. Testes

- `tests/company-info.golden.mjs` — `DEFAULT_COMPANY_INFO` com 7 campos (era 6); `validarPatchCompanyInfo`: válido/curto-demais/vazio.
- `tests/company-info.guard.mjs` — invariante novo: `SOBRE_TEXTO` nunca reaparece em `constants/storeInfo.js`; `SobreScreen` consome `useCompanyInfo`/`companyInfo.sobre` (nunca o array antigo).
- `npm run build` limpo; `npm run test:domain` verde (exceto a falha pré-existente e não relacionada em `ValionCredit`, de outra frente de trabalho).

## 5. Deploy

Sem migration para aplicar. Basta o build normal ir para produção — `get_company_info()` vai devolver o objeto sem a chave `sobre` até o primeiro save (o cliente preenche via `DEFAULT_COMPANY_INFO.sobre`, idêntico ao texto anterior), e a partir do primeiro save no Admin o texto passa a vir 100% do Supabase.
