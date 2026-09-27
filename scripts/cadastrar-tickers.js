const { Pool } = require('pg');

// Segredos vem do ambiente ou do .env da raiz do repo (ver .env.example).
// Nenhum valor padrao aqui: nada de segredo no git.
const BRAPI_TOKEN = process.env.BRAPI_TOKEN;
const DB_HOST = process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost';
const DB_PORT = Number(process.env.DB_PORT || 5432);
const DB_NAME = process.env.DB_NAME || process.env.POSTGRES_DB || 'site_db';
const DB_USER = process.env.DB_USER || process.env.POSTGRES_USER || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD;

if (!BRAPI_TOKEN) {
  console.error('Defina BRAPI_TOKEN no ambiente ou no .env (veja .env.example).');
  process.exit(1);
}

if (!DB_PASSWORD) {
  console.error('Defina POSTGRES_PASSWORD (ou DB_PASSWORD) no ambiente ou no .env (veja .env.example).');
  process.exit(1);
}

const ESRID_FII_TYPES = ['fii', 'fi-infra', 'fi-agro'];

function isFiiTicker(ticker) {
  return /^[A-Z0-9]{4,5}11$/.test(ticker);
}

function classify(item) {
  const type = item.type;
  const subType = item.subType || '';
  const ticker = item.stock;

  if (type === 'stock') {
    return { assettype: 'acao', fiitype: subType || 'acao' };
  }

  if (type === 'fund') {
    const isFii =
      ESRID_FII_TYPES.includes(subType) ||
      (!subType && isFiiTicker(ticker));
    if (isFii) {
      return { assettype: 'fii', fiitype: subType || 'fii' };
    }
    return null;
  }

  return null;
}

async function fetchList(type) {
  const url = `https://brapi.dev/api/quote/list?token=${encodeURIComponent(BRAPI_TOKEN)}&type=${type}`;
  console.log(`Buscando tipo "${type}" em ${url}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Brapi respondeu HTTP ${res.status}`);
  const data = await res.json();
  const items = data.stocks || [];
  console.log(`  -> ${items.length} itens recebidos`);
  return items;
}

async function main() {
  const pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    max: 5,
  });

  let rows = [];
  try {
    const stocks = await fetchList('stock');
    for (const it of stocks) {
      const c = classify(it);
      if (c) rows.push({ it, ...c });
    }

    const funds = await fetchList('fund');
    for (const it of funds) {
      const c = classify(it);
      if (c) rows.push({ it, ...c });
    }
  } catch (err) {
    console.error('Falha ao buscar tickers da Brapi:', err.message);
    await pool.end();
    process.exit(1);
  }

  const acoes = rows.filter((r) => r.assettype === 'acao');
  const fiis = rows.filter((r) => r.assettype === 'fii');
  console.log(`Total: ${rows.length} (${acoes.length} acoes, ${fiis.length} fiis)`);

  const cols = ['ticker', 'name', 'assettype', 'createdat', 'longname', 'sector', 'regularmarketprice', 'logourl', 'fiitype'];
  const now = new Date().toISOString().slice(0, 10);

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const params = [];
    const values = [];
    let p = 1;

    for (const { it, assettype, fiitype } of batch) {
      const name = (it.name || it.stock || '').toString();
      const tupleParams = [];
      for (let j = 0; j < cols.length; j++) {
        tupleParams.push(`$${p}`);
        p++;
      }
      params.push(
        it.stock,
        name,
        assettype,
        now,
        name,
        it.sector || null,
        it.close != null ? String(it.close) : null,
        it.logo || null,
        fiitype
      );
      values.push(`(${tupleParams.join(', ')})`);
    }

    const sql = `INSERT INTO b3_assets (${cols.join(', ')})
      VALUES ${values.join(', ')}
      ON CONFLICT (ticker) DO UPDATE SET
        name = EXCLUDED.name,
        assettype = EXCLUDED.assettype,
        longname = EXCLUDED.longname,
        sector = EXCLUDED.sector,
        regularmarketprice = EXCLUDED.regularmarketprice,
        logourl = EXCLUDED.logourl,
        fiitype = EXCLUDED.fiitype`;

    await pool.query(sql, params);
    console.log(`Gravados ${i + batch.length}/${rows.length}`);
  }

  const { rows: counts } = await pool.query(
    `SELECT assettype, COUNT(*)::int AS total FROM b3_assets GROUP BY assettype ORDER BY assettype`
  );
  console.log('Estado final do banco:');
  for (const c of counts) console.log(`  ${c.assettype}: ${c.total}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});