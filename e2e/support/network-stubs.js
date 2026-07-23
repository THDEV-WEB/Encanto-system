/* e2e/support/network-stubs.js — REF-E2E-01.
   Intercepta, via page.route(), APIs de terceiro que o app chama e que não são o alvo do teste —
   evita flakiness por causa de serviço público fora do ar/rate-limited, e permite testar a MECÂNICA
   de UI de fluxos (ex.: login por e-mail) sem depender de nenhum backend real. Nunca mocka o próprio
   Supabase de dados (categorias/produtos) — isso é responsabilidade do ambiente (.env.e2e), não de
   um stub de rede.

   URLs replicadas byte-a-byte dos clientes reais (src/address/services/viaCepService.js e
   nominatimService.js) — se esses endpoints mudarem lá, este arquivo precisa acompanhar. */

/** Endereço encontrado por padrão nos stubs de CEP/geocoding (Timbó/SC — mesma cidade dos clientes reais). */
export const ENDERECO_FIXTURE = {
  cep: '89120000',
  logradouro: 'Rua Fixture de Teste',
  bairro: 'Centro',
  localidade: 'Timbó',
  uf: 'SC',
};

/** Stub do ViaCEP (`GET https://viacep.com.br/ws/<cep>/json/`) — resposta fixa, sem rede real. */
export async function mockViaCep(page, resposta = ENDERECO_FIXTURE) {
  await page.route('https://viacep.com.br/ws/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resposta) })
  );
}

/** Stub do Nominatim (busca + reverse-geocode) — sempre devolve 1 resultado fixo em Timbó/SC. */
export async function mockNominatim(page) {
  const resultado = [{
    lat: '-26.8283', lon: '-49.2686',
    display_name: 'Rua Fixture de Teste, Centro, Timbó, SC, Brasil',
    address: { road: 'Rua Fixture de Teste', suburb: 'Centro', city: 'Timbó', state: 'Santa Catarina', country: 'Brasil' },
  }];
  await page.route('https://nominatim.openstreetmap.org/search**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resultado) })
  );
  await page.route('https://nominatim.openstreetmap.org/reverse**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resultado[0]) })
  );
}

/** Dígito fixo usado pelo stub de e-mail-OTP abaixo — qualquer spec que mocka o backend de auth
    confirma com este código (nunca um código real chega a existir, então o valor é arbitrário). */
export const OTP_FIXTURE = '123456';

/* Stub do backend de autenticação do Supabase (dbCliente) — cobre a MECÂNICA de UI do login por
   e-mail (envio de código, cooldown, erro, confirmação) sem depender de e-mail real nem de projeto
   Supabase nenhum. `falharEnvio`/`falharConfirmacao` simulam os caminhos de erro da tela. */
export async function mockEmailOtpAuth(page, { falharEnvio = false, falharConfirmacao = false } = {}) {
  await page.route('**/auth/v1/otp**', (route) => {
    if (falharEnvio) {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'rate_limit', message: 'Muitas tentativas, tente mais tarde.' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/auth/v1/verify**', (route) => {
    if (falharConfirmacao) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'otp_expired', message: 'Código inválido ou expirado.' }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'e2e-fixture-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'e2e-fixture-refresh-token',
        user: { id: 'e2e-fixture-user-id', email: 'e2e-fixture@teste.encanto.local', app_metadata: {}, user_metadata: {} },
      }),
    });
  });
}

/* Stub do disparo do OAuth do Google — o próprio clique já é a asserção (nunca chega a abrir a tela
   real do Google). Verifica o parâmetro provider=google dentro do handler (mais robusto que tentar
   casar a query string inteira num glob). Ver docs/adr/REF-E2E-01-auditoria-playwright.md §Estratégia
   de autenticação. */
export async function mockGoogleOAuthTrigger(page) {
  let chamado = false;
  await page.route('**/auth/v1/authorize**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('provider') === 'google') chamado = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return { foiChamado: () => chamado };
}
