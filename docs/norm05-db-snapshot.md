# NORM-05 — Snapshot do banco (public.adicionais)

Congelado após a migração de fonte única. Qualquer alteração futura no schema/dados fica evidente no diff deste arquivo.

- **Total de registros:** 35

## Por grupo
- acai: 15
- chocolates: 2
- frutas_premium: 3
- marmita: 5
- premium: 4
- simples: 6

## Por aplica_categoria_id
- (null=todas): 20
- c3: 15

## Por tipo
- gratis: 12
- pago: 23

## CHECK vigente (grupo)
```
CHECK ((grupo = ANY (ARRAY['simples'::text, 'premium'::text, 'frutas_premium'::text, 'chocolates'::text, 'acai'::text, 'marmita'::text, 'bebida'::text])))
```
