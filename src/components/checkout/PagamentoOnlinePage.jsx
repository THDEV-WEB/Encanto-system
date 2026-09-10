/* components/checkout/PagamentoOnlinePage.jsx — REF-PAGAMENTO-01 · Onda 5 (Pix) + Onda 6 (cartão).
   Tela de pagamento online (Pix + cartão de crédito/débito): pedido já foi criado (status
   'aguardando_pagamento', ver CheckoutPage.submit) — esta tela 1) inicia o payment_intent
   (iniciarPagamento), 2) monta o Payment Brick do Mercado Pago (Pix + cartão — "Meios de pagamento"
   dentro do próprio Brick, sem outra escolha antes disso no checkout), 3) ao confirmar, chama
   criarCobranca (Edge Function real) e trata o resultado:
     - 'aprovado' (cartão costuma decidir na hora) -> chama onSuccess(msg) IMEDIATAMENTE, sem tela
       de espera nenhuma;
     - 'recusado' -> tela própria de erro com o motivo (mapeado pro português);
     - 'pendente' (Pix sempre nasce assim; cartão raramente também) -> tela própria de QR/espera
       (só mostra QR quando o método realmente for Pix — cartão pendente não tem QR) + polling em
       consultarStatusPagamento até 'aprovado'.
   Nunca depende do Brick renderizar QR/resultado sozinho — controle total sobre o que o cliente vê,
   mesmo padrão já testado ponta a ponta nas Ondas 3/4/5. WhatsApp (StoreApp.jsx, via onSuccess) só
   abre DEPOIS da confirmação real — notificar a loja de um pedido ainda não pago abriria margem pra
   ela começar a preparar algo que pode nunca ser pago. */
import { useState, useEffect, useRef } from 'react';
import { usePagamentoConfig } from '../../hooks/usePagamentoConfig.js';
import { iniciarPagamento, criarCobranca, consultarStatusPagamento } from '../../pagamento/services/pagamentoService.js';
import { carregarMercadoPagoSdk, obterInstanciaMercadoPago } from '../../pagamento/services/mercadoPagoSdk.js';

const BRICK_CONTAINER_ID = 'pagamento-online-brick-container';
const POLL_INTERVAL_MS = 4000;

/* Traduz o status_detail cru do Mercado Pago pra uma mensagem útil ao cliente -- lista não
   exaustiva (cobre as recusas de cartão mais comuns), com fallback genérico honesto. */
function descreverRecusa(statusDetail) {
  const mapa = {
    cc_rejected_insufficient_amount: 'Saldo insuficiente no cartão.',
    cc_rejected_bad_filled_security_code: 'Código de segurança (CVV) incorreto.',
    cc_rejected_bad_filled_date: 'Data de validade incorreta.',
    cc_rejected_bad_filled_card_number: 'Número do cartão incorreto.',
    cc_rejected_bad_filled_other: 'Confira os dados do cartão e tente novamente.',
    cc_rejected_call_for_authorize: 'Seu banco pediu autorização manual — ligue pra central do cartão.',
    cc_rejected_card_disabled: 'Cartão desabilitado — entre em contato com seu banco.',
    cc_rejected_duplicated_payment: 'Pagamento duplicado — se já pagou, aguarde a confirmação.',
    cc_rejected_high_risk: 'O pagamento foi recusado por segurança. Tente outro cartão.',
    cc_rejected_max_attempts: 'Muitas tentativas com este cartão. Tente outro ou mais tarde.',
    cc_rejected_card_type_not_allowed: 'Este tipo de cartão não é aceito.',
  };
  return mapa[statusDetail] || 'Pagamento não aprovado. Tente outro cartão ou outra forma de pagamento.';
}

export function PagamentoOnlinePage({ orderId, msg, onSuccess, onVoltar }) {
  const pagamentoConfig = usePagamentoConfig();
  const [fase, setFase] = useState('iniciando'); // iniciando | coletando | aguardando | erro
  const [erro, setErro] = useState('');
  const [paymentIntentId, setPaymentIntentId] = useState(null);
  const [amount, setAmount] = useState(null);
  const [dadosPix, setDadosPix] = useState(null); // {qr_code, qr_code_base64, ticket_url} | null (cartão)
  const [copiado, setCopiado] = useState(false);
  const brickControllerRef = useRef(null);
  /* BUG REAL corrigido: msg/onSuccess são recriados a cada render de StoreApp.jsx (funções inline),
     então tê-los como dependência do efeito que monta o Brick fazia ele ser DESMONTADO e remontado
     a qualquer re-render do pai (ex.: polling de negócio, troca de estado não relacionada) --
     apagando o formulário de cartão que o cliente estava preenchendo. refs guardam o valor mais
     recente sem disparar o efeito de novo -- mesmo padrão React para "callback precisa do valor
     atual, mas não deve recriar a montagem". */
  const msgRef = useRef(msg);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { msgRef.current = msg; onSuccessRef.current = onSuccess; });

  /* 1) Cria (ou reaproveita, se o cliente recarregar a página) o payment_intent pro pedido. */
  useEffect(() => {
    let vivo = true;
    iniciarPagamento(orderId).then(r => {
      if (!vivo) return;
      if (!r.ok) { setErro(r.error || 'Não foi possível iniciar o pagamento.'); setFase('erro'); return; }
      setPaymentIntentId(r.payment_intent_id);
      setAmount(r.amount);
      setFase('coletando');
    });
    return () => { vivo = false; };
  }, [orderId]);

  /* 2) Monta o Payment Brick (Pix + cartão) assim que temos payment_intent_id + amount + public_key. */
  useEffect(() => {
    if (fase !== 'coletando' || !paymentIntentId || !amount || !pagamentoConfig.public_key) return;
    let vivo = true;
    carregarMercadoPagoSdk(() => {
      if (!vivo) return;
      const mp = obterInstanciaMercadoPago(pagamentoConfig.public_key);
      if (!mp) { setErro('Não foi possível carregar o pagamento online.'); setFase('erro'); return; }
      mp.bricks().create('payment', BRICK_CONTAINER_ID, {
        initialization: { amount },
        customization: {
          paymentMethods: {
            bankTransfer: 'all',           // Pix
            creditCard: 'all', debitCard: 'all', prepaidCard: 'all',
            /* ACHADO REAL (Onda 5, 3 erros 422 sucessivos da API de inicialização do Brick):
               creditCard/debitCard/prepaidCard/ticket NÃO aceitam a string 'none' -- só 'all' ou uma
               lista de opções específicas. Lista VAZIA é o jeito correto de desabilitar -- por isso
               ticket fica [] (boleto fora do escopo: liquidação em dias, não combina com pedido de
               comida). mercadoPago (saldo da carteira MP) também fora do escopo desta onda. */
            ticket: [], mercadoPago: 'none',
          },
        },
        callbacks: {
          onReady: () => {},
          onSubmit: ({ selectedPaymentMethod, formData }) => new Promise((resolve, reject) => {
            criarCobranca({
              paymentIntentId,
              paymentMethodId: formData?.payment_method_id || selectedPaymentMethod,
              token: formData?.token,
              installments: formData?.installments,
              issuerId: formData?.issuer_id,
              payer: formData?.payer,
            }).then(resultado => {
              if (!resultado.ok) { setErro(resultado.error || 'Não foi possível processar o pagamento. Tente novamente.'); setFase('erro'); reject(); return; }
              if (resultado.status === 'aprovado') { resolve(); onSuccessRef.current(msgRef.current); return; }
              if (resultado.status === 'recusado') { setErro(descreverRecusa(resultado.status_detail)); setFase('erro'); resolve(); return; }
              // pendente -- Pix (tem QR) ou, raramente, cartão em análise (sem QR).
              setDadosPix(resultado.pix || null);
              setFase('aguardando');
              resolve();
            }).catch(() => { setErro('Não foi possível processar o pagamento. Tente novamente.'); setFase('erro'); reject(); });
          }),
          onError: (e) => { console.error('[ENCANTO] Payment Brick erro:', e); },
        },
      }).then(controller => { if (vivo) brickControllerRef.current = controller; else controller?.unmount?.(); });
    }, () => { setErro('Não foi possível carregar o pagamento online.'); setFase('erro'); });
    return () => {
      vivo = false;
      brickControllerRef.current?.unmount?.();
      brickControllerRef.current = null;
    };
  }, [fase, paymentIntentId, amount, pagamentoConfig.public_key]);

  /* 3) Polling do status real (webhook/criação já gravam no banco — aqui só lemos). Só entra em
     jogo pra pagamentos que nasceram 'pendente' (Pix, na prática). */
  useEffect(() => {
    if (fase !== 'aguardando' || !paymentIntentId) return;
    let vivo = true;
    const t = setInterval(async () => {
      const r = await consultarStatusPagamento(paymentIntentId);
      if (!vivo) return;
      if (r.ok && r.status === 'aprovado') { clearInterval(t); onSuccessRef.current(msgRef.current); }
      else if (r.ok && (r.status === 'recusado' || r.status === 'expirado')) {
        clearInterval(t);
        setErro(r.status === 'expirado' ? 'O tempo para pagar esse Pix expirou.' : 'Pagamento não aprovado.');
        setFase('erro');
      }
    }, POLL_INTERVAL_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [fase, paymentIntentId]);

  const copiarCodigo = async () => {
    if (!dadosPix?.qr_code) return;
    try { await navigator.clipboard.writeText(dadosPix.qr_code); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { /* ignore */ }
  };

  if (fase === 'erro') {
    return (
      <div className="success-page" style={{ maxWidth: 520, padding: '28px 16px 40px' }} role="alert">
        <div style={{ fontSize: 56 }}>⚠️</div>
        <h2 style={{ marginBottom: 6 }}>Não foi possível concluir o pagamento</h2>
        <p style={{ marginBottom: 24 }}>{erro}</p>
        <p style={{ marginBottom: 24, fontSize: 13, color: 'var(--gray-500)' }}>
          Seu pedido já está registrado — se preferir, volte e escolha outra forma de pagamento.
        </p>
        <button className="back-home-btn" onClick={onVoltar}>← Voltar ao cardápio</button>
      </div>
    );
  }

  if (fase === 'aguardando') {
    return (
      <div className="success-page" style={{ maxWidth: 520, padding: '28px 16px 40px' }}>
        <div style={{ fontSize: 48 }}>⚡</div>
        <h2 style={{ marginBottom: 6 }}>{dadosPix ? 'Escaneie o QR Code pra pagar' : 'Processando seu pagamento...'}</h2>
        <p style={{ marginBottom: 20 }}>
          {dadosPix ? 'Assim que o Pix cair, seu pedido é enviado automaticamente pra loja.' : 'Seu pedido é enviado automaticamente pra loja assim que confirmado.'}
        </p>
        {dadosPix?.qr_code_base64 && (
          <img
            src={`data:image/png;base64,${dadosPix.qr_code_base64}`}
            alt="QR Code do Pix"
            style={{ width: 220, height: 220, margin: '0 auto 16px', display: 'block', borderRadius: 12, border: '1px solid var(--grape-pale)' }}
          />
        )}
        {dadosPix?.qr_code && (
          <button className="whatsapp-btn" onClick={copiarCodigo} style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}>
            {copiado ? '✓ Código copiado!' : '📋 Copiar código Pix'}
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, fontSize: 13, color: 'var(--gray-500)' }}>
          <span className="spinner-inline" aria-hidden="true">⏳</span> Aguardando confirmação do pagamento...
        </div>
      </div>
    );
  }

  // fase === 'iniciando' | 'coletando'
  return (
    <div className="success-page" style={{ maxWidth: 520, padding: '28px 16px 40px' }}>
      <h2 style={{ marginBottom: 6 }}>Pagamento online</h2>
      <p style={{ marginBottom: 20 }}>Escolha Pix ou cartão pra pagar agora.</p>
      <div id={BRICK_CONTAINER_ID} />
      {fase === 'iniciando' && <p style={{ textAlign: 'center', color: 'var(--gray-500)', fontSize: 13 }}>Carregando...</p>}
    </div>
  );
}
