/* hooks/useMesaFromQuery.js — REF-MESA-01 · Onda 3 (canal QR) + REF-MESA-02 · Onda 5 (QR protegido).
   Le o parametro `?mesa_token=` da URL UMA VEZ no boot da loja (o app nao usa router de URL --
   StoreApp troca de tela por estado interno, `page`, entao a URL so muda por navegacao do navegador
   em si, nunca pelo app -- ler no mount cobre exatamente o cenario real: cliente escaneia o QR da
   mesa, o navegador abre a loja com ?mesa_token=<uuid> na URL, essa leitura acontece uma vez e pronto).

   REF-MESA-02 · Onda 5: o parametro deixou de ser `?mesa=<numero>` (texto previsivel, sem prova de
   posse -- achado mais grave da auditoria, R3) e passou a ser `?mesa_token=<uuid opaco>`. Este hook
   NUNCA usa o valor da URL como identificador da mesa diretamente -- sempre resolve no servidor via
   resolver_mesa_por_token() antes de aplicar qualquer coisa. O numero da mesa que aparece na tela
   depois vem do que o SERVIDOR devolveu, nunca do texto da URL.

   NAO resolve loja por si so: o token, uma vez validado, ja devolve o proprio store_id (RPC publica,
   sem exigir sessao) -- mas o app continua usando resolve_store_from_origin()/o subdominio normal
   pra tudo mais; o valor de store_id do token so serve pra conferencia (se um dia divergir do
   dominio carregado, o proprio create_order() ja rejeita no servidor por tenant mismatch).

   So aplica automaticamente (deliveryMode='mesa' + mesaIdentificador + mesaQrToken) quando a loja TEM
   o canal QR habilitado (mesaConfig.canal_qr) — enquanto mesaConfig ainda carrega (1º render,
   undefined), NAO aplica ainda; reavalia sozinho quando mesaConfig chegar. Token invalido/mesa nao
   encontrada -> falha silenciosa (nao aplica nada, comportamento identico a nao ter ?mesa_token= na
   URL -- nunca revela ao usuario final se o token era "quase" valido). Nunca sobrescreve uma escolha
   que o cliente já tenha feito manualmente depois do 1º carregamento (guarda `aplicadoRef`). */
import { useEffect, useRef } from 'react';
import { resolverMesaPorToken } from '../services/mesa/mesasFisicas.js';

export function useMesaFromQuery(mesaConfig, setDeliveryMode, setMesaIdentificador, setOrigemPedido, setMesaQrToken) {
  const aplicadoRef = useRef(false);
  const tokenDaUrlRef = useRef(undefined);
  if (tokenDaUrlRef.current === undefined) {
    try {
      const params = new URLSearchParams(window.location.search);
      const valor = params.get('mesa_token');
      tokenDaUrlRef.current = valor ? valor.trim() : null;
    } catch { tokenDaUrlRef.current = null; }
  }

  useEffect(() => {
    if (aplicadoRef.current) return;                    // já aplicado (ou decidido que não aplica) uma vez
    if (!tokenDaUrlRef.current) { aplicadoRef.current = true; return; }   // sem ?mesa_token= na URL
    if (!mesaConfig || mesaConfig.canal_qr !== true) return;   // aguarda mesaConfig carregar / canal desligado
    aplicadoRef.current = true;
    let vivo = true;
    resolverMesaPorToken(tokenDaUrlRef.current).then((r) => {
      if (!vivo || !r || r.ok !== true) return;   // token invalido/mesa nao encontrada -- nao aplica nada
      setDeliveryMode('mesa');
      setMesaIdentificador(r.mesa_identificador);
      setOrigemPedido('qr_mesa');
      setMesaQrToken(tokenDaUrlRef.current);
    });
    return () => { vivo = false; };
  }, [mesaConfig, setDeliveryMode, setMesaIdentificador, setOrigemPedido, setMesaQrToken]);
}
