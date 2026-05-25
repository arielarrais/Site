require('dotenv').config();

const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const port = process.env.PORT || 3001;
const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

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

function initDb() {
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        fullName TEXT
      )`
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS portfolio_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER,
        ticker TEXT,
        quantity INTEGER,
        purchasePrice REAL,
        purchasedAt TEXT DEFAULT (datetime('now'))
      )`
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS b3_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT UNIQUE,
        name TEXT,
        assetType TEXT,
        createdAt TEXT DEFAULT (datetime('now'))
      )`
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS asset_dividends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assetId INTEGER,
        paymentDate TEXT,
        grossAmount REAL,
        netAmount REAL,
        description TEXT,
        createdAt TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(assetId) REFERENCES b3_assets(id)
      )`
    );

    db.get('SELECT id FROM users WHERE username = ?', ['admin'], (err, row) => {
      if (err) {
        console.error('Erro ao buscar usuário inicial:', err);
        return;
      }

      if (!row) {
        const passwordHash = bcrypt.hashSync('123456', 10);
        db.run(
          'INSERT INTO users (username, password, fullName) VALUES (?, ?, ?)',
          ['admin', passwordHash, 'Administrador'],
          (insertErr) => {
            if (insertErr) {
              console.error('Erro ao inserir usuário inicial:', insertErr);
            } else {
              console.log('Usuário inicial criado: admin / 123456');
            }
          }
        );
      }
    });
  });
}

function migrateDividendTableIfNeeded() {
  db.get(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='asset_dividends'",
    (err, row) => {
      if (err || !row || !row.sql) return;
      if (!/comDate/i.test(row.sql)) {
        db.run('ALTER TABLE asset_dividends ADD COLUMN comDate TEXT', (alterErr) => {
          if (alterErr) console.error('Erro ao adicionar coluna comDate:', alterErr);
          else console.log('Coluna comDate adicionada em asset_dividends.');
        });
      }
    }
  );
}

function migrateB3AssetsTableIfNeeded() {
  const columns = ['longName', 'logoUrl', 'sector', 'regularMarketPrice'];
  db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='b3_assets'", (err, row) => {
    if (err || !row || !row.sql) return;
    columns.forEach(col => {
      if (!new RegExp(`\\b${col}\\b`, 'i').test(row.sql)) {
        db.run(`ALTER TABLE b3_assets ADD COLUMN ${col} TEXT`, (alterErr) => {
          if (alterErr) console.error(`Erro ao adicionar coluna ${col}:`, alterErr);
          else console.log(`Coluna ${col} adicionada em b3_assets.`);
        });
      }
    });
  });
}

function migratePortfolioTableIfNeeded() {
  db.get(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='portfolio_items'",
    (err, row) => {
      if (err || !row || !row.sql) {
        return;
      }
      if (row.sql.includes('purchaseDate')) {
        db.serialize(() => {
          db.run('DROP TABLE IF EXISTS portfolio_items_new');
          db.run(
            `CREATE TABLE IF NOT EXISTS portfolio_items_new (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               userId INTEGER,
               ticker TEXT,
               quantity INTEGER,
               purchasePrice REAL,
               purchasedAt TEXT DEFAULT (datetime('now'))
             );
             INSERT INTO portfolio_items_new (id, userId, ticker, quantity, purchasePrice, purchasedAt)
               SELECT id, userId, ticker, quantity, purchasePrice, purchasedAt FROM portfolio_items;
             DROP TABLE portfolio_items;
             ALTER TABLE portfolio_items_new RENAME TO portfolio_items;
            `,
            (migrateErr) => {
              if (migrateErr) {
                console.error('Erro ao migrar tabela portfolio_items:', migrateErr);
              } else {
                console.log('Tabela portfolio_items migrada para permitir lançamentos duplicados.');
              }
            }
          );
        });
      }
    }
  );
}

function migrateUsersTableIfNeeded() {
  db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
    if (err || !row || !row.sql) return;
    if (!/email/i.test(row.sql)) {
      db.run('ALTER TABLE users ADD COLUMN email TEXT', (alterErr) => {
        if (alterErr) console.error('Erro ao adicionar coluna email:', alterErr);
        else console.log('Coluna email adicionada em users.');
      });
    }
  });
}

app.post('/api/register', (req, res) => {
  const { username, password, fullName, email } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Senha deve ter pelo menos 4 caracteres.' });
  }

  db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
    if (err) {
      console.error('Erro ao verificar usuário:', err);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
    if (row) {
      return res.status(400).json({ error: 'Usuário já existe.' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    db.run(
      'INSERT INTO users (username, password, fullName, email) VALUES (?, ?, ?, ?)',
      [username, passwordHash, fullName || username, email || null],
      function (insertErr) {
        if (insertErr) {
          console.error('Erro ao criar usuário:', insertErr);
          return res.status(500).json({ error: 'Erro ao criar usuário.' });
        }
        res.json({ id: this.lastID, username, fullName: fullName || username, email });
      }
    );
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }

  db.get(
    'SELECT id, username, password, fullName FROM users WHERE username = ?',
    [username],
    (err, user) => {
      if (err) {
        console.error('Erro ao buscar usuário:', err);
        return res.status(500).json({ error: 'Erro interno do servidor.' });
      }

      if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
      }

      res.json({ id: user.id, username: user.username, fullName: user.fullName });
    }
  );
});

app.get('/api/portfolio', (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId) {
    return res.status(400).json({ error: 'userId é obrigatório.' });
  }

  db.all(
    'SELECT id, ticker, quantity, purchasePrice, purchasedAt AS purchaseDate FROM portfolio_items WHERE userId = ? ORDER BY purchasedAt ASC, id ASC',
    [userId],
    (err, rows) => {
      if (err) {
        console.error('Erro ao buscar carteira:', err);
        return res.status(500).json({ error: 'Erro ao buscar carteira.' });
      }
      res.json(rows);
    }
  );
});

app.get('/api/portfolio/dividend-returns', (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });
  db.all(
    `SELECT a.ticker,
       COALESCE(SUM(
         d.grossAmount * (
           SELECT COALESCE(SUM(p.quantity), 0)
           FROM portfolio_items p
           WHERE p.ticker = a.ticker AND p.userId = ? AND p.purchasedAt <= d.comDate
         )
       ), 0) as totalDividends
     FROM asset_dividends d
     JOIN b3_assets a ON d.assetId = a.id
     WHERE EXISTS (
       SELECT 1 FROM portfolio_items p
       WHERE p.ticker = a.ticker AND p.userId = ? AND p.purchasedAt <= d.comDate
     )
     GROUP BY a.ticker`,
    [userId, userId],
    (err, rows) => {
      if (err) {
        console.error('Erro ao calcular dividendos:', err);
        return res.status(500).json({ error: 'Erro ao calcular dividendos.' });
      }
      res.json(rows);
    }
  );
});

app.post('/api/portfolio', (req, res) => {
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

  db.run(
    'INSERT INTO portfolio_items (userId, ticker, quantity, purchasePrice, purchasedAt) VALUES (?, ?, ?, ?, ?)',
    [userId, normalizedTicker, qty, price, purchaseDateValue],
    function (insertErr) {
      if (insertErr) {
        console.error('Erro ao inserir item na carteira:', insertErr);
        return res.status(500).json({ error: 'Erro ao salvar item da carteira.' });
      }
      res.json({ id: this.lastID, ticker: normalizedTicker, quantity: qty, purchasePrice: price, purchaseDate: purchaseDateValue });
    }
  );
});

app.put('/api/portfolio', (req, res) => {
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
  if (qty != null) { fields.push('quantity = ?'); params.push(qty); }
  if (price != null) { fields.push('purchasePrice = ?'); params.push(price); }
  if (date != null) { fields.push('purchasedAt = ?'); params.push(date); }

  if (!fields.length) {
    return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  }

  params.push(Number(id), Number(userId));
  db.run(
    `UPDATE portfolio_items SET ${fields.join(', ')} WHERE id = ? AND userId = ?`,
    params,
    function (err) {
      if (err) {
        console.error('Erro ao atualizar item da carteira:', err);
        return res.status(500).json({ error: 'Erro ao atualizar item da carteira.' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Item não encontrado.' });
      }
      res.json({ id: Number(id), quantity: qty, purchasePrice: price, purchaseDate: date });
    }
  );
});

app.delete('/api/portfolio', (req, res) => {
  const userId = Number(req.query.userId);
  const id = Number(req.query.id);

  if (!userId || !id) {
    return res.status(400).json({ error: 'userId e id são obrigatórios.' });
  }

  db.run(
    'DELETE FROM portfolio_items WHERE userId = ? AND id = ?',
    [userId, id],
    function (err) {
      if (err) {
        console.error('Erro ao remover item da carteira:', err);
        return res.status(500).json({ error: 'Erro ao remover item da carteira.' });
      }
      res.json({ success: true });
    }
  );
});

app.get('/api/b3-assets', (req, res) => {
  const query = (req.query.q || '').trim().toUpperCase();
  let sql, params;
  if (query) {
    sql = 'SELECT id, ticker, name, assetType FROM b3_assets WHERE ticker LIKE ? OR name LIKE ? ORDER BY ticker LIMIT 30';
    params = [`%${query}%`, `%${query}%`];
  } else {
    sql = 'SELECT id, ticker, name, assetType FROM b3_assets ORDER BY assetType, ticker';
    params = [];
  }
  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Erro ao buscar ativos B3:', err);
      return res.status(500).json({ error: 'Erro ao buscar ativos B3.' });
    }
    res.json(rows);
  });
});

app.post('/api/b3-assets', (req, res) => {
  const { ticker, name, assetType } = req.body;
  if (!ticker || !name) {
    return res.status(400).json({ error: 'Ticker e nome são obrigatórios.' });
  }

  const normalizedTicker = String(ticker).trim().toUpperCase();
  db.run(
    'INSERT INTO b3_assets (ticker, name, assetType) VALUES (?, ?, ?)',
    [normalizedTicker, String(name).trim(), assetType ? String(assetType).trim() : null],
    function (err) {
      if (err) {
        console.error('Erro ao salvar ativo B3:', err);
        return res.status(500).json({ error: 'Erro ao salvar ativo B3.' });
      }
      res.json({ id: this.lastID, ticker: normalizedTicker, name, assetType });
    }
  );
});

app.get('/api/dividends', (req, res) => {
  const assetId = Number(req.query.assetId);
  const ticker = (req.query.ticker || '').trim().toUpperCase();
  let query, params;
  if (ticker) {
    query = `SELECT d.id, d.assetId, d.comDate, d.paymentDate, d.grossAmount, d.netAmount, d.description, d.createdAt
             FROM asset_dividends d JOIN b3_assets a ON d.assetId = a.id
             WHERE a.ticker = ? ORDER BY d.paymentDate DESC`;
    params = [ticker];
  } else if (assetId) {
    query = 'SELECT id, assetId, comDate, paymentDate, grossAmount, netAmount, description, createdAt FROM asset_dividends WHERE assetId = ? ORDER BY paymentDate DESC';
    params = [assetId];
  } else {
    query = 'SELECT id, assetId, comDate, paymentDate, grossAmount, netAmount, description, createdAt FROM asset_dividends ORDER BY paymentDate DESC';
    params = [];
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Erro ao buscar dividendos:', err);
      return res.status(500).json({ error: 'Erro ao buscar dividendos.' });
    }
    res.json(rows);
  });
});

app.post('/api/dividends', (req, res) => {
  const { assetId, paymentDate, grossAmount, netAmount, description } = req.body;
  if (!assetId || !paymentDate || grossAmount == null) {
    return res.status(400).json({ error: 'assetId, paymentDate e grossAmount são obrigatórios.' });
  }

  const paymentDateValue = String(paymentDate).trim();
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(paymentDateValue)) {
    return res.status(400).json({ error: 'Data de pagamento deve estar no formato YYYY-MM-DD.' });
  }

  db.run(
    'INSERT INTO asset_dividends (assetId, paymentDate, grossAmount, netAmount, description) VALUES (?, ?, ?, ?, ?)',
    [assetId, paymentDateValue, Number(grossAmount), netAmount != null ? Number(netAmount) : null, description ? String(description).trim() : null],
    function (err) {
      if (err) {
        console.error('Erro ao salvar dividendo:', err);
        return res.status(500).json({ error: 'Erro ao salvar dividendo.' });
      }
      res.json({ id: this.lastID, assetId, paymentDate: paymentDateValue, grossAmount: Number(grossAmount), netAmount: netAmount != null ? Number(netAmount) : null, description });
    }
  );
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
app.get('/admin/ativos', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-ativos.html'));
});

app.get('/api/admin/assets', (req, res) => {
  db.all(
    `SELECT a.id, a.ticker, a.name, a.assetType,
            (SELECT d.comDate FROM asset_dividends d WHERE d.assetId = a.id ORDER BY d.paymentDate DESC LIMIT 1) AS lastComDate,
            (SELECT MAX(d.paymentDate) FROM asset_dividends d WHERE d.assetId = a.id) AS lastDividendDate,
            (SELECT d.grossAmount FROM asset_dividends d WHERE d.assetId = a.id ORDER BY d.paymentDate DESC LIMIT 1) AS lastDividendValue
     FROM b3_assets a ORDER BY a.assetType, a.ticker`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Erro ao buscar ativos:', err);
        return res.status(500).json({ error: 'Erro ao buscar ativos.' });
      }
      res.json(rows);
    }
  );
});

app.get('/api/admin/dividends', (req, res) => {
  const assetId = Number(req.query.assetId);
  let query, params;
  if (assetId) {
    query = 'SELECT id, assetId, paymentDate, grossAmount, netAmount, description, createdAt FROM asset_dividends WHERE assetId = ? ORDER BY paymentDate DESC';
    params = [assetId];
  } else {
    query = 'SELECT id, assetId, paymentDate, grossAmount, netAmount, description, createdAt FROM asset_dividends ORDER BY paymentDate DESC';
    params = [];
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Erro ao buscar dividendos:', err);
      return res.status(500).json({ error: 'Erro ao buscar dividendos.' });
    }
    res.json(rows);
  });
});

app.post('/api/admin/dividends', (req, res) => {
  const { assetId, comDate, paymentDate, grossAmount } = req.body;
  if (!assetId || !comDate || !paymentDate || grossAmount == null) {
    return res.status(400).json({ error: 'assetId, comDate, paymentDate e grossAmount são obrigatórios.' });
  }

  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(comDate)) {
    return res.status(400).json({ error: 'Data COM deve estar no formato YYYY-MM-DD.' });
  }
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(paymentDate)) {
    return res.status(400).json({ error: 'Data pgto deve estar no formato YYYY-MM-DD.' });
  }

  db.run(
    'INSERT INTO asset_dividends (assetId, comDate, paymentDate, grossAmount) VALUES (?, ?, ?, ?)',
    [assetId, comDate, paymentDate, Number(grossAmount)],
    function (err) {
      if (err) {
        console.error('Erro ao salvar dividendo:', err);
        return res.status(500).json({ error: 'Erro ao salvar dividendo.' });
      }
      res.json({ id: this.lastID, assetId, comDate, paymentDate, grossAmount: Number(grossAmount) });
    }
  );
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
    db.run(
      `UPDATE b3_assets SET name = ?, longName = ?, logoUrl = ?, regularMarketPrice = ? WHERE ticker = ?`,
      [quote.shortName || ticker, quote.longName || null, quote.logourl || null, String(quote.regularMarketPrice || ''), ticker],
      function (err) {
        if (err) {
          console.error('Erro ao atualizar ativo:', err);
          return res.status(500).json({ error: 'Erro ao salvar dados da Brapi.' });
        }
        res.json({ ticker, name: quote.shortName, longName: quote.longName, price: quote.regularMarketPrice });
      }
    );
  } catch (error) {
    console.error('Erro ao sincronizar com Brapi:', error);
    res.status(500).json({ error: 'Erro ao consultar Brapi.' });
  }
});

app.use((req, res) => {
  res.redirect('/');
});

function seedAssetsDatabase() {
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
    ['BIDB11', 'Inter Infra FII', 'fii']
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO b3_assets (ticker, name, assetType) VALUES (?, ?, ?)');
  let count = 0;
  assets.forEach(a => { stmt.run(a[0], a[1], a[2], function (err) { if (!err && this.changes > 0) count++; }); });
  stmt.finalize();
  console.log(`${count} ativos inseridos no banco.`);
}

app.listen(port, '0.0.0.0', () => {
  initDb();
  migratePortfolioTableIfNeeded();
  migrateDividendTableIfNeeded();
  migrateB3AssetsTableIfNeeded();
  migrateUsersTableIfNeeded();
  seedAssetsDatabase();
  const ip = require('os').networkInterfaces();
  const localIp = Object.values(ip).flat().find(i => i.family === 'IPv4' && !i.internal)?.address || 'localhost';
  console.log(`Servidor rodando em:`);
  console.log(`  Local:    http://localhost:${port}`);
  console.log(`  Rede:     http://${localIp}:${port}`);
});
