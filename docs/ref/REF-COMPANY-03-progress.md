# REF-COMPANY-03 — Central de Configuração da Empresa — progresso

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui.

Detalhe arquitetural completo em `docs/adr/REF-COMPANY-03-central-configuracao-empresa.md`.

## Estado atual

✅ **Implementada no código. Sem migration pendente — pode ir para produção com o build normal.**
Aguardando apenas testes finais + commit + push (autorização do dono).

## Onda 1 — v1: campo "Sobre nós" (concluída, depois ampliada — ver Onda 2)

Auditoria + aprovação + implementação do campo `sobre` isolado: `DEFAULT_COMPANY_INFO.sobre`,
validação (não-vazio, mín. 10 chars), `<textarea>` em `AdminEmpresa.jsx`, `SobreScreen.jsx` migrado de
`SOBRE_TEXTO` (hardcoded) para `useCompanyInfo().sobre`. Testado, buildado, **3 commits locais criados**
(`feat/test/docs(company-03)`) antes de qualquer push.

## Onda 2 — Ampliação de escopo: Central de Configuração (concluída)

Dono pediu ampliação (antes do push da Onda 1): a aba "Empresa" vira Central completa. Nova auditoria
apresentada e aprovada com 8 ajustes do dono (ver ADR §2 para o detalhe de cada um):

1. Campos flat em `company_info` — aprovado como proposto.
2. Logo/Favicon — só placeholder "Em breve", sem persistência.
3. Redes sociais — `SideDrawer` consome imediatamente; ícone some se campo vazio.
4. Endereço — institucional (company_info) separado do de retirada (checkout); nunca cruzar.
5. Configurações — timezone/idioma/moeda persistidos desde já, mesmo sem comportamento funcional.
6. "Sobre" — preservar formatação EXATA (revisou a decisão da Onda 1: trocado split-por-parágrafo por
   `white-space: pre-wrap` single-block).
7. UX moderna — blocos com título/descrição/espaçamento, não inputs soltos.
8. Persistir campos mesmo sem consumidor na loja ainda (evita retrabalho estrutural futuro).

## Onda 3 — Implementação (concluída)

- `services/company/companyInfoRules.js` — `DEFAULT_COMPANY_INFO` expandido de 7 para 25 campos;
  `validarPatchCompanyInfo` com validação por grupo (URLs opcionais, CEP/UF/CNPJ com formato leve quando
  preenchidos, texto livre para o resto).
- `components/admin/AdminEmpresa.jsx` — reescrita completa: 7 blocos (`Bloco`/`Campo`/`EmBreveCard`
  helpers locais), estado único `form` (array `CAMPOS_TEXTO` + telefone/whatsapp formatados à parte),
  dirty-check por comparação de conteúdo (não referência — não descarta edição em andamento a cada poll),
  botão "Salvar Alterações" único e reposicionado no fim da página.
- `components/menu/SideDrawer.jsx` — `STORE_INFO.social` (hardcode ATIVO, já renderizava 2 ícones com URL
  placeholder falsa) substituído por `useCompanyInfo()`; 6 ícones possíveis, só renderiza os preenchidos.
- `components/menu/SobreScreen.jsx` — de `sobre.split('\n\n')` + `<p>` por parágrafo para um único bloco
  `white-space: pre-wrap` (preserva quebras de linha simples e múltiplas exatamente como digitadas).
- `constants/storeInfo.js` — `endereco`/`social` removidos (mortos/migrados); `cidade`/`retirada`
  mantidos intocados (retirada é consumido pelo checkout, fluxo sagrado).

## Onda 4 — Testes (concluída)

- `tests/company-info.golden.mjs` — `DEFAULT_COMPANY_INFO` 25 campos (10 obrigatórios não-vazios, 15
  opcionais sempre `''`); ~20 casos novos de validação cobrindo os 4 grupos novos.
- `tests/company-info.guard.mjs` — invariante (8): `STORE_INFO` sem `social`/`endereco`, `retirada`
  presente; `SideDrawer` usa `useCompanyInfo`, nunca mais `STORE_INFO.social`.
- SSR smoke ad hoc (`AdminEmpresa`, `SobreScreen` via `renderToStaticMarkup`) — renderizam sem lançar,
  todos os blocos/marcadores presentes (não faz parte da suíte permanente, script temporário apagado
  depois de rodar).

## Onda 5 — Validação local (concluída)

- `npm run build` — limpo.
- `npm run test:domain` — todos os 34 gates rodados (parte individualmente, por causa de uma falha
  pré-existente e não relacionada em `test:render`/`ValionCredit` que se resolveu sozinha no meio do
  caminho, de outra frente de trabalho) — **tudo verde**, incluindo `test:render` completo no final.

## Onda 6 — Documentação (concluída)

ADR renomeado de `REF-COMPANY-03-sobre-nos-editavel.md` para
`REF-COMPANY-03-central-configuracao-empresa.md` (git mv, preserva histórico) e reescrito para refletir o
escopo final; nota histórica (§6) registra que a v1 (`sobre`) foi absorvida, não descartada. Índice
`docs/adr/README.md` atualizado. Este progress doc.

## Onda 7 — Commit + push (PENDENTE — aguardando autorização)

1. Commits locais (feat/test/docs, seguindo a disciplina do projeto) cobrindo a Onda 2 (ampliação) por
   cima dos 3 commits já existentes da Onda 1.
2. Apresentar resultado + pedir autorização de push (mesma dinâmica da REF-BUSINESS-HOURS-04).
3. Sem migration para aplicar — deploy é só o build normal.
