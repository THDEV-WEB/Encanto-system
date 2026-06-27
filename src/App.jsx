import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { ENCANTO_LOGO } from './logo.js';
import AppShell from './AppShell.jsx';
import './index.css';
import { fmt, fmtDate, precoApartir, precoTamanho, norm } from './utils/format.js';
import { precoUnitario, precoLinha, totalCarrinho, emPromocao, precoVitrine } from './utils/pricing.js';
import { MOCK_ADS, ADICIONAL_SIMPLES_PRECO, resolverAdicionais, agruparPorGrupo, selecionarFonteAdicionais, cotaGratis, ehAdicionalGratis, resolverPrecoAdicionais } from './utils/addons.js';

/* ============================================================
   ENCANTO DELIVERY — React 18 + Supabase v2
   (migrado para Vite: build real, sem Babel no browser)
   ============================================================ */

/* -- Config (via variaveis de ambiente VITE_*) -- */
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_KEY;
const WHATSAPP = import.meta.env.VITE_WHATSAPP || '5538992203620';
const RPC_TIMEOUT = Number(import.meta.env.VITE_RPC_TIMEOUT) || 12000; /* ms; configurável, fallback seguro */
const LOGO     = ENCANTO_LOGO || '';

/* -- Cliente Supabase -- */
let db = null;
try {
  db = createClient(SUPA_URL, SUPA_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  console.log('[Encanto] Supabase client criado');
} catch (e) {
  console.warn('[Encanto] Supabase init erro:', e && e.message);
  db = null;
}
/* ── Helpers ─────────────────────────────────────────────────── */
const CAT_EMOJI = {
  'combo marmitex + açaí':'🎁','combos':'🎁',
  'cardápio de marmitas':'🍱','marmitas':'🍱',
  'açaí':'🍧','copos prontos':'🍧',
  'monte seu copo':'🍧','batidinhas':'🥤',
  'pedido fitness':'💪','bebidas':'🧃',
};
const catEmoji = (nome='') => CAT_EMOJI[(nome||'').toLowerCase()] || '🍽️';

/* URL http(s) válida — string começando com http:// ou https://. */
const isHttpUrl = (url) => typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));

/* ── Mock Data ───────────────────────────────────────────────── */
const MOCK_CATS = [
  /* Ordem fixa solicitada (8 categorias):
     1 Cardápio de Marmitas, 2 Destaques, 3 Copos Prontos, 4 Monte seu Copo,
     5 Batidinhas, 6 Combos, 7 Pedido Fitness, 8 Bebidas.
     "Açaí" foi renomeada para "Copos Prontos" (mesmo id 'c4', só o nome mudou).
     "Monte seu Copo" (c3) e "Batidinhas" (c9) são categorias independentes — os
     produtos já foram migrados para elas (ver MOCK_PRODS) e cada uma é renderizada
     pela mesma seção genérica usada por todas as outras categorias, sem agrupamento
     especial (a antiga lógica de 3 blocos dentro de "Açaí" foi removida).
     "Promoção do Dia" (antiga c2) e "Cardápio Açaí" (antiga c6) continuam descontinuadas
     e removidas — ver CATEGORIAS_DESCONTINUADAS para o filtro de segurança que também
     as oculta caso ainda existam como linhas antigas no Supabase. */
  {id:'c5',  nome:'Cardápio de Marmitas', icone:'🍱',cor:'#16A34A',ordem:1, ativo:true},
  {id:'c8',  nome:'Destaques',            icone:'⭐',cor:'#D97706',ordem:2, ativo:true},
  {id:'c4',  nome:'Copos Prontos',        icone:'🍧',cor:'#7C3AED',ordem:3, ativo:true},
  {id:'c3', nome:'Monte seu Copo',       icone:'🍧',cor:'#7C3AED',ordem:4, ativo:true},
  {id:'c9', nome:'Batidinhas',           icone:'🥤',cor:'#7C3AED',ordem:5, ativo:true},
  {id:'c1',  nome:'Combos',               icone:'🎁',cor:'#6B21A8',ordem:6, ativo:true},
  {id:'c10', nome:'Pedido Fitness',       icone:'💪',cor:'#16A34A',ordem:7, ativo:true},
  {id:'c7',  nome:'Bebidas',              icone:'🧃',cor:'#0891B2',ordem:8, ativo:true},
];
const MOCK_PRODS = [
  /* Combos (antes "Combo Marmitex + Açaí") */
  /* ══ Combos (c1) ══ */
  {id:'p1', nome:'Marmita P + Açaí 300ml',            descricao:'Com 3 adicionais grátis',    preco:29.90,preco_promo:null,categoria_id:'c1',imagem_url:'',disponivel:true,adicionais_gratis:3,grupos_ad:['marmita','acai'],upsell_bebida:true},
  {id:'p2', nome:'Marmita G 2 proteínas + Açaí 500ml',descricao:'Com 4 adicionais grátis',   preco:49.90,preco_promo:null,categoria_id:'c1',imagem_url:'',disponivel:true,adicionais_gratis:4,grupos_ad:['marmita','acai'],upsell_bebida:true},
  {id:'p3', nome:'Marmita P + Batidinha de Açaí 300ml',descricao:'Combinação perfeita',      preco:49.90,preco_promo:null,categoria_id:'c1',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:['marmita'],upsell_bebida:true},
  /* ══ Destaques (c8) ══ */
  {id:'pd1',nome:'Marmita Média + Açaí 300 ml',  descricao:'3 adicionais grátis',          preco:29.90,preco_promo:null,categoria_id:'c8',categoria_ids:['c8','c1'],imagem_url:'',disponivel:true,adicionais_gratis:3,destaque:true,badge:'mais_vendido',grupos_ad:['marmita','acai'],upsell_bebida:true},
  {id:'pd2',nome:'Açaí 500 ml',                   descricao:'4 adicionais grátis',          preco:15.99,preco_promo:null,categoria_id:'c8',imagem_url:'',disponivel:true,adicionais_gratis:4,destaque:true,badge:'favorito',grupos_ad:['acai'],upsell_bebida:true},
  {id:'pd3',nome:'Marmita + Suco Natural',         descricao:'Escolha o suco: Maracujá, Goiaba ou Abacaxi',preco:29.90,preco_promo:null,categoria_id:'c8',imagem_url:'',disponivel:true,adicionais_gratis:3,destaque:true,grupos_ad:['marmita'],upsell_bebida:false,variantes:['Maracujá','Goiaba','Abacaxi']},
  {id:'pd4',nome:'Açaí 700 ml especial',           descricao:'Produto premium — 4 adicionais grátis',preco:25.99,preco_promo:null,categoria_id:'c8',imagem_url:'',disponivel:true,adicionais_gratis:4,destaque:true,badge:'novo',grupos_ad:['acai'],upsell_bebida:true},
  /* ══ Copos Prontos (c4) — apenas produtos prontos de açaí ══ */
  {id:'pa1',nome:'Encanto Mineiro',   descricao:'Açaí com banana, granola e leite condensado', preco:19.90,preco_promo:null,categoria_id:'c4',imagem_url:'',disponivel:true,adicionais_gratis:0,subgrupo:'pronto'},
  {id:'pa2',nome:'Encanto Clássico',  descricao:'Açaí tradicional com granola e morango',       preco:18.90,preco_promo:null,categoria_id:'c4',imagem_url:'',disponivel:true,adicionais_gratis:0,subgrupo:'pronto'},
  {id:'pa3',nome:'Encanto Fit',       descricao:'Açaí sem açúcar, granola e chia',              preco:18.90,preco_promo:null,categoria_id:'c4',imagem_url:'',disponivel:true,adicionais_gratis:0,subgrupo:'pronto'},
  {id:'pa4',nome:'Encanto Casadinho', descricao:'Açaí com creme de leitinho e Nutella',         preco:21.90,preco_promo:null,categoria_id:'c4',imagem_url:'',disponivel:true,adicionais_gratis:0,subgrupo:'pronto'},
  {id:'pa5',nome:'Encanto Tropical',  descricao:'Açaí com morango, banana e kiwi',              preco:19.90,preco_promo:null,categoria_id:'c4',imagem_url:'',disponivel:true,adicionais_gratis:0,subgrupo:'pronto'},
  /* ══ Batidinhas (c9) ══ */
  /* Modelo antigo (genérico, mantido apenas como fallback — não exibido se modelo novo existir) */
  {id:'pb_old1',nome:'Batidinha de Açaí 300 ml', descricao:'Batidinha cremosa de açaí',preco:19.90,preco_promo:null,categoria_id:'c9',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,subgrupo:'batidinha'},
  {id:'pb_old2',nome:'Batidinha de Açaí 500 ml', descricao:'Batidinha cremosa de açaí',preco:29.90,preco_promo:null,categoria_id:'c9',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,subgrupo:'batidinha'},
  /* Modelo novo — 1 produto por sabor, tamanho escolhido no modal */
  {id:'pb1',nome:'Tradicional',      descricao:'Batidinha cremosa de açaí',                    preco:18.00,preco_promo:null,categoria_id:'c9',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,badge:'mais_vendido',subgrupo:'batidinha',
    tamanhos:[{label:'300 ml',preco:18.00},{label:'500 ml',preco:23.00}]},
  {id:'pb2',nome:'Maracujá',         descricao:'Batidinha de açaí com maracujá',               preco:18.00,preco_promo:null,categoria_id:'c9',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,subgrupo:'batidinha',
    tamanhos:[{label:'300 ml',preco:18.00},{label:'500 ml',preco:23.00}]},
  {id:'pb3',nome:'Creme de Leitinho',descricao:'Batidinha de açaí com creme de leitinho',      preco:22.00,preco_promo:null,categoria_id:'c9',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,subgrupo:'batidinha',
    tamanhos:[{label:'300 ml',preco:22.00},{label:'500 ml',preco:28.00}]},
  {id:'pb4',nome:'Nutella',          descricao:'Batidinha de açaí com Nutella',                preco:22.00,preco_promo:null,categoria_id:'c9',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,subgrupo:'batidinha',
    tamanhos:[{label:'300 ml',preco:22.00},{label:'500 ml',preco:28.00}]},
  /* ══ Monte seu Copo (c3) — modelo novo: 1 produto por base, tamanho escolhido no modal ══
     Mesma arquitetura/engine das Batidinhas: cada base é um produto independente com seu
     próprio array `tamanhos` (preço + adicionais grátis por tamanho). O preço por tamanho
     é o mesmo para as 5 bases nesta etapa ("ainda não alterar preços premium") — se algum
     dia uma base precisar de preço diferenciado, basta sobrescrever o `tamanhos` daquele
     produto; nenhuma mudança de código é necessária, pois a engine (ProductCard/Modal/
     carrinho) já é 100% genérica sobre esse array. */
  {id:'pmc1',nome:'Açaí',               descricao:'Base de açaí tradicional, no tamanho que você escolher',  preco:17.99,preco_promo:null,categoria_id:'c3',imagem_url:'',disponivel:true,adicionais_gratis:2,subgrupo:'monte',
    tamanhos:[{label:'300 ml',preco:17.99,adicionais_gratis:2},{label:'500 ml',preco:26.99,adicionais_gratis:3},{label:'700 ml',preco:35.99,adicionais_gratis:4}]},
  {id:'pmc2',nome:'Cupuaçu',            descricao:'Base de cupuaçu cremoso, no tamanho que você escolher',    preco:17.99,preco_promo:null,categoria_id:'c3',imagem_url:'',disponivel:true,adicionais_gratis:2,subgrupo:'monte',
    tamanhos:[{label:'300 ml',preco:17.99,adicionais_gratis:2},{label:'500 ml',preco:26.99,adicionais_gratis:3},{label:'700 ml',preco:35.99,adicionais_gratis:4}]},
  {id:'pmc3',nome:'Açaí + Cupuaçu',     descricao:'Mistura de açaí e cupuaçu, no tamanho que você escolher',  preco:17.99,preco_promo:null,categoria_id:'c3',imagem_url:'',disponivel:true,adicionais_gratis:2,subgrupo:'monte',
    tamanhos:[{label:'300 ml',preco:17.99,adicionais_gratis:2},{label:'500 ml',preco:26.99,adicionais_gratis:3},{label:'700 ml',preco:35.99,adicionais_gratis:4}]},
  {id:'pmc4',nome:'Açaí 0 Açúcar',      descricao:'Açaí sem adição de açúcar, no tamanho que você escolher',  preco:17.99,preco_promo:null,categoria_id:'c3',imagem_url:'',disponivel:true,adicionais_gratis:2,subgrupo:'monte',
    tamanhos:[{label:'300 ml',preco:17.99,adicionais_gratis:2},{label:'500 ml',preco:26.99,adicionais_gratis:3},{label:'700 ml',preco:35.99,adicionais_gratis:4}]},
  {id:'pmc5',nome:'Mousse de Maracujá', descricao:'Mousse cremoso de maracujá, no tamanho que você escolher', preco:17.99,preco_promo:null,categoria_id:'c3',imagem_url:'',disponivel:true,adicionais_gratis:2,subgrupo:'monte',
    tamanhos:[{label:'300 ml',preco:17.99,adicionais_gratis:2},{label:'500 ml',preco:26.99,adicionais_gratis:3},{label:'700 ml',preco:35.99,adicionais_gratis:4}]},
  /* Cardápio de Marmitas — Tradicional do Dia (P/M/G fixos, composição via descrição) */
  {id:'p9', nome:'Marmita P',  descricao:'Arroz • Feijão • Macarrão\nProteínas do dia: Bife acebolado • Frango grelhado',  preco:18.00,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:true,adicionais_gratis:0},
  {id:'p10',nome:'Marmita M',  descricao:'Arroz • Feijão • Macarrão\nProteínas do dia: Bife acebolado • Frango grelhado',  preco:22.00,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:true,adicionais_gratis:0},
  {id:'p10g',nome:'Marmita G', descricao:'Arroz • Feijão • Macarrão\nProteínas do dia: Bife acebolado • Frango grelhado',  preco:25.99,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:true,adicionais_gratis:0},
  /* Cardápio de Marmitas — Pratos Especiais do Dia (ativar/desativar via painel admin) */
  {id:'pe1',nome:'Parmegiana',       descricao:'Filé empanado coberto com molho e queijo, acompanha arroz e fritas', preco:32.90,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:true,adicionais_gratis:0},
  {id:'pe2',nome:'Strogonoff',       descricao:'Strogonoff cremoso, acompanha arroz e batata palha',                  preco:29.90,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:false,adicionais_gratis:0},
  {id:'pe3',nome:'Costelinha Barbecue', descricao:'Costelinha suína ao barbecue, acompanha arroz e farofa',           preco:34.90,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:true,adicionais_gratis:0},
  {id:'pe4',nome:'Feijoada',         descricao:'Feijoada completa com acompanhamentos tradicionais',                  preco:36.90,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:false,adicionais_gratis:0},
  {id:'pe5',nome:'Lasanha',          descricao:'Lasanha à bolonhesa gratinada',                                        preco:28.90,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:true,adicionais_gratis:0},
  {id:'pe6',nome:'Filé de Tilápia',  descricao:'Filé de tilápia grelhado, acompanha arroz e legumes',                 preco:33.90,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:true,adicionais_gratis:0},
  /* Pedido Fitness (c10) */
  {id:'pf1',nome:'Marmita Fitness Personalizada',
    descricao:'Tamanho M — R$ 19,90',
    preco:19.90,preco_promo:null,categoria_id:'c10',imagem_url:'',disponivel:true,
    adicionais_gratis:0,grupos_ad:['marmita'],upsell_bebida:true,
    aviso:'No valor de R$ 19,90 a marmita fitness inclui: até 2 proteínas, quantidade padrão de arroz, feijão e legumes. Quantidades extras ou adicionais são cobrados à parte. Utilize o campo de observação para personalizar.',
    obs_campos:['O que deseja retirar','O que deseja adicionar','Como deseja a montagem','Observações gerais'],
  },
  {id:'pf2',nome:'Açaí Zero Açúcar',
    descricao:'Sem adição de açúcar — saudável e delicioso',
    preco:14.99,preco_promo:null,categoria_id:'c10',imagem_url:'',disponivel:true,
    adicionais_gratis:3,grupos_ad:['acai'],upsell_bebida:false,
    variantes:['300 ml — R$ 14,99','500 ml — R$ 19,90','700 ml — R$ 22,90'],
  },
  /* Bebidas */
  {id:'pac',nome:'Agua de Coco',
    descricao:'Água de coco natural, refrescante',preco:14.99,preco_promo:null,
    categoria_id:'c7',
    imagem_url:'https://images.unsplash.com/photo-1559181567-c3190e573b5e?w=400&q=80&auto=format&fm=webp&fit=crop',
    disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,
    destaque:true},
  {id:'p15',nome:'Água Mineral 500ml',
    descricao:'Gelada, 500ml',preco:5.00,preco_promo:null,categoria_id:'c7',
    imagem_url:'https://images.unsplash.com/photo-1553564552-02656ef5d8a7?w=400&q=80&auto=format&fm=webp&fit=crop',
    disponivel:true,adicionais_gratis:0},
  {id:'p16',nome:'Suco Natural de Maracujá',
    descricao:'Feito na hora, com maracujá fresco',preco:8.00,preco_promo:null,categoria_id:'c7',
    imagem_url:'https://images.unsplash.com/photo-1640457298166-04de9c5c01fd?w=400&q=80&auto=format&fm=webp&fit=crop',
    disponivel:true,adicionais_gratis:0},
  {id:'p17',nome:'Suco Natural de Goiaba',
    descricao:'Feito na hora, com goiaba fresca',preco:8.00,preco_promo:null,categoria_id:'c7',
    imagem_url:'https://images.unsplash.com/photo-1623163028693-1949a2af3cf3?w=400&q=80&auto=format&fm=webp&fit=crop',
    disponivel:true,adicionais_gratis:0},
  {id:'p18',nome:'Suco de Abacaxi com Hortelã',
    descricao:'Abacaxi fresco com hortelã',preco:8.00,preco_promo:null,categoria_id:'c7',
    imagem_url:'https://images.unsplash.com/photo-1546171753-97d7676e4602?w=400&q=80&auto=format&fm=webp&fit=crop',
    disponivel:true,adicionais_gratis:0},
  {id:'p19',nome:'Suco de Couve',
    descricao:'Suco verde natural com couve',preco:8.00,preco_promo:null,categoria_id:'c7',
    imagem_url:'https://images.unsplash.com/photo-1610970881699-44a5587cabec?w=400&q=80&auto=format&fm=webp&fit=crop',
    disponivel:true,adicionais_gratis:0},
  {id:'p21',nome:'Coca-Cola 2L',
    descricao:'Garrafa 2 litros gelada',preco:15.00,preco_promo:null,categoria_id:'c7',
    imagem_url:'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=400&q=80&auto=format&fm=webp&fit=crop',
    disponivel:true,adicionais_gratis:0},
  {id:'p22',nome:'Coca-Cola 600ml',
    descricao:'Garrafa 600ml gelada',preco:10.00,preco_promo:null,categoria_id:'c7',
    imagem_url:'https://images.unsplash.com/photo-1592461985780-30898f2a4b43?w=400&q=80&auto=format&fm=webp&fit=crop',
    disponivel:true,adicionais_gratis:0},
  {id:'p23',nome:'Coca-Cola Lata',
    descricao:'Lata 350ml gelada',preco:8.00,preco_promo:null,categoria_id:'c7',
    imagem_url:'https://images.unsplash.com/photo-1581098365948-6a5a912b7a49?w=400&q=80&auto=format&fm=webp&fit=crop',
    disponivel:true,adicionais_gratis:0},
  {id:'p24',nome:'Guaraná Antarctica Lata',
    descricao:'Lata 350ml gelada',preco:8.00,preco_promo:null,categoria_id:'c7',
    imagem_url:'https://images.unsplash.com/photo-1625772299848-391b6a87d7b3?w=400&q=80&auto=format&fm=webp&fit=crop',
    disponivel:true,adicionais_gratis:0},
  {id:'p25',nome:'Fanta Laranja Lata',
    descricao:'Lata 350ml gelada',preco:8.00,preco_promo:null,categoria_id:'c7',
    imagem_url:'https://images.unsplash.com/photo-1625772452859-1c03d884dcd7?w=400&q=80&auto=format&fm=webp&fit=crop',
    disponivel:true,adicionais_gratis:0},
];
/* ── Domínio de adicionais → src/utils/addons.js (NORM-04) ──────────────────
   MOCK_ADS, CAT_ADDON_GROUP, marmitaPermitido, gruposDoProduto,
   selecionarFonteAdicionais (seam NORM-05), resolverAdicionais (ex-getAdicionaisProd),
   agruparPorGrupo (ex-getAdsByGrupo), ehAdicionalGratis, cotaGratis,
   resolverPrecoAdicionais e ADICIONAL_SIMPLES_PRECO vivem agora em ./utils/addons.js. */


/* ── Categorias descontinuadas ──────────────────────────────────
   "Promoção do Dia" e "Cardápio Açaí" foram removidas permanentemente
   da loja. Este filtro garante que elas nunca apareçam para o cliente
   mesmo que a linha ainda exista no Supabase (ex.: admin ainda não
   excluiu manualmente) — comparação por nome normalizado, já que os
   IDs reais do banco não são os mesmos dos mocks ('c2'/'c6').
   Não afeta o Admin Panel: lá o restaurante continua vendo e podendo
   excluir essas categorias normalmente via DS.getAllCats(). ────────── */
const CATEGORIAS_DESCONTINUADAS = [
  'promocao do dia','promocoes do dia',
  'cardapio de acai','cardapio acai',
];
const isCategoriaDescontinuada = cat => CATEGORIAS_DESCONTINUADAS.includes(norm(cat?.nome));

/* ── FIX truncamento PostgREST (teto ~1000 linhas) ───────────────────────────
   products.select(...) direto retorna no máximo ~1000 linhas (limite padrão do
   PostgREST) e trunca o catálogo em silêncio acima disso. fetchAllProductsSafe
   pagina com .range() até a página vir incompleta, montando a lista COMPLETA.
   Rollback em 1 linha: trocar PRODUCTS_PAGINATE para false → volta ao select direto. */
const PRODUCTS_PAGE_SIZE = 1000;   /* tamanho de página do .range() (≤ teto do PostgREST) */
const PRODUCTS_PAGINATE  = true;   /* ⇐ ROLLBACK: false restaura o select direto (1 página) */
const PRODUCTS_CACHE_TTL = 5 * 60 * 1000;  /* 5 min — cache global da lista COMPLETA (sem busca) */

/* ── DataService ─────────────────────────────────────────────── */
const DS = {
  /* HARDENING — cache global leve da lista COMPLETA de produtos (só quando NÃO há
     `search`): reduz fetchAllProductsSafe duplicado ao navegar entre categorias (o
     filtro de categoria é client-side, então a mesma lista serve todas). Invisível ao
     frontend; TTL = PRODUCTS_CACHE_TTL; invalidado em qualquer escrita de produto. */
  _globalProductsCache: null,
  _globalProductsCacheTime: 0,
  _invalidateProductsCache() { this._globalProductsCache = null; this._globalProductsCacheTime = 0; },
  async run(fn, { throwOnError = false } = {}) {
    if (!db) {
      if (throwOnError) throw new Error('Supabase indisponível (offline).');
      return {data:null,error:{message:'offline'}};
    }
    try {
      const res = await fn(db);
      // Erros lógicos do Supabase chegam em res.error (não são lançados).
      // Em operações de escrita (throwOnError), propagar para não falhar em silêncio.
      if (res && res.error && throwOnError) throw res.error;
      return res;
    } catch(e) {
      console.warn('[DS]', e?.message || e);
      if (throwOnError) throw e;
      return {data:null,error:e};
    }
  },
  /* Busca TODOS os produtos contornando o teto de ~1000 linhas do PostgREST.
     makeQuery(d) devolve a query base (select+filtros+order) já pronta; aqui só
     aplicamos .range() e acumulamos. Retorna {data,error} no MESMO formato de run(),
     para getProds/getAllProds tratarem erro/offline exatamente como antes.
     Requer ordenação TOTAL (order primário + desempate por id) p/ o range não pular
     nem repetir linhas entre páginas — por isso getProds/getAllProds acrescentam
     .order('id'). Com PRODUCTS_PAGINATE=false, faz 1 chamada (comportamento legado). */
  async fetchAllProductsSafe(makeQuery) {
    if (!PRODUCTS_PAGINATE) return this.run(d => makeQuery(d));   /* rollback: select direto */
    const acc = [];
    for (let from = 0; ; from += PRODUCTS_PAGE_SIZE) {
      const to = from + PRODUCTS_PAGE_SIZE - 1;
      const r = await this.run(d => makeQuery(d).range(from, to));
      if (r.error) return { data: null, error: r.error };        /* propaga erro/offline → fallback MOCK */
      const page = r.data ?? [];
      acc.push(...page);
      if (page.length < PRODUCTS_PAGE_SIZE) break;               /* página incompleta → fim */
      console.warn('[DS] Página retornou pageSize completo — possível continuação');  /* guardrail */
    }
    return { data: acc, error: null };
  },
  async getCats() {
    /* Retorna array (vazio ou com dados) quando banco responde; null quando offline/erro */
    const r = await this.run(d=>d.from('categories').select('*').eq('ativo',true).order('ordem'));
    if (r.error && r.error.message !== 'offline') console.warn('[DS] getCats error:', r.error.message);
    return r.error ? null : (r.data ?? []);
  },
  async getAllCats() {
    const r = await this.run(d=>d.from('categories').select('*').order('ordem'));
    return r.error ? null : (r.data ?? []);
  },
  async getProds(catId, search) {
    /* Faz join com categorias para trazer o nome da categoria junto com o produto.
       Sempre busca todos os produtos disponíveis e filtra no cliente para suportar
       o campo categoria_ids (array de múltiplas categorias) sem alterar o schema. */
    /* Cache global: como a busca por categoria é client-side, a lista COMPLETA (sem
       `search`) serve qualquer catId — servimos do cache e só aplicamos prodInCat.
       Busca server-side (search) nunca usa cache (sempre fresca). Invisível ao front. */
    const cacheavel = !search;
    let data;
    if (cacheavel && this._globalProductsCache && (Date.now() - this._globalProductsCacheTime) < PRODUCTS_CACHE_TTL) {
      data = this._globalProductsCache;
    } else {
      const r = await this.fetchAllProductsSafe(d=>{
        let q = d.from('products')
          .select('*, categories(id, nome, icone, cor)')
          .eq('disponivel', true);
        if (search) q = q.ilike('nome', `%${search}%`);
        return q.order('ordem', { ascending: true }).order('id', { ascending: true });
      });
      if (r.error && r.error.message !== 'offline') console.warn('[DS] getProds error:', r.error.message);
      if (r.error) return null;
      data = r.data ?? [];
      if (cacheavel) { this._globalProductsCache = data; this._globalProductsCacheTime = Date.now(); }
    }
    /* Filtro de categoria no cliente — suporta categoria_id (legado) e categoria_ids (novo) */
    return catId ? data.filter(p => prodInCat(p, catId)) : data;
  },
  async getAllProds() {
    const r = await this.fetchAllProductsSafe(d=>d.from('products').select('*, categories(id, nome, icone, cor)').order('nome').order('id', { ascending: true }));
    return r.error ? null : (r.data ?? []);
  },
  async getAds() {
    const r = await this.run(d=>d.from('adicionais').select('*').eq('ativo',true).order('nome'));
    return r.data?.length ? r.data : null;
  },
  async getAllAds() {
    const r = await this.run(d=>d.from('adicionais').select('*').order('nome'));
    return r.data ?? null;
  },
  /* HARDEN-ORDERS-03/04: persistência transacional + idempotente via RPC create_order.
     1 chamada → customer (reuso por telefone normalizado) + order + order_items, atômico.
     requestId (idempotency key): mesma key → devolve o pedido já criado (sem duplicar).
     HARDEN-04: timeout defensivo (não congela o checkout) + 1 retry idempotente em falha de rede.
     Retorna o uuid do pedido, ou null em erro/offline (o erro é logado, nunca escondido).
     A RPC responde jsonb {ok, order_id|error, sqlstate, idempotent}. */
  async savePedido(cliente, order, itens, requestId) {
    const call = () => this.run(d=>d.rpc('create_order', {
      p_customer: cliente, p_order: order, p_items: itens, p_request_id: requestId ?? null,
    }));
    const withTimeout = p => Promise.race([p,
      new Promise(res => setTimeout(() => res({ data:null, error:{ message:'timeout' } }), RPC_TIMEOUT))]);
    let r = await withTimeout(call());
    if (r.error && requestId) r = await withTimeout(call());   // 1 retry seguro (mesma idempotency key)
    if (r.error) { console.error('[ENCANTO] create_order erro de rede/timeout:', r.error.message || r.error); return null; }
    const res = r.data;   // {ok, order_id|error, sqlstate, idempotent}
    if (res && res.ok === false) {
      console.error('[ENCANTO] create_order falhou (rollback no banco):', res.error, '['+res.sqlstate+']');
      return null;
    }
    return res?.order_id ?? null;
  },
  async getPedidos() {
    const r = await this.run(d=>d.from('orders')
      .select('*, customers(name,phone), order_items(*)')
      .order('created_at',{ascending:false}).limit(100));
    return r.data ?? [];
  },
  async setStatus(id,status) {
    await this.run(d=>d.from('orders').update({status}).eq('id',id));
  },
  /* HARDEN-06: snapshot de saúde (orders_health) p/ o painel admin. */
  async getHealth() {
    const r = await this.run(d=>d.rpc('orders_health'));
    return r.data ?? null;
  },
  /* HARDEN-06: log genérico em application_logs — reutilizável por qualquer módulo (best-effort, sem PII). */
  async logEvent(module, operation, level, message, payload) {
    try {
      await this.run(d=>d.from('application_logs').insert({
        module, operation, level: level||'info',
        message: String(message||'').slice(0,500), payload: payload||null,
        version: 'harden-06', origin: 'web',
      }));
    } catch (e) { /* nunca quebrar o fluxo por causa de log */ }
  },
  async upsertCat(data,id) {
    if (id) await this.run(d=>d.from('categories').update(data).eq('id',id));
    else    await this.run(d=>d.from('categories').insert({...data,ativo:true}));
  },
  async delCat(id)  { await this.run(d=>d.from('categories').delete().eq('id',id)); },
  /* ── CORREÇÃO CRÍTICA DE IMAGEM ──────────────────────────────
     Regras:
     1. NUNCA salvar base64 — rejeitar se começar com 'data:'
     2. Se image_url for string vazia ou undefined ao EDITAR → remover do payload
        para NÃO sobrescrever a imagem existente no banco
     3. Aceitar null explicitamente (admin quis remover a imagem)
     4. Ao CRIAR: salvar null se não houver URL válida
  ────────────────────────────────────────────────────────────── */
  _sanitizeImageUrl(url) {
    if (!url)                          return null; // null ou undefined → null
    if (typeof url !== 'string')       return null;
    if (url.trim() === '')             return null; // string vazia → null
    if (url.startsWith('data:'))       return null; // base64 NUNCA salvar
    if (!url.startsWith('http'))       return null; // URL inválida → null
    return url.trim();
  },
  async upsertProd(data, id) {
    // Clonar para não mutar o objeto original
    const payload = { ...data };

    if (id) {
      // EDIÇÃO: só incluir image_url no UPDATE se foi explicitamente fornecida
      // Isso evita sobrescrever a imagem existente ao salvar outros campos
      if ('imagem_url' in payload) {
        const sanitized = this._sanitizeImageUrl(payload.imagem_url);
        if (sanitized === null && payload.imagem_url !== null) {
          // URL inválida (vazia, base64, etc.) → remover do payload para preservar existente
          delete payload.imagem_url;
        } else {
          payload.imagem_url = sanitized; // null explícito ou URL válida
        }
      }
      await this.run(d => d.from('products').update(payload).eq('id', id), { throwOnError: true });
    } else {
      // CRIAÇÃO: sanitizar sempre
      payload.imagem_url = this._sanitizeImageUrl(payload.imagem_url);
      await this.run(d => d.from('products').insert(payload), { throwOnError: true });
    }
    this._invalidateProductsCache();
  },
  async toggleProd(id,disponivel) { await this.run(d=>d.from('products').update({disponivel}).eq('id',id)); this._invalidateProductsCache(); },
  async delProd(id) { await this.run(d=>d.from('products').delete().eq('id',id)); this._invalidateProductsCache(); },
  async upsertAd(data,id) {
    if (id) await this.run(d=>d.from('adicionais').update(data).eq('id',id));
    else    await this.run(d=>d.from('adicionais').insert({...data,ativo:true}));
  },
  async delAd(id)   { await this.run(d=>d.from('adicionais').delete().eq('id',id)); },
};

/* ── Hooks ───────────────────────────────────────────────────── */
function useCategories() {
  const [cats,    setCats]    = useState([]);
  const [src,     setSrc]     = useState('mock');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const data = await DS.getCats();
    if (data !== null) {
      /* Banco respondeu (data pode ser [] ou [...]): usar dados do Supabase.
         Filtra categorias descontinuadas mesmo que ainda existam no banco. */
      const result = (data.length > 0 ? data : MOCK_CATS).filter(c => !isCategoriaDescontinuada(c));
      setCats(result);
      setSrc(data.length > 0 ? 'supabase' : 'mock');
      if (data.length > 0) {
        console.log(`[Encanto] ✅ ${data.length} categorias carregadas do Supabase`);
      } else {
        console.warn('[Encanto] ⚠️ Tabela categorias vazia — usando fallback local');
      }
    } else {
      /* null = Supabase offline ou erro de rede */
      console.warn('[Encanto] ⚠️ Supabase offline — categorias usando fallback local');
      setCats(MOCK_CATS.filter(c => !isCategoriaDescontinuada(c)));
      setSrc('mock');
    }
    setLoading(false);
  },[]);
  useEffect(()=>{ load(); },[load]);
  return { cats, loading, src, refresh:load };
}

/* Cache em memória — persiste durante a sessão */
const _prodCache = new Map();

function filterMock(catId, search) {
  let m = [...MOCK_PRODS];
  if (catId)  m = m.filter(p => prodInCat(p, catId));
  if (search) m = m.filter(p => p.nome.toLowerCase().includes((search||'').toLowerCase()));
  return m;
}

/* ── prodInCat ────────────────────────────────────────────────────────────────
   Verifica se um produto pertence a uma categoria.
   Suporta dois formatos (retrocompatível):
     - LEGADO:   { categoria_id: 'c1' }
     - NOVO:     { categoria_id: 'c1', categoria_ids: ['c1','c8'] }
   Um produto com categoria_ids pertence a TODAS as categorias listadas.
   Um produto sem categoria_ids é tratado como { categoria_ids: [categoria_id] }.
──────────────────────────────────────────────────────────────────────────── */
function prodInCat(prod, catId) {
  if (!catId) return true;
  if (Array.isArray(prod.categoria_ids) && prod.categoria_ids.length>0) {
    return prod.categoria_ids.includes(catId);
  }
  return prod.categoria_id === catId;
}

/* ── getProdCatIds ─────────────────────────────────────────────────────────
   Retorna o array de todas as categorias de um produto.
──────────────────────────────────────────────────────────────────────────── */
function getProdCatIds(prod) {
  if (Array.isArray(prod.categoria_ids) && prod.categoria_ids.length>0) {
    return prod.categoria_ids;
  }
  return [prod.categoria_id].filter(Boolean);
}

/* ids de produtos do banco são uuid; ids de mock ('pmc1','pb1') não são.
   order_items.product_id é uuid → enviar só quando for uuid, senão null. */
const isUuid = v => typeof v==='string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/* Idempotency key (estilo Stripe): UUID estável por tentativa de checkout, enviado à RPC
   create_order. Retries/duplo-clique reusam a MESMA key → o banco devolve o pedido existente. */
const newRequestId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0, v = c==='x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
};

function useProducts(catId, search) {
  const cacheKey = `${catId||'*'}::${search||''}`;

  /* Iniciar com dados do cache (Supabase) ou mock enquanto busca */
  const [prods,   setProds]   = useState(()=> _prodCache.get(cacheKey) || []);
  const [loading, setLoading] = useState(!_prodCache.has(cacheKey));
  const [src,     setSrc]     = useState(_prodCache.has(cacheKey) ? 'cache' : 'mock');

  useEffect(()=>{
    const key = `${catId||'*'}::${search||''}`;

    /* Cache hit: usar imediatamente */
    if (_prodCache.has(key)) {
      setProds(_prodCache.get(key));
      setSrc('cache');
      setLoading(false);
      return;
    }

    /* Sem cache: NÃO exibir mock como placeholder — manter vazio + loading
       até o Supabase responder (evita o flash de produtos do MOCK no refresh). */
    setSrc('mock');

    let live = true;
    DS.getProds(catId, search).then(data => {
      if (!live) return;
      if (data !== null) {
        /* data = [] ou [...] — banco respondeu com sucesso */
        _prodCache.set(key, data);
        setProds(data);
        setSrc('supabase');
        if (!catId && !search) {
          console.log(`[Encanto] ✅ ${data.length} products carregados do Supabase`);
          if (data[0]) console.log('[Encanto] Amostra:', data[0].nome, '| imagem_url:', data[0].imagem_url || '(sem imagem)');
        }
      } else {
        /* null = offline/erro — usar fallback local (mock) */
        setProds(filterMock(catId, search));
        console.warn('[Encanto] ⚠️ Supabase offline — products usando fallback local');
        DS.logEvent('catalog','getProds','warn','Supabase offline — fallback local de products', { catId: catId||null, has_search: !!search });
      }
      setLoading(false);
    });
    return () => { live = false; };
  }, [catId, search]);

  return { prods, loading, src };
}

function useAdicionais() {
  const [ads, setAds] = useState([]);
  useEffect(()=>{
    // online → adicionais reais; null (offline/erro/sem dados) → fallback MOCK_ADS
    DS.getAds().then(d=>{ setAds(d ?? MOCK_ADS); });
  },[]);
  return ads;
}

function useOrders() {
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async()=>{
    setLoading(true);
    const data = await DS.getPedidos();
    setOrders(data);
    setLoading(false);
  },[]);
  useEffect(()=>{ load(); },[load]);
  return { orders, loading, refresh:load };
}

function useCart() {
  /* HARDEN-07: carrinho persistente em localStorage (sobrevive a refresh → destrava idempotência durável).
     Wrapper {v,ts,items}: TTL 12h (evita preço/estado obsoleto), versão (descarta shape antigo) e
     sanitização (filtra itens válidos, coage qty) — defensivo contra storage adulterado/legado. */
  const [items, setItems] = useState(()=>{
    try {
      const raw = JSON.parse(localStorage.getItem('encanto_cart')||'null');
      if (!raw || raw.v!==1 || !Array.isArray(raw.items)) return [];
      if (Date.now() - (raw.ts||0) > 12*60*60*1000) return [];
      return raw.items.filter(i=>i&&typeof i==='object'&&i._key&&Number(i.qty)>=1).map(i=>({...i, qty:Number(i.qty)}));
    } catch (e) { return []; }
  });
  useEffect(()=>{ try { localStorage.setItem('encanto_cart', JSON.stringify({v:1, ts:Date.now(), items})); } catch (e) {} }, [items]);
  const count = items.reduce((a,i)=>a+i.qty, 0);
  const total = totalCarrinho(items);
  const add = (prod, qty, adicionais, obs)=>{
    console.log('[ENCANTO] cart.add chamado. prod.id=', prod?.id, 'tipo:', typeof prod?.id, 'qty=', qty);
    setItems(prev=>{
      const key = prod.id + JSON.stringify((adicionais||[]).map(a=>a.id).sort()) + '::' + (obs||'').slice(0,80);
      const idx = prev.findIndex(i=>i._key===key);
      if (idx>=0) { const n=[...prev]; n[idx]={...n[idx],qty:n[idx].qty+qty}; return n; }
      const novo = [...prev, {...prod, qty, adicionais:adicionais||[], obs:obs||'', _key:key}];
      console.log('[ENCANTO] Carrinho atualizado. Itens:', novo.length, novo);
      return novo;
    });
  };
  const remove    = key => setItems(p=>p.filter(i=>i._key!==key));
  const updateQty = (key,d) => setItems(p=>p.map(i=>i._key===key?{...i,qty:Math.max(1,i.qty+d)}:i));
  const clear     = () => setItems([]);
  return { items, count, total, add, remove, updateQty, clear };
}

/* ── UI Components ───────────────────────────────────────────── */
const Spinner = () => (
  <div className="loading-state">
    <div className="spinner"/>
    <span>Carregando...</span>
  </div>
);

/* Mapa badge → estilo */
const BADGE_MAP = {
  'mais_vendido': {cls:'badge-mais-vendido', txt:'⭐ Mais vendido'},
  'favorito':     {cls:'badge-favorito',     txt:'💜 Favorito'},
  'novo':         {cls:'badge-novo',         txt:'✨ Novo'},
  'promocao':     {cls:'badge-promocao',     txt:'🔥 Promoção'},
};

const ProductCard = React.memo(function ProductCard({ prod, catNome, onOpen }) {
  const promo = emPromocao(prod);
  const badge = prod.badge ? BADGE_MAP[prod.badge] : null;
  const temTamanhos = Array.isArray(prod.tamanhos) && prod.tamanhos.length>0;
  // Valida URL: aceita apenas http/https, nunca base64 ou string vazia
  const hasValidImg = isHttpUrl(prod.imagem_url);
  return (
    <div className="product-card" onClick={()=>{console.log('[ENCANTO] Card clicado:', prod.id, prod.nome); onOpen(prod);}}>
      <div className="product-img">
        {hasValidImg
          ? <img src={prod.imagem_url} alt={prod.nome} loading="lazy"
              style={{opacity:0,transition:'opacity .2s'}}
              onLoad={e=>{ e.target.style.opacity='1'; }}
              onError={e=>{ e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }}/>
          : null}
        {/* Placeholder — visível quando sem imagem ou imagem com erro */}
        <div className="product-img-placeholder" style={{display: hasValidImg ? 'none' : 'flex'}}>
          {catEmoji(catNome||prod.nome)}
        </div>
        {badge && <span className={`product-badge ${badge.cls}`}>{badge.txt}</span>}
        {!badge && promo && <span className="promo-tag">PROMO</span>}
        {!prod.disponivel && <div className="unavail-overlay">Indisponível</div>}
      </div>
      <div className="product-info">
        <div className="product-name">{prod.nome}</div>
        {prod.descricao && <div className="product-desc">{prod.descricao}</div>}
        <div className="product-footer">
          <div className="product-price">
            {temTamanhos ? (
              <>
                <span className="price-from-label">A partir de</span>
                {fmt(precoApartir(prod))}
              </>
            ) : (
              <>
                {promo && <span className="old-price">{fmt(prod.preco)}</span>}
                {fmt(precoVitrine(prod))}
              </>
            )}
          </div>
          <button className="add-btn" onClick={e=>{e.stopPropagation();console.log('[ENCANTO] Botao + clicado:', prod.id, prod.nome); onOpen(prod);}}>+</button>
        </div>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.prod.id         === next.prod.id &&
  prev.prod.disponivel === next.prod.disponivel &&
  prev.prod.imagem_url === next.prod.imagem_url &&
  prev.prod.badge      === next.prod.badge &&
  prev.catNome         === next.catNome
);

function ProductModalInner({ prod, catNome, adicionais, onClose, onAdd, onSuggest }) {
  const [qty,      setQty]      = useState(1);
  const [sel,      setSel]      = useState([]);
  const [obs,      setObs]      = useState('');
  const [variante, setVariante] = useState('');
  const [tamanho,  setTamanho]  = useState(null); /* Produtos com tamanhos: Monte seu Copo, Batidinhas — objeto {label,preco,adicionais_gratis} */
  if (!prod) return null;

  /* ── Grupos de adicionais separados por tipo ── */
  const adsByGrupo  = agruparPorGrupo(adicionais, prod);
  const grupos      = Object.keys(adsByGrupo);
  const temTamanhos = Array.isArray(prod.tamanhos) && prod.tamanhos.length>0;
  const gratis_max  = cotaGratis(prod, tamanho);

  /* Elegível à franquia grátis (simples). Contagem derivada da seleção atual. */
  const allGratis   = adicionais.filter(ehAdicionalGratis);
  const ehGratisAd  = ad => !!allGratis.find(g=>g.id===ad.id);
  const selGratisN  = sel.filter(ehGratisAd).length;
  const gratisSobrando = Math.max(0, gratis_max - selGratisN);

  /* Preço efetivo da seleção pela franquia grátis (engine única em addons.js). */
  const selComPreco = resolverPrecoAdicionais(sel, gratis_max, ehGratisAd);
  const precoEfetivo = ad => selComPreco.find(a=>a.id===ad.id)?.preco;

  const toggle = ad => {
    setSel(p => p.find(a=>a.id===ad.id) ? p.filter(a=>a.id!==ad.id) : [...p, ad]);
  };

  const itemLabel = ad => {
    const ef = precoEfetivo(ad);
    if (ef !== undefined) return ef===0 ? 'Grátis' : `+${fmt(ef)}`;
    if (ehGratisAd(ad) && gratisSobrando>0) return 'Grátis';
    return `+${fmt(Number(ad.preco)||ADICIONAL_SIMPLES_PRECO)}`;
  };

  const adTot = selComPreco.reduce((a,ad)=>a+Number(ad.preco),0);
  const basePreco = temTamanhos ? (precoTamanho(tamanho||prod.tamanhos[0]) || Number(prod.preco)) : Number(prod.preco_promo||prod.preco);
  const unit  = basePreco + adTot;

  /* Upsell de bebida: usa flag do produto ou fallback por nome */
  const showUpsell = prod.upsell_bebida === true ||
    (prod.upsell_bebida === undefined &&
     (catNome||prod.nome).toLowerCase().match(/marmita|açaí|acai|copo|batidinha/));

  /* Rótulos: combo → específico; produto único → genérico "Adicionais" */
  const isCombo = grupos.length > 1;
  const GRUPO_LABEL = {
    marmita: isCombo ? '🍱 Adicionais da Marmita' : 'Adicionais',
    acai:    isCombo ? '🍇 Adicionais do Açaí'    : 'Adicionais',
    bebida:  isCombo ? '🧃 Adicionais da Bebida'  : 'Adicionais',
    simples: '🥄 Adicionais Simples',
    premium: '⭐ Premium',
    frutas_premium: '🍓 Frutas Premium',
    chocolates: '🍫 Chocolates',
  };

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        {prod.imagem_url && prod.imagem_url.startsWith('http')
          ? <img loading="lazy" className="modal-img" src={prod.imagem_url} alt={prod.nome}
              onError={e=>{ e.target.onerror=null; e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }}/>
          : null}
        <div className="modal-img" style={{display: prod.imagem_url && prod.imagem_url.startsWith('http') ? 'none' : 'flex'}}>
          {catEmoji(catNome||prod.nome)}
        </div>
        <div className="modal-body">
          <div className="modal-title">{prod.nome}</div>
          {prod.descricao && <div className="modal-desc">{prod.descricao}</div>}
          <div className="modal-price">{fmt(temTamanhos ? precoTamanho(tamanho||prod.tamanhos[0]) : (prod.preco_promo||prod.preco))}</div>

          {/* Composição fixa (ex.: Batidinhas) — só renderiza se houver dado no produto */}
          {Array.isArray(prod.composicao) && prod.composicao.length > 0 && (
            <div className="modal-section">
              <div className="modal-section-title">🥤 Composição</div>
              <div style={{fontSize:13,color:'var(--gray-600)',lineHeight:1.6}}>
                {prod.composicao.join(' • ')}
              </div>
            </div>
          )}

          {/* ── Seleção de tamanho (obrigatório) — Monte seu Copo, Batidinhas ── */}
          {temTamanhos && (
            <div className="modal-section">
              <div className="modal-section-title">
                📏 Escolha o tamanho
                <span style={{fontSize:11,color:'var(--orange)',marginLeft:8,fontWeight:600}}>Obrigatório</span>
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:4}}>
                {prod.tamanhos.map(t=>(
                  <button key={t.label}
                    onClick={()=>setTamanho(t)}
                    style={{
                      padding:'8px 16px',borderRadius:20,cursor:'pointer',
                      border:`2px solid ${(tamanho?.label||prod.tamanhos[0].label)===t.label?'var(--grape)':'var(--gray-200)'}`,
                      background:(tamanho?.label||prod.tamanhos[0].label)===t.label?'var(--grape-pale)':'var(--white)',
                      color:(tamanho?.label||prod.tamanhos[0].label)===t.label?'var(--grape)':'var(--gray-600)',
                      fontSize:13,fontWeight:700,fontFamily:'var(--font-body)',
                      transition:'all .15s',
                    }}>
                    {t.label} • {fmt(precoTamanho(t))}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Aviso informativo (ex: Marmita Fitness) ── */}
          {prod.aviso && (
            <div style={{
              background:'var(--grape-pale)',border:'1px solid #DDD6FE',
              borderRadius:12,padding:'12px 14px',marginBottom:8,
            }}>
              <p style={{fontSize:13,color:'var(--amarelo)',fontWeight:600,lineHeight:1.6,margin:0}}>
                ℹ️ {prod.aviso}
              </p>
            </div>
          )}

          {/* ── Seleção de variante obrigatória (ex: tipo de suco ou tamanho) ── */}
          {(prod.variantes||[]).length > 0 && (
            <div className="modal-section">
              <div className="modal-section-title">
                {(prod.variantes||[]).some(v=>/\d+\s*ml/i.test(v)) ? '📏 Escolha o tamanho' : '🧃 Escolha o sabor'}
                <span style={{fontSize:11,color:'var(--orange)',marginLeft:8,fontWeight:600}}>Obrigatório</span>
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:4}}>
                {prod.variantes.map(v=>(
                  <button key={v}
                    onClick={()=>setVariante(v)}
                    style={{
                      padding:'8px 16px',borderRadius:20,cursor:'pointer',
                      border:`2px solid ${variante===v?'var(--grape)':'var(--gray-200)'}`,
                      background: variante===v?'var(--grape-pale)':'var(--white)',
                      color: variante===v?'var(--grape)':'var(--gray-600)',
                      fontSize:13,fontWeight:700,fontFamily:'var(--font-body)',
                      transition:'all .15s',
                    }}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Adicionais por grupo (Marmita / Açaí / etc.) ── */}
          {grupos.map(grupo => {
            const adsGrupo   = adsByGrupo[grupo] || [];
            const gratisList = adsGrupo.filter(ehAdicionalGratis);
            const pagosList  = adsGrupo.filter(a=>a.tipo==='pago'&&Number(a.preco)>0);
            if (adsGrupo.length===0) return null;
            return (
              <div key={grupo} className="modal-section">
                {/* Título do grupo + contador global de grátis */}
                <div className="modal-section-title" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>{GRUPO_LABEL[grupo]||grupo}</span>
                  {gratis_max>0 && gratisList.length>0 && (
                    <span style={{fontSize:11,fontWeight:700,
                      color: gratisSobrando>0?'var(--green)':'var(--gray-400)',
                      background: gratisSobrando>0?'var(--green-pale)':'var(--gray-100)',
                      padding:'2px 8px',borderRadius:10}}>
                      {gratisSobrando>0?`${gratisSobrando} grátis restante${gratisSobrando!==1?'s':''}`:'Limite atingido'}
                    </span>
                  )}
                </div>
                {/* Grátis deste grupo */}
                {gratisList.map(ad=>(
                  <div key={ad.id} className="additional-item" onClick={()=>toggle(ad)}>
                    <div className={`additional-check ${sel.find(a=>a.id===ad.id)?'checked':''}`}>
                      {sel.find(a=>a.id===ad.id)&&'✓'}
                    </div>
                    <div className="additional-info">
                      <div className="additional-name">{ad.nome}</div>
                    </div>
                    <span style={{fontSize:12,fontWeight:700,
                      color:precoEfetivo(ad)===0?'var(--green)':'var(--gray-400)'}}>
                      {itemLabel(ad)}
                    </span>
                  </div>
                ))}
                {/* Pagos deste grupo — subdivididos por subgrupo_label quando disponível */}
                {pagosList.length>0 && (() => {
                  /* Agrupar por subgrupo_label preservando a ordem de inserção */
                  const subgrupos = [];
                  const subgrupoMap = {};
                  pagosList.forEach(ad => {
                    const sg = ad.subgrupo_label || '';
                    if (!(sg in subgrupoMap)) { subgrupoMap[sg]=[]; subgrupos.push(sg); }
                    subgrupoMap[sg].push(ad);
                  });
                  return (
                    <>
                      {subgrupos.map(sg => (
                        <React.Fragment key={sg||'_'}>
                          {sg && (
                          <div style={{fontSize:12,fontWeight:800,color:'#DC2626',
                            textTransform:'uppercase',letterSpacing:'.5px',
                            margin:'14px 0 6px',padding:'6px 10px',
                            background:'#FEF2F2',borderRadius:7,
                            border:'1.5px solid #FECACA',
                            display:'flex',alignItems:'center',gap:5}}>
                            <span style={{fontSize:14}}>⚠️</span> {sg}
                          </div>
                          )}
                          {subgrupoMap[sg].map(ad=>(
                            <div key={ad.id} className="additional-item" onClick={()=>toggle(ad)}>
                              <div className={`additional-check ${sel.find(a=>a.id===ad.id)?'checked':''}`}>
                                {sel.find(a=>a.id===ad.id)&&'✓'}
                              </div>
                              <div className="additional-info">
                                <div className="additional-name">{ad.nome}</div>
                                <div className="additional-price">+{fmt(ad.preco||ADICIONAL_SIMPLES_PRECO)}</div>
                              </div>
                            </div>
                          ))}
                        </React.Fragment>
                      ))}
                    </>
                  );
                })()}
              </div>
            );
          })}

          <div className="modal-section">
            <div className="modal-section-title">Observações</div>
            {/* Marmita Fitness: campos detalhados de personalização */}
            {prod.obs_campos && prod.obs_campos.length > 0 ? (
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {prod.obs_campos.map((campo,i)=>(
                  <div key={i}>
                    <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',display:'block',marginBottom:3}}>
                      {campo}
                    </label>
                    <input
                      className="form-input"
                      style={{fontSize:13,padding:'8px 12px'}}
                      placeholder={`Ex: ${campo.toLowerCase()}...`}
                      onChange={e=>{
                        const vals = obs ? JSON.parse(obs) : {};
                        vals[campo] = e.target.value;
                        setObs(JSON.stringify(vals));
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <textarea className="obs-textarea"
                placeholder="Sua observação aqui."
                value={obs} onChange={e=>setObs(e.target.value)}/>
            )}
          </div>
        </div>
        {/* ── ALT 8: Sugestão de bebida se for marmita ou açaí ── */}
        {showUpsell && onSuggest && (
          <div className="upsell-banner" onClick={()=>{onSuggest();onClose();}}>
            <span style={{fontSize:20}}>🧃</span>
            <div className="upsell-text">Adicionar uma bebida ao pedido?</div>
            <span className="upsell-action">Ver bebidas →</span>
          </div>
        )}
        <div className="modal-footer">
          <button className="modal-close" onClick={onClose}>✕</button>
          <div className="qty-control">
            <button className="qty-btn" onClick={()=>setQty(q=>Math.max(1,q-1))}>−</button>
            <span className="qty-value">{qty}</span>
            <button className="qty-btn" onClick={()=>setQty(q=>q+1)}>+</button>
          </div>
          <button className="add-to-cart-btn" onClick={()=>{
              const variantesArr = Array.isArray(prod.variantes) ? prod.variantes : [];
              if (variantesArr.length>0 && !variante) {
                alert(variantesArr.some(v=>/\d+\s*ml/i.test(v))?'Escolha o tamanho antes de continuar!':'Escolha o sabor antes de continuar!'); return;
              }
              const varLabel = variantesArr.some(v=>/\d+\s*ml/i.test(v)) ? 'Tamanho' : 'Sabor';

              let obsCompleto = variante ? `[${varLabel}: ${variante}]${obs?' — '+obs:''}` : obs;
              let prodParaCarrinho = prod;
              if (temTamanhos) {
                const tSel = tamanho || prod.tamanhos[0];
                obsCompleto = `[Tamanho: ${tSel.label}]${obs?' — '+obs:''}`;
                /* Preço do item refletindo o tamanho escolhido */
                prodParaCarrinho = {...prod, preco: precoTamanho(tSel), preco_promo: null};
              }

              console.log('[ENCANTO] Adicionar clicado. prod.id=', prod.id, 'qty=', qty, 'sel=', sel, 'obs=', obsCompleto);
              onAdd(prodParaCarrinho,qty,selComPreco,obsCompleto);
              console.log('[ENCANTO] onAdd executado.');
              onClose();
            }}>
            <span>Adicionar</span>
            <span>{fmt(unit*qty)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}


/* Wrapper com proteção de erro para o modal de produto */
class ProductModalBoundary extends React.Component {
  constructor(p){super(p);this.state={err:null};}
  static getDerivedStateFromError(e){return {err:e};}
  render(){
    if(this.state.err) return (
      <div className="modal-overlay" onClick={this.props.onClose}>
        <div className="modal" style={{padding:32,textAlign:'center',maxWidth:360}}>
          <div style={{fontSize:48,marginBottom:12}}>😕</div>
          <h3 style={{fontFamily:'var(--font-head)',marginBottom:8}}>Erro ao carregar produto</h3>
          <p style={{fontSize:13,color:'var(--gray-500)',marginBottom:20}}>
            Tente novamente ou escolha outro item.
          </p>
          <button className="btn-primary" onClick={()=>{this.setState({err:null});this.props.onClose();}}>
            Fechar
          </button>
        </div>
      </div>
    );
    return this.props.children;
  }
}
function ProductModal(props){
  return (
    <ProductModalBoundary onClose={props.onClose}>
      <ProductModalInner {...props}/>
    </ProductModalBoundary>
  );
}
function CartSidebar({ cart, catMap, onClose, onCheckout }) {
  const { items, total, remove, updateQty } = cart;
  return (
    <>
      <div className="cart-overlay" onClick={onClose}/>
      <div className="cart-sidebar">
        <div className="cart-header">
          <h2>🛒 Seu Pedido</h2>
          <button className="cart-close" onClick={onClose}>✕</button>
        </div>
        {items.length===0 ? (
          <div className="cart-empty">
            <div className="icon">🛒</div>
            <p>Seu carrinho está vazio.<br/>Adicione itens para continuar!</p>
          </div>
        ) : (
          <div className="cart-items">
            {items.map(item=>{
              const unit  = precoUnitario(item);
              const cNome = catMap[item.categoria_id]?.nome||'';
              return (
                <div key={item._key} className="cart-item">
                  <div className="cart-item-img">
                    {isHttpUrl(item.imagem_url)
                      ? <img loading="lazy" src={item.imagem_url} alt={item.nome}
                          style={{width:'100%',height:'100%',objectFit:'cover'}}
                          onError={e=>{ e.target.style.display='none'; }}/>
                      : catEmoji(cNome)}
                  </div>
                  <div className="cart-item-info">
                    <div className="cart-item-name">{item.nome}</div>
                    {item.adicionais?.length>0&&(
                      <div className="cart-item-additionals">{item.adicionais.map(a=>a.nome).join(', ')}</div>
                    )}
                    {item.obs&&<div className="cart-item-additionals" style={{fontStyle:'italic'}}>"{item.obs}"</div>}
                    <div className="cart-item-footer">
                      <span className="cart-item-price">{fmt(unit*item.qty)}</span>
                      <div className="cart-item-qty">
                        <button className="cqty-btn" onClick={()=>updateQty(item._key,-1)}>−</button>
                        <span className="cqty-val">{item.qty}</span>
                        <button className="cqty-btn" onClick={()=>updateQty(item._key,1)}>+</button>
                        <button className="cart-remove" onClick={()=>remove(item._key)}>🗑</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="cart-footer">
          <div className="cart-total-row"><span>Subtotal</span><span>{fmt(total)}</span></div>
          <div className="cart-total-row"><span>Entrega</span>
            <span style={{color:'var(--green)',fontWeight:600}}>A combinar</span>
          </div>
          <div className="cart-total-row grand"><span>Total</span><span>{fmt(total)}</span></div>
          <button className="checkout-btn" disabled={items.length===0}
            onClick={()=>{onClose();onCheckout();}}>
            Finalizar Pedido →
          </button>
        </div>
      </div>
    </>
  );
}

function CheckoutPage({ cart, onBack, onSuccess }) {
  const [form, setForm] = useState({nome:'',telefone:'',endereco:'',pagamento:'dinheiro',troco:'',obs:''});
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);   // trava reentrância (duplo clique / envio simultâneo)
  const requestIdRef  = useRef(null);    // idempotency key (estável por tentativa de checkout)
  const upd = (k,v) => setForm(f=>({...f,[k]:v}));
  const pays = [
    {id:'dinheiro',label:'Dinheiro',icon:'💵'},
    {id:'pix',label:'PIX',icon:'📲'},
    {id:'cartao_debito',label:'Débito',icon:'💳'},
    {id:'cartao_credito',label:'Crédito',icon:'💳'},
  ];
  const submit = async () => {
    if (submittingRef.current || loading) return;   // impede envio simultâneo
    console.log('[ENCANTO] Finalizar Pedido clicado. cart.items=', cart.items, 'total=', cart.total);
    if (!form.nome||!form.telefone||!form.endereco) { alert('Preencha nome, telefone e endereço!'); return; }
    if (cart.items.length === 0) { console.warn('[ENCANTO] Carrinho vazio ao finalizar!'); }
    submittingRef.current = true;
    setLoading(true);
    if (!requestIdRef.current) {   // HARDEN-06: idempotency key durável (cobre retry/remontagem) via localStorage
      requestIdRef.current = localStorage.getItem('encanto_req_id') || newRequestId();
      try { localStorage.setItem('encanto_req_id', requestIdRef.current); } catch (e) {}
    }
    /* preço unitário = base do item (já reflete o tamanho) + adicionais por unidade.
       Σ(price*quantity) reconcilia com orders.total. */
    const puComAdic = precoUnitario;
    await DS.savePedido(
      { name: form.nome, phone: form.telefone },                                  // customers
      { total: cart.total, status: 'recebido', payment_method: form.pagamento,    // orders
        address: form.endereco, observacoes: form.obs || null },
      cart.items.map(i=>{                                                          // order_items (A-fiel)
        const pu = puComAdic(i);
        return {
          product_id:     isUuid(i.id) ? i.id : null,   // ids de mock (offline) não são uuid → null
          nome_produto:   i.nome,
          quantity:       i.qty,
          price:          pu,
          preco_unitario: pu,
          adicionais:     i.adicionais || [],
          observacoes:    i.obs || null,
        };
      }),
      requestIdRef.current                                                        // idempotency key
    );
    /* Incrementar contador de fidelidade (somente após pedido finalizado) */
    if (localStorage.getItem('encanto_loyalty_enabled') !== 'false') {
      const required = parseInt(localStorage.getItem('encanto_loyalty_required')||'10');
      const cur      = parseInt(localStorage.getItem('encanto_loyalty_count')||'0');
      /* Não ultrapassar o limite — cliente deve resgatar antes de acumular mais */
      if (cur < required) {
        const next = cur + 1;
        localStorage.setItem('encanto_loyalty_count', String(next));
        /* Se atingiu o limite, marcar reward_available */
        if (next >= required) {
          localStorage.setItem('encanto_loyalty_reward_available', 'true');
        }
      }
    }
    let msg = `*🛍️ Novo Pedido - Encanto*\n\n`;
    msg += `*Cliente:* ${form.nome}\n*Telefone:* ${form.telefone}\n*Endereço:* ${form.endereco}\n\n*📋 Itens:*\n`;
    cart.items.forEach(i=>{
      msg+=`• ${i.nome} x${i.qty} — ${fmt(precoLinha(i))}\n`;
      if(i.adicionais?.length) msg+=`  ↳ ${i.adicionais.map(a=>a.nome).join(', ')}\n`;
      if(i.obs) msg+=`  ↳ Obs: ${i.obs}\n`;
    });
    msg+=`\n*💰 Total: ${fmt(cart.total)}*\n*Pagamento:* ${form.pagamento}`;
    if(form.troco) msg+=` (troco p/ ${form.troco})`;
    if(form.obs)   msg+=`\n*Obs:* ${form.obs}`;
    setLoading(false);
    submittingRef.current = false;
    requestIdRef.current = null;   // próximo pedido recebe nova idempotency key
    try { localStorage.removeItem('encanto_req_id'); } catch (e) {}
    cart.clear();
    onSuccess(msg);
  };
  return (
    <div className="checkout-page">
      <button onClick={onBack} style={{background:'none',color:'var(--gray-500)',fontSize:14,marginBottom:16,display:'flex',alignItems:'center',gap:6,cursor:'pointer',border:'none'}}>
        ← Voltar ao cardápio
      </button>
      <h2>Finalizar Pedido</h2>
      <div className="order-summary">
        <h3>Resumo</h3>
        {cart.items.map(i=>(
          <div key={i._key} className="summary-item">
            <span>{i.nome} x{i.qty}</span>
            <span>{fmt(precoLinha(i))}</span>
          </div>
        ))}
        <div className="summary-total"><span>Total</span><span>{fmt(cart.total)}</span></div>
      </div>
      <div className="form-group">
        <label className="form-label">Nome completo *</label>
        <input className="form-input" placeholder="Seu nome" value={form.nome} onChange={e=>upd('nome',e.target.value)}/>
      </div>
      <div className="form-group">
        <label className="form-label">WhatsApp *</label>
        <input className="form-input" placeholder="(38) 99999-9999" value={form.telefone} onChange={e=>upd('telefone',e.target.value)}/>
      </div>
      <div className="form-group">
        <label className="form-label">Endereço de entrega *</label>
        <textarea className="form-input obs-textarea" placeholder="Rua, número, bairro..."
          value={form.endereco} onChange={e=>upd('endereco',e.target.value)}/>
      </div>
      <div className="form-group">
        <label className="form-label">Forma de pagamento</label>
        <div className="payment-opts">
          {pays.map(o=>(
            <div key={o.id} className={`payment-opt ${form.pagamento===o.id?'selected':''}`} onClick={()=>upd('pagamento',o.id)}>
              <div className="icon">{o.icon}</div>
              <div className="label">{o.label}</div>
            </div>
          ))}
        </div>
      </div>
      {form.pagamento==='dinheiro'&&(
        <div className="form-group">
          <label className="form-label">Troco para quanto?</label>
          <input className="form-input" placeholder="R$ 50,00" value={form.troco} onChange={e=>upd('troco',e.target.value)}/>
        </div>
      )}
      <div className="form-group">
        <label className="form-label">Observações gerais</label>
        <textarea className="form-input obs-textarea" placeholder="Alguma observação..."
          value={form.obs} onChange={e=>upd('obs',e.target.value)}/>
      </div>
      <button className="confirm-btn" onClick={submit} disabled={loading}>
        {loading ? 'Enviando...' : `Confirmar via WhatsApp • ${fmt(cart.total)}`}
      </button>
    </div>
  );
}

function SuccessPage({ msg, cart, onBack }) {
  const open = () => window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`,'_blank');
  /* Tempo estimado dinâmico */
  const [tempo, setTempo] = useState(()=>30+Math.floor(Math.random()*20));
  const [statusIdx, setStatusIdx] = useState(0);
  const steps = [
    {label:'Recebido',   icon:'📥'},
    {label:'Em preparo', icon:'👨‍🍳'},
    {label:'Pronto',     icon:'✅'},
    {label:'Em entrega', icon:'🛵'},
    {label:'Entregue',   icon:'🏠'},
  ];
  return (
    <div className="success-page" style={{maxWidth:520,padding:'28px 16px 40px'}}>
      <div className="success-icon" style={{fontSize:56}}>🎉</div>
      <h2 style={{marginBottom:6}}>Pedido realizado com sucesso!</h2>
      <p style={{marginBottom:20}}>
        Nossa equipe confirmará em instantes. Envie pelo WhatsApp para agilizar! 💜
      </p>

      {/* Tempo estimado */}
      <div style={{
        background:'var(--grape-pale)',borderRadius:12,padding:'12px 20px',
        marginBottom:20,display:'flex',alignItems:'center',justifyContent:'space-between',
      }}>
        <div>
          <div style={{fontSize:12,color:'var(--amarelo)',fontWeight:600,marginBottom:2}}>
            🕐 Tempo estimado de entrega
          </div>
          <div style={{fontFamily:'var(--font-head)',fontSize:24,fontWeight:800,color:'var(--amarelo)'}}>
            {tempo}–{tempo+10} min
          </div>
        </div>
        <div style={{fontSize:11,color:'var(--gray-500)',textAlign:'right',lineHeight:1.4}}>
          Seg–Dom<br/>11:00 às 22:30
        </div>
      </div>

      {/* Barra de status do pedido */}
      <div className="order-status-bar" style={{marginBottom:20}}>
        <div style={{fontSize:12,fontWeight:700,color:'var(--gray-700)',marginBottom:12}}>
          Acompanhe seu pedido
        </div>
        <div className="order-status-steps">
          {steps.map((s,i)=>(
            <div key={i} className={`order-status-step ${i<statusIdx?'done':i===statusIdx?'active':''}`}>
              <div className="step-dot">{i<statusIdx?'✓':s.icon}</div>
              <div className="step-label">{s.label}</div>
            </div>
          ))}
        </div>
        <p style={{fontSize:11,color:'var(--gray-400)',marginTop:12,textAlign:'center'}}>
          Status atualizado após confirmação pela loja via WhatsApp.
        </p>
      </div>

      <button className="whatsapp-btn" onClick={open} style={{width:'100%',justifyContent:'center',marginBottom:10}}>
        <span style={{fontSize:22}}>💬</span> Enviar pedido pelo WhatsApp
      </button>
      <button className="back-home-btn" onClick={onBack}>← Voltar ao cardápio</button>
    </div>
  );
}

/* ── Admin Components ────────────────────────────────────────── */
function AdminLogin({ onLogin }) {
  const [email,   setEmail]   = useState('as992203620@gmail.com');
  const [pass,    setPass]    = useState('');
  const [err,     setErr]     = useState('');
  const [loading, setLoading] = useState(false);
  const login = async () => {
    if (!pass) { setErr('Digite a senha'); return; }
    if (!db)   { setErr('Supabase indisponível. Recarregue a página.'); return; }
    setLoading(true); setErr('');
    // Login real: só entra com sessão autenticada do Supabase. Sem bypass.
    const { data, error } = await db.auth.signInWithPassword({ email, password: pass });
    if (error) {
      setErr(error.message || 'Falha no login.');
      setLoading(false);
      return;
    }
    if (!data?.session?.access_token) {
      // Salvaguarda: sem sessão ativa, não libera o painel.
      setErr('Login sem sessão ativa. Tente novamente.');
      setLoading(false);
      return;
    }
    onLogin({ email, session: data.session });
    setLoading(false);
  };
  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <div style={{fontSize:42,textAlign:'center',marginBottom:8}}>🔐</div>
        <h2>Encanto Admin</h2>
        <p>Painel administrativo da loja</p>
        <div className="form-group">
          <label className="form-label">E-mail</label>
          <input className="form-input" value={email} onChange={e=>setEmail(e.target.value)}/>
        </div>
        <div className="form-group">
          <label className="form-label">Senha</label>
          <input className="form-input" type="password" placeholder="Sua senha"
            value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()}/>
        </div>
        {err&&<p style={{color:'var(--red)',fontSize:13,marginBottom:8}}>{err}</p>}
        <button className="login-btn" onClick={login} disabled={loading}>
          {loading?'Entrando...':'Entrar'}
        </button>
        <p style={{fontSize:12,color:'var(--gray-400)',marginTop:14,textAlign:'center'}}>Acesso restrito ao administrador</p>
      </div>
    </div>
  );
}

function AdminCategorias() {
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({nome:'',icone:'🍽️',cor:'#6B21A8',ordem:0});
  const load = async()=>{ setLoading(true); const d=await DS.getAllCats(); setCats(d??MOCK_CATS); setLoading(false); };
  useEffect(()=>{load();},[]);
  const save = async()=>{
    if(!form.nome) return;
    await DS.upsertCat({nome:form.nome,icone:form.icone,cor:form.cor,ordem:+form.ordem},modal==='new'?null:modal.id);
    setModal(null); load();
  };
  return (
    <div>
      <div className="admin-card">
        <div className="admin-card-header">
          <h3>Categorias ({cats.length})</h3>
          <button className="btn-primary" onClick={()=>{setForm({nome:'',icone:'🍽️',cor:'#6B21A8',ordem:0});setModal('new');}}>+ Nova</button>
        </div>
        {loading?<Spinner/>:(
          <table className="data-table">
            <thead><tr><th>Ícone</th><th>Nome</th><th>Ordem</th><th>Ações</th></tr></thead>
            <tbody>{cats.map(c=>(
              <tr key={c.id}>
                <td style={{fontSize:24}}>{c.icone||'🍽️'}</td>
                <td><b>{c.nome}</b></td>
                <td>{c.ordem}</td>
                <td style={{display:'flex',gap:8}}>
                  <button className="btn-sm" onClick={()=>{setForm({nome:c.nome,icone:c.icone||'🍽️',cor:c.cor||'#6B21A8',ordem:c.ordem||0});setModal(c);}}>✏️ Editar</button>
                  <button className="btn-danger" onClick={async()=>{ if(window.confirm('Excluir?')){await DS.delCat(c.id);load();} }}>🗑</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {modal&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="modal-form">
            <h3 style={{fontFamily:'var(--font-head)',fontSize:18,fontWeight:700,marginBottom:20}}>{modal==='new'?'Nova Categoria':'Editar Categoria'}</h3>
            <div className="form-group"><label className="form-label">Nome</label>
              <input className="form-input" value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))}/>
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Ícone (emoji)</label>
                <input className="form-input" value={form.icone} onChange={e=>setForm(f=>({...f,icone:e.target.value}))}/>
              </div>
              <div className="form-group"><label className="form-label">Ordem</label>
                <input className="form-input" type="number" value={form.ordem} onChange={e=>setForm(f=>({...f,ordem:+e.target.value}))}/>
              </div>
            </div>
            <div style={{display:'flex',gap:10,marginTop:8}}>
              <button className="btn-secondary" onClick={()=>setModal(null)}>Cancelar</button>
              <button className="btn-primary" onClick={save}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ImageUploader inline component ─────────────────────────────
   Upload de imagem com Supabase Storage.
   REGRAS:
   - Nunca armazena base64
   - Preserva imagem existente se nenhum novo arquivo for selecionado
   - Fallback visual se image_url for null/inválida
────────────────────────────────────────────────────────────────── */
function ImageUploader({ currentUrl, onUpload }) {
  const [preview,   setPreview]   = useState(currentUrl || null);
  const [uploading, setUploading] = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [uploadErr, setUploadErr] = useState('');
  const inputRef = useRef ? useRef(null) : React.useRef(null);

  useEffect(()=>{ setPreview(currentUrl||null); setUploadErr(''); }, [currentUrl]);

  const isValidUrl = isHttpUrl;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Validações client-side
    if (file.size > 5*1024*1024) { setUploadErr('Imagem muito grande. Máx. 5 MB.'); return; }
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) {
      setUploadErr('Formato inválido. Use JPEG, PNG, WebP ou GIF.'); return;
    }
    setUploadErr(''); setUploading(true); setProgress(20);
    // Preview local temporário (só visual — nunca persiste como base64)
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl); setProgress(40);
    try {
      let publicUrl = null;
      if (db) {
        setProgress(55);
        const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
        const name = `products/product_${Date.now()}_${Math.random().toString(36).slice(2,7)}.${ext}`;
        const { error: upErr } = await db.storage.from('products').upload(name, file, {
          cacheControl:'3600', upsert:false, contentType:file.type,
        });
        if (upErr) { DS.logEvent('upload','image','error', upErr.message, { ext }); throw new Error(upErr.message); }
        setProgress(80);
        const { data: urlData } = db.storage.from('products').getPublicUrl(name);
        publicUrl = urlData?.publicUrl || null;
        if (!publicUrl) throw new Error('Não foi possível obter URL pública.');
      } else {
        // Offline: usar URL do objeto local como fallback temporário
        // (não persiste no banco — apenas visual no preview)
        console.warn('[ImageUploader] Supabase offline — imagem não será persistida');
        publicUrl = null;
        setUploadErr('Supabase offline — URL não salva. Insira URL manualmente.');
      }
      setProgress(100);
      URL.revokeObjectURL(localUrl);
      if (publicUrl) {
        setPreview(publicUrl);
        onUpload?.(publicUrl);
      } else {
        setPreview(currentUrl||null); // reverter para imagem existente
      }
    } catch(err) {
      console.error('[ImageUploader]', err);
      setUploadErr(err.message || 'Erro no upload.');
      URL.revokeObjectURL(localUrl);
      setPreview(currentUrl||null); // reverter para imagem anterior em caso de erro
    } finally {
      setUploading(false); setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleUrlChange = (e) => {
    const url = e.target.value.trim();
    if (isValidUrl(url)) { setPreview(url); onUpload?.(url); }
    else if (url === '') { setPreview(null); onUpload?.(null); }
  };

  return (
    <div>
      {/* Preview */}
      <div style={{
        position:'relative', width:'100%', height:150, borderRadius:12,
        border:'2px dashed var(--gray-200)', background:'var(--gray-50)',
        overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center',
        marginBottom:10,
      }}>
        {preview && isValidUrl(preview) ? (
          <>
            <img src={preview} alt="Preview" style={{width:'100%',height:'100%',objectFit:'cover'}}
              onError={()=>setPreview(null)}/>
            {!uploading && (
              <button onClick={()=>{setPreview(null);onUpload?.(null);}}
                style={{position:'absolute',top:6,right:6,width:24,height:24,borderRadius:6,
                  background:'rgba(220,38,38,.9)',color:'#fff',border:'none',cursor:'pointer',
                  fontSize:12,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'var(--font-body)'}}>
                ✕
              </button>
            )}
          </>
        ) : (
          <div style={{textAlign:'center',color:'var(--gray-400)'}}>
            <div style={{fontSize:32,marginBottom:4}}>🖼️</div>
            <div style={{fontSize:11}}>Sem imagem</div>
          </div>
        )}
        {uploading && (
          <div style={{position:'absolute',bottom:0,left:0,right:0,height:3,background:'var(--gray-200)'}}>
            <div style={{height:'100%',background:'var(--grape)',width:`${progress}%`,transition:'width .3s'}}/>
          </div>
        )}
      </div>

      {/* Botão upload */}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
        style={{display:'none'}} onChange={handleFile} disabled={uploading}/>
      <button type="button" className="btn-secondary"
        style={{width:'100%',fontSize:13,marginBottom:8}}
        disabled={uploading} onClick={()=>inputRef.current?.click()}>
        {uploading ? `Enviando... ${progress}%` : '📁 Enviar imagem'}
      </button>

      {/* Input URL manual */}
      <label style={{fontSize:11,color:'var(--gray-500)',display:'block',marginBottom:4}}>
        Ou cole uma URL de imagem:
      </label>
      <input className="form-input" style={{fontSize:13,padding:'8px 12px'}}
        placeholder="https://..." defaultValue={currentUrl||''}
        onChange={handleUrlChange} disabled={uploading}/>

      {uploadErr && (
        <div style={{marginTop:6,padding:'7px 10px',borderRadius:8,background:'var(--red-pale)',
          border:'1px solid #FECACA',fontSize:12,color:'var(--red)',fontWeight:600}}>
          ⚠️ {uploadErr}
        </div>
      )}
      <div style={{fontSize:10,color:'var(--gray-400)',marginTop:4}}>
        JPEG · PNG · WebP · GIF — Máx. 5 MB
      </div>
    </div>
  );
}

/* ── AdminProducts — com correção completa de imagens ─────────── */
function AdminProducts() {
  const [prods, setProds] = useState([]);
  const [cats,  setCats]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saveErr,  setSaveErr]  = useState('');
  const [modal,    setModal]    = useState(null);

  // Estado do formulário — image_url usa sentinel KEEP para preservar imagem existente
  const KEEP = '__KEEP__'; // sentinel: não alterar image_url no banco
  const ef = {nome:'',descricao:'',preco:'',preco_promo:'',categoria_id:'',
    imagem_url: KEEP, // ao criar, começar vazio
    disponivel:true,destaque:false,adicionais_gratis:0,badge:''};
  const [form, setForm] = useState(ef);

  const load = async () => {
    setLoading(true);
    try {
      const [p,c] = await Promise.all([DS.getAllProds(), DS.getAllCats()]);
      setProds(p ?? MOCK_PRODS);
      setCats(c ?? MOCK_CATS);
    } catch(e) {
      console.error('[AdminProducts] load error:', e);
      setProds(MOCK_PRODS); setCats(MOCK_CATS);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  /* Abrir modal de edição — carrega a imagem existente no form */
  const openEdit = (p) => {
    setForm({
      nome:             p.nome,
      descricao:        p.descricao || '',
      preco:            p.preco,
      preco_promo:      p.preco_promo || '',
      categoria_id:     p.categoria_id || '',
      // CRÍTICO: carregar imagem existente — será preservada se não enviar nova
      imagem_url:       p.imagem_url || KEEP,
      disponivel:       p.disponivel,
      destaque:         p.destaque || false,
      adicionais_gratis: p.adicionais_gratis || 0,
      badge:            p.badge || '',
    });
    setSaveErr('');
    setModal(p);
  };

  /* Abrir modal de criação */
  const openNew = () => {
    setForm({ ...ef, imagem_url: '', categoria_id: cats[0]?.id || '' });
    setSaveErr('');
    setModal('new');
  };

  /* Callback do ImageUploader — atualiza imagem no form */
  const handleImageUploaded = (url) => {
    // url pode ser null (remoção) ou string válida (nova imagem)
    setForm(f => ({ ...f, imagem_url: url || null }));
  };

  const save = async () => {
    if (!form.nome || !form.preco) { setSaveErr('Nome e preço são obrigatórios.'); return; }
    setSaving(true); setSaveErr('');
    try {
      const isNew = modal === 'new';
      const id    = isNew ? null : modal.id;

      const data = {
        nome:             form.nome,
        descricao:        form.descricao || null,
        preco:            +form.preco,
        preco_promo:      form.preco_promo ? +form.preco_promo : null,
        categoria_id:     form.categoria_id || null,
        disponivel:       form.disponivel,
        destaque:         form.destaque,
        adicionais_gratis: +form.adicionais_gratis || 0,
        badge:            form.badge || null,
      };

      // REGRA CRÍTICA DE IMAGEM:
      // - KEEP sentinel → não incluir image_url no payload (preserva existente no banco)
      // - null explícito → salvar null (admin quis remover)
      // - URL válida → salvar nova URL
      if (form.imagem_url !== KEEP) {
        data.imagem_url = form.imagem_url; // DS.upsertProd vai sanitizar
      }
      // Se KEEP: não adiciona image_url ao payload → banco mantém valor atual

      await DS.upsertProd(data, id);
      setModal(null);
      await load();
    } catch(err) {
      console.error('[AdminProducts] save error:', err);
      setSaveErr(err.message || 'Erro ao salvar produto.');
    } finally {
      setSaving(false);
    }
  };

  /* Determina a URL atual da imagem para o ImageUploader */
  const currentImageUrl = (() => {
    if (form.imagem_url === KEEP) {
      // Em modo edição: buscar imagem atual do produto
      if (modal && modal !== 'new') return modal.imagem_url || null;
      return null;
    }
    return form.imagem_url || null;
  })();

  return (
    <div>
      <div className="admin-card">
        <div className="admin-card-header">
          <h3>Products ({prods.length})</h3>
          <button className="btn-primary" onClick={openNew}>+ Novo</button>
        </div>
        {loading ? <Spinner/> : (
          <div style={{overflowX:'auto'}}>
            <table className="data-table">
              <thead><tr>
                <th>Imagem</th><th>Produto</th><th>Categoria</th>
                <th>Preço</th><th>Disp.</th><th>Ações</th>
              </tr></thead>
              <tbody>{prods.map(p => (
                <tr key={p.id}>
                  <td>
                    {/* Miniatura da imagem com fallback */}
                    <div style={{
                      width:44,height:44,borderRadius:8,overflow:'hidden',
                      background:'var(--gray-100)',display:'flex',
                      alignItems:'center',justifyContent:'center',flexShrink:0,
                    }}>
                      {p.imagem_url && p.imagem_url.startsWith('http') ? (
                        <img src={p.imagem_url} alt={p.nome}
                          style={{width:'100%',height:'100%',objectFit:'cover'}}
                          onError={e=>{ e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }}/>
                      ) : null}
                      <span style={{fontSize:20,display: p.imagem_url ? 'none' : 'flex'}}>
                        {p.imagem_url ? '⚠️' : '🍽️'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div style={{fontWeight:700}}>{p.nome}</div>
                    <div style={{fontSize:11,color:'var(--gray-500)'}}>{p.descricao?.slice(0,38)}</div>
                    {(!p.imagem_url || p.imagem_url.startsWith('data:')) && (
                      <div style={{fontSize:10,color:'#DC2626',fontWeight:600,marginTop:2}}>
                        ⚠️ Sem imagem
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-purple">
                      {p.categorias?.nome || cats.find(c=>c.id===p.categoria_id)?.nome || '-'}
                    </span>
                  </td>
                  <td>
                    <div style={{fontWeight:700,color:'var(--amarelo)'}}>{fmt(precoVitrine(p))}</div>
                    {p.preco_promo && (
                      <div style={{fontSize:11,color:'var(--gray-400)',textDecoration:'line-through'}}>{fmt(p.preco)}</div>
                    )}
                  </td>
                  <td>
                    <label className="toggle-switch">
                      <input type="checkbox" checked={!!p.disponivel}
                        onChange={async()=>{ await DS.toggleProd(p.id,!p.disponivel); load(); }}/>
                      <span className="toggle-slider"/>
                    </label>
                  </td>
                  <td style={{display:'flex',gap:8}}>
                    <button className="btn-sm" onClick={()=>openEdit(p)}>✏️</button>
                    <button className="btn-danger" onClick={async()=>{
                      if(window.confirm('Excluir produto?')) { await DS.delProd(p.id); load(); }
                    }}>🗑</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="modal-form" style={{maxHeight:'90vh',overflowY:'auto'}}>
            <h3 style={{fontFamily:'var(--font-head)',fontSize:18,fontWeight:700,marginBottom:20}}>
              {modal==='new' ? '+ Novo Produto' : '✏️ Editar Produto'}
            </h3>

            <div className="form-group">
              <label className="form-label">Nome *</label>
              <input className="form-input" value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))}/>
            </div>

            <div className="form-group">
              <label className="form-label">Descrição</label>
              <textarea className="form-input obs-textarea" value={form.descricao}
                onChange={e=>setForm(f=>({...f,descricao:e.target.value}))}/>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Preço (R$) *</label>
                <input className="form-input" type="number" step="0.01" value={form.preco}
                  onChange={e=>setForm(f=>({...f,preco:e.target.value}))}/>
              </div>
              <div className="form-group">
                <label className="form-label">Preço Promo</label>
                <input className="form-input" type="number" step="0.01" value={form.preco_promo}
                  onChange={e=>setForm(f=>({...f,preco_promo:e.target.value}))}/>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Categoria</label>
              <select className="form-select" value={form.categoria_id}
                onChange={e=>setForm(f=>({...f,categoria_id:e.target.value}))}>
                <option value="">Selecione...</option>
                {cats.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Badge de destaque</label>
              <select className="form-select" value={form.badge}
                onChange={e=>setForm(f=>({...f,badge:e.target.value}))}>
                <option value="">Sem badge</option>
                <option value="mais_vendido">⭐ Mais vendido</option>
                <option value="favorito">💜 Favorito dos clientes</option>
                <option value="novo">✨ Novo</option>
                <option value="promocao">🔥 Promoção</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Adicionais grátis (qtd)</label>
              <input className="form-input" type="number" min="0" max="10" placeholder="0"
                value={form.adicionais_gratis}
                onChange={e=>setForm(f=>({...f,adicionais_gratis:+e.target.value}))}/>
            </div>

            {/* ── IMAGEM — componente corrigido ─────────────────── */}
            <div className="form-group">
              <label className="form-label">
                Imagem do produto
                {modal !== 'new' && (
                  <span style={{fontSize:10,color:'var(--gray-400)',fontWeight:400,marginLeft:6}}>
                    (deixe em branco para manter a atual)
                  </span>
                )}
              </label>
              <ImageUploader
                currentUrl={currentImageUrl}
                onUpload={handleImageUploaded}
              />
            </div>

            <div style={{display:'flex',gap:20,marginBottom:16,alignItems:'center'}}>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:14,cursor:'pointer'}}>
                <label className="toggle-switch">
                  <input type="checkbox" checked={form.disponivel}
                    onChange={e=>setForm(f=>({...f,disponivel:e.target.checked}))}/>
                  <span className="toggle-slider"/>
                </label>
                Disponível
              </label>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:14,cursor:'pointer'}}>
                <label className="toggle-switch">
                  <input type="checkbox" checked={form.destaque}
                    onChange={e=>setForm(f=>({...f,destaque:e.target.checked}))}/>
                  <span className="toggle-slider"/>
                </label>
                Destaque
              </label>
            </div>

            {saveErr && (
              <div style={{padding:'10px 12px',borderRadius:8,background:'var(--red-pale)',
                border:'1px solid #FECACA',fontSize:13,color:'var(--red)',
                fontWeight:600,marginBottom:12}}>
                ⚠️ {saveErr}
              </div>
            )}

            <div style={{display:'flex',gap:10}}>
              <button className="btn-secondary" disabled={saving} onClick={()=>setModal(null)}>
                Cancelar
              </button>
              <button className="btn-primary" disabled={saving} onClick={save}>
                {saving ? 'Salvando...' : 'Salvar produto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminAdicionais() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({nome:'',preco:''});
  const load = async()=>{ setLoading(true); const d=await DS.getAllAds(); setItems(d??MOCK_ADS); setLoading(false); };
  useEffect(()=>{load();},[]);
  const save = async()=>{
    if(!form.nome) return;
    await DS.upsertAd({nome:form.nome,preco:+form.preco||0},modal==='new'?null:modal.id);
    setModal(null); load();
  };
  return (
    <div>
      <div className="admin-card">
        <div className="admin-card-header">
          <h3>Adicionais ({items.length})</h3>
          <button className="btn-primary" onClick={()=>{setForm({nome:'',preco:''});setModal('new');}}>+ Novo</button>
        </div>
        {loading?<Spinner/>:(
          <table className="data-table">
            <thead><tr><th>Nome</th><th>Grupo</th><th>Tipo</th><th>Preço</th><th>Ações</th></tr></thead>
            <tbody>{items.map(it=>(
              <tr key={it.id}>
                <td style={{fontWeight:600}}>{it.nome}</td>
                <td><span className="badge badge-purple" style={{fontSize:10}}>
                  {it.grupo==='marmita'?'🍱 Marmita':it.grupo==='bebida'?'🧃 Bebida':'🍇 Açaí'}</span></td>
                <td><span className={`badge ${it.tipo==='pago'?'badge-orange':'badge-green'}`}>
                  {it.tipo==='pago'?'Pago':'Grátis'}</span></td>
                <td>{it.tipo==='pago'?fmt(it.preco):'—'}</td>
                <td style={{display:'flex',gap:8}}>
                  <button className="btn-sm" onClick={()=>{setForm({nome:it.nome,preco:it.preco,tipo:it.tipo||'gratis',grupo:it.grupo||'acai'});setModal(it);}}>✏️</button>
                  <button className="btn-danger" onClick={async()=>{if(window.confirm('Excluir?')){await DS.delAd(it.id);load();}}}>🗑</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {modal&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
          <div className="modal-form">
            <h3 style={{fontFamily:'var(--font-head)',fontSize:18,fontWeight:700,marginBottom:20}}>{modal==='new'?'Novo Adicional':'Editar Adicional'}</h3>
            <div className="form-group"><label className="form-label">Nome</label>
              <input className="form-input" value={form.nome} onChange={e=>setForm(f=>({...f,nome:e.target.value}))}/>
            </div>
            <div className="form-group"><label className="form-label">Tipo</label>
              <select className="form-select" value={form.tipo} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))}>
                <option value="gratis">Grátis (incluso no produto)</option>
                <option value="pago">Pago (cobrado à parte)</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Grupo (categoria)</label>
              <select className="form-select" value={form.grupo||'acai'} onChange={e=>setForm(f=>({...f,grupo:e.target.value}))}>
                <option value="acai">🍇 Adicionais Açaí</option>
                <option value="marmita">🍱 Adicionais Marmita</option>
                <option value="bebida">🧃 Adicionais Bebida</option>
              </select>
            </div>
            {form.tipo==='pago' && (
              <div className="form-group"><label className="form-label">Preço (R$)</label>
                <input className="form-input" type="number" step="0.01" value={form.preco} onChange={e=>setForm(f=>({...f,preco:e.target.value}))}/>
              </div>
            )}
            <div style={{display:'flex',gap:10,marginTop:8}}>
              <button className="btn-secondary" onClick={()=>setModal(null)}>Cancelar</button>
              <button className="btn-primary" onClick={save}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminPedidos() {
  const { orders, loading, refresh } = useOrders();
  const SM = {
    recebido: {label:'Recebido',cls:'status-recebido'},
    preparo:  {label:'Em Preparo',cls:'status-preparo'},
    entrega:  {label:'Saiu p/ Entrega',cls:'status-entrega'},
    entregue: {label:'Entregue',cls:'status-entregue'},
    cancelado:{label:'Cancelado',cls:'status-cancelado'},
  };
  return (
    <div>
      <div className="stat-cards">
        {Object.entries(SM).map(([k,v])=>(
          <div key={k} className="stat-card">
            <div className="stat-val">{orders.filter(o=>o.status===k).length}</div>
            <div className="stat-label">{v.label}</div>
          </div>
        ))}
      </div>
      <div className="admin-card">
        <div className="admin-card-header">
          <h3>Pedidos ({orders.length})</h3>
          <button className="btn-secondary" onClick={refresh}>🔄 Atualizar</button>
        </div>
        {loading?<Spinner/>:orders.length===0?(
          <div className="empty-state"><div className="icon">📋</div><p>Nenhum pedido ainda</p></div>
        ):(
          <div style={{overflowX:'auto'}}>
            <table className="data-table">
              <thead><tr><th>#</th><th>Cliente</th><th>Total</th><th>Status</th><th>Horário</th><th>Alterar</th></tr></thead>
              <tbody>{orders.map((o,i)=>(
                <tr key={o.id}>
                  <td style={{fontWeight:700,color:'var(--amarelo)'}}>#{orders.length-i}</td>
                  <td>
                    <div style={{fontWeight:700}}>{o.customers?.name || '—'}</div>
                    <div style={{fontSize:12,color:'var(--gray-500)'}}>{o.customers?.phone || ''}</div>
                    <div style={{fontSize:12,color:'var(--gray-500)'}}>{(o.address||'').slice(0,35)}</div>
                  </td>
                  <td style={{fontWeight:700}}>{fmt(o.total)}</td>
                  <td><span className={`badge ${SM[o.status]?.cls||'badge-gray'}`}>{SM[o.status]?.label||o.status}</span></td>
                  <td style={{fontSize:12,color:'var(--gray-500)'}}>{fmtDate(o.created_at)}</td>
                  <td>
                    <select className="status-select" value={o.status||'recebido'}
                      onChange={async e=>{ await DS.setStatus(o.id,e.target.value); refresh(); }}>
                      {Object.entries(SM).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminDashboard() {
  const { orders, refresh } = useOrders();
  const hoje  = orders.filter(o=>new Date(o.created_at).toDateString()===new Date().toDateString());
  const fatHoje  = hoje.reduce((a,o)=>a+Number(o.total||0),0);
  const emPreparo = orders.filter(o=>o.status==='preparo'||o.status==='recebido').length;
  const ticketMed = hoje.length>0 ? fatHoje/hoje.length : 0;
  const statusMap = {
    recebido:{label:'Recebido',cls:'status-recebido'},
    preparo: {label:'Em Preparo',cls:'status-preparo'},
    entrega: {label:'Saiu p/ Entrega',cls:'status-entrega'},
    entregue:{label:'Entregue',cls:'status-entregue'},
    cancelado:{label:'Cancelado',cls:'status-cancelado'},
  };

  /* Auto-refresh a cada 60s */
  useEffect(()=>{
    const t=setInterval(()=>refresh(),60000);
    return()=>clearInterval(t);
  },[refresh]);

  return (
    <div>
      {/* Métricas principais */}
      <div className="stat-cards" style={{gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))'}}>
        <div className="stat-card" style={{borderTop:'3px solid var(--grape)'}}>
          <div className="stat-icon">🌅</div>
          <div className="stat-val">{hoje.length}</div>
          <div className="stat-label">Pedidos hoje</div>
        </div>
        <div className="stat-card" style={{borderTop:'3px solid #16A34A'}}>
          <div className="stat-icon">💰</div>
          <div className="stat-val">{fmt(fatHoje)}</div>
          <div className="stat-label">Faturamento hoje</div>
        </div>
        <div className="stat-card" style={{borderTop:'3px solid var(--orange)'}}>
          <div className="stat-icon">👨‍🍳</div>
          <div className="stat-val">{emPreparo}</div>
          <div className="stat-label">Em preparo</div>
        </div>
        <div className="stat-card" style={{borderTop:'3px solid #0891B2'}}>
          <div className="stat-icon">📊</div>
          <div className="stat-val">{fmt(ticketMed)}</div>
          <div className="stat-label">Ticket médio</div>
        </div>
        <div className="stat-card" style={{borderTop:'3px solid var(--gray-300)'}}>
          <div className="stat-icon">📦</div>
          <div className="stat-val">{orders.length}</div>
          <div className="stat-label">Total geral</div>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="stat-cards" style={{marginBottom:20}}>
        {Object.entries(statusMap).map(([k,v])=>(
          <div key={k} className="stat-card" style={{padding:'12px 16px'}}>
            <div className="stat-val" style={{fontSize:20}}>{orders.filter(o=>o.status===k).length}</div>
            <div className="stat-label">{v.label}</div>
          </div>
        ))}
      </div>

      {/* Últimos pedidos */}
      <div className="admin-card">
        <div className="admin-card-header">
          <h3>📋 Últimos pedidos</h3>
          <button className="btn-secondary" onClick={refresh}>🔄 Atualizar</button>
        </div>
        {orders.length===0
          ?<div className="empty-state"><div className="icon">📋</div><p>Nenhum pedido</p></div>
          :<table className="data-table">
             <thead><tr><th>Cliente</th><th>Total</th><th>Status</th><th>Horário</th></tr></thead>
             <tbody>{orders.slice(0,10).map(o=>(
               <tr key={o.id}>
                 <td>
                   <div style={{fontWeight:600}}>{o.cliente_nome}</div>
                   <div style={{fontSize:11,color:'var(--gray-500)'}}>{o.cliente_telefone}</div>
                 </td>
                 <td style={{fontWeight:700}}>{fmt(o.total)}</td>
                 <td><span className={`badge ${statusMap[o.status]?.cls||'badge-gray'}`}>
                   {statusMap[o.status]?.label||o.status}
                 </span></td>
                 <td style={{fontSize:12,color:'var(--gray-500)'}}>{fmtDate(o.created_at)}</td>
               </tr>
             ))}</tbody>
           </table>
        }
      </div>
    </div>
  );
}

/* ── Admin: Status do Estabelecimento ─────────────────────── */
function AdminStatus() {
  const [status, setStatus] = useState(()=>{
    return localStorage.getItem('encanto_store_status') || 'open';
  });
  const toggle = (val) => {
    setStatus(val);
    localStorage.setItem('encanto_store_status', val);
  };
  return (
    <div>
      <div className="admin-card" style={{marginBottom:20}}>
        <div className="admin-card-header">
          <h3>🏪 Status do Estabelecimento</h3>
        </div>
        <div style={{padding:'24px 20px'}}>
          <p style={{fontSize:14,color:'var(--gray-500)',marginBottom:20}}>
            Define se a loja aparece como aberta ou fechada para os clientes no site.
          </p>
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            {/* Botão Aberto */}
            <button
              onClick={()=>toggle('open')}
              style={{
                flex:1,minWidth:140,padding:'18px 24px',borderRadius:14,cursor:'pointer',
                border: status==='open' ? '2.5px solid #16A34A' : '2px solid var(--gray-200)',
                background: status==='open' ? '#F0FDF4' : 'var(--white)',
                display:'flex',alignItems:'center',gap:12,transition:'all .2s',
                fontFamily:'var(--font-body)',
              }}>
              <span style={{
                width:14,height:14,borderRadius:'50%',flexShrink:0,
                background: status==='open' ? '#22C55E' : '#D1D5DB',
                boxShadow: status==='open' ? '0 0 0 3px rgba(34,197,94,.2)' : 'none',
                transition:'all .2s',
              }}/>
              <div style={{textAlign:'left'}}>
                <div style={{fontWeight:700,fontSize:15,color: status==='open'?'#15803D':'var(--gray-700)'}}>Aberto</div>
                <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>Aceita pedidos normalmente</div>
              </div>
              {status==='open' && <span style={{marginLeft:'auto',color:'#16A34A',fontSize:18}}>✓</span>}
            </button>

            {/* Botão Fechado */}
            <button
              onClick={()=>toggle('closed')}
              style={{
                flex:1,minWidth:140,padding:'18px 24px',borderRadius:14,cursor:'pointer',
                border: status==='closed' ? '2.5px solid #DC2626' : '2px solid var(--gray-200)',
                background: status==='closed' ? '#FEF2F2' : 'var(--white)',
                display:'flex',alignItems:'center',gap:12,transition:'all .2s',
                fontFamily:'var(--font-body)',
              }}>
              <span style={{
                width:14,height:14,borderRadius:'50%',flexShrink:0,
                background: status==='closed' ? '#EF4444' : '#D1D5DB',
                boxShadow: status==='closed' ? '0 0 0 3px rgba(239,68,68,.2)' : 'none',
                transition:'all .2s',
              }}/>
              <div style={{textAlign:'left'}}>
                <div style={{fontWeight:700,fontSize:15,color: status==='closed'?'#DC2626':'var(--gray-700)'}}>Fechado</div>
                <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>Exibe "Fechado no momento"</div>
              </div>
              {status==='closed' && <span style={{marginLeft:'auto',color:'#DC2626',fontSize:18}}>✓</span>}
            </button>
          </div>

          {/* Preview */}
          <div style={{
            marginTop:20,padding:'12px 16px',borderRadius:10,
            background: status==='open' ? '#F0FDF4' : '#FEF2F2',
            border: `1px solid ${status==='open'?'#BBF7D0':'#FECACA'}`,
            display:'flex',alignItems:'center',gap:8,fontSize:13,
            color: status==='open'?'#15803D':'#DC2626',fontWeight:600,
            flexWrap:'wrap',
          }}>
            <span style={{width:8,height:8,borderRadius:'50%',
              background: status==='open'?'#22C55E':'#EF4444',flexShrink:0}}/>
            {status==='open' ? '● Aberto agora' : '● Fechado no momento'}
            {status==='closed' && (
              <span style={{
                marginLeft:8,padding:'3px 10px',borderRadius:8,
                background:'rgba(220,38,38,.1)',border:'1px solid rgba(220,38,38,.2)',
                fontSize:11,fontWeight:600,color:'#DC2626',
              }}>📅 Botão "Agendar pedido" visível no site</span>
            )}
            <span style={{marginLeft:'auto',fontSize:11,fontWeight:400,color:'var(--gray-500)'}}>
              Visível imediatamente
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Admin: Fidelidade ─────────────────────────────────── */
function AdminFidelidade() {
  const [count,    setCount]    = useState(()=>parseInt(localStorage.getItem('encanto_loyalty_count')||'0'));
  const [required, setRequired] = useState(()=>parseInt(localStorage.getItem('encanto_loyalty_required')||'10'));
  const [discount, setDiscount] = useState(()=>parseInt(localStorage.getItem('encanto_loyalty_discount')||'50'));
  const [enabled,  setEnabled]  = useState(()=>localStorage.getItem('encanto_loyalty_enabled')!=='false');
  const [saved,    setSaved]    = useState(false);
  const [editReq,  setEditReq]  = useState(false);
  const [editDis,  setEditDis]  = useState(false);
  const rewardAvail = count >= required;

  const saveConfig = () => {
    localStorage.setItem('encanto_loyalty_required', String(required));
    localStorage.setItem('encanto_loyalty_discount',  String(discount));
    localStorage.setItem('encanto_loyalty_enabled',   String(enabled));
    setSaved(true); setEditReq(false); setEditDis(false);
    setTimeout(()=>setSaved(false), 2500);
  };

  const resetCounter = () => {
    if (!window.confirm(
      'Zerar o contador de pedidos?\nEsta ação representa que o cliente usou sua recompensa ou foi feito um ajuste manual.'
    )) return;
    localStorage.setItem('encanto_loyalty_count', '0');
    localStorage.setItem('encanto_loyalty_reward_used','true');
    setCount(0);
  };

  const addPedido = () => {
    if (count >= required) { alert('Recompensa já disponível. Peça para o cliente usar o desconto antes de adicionar novos pedidos.'); return; }
    const next = count + 1;
    localStorage.setItem('encanto_loyalty_count', String(next));
    setCount(next);
  };

  return (
    <div>
      {/* ── Cabeçalho com status ── */}
      <div style={{
        display:'flex',alignItems:'center',justifyContent:'space-between',
        flexWrap:'wrap',gap:12,marginBottom:20,
        padding:'16px 20px',background:'var(--white)',
        borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-sm)',
      }}>
        <div>
          <h2 style={{fontFamily:'var(--font-head)',fontSize:18,fontWeight:700,margin:0}}>
            🎁 Programa de Fidelidade
          </h2>
          <p style={{fontSize:13,color:'var(--gray-500)',marginTop:4}}>
            Regra: {required} pedidos = {discount}% de desconto
          </p>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{
            fontSize:12,fontWeight:700,
            color: enabled ? '#15803D' : 'var(--gray-500)',
            background: enabled ? '#F0FDF4' : 'var(--gray-100)',
            padding:'4px 12px',borderRadius:20,
          }}>
            {enabled ? '● Ativo' : '○ Desativado'}
          </span>
          <label className="toggle-switch">
            <input type="checkbox" checked={enabled} onChange={e=>{
              setEnabled(e.target.checked);
              localStorage.setItem('encanto_loyalty_enabled',String(e.target.checked));
            }}/>
            <span className="toggle-slider"/>
          </label>
        </div>
      </div>

      {/* ── Progresso do cliente ── */}
      <div className="admin-card" style={{marginBottom:20}}>
        <div className="admin-card-header">
          <h3>📊 Progresso atual</h3>
          <div style={{display:'flex',gap:8}}>
            <button className="btn-sm" onClick={addPedido} title="Adicionar 1 pedido manualmente">
              + Pedido
            </button>
            <button className="btn-danger" onClick={resetCounter}>
              ↺ Resetar
            </button>
          </div>
        </div>
        <div style={{padding:'20px'}}>
          {/* Card de status */}
          <div style={{
            display:'flex',alignItems:'center',gap:16,
            padding:'18px',borderRadius:14,marginBottom:16,
            background: rewardAvail ? '#F0FDF4' : 'var(--grape-pale)',
            border: `1.5px solid ${rewardAvail?'#BBF7D0':'#DDD6FE'}`,
          }}>
            <div style={{
              width:64,height:64,borderRadius:14,flexShrink:0,
              background: rewardAvail ? '#16A34A' : '#6B21A8',
              display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:28,boxShadow:`0 4px 12px ${rewardAvail?'rgba(22,163,74,.3)':'rgba(107,33,168,.3)'}`,
            }}>
              {rewardAvail ? '🎉' : '🛍️'}
            </div>
            <div style={{flex:1}}>
              <div style={{
                fontFamily:'var(--font-head)',fontSize:32,fontWeight:800,lineHeight:1,
                color: rewardAvail ? '#15803D' : '#6B21A8',
              }}>
                {count}
                <span style={{fontSize:16,fontWeight:500,color:'var(--gray-400)',marginLeft:4}}>
                  / {required} pedidos
                </span>
              </div>
              <div style={{fontSize:13,marginTop:6,fontWeight:600,
                color: rewardAvail ? '#15803D' : 'var(--grape)'}}>
                {rewardAvail
                  ? '🎁 Recompensa disponível! Cliente pode usar o desconto.'
                  : `Faltam ${required-count} pedido(s) para ${discount}% de desconto`}
              </div>
            </div>
          </div>

          {/* Barra */}
          <div style={{marginBottom:4}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--gray-400)',marginBottom:6}}>
              <span>order_count: {count} | reward_available: {rewardAvail?'true':'false'}</span>
              <span>{Math.round((count/required)*100)}%</span>
            </div>
            <div style={{width:'100%',height:12,background:'var(--gray-100)',borderRadius:6,overflow:'hidden'}}>
              <div style={{
                height:'100%',borderRadius:6,
                width:`${Math.min(100,(count/required)*100)}%`,
                background: rewardAvail
                  ? 'linear-gradient(90deg,#16A34A,#4ADE80)'
                  : 'linear-gradient(90deg,#6B21A8,#A855F7)',
                transition:'width .4s',
              }}/>
            </div>
          </div>

          {/* Grade de pedidos */}
          <div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:16}}>
            {Array.from({length:required}).map((_,i)=>(
              <div key={i} style={{
                width:34,height:34,borderRadius:8,
                background: i<count ? 'linear-gradient(135deg,#6B21A8,#A855F7)' : 'var(--gray-100)',
                display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:14,border: i<count ? 'none' : '1px solid var(--gray-200)',
                boxShadow: i<count ? '0 2px 6px rgba(107,33,168,.25)' : 'none',
                title:`Pedido ${i+1}`,
              }}>
                {i<count ? '🛍️' : <span style={{color:'var(--gray-300)'}}>○</span>}
              </div>
            ))}
          </div>

          <p style={{fontSize:11,color:'var(--gray-400)',marginTop:12,lineHeight:1.5}}>
            <b>+Pedido</b>: adiciona 1 pedido manualmente (ex: aprovado pelo sistema).
            <b> Resetar</b>: zera o contador (ex: cliente usou o desconto).
            Os campos <code>order_count</code> e <code>reward_available</code> refletem o estado atual.
          </p>
        </div>
      </div>

      {/* ── Configurações ── */}
      <div className="admin-card" style={{marginBottom:20}}>
        <div className="admin-card-header">
          <h3>⚙️ Configurações do Programa</h3>
          {saved && <span style={{color:'#16A34A',fontSize:13,fontWeight:700}}>✓ Salvo com sucesso!</span>}
        </div>
        <div style={{padding:'20px'}}>
          <div className="form-row" style={{marginBottom:20}}>
            <div className="form-group">
              <label className="form-label">Pedidos para recompensa</label>
              <input className="form-input" type="number" min="1" max="100"
                value={required} onChange={e=>setRequired(+e.target.value)}/>
              <span style={{fontSize:11,color:'var(--gray-400)',marginTop:3,display:'block'}}>
                Campo: <code>order_count</code> — padrão: 10
              </span>
            </div>
            <div className="form-group">
              <label className="form-label">Desconto da recompensa (%)</label>
              <input className="form-input" type="number" min="1" max="100"
                value={discount} onChange={e=>setDiscount(+e.target.value)}/>
              <span style={{fontSize:11,color:'var(--gray-400)',marginTop:3,display:'block'}}>
                Campo: <code>reward_discount</code> — padrão: 50
              </span>
            </div>
          </div>
          <div style={{
            padding:'12px 16px',background:'var(--gray-50)',borderRadius:10,
            marginBottom:20,fontSize:13,color:'var(--gray-600)',lineHeight:1.6,
          }}>
            <b>Lógica aplicada:</b><br/>
            • <code>order_count ≥ {required}</code> → <code>reward_available = true</code><br/>
            • Ao usar o desconto: <code>order_count = 0</code>, <code>reward_available = false</code>, <code>reward_used = true</code><br/>
            • Valor do frete não é contabilizado — somente products.<br/>
            • Recompensas não são cumulativas (1 por ciclo).
          </div>
          <button className="btn-primary" onClick={saveConfig} style={{minWidth:160}}>
            {saved ? '✓ Salvo!' : '💾 Salvar configurações'}
          </button>
        </div>
      </div>

      {/* ── Regulamento resumido ── */}
      <div className="admin-card">
        <div className="admin-card-header"><h3>📋 Regulamento do Programa</h3></div>
        <div style={{padding:'20px'}}>
          {[
            ['Elegibilidade','Para participar, o cliente deve possuir cadastro ativo. Em caso de uso indevido ou fraude, a loja pode cancelar os benefícios.'],
            ['Contabilização','O pedido só contabiliza após ser aprovado ou finalizado pela loja. O valor do frete não é contabilizado.'],
            ['Recompensa','Peça 10 vezes e ganhe 50% de desconto no próximo pedido. O resgate só pode ser feito pelo próprio participante.'],
            ['Validade','O programa é válido por tempo indeterminado. A loja pode alterar regras, duração ou benefícios a qualquer momento.'],
            ['Encerramento','Em caso de encerramento, pontos e recompensas poderão ser zerados.'],
          ].map(([t,d])=>(
            <div key={t} style={{
              display:'flex',gap:12,padding:'12px 0',
              borderBottom:'1px solid var(--gray-100)',
            }}>
              <div style={{
                fontSize:12,fontWeight:700,color:'var(--amarelo)',
                minWidth:110,flexShrink:0,paddingTop:1,
              }}>{t}</div>
              <div style={{fontSize:13,color:'var(--gray-600)',lineHeight:1.55}}>{d}</div>
            </div>
          ))}
          <div style={{
            display:'flex',gap:12,padding:'12px 0',
          }}>
            <div style={{fontSize:12,fontWeight:700,color:'var(--amarelo)',minWidth:110,flexShrink:0}}>Contato</div>
            <div style={{fontSize:13,color:'var(--gray-600)'}}>
              <a href="https://wa.me/5538992203620" target="_blank"
                style={{color:'var(--amarelo)',fontWeight:600}}>
                WhatsApp: (38) 99220-3620
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* HARDEN-06: painel de Saúde/Observabilidade — consome orders_health() (só agregados, sem PII). */
function AdminHealth() {
  const [h, setH]             = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async()=>{ setLoading(true); setH(await DS.getHealth()); setLoading(false); },[]);
  useEffect(()=>{ load(); },[load]);
  const Card = ({icon,val,label,color}) => (
    <div className="stat-card" style={{borderTop:`3px solid ${color}`}}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-val">{val}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
  return (
    <div>
      <div className="admin-card-header" style={{marginBottom:12}}>
        <h3>🩺 Saúde do Sistema</h3>
        <button className="btn-secondary" onClick={load}>🔄 Atualizar</button>
      </div>
      {loading ? <Spinner/> : !h ? (
        <div className="empty-state"><div className="icon">🩺</div><p>Sem dados de saúde</p></div>
      ) : (
        <>
          <div className="stat-cards" style={{gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))'}}>
            <Card icon="🌅" val={h.pedidos_hoje}           label="Pedidos hoje"     color="var(--grape)"/>
            <Card icon="💰" val={fmt(h.faturamento_hoje)}  label="Faturamento hoje" color="#16A34A"/>
            <Card icon="📊" val={fmt(h.ticket_medio_hoje)} label="Ticket médio"     color="#0891B2"/>
            <Card icon="📦" val={h.pedidos_total}          label="Total geral"      color="var(--gray-300)"/>
            <Card icon="⚠️" val={h.erros_24h}              label="Erros 24h"        color="var(--orange)"/>
            <Card icon="🧮" val={h.divergencias}           label="Divergências"     color={h.divergencias>0?'#DC2626':'#16A34A'}/>
          </div>
          {Array.isArray(h.serie_7d) && h.serie_7d.length>0 && (
            <div style={{marginTop:20}}>
              <div className="stat-label" style={{marginBottom:8}}>
                Pedidos/dia (7 dias) · Taxa de erro 24h: <b>{h.taxa_erro_pct}%</b>
              </div>
              <div style={{display:'flex',alignItems:'flex-end',gap:6,height:90}}>
                {(()=>{ const max=Math.max(1,...h.serie_7d.map(x=>Number(x.n)||0));
                  return h.serie_7d.map((d,i)=>(
                    <div key={i} style={{flex:1,textAlign:'center'}}>
                      <div style={{height:`${((Number(d.n)||0)/max)*60}px`,minHeight:2,background:'var(--grape)',borderRadius:4,marginBottom:4}} title={String(d.n)}/>
                      <div style={{fontSize:11,fontWeight:700}}>{Number(d.n)||0}</div>
                      <div style={{fontSize:10,color:'var(--gray-500)'}}>{d.dia}</div>
                    </div>
                  )); })()}
              </div>
            </div>
          )}
          <div style={{marginTop:16,fontSize:12,color:'var(--gray-500)'}}>
            Pedidos 7d: {h.pedidos_7d} · 24h: {h.pedidos_24h} · Logs: {h.logs_total} · Atualizado: {fmtDate(h.gerado_em)}
          </div>
        </>
      )}
    </div>
  );
}

function AdminPanel({ onExit }) {
  const [tab, setTab] = useState('dashboard');
  const tabs = [
    {id:'dashboard', icon:'📊', label:'Dashboard'},
    {id:'pedidos',   icon:'📋', label:'Pedidos'},
    {id:'products',  icon:'🛍️', label:'products'},
    {id:'categorias',icon:'🏷️', label:'Categorias'},
    {id:'adicionais',icon:'➕', label:'Adicionais'},
    {id:'status',    icon:'🏪', label:'Status'},
    {id:'fidelidade',icon:'🎁', label:'Fidelidade'},
    {id:'saude',     icon:'🩺', label:'Saúde'},
  ];
  const titles = {dashboard:'Dashboard',pedidos:'Pedidos',products:'Products',categorias:'Categorias',adicionais:'Adicionais',status:'Status da Loja',fidelidade:'Fidelidade',saude:'Saúde do Sistema'};
  return (
    <div className="admin-layout">
      <div className="admin-sidebar">
        <div className="admin-logo">✨ <span>Encanto</span></div>
        <nav className="admin-nav">
          {tabs.map(t=>(
            <div key={t.id} className={`admin-nav-item ${tab===t.id?'active':''}`} onClick={()=>setTab(t.id)}>
              <span className="nav-icon">{t.icon}</span>
              <span>{t.label}</span>
            </div>
          ))}
        </nav>
        <div style={{padding:'16px 8px'}}>
          <div className="admin-nav-item" onClick={onExit} style={{color:'rgba(255,255,255,.5)'}}>
            <span className="nav-icon">🚪</span><span>Sair</span>
          </div>
        </div>
      </div>
      <div className="admin-content">
        <div className="admin-top">
          <h1>{titles[tab]}</h1>
          <button className="admin-exit" onClick={onExit}>← Ver loja</button>
        </div>
        <div className="admin-body">
          {tab==='dashboard'  && <AdminDashboard/>}
          {tab==='pedidos'    && <AdminPedidos/>}
          {tab==='products'   && <AdminProducts/>}
          {tab==='categorias' && <AdminCategorias/>}
          {tab==='adicionais' && <AdminAdicionais/>}
          {tab==='status'     && <AdminStatus/>}
          {tab==='fidelidade' && <AdminFidelidade/>}
          {tab==='saude'      && <AdminHealth/>}
        </div>
      </div>
    </div>
  );
}

/* ── StoreApp ────────────────────────────────────────────────── */

/* ── LazySection: renderiza filhos apenas quando seção entra na tela ── */
const LazySection = React.memo(function LazySection({ id, children, style }) {
  const [visible, setVisible] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(()=>{
    if (!ref.current) return;
    /* Se já está no viewport (ex: seção do topo), renderizar imediatamente */
    const rect = ref.current.getBoundingClientRect();
    if (rect.top < window.innerHeight + 400) { setVisible(true); return; }
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: '200px 0px' } /* pré-carregar 200px antes de aparecer */
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} id={id} style={{scrollMarginTop: style?.scrollMarginTop || 24, ...style}}>
      {visible ? children : (
        <div style={{minHeight:240,background:'transparent'}}/>
      )}
    </div>
  );
});

/* ── AddressModal: busca profissional com ViaCEP + Nominatim + Leaflet ── */
function AddressModal({ onClose, onSelect }) {
  const { useState: us, useEffect: ue, useCallback: ucb, useRef: ur } = React;

  const [tab,         setTab]         = us('search');   // search | cep | map
  const [query,       setQuery]        = us('');
  const [numero,      setNumero]       = us('');
  const [complemento, setComplemento]  = us('');
  const [suggestions, setSuggestions]  = us([]);
  const [status,      setStatus]       = us('idle');    // idle|loading|found|notfound|gps|outrange
  const [cepQuery,    setCepQuery]     = us('');
  const [cepData,     setCepData]      = us(null);
  const [cepNumero,   setCepNumero]    = us('');
  const [mapPin,      setMapPin]       = us({lat:-26.795,lng:-49.270});
  const [mapAddr,     setMapAddr]      = us('');
  const inputRef = ur(null);
  const mapRef   = ur(null);
  const leafRef  = ur(null);

  /* Área de entrega: raio ~15km de Timbó (aproximação por bounding box) */
  const inRange = (lat, lng) => lat>=-27.0&&lat<=-26.5&&lng>=-49.5&&lng>=-49.0;

  ue(()=>{ if(tab==='search') inputRef.current?.focus(); },[tab]);

  /* ── Leaflet: inicializar mapa ao entrar na aba mapa ── */
  ue(()=>{
    if (tab!=='map') return;
    const init = () => {
      if (!window.L || !mapRef.current || leafRef.current) return;
      const map = window.L.map(mapRef.current).setView([mapPin.lat, mapPin.lng], 15);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
        attribution:'© OpenStreetMap'
      }).addTo(map);
      const marker = window.L.marker([mapPin.lat, mapPin.lng],{draggable:true}).addTo(map);
      marker.on('dragend', async e => {
        const {lat,lng} = e.target.getLatLng();
        setMapPin({lat,lng});
        try {
          const r = await fetch(
            'https://nominatim.openstreetmap.org/reverse?format=json&lat='+lat+'&lon='+lng+'&addressdetails=1',
            {headers:{'Accept-Language':'pt-BR'}}
          );
          const d = await r.json();
          const a = d.address||{};
          const addr = [a.road,a.house_number,a.suburb||a.neighbourhood,a.city||a.town]
            .filter(Boolean).join(', ');
          setMapAddr(addr || d.display_name?.split(',').slice(0,3).join(',') || '');
        } catch { setMapAddr(''); }
      });
      map.on('click', async e => {
        const {lat,lng} = e.latlng;
        marker.setLatLng([lat,lng]);
        setMapPin({lat,lng});
        try {
          const r = await fetch(
            'https://nominatim.openstreetmap.org/reverse?format=json&lat='+lat+'&lon='+lng+'&addressdetails=1',
            {headers:{'Accept-Language':'pt-BR'}}
          );
          const d = await r.json();
          const a = d.address||{};
          const addr = [a.road,a.house_number,a.suburb||a.neighbourhood,a.city||a.town]
            .filter(Boolean).join(', ');
          setMapAddr(addr || '');
        } catch { setMapAddr(''); }
      });
      leafRef.current = map;
    };
    if (window.L) { setTimeout(init, 50); return; }
    /* Carregar Leaflet dinamicamente */
    const css = document.createElement('link');
    css.rel='stylesheet'; css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = ()=>setTimeout(init, 50);
    document.head.appendChild(js);
    return ()=>{ if(leafRef.current){leafRef.current.remove();leafRef.current=null;} };
  },[tab]);

  /* ── Busca por CEP via ViaCEP (API brasileira oficial) ── */
  const buscarCEP = ucb(async (cep) => {
    const c = cep.replace(/\D/g,'');
    if (c.length !== 8) return;
    setStatus('loading');
    try {
      const r = await fetch('https://viacep.com.br/ws/'+c+'/json/');
      const d = await r.json();
      if (d.erro) { setStatus('notfound'); setCepData(null); return; }
      setCepData(d);
      setStatus('found');
      setCepNumero('');
    } catch { setStatus('notfound'); setCepData(null); }
  },[]);

  ue(()=>{
    const t = setTimeout(()=>buscarCEP(cepQuery), 400);
    return ()=>clearTimeout(t);
  },[cepQuery, buscarCEP]);

  const confirmCEP = () => {
    if (!cepData || !cepNumero.trim()) { alert('Informe o número da residência.'); return; }
    const short = `${cepData.logradouro}, ${cepNumero.trim()}${complemento?' '+complemento:''} — ${cepData.bairro}`;
    onSelect(short, {
      rua: cepData.logradouro, numero: cepNumero.trim(),
      bairro: cepData.bairro, cidade: cepData.localidade,
      estado: cepData.uf, cep: cepData.cep,
      complemento: complemento,
    });
  };

  /* ── Busca por rua/nome via Nominatim multi-estratégia ── */
  const searchAddress = ucb(async (q) => {
    if (!q || q.length < 3) { setSuggestions([]); setStatus('idle'); return; }
    setStatus('loading');
    const NOM = 'https://nominatim.openstreetmap.org/search';
    const H   = {'Accept-Language':'pt-BR'};
    const numM  = q.match(/(\d+)/);
    const num   = numM ? numM[1] : '';
    const semN  = q.replace(/\d+/g,'').replace(/[-,]/g,' ').trim();
    const urls  = [
      NOM+'?format=json&q='+encodeURIComponent(q+', Timbó, SC, Brasil')+'&limit=6&addressdetails=1&countrycodes=br',
      num && semN.length>2
        ? NOM+'?format=json&street='+encodeURIComponent(num+' '+semN)+'&city=Timb%C3%B3&state=Santa+Catarina&country=Brasil&format=json&addressdetails=1&limit=5'
        : null,
      semN.length>3
        ? NOM+'?format=json&q='+encodeURIComponent(semN+', Timbó, SC')+'&limit=5&addressdetails=1&countrycodes=br'
        : null,
    ].filter(Boolean);
    try {
      let res=[];
      for(const u of urls){ if(res.length>0)break; const r=await fetch(u,{headers:H}); const d=await r.json(); res=Array.isArray(d)?d:[]; }
      const seen=new Set();
      res=res.filter(s=>{ const k=(s.address?.road||'')+','+(s.address?.house_number||''); if(seen.has(k))return false; seen.add(k);return true; });
      if(res.length>0){setSuggestions(res);setStatus('found');}
      else{setSuggestions([]);setStatus('notfound');}
    } catch { setSuggestions([]); setStatus('notfound'); }
  },[]);

  ue(()=>{ const t=setTimeout(()=>searchAddress(query),450); return()=>clearTimeout(t); },[query,searchAddress]);

  /* ── GPS ── */
  const useGPS = () => {
    if(!navigator.geolocation){alert('GPS indisponível.');return;}
    setStatus('gps');
    navigator.geolocation.getCurrentPosition(async pos=>{
      const {latitude:lat,longitude:lng}=pos.coords;
      try {
        const r=await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat='+lat+'&lon='+lng+'&addressdetails=1',{headers:{'Accept-Language':'pt-BR'}});
        const d=await r.json(); const a=d.address||{};
        const short=[a.road,a.house_number].filter(Boolean).join(', ')||d.display_name?.split(',')[0]||'';
        const bairro=a.suburb||a.neighbourhood||''; const cidade=a.city||a.town||'Timbó';
        onSelect(short+( bairro?' — '+bairro:''), {lat,lng,rua:a.road||'',numero:a.house_number||'',bairro,cidade,estado:a.state||'SC',cep:a.postcode||''});
      } catch { onSelect(lat.toFixed(5)+', '+lng.toFixed(5),{lat,lng}); }
    },()=>{ setStatus('idle'); alert('Não foi possível obter a localização.'); });
  };

  /* ── Selecionar sugestão ── */
  const pick = (s) => {
    const a=s.address||{};
    const rua=a.road||''; const num=a.house_number||''; const bairro=a.suburb||a.neighbourhood||a.quarter||'';
    const cidade=a.city||a.town||a.municipality||'Timbó'; const cep=a.postcode||''; const estado=a.state||'SC';
    const short=[rua+( num?', '+num:''), bairro].filter(Boolean).join(' — ') || s.display_name.split(',').slice(0,2).join(',').trim();
    onSelect(short, {lat:parseFloat(s.lat),lng:parseFloat(s.lon),rua,numero:num,bairro,cidade,estado,cep,full:s.display_name});
  };

  /* ── Confirmar pelo mapa ── */
  const confirmMap = async () => {
    if(!mapAddr.trim()&&!cepNumero.trim()){
      const r=await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat='+mapPin.lat+'&lon='+mapPin.lng+'&addressdetails=1',{headers:{'Accept-Language':'pt-BR'}});
      const d=await r.json(); const a=d.address||{};
      const addr=[a.road,a.house_number,a.suburb,a.city||a.town].filter(Boolean).join(', ');
      onSelect(addr||'Localização no mapa',{lat:mapPin.lat,lng:mapPin.lng});
    } else {
      onSelect(mapAddr||('Lat '+mapPin.lat.toFixed(5)),{lat:mapPin.lat,lng:mapPin.lng});
    }
  };

  /* ── UI ── */
  const TABS=[{id:'search',label:'🔍 Buscar endereço'},{id:'cep',label:'📮 Buscar por CEP'},{id:'map',label:'🗺️ Ver no mapa'}];

  return (
    <div className="addr-modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="addr-modal" style={{maxWidth:500}}>

        {/* Header */}
        <div className="addr-modal-head">
          <span className="addr-modal-title">📍 Onde receber seu pedido?</span>
          <button className="addr-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Abas */}
        <div style={{display:'flex',borderBottom:'1px solid var(--gray-100)',background:'var(--gray-50)'}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              flex:1,padding:'10px 4px',border:'none',background:'none',cursor:'pointer',
              fontSize:11,fontWeight:700,fontFamily:'var(--font-body)',
              borderBottom: tab===t.id ? '2px solid var(--grape)' : '2px solid transparent',
              color: tab===t.id ? 'var(--grape)' : 'var(--gray-500)',
              transition:'all .15s',
            }}>{t.label}</button>
          ))}
        </div>

        <div className="addr-modal-body">

          {/* ── ABA: Buscar por nome/rua ── */}
          {tab==='search' && (
            <>
              <input ref={inputRef} className="addr-search-input"
                placeholder="Rua, número, bairro ou local..." value={query}
                onChange={e=>setQuery(e.target.value)}/>
              <button className="addr-gps-btn" onClick={useGPS}>
                {status==='gps'
                  ? <><span style={{display:'inline-block',animation:'spin .8s linear infinite'}}>⏳</span> Obtendo localização...</>
                  : <><span>🎯</span> Usar minha localização atual</>}
              </button>
              {status==='loading' && (
                <div style={{textAlign:'center',padding:'20px',color:'var(--gray-400)'}}>
                  <div className="spinner" style={{margin:'0 auto 8px'}}/><p style={{fontSize:13}}>Buscando...</p>
                </div>
              )}
              {status==='found' && (
                <div className="addr-suggestions" style={{marginTop:10}}>
                  {suggestions.map((s,i)=>{
                    const a=s.address||{};
                    const main=[a.road,a.house_number].filter(Boolean).join(', ')||s.display_name.split(',')[0];
                    const sub=[a.suburb||a.neighbourhood,a.city||a.town,a.postcode?'CEP '+a.postcode:''].filter(Boolean).join(' · ');
                    return (
                      <div key={i} className="addr-suggestion-item" onClick={()=>pick(s)}>
                        <span className="addr-suggestion-icon">📍</span>
                        <div className="addr-suggestion-text">
                          <div className="addr-suggestion-main">{main}</div>
                          {sub&&<div className="addr-suggestion-sub">{sub}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {status==='notfound' && (
                <div className="addr-not-found">
                  <div style={{fontSize:28,marginBottom:6}}>🔍</div>
                  <p><b>Endereço não encontrado.</b><br/>Tente buscar pelo CEP ou marque no mapa.</p>
                  <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap',marginTop:10}}>
                    <button className="addr-map-btn" onClick={()=>setTab('cep')}>📮 Buscar por CEP</button>
                    <button className="addr-map-btn" onClick={()=>setTab('map')}>🗺️ Ver no mapa</button>
                  </div>
                </div>
              )}
              {status==='idle' && !query && (
                <div style={{marginTop:12}}>
                  <div className="addr-section-label">Dicas de busca</div>
                  <div style={{fontSize:12,color:'var(--gray-500)',lineHeight:1.8,padding:'4px 0'}}>
                    • Ex: <b>Rua das Flores, 123</b><br/>
                    • Ex: <b>João Schlay 77</b><br/>
                    • Ex: <b>Testo Central, Timbó</b>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── ABA: Buscar por CEP ── */}
          {tab==='cep' && (
            <>
              <label style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',display:'block',marginBottom:6}}>
                CEP
              </label>
              <input className="addr-search-input"
                placeholder="00000-000"
                value={cepQuery}
                maxLength={9}
                onChange={e=>{
                  let v=e.target.value.replace(/\D/g,'');
                  if(v.length>5) v=v.slice(0,5)+'-'+v.slice(5,8);
                  setCepQuery(v); setStatus('idle'); setCepData(null);
                }}/>
              {status==='loading' && (
                <div style={{textAlign:'center',padding:'16px',color:'var(--gray-400)'}}>
                  <div className="spinner" style={{margin:'0 auto 8px'}}/><p style={{fontSize:13}}>Buscando CEP...</p>
                </div>
              )}
              {status==='found' && cepData && (
                <div style={{marginTop:12}}>
                  <div style={{
                    background:'var(--grape-pale)',borderRadius:10,padding:'12px 14px',
                    border:'1px solid #DDD6FE',marginBottom:12,
                  }}>
                    <div style={{fontWeight:700,fontSize:14,color:'var(--amarelo)',marginBottom:4}}>
                      ✅ CEP encontrado
                    </div>
                    <div style={{fontSize:13,color:'var(--gray-700)',lineHeight:1.7}}>
                      <b>{cepData.logradouro}</b><br/>
                      {cepData.bairro} · {cepData.localidade}/{cepData.uf}
                    </div>
                  </div>
                  <label style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',display:'block',marginBottom:4}}>
                    Número da residência <span style={{color:'var(--orange)'}}>*</span>
                  </label>
                  <input className="addr-search-input" style={{marginBottom:8}}
                    placeholder="Ex: 77" value={cepNumero}
                    onChange={e=>setCepNumero(e.target.value)}/>
                  <label style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',display:'block',marginBottom:4}}>
                    Complemento (opcional)
                  </label>
                  <input className="addr-search-input" style={{marginBottom:12}}
                    placeholder="Ex: Casa 02, Ap 301" value={complemento}
                    onChange={e=>setComplemento(e.target.value)}/>
                  <button className="addr-confirm-btn" onClick={confirmCEP}>
                    ✅ Confirmar endereço
                  </button>
                </div>
              )}
              {status==='notfound' && (
                <div className="addr-not-found" style={{marginTop:16}}>
                  <p>CEP não encontrado. Verifique e tente novamente.</p>
                </div>
              )}
            </>
          )}

          {/* ── ABA: Mapa Leaflet interativo ── */}
          {tab==='map' && (
            <>
              <p style={{fontSize:12,color:'var(--gray-500)',marginBottom:8,lineHeight:1.5}}>
                Clique ou arraste o marcador para marcar seu endereço.
              </p>
              <div className="addr-map-container" style={{height:300}}>
                <div ref={mapRef} style={{width:'100%',height:'100%'}}/>
              </div>
              {mapAddr && (
                <div style={{
                  marginTop:8,padding:'8px 12px',background:'var(--grape-pale)',
                  borderRadius:8,fontSize:13,color:'var(--amarelo)',fontWeight:600,
                }}>
                  📍 {mapAddr}
                </div>
              )}
              <label style={{fontSize:12,fontWeight:700,color:'var(--gray-600)',display:'block',margin:'10px 0 4px'}}>
                Número da residência
              </label>
              <input className="addr-search-input" style={{marginBottom:10}}
                placeholder="Ex: 77" value={cepNumero}
                onChange={e=>setCepNumero(e.target.value)}/>
              <button className="addr-confirm-btn" onClick={confirmMap}>
                ✅ Confirmar localização no mapa
              </button>
              <p style={{fontSize:10,color:'var(--gray-400)',textAlign:'center',marginTop:6}}>
                Lat: {mapPin.lat.toFixed(5)} · Lng: {mapPin.lng.toFixed(5)}
              </p>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

/* ── SearchBar: dropdown de categorias robusto ──────────── */
function SearchBar({ cats, search, setSearch, setSelCat }) {
  const [open, setOpen]     = React.useState(false);
  const wrapRef             = React.useRef(null);

  /* Fechar ao clicar fora do componente inteiro */
  React.useEffect(()=>{
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return ()=>{
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  /* Fechar ao pressionar ESC */
  React.useEffect(()=>{
    const esc = (e) => { if (e.key==='Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return ()=>document.removeEventListener('keydown', esc);
  }, []);

  const getCatSecId = (nome) => {
    const n = (nome||'').toLowerCase();
    if (n.includes('combo'))     return 'sec-combos';
    if (n.includes('batidinha')) return 'sec-batidinha';
    if (n.includes('destaque'))  return 'sec-destaques';
    if (n.includes('monte'))     return 'sec-monte';
    if (n.includes('pronto'))    return 'sec-prontos';
    if (n.includes('marmita'))   return 'sec-marmitas';
    if (n.includes('açaí')||n.includes('acai')) return 'sec-acai';
    if (n.includes('bebida'))    return 'sec-bebidas';
    return null;
  };

  const handleCatClick = (cat) => {
    setOpen(false);
    setSearch('');
    setSelCat(cat.id);
  };

  return (
    <div className="search-bar" ref={wrapRef}>
      <div className="search-wrapper">
        <div className="search-inner" onClick={()=>{ if(!search) setOpen(o=>!o); }}>
          <span className="search-icon">🔍</span>
          <input
            placeholder={open && !search ? 'Escolha uma categoria ou busque...' : 'Buscar açaí, marmitas, combos...'}
            value={search}
            onChange={e=>{
              setSearch(e.target.value);
              setSelCat(null);
              setOpen(false);
            }}
            onFocus={()=>{ if(!search) setOpen(true); }}
          />
          {search && (
            <button
              onClick={e=>{ e.stopPropagation(); setSearch(''); setOpen(false); }}
              style={{color:'var(--gray-400)',fontSize:18,background:'none',border:'none',cursor:'pointer'}}>
              ✕
            </button>
          )}
          {!search && (
            <span style={{
              fontSize:18,color:'var(--gray-400)',transition:'transform .2s',
              transform: open ? 'rotate(180deg)' : 'rotate(0)',
              lineHeight:1, flexShrink:0,
            }}>⌄</span>
          )}
        </div>

        {/* Dropdown — permanece aberto até clicar fora ou pressionar ESC */}
        {open && !search && (
          <div className="cat-dropdown" role="listbox" aria-label="Categorias">
            <div style={{
              padding:'8px 16px 6px',fontSize:11,fontWeight:700,
              color:'var(--gray-400)',letterSpacing:'.6px',textTransform:'uppercase',
              borderBottom:'1px solid var(--gray-100)',
            }}>
              Categorias
            </div>
            {cats.map(cat => (
              <div
                key={cat.id}
                className="cat-drop-item"
                role="option"
                tabIndex={0}
                /* mousedown antes do blur — não perde o foco antes de registrar o clique */
                onMouseDown={e=>e.preventDefault()}
                onClick={()=>handleCatClick(cat)}
                onKeyDown={e=>{ if(e.key==='Enter'||e.key===' ') handleCatClick(cat); }}
              >
                <span className="cat-drop-icon">{cat.icone||'🍽️'}</span>
                <span className="cat-drop-name">{cat.nome}</span>
                <span className="cat-drop-arrow">›</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StoreApp({ onAdmin }) {
  const [page,          setPage]         = useState('home');
  const [selCat,        setSelCat]        = useState(null);
  const [search,        setSearch]        = useState('');
  const [modal,         setModal]         = useState(null);
  const [cartOpen,      setCartOpen]      = useState(false);
  const [waMsg,         setWaMsg]         = useState('');
  /* Estado visual do header — não afeta lógica */
  const [deliveryMode,   setDeliveryMode]   = useState('entrega');
  const [deliveryAddress,setDeliveryAddress] = useState(()=>
    localStorage.getItem('encanto_delivery_address')||'');
  const [showAddressModal,setShowAddressModal] = useState(false);
  const [showLoyalty,    setShowLoyalty]     = useState(false);
  /* ── Programa de Fidelidade ── armazenado localmente */
  const [loyaltyCount,   setLoyaltyCount]    = useState(()=>
    parseInt(localStorage.getItem('encanto_loyalty_count')||'0'));
  const [loyaltyConfig]  = useState(()=>({
    required: parseInt(localStorage.getItem('encanto_loyalty_required')||'10'),
    discount: parseInt(localStorage.getItem('encanto_loyalty_discount')||'50'),
  }));
  const loyaltyReward = loyaltyCount >= loyaltyConfig.required;
  const [storeOpen,      setStoreOpen]       = useState(()=>{
    /* Ler do localStorage — Admin pode alterar */
    const saved = localStorage.getItem('encanto_store_status');
    if (saved) return saved === 'open';
    /* Fallback: horário automático 09h–22h */
    const h = new Date().getHours();
    return h >= 9 && h < 22;
  });
  const cart = useCart();
  const { cats, src:catSrc }                    = useCategories();
  const { prods:rawProds, loading, src:prodSrc }= useProducts(selCat, search);
  const adicionais = useAdicionais();

  const catMap = useMemo(()=>{ const m={}; cats.forEach(c=>{m[c.id]=c;}); return m; },[cats]);
  const prods  = useMemo(()=>rawProds.map(p=>({
    ...p,
    _catNome: catMap[p.categoria_id]?.nome||'',
    /* _catIds: array de todas as categorias do produto (para uso interno) */
    _catIds: getProdCatIds(p),
  })),[rawProds,catMap]);

  if (page==='checkout') return <CheckoutPage cart={cart} onBack={()=>setPage('home')} onSuccess={msg=>{setWaMsg(msg);setPage('success');}}/>;
  if (page==='success')  return <SuccessPage  msg={waMsg} cart={cart} onBack={()=>setPage('home')}/>;

  return (
    <div className="app">
      {/* ── HEADER PRINCIPAL (roxo) ── */}
      <header className="header">

        {/* Coluna esquerda: logo */}
        <div className="header-brand-col">
          {LOGO && <img loading="lazy"
            src={LOGO} alt="Encanto" className="header-brand-logo"
            onClick={()=>{
              /* Acesso oculto: 5 cliques rápidos na logo */
              const now = Date.now();
              const key = 'encanto_logo_clicks';
              const raw = JSON.parse(sessionStorage.getItem(key)||'[]');
              const recent = [...raw.filter(t=>now-t<3000), now];
              sessionStorage.setItem(key, JSON.stringify(recent));
              if (recent.length >= 5) {
                sessionStorage.removeItem(key);
                onAdmin();
              }
            }}
            style={{cursor:'default'}}
          />}
        </div>

        {/* Centro: nome da marca + status */}
        <div className="header-logo">
          <div className="header-logo-text">
            <span className="brand-name" style={{display:'flex',alignItems:'baseline',gap:7}}>
              Encanto
              <span style={{
                fontSize:12,fontWeight:600,color:'rgba(255,255,255,.55)',
                letterSpacing:'.5px',textTransform:'uppercase',
              }}>Timbó</span>
            </span>
            <span className="brand-sub">Marmita e Açaí</span>
            <div className="status-actions">
              <div className={`header-status-pill ${storeOpen?'open':'closed'}`}>
                <span className={`status-dot ${storeOpen?'open':'closed'}`}/>
                {storeOpen ? 'Aberto agora' : 'Fechado agora'}
              </div>
              {!storeOpen && (
                <button className="btn-agendar" onClick={()=>alert('Agendamento em breve!')}>
                  📅 Agendar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Direita: carrinho + admin (admin só para logados) */}
        <div className="header-actions">
          <button className="header-cart-btn" onClick={()=>setCartOpen(true)}>
            🛒{cart.count>0&&<span> {fmt(cart.total)}</span>}
            {cart.count>0&&<span className="cart-badge">{cart.count}</span>}
          </button>
          <button className="header-admin-btn" onClick={onAdmin} title="Painel Admin">
            ⚙️
          </button>
        </div>

      </header>

      {/* ── BARRA DE ENTREGA (branca, abaixo do header) ── */}
      <div className="delivery-bar">
        <div className="delivery-mode-select">
          <span className="delivery-mode-icon">
            {deliveryMode==='entrega'?'🛵':'🏃'}
          </span>
          <select
            className="delivery-mode-dropdown"
            value={deliveryMode}
            onChange={e=>setDeliveryMode(e.target.value)}>
            <option value="entrega">Entrega</option>
            <option value="retirada">Retirada</option>
          </select>
        </div>

        <div className="delivery-bar-divider"/>

        <div className="delivery-eta">
          {deliveryMode==='entrega'
            ? <>Entrega em até <b>35–45 min</b></>
            : <>Pronto em <b>20 min</b></>}
        </div>

        <div className="delivery-bar-divider"/>
        {deliveryMode==='entrega' ? (
          <button
            className={`delivery-address-btn ${deliveryAddress?'filled':''}`}
            onClick={()=>setShowAddressModal(true)}>
            📍 {deliveryAddress
              ? <span style={{maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'inline-block'}}>
                  {deliveryAddress}
                </span>
              : 'Selecionar endereço'}
          </button>
        ) : (
          <div style={{
            display:'inline-flex',alignItems:'center',gap:5,
            fontSize:12,color:'var(--gray-600)',fontWeight:600,
          }}>
            <span>🏪</span>
            <span>Rua João Schlay, 77 Casa 02</span>
          </div>
        )}
      </div>

      {/* ── Progresso de fidelidade mini (abaixo da barra de entrega) ── */}
      {loyaltyCount>0 && !loyaltyReward && (
        <div
          onClick={()=>setShowLoyalty(true)}
          style={{
            background:'var(--grape-pale)',padding:'8px 20px',cursor:'pointer',
            display:'flex',alignItems:'center',gap:10,
            borderBottom:'1px solid #DDD6FE',
          }}>
          <div style={{flex:1}}>
            <div style={{fontSize:11,color:'var(--amarelo)',fontWeight:600,marginBottom:3}}>
              🎁 Fidelidade: {loyaltyCount} de {loyaltyConfig.required} pedidos
            </div>
            <div style={{
              height:4,background:'#DDD6FE',borderRadius:2,overflow:'hidden',
            }}>
              <div style={{
                height:'100%',borderRadius:2,
                width:`${Math.min(100,(loyaltyCount/loyaltyConfig.required)*100)}%`,
                background:'linear-gradient(90deg,#A62786,#C8D82B)',
              }}/>
            </div>
          </div>
          <span style={{fontSize:11,color:'var(--amarelo)',fontWeight:700,whiteSpace:'nowrap'}}>
            Ver detalhes →
          </span>
        </div>
      )}
      {loyaltyReward && (
        <div
          onClick={()=>setShowLoyalty(true)}
          style={{
            background:'#FBBF24',padding:'8px 20px',cursor:'pointer',
            display:'flex',alignItems:'center',gap:10,
            borderBottom:'1px solid #F59E0B',
          }}>
          <span style={{fontSize:16}}>🎁</span>
          <span style={{fontSize:12,fontWeight:700,color:'#78350F',flex:1}}>
            Você ganhou 50% de desconto! Clique para resgatar.
          </span>
          <span style={{fontSize:11,color:'#92400E',fontWeight:700}}>→</span>
        </div>
      )}

      <div className="app-content">
      {/* ── Barra de busca com dropdown de categorias ── */}
      <SearchBar
        cats={cats}
        search={search}
        setSearch={setSearch}
        setSelCat={setSelCat}
      />

      {!search&&(
        <>
          <div className="hero">
            {/* Badge estrelas + botão fidelidade lado a lado */}
            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:12,position:'relative',zIndex:1}}>
              <div className="delivery-badge" style={{marginBottom:0}}>
                <div className="delivery-badge-stars">
                  {[1,2,3,4,5].map(i=>(
                    <svg key={i} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                  ))}
                </div>
                <span className="delivery-badge-text">Delivery Rápido</span>
              </div>
              <button
                onClick={()=>alert('Em breve teremos novidades para nossos clientes mais fiéis! ❤️')}
                style={{
                  display:'inline-flex',alignItems:'center',gap:6,
                  background:loyaltyReward?'#FBBF24':'rgba(255,255,255,.18)',
                  border:'1.5px solid '+(loyaltyReward?'#F59E0B':'rgba(255,255,255,.35)'),
                  color:loyaltyReward?'#78350F':'#fff',
                  borderRadius:999,padding:'5px 14px',
                  fontSize:12,fontWeight:700,cursor:'pointer',
                  fontFamily:'var(--font-body)',letterSpacing:'.2px',
                  transition:'all .2s',whiteSpace:'nowrap',
                }}>
                {loyaltyReward?'🎁 Recompensa disponível!':'🎁 Ganhe presente aqui'}
              </button>
            </div>
            <h1>Açaí & Marmitas<br/>feitos com carinho 💜</h1>
            <p>Um Encanto de Sabores!</p>
          </div>

          {/* ── Categorias: COM "Todos", COM scroll para seção ── */}
          <div className="categories-section">
            <div className="section-title">Categorias</div>
            <div className="categories-scroll">

              {/* ── Todos — primeiro item, volta ao topo ── */}
              <div
                className={`cat-chip ${!selCat?'active':''}`}
                onClick={()=>{
                  setSelCat(null);
                  window.scrollTo({top:0, behavior:'smooth'});
                }}>
                <div className="cat-icon" style={{
                  boxShadow: !selCat ? '0 6px 18px #6B21A840' : undefined,
                  background: !selCat ? '#6B21A8' : '#fff',
                }}>
                  {/* Ícone apps/grid moderno — 4 quadrados iguais */}
                  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="7"  y="7"  width="14" height="14" rx="4"
                      fill={!selCat?'#fff':'#6B21A8'}/>
                    <rect x="27" y="7"  width="14" height="14" rx="4"
                      fill={!selCat?'rgba(255,255,255,.75)':'#7C3AED'}/>
                    <rect x="7"  y="27" width="14" height="14" rx="4"
                      fill={!selCat?'rgba(255,255,255,.75)':'#7C3AED'}/>
                    <rect x="27" y="27" width="14" height="14" rx="4"
                      fill={!selCat?'rgba(255,255,255,.55)':'#A855F7'}/>
                  </svg>
                </div>
                <span className="cat-name" style={{
                  color: !selCat ? 'var(--grape)' : undefined,
                  fontWeight: !selCat ? 700 : undefined,
                }}>Todos</span>
              </div>

              {/* ── Chips por categoria (com scroll) ── */}
              {cats.map(c => {
                const ativo = selCat === c.id;
                const nome  = (c.nome||'').toLowerCase();
                const activeShadow = ativo ? `0 6px 18px ${c.cor||'#6B21A8'}40` : undefined;

                /* Mapeia categoria → id da seção para scroll */
                const secId = (() => {
                  if (nome.includes('combo'))     return 'sec-combos';
                  if (nome.includes('fitness'))   return 'sec-fitness';
                  if (nome.includes('batidinha')) return 'sec-batidinha';
                  if (nome.includes('destaque'))  return 'sec-destaques';
                  if (nome.includes('monte'))     return 'sec-monte';
                  if (nome.includes('pronto'))    return 'sec-prontos';
                  if (nome.includes('marmita'))   return 'sec-marmitas';
                  if (nome.includes('açaí') || nome.includes('acai')) return 'sec-acai';
                  if (nome.includes('bebida'))    return 'sec-bebidas';
                  return null;
                })();

                const handleClick = () => {
                  setSelCat(c.id);
                };

                const icon = (() => {
                  if (nome.includes('combo')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="4" y="33" width="40" height="5" rx="2.5" fill="#D97706"/>
                      <rect x="6" y="31" width="36" height="4" rx="2" fill="#F59E0B"/>
                      <rect x="10" y="21" width="18" height="10" rx="3" fill="#92400E"/>
                      <rect x="9"  y="19" width="20" height="4"  rx="2" fill="#F97316"/>
                      <rect x="10" y="23" width="18" height="2"  rx="1" fill="#FDE68A"/>
                      <ellipse cx="19" cy="19" rx="10" ry="5" fill="#D97706"/>
                      <ellipse cx="19" cy="18" rx="10" ry="5" fill="#F59E0B"/>
                      <ellipse cx="15" cy="16" rx="1.5" ry=".8" fill="#FEF3C7" transform="rotate(-20 15 16)"/>
                      <ellipse cx="20" cy="15" rx="1.5" ry=".8" fill="#FEF3C7" transform="rotate(10 20 15)"/>
                      <ellipse cx="24" cy="17" rx="1.5" ry=".8" fill="#FEF3C7" transform="rotate(-15 24 17)"/>
                      <path d="M32 14 L35 31 H29 Z" fill="#BFDBFE"/>
                      <path d="M32 14 L35 31 H29 Z" fill="#3B82F6" opacity=".35"/>
                      <rect x="29" y="31" width="6" height="2" rx="1" fill="#1D4ED8"/>
                      <rect x="30" y="8"  width="4" height="6" rx="1" fill="#6B7280"/>
                      <rect x="28" y="13" width="8" height="2" rx="1" fill="#9CA3AF"/>
                    </svg>
                  );
                  if (nome.includes('monte')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 12 L16 40 H32 L35 12 Z" fill="#EDE9FE"/>
                      <path d="M16 26 L17 40 H31 L32 26 Z" fill="#5B21B6"/>
                      <ellipse cx="20" cy="25" rx="2.5" ry="1.2" fill="#FDE68A"/>
                      <ellipse cx="25" cy="24" rx="2"   ry="1"   fill="#FDE68A"/>
                      <ellipse cx="29" cy="25" rx="1.8" ry=".9"  fill="#FDE68A"/>
                      <circle cx="19" cy="23" r="2" fill="#EF4444"/>
                      <circle cx="24" cy="22" r="2" fill="#EF4444"/>
                      <circle cx="29" cy="23" r="1.5" fill="#F59E0B"/>
                      <rect x="30" y="6" width="3" height="20" rx="1.5" fill="#F472B6"/>
                      <rect x="11" y="10" width="26" height="4" rx="2" fill="#8B5CF6"/>
                    </svg>
                  );
                  if (nome.includes('pronto') || (nome.includes('copo') && !nome.includes('monte'))) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10 20 L12 42 H36 L38 20 Z" fill="#EDE9FE"/>
                      <path d="M12 30 L13 42 H35 L36 30 Z" fill="#4C1D95"/>
                      <ellipse cx="24" cy="30" rx="10" ry="2.5" fill="#92400E" opacity=".6"/>
                      <rect x="9"  y="16" width="30" height="6" rx="3" fill="#A78BFA"/>
                      <rect x="11" y="17" width="26" height="4" rx="2" fill="#C4B5FD" opacity=".7"/>
                      <rect x="19" y="13" width="10" height="5" rx="2.5" fill="#7C3AED"/>
                      <rect x="11" y="39" width="26" height="3" rx="1.5" fill="#6D28D9"/>
                      <path d="M37 10 Q42 10 42 15 Q42 18 39 19 L38 42" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" fill="none"/>
                      <ellipse cx="39.5" cy="13" rx="3" ry="3.5" fill="#D1D5DB"/>
                    </svg>
                  );
                  if (nome.includes('marmita')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <ellipse cx="24" cy="39" rx="20" ry="4" fill="#E5E7EB"/>
                      <ellipse cx="24" cy="38" rx="20" ry="3" fill="#F3F4F6"/>
                      <ellipse cx="24" cy="32" rx="18" ry="8" fill="#fff" stroke="#E5E7EB" strokeWidth="1.2"/>
                      <ellipse cx="24" cy="32" rx="14" ry="6" fill="#F9FAFB"/>
                      <ellipse cx="17" cy="31" rx="6"   ry="4"   fill="#FEFCE8"/>
                      <ellipse cx="16" cy="31" rx="1.5" ry="1"   fill="#78350F" opacity=".9"/>
                      <ellipse cx="19" cy="32" rx="1.3" ry=".9"  fill="#92400E" opacity=".9"/>
                      <ellipse cx="31" cy="31" rx="7"   ry="5"   fill="#92400E"/>
                      <ellipse cx="30" cy="30" rx="4"   ry="2.5" fill="#B45309"/>
                      <circle cx="24" cy="27" r="2.5" fill="#16A34A"/>
                      <circle cx="22" cy="25" r="2"   fill="#22C55E"/>
                      <circle cx="26" cy="25" r="2"   fill="#16A34A"/>
                      <path d="M6 20 Q6 10 24 10 Q42 10 42 20" stroke="#D1D5DB" strokeWidth="2" fill="#F9FAFB"/>
                      <rect x="20" y="6" width="8" height="5" rx="2.5" fill="#9CA3AF"/>
                    </svg>
                  );
                  if (nome.includes('açaí') || nome.includes('acai')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10 20 L12 42 H36 L38 20 Z" fill="#F3E8FF"/>
                      <path d="M12 30 L14 42 H34 L36 30 Z" fill="#4C1D95"/>
                      <path d="M14 30 Q16 26 18 29 Q20 25 21 28 Q22 24 24 27 Q26 24 27 28 Q28 25 30 29 Q32 26 34 30 Z" fill="#fff" opacity=".9"/>
                      <circle cx="19" cy="27" r="2" fill="#EF4444"/>
                      <circle cx="24" cy="26" r="2" fill="#EF4444"/>
                      <circle cx="29" cy="27" r="1.8" fill="#F59E0B"/>
                      <rect x="31" y="8"  width="3" height="18" rx="1.5" fill="#F472B6"/>
                      <rect x="9"  y="17" width="30" height="5" rx="2.5" fill="#7C3AED"/>
                      <rect x="11" y="39" width="26" height="3" rx="1.5" fill="#6D28D9"/>
                    </svg>
                  );
                  if (nome.includes('bebida')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M11 14 L14 43 H34 L37 14 Z" fill="#E0F2FE"/>
                      <path d="M13 22 L15 43 H33 L35 22 Z" fill="#FED7AA"/>
                      <path d="M13 22 L15 43 H33 L35 22 Z" fill="#F97316" opacity=".35"/>
                      <rect x="15" y="24" width="7" height="6" rx="2" fill="#BAE6FD" opacity=".8"/>
                      <rect x="24" y="27" width="6" height="5" rx="2" fill="#BAE6FD" opacity=".8"/>
                      <rect x="9"  y="11" width="30" height="5" rx="2.5" fill="#0284C7"/>
                      <circle cx="36" cy="13" r="5.5" fill="#FEF08A" stroke="#EAB308" strokeWidth="1"/>
                      <circle cx="36" cy="13" r="3.5" fill="#FDE047"/>
                      <line x1="36" y1="9.5" x2="36" y2="16.5" stroke="#CA8A04" strokeWidth=".7"/>
                      <line x1="32.5" y1="13" x2="39.5" y2="13" stroke="#CA8A04" strokeWidth=".7"/>
                      <rect x="30" y="4" width="3.5" height="22" rx="1.75" fill="#F472B6"/>
                      <rect x="13" y="16" width="3" height="22" rx="1.5" fill="#fff" opacity=".3"/>
                    </svg>
                  );
                  /* ── PEDIDO FITNESS ── */
                  if (nome.includes('fitness')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Haltere profissional */}
                      <rect x="4"  y="20" width="8"  height="8"  rx="3" fill={ativo?'#fff':'#16A34A'} opacity={ativo?1:.9}/>
                      <rect x="36" y="20" width="8"  height="8"  rx="3" fill={ativo?'#fff':'#16A34A'} opacity={ativo?1:.9}/>
                      <rect x="8"  y="22" width="32" height="4"  rx="2" fill={ativo?'rgba(255,255,255,.7)':'#4ADE80'}/>
                      <rect x="12" y="17" width="6"  height="14" rx="2.5" fill={ativo?'#D1FAE5':'#22C55E'}/>
                      <rect x="30" y="17" width="6"  height="14" rx="2.5" fill={ativo?'#D1FAE5':'#22C55E'}/>
                      {/* Folha / saúde */}
                      <path d="M24 8 Q28 4 34 6 Q32 14 24 14 Q16 14 14 6 Q20 4 24 8Z"
                        fill={ativo?'#BBF7D0':'#16A34A'} opacity=".8"/>
                      <path d="M24 8 L24 14" stroke={ativo?'#fff':'#15803D'} strokeWidth="1.5" strokeLinecap="round"/>
                      {/* Coração fitness */}
                      <path d="M22 39 Q20 36 18 37 Q16 38 18 41 L22 45 L26 41 Q28 38 26 37 Q24 36 22 39Z"
                        fill={ativo?'#FCA5A5':'#EF4444'} opacity=".9"/>
                    </svg>
                  );

                  /* ── BATIDINHA DE AÇAÍ ── */
                  if (nome.includes('batidinha')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Copo com shake */}
                      <path d="M12 14 L15 42 H33 L36 14 Z" fill="#EDE9FE"/>
                      <path d="M14 26 L16 42 H32 L34 26 Z" fill="#6B21A8"/>
                      {/* Chantilly/espuma */}
                      <path d="M14 26 Q16 21 18 24 Q20 19 21 23 Q22 18 24 22 Q26 18 27 23 Q28 19 30 24 Q32 21 34 26 Z"
                        fill="#fff" opacity=".95"/>
                      {/* Frutas no topo */}
                      <circle cx="18" cy="20" r="2.5" fill="#EF4444"/>
                      <circle cx="24" cy="18" r="2.5" fill="#EF4444"/>
                      <circle cx="30" cy="20" r="2.5" fill="#F59E0B"/>
                      {/* Canudo */}
                      <rect x="32" y="6" width="3" height="20" rx="1.5" fill="#F472B6"/>
                      {/* Borda superior e base */}
                      <rect x="10" y="12" width="28" height="4" rx="2" fill="#7C3AED"/>
                      <rect x="14" y="39" width="20" height="3" rx="1.5" fill="#6D28D9"/>
                      {/* Brilho */}
                      <rect x="13" y="16" width="3" height="20" rx="1.5" fill="#fff" opacity=".25"/>
                    </svg>
                  );

                  /* ── DESTAQUES ── */
                  if (nome.includes('destaque')) return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Estrela dourada profissional */}
                      <path d="M24 6 L28.5 17.5 H41 L30.5 24.5 L34.5 36 L24 29 L13.5 36 L17.5 24.5 L7 17.5 H19.5 Z"
                        fill={ativo?'#FDE68A':'#FBBF24'} stroke={ativo?'#F59E0B':'#D97706'} strokeWidth="1.2"
                        strokeLinejoin="round"/>
                      {/* Brilhos */}
                      <circle cx="24" cy="21" r="3" fill={ativo?'#FEF9C3':'#FEF3C7'} opacity=".7"/>
                      <circle cx="32" cy="11" r="2" fill="#FEF3C7" opacity=".6"/>
                      <circle cx="16" cy="11" r="1.5" fill="#FEF3C7" opacity=".5"/>
                    </svg>
                  );
                  return (
                    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="24" cy="28" r="14" fill="#F3F4F6" stroke="#E5E7EB" strokeWidth="1.5"/>
                      <ellipse cx="24" cy="29" rx="7" ry="5" fill="#FDE68A"/>
                      <circle cx="21" cy="27" r="2"   fill="#F97316"/>
                      <circle cx="26" cy="29" r="1.5" fill="#EF4444"/>
                    </svg>
                  );
                })();

                return (
                  <div key={c.id}
                    className={`cat-chip ${ativo?'active':''}`}
                    onClick={handleClick}>
                    <div className="cat-icon" style={{boxShadow:activeShadow}}>
                      {icon}
                    </div>
                    <span className="cat-name">{c.nome}</span>
                  </div>
                );
              })}

            </div>
          </div>

          {/* ── CATÁLOGO — ordem 100% controlada por cats (coluna 'ordem' do Supabase) ── */}
          {!selCat&&(loading?<Spinner/>:cats.map(cat=>{
            const nome = (cat.nome||'').toLowerCase();
            const catProds = rawProds.filter(p=>prodInCat(p, cat.id) && p.disponivel!==false);
            if (catProds.length===0) return null;

            /* Estilos especiais por categoria — preservados exatamente como antes */
            let secId   = `sec-${cat.id}`;
            let title   = cat.nome;
            let bannerStyle = {margin:'0 16px 12px',cursor:'default'};
            let sectionStyle = {paddingTop:20,scrollMarginTop:20};
            let displayProds = catProds;

            if (nome.includes('destaque')) {
              secId = 'sec-destaques'; title = 'Destaques';
              sectionStyle = {paddingTop:12,scrollMarginTop:16};
              bannerStyle = {margin:'0 16px 12px',cursor:'default',
                background:'linear-gradient(120deg,#B45309 0%,#D97706 100%)',
                boxShadow:'0 4px 12px rgba(180,83,9,.25)'};
            } else if (nome.includes('combo')) {
              secId = 'sec-combos'; title = 'Combos';
              sectionStyle = {paddingTop:20,scrollMarginTop:20};
            } else if (nome.includes('fitness')) {
              secId = 'sec-fitness'; title = '💪 Pedido Fitness';
              sectionStyle = {paddingTop:20,scrollMarginTop:20};
              bannerStyle = {margin:'0 16px 12px',cursor:'default',
                background:'linear-gradient(120deg,#15803D 0%,#22C55E 100%)',
                boxShadow:'0 4px 12px rgba(21,128,61,.25)'};
            } else if (nome.includes('marmita')) {
              secId = 'sec-marmitas';
            } else if (nome.includes('pronto') || (nome.includes('copo') && !nome.includes('monte'))) {
              secId = 'sec-prontos';
            } else if (nome.includes('monte')) {
              secId = 'sec-monte';
            } else if (nome.includes('batidinha')) {
              secId = 'sec-batidinha';
            } else if (nome.includes('bebida')) {
              secId = 'sec-bebidas';
            }

            return (
              <LazySection key={cat.id} id={secId} style={sectionStyle}>
                <div className="products-section">
                  <div className="promo-banner" style={bannerStyle}>
                    <h3>{title}</h3>
                  </div>
                  <div className="products-grid">
                    {displayProds.map(p=><ProductCard key={p.id} prod={{...p,_catNome:cat.nome}} catNome={cat.nome} onOpen={setModal}/>)}
                  </div>
                </div>
              </LazySection>
            );
          }))}
        </>
      )}

      {/* ── RESULTADOS DE BUSCA ── */}
      {search&&(
        <div className="products-section" style={{paddingTop:20}}>
          <div className="section-title">🔍 Resultados para "{search}"</div>
          {loading?<Spinner/>:prods.length===0?(
            <div className="empty-state"><div className="icon">🔍</div><p>Nenhum produto encontrado</p></div>
          ):(
            <div className="products-grid">
              {prods.map(p=><ProductCard key={p.id} prod={p} catNome={p._catNome} onOpen={setModal}/>)}
            </div>
          )}
        </div>
      )}

      {/* ── FILTRO POR CATEGORIA SELECIONADA ── */}
      {!search&&selCat&&(
        <div className="products-section" style={{paddingTop:8}}>
          {/* Título da categoria + botão voltar */}
          {(()=>{
            const cat = cats.find(c=>c.id===selCat);
            const nome = cat?.nome || '';
            return (
              <div style={{margin:'0 16px 12px',display:'flex',alignItems:'center',gap:10}}>
                <div className="promo-banner" style={{flex:1,margin:0,cursor:'default'}}>
                  <h3>{cat?.icone||'🍽️'} {nome}</h3>
                </div>
                <button
                  onClick={()=>setSelCat(null)}
                  style={{
                    flexShrink:0,padding:'8px 14px',borderRadius:10,
                    background:'var(--gray-100)',color:'var(--gray-600)',
                    fontSize:13,fontWeight:700,border:'none',cursor:'pointer',
                    fontFamily:'var(--font-body)',whiteSpace:'nowrap',
                  }}>
                  ← Todos
                </button>
              </div>
            );
          })()}
          {loading?<Spinner/>:prods.length===0?(
            <div className="empty-state"><div className="icon">🔍</div><p>Nenhum produto encontrado</p></div>
          ):(
            <div className="products-grid">
              {prods.map(p=><ProductCard key={p.id} prod={p} catNome={p._catNome} onOpen={setModal}/>)}
            </div>
          )}
        </div>
      )}

      <div style={{padding:'32px 16px',textAlign:'center',color:'var(--gray-400)',fontSize:13}}>
        <p>✨ Encanto – Açaí & Marmitas</p>
        <p style={{marginTop:4}}>📱 (38) 99220-3620</p>
      </div>
      </div>{/* /app-content */}

      {/* ── Modal de Seleção de Endereço ── */}
      {showAddressModal && (
        <AddressModal
          onClose={()=>setShowAddressModal(false)}
          onSelect={(addr, meta)=>{
            setDeliveryAddress(addr);
            localStorage.setItem('encanto_delivery_address', addr);
            if (meta && meta.lat) {
              localStorage.setItem('encanto_delivery_meta', JSON.stringify(meta));
            }
            setShowAddressModal(false);
          }}
        />
      )}

      {/* ── Modal Programa de Fidelidade ── */}
      {showLoyalty&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowLoyalty(false)}>
          <div className="modal" style={{maxWidth:440,maxHeight:'92vh',overflowY:'auto'}}>

            {/* Cabeçalho roxo */}
            <div style={{
              background:'linear-gradient(135deg,#6B21A8,#7C3AED)',
              padding:'28px 24px 22px',textAlign:'center',
              borderRadius:'var(--radius-xl) var(--radius-xl) 0 0',position:'relative',
            }}>
              <div style={{fontSize:48,marginBottom:8,lineHeight:1}}>🎁</div>
              <h2 style={{
                color:'#fff',fontFamily:'var(--font-head)',fontSize:22,
                fontWeight:800,margin:0,letterSpacing:'.5px',textTransform:'uppercase',
              }}>
                Programa de Fidelidade
              </h2>
              <p style={{color:'rgba(255,255,255,.8)',fontSize:14,marginTop:8,lineHeight:1.5}}>
                A cada {loyaltyConfig.required} pedidos você ganha {loyaltyConfig.discount}% de desconto no próximo pedido.
              </p>
            </div>

            {/* Corpo */}
            <div style={{padding:'24px 24px 8px'}}>

              {/* ── Estado: RECOMPENSA DISPONÍVEL ── */}
              {loyaltyReward ? (
                <div style={{textAlign:'center',padding:'8px 0 16px'}}>
                  <div style={{fontSize:52,marginBottom:12}}>🎉</div>
                  <h3 style={{
                    fontFamily:'var(--font-head)',fontSize:22,fontWeight:800,
                    color:'#15803D',marginBottom:12,
                  }}>Parabéns!</h3>
                  <div style={{
                    background:'#F0FDF4',border:'1.5px solid #BBF7D0',
                    borderRadius:14,padding:'16px 20px',marginBottom:20,
                  }}>
                    <p style={{fontSize:15,color:'#15803D',fontWeight:700,marginBottom:4}}>
                      Você ganhou {loyaltyConfig.discount}% de desconto no próximo pedido!
                    </p>
                    <p style={{fontSize:13,color:'#166534',lineHeight:1.5}}>
                      Informe ao atendente no momento da finalização do pedido.
                      O resgate somente poderá ser feito pelo próprio participante.
                    </p>
                  </div>
                  <button
                    onClick={()=>{
                      /* Zerar: order_count=0, reward_available=false, reward_used=true */
                      setLoyaltyCount(0);
                      localStorage.setItem('encanto_loyalty_count','0');
                      localStorage.setItem('encanto_loyalty_reward_used','true');
                      setShowLoyalty(false);
                    }}
                    style={{
                      padding:'13px 32px',borderRadius:12,border:'none',
                      background:'linear-gradient(135deg,#16A34A,#15803D)',
                      color:'#fff',fontWeight:700,fontSize:15,cursor:'pointer',
                      fontFamily:'var(--font-body)',boxShadow:'0 4px 16px rgba(22,163,74,.3)',
                    }}>
                    ✅ Usar desconto agora
                  </button>
                </div>
              ) : (
                <>
                  {/* Progresso: X de Y pedidos */}
                  <div style={{
                    background:'var(--grape-pale)',borderRadius:14,
                    padding:'18px 20px',textAlign:'center',marginBottom:20,
                  }}>
                    <div style={{fontSize:13,color:'var(--amarelo)',fontWeight:600,marginBottom:6}}>
                      Você já realizou:
                    </div>
                    <div style={{display:'flex',alignItems:'baseline',justifyContent:'center',gap:4}}>
                      <span style={{
                        fontFamily:'var(--font-head)',fontSize:44,fontWeight:800,color:'var(--amarelo)',lineHeight:1,
                      }}>{loyaltyCount}</span>
                      <span style={{fontSize:20,color:'var(--gray-400)',fontWeight:500}}>
                        de {loyaltyConfig.required} pedidos
                      </span>
                    </div>
                    <p style={{fontSize:13,color:'var(--gray-500)',marginTop:8}}>
                      {loyaltyConfig.required - loyaltyCount === 1
                        ? 'Falta apenas 1 pedido para ganhar seu desconto!'
                        : `Faltam ${loyaltyConfig.required - loyaltyCount} pedidos para ganhar ${loyaltyConfig.discount}% de desconto`
                      }
                    </p>
                  </div>

                  {/* Barra de progresso */}
                  <div style={{marginBottom:6}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--gray-400)',marginBottom:6}}>
                      <span>Progresso</span>
                      <span>{Math.round((loyaltyCount/loyaltyConfig.required)*100)}%</span>
                    </div>
                    <div style={{
                      width:'100%',height:14,background:'var(--gray-100)',
                      borderRadius:7,overflow:'hidden',
                    }}>
                      <div style={{
                        height:'100%',borderRadius:7,
                        width:`${Math.min(100,(loyaltyCount/loyaltyConfig.required)*100)}%`,
                        background:'linear-gradient(90deg,#A62786,#C8D82B)',
                        transition:'width .5s ease',
                      }}/>
                    </div>
                  </div>

                  {/* Grade de pedidos */}
                  <div style={{
                    display:'flex',gap:6,flexWrap:'wrap',
                    justifyContent:'center',margin:'20px 0 8px',
                  }}>
                    {Array.from({length:loyaltyConfig.required}).map((_,i)=>(
                      <div key={i} title={i<loyaltyCount?`Pedido ${i+1} concluído`:`Pedido ${i+1}`}
                        style={{
                          width:36,height:36,borderRadius:10,
                          background: i<loyaltyCount
                            ? 'linear-gradient(135deg,#6B21A8,#A855F7)'
                            : 'var(--gray-100)',
                          border: i<loyaltyCount ? 'none' : '1.5px solid var(--gray-200)',
                          display:'flex',alignItems:'center',justifyContent:'center',
                          fontSize:16,transition:'all .2s',
                          boxShadow: i<loyaltyCount ? '0 2px 8px rgba(107,33,168,.3)' : 'none',
                        }}>
                        {i<loyaltyCount ? '🛍️' : <span style={{color:'var(--gray-300)',fontSize:18}}>○</span>}
                      </div>
                    ))}
                  </div>
                  <p style={{fontSize:11,color:'var(--gray-400)',textAlign:'center',marginBottom:4}}>
                    Somente pedidos aprovados ou finalizados pela loja são contabilizados.
                  </p>
                </>
              )}
            </div>

            {/* Regulamento */}
            <div style={{
              margin:'0 24px',padding:'16px',
              background:'var(--gray-50)',borderRadius:12,
              border:'1px solid var(--gray-100)',
            }}>
              <p style={{
                fontSize:12,fontWeight:700,color:'var(--gray-700)',
                marginBottom:10,textTransform:'uppercase',letterSpacing:'.5px',
              }}>
                📋 Regras do Programa
              </p>
              {[
                'Peça 10 vezes e ganhe 50% de desconto no próximo pedido.',
                'O pedido só contabiliza após ser aprovado ou finalizado pela loja.',
                'O valor do frete não é contabilizado — somente os products.',
                'Após o resgate, a pontuação é zerada e o acúmulo reinicia.',
                'As recompensas não são cumulativas — apenas 1 por ciclo.',
                'A mecânica do programa pode ser alterada a qualquer momento pela loja.',
              ].map((r,i)=>(
                <div key={i} style={{
                  display:'flex',gap:8,marginBottom:i<5?8:0,
                  fontSize:12,color:'var(--gray-600)',lineHeight:1.5,
                }}>
                  <span style={{color:'var(--amarelo)',fontWeight:700,flexShrink:0}}>{i+1}.</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>

            {/* Rodapé */}
            <div style={{padding:'16px 24px 24px',textAlign:'center'}}>
              <p style={{fontSize:12,color:'var(--gray-400)',marginBottom:12}}>
                Ainda precisa de ajuda?{' '}
                <a
                  href={`https://wa.me/5538992203620`}
                  target="_blank"
                  style={{color:'var(--amarelo)',fontWeight:600,textDecoration:'underline'}}>
                  Entre em contato com a gente
                </a>
              </p>
              <button
                onClick={()=>setShowLoyalty(false)}
                style={{
                  padding:'10px 32px',borderRadius:10,
                  border:'1.5px solid var(--gray-200)',
                  background:'var(--white)',color:'var(--gray-500)',
                  fontSize:14,fontWeight:600,cursor:'pointer',
                  fontFamily:'var(--font-body)',
                }}>
                Fechar
              </button>
            </div>

          </div>
        </div>
      )}

      {modal&&(
        <ProductModal
          prod={modal}
          catNome={(modal._catNome)||''}
          adicionais={resolverAdicionais(selecionarFonteAdicionais(modal, adicionais), modal)}
          onClose={()=>setModal(null)}
          onAdd={(p,q,a,o)=>{ cart.add(p,q,a,o); }}
          onSuggest={()=>{
            setModal(null);
            requestAnimationFrame(()=>{
              const el=document.getElementById('sec-bebidas');
              if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
            });
          }}
        />
      )}

      {cartOpen&&(
        <CartSidebar
          cart={cart} catMap={catMap}
          onClose={()=>setCartOpen(false)}
          onCheckout={()=>{setCartOpen(false);setPage('checkout');}}
        />
      )}

      {/* Carrinho inferior (desktop) + botão flutuante (mobile) */}
      {cart.count>0 && !cartOpen && (
        <>
          {/* Desktop: barra inferior completa */}
          <div className="cart-sticky-bar">
            <div className="cart-sticky-info">
              <div className="qty">{cart.count} {cart.count===1?'item':'itens'} no carrinho</div>
              <div className="val">{fmt(cart.total)}</div>
            </div>
            <button className="cart-sticky-btn" onClick={()=>setCartOpen(true)}>
              Ver carrinho →
            </button>
          </div>
          {/* Mobile: botão flutuante lateral (canto esquerdo) */}
          <button
            className="cart-float-mobile"
            onClick={()=>setCartOpen(true)}
            aria-label={`Carrinho — ${cart.count} ${cart.count===1?'item':'itens'}`}
            style={{display:'none'}} /* CSS mobile sobrescreve com display:flex */
          >
            <span className="cfi">🛒</span>
            <span className="cfq">{cart.count}</span>
          </button>
        </>
      )}

      {/* ── ALT 7: Botão WhatsApp flutuante ── */}
      <a
        href={`https://wa.me/${WHATSAPP}`}
        target="_blank"
        className="wa-float"
        title="Fale conosco pelo WhatsApp">
        <span className="wa-float-icon">💬</span>
        <div className="wa-float-text">
          <span className="l1">Precisa de ajuda?</span>
          <span className="l2">Fale conosco</span>
        </div>
      </a>

    </div>
  );
}

/* ── Root ────────────────────────────────────────────────────── */
function App() {
  const [mode, setMode] = useState(()=>{
    /* Acesso por hash #admin-encanto */
    if (typeof window !== 'undefined' && window.location.hash === '#admin-encanto') {
      window.history.replaceState(null,'',window.location.pathname);
      return 'login';
    }
    return 'store';
  });
  const [, setAdmin] = useState(null);

  let content;
  if (mode==='login')      content = <AdminLogin onLogin={u=>{setAdmin(u);setMode('admin');}}/>;
  else if (mode==='admin') content = <AdminPanel onExit={()=>{setMode('store');setAdmin(null);}}/>;
  else                     content = <StoreApp onAdmin={()=>setMode('login')}/>;

  /* AppShell envolve TUDO: BackgroundLayer (fundo único, loja + admin) + camada de conteúdo. */
  return (
    <AppShell>
      {content}
    </AppShell>
  );
}

export default App;
