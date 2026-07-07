/* components/checkout/CheckoutPage.jsx — REF-APP-01 · Onda 5.3 (move puro do App.jsx L81-206).
   Pagina de checkout: formulario + orquestracao do submit. Logica de negocio ja isolada no order-domain
   (Onda 5.2): consome buildOrderArgs/buildWhatsAppMessage/buildCheckoutView de utils/orderPayload.js e
   DS.savePedido de services/DataService.js. NAO importa pricing/addons/format direto (G-CK2). newRequestId
   (utils/ids) e STORAGE_KEYS (constants) sao dependencias PRE-EXISTENTES do submit (idempotency key/localStorage). */
import { useState, useRef } from 'react';
import { STORAGE_KEYS } from '../../constants/storage.js';
import { newRequestId } from '../../utils/ids.js';
import { buildOrderArgs, buildWhatsAppMessage, buildCheckoutView } from '../../utils/orderPayload.js';
import { DS } from '../../services/DataService.js';

export function CheckoutPage({ cart, onBack, onSuccess }) {
  const [form, setForm] = useState({nome:'',telefone:'',endereco:'',pagamento:'dinheiro',troco:'',obs:''});
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
    console.log('[ENCANTO] Finalizar Pedido clicado. cart.items=', cart.items, 'total=', cart.total);
    setErr('');
    if (!form.nome||!form.telefone||!form.endereco) { setErr('Preencha nome, telefone e endereço.'); return; }
    /* Validação de telefone alinhada ao servidor (normalize_phone): DDD + número = ≥10 dígitos.
       Impede que telefone inválido chegue à RPC create_order (que rejeitaria com rollback). */
    const digits = form.telefone.replace(/\D/g, '');
    if (digits.length < 10) { setErr('Informe um telefone válido com DDD (mínimo 10 dígitos).'); return; }
    if (cart.items.length === 0) { console.warn('[ENCANTO] Carrinho vazio ao finalizar!'); }
    submittingRef.current = true;
    setLoading(true);
    if (!requestIdRef.current) {   // HARDEN-06: idempotency key durável (cobre retry/remontagem) via localStorage
      requestIdRef.current = localStorage.getItem(STORAGE_KEYS.REQ_ID) || newRequestId();
      try { localStorage.setItem(STORAGE_KEYS.REQ_ID, requestIdRef.current); } catch (e) {}
    }
    /* Montagem do pedido no order-domain (Onda 5.2 · Trilha B): buildOrderArgs concentra a
       lógica pura que antes vivia inline aqui (precoUnitario por item, product_id uuid/null,
       contratos null). Σ(price*quantity) reconcilia com orders.total. */
    const { customer, order, items } = buildOrderArgs(cart, form, requestIdRef.current);
    /* GATE (fonte única de verdade): a persistência bem-sucedida é o evento que autoriza TODAS as ações
       seguintes. savePedido devolve o order_id em sucesso, ou null em falha (validação/rollback/timeout). */
    const orderId = await DS.savePedido(customer, order, items, requestIdRef.current);
    if (!orderId) {
      /* Falha de persistência: interrompe o fluxo. NÃO conta fidelidade, NÃO limpa carrinho,
         NÃO executa onSuccess, NÃO mostra sucesso. Preserva requestId (retry reusa a MESMA
         idempotency key) e mantém o formulário intacto para nova tentativa. */
      setLoading(false);
      submittingRef.current = false;
      setErr('Não foi possível registrar seu pedido. Confira o telefone e tente novamente.');
      return;
    }
    /* Incrementar contador de fidelidade (somente após o pedido PERSISTIDO com sucesso) */
    if (localStorage.getItem(STORAGE_KEYS.LOYALTY_ENABLED) !== 'false') {
      const required = parseInt(localStorage.getItem(STORAGE_KEYS.LOYALTY_REQUIRED)||'10');
      const cur      = parseInt(localStorage.getItem(STORAGE_KEYS.LOYALTY_COUNT)||'0');
      /* Não ultrapassar o limite — cliente deve resgatar antes de acumular mais */
      if (cur < required) {
        const next = cur + 1;
        localStorage.setItem(STORAGE_KEYS.LOYALTY_COUNT, String(next));
        /* Se atingiu o limite, marcar reward_available */
        if (next >= required) {
          localStorage.setItem(STORAGE_KEYS.LOYALTY_REWARD_AVAILABLE, 'true');
        }
      }
    }
    const msg = buildWhatsAppMessage(cart, form);
    setLoading(false);
    submittingRef.current = false;
    requestIdRef.current = null;   // próximo pedido recebe nova idempotency key
    try { localStorage.removeItem(STORAGE_KEYS.REQ_ID); } catch (e) {}
    cart.clear();
    onSuccess(msg);
  };
  const view = buildCheckoutView(cart);   // Onda 5.2: resumo consome o view-model do order-domain (não recalcula preço)
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
        <div className="summary-total"><span>Total</span><span>{view.total}</span></div>
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
      {err&&<p style={{color:'var(--red)',fontSize:13,marginBottom:8}}>{err}</p>}
      <button className="confirm-btn" onClick={submit} disabled={loading}>
        {loading ? 'Enviando...' : `Confirmar via WhatsApp • ${view.total}`}
      </button>
    </div>
  );
}
