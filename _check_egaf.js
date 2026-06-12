const { Client } = require('pg');
const pg = new Client({ connectionString: 'postgresql://postgres:wdYjjTAKwyGOopdARgVrMNbrZRJrZQPv@yamanote.proxy.rlwy.net:40845/railway' });
(async () => {
  await pg.connect();
  const r = await pg.query("SELECT id, ticker, quantity, purchasedat, movement_type FROM portfolio_items WHERE ticker = 'EGAF11' ORDER BY purchasedat");
  console.log('Portfolio:', JSON.stringify(r.rows, null, 2));
  const r2 = await pg.query("SELECT d.id, a.ticker, d.comdate, d.paymentdate, d.grossamount FROM asset_dividends d JOIN b3_assets a ON d.assetid = a.id WHERE a.ticker = 'EGAF11' ORDER BY d.comdate");
  console.log('Dividends:', JSON.stringify(r2.rows, null, 2));
  await pg.end();
})();
