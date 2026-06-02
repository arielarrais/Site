const API = '/api';
const authKey = 'site-login-authenticated';
const isDashboard = window.location.pathname === '/dashboard';

async function req(url, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
  return data;
}

function getUser() {
  const stored = localStorage.getItem(authKey);
  return stored ? JSON.parse(stored) : null;
}

function setUser(user) {
  localStorage.setItem(authKey, JSON.stringify(user));
}

function clearUser() {
  localStorage.removeItem(authKey);
}

function formatCurrency(value) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getPriceSource() {
  return localStorage.getItem('price-source') || 'brapi';
}

function getSheetUrl() {
  return localStorage.getItem('sheet-url') || '';
}

let sheetPricesCache = null;
let sheetPricesTimestamp = 0;

async function refreshSheetPrices() {
  const url = getSheetUrl();
  if (!url) throw new Error('URL da planilha não configurada.');
  const now = Date.now();
  if (sheetPricesCache && (now - sheetPricesTimestamp) < 60000) return;
  const prices = await req(`/api/quotes/sheets?url=${encodeURIComponent(url)}`);
  sheetPricesCache = prices;
  sheetPricesTimestamp = now;
}

// ===================== LOGIN PAGE =====================
if (!isDashboard) {
  const loginCard = document.getElementById('login-card');
  const registerCard = document.getElementById('register-card');

  const stored = getUser();
  if (stored) {
    window.location.href = '/dashboard';
  }

  document.getElementById('show-register').onclick = (e) => {
    e.preventDefault();
    loginCard.classList.add('hidden');
    registerCard.classList.remove('hidden');
  };
  document.getElementById('show-login').onclick = (e) => {
    e.preventDefault();
    registerCard.classList.add('hidden');
    loginCard.classList.remove('hidden');
  };

  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (username !== 'admin' && !username.includes('@')) {
      errorEl.textContent = 'Informe um email válido contendo @.';
      return;
    }
    try {
      const user = await req('/api/login', 'POST', { username, password });
      setUser(user);
      window.location.href = '/dashboard';
    } catch (err) {
      errorEl.textContent = err.message;
    }
  };

  document.getElementById('register-form').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('register-error');
    errorEl.textContent = '';
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const fullName = document.getElementById('register-name').value.trim();
    try {
      const user = await req('/api/register', 'POST', { username, password, fullName });
      setUser(user);
      window.location.href = '/dashboard';
    } catch (err) {
      errorEl.textContent = err.message;
    }
  };
}

// ===================== DASHBOARD PAGE =====================
if (isDashboard) {
  let currentUser = getUser();
  if (!currentUser) {
    window.location.href = '/';
  }

  const isAdmin = currentUser && currentUser.username === 'admin';
  if (isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }
  document.querySelectorAll('.sidebar-link').forEach(el => {
    if (el.dataset.page === 'dashboard') el.classList.add('active');
  });

  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle');
  if (sidebar && toggleBtn) {
    if (localStorage.getItem('sidebar-collapsed') === 'true') {
      sidebar.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
    }
    toggleBtn.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('collapsed');
      document.body.classList.toggle('sidebar-collapsed', collapsed);
      localStorage.setItem('sidebar-collapsed', String(collapsed));
    });
  }

  const portfolioPanel = document.getElementById('portfolio-panel');
  const assetSearchForm = document.getElementById('asset-search-form');
  const assetQueryInput = document.getElementById('asset-query');
  const searchResult = document.getElementById('search-result');
  const stocksListElement = document.getElementById('stocks-list');
  const fiisListElement = document.getElementById('fiis-list');
  const stocksSummary = document.getElementById('stocks-summary');
  const fiisSummary = document.getElementById('fiis-summary');
  const stockCountEl = document.getElementById('stock-count');
  const fiiCountEl = document.getElementById('fii-count');

  function findInGrids(selector) {
    return stocksListElement.querySelector(selector) || fiisListElement.querySelector(selector);
  }
  function findAllInGrids(selector) {
    return [...stocksListElement.querySelectorAll(selector), ...fiisListElement.querySelectorAll(selector)];
  }
  const metricTotalValue = document.getElementById('metric-total-value');
  const metricInvested = document.getElementById('metric-invested');
  const metricVariation = document.getElementById('metric-variation');
  const metricCostDividends = document.getElementById('metric-cost-dividends');

  const portfolioSort = { key: null, dir: 'asc' };

  const assetByTicker = new Map();
  const latestPrices = new Map();
  const dividendReturns = new Map();
  const realTimeInterval = 15000;

  document.getElementById('display-user').textContent = currentUser.fullName || currentUser.username;

  function getPortfolio() {
    return JSON.parse(localStorage.getItem('site-portfolio-items') || '[]');
  }

  function savePortfolio(portfolio) {
    localStorage.setItem('site-portfolio-items', JSON.stringify(portfolio));
  }

  async function fetchPortfolioFromServer(userId) {
    if (!userId) return [];
    const data = await req(`/api/portfolio?userId=${encodeURIComponent(userId)}`);
    return data.map(item => ({
      id: item.id,
      ticker: item.ticker,
      quantity: item.quantity,
      purchasePrice: item.purchasePrice ?? item.purchaseprice ?? item.purchaseprice,
      purchaseDate: item.purchaseDate ?? item.purchasedAt ?? item.purchasedat ?? item.purchasdate
    }));
  }

  async function savePortfolioItemToServer(item, userId) {
    return await req('/api/portfolio', 'POST', {
      userId,
      ticker: item.ticker,
      quantity: item.quantity,
      purchasePrice: item.purchasePrice,
      purchaseDate: item.purchaseDate
    });
  }

  async function updatePortfolioItemInServer(item, userId) {
    return await req('/api/portfolio', 'PUT', {
      id: item.id,
      userId,
      quantity: item.quantity,
      purchasePrice: item.purchasePrice,
      purchaseDate: item.purchaseDate
    });
  }

  async function removePortfolioItemFromServer(id, userId) {
    return await req(`/api/portfolio?userId=${encodeURIComponent(userId)}&id=${encodeURIComponent(id)}`, 'DELETE');
  }

  function getTodayInputValue() {
    return new Date().toISOString().split('T')[0];
  }

  function dateToISO(ddmmyyyy) {
    if (!ddmmyyyy) return '';
    const parts = ddmmyyyy.split('/');
    if (parts.length !== 3) return ddmmyyyy;
    const [d, m, y] = parts;
    if (d.length !== 2 || m.length !== 2 || y.length !== 4) return ddmmyyyy;
    return `${y}-${m}-${d}`;
  }

  function isoToDateBR(isoDate) {
    if (!isoDate) return '';
    const parts = isoDate.split('T')[0].split('-');
    if (parts.length !== 3) return isoDate;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function enhanceDateInputs() {
    document.querySelectorAll('input[type="date"].date-br').forEach(input => {
      if (input.dataset.enhanced) return;
      input.dataset.enhanced = '1';

      const wrap = document.createElement('span');
      wrap.className = 'date-br-wrap';

      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.className = 'date-br-text';
      textInput.placeholder = 'DD/MM/AAAA';
      textInput.maxLength = 10;
      textInput.value = input.value ? isoToDateBR(input.value) : '';

      input.classList.add('date-br-native');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'date-br-btn';
      btn.setAttribute('aria-label', 'Abrir calendário');
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(textInput);
      wrap.appendChild(input);
      wrap.appendChild(btn);

      function syncDateToText() {
        textInput.value = input.value ? isoToDateBR(input.value) : '';
      }

      textInput.addEventListener('input', () => {
        let digits = textInput.value.replace(/\D/g, '');
        let formatted = '';
        if (digits.length > 0) formatted = digits.substring(0, 2);
        if (digits.length > 2) formatted += '/' + digits.substring(2, 4);
        if (digits.length > 4) formatted += '/' + digits.substring(4, 8);
        textInput.value = formatted;
        if (digits.length === 8) {
          const d = digits.substring(0, 2), m = digits.substring(2, 4), y = digits.substring(4, 8);
          if (+d >= 1 && +d <= 31 && +m >= 1 && +m <= 12) {
            input.value = `${y}-${m}-${d}`;
          }
        }
      });

      input.addEventListener('change', syncDateToText);

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        try { input.showPicker(); } catch { input.focus(); }
      });
    });
  }

  async function findAsset(query) {
    const formatted = query.trim().toUpperCase();
    if (!formatted) return null;
    try {
      const results = await req(`/api/b3-assets?q=${encodeURIComponent(formatted)}`);
      if (results.length) {
        const found = results[0];
        assetByTicker.set(found.ticker, { ticker: found.ticker, name: found.name, price: 0 });
        return { ticker: found.ticker, name: found.name };
      }
    } catch (e) { console.warn(e.message); }
    return null;
  }

  async function fetchQuotePrice(ticker) {
    const source = getPriceSource();
    let quote;
    if (source === 'yahoo') {
      quote = await req(`/api/quote/yahoo?ticker=${encodeURIComponent(ticker)}`);
    } else if (source === 'sheets') {
      await refreshSheetPrices();
      quote = sheetPricesCache?.[ticker];
      if (!quote) throw new Error('Ticker não encontrado na planilha.');
    } else {
      quote = await req(`/api/quote?ticker=${encodeURIComponent(ticker)}`);
    }
    latestPrices.set(ticker, quote.price);
    if (assetByTicker.has(ticker)) {
      const asset = assetByTicker.get(ticker);
      asset.price = quote.price;
      asset.name = quote.name || asset.name;
    } else {
      assetByTicker.set(ticker, { ticker, name: quote.name || ticker, price: quote.price });
    }
    return quote.price;
  }

  function getAssetCurrentPrice(ticker) {
    return latestPrices.has(ticker) ? latestPrices.get(ticker) : 0;
  }

  async function fetchQuotes(tickers) {
    if (!tickers.length) return {};
    const source = getPriceSource();
    if (source === 'yahoo') {
      return await req(`/api/quotes/yahoo?tickers=${encodeURIComponent(tickers.join(','))}`);
    }
    if (source === 'sheets') {
      await refreshSheetPrices();
      const result = {};
      tickers.forEach(t => { if (sheetPricesCache?.[t]) result[t] = sheetPricesCache[t]; });
      return result;
    }
    return await req(`/api/quotes?tickers=${encodeURIComponent(tickers.join(','))}`);
  }

  async function refreshPortfolioPrices() {
    const portfolio = getPortfolio();
    if (!portfolio.length) return;
    const tickers = [...new Set(portfolio.map((item) => item.ticker))];
    try {
      const quotes = await fetchQuotes(tickers);
      Object.entries(quotes).forEach(([ticker, quote]) => {
        const price = quote.price;
        latestPrices.set(ticker, price);
        if (assetByTicker.has(ticker)) {
          const asset = assetByTicker.get(ticker);
          asset.price = price;
          if (quote.name) asset.name = quote.name;
        } else {
          assetByTicker.set(ticker, { ticker, name: quote.name || ticker, price });
        }
      });
      if (Object.keys(quotes).length < tickers.length) {
        const missing = tickers.filter(t => !quotes[t]);
        await Promise.allSettled(missing.map(t => fetchQuotePrice(t)));
      }
    } catch (error) {
      console.warn('Batch falhou, buscando individualmente...');
      await Promise.allSettled(tickers.map(t => fetchQuotePrice(t)));
    }
    updatePriceDisplay();
  }

  function updatePriceDisplay() {
    const portfolio = getPortfolio();
    if (!portfolio.length) return;
    const grouped = Object.values(portfolio.reduce((acc, item) => {
      if (!acc[item.ticker]) acc[item.ticker] = { ticker: item.ticker, items: [], totalQuantity: 0, totalCost: 0 };
      acc[item.ticker].items.push(item);
      acc[item.ticker].totalQuantity += item.quantity;
      acc[item.ticker].totalCost += (item.purchasePrice ?? 0) * item.quantity;
      return acc;
    }, {}));

    let totalValue = 0;
    let totalInvested = 0;

    for (const group of grouped) {
      const row = findInGrids(`.grid-row[data-ticker="${group.ticker}"]`);
      if (!row) continue;
      const currentPrice = getAssetCurrentPrice(group.ticker);
      const value = currentPrice * group.totalQuantity;
      const cost = group.totalCost;
      const totalDiv = dividendReturns.get(group.ticker) || 0;
      const profitLoss = value - cost;
      const averagePrice = group.totalQuantity ? cost / group.totalQuantity : 0;
      const costWithDiv = value + totalDiv;
      const rentabilidade = costWithDiv - cost;
      const rentPct = cost > 0 ? (rentabilidade / cost * 100) : 0;
      const cells = row.querySelectorAll('.grid-cell');

      totalValue += value;
      totalInvested += cost;

      if (cells.length >= 11) {
        cells[3].textContent = currentPrice ? formatCurrency(currentPrice) : '—';
        cells[4].textContent = formatCurrency(averagePrice);
        cells[6].textContent = formatCurrency(value);
        cells[7].textContent = formatCurrency(totalDiv);
        cells[8].textContent = formatCurrency(costWithDiv);
        cells[9].textContent = formatCurrency(profitLoss);
        cells[9].className = 'grid-cell ' + (profitLoss >= 0 ? 'profit' : 'loss');
        cells[10].innerHTML = `${formatCurrency(rentabilidade)} <span class="pct">(${rentPct >= 0 ? '+' : ''}${rentPct.toFixed(2)}%)</span>`;
        cells[10].className = 'grid-cell ' + (rentabilidade >= 0 ? 'profit' : 'loss');
      }

      const details = findInGrids(`.grid-details[data-group="${group.ticker}"]`);
      const addForm = findInGrids(`.add-launch-form[data-ticker="${group.ticker}"]`);
      if (addForm && !addForm.classList.contains('hidden')) {
        const priceInput = addForm.querySelector('.al-price');
        if (priceInput && (Number(priceInput.value) === 0 || priceInput.value === '')) {
          priceInput.value = currentPrice.toFixed(2);
        }
      }

      if (details && !details.classList.contains('hidden')) {
        group.items.forEach(item => {
          const editForm = details.querySelector(`.edit-launch-form[data-id="${item.id}"]`);
          if (!editForm) return;
          const detailRow = editForm.previousElementSibling;
          if (!detailRow || !detailRow.classList.contains('grid-detail-row')) return;
          const itemCurrentPrice = currentPrice;
          const itemValue = itemCurrentPrice * item.quantity;
          const itemCost = (item.purchasePrice ?? itemCurrentPrice) * item.quantity;
          const itemProfitLoss = itemValue - itemCost;
          const cells2 = detailRow.querySelectorAll('.grid-detail-cell');
          if (cells2.length >= 5) {
            cells2[2].querySelector('span:last-child').textContent = formatCurrency(item.purchasePrice ?? itemCurrentPrice);
            cells2[3].querySelector('span:last-child').textContent = formatCurrency(itemCost);
            cells2[4].querySelector('span:last-child').textContent = formatCurrency(itemProfitLoss);
          }
        });
      }
    }

    const totalWithDividends = totalValue + grouped.reduce((sum, g) => sum + (dividendReturns.get(g.ticker) || 0), 0);
    const percent = totalInvested ? ((totalValue - totalInvested) / totalInvested * 100).toFixed(2) : 0;
    const summaryText = `Valor total: ${formatCurrency(totalValue)}  |  Investido: ${formatCurrency(totalInvested)}  |  ${percent >= 0 ? '+' : ''}${percent}%  |  Saldo + Dividendos: ${formatCurrency(totalWithDividends)}`;
    stocksSummary.textContent = summaryText;
    fiisSummary.textContent = summaryText;
    metricTotalValue.textContent = formatCurrency(totalValue);
    metricInvested.textContent = formatCurrency(totalInvested);
    metricVariation.textContent = `${percent >= 0 ? '+' : ''}${percent}%`;
    metricVariation.className = 'metric-value ' + (percent >= 0 ? 'profit' : 'loss');
    metricCostDividends.textContent = formatCurrency(totalWithDividends);
  }

  async function fetchDividendReturns() {
    if (!currentUser) return;
    try {
      const data = await req(`/api/portfolio/dividend-returns?userId=${encodeURIComponent(currentUser.id)}`);
      dividendReturns.clear();
      data.forEach(d => dividendReturns.set(d.ticker, Number(d.totalDividends ?? d.totaldividends ?? 0)));
    } catch (e) { console.warn('Erro ao buscar dividendos:', e.message); }
  }

  function formatDateBR(isoDate) {
    if (!isoDate) return '—';
    const parts = isoDate.split('T')[0].split('-');
    if (parts.length !== 3) return isoDate;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  let dividendChartInstance = null;

  async function showDividendHistory(ticker) {
    try {
      const dividends = await req(`/api/dividends?ticker=${encodeURIComponent(ticker)}`);
      document.getElementById('dividend-modal-ticker').textContent = ticker;
      const list = document.getElementById('dividend-list');

      if (dividendChartInstance) {
        dividendChartInstance.destroy();
        dividendChartInstance = null;
      }

      if (!dividends.length) {
        list.innerHTML = '<p class="empty-message">Nenhum dividendo registrado.</p>';
        document.getElementById('dividend-chart').classList.add('hidden');
      } else {
        let historySort = { key: null, dir: 'asc' };
        function renderHistoryTable(sorted) {
          list.innerHTML = `
            <table class="admin-table sortable">
              <thead>
                <tr>
                  <th data-sort="comDate">Data COM <span class="sort-arrows"></span></th>
                  <th data-sort="paymentDate">Data pgto <span class="sort-arrows"></span></th>
                  <th data-sort="grossAmount">Valor (R$) <span class="sort-arrows"></span></th>
                  <th data-sort="type">Tipo <span class="sort-arrows"></span></th>
                </tr>
              </thead>
              <tbody>
                ${sorted.map(d => `
                  <tr>
                    <td>${formatDateBR(d.comDate)}</td>
                    <td>${formatDateBR(d.paymentDate)}</td>
                    <td>${d.grossAmount != null ? Number(d.grossAmount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</td>
                    <td>${d.type || 'dividendo'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `;
          list.querySelectorAll('.sortable thead th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
              const key = th.dataset.sort;
              historySort.dir = historySort.key === key && historySort.dir === 'asc' ? 'desc' : 'asc';
              historySort.key = key;
              list.querySelectorAll('.sortable thead th[data-sort]').forEach(h => {
                h.querySelector('.sort-arrows').textContent = ' ⇅';
              });
              th.querySelector('.sort-arrows').textContent = historySort.dir === 'asc' ? ' ▲' : ' ▼';
              const sorted = [...dividends].sort((a, b) => {
                let va = a[key], vb = b[key];
                if (key === 'grossAmount') { va = va == null ? -Infinity : Number(va); vb = vb == null ? -Infinity : Number(vb); }
                else { va = (va || '').toString().toLowerCase(); vb = (vb || '').toString().toLowerCase(); }
                return va < vb ? (historySort.dir === 'asc' ? -1 : 1) : va > vb ? (historySort.dir === 'asc' ? 1 : -1) : 0;
              });
              renderHistoryTable(sorted);
            });
          });
        }
        renderHistoryTable(dividends);

        const canvas = document.getElementById('dividend-chart');
        canvas.classList.remove('hidden');
        const sorted = [...dividends].sort((a, b) => (a.paymentDate || '').localeCompare(b.paymentDate || ''));
        const labels = sorted.map(d => formatDateBR(d.paymentDate));
        const values = sorted.map(d => d.grossAmount != null ? Number(d.grossAmount) : 0);
        const types = sorted.map(d => d.type || 'dividendo');
        const isAmort = types.map(t => t === 'amortizacao');
        dividendChartInstance = new Chart(canvas, {
          type: 'bar',
          data: {
            labels,
            datasets: [{
              label: 'Dividendo (R$)',
              data: values,
              backgroundColor: values.map((_, i) => isAmort[i] ? 'rgba(239,68,68,0.7)' : 'rgba(34,197,94,0.7)'),
              borderColor: values.map((_, i) => isAmort[i] ? 'rgb(239,68,68)' : 'rgb(34,197,94)'),
              borderWidth: 1,
              borderRadius: 3
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: ctx => `R$ ${ctx.parsed.y.toFixed(2)}`
                }
              }
            },
            scales: {
              x: {
                ticks: { maxRotation: 45, font: { size: 10 } }
              },
              y: {
                ticks: { callback: v => 'R$' + v.toFixed(2) }
              }
            }
          }
        });
      }
      document.getElementById('dividend-modal').classList.remove('hidden');
    } catch (err) {
      alert('Erro ao carregar dividendos: ' + err.message);
    }
  }

  document.getElementById('dividend-modal-close').addEventListener('click', () => {
    document.getElementById('dividend-modal').classList.add('hidden');
    if (dividendChartInstance) {
      dividendChartInstance.destroy();
      dividendChartInstance = null;
      document.getElementById('dividend-chart').classList.add('hidden');
    }
  });

  document.getElementById('dividend-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      e.target.classList.add('hidden');
      if (dividendChartInstance) {
        dividendChartInstance.destroy();
        dividendChartInstance = null;
        document.getElementById('dividend-chart').classList.add('hidden');
      }
    }
  });

  function renderSearchResult(asset) {
    if (!asset) { searchResult.classList.add('hidden'); return; }
    const price = getAssetCurrentPrice(asset.ticker);
    searchResult.innerHTML = `
      <div class="asset-card">
        <strong>${asset.ticker}</strong>
        <span class="asset-name">${asset.name}</span>
        <span class="asset-price">${formatCurrency(price)}</span>
      </div>
      <div class="buy-form">
        <label>
          Quantidade
          <input id="asset-quantity" type="number" min="1" step="1" value="1" />
        </label>
        <label>
          Preço pago
          <input id="asset-purchase-price" type="number" min="0.01" step="0.01" value="${price.toFixed(2)}" />
        </label>
        <label>
          Data da compra
          <input id="asset-purchase-date" type="date" class="date-br" value="${getTodayInputValue()}" />
        </label>
        <button id="add-asset-button" class="btn btn-primary btn-buy">Cadastrar compra</button>
      </div>
    `;
    searchResult.classList.remove('hidden');
    enhanceDateInputs();
    document.getElementById('add-asset-button').addEventListener('click', async () => {
      const quantity = Number(document.getElementById('asset-quantity').value);
      const purchasePrice = Number(document.getElementById('asset-purchase-price').value);
      const purchaseDate = document.getElementById('asset-purchase-date').value;
      if (!quantity || quantity < 1) { alert('Informe uma quantidade válida.'); return; }
      if (!purchasePrice || purchasePrice <= 0) { alert('Informe um preço de compra válido.'); return; }
      if (!purchaseDate) { alert('Informe a data da compra.'); return; }
      try {
        await addAssetToPortfolio(asset.ticker, quantity, purchasePrice, purchaseDate);
        searchResult.classList.add('hidden');
      } catch (error) {
        alert(error.message);
      }
    });
  }

  function classifyTicker(ticker, typeMap) {
    if (typeMap[ticker]) return typeMap[ticker];
    return 'acao';
  }

  function renderGrid(groups, container, countEl, summaryEl) {
    if (!groups.length) {
      container.innerHTML = '<p class="empty-message">Nenhum ativo cadastrado ainda.</p>';
      countEl.textContent = '';
      summaryEl.textContent = '';
      return;
    }

    if (portfolioSort.key) {
      groups.sort((a, b) => {
        let va = a[portfolioSort.key], vb = b[portfolioSort.key];
        if (va == null) va = portfolioSort.dir === 'asc' ? Infinity : -Infinity;
        if (vb == null) vb = portfolioSort.dir === 'asc' ? Infinity : -Infinity;
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        if (va < vb) return portfolioSort.dir === 'asc' ? -1 : 1;
        if (va > vb) return portfolioSort.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    function ps(key, label) {
      const isActive = portfolioSort.key === key;
      const arrow = isActive ? (portfolioSort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';
      return `<span class="psort" data-sort="${key}">${label} <span class="sort-arrows">${arrow}</span></span>`;
    }

    const gridHeaders = `
      <div class="grid-row grid-header">
        <div class="grid-cell">${ps('ticker', 'Ativo')}</div>
        <div class="grid-cell">${ps('items', 'Lanç.')}</div>
        <div class="grid-cell">${ps('totalQuantity', 'Qtd.')}</div>
        <div class="grid-cell">${ps('_currentPrice', 'Pr. atual')}</div>
        <div class="grid-cell">${ps('_averagePrice', 'Pr. médio')}</div>
        <div class="grid-cell">${ps('totalCost', 'Custo')}</div>
        <div class="grid-cell">${ps('_value', 'Saldo')}</div>
        <div class="grid-cell">${ps('_totalDiv', 'Divid.')}</div>
        <div class="grid-cell">${ps('_costWithDiv', 'Total c/ Div.')}</div>
        <div class="grid-cell">${ps('_profitLoss', 'Result.')}</div>
        <div class="grid-cell">${ps('_rentabilidade', 'Rent. c/ Div.')}</div>
        <div class="grid-cell">Ações</div>
      </div>
    `;

    const gridRows = groups.map((group) => {
      const currentPrice = getAssetCurrentPrice(group.ticker);
      const value = currentPrice * group.totalQuantity;
      const cost = group.totalCost;
      const totalDiv = dividendReturns.get(group.ticker) || 0;
      const costWithDiv = value + totalDiv;
      const profitLoss = value - cost;
      const averagePrice = group.totalQuantity ? cost / group.totalQuantity : 0;
      const rentabilidade = costWithDiv - cost;
      const rentPct = cost > 0 ? (rentabilidade / cost * 100) : 0;

      return `
        <div class="grid-row" data-ticker="${group.ticker}">
          <div class="grid-cell">
            <a href="#" class="ticker-link" data-ticker="${group.ticker}"><strong>${group.ticker}</strong></a>
          </div>
          <div class="grid-cell">${group.items.length}</div>
          <div class="grid-cell">${group.totalQuantity}</div>
          <div class="grid-cell">${currentPrice ? formatCurrency(currentPrice) : '—'}</div>
          <div class="grid-cell">${formatCurrency(averagePrice)}</div>
          <div class="grid-cell">${formatCurrency(cost)}</div>
          <div class="grid-cell">${formatCurrency(value)}</div>
          <div class="grid-cell profit">${formatCurrency(totalDiv)}</div>
          <div class="grid-cell">${formatCurrency(costWithDiv)}</div>
          <div class="grid-cell ${profitLoss >= 0 ? 'profit' : 'loss'}">${formatCurrency(profitLoss)}</div>
          <div class="grid-cell ${rentabilidade >= 0 ? 'profit' : 'loss'}">${formatCurrency(rentabilidade)} <span class="pct">(${rentPct >= 0 ? '+' : ''}${rentPct.toFixed(2)}%)</span></div>
          <div class="grid-cell">
            <button class="group-toggle-button grid-btn" type="button" data-group="${group.ticker}" aria-expanded="false" title="Detalhes">+</button>
            <div class="three-dot-menu" style="display:inline-block">
              <button class="three-dot-btn grid-btn" type="button" data-ticker="${group.ticker}">⋮</button>
              <div class="three-dot-dropdown hidden" data-ticker="${group.ticker}">
                <button class="dropdown-item add-launch-option" type="button" data-ticker="${group.ticker}">+ Adicionar lançamento</button>
              </div>
            </div>
          </div>
        </div>
        <div class="grid-details hidden" data-group="${group.ticker}">
          ${group.items.slice().sort((a, b) => {
            const dateA = a.purchaseDate || a.purchasedAt || '';
            const dateB = b.purchaseDate || b.purchasedAt || '';
            return dateB.localeCompare(dateA);
          }).map((item) => {
            const itemCurrentPrice = getAssetCurrentPrice(item.ticker);
            const itemValue = itemCurrentPrice * item.quantity;
            const itemCost = (item.purchasePrice ?? itemCurrentPrice) * item.quantity;
            const itemProfitLoss = itemValue - itemCost;
            const itemDate = item.purchaseDate || item.purchasedAt || '';
            return `
              <div class="grid-detail-row">
                <div class="grid-detail-cell">
                  <span class="detail-label">Data</span>
                  <span>${formatDateBR(itemDate)}</span>
                </div>
                <div class="grid-detail-cell">
                  <span class="detail-label">Qtd</span>
                  <span>${item.quantity}</span>
                </div>
                <div class="grid-detail-cell">
                  <span class="detail-label">Preço pago</span>
                  <span>${formatCurrency(item.purchasePrice ?? itemCurrentPrice)}</span>
                </div>
                <div class="grid-detail-cell">
                  <span class="detail-label">Total pago</span>
                  <span>${formatCurrency(itemCost)}</span>
                </div>
                <div class="grid-detail-cell">
                  <span class="detail-label">Resultado</span>
                  <span class="${itemProfitLoss >= 0 ? 'profit' : 'loss'}">${formatCurrency(itemProfitLoss)}</span>
                </div>
                <div class="grid-detail-cell">
                  <button class="edit-asset-button" data-id="${item.id}">Editar</button>
                  <button class="remove-asset-button" data-id="${item.id}">Remover</button>
                </div>
              </div>
              <div class="edit-launch-form hidden" data-id="${item.id}">
                <div class="add-launch-inner">
                  <div class="form-title">Editar lançamento</div>
                  <label>Quantidade <input class="el-quantity" type="number" min="1" step="1" value="${item.quantity}" /></label>
                  <label>Preço pago <input class="el-price" type="number" min="0.01" step="0.01" value="${(item.purchasePrice ?? itemCurrentPrice).toFixed(2)}" /></label>
                  <label>Data <input class="el-date date-br" type="date" value="${itemDate || getTodayInputValue()}" /></label>
                  <button class="btn btn-primary el-save" type="button" data-id="${item.id}" style="width:auto">Salvar</button>
                  <button class="btn btn-secondary el-cancel" type="button" style="width:auto">Cancelar</button>
                </div>
              </div>
            `;
          }).join('')}
          <div class="add-launch-form" data-ticker="${group.ticker}">
            <div class="add-launch-inner">
              <div class="form-title">Novo lançamento</div>
              <label>Quantidade <input class="al-quantity" type="number" min="1" step="1" value="1" /></label>
              <label>Preço pago <input class="al-price" type="number" min="0.01" step="0.01" value="${currentPrice.toFixed(2)}" /></label>
              <label>Data <input class="al-date date-br" type="date" value="${getTodayInputValue()}" /></label>
              <button class="btn btn-primary al-save" type="button" data-ticker="${group.ticker}" style="width:auto">Salvar</button>
              <button class="btn btn-secondary al-cancel" type="button" style="width:auto">Cancelar</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = gridHeaders + gridRows;
    countEl.textContent = `${groups.length} ativos`;

    container.querySelectorAll('.grid-header .psort').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.sort;
        if (portfolioSort.key === key) {
          portfolioSort.dir = portfolioSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          portfolioSort.key = key;
          portfolioSort.dir = 'asc';
        }
        renderPortfolio();
      });
    });
  }

  async function renderPortfolio() {
    const openDropdowns = new Set();
    const openForms = new Set();
    const openFormValues = new Map();
    const openEditForms = new Set();
    const openEditFormValues = new Map();
    const openDetails = new Set();
    findAllInGrids('.three-dot-dropdown:not(.hidden)').forEach(el => {
      openDropdowns.add(el.dataset.ticker);
    });
    findAllInGrids('.add-launch-form:not(.hidden)').forEach(el => {
      openForms.add(el.dataset.ticker);
      openFormValues.set(el.dataset.ticker, {
        quantity: el.querySelector('.al-quantity').value,
        price: el.querySelector('.al-price').value,
        date: el.querySelector('.al-date').value,
      });
    });
    findAllInGrids('.edit-launch-form:not(.hidden)').forEach(el => {
      openEditForms.add(el.dataset.id);
      openEditFormValues.set(el.dataset.id, {
        quantity: el.querySelector('.el-quantity').value,
        price: el.querySelector('.el-price').value,
        date: el.querySelector('.el-date').value,
      });
    });
    findAllInGrids('.grid-details:not(.hidden)').forEach(el => {
      openDetails.add(el.dataset.group);
    });

    const portfolio = getPortfolio();
    if (!portfolio.length) {
      stocksListElement.innerHTML = '<p class="empty-message">Nenhum ativo cadastrado ainda.</p>';
      fiisListElement.innerHTML = '<p class="empty-message">Nenhum ativo cadastrado ainda.</p>';
      stockCountEl.textContent = '';
      fiiCountEl.textContent = '';
      stocksSummary.textContent = 'Adicione ativos ao clicar em "Procurar ativo".';
      fiisSummary.textContent = '';
      document.getElementById('metrics-row').classList.add('hidden');
      return;
    } else {
      document.getElementById('metrics-row').classList.remove('hidden');
    }

    const grouped = Object.values(portfolio.reduce((acc, item) => {
      if (!acc[item.ticker]) {
        acc[item.ticker] = { ticker: item.ticker, items: [], totalQuantity: 0, totalCost: 0 };
      }
      acc[item.ticker].items.push(item);
      acc[item.ticker].totalQuantity += item.quantity;
      acc[item.ticker].totalCost += (item.purchasePrice ?? 0) * item.quantity;
      return acc;
    }, {}));

    let typeMap = {};
    try {
      const tickers = [...new Set(grouped.map(g => g.ticker))];
      typeMap = await req(`/api/assets/types?tickers=${encodeURIComponent(tickers.join(','))}`);
    } catch (e) { console.warn('Erro ao buscar tipos:', e.message); }

    const stocks = grouped.filter(g => classifyTicker(g.ticker, typeMap) === 'acao');
    const fiis = grouped.filter(g => classifyTicker(g.ticker, typeMap) !== 'acao');

    const enrichedStocks = stocks.map(g => ({
      ...g,
      _currentPrice: getAssetCurrentPrice(g.ticker),
      _averagePrice: g.totalQuantity ? g.totalCost / g.totalQuantity : 0,
      _value: getAssetCurrentPrice(g.ticker) * g.totalQuantity,
      _totalDiv: dividendReturns.get(g.ticker) || 0,
      _costWithDiv: (getAssetCurrentPrice(g.ticker) * g.totalQuantity) + (dividendReturns.get(g.ticker) || 0),
      _profitLoss: (getAssetCurrentPrice(g.ticker) * g.totalQuantity) - g.totalCost,
      _rentabilidade: ((getAssetCurrentPrice(g.ticker) * g.totalQuantity) + (dividendReturns.get(g.ticker) || 0)) - g.totalCost,
    }));
    const enrichedFiis = fiis.map(g => ({
      ...g,
      _currentPrice: getAssetCurrentPrice(g.ticker),
      _averagePrice: g.totalQuantity ? g.totalCost / g.totalQuantity : 0,
      _value: getAssetCurrentPrice(g.ticker) * g.totalQuantity,
      _totalDiv: dividendReturns.get(g.ticker) || 0,
      _costWithDiv: (getAssetCurrentPrice(g.ticker) * g.totalQuantity) + (dividendReturns.get(g.ticker) || 0),
      _profitLoss: (getAssetCurrentPrice(g.ticker) * g.totalQuantity) - g.totalCost,
      _rentabilidade: ((getAssetCurrentPrice(g.ticker) * g.totalQuantity) + (dividendReturns.get(g.ticker) || 0)) - g.totalCost,
    }));

    const totalValue = grouped.reduce((sum, group) => sum + getAssetCurrentPrice(group.ticker) * group.totalQuantity, 0);
    const totalInvested = grouped.reduce((sum, group) => sum + group.totalCost, 0);
    const totalWithDividends = grouped.reduce((sum, group) => {
      const price = getAssetCurrentPrice(group.ticker);
      return sum + (price * group.totalQuantity) + (dividendReturns.get(group.ticker) || 0);
    }, 0);

    renderGrid(enrichedStocks, stocksListElement, stockCountEl, stocksSummary);
    renderGrid(enrichedFiis, fiisListElement, fiiCountEl, fiisSummary);

    const percent = totalInvested ? ((totalValue - totalInvested) / totalInvested * 100).toFixed(2) : 0;
    const summaryText = `Valor total: ${formatCurrency(totalValue)}  |  Investido: ${formatCurrency(totalInvested)}  |  ${percent >= 0 ? '+' : ''}${percent}%  |  Saldo + Dividendos: ${formatCurrency(totalWithDividends)}`;
    stocksSummary.textContent = summaryText;
    fiisSummary.textContent = summaryText;
    metricTotalValue.textContent = formatCurrency(totalValue);
    metricInvested.textContent = formatCurrency(totalInvested);
    metricVariation.textContent = `${percent >= 0 ? '+' : ''}${percent}%`;
    metricVariation.className = 'metric-value ' + (percent >= 0 ? 'profit' : 'loss');
    metricCostDividends.textContent = formatCurrency(totalWithDividends);

    openDropdowns.forEach(t => {
      const el = findInGrids(`.three-dot-dropdown[data-ticker="${t}"]`);
      if (el) el.classList.remove('hidden');
    });
    openForms.forEach(t => {
      const el = findInGrids(`.add-launch-form[data-ticker="${t}"]`);
      if (el) {
        el.classList.remove('hidden');
        const vals = openFormValues.get(t);
        if (vals) {
          el.querySelector('.al-quantity').value = vals.quantity;
          el.querySelector('.al-price').value = vals.price;
          el.querySelector('.al-date').value = vals.date;
        }
      }
    });
    openEditForms.forEach(id => {
      const el = findInGrids(`.edit-launch-form[data-id="${id}"]`);
      if (el) {
        el.classList.remove('hidden');
        const vals = openEditFormValues.get(id);
        if (vals) {
          el.querySelector('.el-quantity').value = vals.quantity;
          el.querySelector('.el-price').value = vals.price;
          el.querySelector('.el-date').value = vals.date;
        }
      }
    });
    openDetails.forEach(t => {
      const el = findInGrids(`.grid-details[data-group="${t}"]`);
      if (el) el.classList.remove('hidden');
      const btn = findInGrids(`.group-toggle-button[data-group="${t}"]`);
      if (btn) { btn.textContent = '−'; btn.setAttribute('aria-expanded', 'true'); }
    });
    enhanceDateInputs();
  }

  async function addAssetToPortfolio(ticker, quantity, purchasePrice, purchaseDate) {
    const existingPortfolio = getPortfolio();
    if (!currentUser) { alert('Você precisa estar logado.'); return; }
    const item = { ticker, quantity, purchasePrice, purchaseDate };
    const saved = await savePortfolioItemToServer(item, currentUser.id);
    const newPortfolio = [...existingPortfolio, saved];
    savePortfolio(newPortfolio);
    await fetchDividendReturns();
    await renderPortfolio();
    refreshPortfolioPrices();
    alert(`${ticker} cadastrado na carteira com ${quantity} unidade(s) a ${formatCurrency(purchasePrice)}.`);
  }

  async function removeAssetFromPortfolio(id) {
    const numericId = Number(id);
    if (currentUser) {
      try { await removePortfolioItemFromServer(numericId, currentUser.id); } catch (e) { console.warn(e.message); }
    }
    const portfolio = getPortfolio().filter((item) => item.id !== numericId);
    savePortfolio(portfolio);
    await fetchDividendReturns();
    await renderPortfolio();
  }

  async function updateAssetInPortfolio(id, quantity, purchasePrice, purchaseDate) {
    if (!currentUser) { alert('Você precisa estar logado.'); return; }
    const portfolio = getPortfolio();
    const idx = portfolio.findIndex((item) => item.id === id);
    if (idx === -1) { alert('Item não encontrado na carteira.'); return; }
    const updated = { ...portfolio[idx], quantity, purchasePrice, purchaseDate };
    try {
      await updatePortfolioItemInServer(updated, currentUser.id);
      portfolio[idx] = updated;
      savePortfolio(portfolio);
      await fetchDividendReturns();
      await renderPortfolio();
      refreshPortfolioPrices();
    } catch (err) { alert(err.message); }
  }

  fetchPortfolioFromServer(currentUser.id)
    .then(async p => { savePortfolio(p); await fetchDividendReturns(); await renderPortfolio(); refreshPortfolioPrices(); })
    .catch(e => console.warn(e.message));

  // Logout
  document.getElementById('logout-button').addEventListener('click', () => {
    clearUser();
    currentUser = null;
    window.location.href = '/';
  });

  // Close three-dot dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.three-dot-menu')) {
      document.querySelectorAll('.three-dot-dropdown').forEach(d => d.classList.add('hidden'));
    }
  });

  // Section collapse/expand
  document.querySelectorAll('.toggle-section-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      const list = section === 'stocks' ? stocksListElement : fiisListElement;
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';
      list.classList.toggle('hidden', isExpanded);
      btn.setAttribute('aria-expanded', String(!isExpanded));
      btn.textContent = isExpanded ? '+' : '−';
    });
  });

  // Portfolio list click delegation
  portfolioPanel.addEventListener('click', async (event) => {
    const tickerLink = event.target.closest('.ticker-link');
    if (tickerLink) {
      event.preventDefault();
      const ticker = tickerLink.dataset.ticker;
      showDividendHistory(ticker);
      return;
    }

    const toggleButton = event.target.closest('.group-toggle-button');
    if (toggleButton) {
      const groupTicker = toggleButton.dataset.group;
      const details = findInGrids(`.grid-details[data-group="${groupTicker}"]`);
      if (details) {
        const isHidden = details.classList.contains('hidden');
        details.classList.toggle('hidden');
        toggleButton.setAttribute('aria-expanded', String(isHidden));
        toggleButton.textContent = isHidden ? '−' : '+';
      }
      return;
    }

    const threeDotBtn = event.target.closest('.three-dot-btn');
    if (threeDotBtn) {
      const ticker = threeDotBtn.dataset.ticker;
      const dropdown = findInGrids(`.three-dot-dropdown[data-ticker="${ticker}"]`);
      if (dropdown) {
        dropdown.classList.toggle('hidden');
      }
      return;
    }

    const addOption = event.target.closest('.add-launch-option');
    if (addOption) {
      const ticker = addOption.dataset.ticker;
      document.querySelectorAll('.three-dot-dropdown').forEach(d => d.classList.add('hidden'));
      const details = findInGrids(`.grid-details[data-group="${ticker}"]`);
      if (details && details.classList.contains('hidden')) {
        details.classList.remove('hidden');
        const btn = findInGrids(`.group-toggle-button[data-group="${ticker}"]`);
        if (btn) { btn.textContent = '−'; btn.setAttribute('aria-expanded', 'true'); }
      }
      const form = findInGrids(`.add-launch-form[data-ticker="${ticker}"]`);
      if (form) {
        form.classList.remove('hidden');
      }
      return;
    }

    const saveBtn = event.target.closest('.al-save');
    if (saveBtn) {
      const ticker = saveBtn.dataset.ticker;
      const form = saveBtn.closest('.add-launch-form');
      const quantity = Number(form.querySelector('.al-quantity').value);
      const price = Number(form.querySelector('.al-price').value);
      const date = form.querySelector('.al-date').value;
      if (!quantity || quantity < 1) { alert('Quantidade inválida.'); return; }
      if (!price || price <= 0) { alert('Preço inválido.'); return; }
      if (!date) { alert('Data inválida.'); return; }
      try {
        await addAssetToPortfolio(ticker, quantity, price, date);
        form.classList.add('hidden');
      } catch (err) { alert(err.message); }
      return;
    }

    const removeButton = event.target.closest('.remove-asset-button');
    if (removeButton) {
      removeAssetFromPortfolio(removeButton.dataset.id);
      return;
    }

    const editButton = event.target.closest('.edit-asset-button');
    if (editButton) {
      const id = editButton.dataset.id;
      const form = findInGrids(`.edit-launch-form[data-id="${id}"]`);
      if (form) {
        form.classList.toggle('hidden');
      }
      return;
    }

    const elSaveBtn = event.target.closest('.el-save');
    if (elSaveBtn) {
      const id = Number(elSaveBtn.dataset.id);
      const form = elSaveBtn.closest('.edit-launch-form');
      const quantity = Number(form.querySelector('.el-quantity').value);
      const price = Number(form.querySelector('.el-price').value);
      const date = form.querySelector('.el-date').value;
      if (!quantity || quantity < 1) { alert('Quantidade inválida.'); return; }
      if (!price || price <= 0) { alert('Preço inválido.'); return; }
      if (!date) { alert('Data inválida.'); return; }
      await updateAssetInPortfolio(id, quantity, price, date);
      form.classList.add('hidden');
      return;
    }

    const elCancelBtn = event.target.closest('.el-cancel');
    if (elCancelBtn) {
      const form = elCancelBtn.closest('.edit-launch-form');
      if (form) form.classList.add('hidden');
      return;
    }

    const alCancelBtn = event.target.closest('.al-cancel');
    if (alCancelBtn) {
      const form = alCancelBtn.closest('.add-launch-form');
      if (form) form.classList.add('hidden');
      return;
    }
  });

  // Asset search
  assetSearchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = assetQueryInput.value.trim();
    if (!query) {
      searchResult.innerHTML = '<p class="error">Digite um ticker para buscar.</p>';
      searchResult.classList.remove('hidden');
      return;
    }
    let asset = await findAsset(query);
    if (!asset) {
      try {
        await fetchQuotePrice(query.toUpperCase());
        asset = assetByTicker.get(query.toUpperCase());
        if (asset) {
          try {
            const result = await req('/api/assets/auto-create', 'POST', { ticker: query.toUpperCase() });
            const found = await findAsset(query.toUpperCase());
            if (found) asset = found;
            if (result.dividendsInserted > 0) await fetchDividendReturns();
          } catch (e) {
            console.warn('Auto-create falhou:', e.message);
          }
        } else {
          searchResult.innerHTML = '<p class="error">Ativo não encontrado. Tente um ticker válido da B3 ou FII.</p>';
          searchResult.classList.remove('hidden');
          return;
        }
      } catch (error) {
        searchResult.innerHTML = '<p class="error">Ativo não encontrado. Tente um ticker válido da B3 ou FII.</p>';
        searchResult.classList.remove('hidden');
        return;
      }
    } else {
      try { await fetchQuotePrice(asset.ticker); } catch (e) { console.warn(e.message); }
    }
    renderSearchResult(asset);
  });

  // Auto-refresh prices
  setInterval(refreshPortfolioPrices, realTimeInterval);

}
