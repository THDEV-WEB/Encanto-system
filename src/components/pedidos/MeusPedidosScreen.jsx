/* components/pedidos/MeusPedidosScreen.jsx — REF-CLIENTE-02 Onda 1: lista "Meus Pedidos".
   So cliente autenticado; busca pelo customer.id (vinculo seguro, nunca nome/telefone). Guest-first:
   se nao logado / sem cadastro, mostra estado amigavel (nunca quebra). Reusa ScreenModal + format. */
import { useMeusPedidos } from '../../hooks/useMeusPedidos.js';
import { useAuth } from '../../hooks/useAuth.js';
import { ScreenModal } from '../menu/ScreenModal.jsx';
import { fmt, fmtDate } from '../../utils/format.js';
import { statusInfo } from './pedidoStatus.js';

const numeroPedido = (id) => '#' + String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();

const resumoItens = (items) => {
  const arr = items || [];
  if (!arr.length) return 'Sem itens';
  const nomes = arr.slice(0, 3).map(i => `${i.quantity}× ${i.nome_produto}`).join(', ');
  return arr.length > 3 ? `${nomes}…` : nomes;
};

const card = { border: '1px solid var(--gray-100)', borderRadius: 14, padding: '14px 16px', marginBottom: 12, background: 'var(--white)' };
const badge = (st) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: st.cor, background: st.bg, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' });
const info = { fontSize: 13, color: 'var(--gray-500)', marginTop: 2 };
const aviso = { fontSize: 14, color: 'var(--gray-500)', textAlign: 'center', padding: '28px 12px' };

export function MeusPedidosScreen({ onClose }) {
  const { isLogged } = useAuth();
  const { pedidos, loading, erro, temCadastro } = useMeusPedidos();

  return (
    <ScreenModal title="Meus pedidos" onClose={onClose}>
      {!isLogged && <p style={aviso}>Entre na sua conta para ver seus pedidos. 🔑</p>}

      {isLogged && !temCadastro && (
        <p style={aviso}>Complete seu cadastro (nome e telefone) para acompanhar seus pedidos.</p>
      )}

      {isLogged && temCadastro && (
        <>
          {loading && <p style={aviso}>Carregando seus pedidos…</p>}
          {!loading && erro && <p style={{ ...aviso, color: 'var(--red)' }}>{erro}</p>}
          {!loading && !erro && pedidos.length === 0 && (
            <p style={aviso}>Você ainda não fez pedidos. Que tal começar agora? 💜</p>
          )}

          {!loading && !erro && pedidos.map((p) => {
            const st = statusInfo(p.status);
            return (
              <div key={p.id} style={card}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>{numeroPedido(p.id)}</strong>
                  <span style={badge(st)}>{st.icon} {st.label}</span>
                </div>
                <div style={info}>{fmtDate(p.created_at)}</div>
                <div style={{ fontSize: 13, color: 'var(--gray-700)', marginTop: 6, lineHeight: 1.4 }}>
                  {resumoItens(p.order_items)}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
                    {(p.order_items || []).length} {((p.order_items || []).length === 1) ? 'item' : 'itens'}
                  </span>
                  <strong style={{ fontSize: 16, color: 'var(--grape)' }}>{fmt(p.total)}</strong>
                </div>
              </div>
            );
          })}
        </>
      )}
    </ScreenModal>
  );
}
