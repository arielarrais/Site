const sqlite3 = require('sqlite3');
const { Client } = require('pg');

const PGCONFIG = {
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:5432/site_db'
};

async function migrate() {
  const sqlite = new sqlite3.Database('database.sqlite');
  const pg = new Client(PGCONFIG);
  await pg.connect();
  console.log('Conectado ao PostgreSQL.');

  const createTables = `
    DROP TABLE IF EXISTS asset_dividends CASCADE;
    DROP TABLE IF EXISTS portfolio_items CASCADE;
    DROP TABLE IF EXISTS b3_assets CASCADE;
    DROP TABLE IF EXISTS users CASCADE;

    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT,
      fullname TEXT,
      email TEXT
    );

    CREATE TABLE portfolio_items (
      id SERIAL PRIMARY KEY,
      userid INTEGER,
      ticker TEXT,
      quantity INTEGER,
      purchaseprice DOUBLE PRECISION,
      purchasedat TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    );

    CREATE TABLE b3_assets (
      id SERIAL PRIMARY KEY,
      ticker TEXT UNIQUE,
      name TEXT,
      assettype TEXT,
      createdat TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
      longname TEXT,
      sector TEXT,
      regularmarketprice TEXT,
      logourl TEXT
    );

    CREATE TABLE asset_dividends (
      id SERIAL PRIMARY KEY,
      assetid INTEGER,
      paymentdate TEXT,
      grossamount DOUBLE PRECISION,
      netamount DOUBLE PRECISION,
      description TEXT,
      createdat TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
      comdate TEXT
    );
  `;

  await pg.query(createTables);
  console.log('Tabelas criadas no PostgreSQL.');

  // --- Migrate users ---
  const users = await new Promise((resolve, reject) =>
    sqlite.all('SELECT * FROM users', (err, rows) => err ? reject(err) : resolve(rows))
  );
  for (const u of users) {
    await pg.query(
      'INSERT INTO users (id, username, password, fullname, email) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
      [u.id, u.username, u.password, u.fullName || null, u.email || null]
    );
  }
  console.log(`  ${users.length} usuários migrados.`);

  // --- Migrate b3_assets ---
  const assets = await new Promise((resolve, reject) =>
    sqlite.all('SELECT * FROM b3_assets', (err, rows) => err ? reject(err) : resolve(rows))
  );
  for (const a of assets) {
    await pg.query(
      `INSERT INTO b3_assets (id, ticker, name, assettype, createdat, longname, sector, regularmarketprice, logourl)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
      [a.id, a.ticker, a.name, a.assetType, a.createdAt, a.longName || null, a.sector || null, a.regularMarketPrice || null, a.logoUrl || null]
    );
  }
  console.log(`  ${assets.length} ativos migrados.`);

  // --- Migrate portfolio_items ---
  const portfolio = await new Promise((resolve, reject) =>
    sqlite.all('SELECT * FROM portfolio_items', (err, rows) => err ? reject(err) : resolve(rows))
  );
  for (const p of portfolio) {
    await pg.query(
      `INSERT INTO portfolio_items (id, userid, ticker, quantity, purchaseprice, purchasedat)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [p.id, p.userId, p.ticker, p.quantity, p.purchasePrice, p.purchasedAt]
    );
  }
  console.log(`  ${portfolio.length} itens de portfólio migrados.`);

  // --- Migrate asset_dividends ---
  const dividends = await new Promise((resolve, reject) =>
    sqlite.all('SELECT * FROM asset_dividends', (err, rows) => err ? reject(err) : resolve(rows))
  );
  for (const d of dividends) {
    await pg.query(
      `INSERT INTO asset_dividends (id, assetid, paymentdate, grossamount, netamount, description, createdat, comdate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [d.id, d.assetId, d.paymentDate, d.grossAmount, d.netAmount || null, d.description || null, d.createdAt, d.comDate || null]
    );
  }
  console.log(`  ${dividends.length} dividendos migrados.`);

  // --- Reset sequence IDs ---
  await pg.query("SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id),1) FROM users))");
  await pg.query("SELECT setval('b3_assets_id_seq', (SELECT COALESCE(MAX(id),1) FROM b3_assets))");
  await pg.query("SELECT setval('portfolio_items_id_seq', (SELECT COALESCE(MAX(id),1) FROM portfolio_items))");
  await pg.query("SELECT setval('asset_dividends_id_seq', (SELECT COALESCE(MAX(id),1) FROM asset_dividends))");
  console.log('Sequências resetadas.');

  await pg.end();
  sqlite.close();
  console.log('\nMigração concluída com sucesso!');
}

migrate().catch(err => { console.error('Erro na migração:', err); process.exit(1); });
