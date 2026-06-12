const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./database.sqlite', sqlite3.OPEN_READONLY);
db.all("SELECT d.id, a.ticker, d.comDate, d.paymentDate, d.grossAmount FROM asset_dividends d JOIN b3_assets a ON d.assetId = a.id WHERE a.ticker = 'EGAF11' ORDER BY d.comDate", (e, r) => {
  console.log(JSON.stringify(r, null, 2));
  db.close();
});
