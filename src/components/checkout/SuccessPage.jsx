/* components/checkout/SuccessPage.jsx — REF-APP-01 · Onda 5.1 (move puro do App.jsx L230-292) + REF-CHECKOUT-02
   + REF-GOLIVE-01 (bloqueador 1 — horario deixou de ser hardcoded, ver prop `horario`)
   + REF-SAAS-01 · Onda 7.1 (WhatsApp operacional multi-tenant).
   Tela de confirmacao do pedido (apresentacional): abre o WhatsApp AUTOMATICAMENTE (sem escolha do
   cliente) assim que a tela monta, com a mensagem ja pronta (msg vem do CheckoutPage, montada por
   buildOrderConfirmationMessage). Sem DS, sem carrinho (prop 'cart' preservada mas nao usada).

   REF-CHECKOUT-02: navegadores bloqueiam window.open() quando ele NAO e resultado direto/sincrono de
   um gesto do usuario — e exatamente o caso aqui (a abertura roda dentro de um efeito, apos os awaits
   de rede do submit). Por isso: tenta abrir, detecta bloqueio (window.open devolve null/janela ja
   fechada) e cai na tela de contingencia com um botao manual — um clique direto NUNCA e bloqueado por
   popup-blocker, entao sempre da uma saida ao cliente.

   REF-SAAS-01 · Onda 7.1: 2ª contingência, DIFERENTE da de popup bloqueado — a loja ainda não configurou
   nenhum WhatsApp (`whatsapp` vazio, nunca mais o número real da Encanto como fallback, ver
   companyInfoRules.js). Nesse caso NEM tenta abrir nada (não existe destino) — mostra uma mensagem clara
   de que o pedido foi registrado, mas a loja não tem canal de WhatsApp configurado ainda. O pedido já
   foi persistido antes desta tela em qualquer um dos 2 cenários — nunca bloqueia o checkout. */
import { useState, useEffect, useRef } from 'react';

export function SuccessPage({ msg, cart, onBack, deliveryEta, deliveryMode, whatsapp, horario }) {
  /* REF-COMPANY-01: numero SEMPRE vindo do cadastro da empresa (prop, unico ponto de consumo em
     StoreApp -> Single Source of Truth), nunca mais hardcoded/env var. */
  const temWhatsapp = !!whatsapp;
  const abrirWhatsApp = () => {
    if (!temWhatsapp) return false;
    const win = window.open(`https://wa.me/${whatsapp}?text=${encodeURIComponent(msg)}`, '_blank');
    return !!(win && !win.closed);
  };

  const [contingencia, setContingencia] = useState(false);
  const tentouRef = useRef(false);
  useEffect(() => {
    if (tentouRef.current) return;   // nunca dispara 2 popups (StrictMode/remount em dev)
    tentouRef.current = true;
    if (temWhatsapp && !abrirWhatsApp()) setContingencia(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const reabrir = () => { if (abrirWhatsApp()) setContingencia(false); };

  /* Loja sem WhatsApp configurado (REF-SAAS-01 · Onda 7.1): nem tenta abrir — não existe destino. */
  if (!temWhatsapp) {
    return (
      <div className="success-page" style={{maxWidth:520,padding:'28px 16px 40px'}} role="alert">
        <div style={{fontSize:56}}>📋</div>
        <h2 style={{marginBottom:6}}>Pedido registrado!</h2>
        <p style={{marginBottom:24}}>
          Esta loja ainda não configurou o WhatsApp de atendimento — seu pedido foi salvo, mas a confirmação automática não pôde ser enviada. Entre em contato pelos canais informados pela loja.
        </p>
        <button className="back-home-btn" onClick={onBack}>← Voltar ao cardápio</button>
      </div>
    );
  }

  /* REF-DELIVERY-01: tempo estimado vem da CONFIG unica (deliveryEta), nao mais de um valor aleatorio.
     Consciente do modo (igual a DeliveryBar): entrega usa a config; retirada usa o tempo fixo de retirada. */
  const retirada = deliveryMode === 'retirada';
  const [statusIdx] = useState(0);
  const steps = [
    {label:'Recebido',   icon:'📥'},
    {label:'Em preparo', icon:'👨‍🍳'},
    {label:'Pronto',     icon:'✅'},
    {label:'Em entrega', icon:'🛵'},
    {label:'Entregue',   icon:'🏠'},
  ];

  /* Contingência (REF-CHECKOUT-02): pedido já está salvo — só a abertura automática falhou. Não
     deixa o cliente sem saída: um único botão que reabre o WhatsApp com a mesma mensagem pronta. */
  if (contingencia) {
    return (
      <div className="success-page" style={{maxWidth:520,padding:'28px 16px 40px'}} role="alert">
        <div style={{fontSize:56}}>⚠️</div>
        <h2 style={{marginBottom:6}}>Não foi possível abrir automaticamente o WhatsApp.</h2>
        <p style={{marginBottom:24}}>
          Seu pedido já foi registrado — falta só enviar a confirmação pelo WhatsApp.
        </p>
        <button className="whatsapp-btn" onClick={reabrir} style={{width:'100%',justifyContent:'center'}}>
          <span style={{fontSize:22}}>💬</span> Abrir WhatsApp novamente
        </button>
      </div>
    );
  }

  return (
    <div className="success-page" style={{maxWidth:520,padding:'28px 16px 40px'}}>
      <div className="success-icon" style={{fontSize:56}}>🎉</div>
      <h2 style={{marginBottom:6}}>Pedido realizado com sucesso!</h2>
      <p style={{marginBottom:20}}>
        Abrimos o WhatsApp com o seu pedido — é só tocar em Enviar! 💜
      </p>

      {/* Tempo estimado */}
      <div style={{
        background:'var(--grape-pale)',borderRadius:12,padding:'12px 20px',
        marginBottom:20,display:'flex',alignItems:'center',justifyContent:'space-between',
      }}>
        <div>
          <div style={{fontSize:12,color:'var(--amarelo)',fontWeight:600,marginBottom:2}}>
            🕐 {retirada ? 'Tempo estimado para retirada' : 'Tempo estimado de entrega'}
          </div>
          <div style={{fontFamily:'var(--font-head)',fontSize:24,fontWeight:800,color:'var(--amarelo)'}}>
            {retirada ? 20 : deliveryEta} min
          </div>
        </div>
        {/* REF-GOLIVE-01 (bloqueador 1): nada de horario fixo aqui — mesmo objeto `horario` do header
            (useBusinessHours, StoreApp), que ja resolve cronograma administravel + STORE_MODE + excecoes.
            Qualquer mudanca feita pelo Admin reflete aqui automaticamente, sem esta tela recalcular nada. */}
        <div style={{fontSize:11,color:'var(--gray-500)',textAlign:'right',lineHeight:1.4}}>
          <div style={{fontWeight:700,color:'var(--gray-700)'}}>{horario?.rotuloCurto}</div>
          {horario?.detalhe && <div>{horario.detalhe}</div>}
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

      <button className="whatsapp-btn" onClick={reabrir} style={{width:'100%',justifyContent:'center',marginBottom:10}}>
        <span style={{fontSize:22}}>💬</span> Abrir WhatsApp novamente
      </button>
      <button className="back-home-btn" onClick={onBack}>← Voltar ao cardápio</button>
    </div>
  );
}
