# REF-ADDRESS-GEO-INTEGRITY-01 — Integridade endereço ↔ coordenadas

## Onda 1 — Auditoria (achado colateral da REF-DELIVERY-FEE-04)

**Status: investigação concluída, somente leitura. Nenhum código alterado.**

### Achado

`save_structured_address` grava `latitude`/`longitude` exatamente como o client envia, sem
validação cruzando essas coordenadas contra `rua`/`bairro`/`cidade`/`cep`. `_resolve_delivery_fee`
(`REF-DELIVERY-FEE-04`) usa essas coordenadas como fonte autoritativa de distância/taxa, sem
revalidar. O único filtro de plausibilidade existente (`enderecoPlausivel.js`) roda inteiramente no
client, dentro do autocomplete — nunca protege a RPC pública.

### Reprodução (E2E, `BEGIN...ROLLBACK`, dados descartáveis)

Endereço textual real e distante + coordenada fake perto da loja → servidor cobra a faixa barata.
Coordenada fake "fora de alcance" → servidor cobra R$0,00 mesmo para endereço real vizinho da loja
(até 100% da taxa evitada, por pedido). Achado separado: `create_order()` não validava que
`endereco_id` pertence ao `customer_id` do pedido — só que pertence à mesma loja.

## Onda 2 — Mitigação (bounding box) + correção de ownership

**Status: implementada, testada em E2E. Não aplicada em produção, não pushada.**

### 1. Ataque original comprovado (Onda 1)

Ver acima — 14/14 testes de reprodução confirmaram o achado no projeto E2E dedicado, nunca em
produção.

### 2. Mitigação implementada (Parte 1 — bounding box)

`migrations/REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte1-bbox-delivery-fee.sql` — nova checagem dentro
de `_resolve_delivery_fee`, logo após calcular a distância Haversine e antes de localizar a faixa:

```sql
v_maior_ate := (SELECT max((f->>'ate')::numeric) FROM jsonb_array_elements(COALESCE(v_config->'faixas', '[]'::jsonb)) f);
v_raio_bbox_km := GREATEST(COALESCE(v_maior_ate, 0) * 3, 50);

IF v_dist_km > v_raio_bbox_km THEN
  RAISE EXCEPTION 'coordenadas de entrega implausiveis para esta loja (% km, alem do raio maximo de % km)',
    round(v_dist_km::numeric, 1), v_raio_bbox_km;
END IF;
```

A exceção propaga para o `exception when others` já existente em `create_order` (mesmo padrão de
`_resolve_item_pricing` para produto inválido) — `create_order` não precisou ser alterado por causa
disso.

### 3. Regra exata do limite geográfico (isolada por tenant)

```
raio_bbox_km = GREATEST(maior "ate" configurado NAS PRÓPRIAS faixas da loja × 3, 50)
```

**Justificativa técnica (dados reais lidos em produção, somente `SELECT`, 2026-08-30)**: a única
loja com `delivery_fee_config` completo hoje (Encanto) tem faixas de 0 a 21km (17 faixas, R$10 a
R$42). Nenhuma outra loja ativa tem config equivalente para comparar. O modelo de negócio da
plataforma é entrega local (mesma cidade/região) — nenhum cenário legítimo de delivery de comida
opera a dezenas/centenas de km do estabelecimento.

- **Multiplicador 3×** sobre a maior faixa: margem generosa para (a) imprecisão de geocoding
  legítima — o pior caso já documentado no código (`REF-DELIVERY-FEE-02`, "Rio Itajaí-Açu") foi da
  ordem de poucos km, nunca dezenas — e (b) a loja aumentar sua área de cobertura no futuro só
  ajustando as faixas, sem nova migration. Para a Encanto hoje: 21km × 3 = 63km.
- **Piso de 50km**: protege lojas novas/pequenas com faixas curtas configuradas (ex.: só até 3km) de
  um bbox apertado demais para o ruído normal de GPS/geocoding em área urbana.
- Isolado por tenant: cada loja deriva seu próprio raio das próprias faixas — nunca um número fixo
  global. Comprovado em teste (G4a/G4b): a mesma distância (~37,5km) é aceita numa loja com faixas
  longas e rejeitada como fora do range pago (mas ainda dentro do bbox, R$0) numa loja com faixas
  curtas.

### 4. Por que a bounding box NÃO fecha a manipulação fina

Dentro do raio bbox, o comportamento é **idêntico** ao anterior (decisão de negócio já tomada na
REF-DELIVERY-FEE-04 Onda 1, não alterada aqui). Um endereço textual real e distante mascarado com
coordenada fake que ainda cai **dentro** do raio real de entrega da loja (ex.: endereço a 12km
mascarado como 0,9km) **continua não coberto** — comprovado no Teste G3 desta onda, que passa
justamente confirmando esse comportamento (documentado, não um bug). Fechar esse caso exigiria
validar o **texto** do endereço contra a coordenada (geocodificação ou base de CEP/bairro),
deliberadamente fora do escopo desta Onda 2.

### 5. Correção de ownership (Parte 2)

`migrations/REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte2-ownership-endereco.sql` — novo bloco em
`create_order`, logo após `v_store_id` ser resolvido e **antes** da chamada a
`_resolve_delivery_fee` (para que um endereço rejeitado também não vaze a coordenada de outra pessoa
no cálculo da taxa):

```sql
if v_endereco_id is not null then
  if auth.uid() is not null then
    if not exists (
      select 1 from public.addresses a
      where a.id = v_endereco_id and a.store_id = v_store_id
        and (a.customer_id is null or a.customer_id in (select c.id from public.customers c where c.auth_user_id = auth.uid()))
    ) then
      v_endereco_id := null;
    end if;
  else
    if not exists (
      select 1 from public.addresses a where a.id = v_endereco_id and a.store_id = v_store_id and a.customer_id is null
    ) then
      v_endereco_id := null;
    end if;
  end if;
end if;
```

**Modelo estudado antes de alterar**: `addresses.customer_id` é atribuído por
`save_structured_address` usando `auth.uid() -> customers.auth_user_id` — nunca um parâmetro do
client. A checagem de ownership usa a **mesma fonte** (`auth.uid()`), não o `v_customer_id` do
upsert por telefone dentro de `create_order` (que pode não coincidir 1:1 com quem está logado se o
telefone digitado no checkout já existir como customer de outra pessoa — usar `auth.uid()` evita
falso-negativo nesse caso).

**Regra**: autenticado só pode usar endereço próprio ou órfão (`customer_id IS NULL` — preserva o
fluxo de "salvei o endereço antes de logar, no mesmo checkout"); guest só pode usar endereço órfão.
Em ambos os casos, `store_id` também é checado — fecha de quebra um efeito colateral do achado: hoje
um `endereco_id` de outra loja era aceito e gravado em `orders.endereco_id` mesmo a taxa caindo no
fallback anti-enumeração. Rejeição é sempre um fallback silencioso (`v_endereco_id := NULL`) — nunca
derruba o pedido; o texto livre em `orders.address` continua intacto.

**Nota operacional**: a primeira versão desta Parte 2 foi escrita por engano sobre o corpo de
`create_order` da `REF-DELIVERY-FEE-04` Onda 1 (mais antiga), que teria revertido silenciosamente a
checagem de `divergencia_valor` da Onda 2 dessa mesma REF. Pego pela própria regressão obrigatória
desta onda (`scripts/delivery-fee-04-onda1-test.mjs`, adaptado para a mecânica de divergência,
acusou 14 falhas) — corrigido antes de aplicar em qualquer lugar além do E2E de teste. A migration
final parte da versão correta (`REF-DELIVERY-FEE-04-onda2-transparencia-valor.sql`).

### 6. Possibilidade de solução server-authoritative (futura, não implementada)

Geocodificação server-side (validar o texto do endereço contra a coordenada via serviço externo)
fecharia a manipulação fina, mas esbarra na mesma limitação já aceita na `REF-DELIVERY-FEE-04`
Onda 1: chamada HTTP de dentro do Postgres é impraticável. Uma rota realista de médio prazo seria uma
Edge Function de geocodificação assíncrona/best-effort, com o bbox desta onda como fallback
fail-closed quando o serviço falhar — decisão de arquitetura maior, fora do escopo desta Onda 2,
explicitamente não implementada aqui (nenhuma Edge Function, API externa ou base de CEP foi criada).

### 7. Decisões pendentes

- Se/quando fechar a manipulação fina (dentro do raio real de entrega) — depende da decisão acima.
- Aplicar esta Onda 2 em produção (aguarda aprovação/deploy separados, fora deste gate).
- Nenhuma mudança na regra comercial das faixas, no cálculo Haversine, ou em qualquer outra REF.

### Arquivos

- `migrations/REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte1-bbox-delivery-fee.sql` (+ `-rollback.sql`)
- `migrations/REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte2-ownership-endereco.sql` (+ `-rollback.sql`)
- `scripts/address-geo-integrity-01-onda2-test.mjs` (novo — 14 casos, G1-G7 geografia + O8-O12
  ownership, mais G4b e O11b como sub-casos)
- `scripts/delivery-fee-04-onda1-test.mjs` (ajuste mínimo — coordenada "fora de alcance" do Caso 7
  reduzida de ~58km para ~25km, para continuar testando "fora de alcance mas plausível" em vez de
  cair na nova rejeição de coordenada grosseiramente implausível, que tem cobertura dedicada em
  G2 do teste novo)

### Testes

`scripts/address-geo-integrity-01-onda2-test.mjs` — 14/14 (projeto E2E, `BEGIN...ROLLBACK`,
dados descartáveis).

### Regressão

- `delivery-fee-04-onda1-test.mjs`: 26/26 (E2E)
- `delivery-fee-04-onda2-test.mjs`: 16/16 (E2E)
- `delivery-fee-04-onda3-test.mjs`: 5/5 (E2E)
- `price-source-01-onda1-test.mjs`: 16/16 (E2E)
- `price-source-01-onda2-test.mjs`: 15/15 (E2E)
- `price-hardening-01-test.mjs`: 14/14 (E2E)
- Checkout / fidelidade / isolamento multi-tenant (`address-onda6-orders-test.mjs`,
  `harden-orders-rls-test.mjs`, `loyalty-audit-01-onda1-test.mjs`, `saas01-onda1-authz-test.mjs`):
  **não executados nesta onda**. Esses scripts conectam em `db.env` (produção), não no projeto E2E —
  descoberto ao tentar rodar o primeiro deles (falhou cedo, `"loja nao identificada"`, sem nenhum
  `INSERT`, revertido em `ROLLBACK`). É o padrão já usado nessas REFs anteriores (sempre
  `BEGIN...ROLLBACK`, net-zero garantido), mas conflita com a restrição explícita desta onda de
  nunca tocar produção — por isso foram deliberadamente pulados, a pedido do dono, em vez de
  rodados. Lacuna de cobertura registrada aqui.

## Próximos passos (fora desta REF, não implementados)

1. Aplicar Onda 2 (Parte 1 + Parte 2) em produção (aguarda aprovação/deploy separados).
2. Rodar as regressões de checkout/fidelidade/isolamento multi-tenant puladas nesta onda — precisa de
   decisão sobre rodá-las contra produção (`BEGIN...ROLLBACK`) ou adaptar para um banco E2E.
3. Decidir sobre fechar a manipulação fina (texto ↔ coordenada) — geocodificação server-side via Edge
   Function assíncrona, ou aceitar o risco residual documentado no item 4 acima.
