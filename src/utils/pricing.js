/* ════════════════════════════════════════════════════════════════════════════
   pricing.js — CENTRO FINANCEIRO DO ENCANTO  (NORM-03)
   Fonte ÚNICA do cálculo de preço do catálogo/carrinho. Toda quantia exibida ou
   gravada (orders.total, order_items.price) deriva daqui.

   ── CONTRATO (congelado) ───────────────────────────────────────────────────
   • Módulo 100% PURO: só funções puras, sem efeito colateral, sem estado.
   • PROIBIDO acessar, importar ou depender de:
       React · hooks · contexto · estado global · window · document ·
       localStorage · Supabase · DataService · DOM · rede · relógio (Date).
     (O golden test roda este módulo em Node puro — sem DOM/React — o que já
      barra na prática qualquer uso desses globais.)
   • Entrada/saída: apenas valores numéricos CRUS. Nada de objeto de UI.

   ── ARREDONDAMENTO (permanente) ────────────────────────────────────────────
   • NUNCA arredondar aqui. Proibido Math.round() · toFixed() · parseFloat().
   • Centavos/formatação pertencem EXCLUSIVAMENTE a fmt() (camada de exibição).
   • As funções trabalham com floats crus; o ULP é preservado de propósito.

   ── COERÇÃO (permanente) ───────────────────────────────────────────────────
   • Number() faz parte do CONTRATO. NÃO trocar por parseFloat()/parseInt() sem
     revisão arquitetural — mudaria o comportamento financeiro silenciosamente.
   • Usar sempre `||`, NUNCA `??`: preco_promo 0/'' caem no preço cheio, não viram promo.
   • Number() CRU, SEM `||0` extra: preço/adicional ausente vira NaN (não 0).
     NÃO copiar a variante do monólito (Encanto/Encanto/cartStore.js:108-110),
     cujos `||0` transformam NaN→0 e divergiriam (receita fantasma).

   ── SAÍDA SEMPRE NUMÉRICA (permanente) ─────────────────────────────────────
   • PROIBIDO converter para string aqui: toFixed() · toPrecision() · String(x) ·
     template-literal / concatenação de valores monetários (`'R$ '+v`, `${v}`…).
   • toFixed() devolve STRING e arredonda → abre porta para concatenação no lugar
     de soma, coerção implícita e drift financeiro silencioso.
   • Toda conversão para string pertence EXCLUSIVAMENTE a fmt() (apresentação).
     Estas funções entram e saem SEMPRE como Number cru.

   ── SEM MÁSCARA NUMÉRICA (permanente) ──────────────────────────────────────
   • NUNCA usar Number.EPSILON (nem outro "fudge factor") para "corrigir" valores
     financeiros. Divergência financeira se resolve pela MODELAGEM DO DOMÍNIO
     (ex.: migrar para centavos inteiros), nunca mascarando com ajuste numérico.

   ── ORDEM DO FOLD (permanente) ─────────────────────────────────────────────
   • base → adicionais (esquerda→direita, seed 0) → ×qty → Σ itens.
     Não trocar por reduceRight nem pré-somar: mudaria o último ULP em carrinhos
     grandes/fracionários. A equivalência byte-a-byte depende disso.

   Equivalência ao código anterior provada por auditoria adversarial (15+ casos/
   função) e travada em tests/pricing.golden.mjs.
   ════════════════════════════════════════════════════════════════════════════ */

/* Soma dos adicionais (mantém o guarda (arr||[]) interno — call site passa item.adicionais). */
export const somaAdicionais = adicionais =>
  (adicionais || []).reduce((s, ad) => s + Number(ad.preco), 0);

/* Preço-base do item: promo quando houver, senão cheio. */
export const precoBaseItem = item => Number(item.preco_promo || item.preco);

/* Preço unitário = base + adicionais por unidade. */
export const precoUnitario = item => precoBaseItem(item) + somaAdicionais(item.adicionais);

/* Preço da linha = unitário × quantidade. */
export const precoLinha = item => precoUnitario(item) * item.qty;

/* Total do carrinho = Σ das linhas (sem guarda — espelha o items.reduce atual). */
export const totalCarrinho = items => items.reduce((a, i) => a + precoLinha(i), 0);

/* Em promoção? Predicado de exibição — retorna o OPERANDO (não booleano), como hoje. */
export const emPromocao = prod => prod.preco_promo && Number(prod.preco_promo) < Number(prod.preco);

/* Preço de vitrine (o que o cliente vê). Sempre consumido via fmt() — não auto-sanitiza. */
export const precoVitrine = prod => prod.preco_promo || prod.preco;
