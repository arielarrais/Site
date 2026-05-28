require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:5432/site_db'
});

const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// FIIs que funcionam no free tier da Brapi (sem token)
const BRAPI_FREE_FIIS = ['HGLG11', 'MXRF11'];

async function getFiis() {
  const r = await pool.query(
    "SELECT id, ticker, name FROM b3_assets WHERE assettype = 'fii' ORDER BY ticker"
  );
  return r.rows;
}

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

async function saveDividends(assetMap, dividends, source) {
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
      `INSERT INTO asset_dividends (assetid, paymentdate, grossamount, netamount, description, comdate)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [assetId, paymentDate || comDate, grossAmount, grossAmount, 'Dividendo', comDate]
    );
    inserted++;
  }
  return { inserted, skipped };
}

async function main() {
  console.log('Buscando FIIs do banco...');
  const fiis = await getFiis();
  console.log(`Total de FIIs encontrados: ${fiis.length}`);

  const assetMap = {};
  const allTickers = [];
  for (const f of fiis) {
    assetMap[f.ticker] = f.id;
    allTickers.push(f.ticker);
  }

  let totalInserted = 0;
  let totalSkipped = 0;
  const processedFiis = [];
  const errorFiis = [];
  const brapiFiis = [];
  const yahooFiis = [];

  // Passo 1: Brapi free tier - HGLG11 e MXRF11 (tem data com + data pagto)
  try {
    const brapiDivs = await fetchBrapiDividends();
    if (brapiDivs.length > 0) {
      const mapped = brapiDivs.map(d => ({
        symbol: d.symbol,
        comDate: d.lastDatePrior ? d.lastDatePrior.split(' ')[0] : null,
        paymentDate: d.paymentDate ? d.paymentDate.split(' ')[0] : null,
        rate: d.rate
      }));
      const { inserted, skipped } = await saveDividends(assetMap, mapped, 'Brapi');
      totalInserted += inserted;
      totalSkipped += skipped;
      brapiFiis.push(...new Set(mapped.map(d => d.symbol.toUpperCase())));
      console.log(`  Inseridos: ${inserted}, Ignorados: ${skipped}`);
    }
  } catch (err) {
    console.error(`  Erro Brapi: ${err.message}`);
  }

  // Passo 2: Yahoo Finance para todos os FIIs
  console.log('\n--- Yahoo Finance (todos os FIIs) ---');
  const CONCURRENCY = 3;
  for (let i = 0; i < allTickers.length; i += CONCURRENCY) {
    const batch = allTickers.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(t => fetchYahooDividends(t)));

    for (let j = 0; j < batch.length; j++) {
      const ticker = batch[j];
      const result = results[j];
      if (result.status === 'fulfilled' && result.value.length > 0) {
        const { inserted, skipped } = await saveDividends(assetMap, result.value, 'Yahoo');
        totalInserted += inserted;
        totalSkipped += skipped;
        yahooFiis.push(ticker);
        console.log(`  ${ticker}: ${result.value.length} dividendos (${inserted} novos, ${skipped} existentes)`);
      } else if (result.status === 'fulfilled' && result.value.length === 0) {
        console.log(`  ${ticker}: sem dividendos no Yahoo Finance`);
        errorFiis.push(ticker);
      } else {
        console.log(`  ${ticker}: erro - ${result.reason?.message?.slice(0, 100) || 'desconhecido'}`);
        errorFiis.push(ticker);
      }
    }
    // Pequena pausa para evitar rate limit
    if (i + CONCURRENCY < allTickers.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Resumo
  const allProcessed = [...new Set([...brapiFiis, ...yahooFiis])];
  console.log('\n========== RESUMO ==========');
  console.log(`Total FIIs no banco: ${fiis.length}`);
  console.log(`FIIs com dividendos salvos: ${allProcessed.length}`);
  console.log(`FIIs sem dados: ${errorFiis.length}`);
  console.log(`Total dividendos inseridos: ${totalInserted}`);
  console.log(`Total registros ignorados: ${totalSkipped}`);

  if (allProcessed.length > 0) {
    console.log('\n========== FIIs COM DADOS ==========');
    for (const ticker of allProcessed.sort()) {
      const f = fiis.find(f => f.ticker === ticker);
      console.log(`  ${ticker} - ${f ? f.name : ''}`);
    }
  }

  if (errorFiis.length > 0) {
    console.log('\n========== FIIs SEM DADOS ==========');
    for (const ticker of [...new Set(errorFiis)].sort()) {
      console.log(`  ${ticker}`);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
