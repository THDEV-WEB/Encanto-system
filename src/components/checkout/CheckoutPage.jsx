/* components/checkout/CheckoutPage.jsx — REF-APP-01 · Onda 5.3 (move puro do App.jsx L81-206) + REF-CHECKOUT-02.
   Pagina de checkout: formulario + orquestracao do submit. Logica de negocio ja isolada no order-domain
   (Onda 5.2): consome buildOrderArgs/buildOrderConfirmationMessage/buildCheckoutView de utils/orderPayload.js
   e DS.savePedido de services/DataService.js. NAO importa pricing/addons/format direto (G-CK2). newRequestId
   (utils/ids) e STORAGE_KEYS (constants) sao dependencias PRE-EXISTENTES do submit (idempotency key/localStorage). */
import { useState, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js';   // REF-COMPANY-02: nome curto na mensagem do WhatsApp
import { useBusinessHours } from '../../hooks/useBusinessHours.js';   // REF-BUSINESS-HOURS-01: bloqueio fora do horario
import { useDeliveryFeeConfig } from '../../hooks/useDeliveryFeeConfig.js';   // REF-DELIVERY-FEE-01: config da taxa por distancia
import { STORAGE_KEYS } from '../../constants/storage.js';
import { newRequestId } from '../../utils/ids.js';
import { buildOrderArgs, buildOrderConfirmationMessage, buildCheckoutView } from '../../utils/orderPayload.js';
import { DS } from '../../services/DataService.js';
import { LOYALTY_EVENT } from '../../services/loyalty/index.js';   // REF-LOYALTY-01: avisa a loja p/ re-buscar o estado oficial
import { STORE_INFO } from '../../constants/storeInfo.js';
import { useAddress, AddressSummary, addressRepository, geocoding } from '../../address/index.js';   // REF-CHECKOUT-ADDRESS-01: FONTE UNICA do endereco
import { montarResumoFinanceiro } from '../../services/delivery/deliveryFeeRules.js';   // REF-DELIVERY-FEE-01: fonte unica da regra de negocio
import { calcularDistanciaEntrega } from '../../services/delivery/routing/routeDistanceService.js';   // REF-DELIVERY-FEE-03: rota viaria (HeiGIT) com fallback automatico p/ Haversine
import { localizacaoLojaConfigurada } from '../../services/company/companyInfoRules.js';   // REF-DELIVERY-FEE-02: mesma checagem do Admin, nunca diverge
import { lerGuestIdentity, salvarGuestIdentity } from '../../utils/guestIdentity.js'; // REF-CUSTOMER-01: cache local so p/ visitante
import { registrarBreadcrumb, marcarPedido } from '../../lib/sentry.js'; // REF-OBS-01/REF-SENTRY-01: no-op sem VITE_SENTRY_DSN

// REF-LGPD-01 · Onda 3 (LGPD-R14): so' carrega o chunk se o cliente realmente abrir o aviso.
const PrivacidadeScreen = lazy(() => import('../menu/PrivacidadeScreen.jsx').then(m => ({ default: m.PrivacidadeScreen })));

export function CheckoutPage({ cart, onBack, onSuccess, deliveryMode, deliveryEta }) {
  /* REF-CLIENTE-02 (vinculo pedido<->conta): create_order reusa o customer POR TELEFONE e nunca toca
     auth_user_id. Logo o pedido so aparece em "Meus Pedidos" se o telefone do checkout casar com o do
     cadastro (que carrega o auth_user_id). Para o cliente LOGADO, a identidade vem da conta e o telefone
     fica TRAVADO (=identidade, ja coletada no 1o acesso) — garante o vinculo, sem re-orfanar o pedido.
     Guest (nao logado) segue 100% editavel: guest checkout intocado. */
  const { isLogged, customer, status } = useAuth();
  const companyInfo = useCompanyInfo();
  const [mostrarPrivacidade, setMostrarPrivacidade] = useState(false); // REF-LGPD-01 · Onda 3 (LGPD-R14)
  const feeConfig = useDeliveryFeeConfig();   // REF-DELIVERY-FEE-01: config administravel (faixas/maquininha)
  /* REF-CHECKOUT-ADDRESS-01: o endereco de entrega vem da FONTE UNICA (dominio Address, mesmo objeto do
     header). O checkout NAO tem mais um endereco proprio; edita o mesmo objeto pelo mesmo AddressModal
     (abrirModal). Retirada nao usa endereco de entrega — usa o endereco da loja. */
  const { endereco, temEndereco, abrirModal } = useAddress();
  const retirada = deliveryMode === 'retirada';
  const enderecoEntrega = retirada ? ('Retirada na loja — ' + STORE_INFO.retirada) : (endereco?.label || '');
  /* REF-BUSINESS-HOURS-01: fora do horário oficial o cliente navega/vê preços normalmente, mas NÃO
     finaliza pedido. Mesma fonte de verdade do header (services/businessHours via useBusinessHours). */
  const horario = useBusinessHours();
  const lojaFechada = !horario.aberto;
  const identidadeTravada = isLogged && !!customer?.phone;
  const [form, setForm] = useState({nome:'',telefone:'',pagamento:'dinheiro',troco:'',obs:''});
  /* Cliente LOGADO: Supabase (customer) e a FONTE OFICIAL — inalterado. */
  useEffect(() => {
    if (!isLogged || !customer) return;   // guest: nao pre-preenche nada
    setForm(f => ({ ...f, nome: f.nome || customer.name || '', telefone: customer.phone || f.telefone }));
  }, [isLogged, customer]);
  /* REF-CUSTOMER-01: visitante (SEM conta) — pre-preenche do cache local, so depois que o status de auth
     resolver definitivamente para 'anon' (nunca durante 'loading', pra nao correr com o efeito acima e
     acabar preenchendo com o cache de visitante um campo que o customer real ia preencher com OUTRO
     valor logo em seguida). Nao mescla com o customer: sao fontes mutuamente exclusivas por definicao. */
  useEffect(() => {
    if (status !== 'anon') return;
    const cache = lerGuestIdentity();
    if (!cache) return;
    setForm(f => ({ ...f, nome: f.nome || cache.nome, telefone: f.telefone || cache.telefone }));
  }, [status]);
  /* REF-DELIVERY-FEE-01: coordenadas do CLIENTE para calcular a distância. O endereço já pode trazer
     lat/lng (busca por texto/GPS/mapa); a aba CEP (ViaCEP) nunca devolve coordenada — tenta geocodificar o
     endereço COMPOSTO em segundo plano, reaproveitando o MESMO motor de busca do modal de endereço
     (geocoding.coordenadasDe). NUNCA bloqueia o checkout: enquanto não resolve (ou se falhar), o cálculo
     cai no fallback "sem_coordenadas" (taxa R$0 + aviso, ver deliveryFeeRules.montarResumoFinanceiro). */
  const [coordCliente, setCoordCliente] = useState(null);
  useEffect(() => {
    let vivo = true;
    if (retirada || !endereco) { setCoordCliente(null); return; }
    if (Number.isFinite(endereco.lat) && Number.isFinite(endereco.lng)) {
      setCoordCliente({ lat: endereco.lat, lng: endereco.lng });
      return;
    }
    setCoordCliente(null);
    geocoding.coordenadasDe(endereco).then(c => { if (vivo) setCoordCliente(c); });
    return () => { vivo = false; };
  }, [retirada, endereco]);
  /* Coordenada da LOJA (Admin > Taxa de Entrega, arraste do pino) + distância + resumo financeiro —
     recalculam sozinhos a cada mudança relevante, sem precisar finalizar o pedido (tempo real). */
  const coordLoja = localizacaoLojaConfigurada(companyInfo)
    ? { lat: companyInfo.lojaLat, lng: companyInfo.lojaLng } : null;
  /* REF-DELIVERY-FEE-03: distância de ROTA VIÁRIA real (routeDistanceService -> Edge Function ->
     HeiGIT), com fallback automático e transparente para Haversine quando a rota real não pode ser
     calculada (offline, timeout, rate limit, sem rota) — NUNCA bloqueia o checkout, mesmo princípio
     de sempre. null enquanto não há as duas coordenadas (equivalente ao "sem_coordenadas" de antes;
     montarResumoFinanceiro já trata distanciaKm:null). method/provider viram breadcrumb no Sentry —
     observabilidade de "por que essa distância", sem precisar de migration/persistência nova. */
  const [distanciaInfo, setDistanciaInfo] = useState(null);
  useEffect(() => {
    let vivo = true;
    if (!coordLoja || !coordCliente) { setDistanciaInfo(null); return; }
    calcularDistanciaEntrega(coordLoja, coordCliente).then((info) => {
      if (!vivo) return;
      setDistanciaInfo(info);
      if (info.method) {
        registrarBreadcrumb('checkout: distância de entrega calculada', {
          method: info.method, provider: info.provider, distanceKm: info.distanceKm,
        });
      }
    });
    return () => { vivo = false; };
  }, [companyInfo.lojaLat, companyInfo.lojaLng, coordCliente?.lat, coordCliente?.lng]);
  const resumo = useMemo(() => montarResumoFinanceiro({
    subtotal: cart.total, retirada, distanciaKm: distanciaInfo?.distanceKm ?? null, config: feeConfig, paymentMethod: form.pagamento,
  }), [cart.total, retirada, distanciaInfo, feeConfig, form.pagamento]);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState('');   // feedback inline (mesmo padrão do AdminLogin)
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
    setErr('');
    /* GATE de horário (REF-BUSINESS-HOURS-01): fora do expediente NÃO cria pedido — interrompe antes de
       validar/persistir e informa o próximo horário correto. Guest e logado passam pelo mesmo gate. */
    if (lojaFechada) { setErr(horario.mensagemFechado || 'Estamos fechados no momento.'); return; }
    if (!form.nome||!form.telefone) { setErr('Preencha nome e telefone.'); return; }
    /* Validação de telefone alinhada ao servidor (normalize_phone): DDD + número = ≥10 dígitos.
       Impede que telefone inválido chegue à RPC create_order (que rejeitaria com rollback). */
    const digits = form.telefone.replace(/\D/g, '');
    if (digits.length < 10) { setErr('Informe um telefone válido com DDD (mínimo 10 dígitos).'); return; }
    /* REF-CHECKOUT-ADDRESS-01: entrega exige endereco da fonte unica; retirada usa o endereco da loja. */
    if (!retirada && !temEndereco) { setErr('Selecione seu endereço de entrega.'); return; }
    if (cart.items.length === 0) { console.warn('[ENCANTO] Carrinho vazio ao finalizar!'); }
    submittingRef.current = true;
    setLoading(true);
    if (!requestIdRef.current) {   // HARDEN-06: idempotency key durável (cobre retry/remontagem) via localStorage
      requestIdRef.current = localStorage.getItem(STORAGE_KEYS.REQ_ID) || newRequestId();
      try { localStorage.setItem(STORAGE_KEYS.REQ_ID, requestIdRef.current); } catch (e) {}
    }
    /* REF-ADDRESS-02 · Onda 6: persiste o endereço estruturado (só entrega — retirada usa o endereço da
       loja, sem endereço do cliente) para linkar orders.endereco_id. NUNCA bloqueia o checkout: falha
       (offline/timeout) devolve null (mesmo contrato de savePedido) e o pedido segue exatamente como
       hoje — só o texto em order.address, endereco_id fica null (idêntico aos 80 pedidos existentes).
       REF-ADDRESS-SEC-01: cliente LOGADO passa o próprio customer_id (a RPC agora só aceita gravar um
       customer_id que pertença de fato à sessão autenticada — ver save_structured_address; qualquer
       outro valor é gravado como NULL pelo próprio RPC). Convidado (não logado) nunca envia customerId
       — endereço continua salvo com customer_id=NULL, exatamente como antes, sem associação nenhuma. */
    const enderecoParaSalvar = (isLogged && customer?.id) ? { ...endereco, customerId: customer.id } : endereco;
    const enderecoId = (!retirada && endereco) ? await addressRepository.salvar(enderecoParaSalvar) : null;
    /* Montagem do pedido no order-domain (Onda 5.2 · Trilha B): buildOrderArgs concentra a
       lógica pura que antes vivia inline aqui (precoUnitario por item, product_id uuid/null,
       contratos null). Σ(price*quantity) reconcilia com orders.total. */
    const { customer: customerPedido, order, items } = buildOrderArgs(cart, form, enderecoEntrega, requestIdRef.current, enderecoId, resumo);
    /* GATE (fonte única de verdade): a persistência bem-sucedida é o evento que autoriza TODAS as ações
       seguintes. savePedido devolve o order_id em sucesso, ou null em falha (validação/rollback/timeout). */
    const orderId = await DS.savePedido(customerPedido, order, items, requestIdRef.current);
    if (!orderId) {
      /* Falha de persistência: interrompe o fluxo. NÃO conta fidelidade, NÃO limpa carrinho,
         NÃO executa onSuccess, NÃO mostra sucesso. Preserva requestId (retry reusa a MESMA
         idempotency key) e mantém o formulário intacto para nova tentativa. */
      setLoading(false);
      submittingRef.current = false;
      setErr('Não foi possível registrar seu pedido. Confira o telefone e tente novamente.');
      registrarBreadcrumb('checkout: falha ao persistir pedido', { itens: cart.items.length, retirada });
      return;
    }
    registrarBreadcrumb('checkout: pedido criado', { orderId, itens: cart.items.length, retirada });
    marcarPedido(orderId); // REF-SENTRY-01: tag pesquisável — acha no Sentry qualquer erro próximo deste pedido
    /* REF-CUSTOMER-01: so cacheia localmente p/ visitante — cliente logado ja tem o Supabase (customer)
       como fonte oficial, cachear aqui de novo criaria uma segunda fonte permanente do mesmo dado. */
    if (!isLogged) salvarGuestIdentity(form.nome, form.telefone);
    /* REF-LOYALTY-01: o selo de fidelidade e concedido no BACKEND, DENTRO de create_order (mesma
       transacao do pedido, idempotente por request_id + indice unico). O frontend NAO conta/grava
       selo — apenas avisa a loja para re-buscar o estado oficial (get_my_loyalty) e refletir o novo
       selo do proprio cliente logado. Guest acumula na conta do telefone e ve ao logar depois. */
    try { window.dispatchEvent(new Event(LOYALTY_EVENT)); } catch (e) {}
    /* REF-CHECKOUT-03: repassa o endereco ESTRUTURADO (dominio Address, mesmo objeto ja usado no
       resumo/AddressSummary acima — retirada nao tem endereco de cliente, so null) para a mensagem
       mostrar rua/numero/complemento/bairro/referencia sem re-derivar de string livre.
       REF-GOLIVE-01: deliveryEta (prop, vem de StoreApp -> useDeliveryEta, mesma fonte da DeliveryBar/
       SuccessPage) elimina o "35 a 45 min" fixo que a mensagem de confirmacao tinha antes. */
    const msg = buildOrderConfirmationMessage(customerPedido, order, items, orderId, {
      companyInfo, troco: form.troco, enderecoEstruturado: retirada ? null : endereco,
      deliveryEtaMin: deliveryEta,
    });
    setLoading(false);
    submittingRef.current = false;
    requestIdRef.current = null;   // próximo pedido recebe nova idempotency key
    try { localStorage.removeItem(STORAGE_KEYS.REQ_ID); } catch (e) {}
    cart.clear();
    onSuccess(msg);
  };
  const view = buildCheckoutView(cart, resumo);   // Onda 5.2: resumo consome o view-model do order-domain (não recalcula preço)
  /* REF-DELIVERY-FEE-01: só quebra em Subtotal/Entrega/Maquininha quando há alguma parcela a somar —
     retirada e "sem taxa" continuam com o resumo simples (itens + Total), zero mudança visual pra eles. */
  const mostrarDetalhamento = !!(view.entregaFmt || view.maquininhaFmt);
  const entregaAConfirmar = !retirada && !view.entregaFmt && (resumo.status === 'sem_coordenadas' || resumo.status === 'fora_de_alcance');
  return (
    <div className="checkout-page">
      <button onClick={onBack} style={{background:'none',color:'var(--gray-500)',fontSize:14,marginBottom:16,display:'flex',alignItems:'center',gap:6,cursor:'pointer',border:'none'}}>
        ← Voltar ao cardápio
      </button>
      <h2>Finalizar Pedido</h2>
      <div className="order-summary">
        <h3>Resumo</h3>
        {view.itens.map(it=>(
          <div key={it.key} className="summary-item">
            <span>{it.nome} x{it.qty}</span>
            <span>{it.valor}</span>
          </div>
        ))}
        {(mostrarDetalhamento || entregaAConfirmar) && (
          <div className="summary-item"><span>Subtotal</span><span>{view.subtotal}</span></div>
        )}
        {view.entregaFmt && (
          <div className="summary-item"><span>Entrega</span><span>{view.entregaFmt}</span></div>
        )}
        {entregaAConfirmar && (
          <div className="summary-item"><span>Entrega</span><span>A confirmar</span></div>
        )}
        {view.maquininhaFmt && (
          <div className="summary-item"><span>Retorno da maquininha</span><span>{view.maquininhaFmt}</span></div>
        )}
        <div className="summary-total"><span>Total</span><span>{view.total}</span></div>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="checkout-nome-input">Nome completo *</label>
        <input id="checkout-nome-input" className="form-input" data-testid="checkout-nome" placeholder="Seu nome" value={form.nome} onChange={e=>upd('nome',e.target.value)}/>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="checkout-telefone-input">WhatsApp *</label>
        <input id="checkout-telefone-input" className="form-input" data-testid="checkout-telefone" placeholder="(38) 99999-9999" value={form.telefone} onChange={e=>upd('telefone',e.target.value)}
          disabled={identidadeTravada} style={identidadeTravada?{opacity:0.75,cursor:'not-allowed'}:undefined}/>
        {identidadeTravada && (
          <span style={{fontSize:12,color:'var(--gray-500)',marginTop:4,display:'block'}}>
            Telefone da sua conta — usado para vincular o pedido ao seu histórico.
          </span>
        )}
      </div>
      <div className="form-group">
        <label className="form-label">{retirada ? 'Retirada na loja' : 'Endereço de entrega *'}</label>
        {/* REF-CHECKOUT-ADDRESS-01: resumo editavel da FONTE UNICA (mesmo objeto/modal do header). O que
            aparece aqui e exatamente o que sera confirmado e persistido no pedido. */}
        <AddressSummary
          endereco={endereco}
          retirada={retirada}
          retiradaLabel={STORE_INFO.retirada}
          onEditar={abrirModal}
        />
      </div>
      <div className="form-group">
        <label className="form-label" id="checkout-pagamento-label">Forma de pagamento</label>
        <div className="payment-opts" role="radiogroup" aria-labelledby="checkout-pagamento-label">
          {pays.map(o=>(
            <div key={o.id} className={`payment-opt ${form.pagamento===o.id?'selected':''}`} onClick={()=>upd('pagamento',o.id)}
              role="radio" aria-checked={form.pagamento===o.id} tabIndex={0}
              onKeyDown={e=>{ if (e.key==='Enter'||e.key===' ') { e.preventDefault(); upd('pagamento',o.id); } }}>
              <div className="icon" aria-hidden="true">{o.icon}</div>
              <div className="label">{o.label}</div>
            </div>
          ))}
        </div>
      </div>
      {form.pagamento==='dinheiro'&&(
        <div className="form-group">
          <label className="form-label" htmlFor="checkout-troco-input">Troco para quanto?</label>
          <input id="checkout-troco-input" className="form-input" placeholder="R$ 50,00" value={form.troco} onChange={e=>upd('troco',e.target.value)}/>
        </div>
      )}
      <div className="form-group">
        <label className="form-label" htmlFor="checkout-obs-input">Observações gerais</label>
        <textarea id="checkout-obs-input" className="form-input obs-textarea" data-testid="checkout-obs" placeholder="Alguma observação..."
          value={form.obs} onChange={e=>upd('obs',e.target.value)}/>
      </div>
      {lojaFechada && (
        <div style={{
          display:'flex',gap:10,alignItems:'flex-start',
          background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:12,
          padding:'12px 14px',marginBottom:12,
        }}>
          <span style={{fontSize:18,lineHeight:1.2,flexShrink:0}}>🔒</span>
          <div>
            {/* Fonte única: mensagemFechado já traz o próximo horário correto (ou, em fechamento
                emergencial dentro do expediente, a mensagem coerente) — nunca reinventar o horário aqui. */}
            <div style={{fontWeight:700,fontSize:14,color:'#B91C1C',lineHeight:1.4}}>
              {horario.mensagemFechado || 'Estamos fechados no momento.'}
            </div>
            <div style={{fontSize:13,color:'#7F1D1D',marginTop:3,lineHeight:1.5}}>
              Você pode montar seu pedido e finalizar quando reabrirmos.
            </div>
          </div>
        </div>
      )}
      {err&&<p data-testid="checkout-erro" role="alert" style={{color:'var(--red)',fontSize:13,marginBottom:8}}>{err}</p>}
      {/* REF-LGPD-01 · Onda 3 (LGPD-R14): aviso factual, so' informa e linka a politica ja versionada
          (LGPD-R02) -- nao e' um checkbox de consentimento (nao inventamos essa exigencia juridica). */}
      <p style={{fontSize:11.5,color:'var(--gray-500)',lineHeight:1.5,marginBottom:8,textAlign:'center'}}>
        Ao confirmar, seus dados de pedido são usados para entrega e contato — veja a{' '}
        <button type="button" onClick={() => setMostrarPrivacidade(true)}
          style={{background:'none',border:'none',padding:0,color:'inherit',textDecoration:'underline',cursor:'pointer',font:'inherit'}}>
          Política de Privacidade
        </button>.
      </p>
      <button className="confirm-btn" data-testid="checkout-submit" onClick={submit} disabled={loading || lojaFechada}
        style={lojaFechada?{opacity:0.6,cursor:'not-allowed'}:undefined}>
        {lojaFechada ? '🔒 Loja fechada no momento' : (loading ? 'Enviando...' : `Confirmar via WhatsApp • ${view.total}`)}
      </button>
      <Suspense fallback={null}>
        {mostrarPrivacidade && <PrivacidadeScreen onClose={() => setMostrarPrivacidade(false)} />}
      </Suspense>
    </div>
  );
}
