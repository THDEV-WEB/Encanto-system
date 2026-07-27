/* address/utils/addressErrors.js — REF-ADDRESS-02 · Onda 5b.
   Fonte única dos estados de erro granulares do domínio (ADR §7) — puro, sem IO/DOM. Antes o hook usava
   `alert()` genérico ("GPS indisponível.", "Não foi possível obter a localização.") pra QUALQUER falha de
   localização; agora cada causa tem um tipo e uma mensagem próprios, prontos pra UI mostrar inline.
   `fora_da_area` fica de fora (depende da futura DeliveryAreaService, ainda não implementada — ADR §5). */

export const ERRO_MENSAGENS = {
  gps_desabilitado: 'GPS não disponível neste dispositivo/navegador. Busque pelo endereço ou informe o CEP.',
  permissao_negada: 'Sem permissão de localização. Ative nas configurações do navegador, ou busque pelo endereço/CEP.',
  servico_indisponivel: 'Não foi possível obter sua localização agora. Tente novamente ou busque pelo endereço/CEP.',
  sem_internet: 'Sem conexão com a internet. Verifique sua rede e tente novamente.',
};

/* GeolocationPositionError.code: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
   (https://developer.mozilla.org/docs/Web/API/GeolocationPositionError). Só o 1 tem causa/ação distinta
   (ativar permissão); 2/3 convergem pra "serviço indisponível agora, tente de novo". */
export function tipoErroGeolocalizacao(codigoErro) {
  return codigoErro === 1 ? 'permissao_negada' : 'servico_indisponivel';
}

/* Constrói o objeto de erro pronto pra UI a partir do tipo. */
export function criarErro(tipo) {
  return { tipo, mensagem: ERRO_MENSAGENS[tipo] || 'Não foi possível completar a ação. Tente novamente.' };
}
