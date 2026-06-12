const { Client } = require('pg');
const pg = new Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:5432/site_db' });
(async () => {
  await pg.connect();
  const r = await pg.query("SELECT d.id, a.ticker, d.comdate, d.paymentdate, d.grossamount FROM asset_dividends d JOIN b3_assets a ON d.assetid = a.id WHERE a.ticker = 'EGAF11' ORDER BY d.comdate");
  console.log('Dev dividends:', JSON.stringify(r.rows, null, 2));
  await pg.end();
})();
