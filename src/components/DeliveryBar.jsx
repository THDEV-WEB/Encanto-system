/* components/DeliveryBar.jsx — REF-UI-HEADER-02 + REF-MESA-01 · Onda 2.
   Barra de Entrega/Retirada/Mesa do topo da loja. Apresentacional e sem estado proprio: recebe tudo
   por prop. Duas colunas: (1) o seletor, agora da MESMA familia visual do botao "Categorias" (classe
   compartilhada no CSS: fundo branco + borda cinza + texto cinza-escuro + chevron roxo, sem
   emoji/icone); (2) um bloco com hierarquia — ETA em cima e, embaixo, o endereco/mesa como ACAO DE
   TEXTO leve (nao mais o botao roxo chapado):
     - entrega sem endereco  -> "Selecionar endereco" (link roxo) abre o modal;
     - entrega com endereco  -> valor do endereco (texto neutro) + par de acoes "Alterar"/"Limpar"
                                (mesma familia de link roxo, consistentes entre si);
     - retirada              -> endereco fixo da loja (so leitura);
     - mesa                  -> "Atendimento presencial" (so leitura, sem endereco nenhum).
   O bloco usa flex:1 + min-width:0 + ellipsis, entao o texto encolhe sem "escapar" da area util em
   qualquer largura (correcao de responsividade). Nao altera regra de negocio (deliveryMode segue no
   StoreApp e vai ao checkout; endereco e a fonte unica do dominio Address).

   REF-MESA-01 · Onda 2: a opcao "Mesa" so aparece quando `mesaHabilitada` (get_mesa_config da propria
   loja, via useMesaConfig em StoreApp) e true — lojas sem a capacidade nunca veem a opcao. Isso e so
   UX (a barreira de seguranca de verdade vive dentro de create_order, ver migration da Onda 1); um
   client adulterado poderia tentar enviar deliveryMode='mesa' mesmo sem essa opcao aparecer aqui, mas
   o servidor rejeita de qualquer forma.

   REF-MESA-02 · Onda 18: "Ver conta" só aparece com mesaQrToken presente (cliente chegou pelo QR de
   verdade) -- digitar o número da mesa manualmente nunca dá acesso à conta (mesma barreira de
   segurança de consultar_minha_conta_mesa, que só resolve pelo token opaco). */
export function DeliveryBar({ deliveryMode, setDeliveryMode, endereco, temEndereco, onEditar, onLimpar, retiradaLabel, deliveryEta, mesaHabilitada, mesaIdentificador, mesaQrToken, onVerContaMesa }) {
  const entrega = deliveryMode === 'entrega';
  const retirada = deliveryMode === 'retirada';
  return (
    <div className="delivery-bar">
      <div className="delivery-mode-select">
        <select
          className="delivery-mode-dropdown"
          value={deliveryMode}
          onChange={e => setDeliveryMode(e.target.value)}
          aria-label={mesaHabilitada ? 'Escolher entre entrega, retirada ou mesa' : 'Escolher entre entrega ou retirada'}>
          <option value="entrega">Entrega</option>
          <option value="retirada">Retirada</option>
          {mesaHabilitada && <option value="mesa">Mesa</option>}
        </select>
      </div>

      <div className="delivery-info">
        <div className="delivery-eta">
          {entrega
            ? <>Entregar em, até <b>{deliveryEta} min</b></>   /* REF-DELIVERY-01: valor da config (SSoT) */
            : retirada
            ? <>Retirar em, até <b>20 min</b></>
            : <>Pedido para {mesaIdentificador ? <>a mesa <b>{mesaIdentificador}</b></> : 'a mesa'}</>}
        </div>

        <div className="delivery-place">
          {entrega ? (
            temEndereco ? (
              <>
                <span className="delivery-addr-current" title={endereco.label}>{endereco.label}</span>
                <span className="delivery-addr-actions">
                  <button type="button" className="delivery-addr-action" onClick={onEditar}
                    aria-label="Alterar endereço de entrega">Alterar</button>
                  <span className="delivery-addr-sep" aria-hidden="true">·</span>
                  <button type="button" className="delivery-addr-action" onClick={onLimpar}
                    aria-label="Remover endereço selecionado">Limpar</button>
                </span>
              </>
            ) : (
              <button type="button" className="delivery-addr-link" onClick={onEditar}>
                Selecionar endereço
              </button>
            )
          ) : retirada ? (
            <span className="delivery-addr-store">{retiradaLabel}</span>
          ) : mesaQrToken ? (
            <button type="button" className="delivery-addr-link" onClick={onVerContaMesa} data-testid="ver-conta-mesa-link">
              🧾 Ver conta da mesa
            </button>
          ) : (
            <span className="delivery-addr-store">Atendimento presencial</span>
          )}
        </div>
      </div>
    </div>
  );
}
