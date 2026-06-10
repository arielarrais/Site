require('dotenv').config();

const express = require('express');

const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { syncAllDividends } = require('./fetch_dividendos');
const XLSX = require('xlsx');
const fs = require('fs');
const os = require('os');

const app = express();
const port = process.env.PORT || 3001;

// Test endpoint to verify server is running latest code
app.get('/api/test', (req, res) => {
  res.json({ status: 'ok', version: 2 });
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('ERRO: DATABASE_URL não definida. Configure a variável de ambiente.');
  process.exit(1);
}
const pool = new Pool({ connectionString: databaseUrl });

app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/lancamentos', (req, res) => {
  res.sendFile(path.join(__dirname, 'lancamentos.html'));
});

app.use(express.static(path.join(__dirname)));

const brapiTokenStatus = process.env.BRAPI_TOKEN ? 'loaded' : 'missing';
console.log(`BRAPI_TOKEN ${brapiTokenStatus}`);

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT,
      fullname TEXT,
      email TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_items (
      id SERIAL PRIMARY KEY,
      userid INTEGER,
      ticker TEXT,
      quantity INTEGER,
      purchaseprice DOUBLE PRECISION,
      purchasedat TEXT DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')),
      institution TEXT DEFAULT '',
      movement_type TEXT DEFAULT 'compra'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS b3_assets (
      id SERIAL PRIMARY KEY,
      ticker TEXT UNIQUE,
      name TEXT,
      assettype TEXT,
      createdat TEXT DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')),
      longname TEXT,
      sector TEXT,
      regularmarketprice TEXT,
      logourl TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_dividends (
      id SERIAL PRIMARY KEY,
      assetid INTEGER,
      paymentdate TEXT,
      grossamount DOUBLE PRECISION,
      netamount DOUBLE PRECISION,
      description TEXT,
      createdat TEXT DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')),
      comdate TEXT
    )
  `);

  const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
  if (rows.length === 0) {
    const passwordHash = bcrypt.hashSync('123456', 10);
    await pool.query(
      'INSERT INTO users (username, password, fullname) VALUES ($1, $2, $3)',
      ['admin', passwordHash, 'Administrador']
    );
    console.log('Usuário inicial criado: admin / 123456');
  }
}

async function migrateDividendTableIfNeeded() {
  const checkComdate = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'asset_dividends' AND column_name = 'comdate'
  `);
  if (checkComdate.rows.length === 0) {
    await pool.query('ALTER TABLE asset_dividends ADD COLUMN comdate TEXT');
    console.log('Coluna comdate adicionada em asset_dividends.');
  }

  const checkType = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'asset_dividends' AND column_name = 'type'
  `);
  if (checkType.rows.length === 0) {
    await pool.query("ALTER TABLE asset_dividends ADD COLUMN type TEXT NOT NULL DEFAULT 'dividendo'");
    console.log('Coluna type adicionada em asset_dividends.');
  }
}

async function migrateB3AssetsTableIfNeeded() {
  const existing = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'b3_assets'
  `);
  const cols = existing.rows.map(r => r.column_name);
  const needed = ['longname', 'logourl', 'sector', 'regularmarketprice'];
  for (const col of needed) {
    if (!cols.includes(col)) {
      await pool.query(`ALTER TABLE b3_assets ADD COLUMN ${col} TEXT`);
      console.log(`Coluna ${col} adicionada em b3_assets.`);
    }
  }
  if (!cols.includes('fiitype')) {
    await pool.query("ALTER TABLE b3_assets ADD COLUMN fiitype TEXT");
    console.log('Coluna fiitype adicionada em b3_assets.');
  }
}

async function migratePortfolioTableIfNeeded() {
  const { rows: colRows } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'portfolio_items' AND column_name = 'purchasedate'
  `);
  if (colRows.length > 0) {
    await pool.query('DROP TABLE IF EXISTS portfolio_items_new');
    await pool.query(`
      CREATE TABLE portfolio_items_new (
        id SERIAL PRIMARY KEY,
        userid INTEGER,
        ticker TEXT,
        quantity INTEGER,
        purchaseprice DOUBLE PRECISION,
        purchasedat TEXT DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')),
        institution TEXT DEFAULT ''
      )
    `);
    await pool.query(`
      INSERT INTO portfolio_items_new (id, userid, ticker, quantity, purchaseprice, purchasedat, institution)
      SELECT id, userid, ticker, quantity, purchaseprice, purchasedat, '' FROM portfolio_items
    `);
    await pool.query('DROP TABLE portfolio_items');
    await pool.query('ALTER TABLE portfolio_items_new RENAME TO portfolio_items');
    await pool.query("SELECT setval('portfolio_items_id_seq', (SELECT COALESCE(MAX(id),1) FROM portfolio_items))");
    console.log('Tabela portfolio_items migrada para permitir lançamentos duplicados.');
  }
  const { rows: instRows } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'portfolio_items' AND column_name = 'institution'
  `);
  if (instRows.length === 0) {
    await pool.query("ALTER TABLE portfolio_items ADD COLUMN institution TEXT DEFAULT ''");
    console.log('Coluna institution adicionada em portfolio_items.');
  }
  const { rows: mtRows } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'portfolio_items' AND column_name = 'movement_type'
  `);
  if (mtRows.length === 0) {
    await pool.query("ALTER TABLE portfolio_items ADD COLUMN movement_type TEXT DEFAULT 'compra'");
    console.log('Coluna movement_type adicionada em portfolio_items.');
  }
}

async function migrateUsersTableIfNeeded() {
  const { rows } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'email'
  `);
  if (rows.length === 0) {
    await pool.query('ALTER TABLE users ADD COLUMN email TEXT');
    console.log('Coluna email adicionada em users.');
  }
}

app.post('/api/register', async (req, res) => {
  const { username, password, fullName, email } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Senha deve ter pelo menos 4 caracteres.' });
  }

  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (rows.length > 0) {
      return res.status(400).json({ error: 'Usuário já existe.' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password, fullname, email) VALUES ($1, $2, $3, $4) RETURNING id, username, fullname, email',
      [username, passwordHash, fullName || username, email || null]
    );
    const user = result.rows[0];
    res.json({ id: user.id, username: user.username, fullName: user.fullname, email: user.email });
  } catch (err) {
    console.error('Erro ao criar usuário:', err);
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, username, password, fullname FROM users WHERE username = $1',
      [username]
    );

    if (rows.length === 0 || !bcrypt.compareSync(password, rows[0].password)) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }

    const user = rows[0];
    res.json({ id: user.id, username: user.username, fullName: user.fullname });
  } catch (err) {
    console.error('Erro ao buscar usuário:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

app.get('/api/portfolio', async (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, ticker, quantity, purchaseprice AS "purchasePrice", purchasedat AS "purchasedAt", institution, movement_type AS "movementType" FROM portfolio_items WHERE userid = $1 ORDER BY purchasedat ASC, id ASC',
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar carteira:', err);
    res.status(500).json({ error: 'Erro ao buscar carteira.' });
  }
});

app.get('/api/portfolio/dividend-returns', async (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

  try {
    const { rows } = await pool.query(
      `SELECT a.ticker,
        COALESCE(SUM(
          d.grossamount * (
            SELECT COALESCE(SUM(p.quantity), 0)
            FROM portfolio_items p
            WHERE p.ticker = a.ticker AND p.userid = $1 AND p.purchasedat <= d.comdate
          )
        ), 0) as "totalDividends"
      FROM asset_dividends d
      JOIN b3_assets a ON d.assetid = a.id
      WHERE EXISTS (
        SELECT 1 FROM portfolio_items p
        WHERE p.ticker = a.ticker AND p.userid = $1 AND p.purchasedat <= d.comdate
      )
      GROUP BY a.ticker`,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Erro ao calcular dividendos:', err);
    res.status(500).json({ error: 'Erro ao calcular dividendos.' });
  }
});

app.post('/api/portfolio', async (req, res) => {
  const { userId, ticker, quantity, purchasePrice, purchaseDate, institution, movementType } = req.body;
  if (!userId || !ticker || quantity === undefined || quantity === null || purchasePrice === undefined || purchasePrice === null || !purchaseDate) {
    return res.status(400).json({ error: 'userId, ticker, quantidade, preço e data são obrigatórios.' });
  }

  const normalizedTicker = String(ticker).trim().toUpperCase();
  const qty = Number(quantity);
  const price = Number(purchasePrice);
  const purchaseDateValue = String(purchaseDate).trim();
  const inst = institution ? String(institution).trim() : '';
  const movType = movementType || 'compra';

  if (qty === 0) {
    return res.status(400).json({ error: 'Quantidade deve ser diferente de zero.' });
  }

  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(purchaseDateValue)) {
    return res.status(400).json({ error: 'Data deve estar no formato YYYY-MM-DD.' });
  }

  try {
    if (qty > 0 && price > 0) {
      const exists = await pool.query('SELECT id FROM b3_assets WHERE ticker = $1', [normalizedTicker]);
      if (exists.rows.length === 0) {
        try {
          const yahooTicker = normalizedTicker.includes('.') ? normalizedTicker : `${normalizedTicker}.SA`;
          const yRes = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=1d`,
            { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }
          );
          const yData = await yRes.json();
          const yMeta = yData?.chart?.result?.[0]?.meta;
          if (yMeta) {
            const name = String(yMeta.shortName || yMeta.symbol || normalizedTicker).substring(0, 255);
            const longName = yMeta.longName ? String(yMeta.longName).substring(0, 255) : null;
            let assettype = 'acao';
            if (normalizedTicker.endsWith('11')) assettype = 'fii';
            else if (yMeta.instrumentType === 'ETF' || yMeta.instrumentType === 'FUND') assettype = 'fii';
            await pool.query(
              'INSERT INTO b3_assets (ticker, name, longname, assettype) VALUES ($1, $2, $3, $4) ON CONFLICT (ticker) DO NOTHING',
              [normalizedTicker, name, longName, assettype]
            );
          }
        } catch (yErr) {
          console.warn('Auto-create falhou ao cadastrar compra:', yErr.message);
        }
      }
    }

    const result = await pool.query(
      'INSERT INTO portfolio_items (userid, ticker, quantity, purchaseprice, purchasedat, institution, movement_type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, ticker, quantity, purchaseprice, purchasedat, institution, movement_type',
      [userId, normalizedTicker, qty, price, purchaseDateValue, inst, movType]
    );
    const item = result.rows[0];
    res.json({ id: item.id, ticker: item.ticker, quantity: item.quantity, purchasePrice: item.purchaseprice, purchaseDate: item.purchasedat, institution: item.institution, movementType: item.movement_type });
  } catch (err) {
    console.error('Erro ao inserir item na carteira:', err);
    res.status(500).json({ error: 'Erro ao salvar item da carteira.' });
  }
});

app.put('/api/portfolio', async (req, res) => {
  const { id, userId, quantity, purchasePrice, purchaseDate } = req.body;
  if (!id || !userId) {
    return res.status(400).json({ error: 'id e userId são obrigatórios.' });
  }

  const qty = quantity != null ? Number(quantity) : null;
  const price = purchasePrice != null ? Number(purchasePrice) : null;
  const date = purchaseDate ? String(purchaseDate).trim() : null;

  if (qty != null && qty === 0) {
    return res.status(400).json({ error: 'Quantidade deve ser diferente de zero.' });
  }
  if (date != null && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
    return res.status(400).json({ error: 'Data deve estar no formato YYYY-MM-DD.' });
  }

  const fields = [];
  const params = [];
  if (qty != null) { fields.push('quantity = $' + (params.length + 1)); params.push(qty); }
  if (price != null) { fields.push('purchaseprice = $' + (params.length + 1)); params.push(price); }
  if (date != null) { fields.push('purchasedat = $' + (params.length + 1)); params.push(date); }

  if (!fields.length) {
    return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  }

  params.push(Number(id), Number(userId));
  try {
    const result = await pool.query(
      `UPDATE portfolio_items SET ${fields.join(', ')} WHERE id = $${params.length - 1} AND userid = $${params.length} RETURNING id`,
      params
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Item não encontrado.' });
    }
    res.json({ id: Number(id), quantity: qty, purchasePrice: price, purchaseDate: date });
  } catch (err) {
    console.error('Erro ao atualizar item da carteira:', err);
    res.status(500).json({ error: 'Erro ao atualizar item da carteira.' });
  }
});

app.delete('/api/portfolio', async (req, res) => {
  const userId = Number(req.query.userId);
  const id = Number(req.query.id);

  if (!userId || !id) {
    return res.status(400).json({ error: 'userId e id são obrigatórios.' });
  }

  try {
    await pool.query('DELETE FROM portfolio_items WHERE userid = $1 AND id = $2', [userId, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao remover item da carteira:', err);
    res.status(500).json({ error: 'Erro ao remover item da carteira.' });
  }
});

app.get('/api/b3-assets', async (req, res) => {
  const query = (req.query.q || '').trim().toUpperCase();
  try {
    let result;
    if (query) {
      result = await pool.query(
        'SELECT id, ticker, name, assettype FROM b3_assets WHERE ticker LIKE $1 OR name LIKE $1 ORDER BY ticker LIMIT 30',
        [`%${query}%`]
      );
    } else {
      result = await pool.query(
        'SELECT id, ticker, name, assettype FROM b3_assets ORDER BY assettype, ticker'
      );
    }
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar ativos B3:', err);
    res.status(500).json({ error: 'Erro ao buscar ativos B3.' });
  }
});

app.get('/api/assets/types', async (req, res) => {
  const tickers = (req.query.tickers || '').split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  if (!tickers.length) return res.json({});
  try {
    const result = await pool.query(
      'SELECT ticker, assettype FROM b3_assets WHERE ticker = ANY($1)',
      [tickers]
    );
    const map = {};
    result.rows.forEach(r => { map[r.ticker] = r.assettype; });

    const missing = tickers.filter(t => !(t in map));
    if (missing.length) {
      for (const t of missing) {
        try {
          const yahooTicker = t.includes('.') ? t : `${t}.SA`;
          const yRes = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=1d`,
            { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }
          );
          const yData = await yRes.json();
          const yMeta = yData?.chart?.result?.[0]?.meta;
          if (yMeta) {
            const name = String(yMeta.shortName || yMeta.symbol || t).substring(0, 255);
            const longName = yMeta.longName ? String(yMeta.longName).substring(0, 255) : null;
            let assettype = 'acao';
            if (t.endsWith('11')) assettype = 'fii';
            else if (yMeta.instrumentType === 'ETF' || yMeta.instrumentType === 'FUND') assettype = 'fii';
            await pool.query(
              'INSERT INTO b3_assets (ticker, name, longname, assettype) VALUES ($1, $2, $3, $4) ON CONFLICT (ticker) DO NOTHING',
              [t, name, longName, assettype]
            );
            map[t] = assettype;
          }
        } catch (yErr) {
          console.warn(`Auto-create types falhou para ${t}:`, yErr.message);
          if (t.endsWith('11')) {
            map[t] = 'fii';
          }
        }
      }
    }
    res.json(map);
  } catch (err) {
    console.error('Erro ao buscar tipos:', err);
    res.json({});
  }
});

app.post('/api/b3-assets', async (req, res) => {
  const { ticker, name, assetType } = req.body;
  if (!ticker || !name) {
    return res.status(400).json({ error: 'Ticker e nome são obrigatórios.' });
  }

  const normalizedTicker = String(ticker).trim().toUpperCase();
  try {
    const result = await pool.query(
      'INSERT INTO b3_assets (ticker, name, assettype) VALUES ($1, $2, $3) RETURNING id, ticker, name, assettype',
      [normalizedTicker, String(name).trim(), assetType ? String(assetType).trim() : null]
    );
    const item = result.rows[0];
    res.json({ id: item.id, ticker: item.ticker, name: item.name, assetType: item.assettype });
  } catch (err) {
    console.error('Erro ao salvar ativo B3:', err);
    res.status(500).json({ error: 'Erro ao salvar ativo B3.' });
  }
});

app.post('/api/assets/auto-create', async (req, res) => {
  const { ticker } = req.body;
  if (!ticker) return res.status(400).json({ error: 'Ticker é obrigatório.' });

  const normalizedTicker = String(ticker).trim().toUpperCase();

  try {
    const existing = await pool.query('SELECT id, ticker, name, assettype FROM b3_assets WHERE ticker = $1', [normalizedTicker]);
    if (existing.rows.length > 0) {
      const a = existing.rows[0];
      return res.json({ id: a.id, ticker: a.ticker, name: a.name, assetType: a.assettype, alreadyExisted: true });
    }

    const yahooTicker = normalizedTicker.includes('.') ? normalizedTicker : `${normalizedTicker}.SA`;
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=1d`;
    const chartRes = await fetch(chartUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const chartData = await chartRes.json();
    const meta = chartData?.chart?.result?.[0]?.meta;
    if (!meta) return res.status(404).json({ error: 'Ativo não encontrado no Yahoo Finance.' });

    const name = String(meta.shortName || meta.symbol || normalizedTicker).substring(0, 255);
    const longName = meta.longName ? String(meta.longName).substring(0, 255) : null;

    let assettype = 'acao';
    if (normalizedTicker.endsWith('11')) assettype = 'fii';
    else if (meta.instrumentType === 'ETF' || meta.instrumentType === 'FUND') assettype = 'fii';

    const insertResult = await pool.query(
      'INSERT INTO b3_assets (ticker, name, longname, assettype) VALUES ($1, $2, $3, $4) RETURNING id, ticker, name, assettype',
      [normalizedTicker, name, longName, assettype]
    );
    const asset = insertResult.rows[0];

    let dividendsInserted = 0;
    try {
      const divUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?range=5y&interval=1d&events=div`;
      const divRes = await fetch(divUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const divData = await divRes.json();
      const dividends = divData?.chart?.result?.[0]?.events?.dividends;
      if (dividends) {
        for (const [tsStr, div] of Object.entries(dividends)) {
          const ts = parseInt(tsStr);
          const dateStr = new Date(ts * 1000).toISOString().split('T')[0];
          const amount = parseFloat(div.amount) || 0;
          if (amount > 0) {
            const dup = await pool.query(
              'SELECT id FROM asset_dividends WHERE assetid = $1 AND grossamount = $2 AND LEFT(comdate, 7) = LEFT($3, 7)',
              [asset.id, amount, dateStr]
            );
            if (dup.rows.length === 0) {
              await pool.query(
                'INSERT INTO asset_dividends (assetid, comdate, grossamount, netamount, description, type) VALUES ($1, $2, $3, $4, $5, $6)',
                [asset.id, dateStr, amount, amount, 'Dividendo', 'dividendo']
              );
              dividendsInserted++;
            }
          }
        }
      }
    } catch (divErr) {
      console.warn(`Erro ao buscar dividendos de ${normalizedTicker}:`, divErr.message);
    }

    res.json({
      id: asset.id,
      ticker: asset.ticker,
      name: asset.name,
      assetType: asset.assettype,
      dividendsInserted
    });
  } catch (err) {
    console.error('Erro ao criar ativo automaticamente:', err);
    res.status(500).json({ error: 'Erro ao criar ativo automaticamente.' });
  }
});

app.get('/api/dividends', async (req, res) => {
  const assetId = Number(req.query.assetId);
  const ticker = (req.query.ticker || '').trim().toUpperCase();

  try {
    let result;
    if (ticker) {
      result = await pool.query(
        `SELECT d.id, d.assetid, d.comdate AS "comDate", d.paymentdate AS "paymentDate",
                d.grossamount AS "grossAmount", d.netamount AS "netAmount",
                d.description, d.type, d.createdat AS "createdAt"
         FROM asset_dividends d JOIN b3_assets a ON d.assetid = a.id
         WHERE a.ticker = $1 ORDER BY d.paymentdate DESC`,
        [ticker]
      );
    } else if (assetId) {
      result = await pool.query(
        `SELECT id, assetid, comdate AS "comDate", paymentdate AS "paymentDate",
                grossamount AS "grossAmount", netamount AS "netAmount",
                description, type, createdat AS "createdAt"
         FROM asset_dividends WHERE assetid = $1 ORDER BY paymentdate DESC`,
        [assetId]
      );
    } else {
      result = await pool.query(
        `SELECT id, assetid, comdate AS "comDate", paymentdate AS "paymentDate",
                grossamount AS "grossAmount", netamount AS "netAmount",
                description, type, createdat AS "createdAt"
         FROM asset_dividends ORDER BY paymentdate DESC`
      );
    }
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar dividendos:', err);
    res.status(500).json({ error: 'Erro ao buscar dividendos.' });
  }
});

app.post('/api/dividends', async (req, res) => {
  const { assetId, paymentDate, grossAmount, netAmount, description, type } = req.body;
  if (!assetId || !paymentDate || grossAmount == null) {
    return res.status(400).json({ error: 'assetId, paymentDate e grossAmount são obrigatórios.' });
  }

  const paymentDateValue = String(paymentDate).trim();
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(paymentDateValue)) {
    return res.status(400).json({ error: 'Data de pagamento deve estar no formato YYYY-MM-DD.' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO asset_dividends (assetid, paymentdate, grossamount, netamount, description, type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, assetid, paymentdate, grossamount, netamount, description, type, createdat',
      [assetId, paymentDateValue, Number(grossAmount), netAmount != null ? Number(netAmount) : null, description ? String(description).trim() : null, type || 'dividendo']
    );
    const d = result.rows[0];
    res.json({ id: d.id, assetId: d.assetid, paymentDate: d.paymentdate, grossAmount: d.grossamount, netAmount: d.netamount, description: d.description, type: d.type });
  } catch (err) {
    console.error('Erro ao salvar dividendo:', err);
    res.status(500).json({ error: 'Erro ao salvar dividendo.' });
  }
});

app.get('/api/quote', async (req, res) => {
  const ticker = (req.query.ticker || '').trim().toUpperCase();
  if (!ticker) {
    return res.status(400).json({ error: 'Ticker é obrigatório.' });
  }

  try {
    const token = process.env.BRAPI_TOKEN;
    let url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?fields=regularMarketPrice,shortName,changePercent,regularMarketTime`;
    if (token) url += `&token=${encodeURIComponent(token)}`;

    let response = await fetch(url);
    let data = await response.json();
    let quote = data?.results?.[0];

    if (!response.ok || !quote || quote.regularMarketPrice == null) {
      try {
        const altUrl = `https://api.brapi.dev/api/quote/${encodeURIComponent(ticker)}?fields=regularMarketPrice,shortName,changePercent,regularMarketTime`;
        response = await fetch(altUrl);
        if (response.ok) {
          data = await response.json();
          quote = data?.results?.[0];
        }
      } catch (e) {
      }
    }

    if (!response.ok) {
      throw new Error('Falha ao buscar preço externo.');
    }

    if (!quote || quote.regularMarketPrice == null) {
      return res.status(404).json({ error: 'Preço não encontrado.' });
    }

    res.json({
      ticker,
      price: Number(quote.regularMarketPrice),
      name: quote.shortName || ticker,
      changePercent: quote.changePercent,
      time: quote.regularMarketTime
    });
  } catch (error) {
    console.error('Erro ao buscar cotações:', error);
    res.status(500).json({ error: 'Erro ao buscar preço externo.' });
  }
});

app.get('/api/quotes', async (req, res) => {
  const tickers = (req.query.tickers || '').split(',').map((ticker) => ticker.trim().toUpperCase()).filter(Boolean);
  if (!tickers.length) {
    return res.status(400).json({ error: 'Tickers são obrigatórios.' });
  }

  try {
    const token = process.env.BRAPI_TOKEN;
    const tickerParam = tickers.map(t => encodeURIComponent(t)).join(',');
    let url = `https://brapi.dev/api/quote/${tickerParam}?fields=regularMarketPrice,shortName,changePercent,regularMarketTime`;
    if (token) url += `&token=${encodeURIComponent(token)}`;

    let response = await fetch(url);
    let data = await response.json();
    let quotes = data?.results || [];

    if (!response.ok || !quotes.length) {
      try {
        const altUrl = `https://api.brapi.dev/api/quote/${tickerParam}?fields=regularMarketPrice,shortName,changePercent,regularMarketTime`;
        response = await fetch(altUrl);
        if (response.ok) {
          data = await response.json();
          quotes = data?.results || [];
        }
      } catch (e) {
      }
    }

    if (!response.ok) {
      throw new Error('Falha ao buscar preços externos.');
    }

    const mapped = quotes.reduce((acc, quote) => {
      if (quote?.symbol) {
        acc[quote.symbol.toUpperCase()] = {
          ticker: quote.symbol.toUpperCase(),
          price: Number(quote.regularMarketPrice ?? 0),
          name: quote.shortName || quote.symbol.toUpperCase(),
          changePercent: quote.changePercent,
          time: quote.regularMarketTime
        };
      }
      return acc;
    }, {});

    res.json(mapped);
  } catch (error) {
    console.error('Erro ao buscar cotações:', error);
    res.status(500).json({ error: 'Erro ao buscar preços externos.' });
  }
});

// ===================== ADMIN ROUTES =====================
app.get('/ativos', (req, res) => {
  res.sendFile(path.join(__dirname, 'ativos.html'));
});

app.get('/usuarios', (req, res) => {
  res.sendFile(path.join(__dirname, 'usuarios.html'));
});

app.get('/api/admin/assets', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.ticker, a.name, a.assettype, a.fiitype,
              (SELECT d.comdate FROM asset_dividends d WHERE d.assetid = a.id ORDER BY d.paymentdate DESC LIMIT 1) AS lastcomdate,
              (SELECT MAX(d.paymentdate) FROM asset_dividends d WHERE d.assetid = a.id) AS lastdividenddate,
              (SELECT d.grossamount FROM asset_dividends d WHERE d.assetid = a.id ORDER BY d.paymentdate DESC LIMIT 1) AS lastdividendvalue
       FROM b3_assets a ORDER BY a.assettype, a.ticker`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar ativos:', err);
    res.status(500).json({ error: 'Erro ao buscar ativos.' });
  }
});

app.get('/api/admin/dividends', async (req, res) => {
  const assetId = Number(req.query.assetId);
  try {
    let result;
    if (assetId) {
      result = await pool.query(
        'SELECT id, assetid, paymentdate, grossamount, netamount, description, type, createdat FROM asset_dividends WHERE assetid = $1 ORDER BY paymentdate DESC',
        [assetId]
      );
    } else {
      result = await pool.query(
        'SELECT id, assetid, paymentdate, grossamount, netamount, description, type, createdat FROM asset_dividends ORDER BY paymentdate DESC'
      );
    }
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar dividendos:', err);
    res.status(500).json({ error: 'Erro ao buscar dividendos.' });
  }
});

app.post('/api/admin/dividends', async (req, res) => {
  const { assetId, comDate, paymentDate, grossAmount, type } = req.body;
  if (!assetId || !comDate || !paymentDate || grossAmount == null) {
    return res.status(400).json({ error: 'assetId, comDate, paymentDate e grossAmount são obrigatórios.' });
  }

  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(comDate)) {
    return res.status(400).json({ error: 'Data COM deve estar no formato YYYY-MM-DD.' });
  }
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(paymentDate)) {
    return res.status(400).json({ error: 'Data pgto deve estar no formato YYYY-MM-DD.' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO asset_dividends (assetid, comdate, paymentdate, grossamount, type) VALUES ($1, $2, $3, $4, $5) RETURNING id, assetid, comdate, paymentdate, grossamount, type',
      [assetId, comDate, paymentDate, Number(grossAmount), type || 'dividendo']
    );
    const d = result.rows[0];
    res.json({ id: d.id, assetId: d.assetid, comDate: d.comdate, paymentDate: d.paymentdate, grossAmount: d.grossamount, type: d.type });
  } catch (err) {
    console.error('Erro ao salvar dividendo:', err);
    res.status(500).json({ error: 'Erro ao salvar dividendo.' });
  }
});

app.get('/api/admin/sync-brapi', async (req, res) => {
  const ticker = (req.query.ticker || '').trim().toUpperCase();
  if (!ticker) {
    return res.status(400).json({ error: 'Ticker é obrigatório.' });
  }

  // Tenta Brapi
  try {
    const token = process.env.BRAPI_TOKEN || '';
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?token=${encodeURIComponent(token)}`;
    const response = await fetch(url);
    const data = await response.json();
    const quote = data?.results?.[0];
    if (quote && quote.regularMarketPrice != null) {
      await pool.query(
        `UPDATE b3_assets SET name = $1, longname = $2, logourl = $3, regularmarketprice = $4 WHERE ticker = $5`,
        [quote.shortName || ticker, quote.longName || null, quote.logourl || null, String(quote.regularMarketPrice || ''), ticker]
      );
      return res.json({ ticker, name: quote.shortName, longName: quote.longName, price: quote.regularMarketPrice });
    }
    console.warn('Brapi sem dados para', ticker);
  } catch (brapiErr) {
    console.warn('Brapi falhou:', brapiErr.message);
  }

  // Fallback Yahoo
  try {
    const yahooTicker = ticker.includes('.') ? ticker : `${ticker}.SA`;
    console.log('Sync: consultando Yahoo para', yahooTicker);
    const yRes = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }
    );
    console.log('Sync: Yahoo status', yRes.status);
    if (!yRes.ok) {
      const body = await yRes.text().catch(() => '');
      console.error('Sync: Yahoo response body', body.slice(0, 500));
      throw new Error(`Yahoo ${yRes.status}: ${body.slice(0, 300)}`);
    }
    const yData = await yRes.json();
    const yMeta = yData?.chart?.result?.[0]?.meta;
    if (!yMeta) {
      return res.status(404).json({ error: 'Ativo não encontrado no Yahoo Finance.' });
    }
    const name = String(yMeta.shortName || yMeta.symbol || ticker).substring(0, 255);
    const longName = yMeta.longName ? String(yMeta.longName).substring(0, 255) : null;
    const price = yMeta.regularMarketPrice != null ? String(yMeta.regularMarketPrice) : null;
    await pool.query(
      'UPDATE b3_assets SET name = $1, longname = $2, regularmarketprice = $3 WHERE ticker = $4',
      [name, longName, price, ticker]
    );
    res.json({ ticker, name, longName, price: yMeta.regularMarketPrice });
  } catch (yahooErr) {
    console.error(`Yahoo tambem falhou para ${ticker}:`, yahooErr.message);
    res.status(500).json({ error: `Brapi e Yahoo indisponiveis para ${ticker}: ${yahooErr.message}` });
  }
});

async function fetchAndSyncAssetDividends(pool, assetId, ticker) {
  const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  let dividends = [];
  let source = '';

  function parseBRDate(s) {
    const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }

  // 1) InvistaInfo (FIIs)
  if (!dividends.length) {
    try {
      const url = `https://invistainfo.com.br/ativo.php?fii=${encodeURIComponent(ticker)}`;
      const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } });
      if (res.ok) {
        const html = await res.text();
        const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
        for (const table of tables) {
          const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
          let found = false;
          for (const row of rows) {
            const tds = row.match(/<td[^>]*>(.*?)<\/td>/gs);
            if (!tds || tds.length < 3) continue;
            const cells = tds.map(t => t.replace(/<[^>]+>/g, '').trim());
            if (!cells[0].match(/\d{2}\/\d{2}\/\d{4}/)) continue;
            const comDate = parseBRDate(cells[0]);
            const payDate = parseBRDate(cells[1]);
            const value = parseFloat(cells[2].replace(',', '.'));
            if (comDate && value > 0) {
              dividends.push({ comDate, paymentDate: payDate, grossAmount: value, type: 'rendimento' });
              found = true;
            }
          }
          if (found) { source = 'InvistaInfo'; break; }
        }
      }
    } catch (e) { console.warn('InvistaInfo fail:', ticker, e.message); }
  }

  // 2) Fundamentus (FIIs e ações)
  if (!dividends.length) {
    for (const path of ['fii_proventos', 'proventos']) {
      const isFii = path === 'fii_proventos';
      try {
        const url = `https://fundamentus.com.br/${path}.php?papel=${encodeURIComponent(ticker)}`;
        const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } });
        if (!res.ok) continue;
        const html = await res.text();
        const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
        let found = false;
        for (const row of rows) {
          const tds = row.match(/<td[^>]*>(.*?)<\/td>/gs);
          if (!tds || tds.length < 4) continue;
          const cells = tds.map(t => t.replace(/<[^>]+>/g, '').trim());
          if (!cells[0].match(/\d{2}\/\d{2}\/\d{4}/)) continue;
          if (isFii) {
            const comDate = parseBRDate(cells[0]);
            const type = cells[1].toLowerCase().includes('amortiz') ? 'amortizacao' : 'rendimento';
            const payDate = parseBRDate(cells[2]);
            const value = parseFloat(cells[3].replace(',', '.'));
            if (comDate && value > 0) {
              dividends.push({ comDate, paymentDate: payDate, grossAmount: value, type });
              found = true;
            }
          } else {
            const comDate = parseBRDate(cells[0]);
            const value = parseFloat(cells[1].replace(',', '.'));
            const payDate = parseBRDate(cells[3]);
            const type = cells[2].toLowerCase().includes('jrs') ? 'juros' : 'rendimento';
            if (comDate && value > 0) {
              dividends.push({ comDate, paymentDate: payDate, grossAmount: value, type });
              found = true;
            }
          }
        }
        if (found) { source = 'Fundamentus'; break; }
      } catch (e) { console.warn(`Fundamentus/${path} fail:`, ticker, e.message); }
    }
  }

  // 3) StockAnalysis (fallback)
  if (!dividends.length) {
    try {
      const url = `https://stockanalysis.com/quote/bvmf/${encodeURIComponent(ticker)}/dividend/`;
      const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } });
      if (res.ok) {
        const html = await res.text();
        const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
        let found = false;
        for (const row of rows) {
          const tds = row.match(/<td[^>]*>(.*?)<\/td>/gs);
          if (!tds || tds.length < 4) continue;
          const cells = tds.map(t => t.replace(/<[^>]+>/g, '').trim());
          if (!cells[0].match(/\w{3}\s+\d{1,2},\s*\d{4}/)) continue;
          const parseUSDate = (s) => {
            const m = s.match(/(\w{3})\s+(\d{1,2}),?\s*(\d{4})/);
            if (!m) return null;
            const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
            return `${m[3]}-${months[m[1]]}-${String(Number(m[2])).padStart(2,'0')}`;
          };
          const comDate = parseUSDate(cells[0]);
          const amt = parseFloat(cells[1].replace(/[^0-9.,]/g, '').replace(',', ''));
          const payDate = parseUSDate(cells[3]);
          if (comDate && amt > 0) {
            dividends.push({ comDate, paymentDate: payDate || comDate, grossAmount: amt, type: 'rendimento' });
            found = true;
          }
        }
        if (found) source = 'StockAnalysis';
      }
    } catch (e) { console.warn('StockAnalysis fail:', ticker, e.message); }
  }

  if (!dividends.length) return { source: '', inserted: 0, updated: 0, skipped: 0, total: 0 };

  let inserted = 0, updated = 0, skipped = 0;
  for (const d of dividends) {
    if (!d.comDate && !d.paymentDate) { skipped++; continue; }
    try {
      const existing = await pool.query(
        `SELECT id, paymentdate, grossamount, type FROM asset_dividends WHERE assetid = $1 AND comdate = $2`,
        [assetId, d.comDate]
      );
      if (existing.rows.length) {
        const row = existing.rows[0];
        const payDate = d.paymentDate || d.comDate;
        if (row.paymentdate !== payDate || Number(row.grossamount) !== d.grossAmount || (row.type || 'rendimento') !== d.type) {
          await pool.query(
            `UPDATE asset_dividends SET paymentdate = $1, grossamount = $2, type = $3 WHERE id = $4`,
            [payDate, d.grossAmount, d.type, row.id]
          );
          updated++;
        } else {
          skipped++;
        }
      } else {
        await pool.query(
          `INSERT INTO asset_dividends (assetid, comdate, paymentdate, grossamount, type)
           VALUES ($1, $2, $3, $4, $5)`,
          [assetId, d.comDate, d.paymentDate || d.comDate, d.grossAmount, d.type]
        );
        inserted++;
      }
    } catch (e) {
      console.error(`Erro processando dividendo ${ticker} ${d.comDate}:`, e.message);
      skipped++;
    }
  }

  return { source, inserted, updated, skipped, total: dividends.length };
}

app.post('/api/admin/fetch-dividends', async (req, res) => {
  const ticker = (req.body.ticker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'Ticker é obrigatório.' });
  try {
    const assetResult = await pool.query('SELECT id FROM b3_assets WHERE ticker = $1', [ticker]);
    if (!assetResult.rows.length) return res.status(404).json({ error: 'Ativo não encontrado no banco.' });
    const assetId = assetResult.rows[0].id;
    const result = await fetchAndSyncAssetDividends(pool, assetId, ticker);
    res.json({ ticker, ...result });
  } catch (err) {
    console.error('Erro fetch-dividends:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/fetch-all-dividends', async (req, res) => {
  try {
    const assets = await pool.query('SELECT id, ticker FROM b3_assets ORDER BY ticker');
    res.json({ total: assets.rows.length, message: 'Sincronização iniciada em segundo plano.' });

    let totalInserted = 0, totalUpdated = 0, totalSkipped = 0, errors = [];
    for (let i = 0; i < assets.rows.length; i++) {
      const { id, ticker } = assets.rows[i];
      try {
        const result = await fetchAndSyncAssetDividends(pool, id, ticker);
        totalInserted += result.inserted;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
        console.log(`[${i + 1}/${assets.rows.length}] ${ticker}: ${result.source} | +${result.inserted} ~${result.updated} -${result.skipped}`);
      } catch (e) {
        errors.push(ticker);
        console.warn(`Erro em ${ticker}:`, e.message);
      }
    }
    console.log(`Fetch-all concluído: ${totalInserted} novos, ${totalUpdated} atualizados, ${totalSkipped} ignorados, ${errors.length} erros.`);
  } catch (err) {
    console.error('Erro fetch-all-dividends:', err);
  }
});

app.post('/api/admin/sync-dividends', async (req, res) => {
  try {
    res.json({ message: 'Sincronização de dividendos iniciada em segundo plano.' });
    syncAllDividends(pool).catch(err => console.error('Erro no sync automático:', err));
  } catch (err) {
    console.error('Erro ao iniciar sync:', err);
  }
});

// === Fix Payment Dates (paymentdate = comdate) ===
const FII_DELAY_MS = 1500;
let fixPgtoRunning = false;

function parseBRDateGlobal(s) {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function daysBetween(a, b) {
  return Math.abs((new Date(a) - new Date(b)) / 86400000);
}

async function fetchStatusInvestAcoes(ticker) {
  const url = `https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  if (!res.ok) return [];
  const html = await res.text();
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  const dividends = [];
  for (const row of rows) {
    const tds = row.match(/<td[^>]*>(.*?)<\/td>/gs);
    if (!tds || tds.length < 4) continue;
    const comRaw = tds[1].replace(/<[^>]+>/g, '').trim();
    const payRaw = tds[2].replace(/<[^>]+>/g, '').trim();
    const valRaw = tds[3].replace(/<[^>]+>/g, '').trim();
    if (!comRaw.match(/\d{2}\/\d{2}\/\d{4}/)) continue;
    const val = parseFloat(valRaw.replace(',', '.'));
    if (!val || val <= 0) continue;
    dividends.push({ comDate: parseBRDateGlobal(comRaw), paymentDate: parseBRDateGlobal(payRaw), grossAmount: val });
  }
  return dividends;
}

async function fetchInvestidor10Fiis(ticker) {
  const url = `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  if (!res.ok) return [];
  const html = await res.text();
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const table of tables) {
    const headers = table.match(/<th[^>]*>(.*?)<\/th>/gi);
    if (!headers || !headers.join('').includes('data com')) continue;
    const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
    const dividends = [];
    for (let ri = 1; ri < rows.length; ri++) {
      const tds = rows[ri].match(/<td[^>]*>(.*?)<\/td>/gs);
      if (!tds || tds.length < 4) continue;
      const comRaw = tds[1].replace(/<[^>]+>/g, '').trim();
      const payRaw = tds[2].replace(/<[^>]+>/g, '').trim();
      const valRaw = tds[3].replace(/<[^>]+>/g, '').trim();
      if (!comRaw.match(/\d{2}\/\d{2}\/\d{4}/)) continue;
      const val = parseFloat(valRaw.replace(',', '.'));
      if (!val || val <= 0) continue;
      dividends.push({ comDate: parseBRDateGlobal(comRaw), paymentDate: parseBRDateGlobal(payRaw), grossAmount: val });
    }
    if (dividends.length > 0) return dividends;
  }
  return [];
}

async function fixPaymentDates(pool) {
  console.log(`[${new Date().toISOString()}] Fix PGTO: iniciando...`);

  const result = await pool.query(`
    SELECT d.id, d.assetid, d.comdate, d.paymentdate, d.grossamount, a.ticker, a.assettype
    FROM asset_dividends d
    JOIN b3_assets a ON a.id = d.assetid
    WHERE d.paymentdate = d.comdate
    ORDER BY a.ticker, d.comdate
  `);

  console.log(`Fix PGTO: ${result.rows.length} registros com pgto = COM`);

  const byTicker = {};
  for (const row of result.rows) {
    if (!byTicker[row.ticker]) byTicker[row.ticker] = { rows: [], assettype: row.assettype };
    byTicker[row.ticker].rows.push(row);
  }

  let totalAtualizados = 0;
  let totalIgnorados = 0;

  for (const [ticker, { rows: dividends, assettype }] of Object.entries(byTicker)) {
    let atualizados = 0;
    let ignorados = 0;

    if (assettype === 'acao') {
      const siData = await fetchStatusInvestAcoes(ticker);
      if (siData.length === 0) { ignorados = dividends.length; }
      else {
        const pgtoMap = {};
        for (const d of siData) {
          if (d.comDate && d.paymentDate && d.paymentDate !== d.comDate) {
            pgtoMap[d.comDate] = d.paymentDate;
          }
        }
        for (const div of dividends) {
          const novaPgto = pgtoMap[div.comdate];
          if (!novaPgto) { ignorados++; continue; }
          await pool.query('UPDATE asset_dividends SET paymentdate = $1 WHERE id = $2', [novaPgto, div.id]);
          atualizados++;
        }
      }
    } else {
      const i10Data = await fetchInvestidor10Fiis(ticker);
      if (i10Data.length === 0) { ignorados = dividends.length; }
      else {
        for (const div of dividends) {
          const match = i10Data
            .filter(d => d.paymentDate !== d.comDate && Math.abs(d.grossAmount - div.grossamount) < 0.01)
            .sort((a, b) => daysBetween(a.paymentDate, div.comdate) - daysBetween(b.paymentDate, div.comdate))[0];
          if (!match || daysBetween(match.paymentDate, div.comdate) > 15) { ignorados++; continue; }
          await pool.query('UPDATE asset_dividends SET paymentdate = $1 WHERE id = $2', [match.paymentDate, div.id]);
          atualizados++;
        }
      }
      await new Promise(r => setTimeout(r, FII_DELAY_MS));
    }

    console.log(`Fix PGTO: ${ticker} -> ${atualizados} atualizados, ${ignorados} ignorados`);
    totalAtualizados += atualizados;
    totalIgnorados += ignorados;
  }

  console.log(`Fix PGTO: Concluido. ${totalAtualizados} atualizados, ${totalIgnorados} ignorados`);
}

app.post('/api/admin/fix-payment-dates', async (req, res) => {
  if (fixPgtoRunning) return res.status(400).json({ error: 'Já existe uma correção em andamento.' });
  fixPgtoRunning = true;
  try {
    res.json({ message: 'Correção de datas de pagamento iniciada em segundo plano.' });
    await fixPaymentDates(pool);
  } catch (err) {
    console.error('Erro fix-payment-dates:', err);
  } finally {
    fixPgtoRunning = false;
  }
});

// ===================== YAHOO FINANCE =====================
app.get('/api/quote/yahoo', async (req, res) => {
  const ticker = (req.query.ticker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'Ticker é obrigatório.' });

  try {
    const yahooTicker = ticker.includes('.') ? ticker : `${ticker}.SA`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=1d`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;

    if (!meta || meta.regularMarketPrice == null) {
      return res.status(404).json({ error: 'Preço não encontrado no Yahoo Finance.' });
    }

    res.json({
      ticker,
      price: Number(meta.regularMarketPrice),
      name: meta.symbol || ticker,
      changePercent: null,
      time: null,
      instrumentType: meta.instrumentType || null
    });
  } catch (error) {
    console.error('Erro ao buscar cotação Yahoo:', error);
    res.status(500).json({ error: 'Erro ao buscar preço no Yahoo Finance.' });
  }
});

app.get('/api/quotes/yahoo', async (req, res) => {
  const tickers = (req.query.tickers || '').split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  if (!tickers.length) return res.status(400).json({ error: 'Tickers são obrigatórios.' });

  try {
    const results = await Promise.allSettled(tickers.map(async ticker => {
      const yahooTicker = ticker.includes('.') ? ticker : `${ticker}.SA`;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=1d`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const data = await response.json();
      const meta = data?.chart?.result?.[0]?.meta;
      return { ticker, price: meta?.regularMarketPrice != null ? Number(meta.regularMarketPrice) : null };
    }));

    const mapped = {};
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value.price != null) {
        mapped[r.value.ticker] = { ticker: r.value.ticker, price: r.value.price, name: r.value.ticker, changePercent: null, time: null };
      }
    });

    res.json(mapped);
  } catch (error) {
    console.error('Erro ao buscar cotações Yahoo:', error);
    res.status(500).json({ error: 'Erro ao buscar preços no Yahoo Finance.' });
  }
});

// ===================== GOOGLE SHEETS =====================
function parseSheetPrice(str) {
  str = (str || '').trim().replace(/[R$\s]/g, '');
  if (!str) return NaN;
  const lastDot = str.lastIndexOf('.');
  const lastComma = str.lastIndexOf(',');
  if (lastDot > -1 && lastComma > -1) {
    if (lastComma > lastDot) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    str = str.replace(',', '.');
  }
  return parseFloat(str);
}

function extractSheetId(url) {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function extractGid(url) {
  const m = url.match(/[?#&]gid=(\d+)/);
  return m ? m[1] : null;
}

async function fetchSheetViaApi(spreadsheetId, apiKey, gid) {
  // Get metadata to find sheet names
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?key=${encodeURIComponent(apiKey)}`;
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) throw new Error(`Google API ${metaRes.status}: ${(await metaRes.text()).slice(0, 200)}`);
  const meta = await metaRes.json();

  // Find target sheet by gid or use first
  let sheet = meta.sheets?.[0];
  if (gid && meta.sheets) {
    sheet = meta.sheets.find(s => String(s.properties?.sheetId) === gid) || sheet;
  }
  const sheetName = sheet?.properties?.title;
  if (!sheetName) throw new Error('Nenhuma aba encontrada na planilha.');

  // Fetch values
  const range = `${encodeURIComponent(sheetName)}!A:Z`;
  const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?key=${encodeURIComponent(apiKey)}`;
  const dataRes = await fetch(dataUrl);
  if (!dataRes.ok) throw new Error(`Google API ${dataRes.status}: ${(await dataRes.text()).slice(0, 200)}`);
  const data = await dataRes.json();
  return data.values || [];
}

async function fetchSheetCSV(csvUrl) {
  const response = await fetch(csvUrl);
  const csv = await response.text();
  return csv.split('\n').filter(l => l.trim());
}

function parseSheetRows(lines) {
  if (!lines.length) return [];
  const headerLine = lines[0];
  let sep = ',';
  for (const s of [',', ';', '\t']) {
    if (headerLine.split(s).length >= 3) { sep = s; break; }
  }
  const headers = headerLine.split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
  const fundosIdx = headers.findIndex(h =>
    h.toUpperCase().includes('FUNDO') || h.toUpperCase() === 'TICKER' || h.toUpperCase() === 'ATIVO' || h.toUpperCase() === 'AÇÃO' || h.toUpperCase() === 'ACAO'
  );
  const precoIdx = headers.findIndex(h =>
    h.toUpperCase().includes('PREÇO') || h.toUpperCase().includes('PRECO') || h.toUpperCase().includes('ATUAL')
  );
  if (fundosIdx < 0 || precoIdx < 0) {
    throw new Error('Colunas FUNDOS e PREÇO ATUAL não encontradas na planilha.');
  }
  const prices = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
    const ticker = cols[fundosIdx]?.trim().toUpperCase();
    if (!ticker) continue;
    const priceStr = cols[precoIdx]?.trim();
    if (!priceStr) continue;
    const price = parseSheetPrice(priceStr);
    if (!isNaN(price) && price > 0) {
      prices[ticker] = { ticker, price, name: ticker, changePercent: null, time: null };
    }
  }
  return prices;
}

const sheetPriceCache = { data: null, timestamp: 0, url: '' };

app.get('/api/quotes/sheets', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL da planilha é obrigatória.' });

  const now = Date.now();
  if (sheetPriceCache.url === url && sheetPriceCache.data && (now - sheetPriceCache.timestamp) < 300000) {
    return res.json(sheetPriceCache.data);
  }

  try {
    const apiKey = req.query.key || process.env.GOOGLE_API_KEY || '';
    let prices = {};

    // Tenta Google Sheets API v4 se tiver key
    if (apiKey) {
      const sheetId = extractSheetId(url);
      if (sheetId) {
        const gid = extractGid(url);
        try {
          const values = await fetchSheetViaApi(sheetId, apiKey, gid);
          prices = parseSheetRows(values.map(r => r.join('\t')));
        } catch (e) {
          console.warn('Google API falhou, tentando CSV:', e.message);
        }
      }
    }

    // Fallback CSV
    if (!Object.keys(prices).length) {
      const csvUrl = url.includes('/export?format=csv')
        ? url
        : url.replace(/\/edit.*$/, '') + '/export?format=csv';
      const lines = await fetchSheetCSV(csvUrl);
      prices = parseSheetRows(lines);
    }

    sheetPriceCache.data = prices;
    sheetPriceCache.timestamp = now;
    sheetPriceCache.url = url;

    res.json(prices);
  } catch (error) {
    console.error('Erro ao buscar planilha:', error);
    res.status(500).json({ error: 'Erro ao buscar preços da planilha.' });
  }
});

// ===================== B3 XLSX IMPORT =====================
app.post('/api/portfolio/parse-b3-xlsx', async (req, res) => {
  const { userId, fileBase64 } = req.body;
  if (!userId || !fileBase64) {
    return res.status(400).json({ error: 'userId e fileBase64 são obrigatórios.' });
  }

  let tmpPath;
  try {
    const buf = Buffer.from(fileBase64, 'base64');
    tmpPath = path.join(os.tmpdir(), `b3-${Date.now()}.xlsx`);
    fs.writeFileSync(tmpPath, buf);
    const wb = XLSX.readFile(tmpPath);
    const sheet = wb.Sheets['Movimentação'];
    if (!sheet) return res.status(400).json({ error: 'Planilha não contém a aba "Movimentação".' });
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const assets = [];
    const positions = {};

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const entry = String(r[0] || '').trim();
      const dateRaw = String(r[1] || '').trim();
      const mov = String(r[2] || '').trim();
      const prod = String(r[3] || '').trim();
      const inst = String(r[4] || '').trim();
      const qty = Number(r[5] || 0);
      const price = Number(String(r[6] || '0').replace(',', '.'));
      const ticker = prod.split(' - ')[0].trim();
      if (!ticker || ticker.length < 4 || ticker === '-' || qty <= 0) continue;

      if (!positions[ticker]) positions[ticker] = { quantity: 0, totalCost: 0 };
      const p = positions[ticker];
      const date = dateRaw ? dateRaw.split('/').reverse().join('-') : new Date().toISOString().split('T')[0];

      if (mov === 'Transferência - Liquidação' && entry === 'Credito') {
        assets.push({ ticker, quantity: qty, purchasePrice: price, purchaseDate: date, institution: inst, movementType: 'compra' });
        p.quantity += qty;
        p.totalCost += qty * price;
      } else if (mov === 'Transferência - Liquidação' && entry === 'Debito') {
        const avgPrice = p.quantity > 0 ? Math.round((p.totalCost / p.quantity) * 100) / 100 : 0;
        assets.push({ ticker, quantity: -qty, purchasePrice: avgPrice, purchaseDate: date, institution: inst, movementType: 'venda' });
        p.quantity -= qty;
        p.totalCost -= qty * avgPrice;
      } else if (mov === 'Transferência' && entry === 'Debito') {
        assets.push({ ticker, quantity: -qty, purchasePrice: 0, purchaseDate: date, institution: inst, movementType: 'venda' });
        if (p.quantity > 0) p.quantity -= qty;
      } else if (mov === 'Bonificação em Ativos' && entry === 'Credito') {
        assets.push({ ticker, quantity: qty, purchasePrice: 0, purchaseDate: date, institution: inst, movementType: 'bonificacao' });
        p.quantity += qty;
      } else if (mov === 'Desdobro' && entry === 'Credito') {
        assets.push({ ticker, quantity: qty, purchasePrice: 0, purchaseDate: date, institution: inst, movementType: 'desdobro' });
        p.quantity += qty;
      } else if (mov === 'Grupamento' && entry === 'Credito') {
        assets.push({ ticker, quantity: qty, purchasePrice: 0, purchaseDate: date, institution: inst, movementType: 'grupamento' });
        p.quantity += qty;
      } else if (mov === 'Incorporação' && entry === 'Credito') {
        assets.push({ ticker, quantity: qty, purchasePrice: 0, purchaseDate: date, institution: inst, movementType: 'incorporacao' });
        p.quantity += qty;
      } else if (mov === 'Fração em Ativos' && entry === 'Debito') {
        assets.push({ ticker, quantity: -qty, purchasePrice: 0, purchaseDate: date, institution: inst, movementType: 'fracao' });
        if (p.quantity > 0) p.quantity -= qty;
      } else if (mov === 'Leilão de Fração' && entry === 'Credito') {
        assets.push({ ticker, quantity: qty, purchasePrice: price, purchaseDate: date, institution: inst, movementType: 'leilao' });
        p.quantity += qty;
        p.totalCost += qty * price;
      }
    }

    assets.sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.ticker.localeCompare(b.ticker));
    res.json({ assets });
  } catch (err) {
    console.error('Erro ao processar XLSX B3:', err);
    res.status(500).json({ error: 'Erro ao processar arquivo: ' + err.message, assets: [] });
  } finally {
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch (e) {}
  }
});

// ===================== CLEAR PORTFOLIO =====================
app.delete('/api/portfolio/clear', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });
  try {
    await pool.query('DELETE FROM portfolio_items WHERE userid = $1', [userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao limpar carteira:', err);
    res.status(500).json({ error: 'Erro ao limpar carteira.' });
  }
});

// ===================== CONFIGURACOES =====================
app.get('/configuracoes', (req, res) => {
  res.sendFile(path.join(__dirname, 'configuracoes.html'));
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, fullname, email FROM users ORDER BY id'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar usuários:', err);
    res.status(500).json({ error: 'Erro ao buscar usuários.' });
  }
});

app.use((req, res) => {
  res.redirect('/');
});

async function seedAssetsDatabase() {
  const assets = [
    ['PETR4', 'Petrobras PN', 'acao'], ['PRIO3', 'PetroRio ON', 'acao'], ['RRRP3', '3R Petroleum ON', 'acao'],
    ['CSAN3', 'Cosan ON', 'acao'], ['VALE3', 'Vale ON', 'acao'], ['CMIN3', 'CSN Mineração ON', 'acao'],
    ['ITUB4', 'Itaú Unibanco PN', 'acao'], ['BBDC4', 'Bradesco PN', 'acao'], ['BBAS3', 'Banco do Brasil ON', 'acao'],
    ['SANB11', 'Santander UNT', 'acao'], ['BPAC11', 'BTG Pactual UNT', 'acao'], ['ABEV3', 'Ambev ON', 'acao'],
    ['JBSS3', 'JBS ON', 'acao'], ['BRFS3', 'BRF ON', 'acao'], ['MRFG3', 'Marfrig ON', 'acao'],
    ['BEEF3', 'Minerva ON', 'acao'], ['WEGE3', 'Weg ON', 'acao'], ['EMBR3', 'Embraer ON', 'acao'],
    ['MGLU3', 'Magazine Luiza ON', 'acao'], ['LREN3', 'Lojas Renner ON', 'acao'], ['AMER3', 'Americanas ON', 'acao'],
    ['CRFB3', 'Carrefour Brasil ON', 'acao'], ['CEAB3', 'C&A ON', 'acao'], ['RENT3', 'Localiza ON', 'acao'],
    ['RAIL3', 'Rumo ON', 'acao'], ['SUZB3', 'Suzano ON', 'acao'], ['KLBN11', 'Klabin UNT', 'acao'],
    ['GGBR4', 'Gerdau PN', 'acao'], ['CSNA3', 'CSN ON', 'acao'], ['USIM5', 'Usiminas PNA', 'acao'],
    ['RADL3', 'Raia Drogasil ON', 'acao'], ['HAPV3', 'Hapvida ON', 'acao'], ['FLRY3', 'Fleury ON', 'acao'],
    ['ELET3', 'Eletrobras ON', 'acao'], ['ELET6', 'Eletrobras PNB', 'acao'], ['NEOE3', 'Neoenergia ON', 'acao'],
    ['TAEE11', 'Taesa UNT', 'acao'], ['CPLE6', 'Copel PNB', 'acao'], ['EGIE3', 'Engie Brasil ON', 'acao'],
    ['VIVT3', 'Telefônica Brasil ON', 'acao'], ['TIMS3', 'TIM ON', 'acao'], ['B3SA3', 'B3 ON', 'acao'],
    ['TOTS3', 'Totvs ON', 'acao'], ['MULT3', 'Multiplan ON', 'acao'], ['BRML3', 'BR Malls ON', 'acao'],
    ['CYRE3', 'Cyrela ON', 'acao'], ['MRVE3', 'MRV ON', 'acao'], ['ECOR3', 'EcoRodovias ON', 'acao'],
    ['CCRO3', 'CCR ON', 'acao'], ['STBP3', 'Santos Brasil ON', 'acao'], ['PSSA3', 'Porto Seguro ON', 'acao'],
    ['SULA11', 'SulAmérica UNT', 'acao'], ['YDUQ3', 'Yduqs ON', 'acao'], ['COGN3', 'Cogna ON', 'acao'],
    ['AZUL4', 'Azul PN', 'acao'], ['GOLL4', 'Gol PN', 'acao'],
    ['HGLG11', 'CSHG Logística FII', 'fii'], ['KNRI11', 'Kinea Renda Imobiliária FII', 'fii'],
    ['VISC11', 'Vinci Shopping Centers FII', 'fii'], ['MXRF11', 'MAXI Renda FII', 'fii'],
    ['HGRE11', 'CSHG Real Estate FII', 'fii'], ['GGRC11', 'GGR Covepi Renda FII', 'fii'],
    ['XPML11', 'XP Malls FII', 'fii'], ['BCFF11', 'BTG FII de Fundos', 'fii'], ['VINO11', 'Vinci Offices FII', 'fii'],
    ['VRTA11', 'Votorantim FII', 'fii'], ['HFOF11', 'Hedge TOP FOFII 3 FII', 'fii'],
    ['KFOF11', 'Kinea FII FOF', 'fii'], ['CPTS11', 'Capitânia FII', 'fii'], ['KNIP11', 'Kinea FII', 'fii'],
    ['XPLG11', 'XP Log FII', 'fii'], ['BTLG11', 'BTG Logística FII', 'fii'], ['BRCR11', 'BC Fund FII', 'fii'],
    ['TGAR11', 'TG Ativo Real FII', 'fii'], ['RBRR11', 'RBR Rendimentos FII', 'fii'],
    ['HGRU11', 'CSHG Urbanismo FII', 'fii'], ['RCRB11', 'Rio Bravo Renda Corporativa FII', 'fii'],
    ['JSRE11', 'JS Real Estate FII', 'fii'], ['PVBI11', 'VBI Prime Properties FII', 'fii'],
    ['ALZR11', 'Alianza Trust Renda Imobiliária FII', 'fii'], ['BBFO11', 'BB Fundo FII', 'fii'],
    ['BBFI11', 'BB Fundo I FII', 'fii'], ['BBFD11', 'BB Fundo Dev FII', 'fii'],
    ['IRDM11', 'Iridium Recebíveis Imobiliários FII', 'fii'], ['RECR11', 'REC Recebíveis Imobiliários FII', 'fii'],
    ['HGJH11', 'CSHG Recebíveis Imobiliários FII', 'fii'], ['AFHI11', 'AF Invest FII', 'fii'],
    ['RBRF11', 'RBR Plus FII', 'fii'], ['RBVA11', 'Rio Bravo Vacare FII', 'fii'],
    ['BIDB11', 'Inter Infra FII', 'fii'],
    ['EGAF11', 'Ecoagro I FIAGRO FII', 'fii']
  ];
  let count = 0;
  for (const a of assets) {
    const result = await pool.query(
      'INSERT INTO b3_assets (ticker, name, assettype) VALUES ($1, $2, $3) ON CONFLICT (ticker) DO NOTHING',
      [a[0], a[1], a[2]]
    );
    if (result.rowCount > 0) count++;
  }
  console.log(`${count} ativos inseridos no banco.`);
}

app.listen(port, '0.0.0.0', async () => {
  try {
    await initDb();
    await migratePortfolioTableIfNeeded();
    await migrateDividendTableIfNeeded();
    await migrateB3AssetsTableIfNeeded();
    await migrateUsersTableIfNeeded();
  } catch (err) {
    console.error('Erro na inicialização do banco:', err);
  }

  const os = require('os');
  const ip = Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address || 'localhost';
  console.log(`Servidor rodando em:`);
  console.log(`  Local:    http://localhost:${port}`);
  console.log(`  Rede:     http://${ip}:${port}`);
});
