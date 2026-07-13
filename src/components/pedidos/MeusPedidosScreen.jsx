/* components/pedidos/MeusPedidosScreen.jsx — REF-CLIENTE-02: area "Meus Pedidos".
   So cliente autenticado; busca pelo customer.id (vinculo seguro, nunca nome/telefone). Guest-first:
   se nao logado / sem cadastro, mostra estado amigavel (nunca quebra). Reusa ScreenModal + PedidoCard.
   Onda 1: lista. Onda 2: timeline (PedidoCard). Onda 3: detalhe/paginacao. Onda 4: recompra. */
import { useMeusPedidos } from '../../hooks/useMeusPedidos.js';
import { useAuth } from '../../hooks/useAuth.js';
import { ScreenModal } from '../menu/ScreenModal.jsx';
import { PedidoCard } from './PedidoCard.jsx';

const aviso = { fontSize: 14, color: 'var(--gray-500)', textAlign: 'center', padding: '28px 12px', lineHeight: 1.5 };

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
          {!loading && !erro && pedidos.map((p) => <PedidoCard key={p.id} pedido={p} />)}
        </>
      )}
    </ScreenModal>
  );
}
