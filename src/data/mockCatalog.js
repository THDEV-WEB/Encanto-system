/* data/mockCatalog.js — catálogo-sombra de fallback (REF-APP-01 · Onda 1, move puro do App.jsx).
   MOCK_CATS + MOCK_PRODS (usados quando o Supabase está offline/vazio) e filterMock.
   Camada de dados: importa só prodInCat (utils/catalog.js); NÃO importa pricing/addons/format (regra D2). */
import { prodInCat } from '../utils/catalog.js';

export const MOCK_CATS = [
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
  {id:'c4',  nome:'Copos Prontos',        icone:'🥤',cor:'#3B82F6',ordem:3, ativo:true},
  {id:'c3', nome:'Monte seu Copo',       icone:'🍇',cor:'#7C3AED',ordem:4, ativo:true},
  {id:'c9', nome:'Batidinhas',           icone:'🥤',cor:'#7C3AED',ordem:5, ativo:true},
  {id:'c1',  nome:'Combos',               icone:'🎁',cor:'#6B21A8',ordem:6, ativo:true},
  {id:'c10', nome:'Pedido Fitness',       icone:'💪',cor:'#16A34A',ordem:7, ativo:true},
  {id:'c7',  nome:'Bebidas',              icone:'🧃',cor:'#0891B2',ordem:8, ativo:true},
];
export const MOCK_PRODS = [
  /* Combos (antes "Combo Marmitex + Açaí") */
  /* ══ Combos (c1) ══ */
  {id:'p1', nome:'Marmita P + Açaí 300ml',            descricao:'Com 3 adicionais grátis',    preco:29.90,preco_promo:null,categoria_id:'c1',imagem_url:'',disponivel:true,adicionais_gratis:3,grupos_ad:['marmita','acai'],upsell_bebida:true},
  {id:'p2', nome:'Marmita G 2 proteínas + Açaí 500ml',descricao:'Com 4 adicionais grátis',   preco:49.90,preco_promo:null,categoria_id:'c1',imagem_url:'',disponivel:true,adicionais_gratis:4,grupos_ad:['marmita','acai'],upsell_bebida:true},
  {id:'p3', nome:'Marmita P + Batidinha de Açaí 300ml',descricao:'Combinação perfeita',      preco:49.90,preco_promo:null,categoria_id:'c1',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:['marmita'],upsell_bebida:true},
  /* ══ Destaques (c8) ══ */
  {id:'pd1',nome:'Marmita Média + Açaí 300 ml',  descricao:'3 adicionais grátis',          preco:29.90,preco_promo:null,categoria_id:'c8',categoria_ids:['c8','c1'],imagem_url:'https://hvbcdxsagkjtfjwvnslo.supabase.co/storage/v1/object/public/products/marmita-media-com-acai-300-ml.png',disponivel:true,adicionais_gratis:3,destaque:true,badge:'mais_vendido',grupos_ad:['marmita','acai'],upsell_bebida:true},
  {id:'pd2',nome:'Açaí 500 ml',                   descricao:'4 adicionais grátis',          preco:15.99,preco_promo:null,categoria_id:'c8',imagem_url:'',disponivel:true,adicionais_gratis:4,destaque:true,badge:'favorito',grupos_ad:['acai'],upsell_bebida:true},
  {id:'pd3',nome:'Marmita + Suco Natural',         descricao:'Escolha o suco: Maracujá, Goiaba ou Abacaxi',preco:29.90,preco_promo:null,categoria_id:'c8',imagem_url:'',disponivel:true,adicionais_gratis:3,destaque:true,grupos_ad:['marmita'],upsell_bebida:false,variantes:['Maracujá','Goiaba','Abacaxi']},
  {id:'pd4',nome:'Açaí 700 ml especial',           descricao:'Produto premium — 4 adicionais grátis',preco:25.99,preco_promo:null,categoria_id:'c8',imagem_url:'',disponivel:true,adicionais_gratis:4,destaque:true,badge:'novo',grupos_ad:['acai'],upsell_bebida:true},
  /* ══ Copos Prontos (c4) — apenas produtos prontos de açaí ══ */
  {id:'pa1',nome:'Encanto Mineiro',   descricao:'Açaí com banana, granola e leite condensado', preco:19.90,preco_promo:null,categoria_id:'c4',imagem_url:'',disponivel:true,adicionais_gratis:0,subgrupo:'pronto'},
  {id:'pa2',nome:'Encanto Clássico',  descricao:'Açaí cremoso • Banana • Leite em Pó • Leite Condensado',       preco:24.99,preco_promo:null,categoria_id:'c4',imagem_url:'https://hvbcdxsagkjtfjwvnslo.supabase.co/storage/v1/object/public/products/encanto-classico.png',disponivel:true,adicionais_gratis:0,subgrupo:'pronto'},
  {id:'pa3',nome:'Encanto Fit',       descricao:'Açaí Zero Açúcar • Banana • Granola • Leite Condensado Zero',              preco:32.99,preco_promo:null,categoria_id:'c4',imagem_url:'https://hvbcdxsagkjtfjwvnslo.supabase.co/storage/v1/object/public/products/acai-fit.png',disponivel:true,adicionais_gratis:0,subgrupo:'pronto'},
  {id:'pa4',nome:'Encanto Casadinho', descricao:'Açaí cremoso • Cupuaçu • Morango • Leite Condensado • Leite em Pó',         preco:32.99,preco_promo:null,categoria_id:'c4',imagem_url:'https://hvbcdxsagkjtfjwvnslo.supabase.co/storage/v1/object/public/products/encanto-casadinho.png',disponivel:true,adicionais_gratis:0,subgrupo:'pronto'},
  {id:'pa5',nome:'Encanto Tropical',  descricao:'Açaí cremoso • Morango • Kiwi • Uva Verde',              preco:32.99,preco_promo:null,categoria_id:'c4',imagem_url:'https://hvbcdxsagkjtfjwvnslo.supabase.co/storage/v1/object/public/products/encanto-tropical.png',disponivel:true,adicionais_gratis:0,subgrupo:'pronto'},
  /* ══ Batidinhas (c9) ══ */
  /* Modelo antigo (genérico, mantido apenas como fallback — não exibido se modelo novo existir) */
  {id:'pb_old1',nome:'Batidinha de Açaí 300 ml', descricao:'Batidinha cremosa de açaí',preco:19.90,preco_promo:null,categoria_id:'c9',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,subgrupo:'batidinha'},
  {id:'pb_old2',nome:'Batidinha de Açaí 500 ml', descricao:'Batidinha cremosa de açaí',preco:29.90,preco_promo:null,categoria_id:'c9',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,subgrupo:'batidinha'},
  /* Modelo novo — 1 produto por sabor, tamanho escolhido no modal */
  {id:'pb1',nome:'Tradicional',      descricao:'Batidinha cremosa com leite condensado e leite em pó.',                    preco:18.00,preco_promo:null,categoria_id:'c9',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,badge:'mais_vendido',subgrupo:'batidinha',
    tamanhos:[{label:'300 ml',preco:18.00},{label:'500 ml',preco:23.00}]},
  {id:'pb2',nome:'Maracujá',         descricao:'Batidinha cremosa com saboroso mousse de maracujá.',               preco:18.00,preco_promo:null,categoria_id:'c9',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,subgrupo:'batidinha',
    tamanhos:[{label:'300 ml',preco:18.00},{label:'500 ml',preco:23.00}]},
  {id:'pb3',nome:'Creme de Leitinho',descricao:'Batidinha cremosa com delicioso creme de leitinho.',      preco:22.00,preco_promo:null,categoria_id:'c9',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,subgrupo:'batidinha',
    tamanhos:[{label:'300 ml',preco:22.00},{label:'500 ml',preco:28.00}]},
  {id:'pb4',nome:'Nutella',          descricao:'Batidinha cremosa com Nutella.',                preco:22.00,preco_promo:null,categoria_id:'c9',imagem_url:'',disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,subgrupo:'batidinha',
    tamanhos:[{label:'300 ml',preco:22.00},{label:'500 ml',preco:28.00}]},
  /* ══ Monte seu Copo (c3) — modelo novo: 1 produto por base, tamanho escolhido no modal ══
     Mesma arquitetura/engine das Batidinhas: cada base é um produto independente com seu
     próprio array `tamanhos` (preço + adicionais grátis por tamanho). O preço por tamanho
     é o mesmo para as 5 bases nesta etapa ("ainda não alterar preços premium") — se algum
     dia uma base precisar de preço diferenciado, basta sobrescrever o `tamanhos` daquele
     produto; nenhuma mudança de código é necessária, pois a engine (ProductCard/Modal/
     carrinho) já é 100% genérica sobre esse array. */
  {id:'pmc1',nome:'Açaí',               descricao:'Monte do seu jeito com os acompanhamentos da sua preferência.',  preco:17.99,preco_promo:null,categoria_id:'c3',imagem_url:'',disponivel:true,adicionais_gratis:2,subgrupo:'monte',
    tamanhos:[{label:'300 ml',preco:17.99,adicionais_gratis:2},{label:'500 ml',preco:26.99,adicionais_gratis:3},{label:'700 ml',preco:35.99,adicionais_gratis:4}]},
  {id:'pmc2',nome:'Cupuaçu',            descricao:'Monte do seu jeito com o delicioso creme de cupuaçu e seus acompanhamentos preferidos.',    preco:17.99,preco_promo:null,categoria_id:'c3',imagem_url:'',disponivel:true,adicionais_gratis:2,subgrupo:'monte',
    tamanhos:[{label:'300 ml',preco:17.99,adicionais_gratis:2},{label:'500 ml',preco:26.99,adicionais_gratis:3},{label:'700 ml',preco:35.99,adicionais_gratis:4}]},
  {id:'pmc3',nome:'Açaí + Cupuaçu',     descricao:'Monte do seu jeito com a mistura de açaí e cupuaçu e seus acompanhamentos.',  preco:17.99,preco_promo:null,categoria_id:'c3',imagem_url:'',disponivel:true,adicionais_gratis:2,subgrupo:'monte',
    tamanhos:[{label:'300 ml',preco:17.99,adicionais_gratis:2},{label:'500 ml',preco:26.99,adicionais_gratis:3},{label:'700 ml',preco:35.99,adicionais_gratis:4}]},
  {id:'pmc4',nome:'Açaí 0 Açúcar',      descricao:'Opção sem adição de açúcar para quem busca uma escolha mais leve.',  preco:17.99,preco_promo:null,categoria_id:'c3',imagem_url:'',disponivel:true,adicionais_gratis:2,subgrupo:'monte',
    tamanhos:[{label:'300 ml',preco:17.99,adicionais_gratis:2},{label:'500 ml',preco:26.99,adicionais_gratis:3},{label:'700 ml',preco:35.99,adicionais_gratis:4}]},
  {id:'pmc5',nome:'Mousse de Maracujá', descricao:'Monte do seu jeito com uma deliciosa base de mousse de maracujá.', preco:17.99,preco_promo:null,categoria_id:'c3',imagem_url:'',disponivel:true,adicionais_gratis:2,subgrupo:'monte',
    tamanhos:[{label:'300 ml',preco:17.99,adicionais_gratis:2},{label:'500 ml',preco:26.99,adicionais_gratis:3},{label:'700 ml',preco:35.99,adicionais_gratis:4}]},
  /* Cardápio de Marmitas — Tradicional do Dia (P/M/G fixos, composição via descrição) */
  {id:'p9', nome:'Marmita P',  descricao:'Arroz • Feijão • Acompanhamento do dia • Salada\r\n\r\nProteínas do dia:\r\n\r\nFrango Assado • Almôndegas ao Molho',  preco:15.99,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:true,adicionais_gratis:0},
  {id:'p10',nome:'Marmita M',  descricao:'Arroz • Feijão • Acompanhamento do dia • Salada\r\n\r\nProteínas do dia:\r\n\r\nFrango Assado • Almôndegas ao Molho',  preco:19.99,preco_promo:null,categoria_id:'c5',imagem_url:'https://hvbcdxsagkjtfjwvnslo.supabase.co/storage/v1/object/public/products/marmita-media.png',disponivel:true,adicionais_gratis:0},
  {id:'p10g',nome:'Marmita G', descricao:'Arroz • Feijão • Acompanhamento do dia • Salada\r\n\r\nProteínas do dia:\r\n\r\nFrango Assado • Almôndegas ao Molho',  preco:25.99,preco_promo:null,categoria_id:'c5',imagem_url:'https://hvbcdxsagkjtfjwvnslo.supabase.co/storage/v1/object/public/products/marmita-grande.png',disponivel:true,adicionais_gratis:0},
  /* Cardápio de Marmitas — Pratos Especiais do Dia (ativar/desativar via painel admin) */
  {id:'pe1',nome:'Parmegiana',       descricao:'Filé empanado coberto com molho e queijo, acompanha arroz e fritas', preco:32.90,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:true,adicionais_gratis:0},
  {id:'pe2',nome:'Strogonoff',       descricao:'Strogonoff cremoso, acompanha arroz e batata palha',                  preco:29.90,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:false,adicionais_gratis:0},
  {id:'pe3',nome:'Costelinha Barbecue', descricao:'Costelinha suína ao barbecue, acompanha arroz e farofa',           preco:34.90,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:true,adicionais_gratis:0},
  {id:'pe4',nome:'Feijoada',         descricao:'Feijoada completa com acompanhamentos tradicionais',                  preco:36.90,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:false,adicionais_gratis:0},
  {id:'pe5',nome:'Lasanha',          descricao:'Lasanha à bolonhesa gratinada',                                        preco:28.90,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:true,adicionais_gratis:0},
  {id:'pe6',nome:'Filé de Tilápia',  descricao:'Filé de tilápia grelhado, acompanha arroz e legumes',                 preco:33.90,preco_promo:null,categoria_id:'c5',imagem_url:'',disponivel:true,adicionais_gratis:0},
  /* Pedido Fitness (c10) */
  {id:'pf1',nome:'Marmita Fitness Personalizada',
    descricao:'Tamanho M — até 2 proteínas, arroz, feijão e legumes. Personalize nas observações.',
    preco:19.90,preco_promo:null,categoria_id:'c10',imagem_url:'https://hvbcdxsagkjtfjwvnslo.supabase.co/storage/v1/object/public/products/marmita-fitness-personalizada.png',disponivel:true,
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
    descricao:'Água de coco natural, refrescante',preco:10.00,preco_promo:null,
    categoria_id:'c7',
    imagem_url:'https://images.unsplash.com/photo-1559181567-c3190e573b5e?w=400&q=80&auto=format&fm=webp&fit=crop',
    disponivel:true,adicionais_gratis:0,grupos_ad:[],upsell_bebida:false,
    destaque:true},
  {id:'p15',nome:'Água Mineral 500ml',
    descricao:'Gelada, 500ml',preco:3.00,preco_promo:null,categoria_id:'c7',
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

export function filterMock(catId, search) {
  let m = [...MOCK_PRODS];
  if (catId)  m = m.filter(p => prodInCat(p, catId));
  if (search) m = m.filter(p => p.nome.toLowerCase().includes((search||'').toLowerCase()));
  return m;
}
