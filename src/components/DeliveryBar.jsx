/* components/DeliveryBar.jsx — REF-UI-HEADER-02.
   Barra de Entrega/Retirada do topo da loja, EXTRAIDA do StoreApp (antes era JSX inline). Apresentacional
   e sem estado proprio: recebe tudo por prop. Duas colunas: (1) o seletor Entrega/Retirada, agora da MESMA
   familia visual do botao "Categorias" (classe compartilhada no CSS: fundo branco + borda cinza + texto
   cinza-escuro + chevron roxo, sem emoji/icone); (2) um bloco com hierarquia — ETA em cima e, embaixo, o
   endereco como ACAO DE TEXTO leve (nao mais o botao roxo chapado):
     - entrega sem endereco  -> "Selecionar endereco" (link roxo) abre o modal;
     - entrega com endereco  -> o endereco (link, clicar = Alterar/reabrir modal) + acao discreta "Limpar";
     - retirada              -> endereco fixo da loja (so leitura).
   O bloco usa flex:1 + min-width:0 + ellipsis, entao o texto encolhe sem "escapar" da area util em
   qualquer largura (correcao de responsividade). Nao altera regra de negocio (deliveryMode segue no
   StoreApp e vai ao checkout; endereco e a fonte unica do dominio Address). */
export function DeliveryBar({ deliveryMode, setDeliveryMode, endereco, temEndereco, onEditar, onLimpar, retiradaLabel }) {
  const entrega = deliveryMode === 'entrega';
  return (
    <div className="delivery-bar">
      <div className="delivery-mode-select">
        <select
          className="delivery-mode-dropdown"
          value={deliveryMode}
          onChange={e => setDeliveryMode(e.target.value)}
          aria-label="Escolher entre entrega ou retirada">
          <option value="entrega">Entrega</option>
          <option value="retirada">Retirada</option>
        </select>
      </div>

      <div className="delivery-info">
        <div className="delivery-eta">
          {entrega
            ? <>Entregar em, até <b>35–45 min</b></>
            : <>Retirar em, até <b>20 min</b></>}
        </div>

        <div className="delivery-place">
          {entrega ? (
            temEndereco ? (
              <>
                <button
                  type="button"
                  className="delivery-addr-link"
                  onClick={onEditar}
                  title="Alterar endereço de entrega">
                  {endereco.label}
                </button>
                <button
                  type="button"
                  className="delivery-addr-clear"
                  onClick={onLimpar}
                  aria-label="Remover endereço selecionado">
                  Limpar
                </button>
              </>
            ) : (
              <button type="button" className="delivery-addr-link" onClick={onEditar}>
                Selecionar endereço
              </button>
            )
          ) : (
            <span className="delivery-addr-store">{retiradaLabel}</span>
          )}
        </div>
      </div>
    </div>
  );
}
