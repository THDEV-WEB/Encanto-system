/* constants/storeInfo.js — informacoes institucionais da loja AINDA ESTATICAS (LOGIN-ARCH-02).
   Fonte UNICA p/ Sobre/Termos/Redes/Endereco — nada de hardcode espalhado. Editar aqui no futuro.
   REF-COMPANY-01: nome/telefone/whatsapp/e-mail MIGRARAM para settings.company_info (Supabase,
   administravel pelo Admin) — ver hooks/useCompanyInfo.js. Os campos abaixo (endereco/social) sao os
   PROXIMOS candidatos naturais a essa mesma migracao (arquitetura ja preparada: e so estender o objeto
   company_info e o form do Admin, sem mudanca de RPC/tabela).
   Camada de constantes: sem imports (regra D2 do test:deps trivialmente satisfeita). */
export const STORE_INFO = {
  cidade: 'Timbó',
  endereco: {                            // estrutura preparada (preencher no futuro)
    linha1: 'Rua João Schley, 77',
    linha2: 'Casa 02',
    cidade: 'Timbó',
    preparado: true,
  },
  /* REF-CHECKOUT-ADDRESS-01: endereco de RETIRADA na loja (fonte unica — usado no header e no checkout). */
  retirada: 'Rua João Schley, 77 Casa 02',
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
