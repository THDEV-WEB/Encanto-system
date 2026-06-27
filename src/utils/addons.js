/* ════════════════════════════════════════════════════════════════════════════
   addons.js — DOMÍNIO DE ADICIONAIS DO ENCANTO  (NORM-04)

   Assim como pricing.js representa o DOMÍNIO FINANCEIRO do sistema, addons.js
   representa oficialmente o DOMÍNIO DE ADICIONAIS. Fonte ÚNICA das regras:
   quais adicionais existem p/ um produto, a que grupo pertencem, quais são
   grátis/pagos, a cota de franquia grátis, e como a seleção do cliente vira preço.
   Responde "como funcionam os adicionais" — assim como pricing.js responde
   "quanto custa um pedido".

   ── REGRA INSTITUCIONAL ────────────────────────────────────────────────────
   Qualquer alteração neste módulo exige OBRIGATORIAMENTE:
     • npm run test:addons   • npm run test:pricing   • npm run build
     • revisão manual        • commit DEDICADO (isolado)
   NUNCA alterar este módulo no mesmo commit que: CSS · layout · componentes React
   · mudanças visuais · refactors de interface. Regra de negócio não se mistura com UI.

   ── API PÚBLICA DO DOMÍNIO (congelada) ─────────────────────────────────────
   Toda função exportada é API PÚBLICA. Após este commit, sem migração explícita:
   não renomear; não mudar assinatura; não mudar tipo de retorno; não trocar
   Array↔Object↔Map↔Set; não mudar a ORDEM dos itens retornados; não mudar semântica.
   Consumidores: ProductModal · Carrinho · Checkout · Monte · Batidinhas ·
   Collections · Admin · API futura · app mobile · scripts Node · workers.

   ── CONTRATO DE RETORNO (previsível — nunca exigir `if(resultado)`) ─────────
   • resolverAdicionais → Array (mesmo vazio []). Nunca null/undefined/false.
   • agruparPorGrupo    → Object (mapa grupo→Array). Nunca null.
   • selecionarFonteAdicionais → Array (mesmo vazio []).
   • gruposDoProduto    → Array de strings.
   • resolverPrecoAdicionais → Array (mesmo vazio []); cada preco é Number FINITO.
   • cotaGratis         → Number (>=0).
   • ehAdicionalGratis / marmitaPermitido → boolean.

   ── CONTRATO DE PUREZA ─────────────────────────────────────────────────────
   • 100% PURO e DETERMINÍSTICO: recebe dados, devolve dados; sem efeito colateral/estado/ambiente.
   • PROIBIDO importar/acessar: React · hooks · JSX · componentes · Context · Router ·
     window · document · localStorage · sessionStorage · Supabase · DataService ·
     estado global · DOM · qualquer API visual. (addons.js NÃO importa nada do app.)
   • IMUTABILIDADE: nunca muta o input (sort SEMPRE sobre cópia do filter). Sempre novos arrays/objetos.
   • SEM SAÍDA VISUAL: devolve só dados (ad objects, CHAVES de grupo cruas, números).
     Nunca JSX/HTML/emoji/rótulo/badge/chip/ícone/CSS. O rótulo (GRUPO_LABEL, emoji) e copy/i18n vivem na UI.
   • EXECUTÁVEL FORA DO REACT: roda em Node puro (tests/addons.golden.mjs), sem navegador/DOM/Supabase/mocks.

   ── CAMADAS (sem ciclos) ───────────────────────────────────────────────────
   • addons.js é FOLHA: não importa pricing.js nem nada do app (guard mecânico no golden).
     Integra com pricing por DADOS (addons resolve ad.preco; pricing.somaAdicionais o soma).
     Todos dependem de addons.js; ele de ninguém.

   ── COMPLEXIDADE (congelada) ───────────────────────────────────────────────
   • Não adicionar novos loops aninhados sem benchmark (scripts/bench/addons.bench.mjs) e
     revisão arquitetural. Congelar a complexidade atual (evitar filter→map→filter→reduce→sort→O(n²)).

   ── DÍVIDAS EXPLÍCITAS (não esconder) ──────────────────────────────────────
   • SEAM NORM-05: selecionarFonteAdicionais hardcoda c3→tabela, resto→MOCK_ADS (seleção de FONTE, não filtro). NORM-05 unifica.
   • MODELO DUAL: c3 real usa grupo 'simples' (gratis, preco 2.00); MOCK/offline usa 'acai' (preco 0).
     CAT_ADDON_GROUP['c3']=['acai'] está desalinhado dos dados reais — bug de DADOS, congelado em teste (P6), não reconciliado aqui.
   • Defaults herdados: grupo||ACAI e ordem??0 — congelados no golden ('acai'-default é dívida, não invariante).
   • MARMITA_PERMITIDOS: whitelist textual por substring no nome (frágil a rename). Futuro: flag ad.aplica_marmita.

   ── POLÍTICA DE SNAPSHOTS ──────────────────────────────────────────────────
   • Todo bug de produção corrigido neste domínio gera OBRIGATORIAMENTE um novo snapshot
     em tests/addons.golden.mjs. A suíte cresce com o sistema.

   Equivalência ao código anterior provada por auditoria adversarial + golden.
   ADR: docs/adr/NORM-04-dominio-adicionais.md.
   ════════════════════════════════════════════════════════════════════════════ */

/* Preço do adicional simples EXCEDENTE (após esgotar a cota grátis do tamanho).
   Regra de NEGÓCIO de adicional (não de pricing). */
export const ADICIONAL_SIMPLES_PRECO = 2.00;

/* Taxonomia de grupos como CONSTANTES de domínio (sem strings mágicas; sem rótulo/emoji — isso é UI). */
export const GRUPOS = Object.freeze({
  ACAI: 'acai',
  MARMITA: 'marmita',
  BEBIDA: 'bebida',
  SIMPLES: 'simples',
  PREMIUM: 'premium',
  FRUTAS_PREMIUM: 'frutas_premium',
  CHOCOLATES: 'chocolates',
});

/* categoria → grupos de adicionais (fallback quando o produto não tem grupos_ad). */
export const CAT_ADDON_GROUP = {
  c1: [GRUPOS.ACAI, GRUPOS.MARMITA], /* Combos */
  c8: [GRUPOS.ACAI, GRUPOS.MARMITA], /* Destaques */
  c4: [GRUPOS.ACAI],                 /* Copos Prontos */
  c3: [GRUPOS.ACAI],                 /* Monte seu Copo (dívida: dados reais usam 'simples'/...) */
  c9: [GRUPOS.ACAI],                 /* Batidinhas */
  c5: [GRUPOS.MARMITA],              /* Cardápio de Marmitas */
  c7: [],                            /* Bebidas — sem adicionais */
  c10:[GRUPOS.MARMITA],              /* Pedido Fitness */
};

/* MOCK_ADS — catálogo-sombra legado (fallback offline + fonte de TODA categoria ≠ c3 hoje).
   DÍVIDA NORM-05: a fonte única (tabela) elimina este array. Mantido verbatim (dado legado). */
export const MOCK_ADS = [
  /* ── GRÁTIS — inclusos no açaí (cota por tamanho) ── */
  {id:'ag1', nome:'Banana',            preco:0,    ativo:true, tipo:'gratis', grupo:'acai'},
  {id:'ag2', nome:'Granola',           preco:0,    ativo:true, tipo:'gratis', grupo:'acai'},
  {id:'ag3', nome:'Paçoca',            preco:0,    ativo:true, tipo:'gratis', grupo:'acai'},
  {id:'ag4', nome:'Amendoim',          preco:0,    ativo:true, tipo:'gratis', grupo:'acai'},
  {id:'ag5', nome:'Leite Condensado',  preco:0,    ativo:true, tipo:'gratis', grupo:'acai'},
  {id:'ag6', nome:'Leite em Pó',       preco:0,    ativo:true, tipo:'gratis', grupo:'acai'},
  /* ── ADICIONAIS PREMIUM — pagos ── */
  {id:'ap1', nome:'Nutella',           preco:8.00, ativo:true, tipo:'pago', grupo:'acai', subgrupo_label:'Adicionais Premium'},
  {id:'ap2', nome:'Creme de Avelã',    preco:6.00, ativo:true, tipo:'pago', grupo:'acai', subgrupo_label:'Adicionais Premium'},
  {id:'ap3', nome:'Creme de Leitinho', preco:6.00, ativo:true, tipo:'pago', grupo:'acai', subgrupo_label:'Adicionais Premium'},
  {id:'ap4', nome:'Doce de Leite',     preco:5.00, ativo:true, tipo:'pago', grupo:'acai', subgrupo_label:'Adicionais Premium'},
  /* ── FRUTAS PREMIUM — pagas ── */
  {id:'af1', nome:'Morango',           preco:6.00, ativo:true, tipo:'pago', grupo:'acai', subgrupo_label:'Frutas Premium'},
  {id:'af2', nome:'Kiwi',              preco:6.00, ativo:true, tipo:'pago', grupo:'acai', subgrupo_label:'Frutas Premium'},
  {id:'af3', nome:'Uva Verde',         preco:6.00, ativo:true, tipo:'pago', grupo:'acai', subgrupo_label:'Frutas Premium'},
  /* ── CHOCOLATES — pagos ── */
  {id:'ac1', nome:'Coloretti',         preco:4.00, ativo:true, tipo:'pago', grupo:'acai', subgrupo_label:'Chocolates'},
  {id:'ac2', nome:'Ovomaltine',        preco:4.00, ativo:true, tipo:'pago', grupo:'acai', subgrupo_label:'Chocolates'},
  /* ── Grupo: Marmita — TODOS PAGOS (regra global) ── */
  {id:'amp1',nome:'Carne Extra',       preco:5.00, ativo:true, tipo:'pago',   grupo:'marmita'},
  {id:'amp2',nome:'Frango Extra',      preco:5.00, ativo:true, tipo:'pago',   grupo:'marmita'},
  {id:'amp3',nome:'Linguiça Extra',    preco:4.00, ativo:true, tipo:'pago',   grupo:'marmita'},
  {id:'amp4',nome:'Ovo',               preco:2.00, ativo:true, tipo:'pago',   grupo:'marmita'},
  {id:'amp5',nome:'Batata Frita',      preco:3.00, ativo:true, tipo:'pago',   grupo:'marmita'},
];

/* Whitelist textual do grupo marmita (substring no nome, sem diacríticos). Frágil a rename — dívida. */
const MARMITA_PERMITIDOS = ['carne','frango','linguiça','linguica','ovo','batata','batatinha','proteína','proteina','filé','file','calabresa'];
export const marmitaPermitido = nome => {
  const n = (nome||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  return MARMITA_PERMITIDOS.some(p => n.includes(p));
};

/* Grupos aplicáveis a um produto: grupos_ad > CAT_ADDON_GROUP > [ACAI]. */
export const gruposDoProduto = prod => prod?.grupos_ad ?? CAT_ADDON_GROUP[prod?.categoria_id] ?? [GRUPOS.ACAI];

/* SEAM NORM-05 — seleção de FONTE (não de filtro): c3 usa a tabela; resto usa MOCK_ADS.
   Isolado de propósito; data-in puro. NORM-05 remove este hardcode. */
export const selecionarFonteAdicionais = (prod, dbAds, mockAds = MOCK_ADS) =>
  !prod ? [] : (prod.categoria_id === 'c3' ? (Array.isArray(dbAds) ? dbAds : []) : mockAds);

/* Predicado base compartilhado: ad pertence ao grupo g E aplica-se ao produto? */
const aplicaNoGrupo = (ad, prod, g) =>
  (ad.grupo || GRUPOS.ACAI) === g
  && (!ad.aplica_categoria_id || ad.aplica_categoria_id === prod?.categoria_id)
  && (g !== GRUPOS.MARMITA || marmitaPermitido(ad.nome));

/* FLAT — adicionais aplicáveis ao produto, na ORDEM da fonte (filtro não reordena).
   `fonte` já vem resolvida (selecionarFonteAdicionais), data-in puro. */
export const resolverAdicionais = (fonte, prod) => {
  const grupos = gruposDoProduto(prod);
  if (grupos.length === 0) return [];
  return (fonte || []).filter(ad => grupos.some(g => aplicaNoGrupo(ad, prod, g)));
};

/* GROUPED — { grupo: ad[] } ordenado por `ordem`. sort SEMPRE sobre a cópia do filter (nunca muta input). */
export const agruparPorGrupo = (ads, prod) => {
  const grupos = gruposDoProduto(prod), out = {};
  grupos.forEach(g => {
    out[g] = (ads || []).filter(ad => aplicaNoGrupo(ad, prod, g)).sort((x, y) => (x.ordem ?? 0) - (y.ordem ?? 0));
  });
  return out;
};

/* Adicional é grátis? Classificação por TIPO (vence preço) ou preço zero. */
export const ehAdicionalGratis = ad => ad.tipo === 'gratis' || Number(ad.preco) === 0;

/* Cota de franquia grátis: por tamanho selecionado (ou 1º tamanho), senão pelo produto. */
export const cotaGratis = (prod, tamanho) =>
  (Array.isArray(prod?.tamanhos) && prod.tamanhos.length > 0)
    ? Number((tamanho || prod.tamanhos[0])?.adicionais_gratis ?? prod.adicionais_gratis ?? 0)
    : Number(prod?.adicionais_gratis || 0);

/* Resolve o preço EFETIVO da seleção pela franquia grátis (vindo do NORM-03, Tier 3):
   primeiros `cota` elegíveis = 0; excedentes = preço próprio ou ADICIONAL_SIMPLES_PRECO.
   SAÍDA sempre Number FINITO — pricing.somaAdicionais soma cru (sem ||0), nunca recebe NaN daqui. */
export const resolverPrecoAdicionais = (sel, cota, ehGratisAd) => {
  let usados = 0;
  return (sel || []).map(ad => ehGratisAd(ad)
    ? (usados++, { ...ad, preco: usados <= cota ? 0 : (Number(ad.preco) || ADICIONAL_SIMPLES_PRECO) })
    : { ...ad, preco: Number(ad.preco) || 0 });
};
