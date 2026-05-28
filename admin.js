const API = '/api';
const authKey = 'site-login-authenticated';

function getUser() {
  const stored = localStorage.getItem(authKey);
  return stored ? JSON.parse(stored) : null;
}

function clearUser() {
  localStorage.removeItem(authKey);
}

function formatDateBR(isoDate) {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function dateToISO(ddmmyyyy) {
  const parts = ddmmyyyy.split('/');
  if (parts.length !== 3) return ddmmyyyy;
  const [d, m, y] = parts;
  if (d.length !== 2 || m.length !== 2 || y.length !== 4) return ddmmyyyy;
  return `${y}-${m}-${d}`;
}

function formatCurrency(value) {
  if (value == null) return '—';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function req(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
  return data;
}

let currentUser = getUser();
if (!currentUser) {
  window.location.href = '/';
}

document.getElementById('logout-button-admin').addEventListener('click', () => {
  clearUser();
  window.location.href = '/';
});

document.getElementById('dashboard-button').addEventListener('click', () => {
  window.location.href = '/dashboard';
});

let selectedAssetId = null;

const isAdmin = currentUser && currentUser.username === 'admin';

async function loadAssets() {
  try {
    const assets = await req('/api/admin/assets');
    const acoes = assets.filter(a => a.assettype === 'acao');
    const fiis = assets.filter(a => a.assettype === 'fii');
    renderTable('acoes-tbody', acoes);
    renderTable('fiis-tbody', fiis);
  } catch (err) {
    alert('Erro ao carregar ativos: ' + err.message);
  }
}

function renderTable(tbodyId, assets) {
  const tbody = document.getElementById(tbodyId);
  if (!assets.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-message">Nenhum ativo encontrado.</td></tr>';
    return;
  }
  tbody.innerHTML = assets.map(a => {
    const actions = isAdmin
      ? `
        <button class="btn-register-dividend" data-id="${a.id}" data-ticker="${a.ticker}" data-name="${a.name}">
          + Dividendo
        </button>
        <button class="btn-sync-brapi" data-ticker="${a.ticker}" title="Sincronizar com Brapi">⟳</button>`
      : '';
    return `
    <tr>
      <td><strong><a href="#" class="ticker-link" data-ticker="${a.ticker}">${a.ticker}</a></strong></td>
      <td>${a.name}</td>
      <td>${formatDateBR(a.lastcomdate)}</td>
      <td>${formatDateBR(a.lastdividenddate)}</td>
      <td>${formatCurrency(a.lastdividendvalue)}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
}

document.getElementById('acoes-tbody').addEventListener('click', onTableClick);
document.getElementById('fiis-tbody').addEventListener('click', onTableClick);

function onTableClick(e) {
  const tickerLink = e.target.closest('.ticker-link');
  if (tickerLink) {
    e.preventDefault();
    showDividendHistory(tickerLink.dataset.ticker);
    return;
  }
  const btn = e.target.closest('.btn-register-dividend');
  if (btn) {
    selectedAssetId = Number(btn.dataset.id);
    document.getElementById('modal-asset-info').textContent = `${btn.dataset.ticker} — ${btn.dataset.name}`;
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('div-com-date').value = today;
    document.getElementById('div-payment-date').value = today;
    document.getElementById('div-gross-amount').value = '';
    document.getElementById('dividend-modal').classList.remove('hidden');
    return;
  }
  const syncBtn = e.target.closest('.btn-sync-brapi');
  if (syncBtn) {
    const ticker = syncBtn.dataset.ticker;
    syncBtn.textContent = '...';
    req(`/api/admin/sync-brapi?ticker=${encodeURIComponent(ticker)}`)
      .then(() => { loadAssets(); })
      .catch(err => { alert('Erro: ' + err.message); loadAssets(); });
  }
}

document.getElementById('modal-cancel').addEventListener('click', () => {
  document.getElementById('dividend-modal').classList.add('hidden');
  selectedAssetId = null;
});

document.getElementById('dividend-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedAssetId) return;
  const payload = {
    assetId: selectedAssetId,
    comDate: document.getElementById('div-com-date').value,
    paymentDate: document.getElementById('div-payment-date').value,
    grossAmount: Number(document.getElementById('div-gross-amount').value),
  };
  try {
    await req('/api/admin/dividends', 'POST', payload);
    alert('Dividendo cadastrado com sucesso!');
    document.getElementById('dividend-modal').classList.add('hidden');
    selectedAssetId = null;
    loadAssets();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
});

if (!isAdmin) {
  document.getElementById('sync-all-button').classList.add('hidden');
}

document.getElementById('sync-all-button').addEventListener('click', async () => {
  const btn = document.getElementById('sync-all-button');
  btn.textContent = 'Sincronizando...';
  try {
    const assets = await req('/api/b3-assets');
    for (const a of assets) {
      try {
        await req(`/api/admin/sync-brapi?ticker=${encodeURIComponent(a.ticker)}`);
      } catch (e) { console.warn(`${a.ticker}: ${e.message}`); }
    }
    alert('Sincronização concluída!');
    loadAssets();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
  btn.textContent = 'Sync Brapi';
});

async function showDividendHistory(ticker) {
  try {
    const dividends = await req(`/api/dividends?ticker=${encodeURIComponent(ticker)}`);
    document.getElementById('history-modal-ticker').textContent = ticker;
    const list = document.getElementById('history-dividend-list');
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
    document.getElementById('history-modal').classList.remove('hidden');
  } catch (err) {
    alert('Erro ao carregar dividendos: ' + err.message);
  }
}

document.getElementById('history-modal-close').addEventListener('click', () => {
  document.getElementById('history-modal').classList.add('hidden');
});

document.getElementById('history-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    e.target.classList.add('hidden');
  }
});

document.querySelectorAll('.toggle-section-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    const body = document.getElementById(`${target}-body`);
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    body.classList.toggle('hidden');
    btn.setAttribute('aria-expanded', String(!expanded));
    btn.textContent = expanded ? '+' : '−';
  });
});

loadAssets();
