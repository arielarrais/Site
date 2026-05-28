require('dotenv').config();
const { Pool } = require('pg');

const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchBrapiDividends() {
  console.log('\n--- Brapi free tier (HGLG11, MXRF11) ---');
  const url = 'https://brapi.dev/api/v2/fii/dividends?symbols=HGLG11,MXRF11';
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  Brapi error ${res.status}`);
    return [];
  }
  const data = await res.json();
  console.log(`  Recebidos ${data.dividends?.length || 0} registros`);
  return data.dividends || [];
}

async function fetchYahooDividends(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SA?range=5y&interval=1d&events=div`;
  const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yahoo ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    const err = data?.chart?.error;
    throw new Error(`Yahoo error: ${err?.code} - ${err?.description}`);
  }
  const dividends = result?.events?.dividends;
  if (!dividends) return [];

  const entries = [];
  for (const [tsStr, div] of Object.entries(dividends)) {
    const ts = parseInt(tsStr);
    const date = new Date(ts * 1000);
    const dateStr = date.toISOString().split('T')[0];
    entries.push({
      symbol: ticker,
      comDate: dateStr,
      paymentDate: null,
      rate: div.amount
    });
  }
  entries.sort((a, b) => a.comDate.localeCompare(b.comDate));
  return entries;
}

async function saveDividends(pool, assetMap, dividends) {
  let inserted = 0;
  let skipped = 0;
  for (const div of dividends) {
    const ticker = div.symbol.toUpperCase();
    const assetId = assetMap[ticker];
    if (!assetId) {
      skipped++;
      continue;
    }

    const comDate = div.comDate || null;
    const paymentDate = div.paymentDate || null;
    const grossAmount = parseFloat(div.rate) || 0;

    if (!comDate && !paymentDate) {
      skipped++;
      continue;
    }
    if (grossAmount <= 0) {
      skipped++;
      continue;
    }

    const existing = await pool.query(
      "SELECT id FROM asset_dividends WHERE assetid = $1 AND comdate = $2 AND grossamount = $3",
      [assetId, comDate, grossAmount]
    );
    if (existing.rows.length > 0) {
      skipped++;
      continue;
    }

    await pool.query(
      `INSERT INTO asset_dividends (assetid, paymentdate, grossamount, netamount, description, comdate, type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [assetId, paymentDate || comDate, grossAmount, grossAmount, 'Dividendo', comDate, 'dividendo']
    );
    inserted++;
  }
  return { inserted, skipped };
}

async function syncAllDividends(pool) {
  console.log(`[${new Date().toISOString()}] Sincronizando dividendos...`);
  const assets = await pool.query("SELECT id, ticker, name FROM b3_assets ORDER BY ticker");
  console.log(`Total de ativos: ${assets.rows.length}`);

  const assetMap = {};
  const allTickers = [];
  for (const a of assets.rows) {
    assetMap[a.ticker] = a.id;
    allTickers.push(a.ticker);
  }

  let totalInserted = 0;
  const yahooFiis = [];
  const errorFiis = [];

  const brapiDivs = await fetchBrapiDividends();
  if (brapiDivs.length > 0) {
    const mapped = brapiDivs.map(d => ({
      symbol: d.symbol,
      comDate: d.lastDatePrior ? d.lastDatePrior.split(' ')[0] : null,
      paymentDate: d.paymentDate ? d.paymentDate.split(' ')[0] : null,
      rate: d.rate
    }));
    const { inserted, skipped } = await saveDividends(pool, assetMap, mapped);
    totalInserted += inserted;
    console.log(`  Brapi: ${inserted} novos, ${skipped} ignorados`);
  }

  console.log('--- Yahoo Finance ---');
  const CONCURRENCY = 3;
  for (let i = 0; i < allTickers.length; i += CONCURRENCY) {
    const batch = allTickers.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(t => fetchYahooDividends(t)));

    for (let j = 0; j < batch.length; j++) {
      const ticker = batch[j];
      const result = results[j];
      if (result.status === 'fulfilled' && result.value.length > 0) {
        const { inserted, skipped } = await saveDividends(pool, assetMap, result.value);
        totalInserted += inserted;
        yahooFiis.push(ticker);
        console.log(`  ${ticker}: ${result.value.length} proventos (${inserted} novos, ${skipped} existentes)`);
      } else if (result.status === 'fulfilled') {
        errorFiis.push(ticker);
      } else {
        errorFiis.push(ticker);
      }
    }
    if (i + CONCURRENCY < allTickers.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\nResumo: ${totalInserted} novos proventos salvos, ${errorFiis.length} ativos sem dados`);
  console.log(`[${new Date().toISOString()}] Sincronização concluída.\n`);
}

if (require.main === module) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:5432/site_db'
  });
  syncAllDividends(pool).then(() => pool.end()).catch(err => {
    console.error('Erro fatal:', err);
    pool.end();
    process.exit(1);
  });
}

module.exports = { syncAllDividends };
