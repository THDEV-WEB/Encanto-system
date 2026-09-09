/* constants/privacyPolicy.js — REF-LGPD-01 · Onda 1 · LGPD-R02.
   Conteudo FACTUAL da Politica de Privacidade tecnica da plataforma Encanto/VALION SISTEMAS -- gerado a
   partir do inventario real de dados/terceiros levantado pela auditoria REF-LGPD-01 (2026-08-19), NAO um
   texto generico. Descreve o funcionamento REAL do sistema (dados coletados, finalidades, terceiros),
   verificado em codigo/migrations no momento da auditoria.

   DIFERENTE de company_info.termosSecoes (editavel livremente por cada loja, ver AdminEmpresa.jsx): este
   modulo e' FIXO e nao editavel pelo Admin, porque descreve o comportamento TECNICO da plataforma, que e'
   igual pra todas as lojas (mesma stack, mesmos terceiros) -- so a identidade/contato da loja muda, e
   essa parte fica com a tela "Contato" (ja existente), nunca duplicada aqui.

   IMPORTANTE (regra da REF-LGPD-01, secao 13 do prompt de execucao): este documento NAO declara
   conformidade juridica, NAO inventa base legal, NAO inventa prazo de retencao. Itens que dependem de
   interpretacao juridica estao marcados explicitamente como pendentes de validacao juridica/DPO -- ver
   a secao final ("aviso"). Zero IO (sem Supabase/window) -- mesmo padrao puro de companyInfoRules.js.

   v1.1 (2026-08-23, Plano de Fechamento REF-LGPD-01, Fase 1): corrige "Seus direitos hoje" -- o texto
   ainda dizia que exclusao/portabilidade estavam "em implementacao", mas ambas ja sao self-service desde
   a Onda 1/2 da propria REF-LGPD-01 (lgpd_delete_my_data / lgpd_export_my_data), confirmadas ao vivo em
   producao. Correcao puramente factual, nenhuma base legal/prazo foi alterado ou inventado. */

export const PRIVACY_POLICY_VERSION = '1.1';
export const PRIVACY_POLICY_UPDATED_AT = '2026-08-23';
export const PRIVACY_POLICY_UPDATED_AT_HUMANO = '23 de agosto de 2026';

export const PRIVACY_POLICY_SECTIONS = [
  {
    titulo: 'O que é este documento',
    paragrafos: [
      'Este texto descreve, de forma direta, quais dados pessoais o sistema usado por esta loja coleta, para que servem e com quem podem ser compartilhados. Ele reflete o funcionamento técnico real da plataforma (auditoria interna REF-LGPD-01), não é um modelo genérico.',
      'Ele é o mesmo para todas as lojas que usam esta plataforma — o que muda de loja para loja são apenas os dados de contato e as regras comerciais próprias, que ficam na tela "Termos e Políticas" e "Contato".',
    ],
  },
  {
    titulo: 'Dados que coletamos',
    paragrafos: [
      'Identificação: nome e telefone (telefone é a identidade principal da sua conta) e, se você optar por entrar com Google ou por e-mail, seu e-mail.',
      'Endereço de entrega: rua, número, bairro, cidade, complemento, ponto de referência, CEP e a localização aproximada (coordenadas) usada para calcular a distância até você.',
      'Pedido: itens escolhidos, observações que você escrever, forma de pagamento informada (não coletamos número de cartão em nenhuma hipótese) e o histórico de pedidos feitos.',
      'Conta e sessão: um identificador técnico da sua sessão de login, usado só para manter você conectado.',
    ],
  },
  {
    titulo: 'Para que usamos',
    paragrafos: [
      'Processar e entregar o seu pedido, calcular o valor da entrega e o tempo estimado, autenticar o seu acesso à conta, avisar você sobre o andamento do pedido pelo WhatsApp, e administrar o programa de fidelidade quando a loja tiver um.',
    ],
  },
  {
    titulo: 'Com quem compartilhamos',
    paragrafos: [
      'Alguns dados precisam passar por empresas que dão suporte técnico ao funcionamento da plataforma:',
      '• Supabase — hospeda o banco de dados e a autenticação; é onde seus dados ficam armazenados.',
      '• Meta (WhatsApp) — recebe seu nome, telefone e os detalhes do pedido para enviar a confirmação e as atualizações de status.',
      '• Google — se você escolher entrar com sua conta Google, recebemos seu nome, e-mail e foto de perfil dele.',
      '• Resend — envia o código de acesso por e-mail quando você escolhe entrar por e-mail.',
      '• Mapbox, Nominatim e Photon — ajudam a buscar e confirmar o seu endereço de entrega.',
      '• HeiGIT/OpenRouteService — calcula a distância da rota até você, recebendo só coordenadas geográficas (nunca seu nome, telefone ou endereço em texto).',
      '• Sentry — nos avisa quando algo dá erro no sistema; recebe só um identificador técnico e o seu papel (cliente/admin), nunca nome, telefone ou e-mail.',
      'Não vendemos dados pessoais a terceiros nem os usamos para publicidade.',
    ],
  },
  {
    titulo: 'Por quanto tempo guardamos',
    paragrafos: [
      'Hoje não existe um prazo definido de guarda para os dados de cadastro e de pedidos — essa definição depende de confirmação jurídica e contábil sobre os prazos legais de guarda de comprovantes de venda, ainda pendente (acompanhar como LGPD-R07).',
      'Registros técnicos internos (logs de operação, fila de notificações) têm rotina de limpeza automática configurada para um prazo provisório e conservador, revisado quando o prazo definitivo for confirmado.',
    ],
  },
  {
    titulo: 'Seus direitos hoje',
    paragrafos: [
      'Acesso e correção: você pode ver e editar seu nome, telefone, e-mail e endereços salvos a qualquer momento na tela "Minha Conta".',
      'Exclusão: você pode pedir a remoção (anonimização) dos seus dados a qualquer momento, na tela "Minha Conta", com confirmação em duas etapas. Pedidos já feitos são preservados como histórico da transação, não como dado pessoal identificável a você.',
      'Portabilidade: você pode baixar uma cópia de todos os seus dados (cadastro, endereços, pedidos e fidelidade) a qualquer momento na tela "Minha Conta".',
      'Oposição e revogação: ainda não têm um canal próprio de autoatendimento — fale pelo canal de contato desta loja para tratar destes pedidos manualmente.',
    ],
  },
  {
    titulo: 'Como falar conosco',
    paragrafos: [
      'Para dúvidas ou solicitações sobre os seus dados, use o canal de contato desta loja (tela "Contato" no menu).',
    ],
  },
  {
    titulo: 'Aviso',
    paragrafos: [
      `Este documento descreve o comportamento técnico real do sistema, verificado por auditoria interna (REF-LGPD-01, ${PRIVACY_POLICY_UPDATED_AT}). Ele não é uma declaração de conformidade legal. Itens que dependem de interpretação jurídica — base legal de cada tratamento, prazos de retenção definitivos e obrigações regulatórias específicas — ainda não foram formalizados e necessitam validação jurídica/DPO.`,
    ],
  },
];
