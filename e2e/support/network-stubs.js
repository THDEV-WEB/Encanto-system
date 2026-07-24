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

/* Stub da troca de e-mail (Minha Conta, REF-E2E-02 Onda 3) — intercepta só o PUT em `/auth/v1/user`
   (endpoint que `auth.updateUser({email})` usa; GET no mesmo path — ex.: restauração de sessão —
   passa direto via `route.continue()`). Achado ao rodar o spec real pela 1ª vez: e-mails `.local`
   (convenção de todos os fixtures deste projeto) são rejeitados pela validação de domínio do próprio
   Supabase (`email_address_invalid`), e mesmo com um domínio válido (`example.com`) o envio de verdade
   esbarra rápido no rate limit de e-mail do plano free (`over_email_send_rate_limit`, sem SMTP
   customizado) — o MESMO recurso escasso que já motivou mockar o OTP por e-mail (ver
   docs/adr/REF-E2E-01-auditoria-playwright.md §Estratégia de autenticação). O teste cobre a mecânica
   da UI (chega em "confirmação enviada"), não o envio real. */
export async function mockEmailChangeAuth(page) {
  await page.route('**/auth/v1/user', (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'e2e-fixture-user-id', email: 'e2e-cliente@teste.encanto.local', app_metadata: {}, user_metadata: {} }),
    });
  });
}

/* Stub do upload de imagem (ImageUploader.jsx, Admin/Produtos — REF-E2E-03 · Onda 4). Decisão da
   auditoria (ADR §7.1): o bucket `products` não existe no projeto de E2E (Storage não é dumpável
   junto do schema Postgres — ver §1.8) — mockar via page.route cobre a MECÂNICA da UI (preview
   atualiza, onUpload dispara, produto salva a URL) sem provisionar Storage real. Intercepta só o POST
   de upload (`storage-js` chama `POST {url}/object/{bucket}/{path}`); `getPublicUrl` é síncrono/local
   (nunca faz rede), então o front constrói uma URL pública real (mesmo formato de produção) a partir
   do nome de arquivo gerado localmente — não precisa ser mockada à parte. */
export async function mockImageUpload(page) {
  await page.route('**/storage/v1/object/products/**', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Id: 'e2e-fixture-upload-id', Key: 'products/e2e-fixture-upload.jpg' }),
    });
  });
}
