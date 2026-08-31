/* hooks/useMesaFromQuery.js — REF-MESA-01 · Onda 3 (canal QR).
   Le o parametro `?mesa=` da URL UMA VEZ no boot da loja (o app nao usa router de URL -- StoreApp
   troca de tela por estado interno, `page`, entao a URL so muda por navegacao do navegador em si,
   nunca pelo app -- ler no mount cobre exatamente o cenario real: cliente escaneia o QR da mesa,
   o navegador abre a loja com ?mesa=07 na URL, essa leitura acontece uma vez e pronto).

   NAO resolve loja nenhuma: o QR aponta pro MESMO subdominio por-tenant que a loja ja usa (ver
   useStorefrontStore/resolve_store_from_origin) -- este hook so extrai o numero da mesa, nunca um
   store_id (zero superficie pra manipulacao cross-tenant via URL, porque nao ha nada de tenant no
   parametro pra adulterar).

   So aplica automaticamente (deliveryMode='mesa' + mesaIdentificador) quando a loja TEM o canal QR
   habilitado (mesaConfig.canal_qr) — enquanto mesaConfig ainda carrega (1º render, undefined), NAO
   aplica ainda (evita aplicar e depois ter que desfazer se o servidor disser "false" um instante
   depois); reavalia sozinho quando mesaConfig chegar. Nunca sobrescreve uma escolha que o cliente já
   tenha feito manualmente depois do 1º carregamento (guarda `aplicadoRef`). */
import { useEffect, useRef } from 'react';

export function useMesaFromQuery(mesaConfig, setDeliveryMode, setMesaIdentificador, setOrigemPedido) {
  const aplicadoRef = useRef(false);
  const mesaDaUrlRef = useRef(undefined);
  if (mesaDaUrlRef.current === undefined) {
    try {
      const params = new URLSearchParams(window.location.search);
      const valor = params.get('mesa');
      mesaDaUrlRef.current = valor ? valor.trim().slice(0, 40) : null;
    } catch { mesaDaUrlRef.current = null; }
  }

  useEffect(() => {
    if (aplicadoRef.current) return;               // já aplicado (ou decidido que não aplica) uma vez
    if (!mesaDaUrlRef.current) { aplicadoRef.current = true; return; }   // sem ?mesa= na URL
    if (!mesaConfig || mesaConfig.canal_qr !== true) return;   // aguarda mesaConfig carregar / canal desligado
    aplicadoRef.current = true;
    setDeliveryMode('mesa');
    setMesaIdentificador(mesaDaUrlRef.current);
    setOrigemPedido('qr_mesa');
  }, [mesaConfig, setDeliveryMode, setMesaIdentificador, setOrigemPedido]);
}
