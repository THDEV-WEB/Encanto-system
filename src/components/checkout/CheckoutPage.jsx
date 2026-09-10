/* components/checkout/CheckoutPage.jsx — REF-APP-01 · Onda 5.3 (move puro do App.jsx L81-206) + REF-CHECKOUT-02.
   Pagina de checkout: formulario + orquestracao do submit. Logica de negocio ja isolada no order-domain
   (Onda 5.2): consome buildOrderArgs/buildOrderConfirmationMessage/buildCheckoutView de utils/orderPayload.js
   e DS.savePedido de services/DataService.js. NAO importa pricing/addons/format direto (G-CK2). newRequestId
   (utils/ids) e STORAGE_KEYS (constants) sao dependencias PRE-EXISTENTES do submit (idempotency key/localStorage). */
import { useState, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { usePagamentoConfig } from '../../hooks/usePagamentoConfig.js';   // REF-PAGAMENTO-01 · Onda 5: capability de pagamento online (opt-in por loja)
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js';   // REF-COMPANY-02: nome curto na mensagem do WhatsApp
import { useBusinessHours } from '../../hooks/useBusinessHours.js';   // REF-BUSINESS-HOURS-01: bloqueio fora do horario
import { useCatalogoConfiavel } from '../../hooks/useCatalogoConfiavel.js';   // REF-PRICE-SOURCE-01 · Onda 2: bloqueio quando o catalogo caiu no mock
import { useDeliveryFeeConfig } from '../../hooks/useDeliveryFeeConfig.js';   // REF-DELIVERY-FEE-01: config da taxa por distancia
import { STORAGE_KEYS } from '../../constants/storage.js';
import { newRequestId } from '../../utils/ids.js';
import { buildOrderArgs, buildOrderConfirmationMessage, buildCheckoutView, buildDivergenciaView, buildPrecoDivergenteView } from '../../utils/orderPayload.js';
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
// REF-PAGAMENTO-01 · Onda 5/6: so' carrega o chunk (+ o SDK do Mercado Pago, la dentro) quando o
// cliente de fato escolhe pagar online -- nunca no bundle principal do checkout.
const PagamentoOnlinePage = lazy(() => import('./PagamentoOnlinePage.jsx').then(m => ({ default: m.PagamentoOnlinePage })));

export function CheckoutPage({ cart, onBack, onSuccess, deliveryMode, deliveryEta, produtosVivos, mesaIdentificador, setMesaIdentificador, origemPedido, mesaQrToken }) {
  /* REF-CLIENTE-02 (vinculo pedido<->conta): create_order reusa o customer POR TELEFONE e nunca toca
     auth_user_id. Logo o pedido so aparece em "Meus Pedidos" se o telefone do checkout casar com o do
     cadastro (que carrega o auth_user_id). Para o cliente LOGADO, a identidade vem da conta e o telefone
     fica TRAVADO (=identidade, ja coletada no 1o acesso) — garante o vinculo, sem re-orfanar o pedido.
     Guest (nao logado) segue 100% editavel: guest checkout intocado. */
  const { isLogged, customer, status } = useAuth();
  const companyInfo = useCompanyInfo();
  const pagamentoConfig = usePagamentoConfig();   // REF-PAGAMENTO-01 · Onda 5: {habilitada, public_key}
  /* REF-PAGAMENTO-01 · Onda 5: quando setado, SUBSTITUI o formulario pela tela de Pix (QR/espera) --
     o pedido ja foi criado (status 'aguardando_pagamento') nesse ponto, so falta o pagamento em si.
     onVoltar limpa e devolve pro formulario (o pedido ja criado fica orfao/nao pago, mesmo
     comportamento de qualquer checkout abandonado hoje -- create_order nao tem "cancelamento"). */
  const [pagamentoOnlinePendente, setPagamentoOnlinePendente] = useState(null); // {orderId, msg} | null
  const [mostrarPrivacidade, setMostrarPrivacidade] = useState(false); // REF-LGPD-01 · Onda 3 (LGPD-R14)
  const feeConfig = useDeliveryFeeConfig();   // REF-DELIVERY-FEE-01: config administravel (faixas/maquininha)
  /* REF-CHECKOUT-ADDRESS-01: o endereco de entrega vem da FONTE UNICA (dominio Address, mesmo objeto do
     header). O checkout NAO tem mais um endereco proprio; edita o mesmo objeto pelo mesmo AddressModal
     (abrirModal). Retirada nao usa endereco de entrega — usa o endereco da loja. */
  const { endereco, temEndereco, abrirModal } = useAddress();
  const retirada = deliveryMode === 'retirada';
  /* REF-MESA-01 · Onda 2: Mesa NAO e Retirada nem Entrega — nao usa endereco, nao calcula distancia/
     taxa, nao dispara geocoding. `semEntregaFisica` agrupa os dois casos ("sem deslocamento nenhum")
     nos pontos onde retirada e mesa se comportam IGUAL hoje (fee zerada, endereco nao obrigatorio);
     `retirada`/`mesa` continuam separados onde o TEXTO/UI difere (rotulo, campo pedido). */
  const mesa = deliveryMode === 'mesa';
  const semEntregaFisica = retirada || mesa;
  /* address continua sendo só um texto de EXIBIÇÃO (a fonte de verdade do tipo é tipo_pedido, gravado
     à parte — ver create_order na migration da Onda 1). Symmetric com o que retirada já fazia. */
  const enderecoEntrega = mesa ? ('Mesa ' + (mesaIdentificador || '').trim())
    : retirada ? ('Retirada na loja — ' + STORE_INFO.retirada)
    : (endereco?.label || '');
  /* REF-BUSINESS-HOURS-01: fora do horário oficial o cliente navega/vê preços normalmente, mas NÃO
     finaliza pedido. Mesma fonte de verdade do header (services/businessHours via useBusinessHours). */
  const horario = useBusinessHours();
  const lojaFechada = !horario.aberto;
  /* REF-PRICE-SOURCE-01 · Onda 2: catálogo em modo mock nunca autoriza checkout real — create_order()
     já rejeita no servidor (fail-closed), este gate só evita a má UX de preencher tudo para ver um
     erro genérico no fim. Mesmo padrão de bloqueio explícito já usado para "loja fechada" abaixo. */
  const catalogoConfiavel = useCatalogoConfiavel();
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
    if (semEntregaFisica || !endereco) { setCoordCliente(null); return; }
    if (Number.isFinite(endereco.lat) && Number.isFinite(endereco.lng)) {
      setCoordCliente({ lat: endereco.lat, lng: endereco.lng });
      return;
    }
    setCoordCliente(null);
    geocoding.coordenadasDe(endereco).then(c => { if (vivo) setCoordCliente(c); });
    return () => { vivo = false; };
  }, [semEntregaFisica, endereco]);
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
  /* REF-MESA-01 · Onda 2: mesa reaproveita o MESMO ramo "sem taxa" que retirada ja tinha em
     montarResumoFinanceiro (funcao INTOCADA) -- so muda o booleano que o Checkout passa pra ela,
     exatamente simetrico ao que create_order faz no servidor (ver migration da Onda 1). */
  const resumo = useMemo(() => montarResumoFinanceiro({
    subtotal: cart.total, retirada: semEntregaFisica, distanciaKm: distanciaInfo?.distanceKm ?? null, config: feeConfig, paymentMethod: form.pagamento,
  }), [cart.total, semEntregaFisica, distanciaInfo, feeConfig, form.pagamento]);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState('');   // feedback inline (mesmo padrão do AdminLogin)
  /* REF-DELIVERY-FEE-04 · Onda 2: create_order recalculou delivery_fee/maquininha_fee e o valor
     diverge do que esta tela mostrava (raro, perto de fronteira de faixa — client usa rota viária
     real, servidor só calcula haversine) — não persiste nada, exige reapresentar e confirmar de
     novo. { deliveryFee, maquininhaFee, adicionalPagamentoFee } = valores AUTORITATIVOS devolvidos
     por DS.savePedido (REF-DELIVERY-FEE-05 · Onda 2: terceiro componente incluído na mesma mecânica). */
  const [divergencia, setDivergencia] = useState(null);
  /* BUG REAL encontrado ao vivo (2026-09-10): se o cliente troca forma de pagamento (ou endereço, ou
     entrega/retirada) DEPOIS que uma divergência já foi sinalizada, a divergência antiga ficava presa
     -- o retry misturava o payment_method NOVO com maquininha_fee/adicional_pagamento_fee calculados
     pro método ANTIGO (resumoEnvio usa `divergencia.*`, não recalcula), gerando um novo desacordo com
     o servidor a cada tentativa (parecia loop infinito, números "trocados" entre maquininha/adicional).
     Qualquer input que de fato entra no cálculo do servidor (_resolve_delivery_fee) invalida a
     divergência pendente -- força reapresentar o resumo do zero, nunca reusa expectativa velha. */
  useEffect(() => { setDivergencia(null); }, [form.pagamento, semEntregaFisica, endereco]);
  const submittingRef = useRef(false);   // trava reentrância (duplo clique / envio simultâneo)
  const requestIdRef  = useRef(null);    // idempotency key (estável por tentativa de checkout)
  const upd = (k,v) => setForm(f=>({...f,[k]:v}));
  /* REF-PAGAMENTO-01 · Onda 5/6: "Pagar agora" só aparece quando a loja ligou a capability
     (opt-in, default desligado -- nenhuma loja existente ganha isso sem configurar). A escolha
     entre Pix/cartão acontece DENTRO do Payment Brick (PagamentoOnlinePage.jsx), não aqui -- esta
     é só a porta de entrada. Nunca some nenhum dos 4 métodos já existentes (COD continua 100%
     disponível, só deixa de ser o primeiro da lista quando o pagamento online está ligado --
     posicionamento pedido pelo dono ao vivo em produção, 2026-09-10: destaca a opção que confirma
     o pedido sozinha, sem depender do dono confirmar manualmente no WhatsApp). */
  const pays = [
    ...(pagamentoConfig.habilitada ? [{id:'online',label:'Pagar agora',icon:'⚡'}] : []),
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
    /* REF-PRICE-SOURCE-01 · Onda 2: catálogo não confirmado com o banco -- não finaliza pedido real. */
    if (!catalogoConfiavel) { setErr('Não foi possível confirmar o catálogo agora. Atualize a página e tente novamente em instantes.'); return; }
    if (!form.nome||!form.telefone) { setErr('Preencha nome e telefone.'); return; }
    /* Validação de telefone alinhada ao servidor (normalize_phone): DDD + número = ≥10 dígitos.
       Impede que telefone inválido chegue à RPC create_order (que rejeitaria com rollback). */
    const digits = form.telefone.replace(/\D/g, '');
    if (digits.length < 10) { setErr('Informe um telefone válido com DDD (mínimo 10 dígitos).'); return; }
    /* REF-CHECKOUT-ADDRESS-01: entrega exige endereco da fonte unica; retirada usa o endereco da loja.
       REF-MESA-01 · Onda 2: mesa nao exige endereco nenhum -- exige a identificacao da mesa. */
    if (!semEntregaFisica && !temEndereco) { setErr('Selecione seu endereço de entrega.'); return; }
    if (mesa && !mesaIdentificador?.trim()) { setErr('Informe o número da mesa.'); return; }
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
    const enderecoId = (!semEntregaFisica && endereco) ? await addressRepository.salvar(enderecoParaSalvar) : null;
    /* REF-DELIVERY-FEE-04 · Onda 2: numa CONFIRMAÇÃO (após divergência já sinalizada), declara os
       valores AUTORITATIVOS que o próprio servidor acabou de informar — nunca o resumo local (que
       gerou a divergência da 1ª tentativa) de novo, senão o servidor recalcularia e divergiria
       outra vez, num loop. O servidor SEMPRE recalcula do zero nas duas chamadas; aqui só muda o
       que o client DECLARA como expectativa. */
    const resumoEnvio = divergencia
      ? { ...resumo, deliveryFee: divergencia.deliveryFee, maquininhaFee: divergencia.maquininhaFee,
          adicionalPagamentoFee: divergencia.adicionalPagamentoFee,
          total: resumo.subtotal + divergencia.deliveryFee + divergencia.maquininhaFee + divergencia.adicionalPagamentoFee }
      : resumo;
    /* Montagem do pedido no order-domain (Onda 5.2 · Trilha B): buildOrderArgs concentra a
       lógica pura que antes vivia inline aqui (precoUnitario por item, product_id uuid/null,
       contratos null). Σ(price*quantity) reconcilia com orders.total. */
    /* REF-MESA-01 · Onda 2: tipo_pedido/mesa_identificador viajam explicitos no p_order -- create_order
       valida a capacidade da loja no servidor (fail-closed) antes de aceitar 'mesa'. Ausentes (entrega/
       retirada) preservam 100% o payload de antes desta REF.
       REF-MESA-01 · Onda 3: origemPedido (prop, vem de StoreApp -> useMesaFromQuery) só é 'qr_mesa'
       quando o pedido nasceu de um link de QR escaneado -- create_order valida esse canal também.
       REF-MESA-02 · Onda 5: origemPedido='qr_mesa' SEMPRE viaja junto com mesaQrToken -- create_order
       ignora mesaIdentificador do payload nesse canal e resolve a mesa a partir do token (prova de
       posse do QR físico). mesaIdentificador continua enviado por compatibilidade/exibição, mas
       nunca é a fonte de verdade quando há token. */
    /* REF-PAGAMENTO-01 · Onda 5: pedido pago online nasce 'aguardando_pagamento' (nunca 'recebido' --
       a loja so deve ser notificada/comecar a preparar DEPOIS da confirmacao real do pagamento, ver
       PagamentoOnlinePage.jsx). */
    const pagamentoOnline = form.pagamento === 'online';
    const extraPedido = {
      ...(mesa ? { tipoPedido: 'mesa', mesaIdentificador: mesaIdentificador.trim(), origemPedido,
          ...(origemPedido === 'qr_mesa' && mesaQrToken ? { mesaQrToken } : {}) } : {}),
      ...(pagamentoOnline ? { status: 'aguardando_pagamento' } : {}),
    };
    const { customer: customerPedido, order, items } = buildOrderArgs(cart, form, enderecoEntrega, requestIdRef.current, enderecoId, resumoEnvio, extraPedido);
    /* GATE (fonte única de verdade): a persistência bem-sucedida é o evento que autoriza TODAS as ações
       seguintes. savePedido devolve { orderId, divergencia, deliveryFee, maquininhaFee }. */
    const resultado = await DS.savePedido(customerPedido, order, items, requestIdRef.current);
    if (resultado.divergencia) {
      /* REF-DELIVERY-FEE-04 · Onda 2: NÃO é falha — servidor recusou persistir silenciosamente um
         valor diferente do apresentado. Reapresenta o valor autoritativo e exige nova confirmação;
         preserva requestId (mesma idempotency key) e o formulário intacto. */
      setLoading(false);
      submittingRef.current = false;
      setDivergencia({ deliveryFee: resultado.deliveryFee, maquininhaFee: resultado.maquininhaFee, adicionalPagamentoFee: resultado.adicionalPagamentoFee });
      registrarBreadcrumb('checkout: valor de entrega divergente, aguardando confirmação', {
        deliveryFeeAntigo: resumo.deliveryFee, deliveryFeeNovo: resultado.deliveryFee,
        maquininhaFeeAntigo: resumo.maquininhaFee, maquininhaFeeNovo: resultado.maquininhaFee,
        adicionalPagamentoFeeAntigo: resumo.adicionalPagamentoFee, adicionalPagamentoFeeNovo: resultado.adicionalPagamentoFee,
      });
      return;
    }
    if (!resultado.orderId) {
      /* Falha de persistência: interrompe o fluxo. NÃO conta fidelidade, NÃO limpa carrinho,
         NÃO executa onSuccess, NÃO mostra sucesso. Preserva requestId (retry reusa a MESMA
         idempotency key) e mantém o formulário intacto para nova tentativa. */
      setLoading(false);
      submittingRef.current = false;
      setErr('Não foi possível registrar seu pedido. Confira o telefone e tente novamente.');
      registrarBreadcrumb('checkout: falha ao persistir pedido', { itens: cart.items.length, retirada, tipoPedido: deliveryMode });
      return;
    }
    const orderId = resultado.orderId;
    setDivergencia(null);
    registrarBreadcrumb('checkout: pedido criado', { orderId, itens: cart.items.length, retirada, tipoPedido: deliveryMode });
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
      companyInfo, troco: form.troco, enderecoEstruturado: semEntregaFisica ? null : endereco,
      deliveryEtaMin: deliveryEta,
    });
    setLoading(false);
    submittingRef.current = false;
    requestIdRef.current = null;   // próximo pedido recebe nova idempotency key
    try { localStorage.removeItem(STORAGE_KEYS.REQ_ID); } catch (e) {}
    cart.clear();
    /* REF-PAGAMENTO-01 · Onda 5: pedido já persistido (igual ao COD) — só a NOTIFICAÇÃO (WhatsApp)
       espera a confirmação real do pagamento. PagamentoOnlinePage chama este MESMO onSuccess(msg) quando
       o polling confirmar 'aprovado' — StoreApp.jsx não precisa saber que existe um caminho online. */
    if (pagamentoOnline) { setPagamentoOnlinePendente({ orderId, msg }); return; }
    onSuccess(msg);
  };
  const view = buildCheckoutView(cart, resumo);   // Onda 5.2: resumo consome o view-model do order-domain (não recalcula preço)
  /* REF-DELIVERY-FEE-01: só quebra em Subtotal/Entrega/Maquininha quando há alguma parcela a somar —
     retirada e "sem taxa" continuam com o resumo simples (itens + Total), zero mudança visual pra eles. */
  const mostrarDetalhamento = !!(view.entregaFmt || view.maquininhaFmt || view.adicionalPagamentoFmt);
  const entregaAConfirmar = !semEntregaFisica && !view.entregaFmt && (resumo.status === 'sem_coordenadas' || resumo.status === 'fora_de_alcance');
  /* REF-STORE-ONBOARD-02 · Onda 2: distinto de entregaAConfirmar (falta DISTÂNCIA) -- aqui a distância e
     a faixa existem (status 'ok', valor calculado e cobrado normalmente), só a TABELA em si ainda não é
     própria da loja (fallback da plataforma). Nunca os dois juntos (status 'ok' exclui sem_coordenadas/
     fora_de_alcance por definição de montarResumoFinanceiro). */
  const entregaConfigPadrao = !semEntregaFisica && resumo.status === 'ok' && !resumo.configuracaoPropria;
  const horarioConfigPadrao = !horario.configuracaoPropria;
  /* REF-DELIVERY-FEE-04 · Onda 2: view-model da divergência (buildDivergenciaView, G-CK2 — fmt()
     fica no order-domain, não aqui). null enquanto não houver divergência sinalizada. */
  const divergenciaView = divergencia ? buildDivergenciaView(resumo, divergencia) : null;
  /* REF-CART-PRICE-DRIFT-01: aviso não-bloqueante de preço de ITEM desatualizado no carrinho (o
     preço foi congelado quando o cliente adicionou, ver useCart.js/ProductModalInner.jsx — o
     carrinho persiste até 12h em localStorage sem revalidar). Gated por catalogoConfiavel: quando
     o catálogo caiu no mock, o banner vermelho bloqueante abaixo já cobre isso — comparar contra
     dado de mock só geraria ruído redundante. Não corrige o valor exibido (o servidor sempre
     recalcula certo em create_order() de qualquer forma) — só avisa antes do cliente ser
     surpreendido na confirmação. */
  const precoDivergenteView = catalogoConfiavel ? buildPrecoDivergenteView(cart, produtosVivos) : null;
  /* REF-PAGAMENTO-01 · Onda 5: pedido já criado, aguardando o pagamento Pix -- substitui TODO o
     formulário (não um passo a mais dentro dele) pela tela de QR/espera. */
  if (pagamentoOnlinePendente) {
    return (
      <Suspense fallback={null}>
        <PagamentoOnlinePage orderId={pagamentoOnlinePendente.orderId} msg={pagamentoOnlinePendente.msg}
          payerEmail={isLogged ? customer?.email || null : null}
          onSuccess={onSuccess} onVoltar={() => setPagamentoOnlinePendente(null)} />
      </Suspense>
    );
  }
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
        {/* REF-STORE-ONBOARD-02 · Onda 2: a taxa acima já foi calculada e será cobrada normalmente —
            este aviso só sinaliza que a tabela em si ainda é a padrão da plataforma, não muda o valor. */}
        {entregaConfigPadrao && (
          <div data-testid="checkout-entrega-config-padrao" style={{fontSize:11.5,color:'var(--gray-500)',marginTop:-6,marginBottom:6}}>
            ℹ️ Esta loja ainda está finalizando suas configurações.
          </div>
        )}
        {entregaAConfirmar && (
          <>
            <div className="summary-item"><span>Entrega</span><span>A confirmar</span></div>
            <div style={{fontSize:11.5,color:'var(--gray-500)',marginTop:-6,marginBottom:6}}>
              Vamos confirmar o valor da entrega com você antes de despachar seu pedido.
            </div>
          </>
        )}
        {view.maquininhaFmt && (
          <div className="summary-item"><span>Retorno da maquininha</span><span>{view.maquininhaFmt}</span></div>
        )}
        {view.adicionalPagamentoFmt && (
          <div className="summary-item"><span>Retorno do dinheiro ao estabelecimento</span><span>{view.adicionalPagamentoFmt}</span></div>
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
      {mesa ? (
        /* REF-MESA-01 · Onda 2: mesa nao usa o dominio Address (nao e endereco fisico) -- identificacao
           propria, estruturada (mesa_identificador na migration da Onda 1), nunca reaproveitando
           `address` como texto livre pra decidir o tipo (essa e a fragilidade que a REF elimina). */
        <div className="form-group">
          <label className="form-label" htmlFor="checkout-mesa-input">Número da mesa *</label>
          <input id="checkout-mesa-input" className="form-input" data-testid="checkout-mesa-identificador"
            placeholder="Ex.: 07" value={mesaIdentificador} onChange={e => setMesaIdentificador(e.target.value)} />
        </div>
      ) : (
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
      )}
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
            {/* REF-STORE-ONBOARD-02 · Onda 2: horário ainda não é próprio da loja (padrão da plataforma)
                -- avisa antes do cliente interpretar este fechamento como definitivo, sem mudar o bloqueio
                em si (lojaFechada continua a mesma regra). */}
            {horarioConfigPadrao && (
              <div data-testid="checkout-horario-config-padrao" style={{fontSize:12,color:'#7F1D1D',marginTop:6,lineHeight:1.5}}>
                ℹ️ Esta loja ainda está finalizando suas configurações — o horário acima pode não ser definitivo.
              </div>
            )}
          </div>
        </div>
      )}
      {!lojaFechada && horarioConfigPadrao && (
        <p data-testid="checkout-horario-config-padrao-aberta" style={{fontSize:11.5,color:'var(--gray-500)',marginBottom:12}}>
          ℹ️ Esta loja ainda está finalizando suas configurações.
        </p>
      )}
      {/* REF-PRICE-SOURCE-01 · Onda 2: catálogo não confirmado com o banco (caiu no mock) -- mesmo
          padrão visual do aviso de loja fechada acima. */}
      {!lojaFechada && !catalogoConfiavel && (
        <div data-testid="checkout-catalogo-indisponivel" style={{
          display:'flex',gap:10,alignItems:'flex-start',
          background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:12,
          padding:'12px 14px',marginBottom:12,
        }}>
          <span style={{fontSize:18,lineHeight:1.2,flexShrink:0}}>⚠️</span>
          <div>
            <div style={{fontWeight:700,fontSize:14,color:'#B91C1C',lineHeight:1.4}}>
              Não foi possível confirmar o catálogo agora.
            </div>
            <div style={{fontSize:13,color:'#7F1D1D',marginTop:3,lineHeight:1.5}}>
              Atualize a página e tente novamente em instantes.
            </div>
          </div>
        </div>
      )}
      {/* REF-CART-PRICE-DRIFT-01: preço de item do carrinho mudou desde que foi adicionado -- aviso
          informativo (âmbar), não bloqueia o submit (o servidor sempre recalcula certo). */}
      {precoDivergenteView && (
        <div data-testid="checkout-preco-divergente" role="status" style={{
          display:'flex',gap:10,alignItems:'flex-start',
          background:'#FFFBEB',border:'1px solid #FDE68A',borderRadius:12,
          padding:'12px 14px',marginBottom:12,
        }}>
          <span style={{fontSize:18,lineHeight:1.2,flexShrink:0}}>💡</span>
          <div>
            <div style={{fontWeight:700,fontSize:14,color:'#92400E',lineHeight:1.4}}>
              Alguns preços foram atualizados
            </div>
            <div style={{fontSize:13,color:'#78350F',marginTop:3,lineHeight:1.5}}>
              {precoDivergenteView.mensagem}
            </div>
          </div>
        </div>
      )}
      {/* REF-DELIVERY-FEE-04 · Onda 2: servidor recusou persistir silenciosamente um valor diferente
          do apresentado -- avisa e pede nova confirmação (botão abaixo já muda de rótulo). Tom
          informativo (âmbar), não de erro (vermelho) -- não é uma falha, é uma atualização de valor. */}
      {divergenciaView && (
        <div data-testid="checkout-divergencia-valor" role="status" style={{
          display:'flex',gap:10,alignItems:'flex-start',
          background:'#FFFBEB',border:'1px solid #FDE68A',borderRadius:12,
          padding:'12px 14px',marginBottom:12,
        }}>
          <span style={{fontSize:18,lineHeight:1.2,flexShrink:0}}>💡</span>
          <div>
            <div style={{fontWeight:700,fontSize:14,color:'#92400E',lineHeight:1.4}}>
              Atualizamos o valor da sua entrega
            </div>
            <div style={{fontSize:13,color:'#78350F',marginTop:3,lineHeight:1.5}}>
              {divergenciaView.mensagem}
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
      <button className="confirm-btn" data-testid="checkout-submit" onClick={submit} disabled={loading || lojaFechada || !catalogoConfiavel}
        style={(lojaFechada || !catalogoConfiavel)?{opacity:0.6,cursor:'not-allowed'}:undefined}>
        {lojaFechada ? '🔒 Loja fechada no momento'
          : !catalogoConfiavel ? '⚠️ Catálogo indisponível no momento'
          : divergenciaView ? (loading ? 'Enviando...' : `Continuar com novo valor • ${divergenciaView.totalFmt}`)
          /* REF-PAGAMENTO-01 · Onda 5/6: rótulo do pagamento online não promete WhatsApp -- o Brick aparece antes. */
          : form.pagamento === 'online' ? (loading ? 'Enviando...' : `Pagar agora • ${view.total}`)
          : (loading ? 'Enviando...' : `Confirmar via WhatsApp • ${view.total}`)}
      </button>
      <Suspense fallback={null}>
        {mostrarPrivacidade && <PrivacidadeScreen onClose={() => setMostrarPrivacidade(false)} />}
      </Suspense>
    </div>
  );
}
