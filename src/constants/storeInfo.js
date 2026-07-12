/* constants/storeInfo.js — informacoes institucionais da loja (LOGIN-ARCH-02).
   Fonte UNICA p/ Contato/Sobre/Termos/Redes — nada de hardcode espalhado. Editar aqui no futuro.
   Camada de constantes: sem imports (regra D2 do test:deps trivialmente satisfeita). */
export const STORE_INFO = {
  nome: 'Encanto — Açaí & Marmitas',
  cidade: 'Timbó',
  telefoneDisplay: '(38) 99220-3620',
  telefoneDigits: '5538992203620',      // usado em tel:/wa.me
  email: 'contato@encantoacai.com.br',  // placeholder — ajustar
  endereco: {                            // estrutura preparada (preencher no futuro)
    linha1: '',
    linha2: '',
    cidade: 'Timbó',
    preparado: true,
  },
  social: {
    instagram: 'https://instagram.com/',  // placeholder — ajustar URL
    facebook:  'https://facebook.com/',   // placeholder — ajustar URL
  },
};

/* Texto institucional — estrutura preparada para edicao futura (nao hardcode espalhado). */
export const SOBRE_TEXTO = [
  'O Encanto nasceu para levar açaí cremoso, marmitas caseiras e sabores de verdade até a sua casa, em Timbó e região.',
  'Trabalhamos com ingredientes selecionados, montagem na hora e entrega rápida — do jeitinho que você gosta.',
  'Nosso compromisso é simples: um Encanto de sabores em cada pedido.',
];

/* Termos e Políticas — placeholder organizado; substituir pelo conteúdo definitivo. */
export const TERMOS_SECOES = [
  { titulo: 'Uso do serviço', corpo: 'Ao realizar um pedido você concorda com as condições de compra, prazos de entrega e formas de pagamento informadas no checkout.' },
  { titulo: 'Privacidade', corpo: 'Coletamos apenas os dados necessários para processar o seu pedido (nome, contato e endereço). Não compartilhamos seus dados com terceiros sem necessidade operacional.' },
  { titulo: 'Cancelamento e trocas', corpo: 'Pedidos em preparo podem ter regras específicas de cancelamento. Em caso de problemas, fale conosco pelo WhatsApp.' },
  { titulo: 'Contato', corpo: 'Dúvidas sobre estes termos podem ser tratadas pelos nossos canais de contato.' },
];

/* Programa de fidelidade — texto explicativo (a mecânica vive no checkout/loja; aqui é só a descrição). */
export const FIDELIDADE_TEXTO = [
  'A cada pedido você acumula um selo no seu cartão de fidelidade.',
  'Ao completar a cartela, você ganha um benefício especial no próximo pedido.',
  'Entre na sua conta para acompanhar seus selos em qualquer dispositivo (em breve).',
];
