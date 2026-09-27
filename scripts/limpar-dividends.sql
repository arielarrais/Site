-- Limpeza de proventos duplicados e de valores obviamente inválidos.
-- Gerado em 27/09/2026 após a correção do scraper do InvistaInfo
-- (DividendFetchingService agora lê o histórico inteiro, não só o último rendimento).
-- Seguro para rodar mais de uma vez.

BEGIN;

-- 1. Duplicatas exatas: mesmo ativo, mesma data COM, mesmo pagamento, mesmo valor e tipo.
--    Mantém a linha mais antiga (menor id) e apaga as demais.
DELETE FROM asset_dividends d
USING asset_dividends k
WHERE d.assetid = k.assetid
  AND d.comdate = k.comdate
  AND coalesce(d.paymentdate, '') = coalesce(k.paymentdate, '')
  AND coalesce(d.grossamount, -1) = coalesce(k.grossamount, -1)
  AND coalesce(d.type, '') = coalesce(k.type, '')
  AND d.id > k.id;

-- 2. Rendimentos acima de R$ 100 por cota são resíduo de parsing de páginas
--    (ex.: FAMB11 com "1.001,61"). Amortizações grandes são legítimas e ficam.

DELETE FROM asset_dividends
WHERE grossamount > 100
  AND lower(type) = 'rendimento';

COMMIT;
