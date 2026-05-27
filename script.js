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

  if (currentUser.username === 'admin') {
    const adminBtn = document.getElementById('admin-button');
    adminBtn.classList.remove('hidden');
    adminBtn.addEventListener('click', () => {
      window.location.href = '/admin/ativos';
    });
  }

  const portfolioPanel = document.getElementById('portfolio-panel');
  const assetSearchForm = document.getElementById('asset-search-form');
  const assetQueryInput = document.getElementById('asset-query');
  const searchResult = document.getElementById('search-result');
  const portfolioListElement = document.getElementById('portfolio-list');
  const portfolioSummary = document.getElementById('portfolio-summary');
  const metricTotalValue = document.getElementById('metric-total-value');
  const metricInvested = document.getElementById('metric-invested');
  const metricVariation = document.getElementById('metric-variation');
  const metricCostDividends = document.getElementById('metric-cost-dividends');

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
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);

      const display = document.createElement('span');
      display.className = 'date-br-display';
      display.textContent = input.value ? isoToDateBR(input.value) : 'DD/MM/AAAA';
      wrap.appendChild(display);

      input.classList.add('date-br-native');
      function syncDisplay() {
        display.textContent = input.value ? isoToDateBR(input.value) : 'DD/MM/AAAA';
      }
      input.addEventListener('change', syncDisplay);
      input.addEventListener('input', syncDisplay);
      display.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof input.showPicker === 'function') {
          input.showPicker();
        } else {
          input.focus();
        }
      });
      display.addEventListener('focus', () => input.focus());
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
    const quote = await req(`/api/quote?ticker=${encodeURIComponent(ticker)}`);
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
    renderPortfolio();
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

  async function showDividendHistory(ticker) {
    try {
      const dividends = await req(`/api/dividends?ticker=${encodeURIComponent(ticker)}`);
      document.getElementById('dividend-modal-ticker').textContent = ticker;
      const list = document.getElementById('dividend-list');
      if (!dividends.length) {
        list.innerHTML = '<p class="empty-message">Nenhum dividendo registrado.</p>';
      } else {
        list.innerHTML = `
          <table class="admin-table">
            <thead>
              <tr>
                <th>Data COM</th>
                <th>Data pgto</th>
                <th>Valor (R$)</th>
              </tr>
            </thead>
            <tbody>
              ${dividends.map(d => `
                <tr>
                  <td>${formatDateBR(d.comDate)}</td>
                  <td>${formatDateBR(d.paymentDate)}</td>
                  <td>${d.grossAmount != null ? Number(d.grossAmount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
      document.getElementById('dividend-modal').classList.remove('hidden');
    } catch (err) {
      alert('Erro ao carregar dividendos: ' + err.message);
    }
  }

  document.getElementById('dividend-modal-close').addEventListener('click', () => {
    document.getElementById('dividend-modal').classList.add('hidden');
  });

  document.getElementById('dividend-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      e.target.classList.add('hidden');
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

  function renderPortfolio() {
    const openDropdowns = new Set();
    const openForms = new Set();
    const openFormValues = new Map();
    const openEditForms = new Set();
    const openEditFormValues = new Map();
    const openDetails = new Set();
    portfolioListElement.querySelectorAll('.three-dot-dropdown:not(.hidden)').forEach(el => {
      openDropdowns.add(el.dataset.ticker);
    });
    portfolioListElement.querySelectorAll('.add-launch-form:not(.hidden)').forEach(el => {
      openForms.add(el.dataset.ticker);
      openFormValues.set(el.dataset.ticker, {
        quantity: el.querySelector('.al-quantity').value,
        price: el.querySelector('.al-price').value,
        date: el.querySelector('.al-date').value,
      });
    });
    portfolioListElement.querySelectorAll('.edit-launch-form:not(.hidden)').forEach(el => {
      openEditForms.add(el.dataset.id);
      openEditFormValues.set(el.dataset.id, {
        quantity: el.querySelector('.el-quantity').value,
        price: el.querySelector('.el-price').value,
        date: el.querySelector('.el-date').value,
      });
    });
    portfolioListElement.querySelectorAll('.grid-details:not(.hidden)').forEach(el => {
      openDetails.add(el.dataset.group);
    });

    const portfolio = getPortfolio();
    if (!portfolio.length) {
      portfolioListElement.innerHTML = '<p class="empty-message">Nenhum ativo cadastrado ainda.</p>';
      portfolioSummary.textContent = 'Adicione ativos ao clicar em "Procurar ativo".';
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

    const totalValue = grouped.reduce((sum, group) => {
      return sum + getAssetCurrentPrice(group.ticker) * group.totalQuantity;
    }, 0);
    const totalInvested = grouped.reduce((sum, group) => sum + group.totalCost, 0);
    const totalWithDividends = grouped.reduce((sum, group) => {
      return sum + group.totalCost + (dividendReturns.get(group.ticker) || 0);
    }, 0);

    const gridHeaders = `
      <div class="grid-row grid-header">
        <div class="grid-cell">Ativo</div>
        <div class="grid-cell">Lançamentos</div>
        <div class="grid-cell">Quantidade</div>
        <div class="grid-cell">Preço atual</div>
        <div class="grid-cell">Preço médio</div>
        <div class="grid-cell">Custo total</div>
        <div class="grid-cell">Saldo</div>
        <div class="grid-cell">Dividendos</div>
        <div class="grid-cell">Total c/ Dividendos</div>
        <div class="grid-cell">Resultado</div>
        <div class="grid-cell">Ações</div>
      </div>
    `;

    const gridRows = grouped.map((group) => {
      const asset = assetByTicker.get(group.ticker);
      const currentPrice = getAssetCurrentPrice(group.ticker);
      const value = currentPrice * group.totalQuantity;
      const cost = group.totalCost;
      const totalDiv = dividendReturns.get(group.ticker) || 0;
      const costWithDiv = cost + totalDiv;
      const profitLoss = value - cost;
      const averagePrice = group.totalQuantity ? cost / group.totalQuantity : 0;

      return `
        <div class="grid-row">
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
                  <label>Quantidade <input class="el-quantity" type="number" min="1" step="1" value="${item.quantity}" /></label>
                  <label>Preço pago <input class="el-price" type="number" min="0.01" step="0.01" value="${(item.purchasePrice ?? itemCurrentPrice).toFixed(2)}" /></label>
                  <label>Data <input class="el-date date-br" type="date" value="${itemDate || getTodayInputValue()}" /></label>
                  <button class="btn btn-primary el-save" type="button" data-id="${item.id}" style="width:auto">Salvar</button>
                  <button class="el-cancel" type="button" style="width:auto">Cancelar</button>
                </div>
              </div>
            `;
          }).join('')}
          <div class="add-launch-form" data-ticker="${group.ticker}">
            <div class="add-launch-inner">
              <label>Quantidade <input class="al-quantity" type="number" min="1" step="1" value="1" /></label>
              <label>Preço pago <input class="al-price" type="number" min="0.01" step="0.01" value="${currentPrice.toFixed(2)}" /></label>
              <label>Data <input class="al-date date-br" type="date" value="${getTodayInputValue()}" /></label>
              <button class="btn btn-primary al-save" type="button" data-ticker="${group.ticker}" style="width:auto">Salvar</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    portfolioListElement.innerHTML = gridHeaders + gridRows;

    const percent = totalInvested ? ((totalValue - totalInvested) / totalInvested * 100).toFixed(2) : 0;
    const totalDivSummary = totalWithDividends - totalInvested;
    portfolioSummary.textContent = `Valor total: ${formatCurrency(totalValue)}  |  Investido: ${formatCurrency(totalInvested)}  |  ${percent >= 0 ? '+' : ''}${percent}%  |  Custo + Dividendos: ${formatCurrency(totalWithDividends)}`;
    metricTotalValue.textContent = formatCurrency(totalValue);
    metricInvested.textContent = formatCurrency(totalInvested);
    metricVariation.textContent = `${percent >= 0 ? '+' : ''}${percent}%`;
    metricVariation.className = 'metric-value ' + (percent >= 0 ? 'profit' : 'loss');
    metricCostDividends.textContent = formatCurrency(totalWithDividends);

    openDropdowns.forEach(t => {
      const el = portfolioListElement.querySelector(`.three-dot-dropdown[data-ticker="${t}"]`);
      if (el) el.classList.remove('hidden');
    });
    openForms.forEach(t => {
      const el = portfolioListElement.querySelector(`.add-launch-form[data-ticker="${t}"]`);
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
      const el = portfolioListElement.querySelector(`.edit-launch-form[data-id="${id}"]`);
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
      const el = portfolioListElement.querySelector(`.grid-details[data-group="${t}"]`);
      if (el) el.classList.remove('hidden');
      const btn = portfolioListElement.querySelector(`.group-toggle-button[data-group="${t}"]`);
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
    renderPortfolio();
    refreshPortfolioPrices();
    fetchDividendReturns();
    alert(`${ticker} cadastrado na carteira com ${quantity} unidade(s) a ${formatCurrency(purchasePrice)}.`);
  }

  async function removeAssetFromPortfolio(id) {
    const numericId = Number(id);
    if (currentUser) {
      try { await removePortfolioItemFromServer(numericId, currentUser.id); } catch (e) { console.warn(e.message); }
    }
    const portfolio = getPortfolio().filter((item) => item.id !== numericId);
    savePortfolio(portfolio);
    renderPortfolio();
    fetchDividendReturns();
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
      renderPortfolio();
      refreshPortfolioPrices();
      fetchDividendReturns();
    } catch (err) { alert(err.message); }
  }

  fetchPortfolioFromServer(currentUser.id)
    .then(p => { savePortfolio(p); renderPortfolio(); refreshPortfolioPrices(); fetchDividendReturns(); })
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

  // Portfolio list click delegation
  portfolioListElement.addEventListener('click', async (event) => {
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
      const details = portfolioListElement.querySelector(`.grid-details[data-group="${groupTicker}"]`);
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
      const dropdown = portfolioListElement.querySelector(`.three-dot-dropdown[data-ticker="${ticker}"]`);
      if (dropdown) {
        dropdown.classList.toggle('hidden');
      }
      return;
    }

    const addOption = event.target.closest('.add-launch-option');
    if (addOption) {
      const ticker = addOption.dataset.ticker;
      document.querySelectorAll('.three-dot-dropdown').forEach(d => d.classList.add('hidden'));
      const form = portfolioListElement.querySelector(`.add-launch-form[data-ticker="${ticker}"]`);
      if (form) {
        form.classList.toggle('hidden');
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
      const form = portfolioListElement.querySelector(`.edit-launch-form[data-id="${id}"]`);
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
        if (!asset) {
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
