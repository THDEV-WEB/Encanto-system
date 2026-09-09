/* components/checkout/PagamentoPixPage.jsx — REF-PAGAMENTO-01 · Onda 5.
   Tela de pagamento online via Pix: pedido já foi criado (status 'aguardando_pagamento', ver
   CheckoutPage.submit) — esta tela 1) inicia o payment_intent (iniciarPagamento), 2) monta o Payment
   Brick do Mercado Pago SÓ pra coletar e-mail/CPF do pagador (customization restringe a bankTransfer,
   nunca mostra cartão), 3) ao confirmar no Brick, chama criarCobranca (Edge Function real) e TROCA
   pra uma tela própria de QR/espera (não depende do Brick renderizar isso sozinho — controle total
   sobre o que o cliente vê, mesmo padrão já testado ponta a ponta nas Ondas 3/4), 4) faz polling em
   consultarStatusPagamento até 'aprovado' — só então chama onSuccess(msg), que abre o WhatsApp
   (StoreApp.jsx) exatamente como o fluxo COD já fazia. Nunca antes disso: notificar a loja de um
   pedido ainda não pago seria abrir margem pra ela começar a preparar algo que pode nunca ser pago
   (Pix expira sem ser escaneado). */
import { useState, useEffect, useRef } from 'react';
import { usePagamentoConfig } from '../../hooks/usePagamentoConfig.js';
import { iniciarPagamento, criarCobranca, consultarStatusPagamento } from '../../pagamento/services/pagamentoService.js';
import { carregarMercadoPagoSdk, obterInstanciaMercadoPago } from '../../pagamento/services/mercadoPagoSdk.js';

const BRICK_CONTAINER_ID = 'pagamento-pix-brick-container';
const POLL_INTERVAL_MS = 4000;

export function PagamentoPixPage({ orderId, msg, onSuccess, onVoltar }) {
  const pagamentoConfig = usePagamentoConfig();
  const [fase, setFase] = useState('iniciando'); // iniciando | coletando | aguardando | erro
  const [erro, setErro] = useState('');
  const [paymentIntentId, setPaymentIntentId] = useState(null);
  const [amount, setAmount] = useState(null);
  const [dadosPix, setDadosPix] = useState(null); // {qr_code, qr_code_base64, ticket_url}
  const [copiado, setCopiado] = useState(false);
  const brickControllerRef = useRef(null);

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

  /* 2) Monta o Payment Brick (só Pix) assim que temos payment_intent_id + amount + public_key. */
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
            bankTransfer: 'all',   // Pix — único método habilitado nesta onda
            /* ACHADO REAL (3 erros 422 sucessivos da API de inicializacao do Brick): creditCard/
               debitCard/prepaidCard/ticket NAO aceitam a string 'none' -- so' 'all' ou uma lista de
               opcoes especificas (ex.: "options for (ticket): bolbradesco"). Lista VAZIA e' o jeito
               correto de dizer "nenhuma opcao permitida" pra esses campos -- so' mercadoPago (o
               saldo da carteira Mercado Pago, um booleano de verdade, nao um enum de bandeiras)
               aceitou 'none' sem erro. */
            creditCard: [], debitCard: [], prepaidCard: [], ticket: [], mercadoPago: 'none',
          },
        },
        callbacks: {
          onReady: () => {},
          onSubmit: ({ selectedPaymentMethod, formData }) => new Promise((resolve, reject) => {
            criarCobranca({
              paymentIntentId,
              paymentMethodId: formData?.payment_method_id || selectedPaymentMethod || 'pix',
              payer: formData?.payer,
            }).then(resultado => {
              if (!resultado.ok) { setErro(resultado.error || 'Não foi possível gerar o Pix. Tente novamente.'); reject(); return; }
              setDadosPix(resultado.pix || null);
              setFase('aguardando');
              resolve();
            }).catch(() => { setErro('Não foi possível gerar o Pix. Tente novamente.'); reject(); });
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

  /* 3) Polling do status real (webhook/criação já gravam no banco — aqui só lemos). */
  useEffect(() => {
    if (fase !== 'aguardando' || !paymentIntentId) return;
    let vivo = true;
    const t = setInterval(async () => {
      const r = await consultarStatusPagamento(paymentIntentId);
      if (!vivo) return;
      if (r.ok && r.status === 'aprovado') { clearInterval(t); onSuccess(msg); }
      else if (r.ok && (r.status === 'recusado' || r.status === 'expirado')) {
        clearInterval(t);
        setErro(r.status === 'expirado' ? 'O tempo para pagar esse Pix expirou.' : 'Pagamento não aprovado.');
        setFase('erro');
      }
    }, POLL_INTERVAL_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [fase, paymentIntentId, msg, onSuccess]);

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
        <h2 style={{ marginBottom: 6 }}>Escaneie o QR Code pra pagar</h2>
        <p style={{ marginBottom: 20 }}>Assim que o Pix cair, seu pedido é enviado automaticamente pra loja.</p>
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
      <h2 style={{ marginBottom: 6 }}>Pagamento via Pix</h2>
      <p style={{ marginBottom: 20 }}>Informe seus dados pra gerar o QR Code.</p>
      <div id={BRICK_CONTAINER_ID} />
      {fase === 'iniciando' && <p style={{ textAlign: 'center', color: 'var(--gray-500)', fontSize: 13 }}>Carregando...</p>}
    </div>
  );
}
