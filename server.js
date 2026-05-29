require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { syncAllDividends } = require('./fetch_dividendos');

const app = express();
const port = process.env.PORT || 3001;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('ERRO: DATABASE_URL não definida. Configure a variável de ambiente.');
  process.exit(1);
}
const pool = new Pool({ connectionString: databaseUrl });

app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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
      purchasedat TEXT DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
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
  const { rows } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'portfolio_items' AND column_name = 'purchasedate'
  `);
  if (rows.length > 0) {
    await pool.query('DROP TABLE IF EXISTS portfolio_items_new');
    await pool.query(`
      CREATE TABLE portfolio_items_new (
        id SERIAL PRIMARY KEY,
        userid INTEGER,
        ticker TEXT,
        quantity INTEGER,
        purchaseprice DOUBLE PRECISION,
        purchasedat TEXT DEFAULT (to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
      )
    `);
    await pool.query(`
      INSERT INTO portfolio_items_new (id, userid, ticker, quantity, purchaseprice, purchasedat)
      SELECT id, userid, ticker, quantity, purchaseprice, purchasedat FROM portfolio_items
    `);
    await pool.query('DROP TABLE portfolio_items');
    await pool.query('ALTER TABLE portfolio_items_new RENAME TO portfolio_items');
    await pool.query("SELECT setval('portfolio_items_id_seq', (SELECT COALESCE(MAX(id),1) FROM portfolio_items))");
    console.log('Tabela portfolio_items migrada para permitir lançamentos duplicados.');
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
      'SELECT id, ticker, quantity, purchaseprice AS "purchasePrice", purchasedat AS "purchasedAt" FROM portfolio_items WHERE userid = $1 ORDER BY purchasedat ASC, id ASC',
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
  const { userId, ticker, quantity, purchasePrice, purchaseDate } = req.body;
  if (!userId || !ticker || !quantity || !purchasePrice || !purchaseDate) {
    return res.status(400).json({ error: 'userId, ticker, quantidade, preço de compra e data são obrigatórios.' });
  }

  const normalizedTicker = String(ticker).trim().toUpperCase();
  const qty = Number(quantity);
  const price = Number(purchasePrice);
  const purchaseDateValue = String(purchaseDate).trim();

  if (qty <= 0 || price <= 0) {
    return res.status(400).json({ error: 'Quantidade e preço devem ser maiores que zero.' });
  }

  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(purchaseDateValue)) {
    return res.status(400).json({ error: 'Data de compra deve estar no formato YYYY-MM-DD.' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO portfolio_items (userid, ticker, quantity, purchaseprice, purchasedat) VALUES ($1, $2, $3, $4, $5) RETURNING id, ticker, quantity, purchaseprice, purchasedat',
      [userId, normalizedTicker, qty, price, purchaseDateValue]
    );
    const item = result.rows[0];
    res.json({ id: item.id, ticker: item.ticker, quantity: item.quantity, purchasePrice: item.purchaseprice, purchaseDate: item.purchasedat });
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

  if (qty != null && qty <= 0) {
    return res.status(400).json({ error: 'Quantidade deve ser maior que zero.' });
  }
  if (price != null && price <= 0) {
    return res.status(400).json({ error: 'Preço deve ser maior que zero.' });
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
  try {
    const token = process.env.BRAPI_TOKEN || '';
    const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?token=${encodeURIComponent(token)}`;
    const response = await fetch(url);
    const data = await response.json();
    const quote = data?.results?.[0];
    if (!quote || quote.regularMarketPrice == null) {
      return res.status(404).json({ error: 'Ativo não encontrado na Brapi.' });
    }
    await pool.query(
      `UPDATE b3_assets SET name = $1, longname = $2, logourl = $3, regularmarketprice = $4 WHERE ticker = $5`,
      [quote.shortName || ticker, quote.longName || null, quote.logourl || null, String(quote.regularMarketPrice || ''), ticker]
    );
    res.json({ ticker, name: quote.shortName, longName: quote.longName, price: quote.regularMarketPrice });
  } catch (error) {
    console.error('Erro ao sincronizar com Brapi:', error);
    res.status(500).json({ error: 'Erro ao consultar Brapi.' });
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

app.listen(port, '127.0.0.1', async () => {
  try {
    await initDb();
    await migratePortfolioTableIfNeeded();
    await migrateDividendTableIfNeeded();
    await migrateB3AssetsTableIfNeeded();
    await migrateUsersTableIfNeeded();
    await seedAssetsDatabase();
  } catch (err) {
    console.error('Erro na inicialização do banco:', err);
  }

  const isMonday = new Date().getDay() === 1;
  const SYNC_INTERVAL = 7 * 24 * 60 * 60 * 1000;
  if (isMonday) {
    setTimeout(() => {
      syncAllDividends(pool).catch(err => console.error('Erro no sync inicial:', err));
    }, 60000);
  }
  setInterval(() => {
    if (new Date().getDay() === 1) {
      syncAllDividends(pool).catch(err => console.error('Erro no sync agendado:', err));
    }
  }, SYNC_INTERVAL);
  if (isMonday) {
    console.log(`Auto-sync de dividendos agendado a cada 7 dias.`);
  } else {
    console.log(`Auto-sync de dividendos agendado (próxima execução na segunda-feira).`);
  }

  const os = require('os');
  const ip = Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address || 'localhost';
  console.log(`Servidor rodando em:`);
  console.log(`  Local:    http://localhost:${port}`);
  console.log(`  Rede:     http://${ip}:${port}`);
});
