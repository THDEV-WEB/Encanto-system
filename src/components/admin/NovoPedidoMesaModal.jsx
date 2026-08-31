/* components/admin/NovoPedidoMesaModal.jsx — REF-MESA-01 · Onda 4.
   Modal de criação manual de pedido de Mesa pelo operador/garçom -- canal "admin_garcom", só
   habilitado quando a loja liga mesa_canal_admin (get_mesa_config). Reaproveita a MESMA RPC
   create_order (via DS.savePedidoAdmin, que usa buildStoreRpcParam/loja ATIVA do Admin — não a de
   DS.savePedido, que só funciona no bundle do cliente) — nunca um segundo mecanismo de persistência
   de pedido, regra explícita desta REF.

   Escopo desta Onda (MVP funcional, não a comanda visual do Admin — ver checkpoint): produto + qtd +
   tamanho (quando o produto tiver `tamanhos`), sem seleção de adicionais pagos ainda (o preço deles
   só é cobrado quando enviados em `adicionais`, que este formulário não monta — o garçom pode anotar
   pedidos especiais no campo de observação por item, mas isso NÃO gera cobrança extra; gap conhecido,
   registrado no checkpoint/relatório final, não é um bug desta REF). Preço/total mostrados aqui são
   só ESTIMATIVA (igual ao checkout do cliente) — o servidor sempre recalcula e é quem manda de verdade
   (_resolve_item_pricing, create_order).

   Chrome do modal em estilo inline, mesmo padrão de comanda/ComandaModal.jsx (não depende do index.css). */
import { useEffect, useState } from 'react';
import { DS } from '../../services/DataService.js';
import { newRequestId } from '../../utils/ids.js';
import { fmt } from '../../utils/format.js';

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(20,14,10,.55)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const card = {
  background: '#fff', borderRadius: 16, width: 'min(560px, 96vw)', maxHeight: '92vh',
  display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 18px 50px rgba(0,0,0,.35)',
};
const head = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 16px', borderBottom: '1px solid #E8DCC8',
};
const body = { padding: 16, overflow: 'auto', flex: 1 };
const foot = { display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid #E8DCC8' };
const btn = (bg, fg, disabled) => ({
  border: 'none', borderRadius: 10, padding: '10px 16px', fontSize: 14, fontWeight: 700,
  cursor: disabled ? 'not-allowed' : 'pointer', background: bg, color: fg, fontFamily: 'inherit',
  opacity: disabled ? 0.6 : 1,
});
const PAGAMENTOS = [
  { id: 'dinheiro', label: 'Dinheiro' }, { id: 'pix', label: 'PIX' },
  { id: 'cartao_debito', label: 'Débito' }, { id: 'cartao_credito', label: 'Crédito' },
];

function precoBase(p, tamanhoLabel) {
  if (tamanhoLabel && Array.isArray(p.tamanhos)) {
    const t = p.tamanhos.find(t => t.label === tamanhoLabel);
    if (t) return Number(t.preco);
  }
  return Number(p.preco_promo || p.preco || 0);
}

export function NovoPedidoMesaModal({ onClose, onCriado }) {
  const [produtos, setProdutos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [itens, setItens] = useState([]); // { productId, nome, tamanhoLabel, qty, precoUnit, obs }
  const [mesaIdentificador, setMesaIdentificador] = useState('');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [pagamento, setPagamento] = useState('dinheiro');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    DS.getAllProds().then(p => { if (vivo) { setProdutos((p ?? []).filter(x => x.disponivel !== false)); setCarregando(false); } });
    return () => { vivo = false; };
  }, []);

  const filtrados = busca.trim()
    ? produtos.filter(p => p.nome?.toLowerCase().includes(busca.trim().toLowerCase()))
    : produtos;

  const adicionarItem = (p, tamanhoLabel) => {
    setItens(list => [...list, {
      productId: p.id, nome: p.nome, tamanhoLabel: tamanhoLabel || null,
      qty: 1, precoUnit: precoBase(p, tamanhoLabel), obs: '',
    }]);
  };
  const removerItem = (idx) => setItens(list => list.filter((_, i) => i !== idx));
  const mudarQty = (idx, qty) => setItens(list => list.map((it, i) => i === idx ? { ...it, qty: Math.max(1, qty) } : it));
  const mudarObs = (idx, obs) => setItens(list => list.map((it, i) => i === idx ? { ...it, obs } : it));

  const totalEstimado = itens.reduce((s, it) => s + it.precoUnit * it.qty, 0);

  const submit = async () => {
    setErro('');
    if (!mesaIdentificador.trim()) { setErro('Informe o número da mesa.'); return; }
    if (!nome.trim() || !telefone.trim()) { setErro('Preencha nome e telefone do cliente.'); return; }
    if (itens.length === 0) { setErro('Adicione ao menos um item.'); return; }
    setEnviando(true);
    const customer = { name: nome.trim(), phone: telefone.trim() };
    const order = {
      total: totalEstimado, status: 'recebido', payment_method: pagamento,
      observacoes: null, delivery_fee: 0, maquininha_fee: 0,
      tipo_pedido: 'mesa', origem_pedido: 'admin_garcom', mesa_identificador: mesaIdentificador.trim(),
    };
    const items = itens.map(it => ({
      product_id: it.productId, nome_produto: it.nome, quantity: it.qty,
      price: it.precoUnit, preco_unitario: it.precoUnit, adicionais: [],
      observacoes: it.obs || null, tamanho_label: it.tamanhoLabel,
    }));
    const requestId = newRequestId();
    const resultado = await DS.savePedidoAdmin(customer, order, items, requestId);
    setEnviando(false);
    if (!resultado.orderId) {
      setErro('Não foi possível criar o pedido. Confira os dados e tente novamente.');
      return;
    }
    onCriado?.();
    onClose();
  };

  return (
    <div style={overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Novo pedido de mesa">
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <strong style={{ fontSize: 15 }}>🍽️ Novo pedido de mesa</strong>
          <button style={btn('#F1EADF', '#6B5D50')} onClick={onClose}>Fechar</button>
        </div>
        <div style={body}>
          <div className="form-group">
            <label className="form-label" htmlFor="admin-mesa-numero">Número da mesa *</label>
            <input id="admin-mesa-numero" className="form-input" placeholder="Ex.: 07"
              value={mesaIdentificador} onChange={e => setMesaIdentificador(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label" htmlFor="admin-mesa-nome">Nome do cliente *</label>
              <input id="admin-mesa-nome" className="form-input" value={nome} onChange={e => setNome(e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label" htmlFor="admin-mesa-telefone">Telefone *</label>
              <input id="admin-mesa-telefone" className="form-input" placeholder="(38) 99999-9999"
                value={telefone} onChange={e => setTelefone(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" id="admin-mesa-pagamento-label">Forma de pagamento</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="radiogroup" aria-labelledby="admin-mesa-pagamento-label">
              {PAGAMENTOS.map(o => (
                <button key={o.id} type="button" role="radio" aria-checked={pagamento === o.id}
                  style={btn(pagamento === o.id ? '#A62786' : '#F1EADF', pagamento === o.id ? '#fff' : '#6B5D50')}
                  onClick={() => setPagamento(o.id)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Itens do pedido</label>
            <input className="form-input" placeholder="Buscar produto…" value={busca} onChange={e => setBusca(e.target.value)} style={{ marginBottom: 8 }} />
            {carregando ? <p style={{ fontSize: 13, color: 'var(--gray-500,#6B5D50)' }}>Carregando produtos…</p> : (
              <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid #E8DCC8', borderRadius: 10 }}>
                {filtrados.slice(0, 30).map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', borderBottom: '1px solid #F1EADF' }}>
                    <span style={{ fontSize: 13 }}>{p.nome} — {fmt(Number(p.preco_promo || p.preco || 0))}</span>
                    {Array.isArray(p.tamanhos) && p.tamanhos.length > 0 ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {p.tamanhos.map(t => (
                          <button key={t.label} type="button" style={btn('#F1EADF', '#6B5D50')} onClick={() => adicionarItem(p, t.label)}>
                            + {t.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button type="button" style={btn('#F1EADF', '#6B5D50')} onClick={() => adicionarItem(p, null)}>+ Adicionar</button>
                    )}
                  </div>
                ))}
                {filtrados.length === 0 && <p style={{ fontSize: 13, color: 'var(--gray-500,#6B5D50)', padding: 10 }}>Nenhum produto encontrado.</p>}
              </div>
            )}
          </div>

          {itens.length > 0 && (
            <div className="form-group">
              <label className="form-label">Resumo</label>
              {itens.map((it, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, flex: '1 1 160px' }}>{it.nome}{it.tamanhoLabel ? ` (${it.tamanhoLabel})` : ''}</span>
                  <input type="number" min="1" className="form-input" style={{ width: 60 }} value={it.qty}
                    onChange={e => mudarQty(idx, Number(e.target.value) || 1)} />
                  <input className="form-input" style={{ flex: '1 1 140px' }} placeholder="Observação (opcional)"
                    value={it.obs} onChange={e => mudarObs(idx, e.target.value)} />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{fmt(it.precoUnit * it.qty)}</span>
                  <button type="button" style={btn('transparent', '#B91C1C')} onClick={() => removerItem(idx)}>✕</button>
                </div>
              ))}
              <div style={{ textAlign: 'right', fontWeight: 800, fontSize: 15, marginTop: 6 }}>Total estimado: {fmt(totalEstimado)}</div>
              <p style={{ fontSize: 11, color: 'var(--gray-500,#6B5D50)', marginTop: 4 }}>
                O valor final é sempre confirmado pelo servidor ao salvar (mesma regra do checkout do cliente).
              </p>
            </div>
          )}

          {erro && <p role="alert" style={{ color: 'var(--red,#B91C1C)', fontSize: 13, marginTop: 8 }}>{erro}</p>}
        </div>
        <div style={foot}>
          <button style={btn('#F1EADF', '#6B5D50')} onClick={onClose}>Cancelar</button>
          <button style={btn('#A62786', '#fff', enviando)} disabled={enviando} onClick={submit}>
            {enviando ? 'Enviando…' : 'Criar pedido'}
          </button>
        </div>
      </div>
    </div>
  );
}
