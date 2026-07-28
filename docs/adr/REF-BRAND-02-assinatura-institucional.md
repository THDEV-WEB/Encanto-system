# ADR REF-BRAND-02 — Assinatura institucional da Valion Sistemas no rodapé

- **Status:** ✅ Implementada. `test:domain` verde, `test:e2e` 113/113, validação visual real
  (Playwright headless, desktop 1280px + mobile 375px, com e sem `prefers-reduced-motion`) sem
  erros de console.
- **Escopo:** substituir o texto "Plataforma desenvolvida por TH System" (+ telefone associado) no
  rodapé da loja por uma assinatura institucional da Valion Sistemas — sem alterar a arquitetura da
  REF-BRAND-01 (dois projetos Vercel, proxy `/encanto`, landing separada).

## 1. Contexto e decisão estratégica

O dono revisou a REF-BRAND-01 e decidiu inverter o funil original: em vez do usuário entrar pela
landing institucional, o Encanto System passa a ser a porta de entrada principal (currículo,
LinkedIn, GitHub, QR Code) — o produto é o protagonista, a empresa aparece discretamente como quem o
desenvolveu, no rodapé, no mesmo padrão usado por plataformas profissionais de mercado (referência
conceitual: Delivery Direto — só o *conceito* de branding discreto no rodapé, nunca layout/cores).
Isso não muda nenhum código desta REF (é orientação de produto/portfólio, não uma rota nova) — só
justifica por que o rodapé importa mais agora.

## 2. Restrição de design mais importante — fundo do rodapé é intocável

Iteração inicial (protótipo) usava um pequeno "cartão" branco com sombra para hospedar o símbolo,
por causa de um problema técnico real (§3). O dono corrigiu isso com uma regra absoluta: **o rodapé
não pode ganhar nenhum fundo, card, borda, divisor ou área destacada própria — só o conteúdo (texto/
símbolo) muda, herdando exatamente o que já está atrás dele.** A versão final:

- `.valion-credit-link` não declara `background` em nenhum estado.
- Removido o `border-top` que uma iteração intermediária tinha adicionado (não existia no bloco
  original — foi engano meu, não uma correção de fundo pedida).
- Padding do contêiner externo mantido idêntico ao bloco antigo: `32px 16px` (`StoreApp.jsx`).

## 3. Símbolo — recorte por preenchimento a partir da borda (não por brilho)

O arquivo de marca oficial (fornecido pelo dono, só como raster) tem uma fita prateada que se
dissolve gradualmente até branco puro perto da ponta — parte deliberada do desenho. A primeira
tentativa de remover o fundo branco usou um alfa proporcional ao brilho de cada pixel
(`alpha = 255 - min(R,G,B)`): isso também tornava transparentes os tons claros *da própria fita*
(não são fundo), fazendo-a "lavar" visualmente contra o creme do Encanto — apontado corretamente
pelo dono.

**Correção:** *flood fill* (BFS) a partir das 4 bordas da imagem, avançando só por pixels
CONECTADOS a um canto e com distância a branco puro (`(255-R)+(255-G)+(255-B)`) abaixo de um limiar
apertado (14). Qualquer pixel não alcançável a partir da borda — mesmo claro — fica 100% opaco. Isso
remove o canvas branco chapado ao redor do símbolo sem tocar nos tons internos do próprio desenho
(medidos: fundo real ≈ `#FFFEFE` a `#FDFDFD`, distância ≈1–2; ponto mais claro da fita ≈ `#F0F0F0`,
distância ≈42 — gap suficiente para o limiar de 14 nunca vazar pra dentro da arte). Implementado em
PowerShell/`System.Drawing` (`LockBits` + BFS manual, fora do build — só gera o PNG final em
`public/valion-mark.png`).

## 4. Composição — ícone no lugar do "V"

Por pedido do dono (referência visual própria, não o Delivery Direto): o símbolo substitui a letra
"V" dentro da própria palavra ("[ícone]ALION SISTEMAS"), não um selo separado acima do nome. O link
inteiro (`<a>`) tem `aria-label` fixo com o nome completo — a composição visual truncada não afeta o
nome anunciado por leitor de tela.

## 5. Cores — extraídas do arquivo oficial, ajustadas só onde a acessibilidade exigia

Medidas via PowerShell/`System.Drawing` (amostragem de pixel, média sobre a área de preenchimento
sólido de cada elemento) contra `--creme` (`#FAF2E1`, fundo real da loja):

| Elemento | Cor | Contraste vs. `--creme` |
|---|---|---|
| "ALION" (texto) | `#070E20` (medida) | 14:1 |
| "SISTEMAS" (texto) | `#0B4FBE` (**ajustada** — ver abaixo) | 6.56:1 |
| Tagline | `#494D56` (medida, sem ajuste) | 7.6:1 |
| Símbolo (imagem) | azul original `#0E68F7` / prata (sem alfa) | não se aplica (não é texto) |

O azul original da marca (`#0E68F7`), medido em tamanho de texto pequeno, dá **4.34:1** — abaixo do
mínimo AA (4.5:1) para texto normal. Como o símbolo é imagem (logotipo, isento da regra de contraste
de texto) mas "SISTEMAS" é texto de verdade, escureci só esse uso específico para `#0B4FBE` — mesma
família de azul, mantém a identidade, cruza o mínimo com folga. O símbolo em si permanece na cor
original vívida (não é texto, e a fita prateada mede bem acima do mínimo de 3:1 para elementos
gráficos).

## 6. Interação e acessibilidade

- Hover/foco: ícone inclina 4° (`rotate(-4deg)`), traço azul sublinha "ALION SISTEMAS"
  (`width: 0→100%`), leve elevação do bloco (`translateY(-2px)`) — tudo com `transition` própria,
  **desligado sob `prefers-reduced-motion: reduce`** (mesmo padrão já usado em `html` no
  `index.css`).
- `:focus-visible` com contorno 2px sólido (`#070E20`) + `outline-offset:4px` — anel de foco visível
  para navegação por teclado, mesmo padrão de cuidado já estabelecido em outros componentes novos
  deste projeto (REF-UI-CATEGORY-01).
- `aria-label` no `<a>` cobre a leitura completa ("Valion Sistemas — visitar site institucional
  (abre em nova guia)") independente da composição visual truncada.
- `target="_blank"` + `rel="noopener noreferrer"`.

## 7. O que foi removido, propositalmente

O telefone "(38) 99220-3620" (contato pessoal associado ao antigo "TH System", não o número oficial
do Encanto — esse vem de `company_info`/`useCompanyInfo`, ponto diferente) saiu do rodapé: contato
institucional passa a ser papel do site (valionsistemas.com.br), não do produto.

## 8. Testes

- `tests/render.smoke.mjs` — nova folha `ValionCredit` (componente puro, sem hooks/DS/browser),
  markup congelado. Suíte completa: 15 folhas.
- `npm run test:domain` — verde, nenhum teste quebrado.
- `npm run test:e2e` (Chromium, suíte completa) — **113 passed**, incluindo `boot.spec.js` que
  verifica boot sem erro de JS em toda página que renderiza o rodapé.
- Validação visual real (fora do CI, Playwright ad-hoc contra `npm run dev`): desktop 1280px, mobile
  375px, com e sem `prefers-reduced-motion` — sem erros de console em nenhum caso; screenshots do
  componente real (não just a maquete) em estado normal, hover e foco.

## 9. Arquivos

- `src/components/ValionCredit.jsx` (novo) — componente puro.
- `public/valion-mark.png` (novo) — símbolo recortado, fundo transparente real (~38KB).
- `src/index.css` — bloco `VALION CREDIT` novo (sem `background`/`border` em nenhuma regra).
- `src/pages/StoreApp.jsx` — troca do texto antigo por `<ValionCredit />`, mesmo `padding` externo.
- `tests/render.smoke.mjs` — folha nova.
