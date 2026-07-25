/* utils/addonGroupLabels.js — REF-REGRESSION-01 · P6 (centralização).
   Fonte ÚNICA de emoji/nome canônico por GRUPO de adicional. utils/addons.js define os grupos
   (GRUPOS) mas é uma PROIBIDO conter UI/emoji/rótulo por regra própria daquele arquivo (ver seu
   cabeçalho: "SEM SAÍDA VISUAL... o rótulo/emoji vivem na UI") — mesma separação já usada em
   utils/catalog.js (CAT_EMOJI/catEmoji: emoji por categoria, também fora do domínio de pricing).

   ACHADO (REF-REGRESSION-01 · auditoria de Adicionais "duplicados"): 3 componentes
   (AdminAdicionais.jsx, AdminProducts.jsx, ProductModal/ProductModalInner.jsx) mantinham CADA UM
   sua própria cópia local do mapa grupo→emoji/nome — a de AdminAdicionais estava desatualizada
   (só reconhecia 3 dos 7 grupos reais, colapsando simples/premium/frutas_premium/chocolates no
   mesmo rótulo "🍇 Açaí" — a causa raiz da falsa percepção de "adicionais duplicados" no Admin).
   3 cópias = 3 chances de ficarem desalinhadas. Este módulo é a ÚNICA fonte de emoji+nome; um
   grupo novo passa a existir em UM lugar só (aqui). Cada consumidor continua livre para compor SUA
   PRÓPRIA frase final (ex.: "Adicionais do Açaí" vs "Açaí" vs "Complementos" no papel da comanda)
   — o que é preservado aqui é só a identidade emoji+nome, não a frase inteira de cada tela. */
import { GRUPOS } from './addons.js';

export const GRUPO_INFO = Object.freeze({
  [GRUPOS.ACAI]:           { emoji: '🍇', nome: 'Açaí' },
  [GRUPOS.MARMITA]:        { emoji: '🍱', nome: 'Marmita' },
  [GRUPOS.BEBIDA]:         { emoji: '🧃', nome: 'Bebida' },
  [GRUPOS.SIMPLES]:        { emoji: '🥄', nome: 'Simples' },
  [GRUPOS.PREMIUM]:        { emoji: '⭐', nome: 'Premium' },
  [GRUPOS.FRUTAS_PREMIUM]: { emoji: '🍓', nome: 'Frutas Premium' },
  [GRUPOS.CHOCOLATES]:     { emoji: '🍫', nome: 'Chocolates' },
});

/* Rótulo simples "emoji + nome" (ex.: "🍇 Açaí") — para onde não há composição de frase (badge da
   listagem, <option> de <select>). Grupo desconhecido (futuro, ainda sem entrada aqui) nunca
   quebra: devolve o próprio texto cru, capitalizado. */
export const grupoLabel = (grupo) => {
  const info = GRUPO_INFO[grupo];
  if (info) return `${info.emoji} ${info.nome}`;
  return String(grupo || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};
