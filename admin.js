const API = '/api';
const authKey = 'site-login-authenticated';
let dividendChartInstance = null;

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
  const user = getUser();
  if (user && user.token) {
    opts.headers['Authorization'] = 'Bearer ' + user.token;
  }
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

document.querySelectorAll('.sidebar-link').forEach(el => {
  if (el.dataset.page === 'ativos') el.classList.add('active');
});

const sidebar = document.getElementById('sidebar');
const toggleBtn = document.getElementById('sidebar-toggle');
if (sidebar && toggleBtn) {
  if (localStorage.getItem('sidebar-collapsed') === 'true' && window.innerWidth >= 900) {
    sidebar.classList.add('collapsed');
    document.body.classList.add('sidebar-collapsed');
  }
  toggleBtn.addEventListener('click', () => {
    if (window.innerWidth < 900) return;
    const collapsed = sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  });
}

const mobileMenuBtn = document.getElementById('mobile-menu-btn');
if (sidebar && mobileMenuBtn) {
  mobileMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.toggle('mobile-open');
  });
  document.addEventListener('click', (e) => {
    if (sidebar.classList.contains('mobile-open') && !sidebar.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
      sidebar.classList.remove('mobile-open');
    }
  });
}

let selectedAssetId = null;

const isAdmin = currentUser && currentUser.username === 'admin';

const sortState = { acoes: { key: null, dir: 'asc' }, fiis: { key: null, dir: 'asc' } };
let allAssets = [];

async function loadAssets() {
  try {
    allAssets = await req('/api/admin/assets');
    applyFilter();
  } catch (err) {
    alert('Erro ao carregar ativos: ' + err.message);
  }
}

function applyFilter() {
  const q = document.getElementById('dividend-search').value.trim().toLowerCase();
  const filtered = q ? allAssets.filter(a =>
    (a.ticker || '').toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q)
  ) : allAssets;
  const acoes = filterAndSort(filtered.filter(a => a.assettype === 'acao'), 'acoes');
  const fiis = filterAndSort(filtered.filter(a => a.assettype === 'fii'), 'fiis');
  renderTable('acoes-tbody', acoes);
  renderTable('fiis-tbody', fiis);
  updateSortIndicators('acoes-table');
  updateSortIndicators('fiis-table');
  document.getElementById('acoes-count').textContent = acoes.length + ' tickers';
  document.getElementById('fiis-count').textContent = fiis.length + ' tickers';
}

function filterAndSort(items, tableKey) {
  const st = sortState[tableKey];
  if (!st.key) return items;
  const sorted = [...items].sort((a, b) => {
    let va = a[st.key], vb = b[st.key];
    if (st.key === 'lastdividendvalue') {
      va = va == null ? -Infinity : Number(va);
      vb = vb == null ? -Infinity : Number(vb);
    } else {
      va = (va || '').toString().toLowerCase();
      vb = (vb || '').toString().toLowerCase();
    }
    if (va < vb) return st.dir === 'asc' ? -1 : 1;
    if (va > vb) return st.dir === 'asc' ? 1 : -1;
    return 0;
  });
  return sorted;
}

function updateSortIndicators(tableId) {
  document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach(th => {
    const arrows = th.querySelector('.sort-arrows');
    const key = th.dataset.sort;
    const tableKey = tableId === 'acoes-table' ? 'acoes' : 'fiis';
    const st = sortState[tableKey];
    arrows.textContent = key === st.key ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';
  });
}

document.querySelectorAll('.sortable thead th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const table = th.closest('table');
    const tableId = table.id;
    const tableKey = tableId === 'acoes-table' ? 'acoes' : 'fiis';
    const st = sortState[tableKey];
    const key = th.dataset.sort;
    if (st.key === key) {
      st.dir = st.dir === 'asc' ? 'desc' : 'asc';
    } else {
      st.key = key;
      st.dir = 'asc';
    }
    loadAssets();
  });
});

document.getElementById('dividend-search-btn').addEventListener('click', applyFilter);
document.getElementById('dividend-search').addEventListener('keyup', e => {
  if (e.key === 'Enter') applyFilter();
});

function renderTable(tbodyId, assets) {
  const isFii = tbodyId === 'fiis-tbody';
  const tbody = document.getElementById(tbodyId);
  const colspan = isFii ? 7 : 6;
  if (!assets.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty-message">Nenhum ativo encontrado.</td></tr>`;
    return;
  }
  tbody.innerHTML = assets.map(a => {
    const actions = isAdmin
      ? `
        <button class="btn-fetch-dividends" data-ticker="${a.ticker}" title="Buscar dividendos na web">🌐</button>
        <button class="btn-register-dividend" data-id="${a.id}" data-ticker="${a.ticker}" data-name="${a.name}">
          + Dividendo
        </button>
        `
      : '';
    const fiitype = a.fiitype ? a.fiitype.charAt(0).toUpperCase() + a.fiitype.slice(1) : '—';
    return `
    <tr>
      <td><strong><a href="#" class="ticker-link" data-ticker="${a.ticker}">${a.ticker}</a></strong></td>
      <td>${a.name || ''}</td>
      ${isFii ? `<td>${fiitype}</td>` : ''}
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
  const fetchDivBtn = e.target.closest('.btn-fetch-dividends');
  if (fetchDivBtn) {
    const ticker = fetchDivBtn.dataset.ticker;
    fetchDivBtn.textContent = '...';
    req('/api/admin/fetch-dividends', 'POST', { ticker })
      .then(r => {
        alert(`${r.inserted} novos, ${r.updated} atualizados, ${r.skipped} ignorados (fonte: ${r.source}).`);
        fetchDivBtn.textContent = '🌐';
        loadAssets();
      })
      .catch(err => { alert('Erro: ' + err.message); fetchDivBtn.textContent = '🌐'; });
    return;
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
    type: document.getElementById('div-type').value,
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

if (isAdmin) {
  document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
}

async function showDividendHistory(ticker) {
  try {
    const dividends = await req(`/api/dividends?ticker=${encodeURIComponent(ticker)}`);
    document.getElementById('history-modal-ticker').textContent = ticker;
    const list = document.getElementById('history-dividend-list');

    function renderHistory(sorted) {
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

      document.querySelectorAll('#history-dividend-list .sortable thead th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort;
          const currentDir = th.classList.contains('sort-asc') ? 'asc' : th.classList.contains('sort-desc') ? 'desc' : null;
          document.querySelectorAll('#history-dividend-list .sortable thead th[data-sort]').forEach(h => {
            h.classList.remove('sort-asc', 'sort-desc');
            const arrows = h.querySelector('.sort-arrows');
            arrows.textContent = ' ⇅';
          });
          const newDir = currentDir === 'asc' ? 'desc' : 'asc';
          th.classList.add(newDir === 'asc' ? 'sort-asc' : 'sort-desc');
          const arrows = th.querySelector('.sort-arrows');
          arrows.textContent = newDir === 'asc' ? ' ▲' : ' ▼';

          const sorted = [...dividends].sort((a, b) => {
            let va = a[key], vb = b[key];
            if (key === 'grossAmount') {
              va = va == null ? -Infinity : Number(va);
              vb = vb == null ? -Infinity : Number(vb);
            } else {
              va = (va || '').toString().toLowerCase();
              vb = (vb || '').toString().toLowerCase();
            }
            if (va < vb) return newDir === 'asc' ? -1 : 1;
            if (va > vb) return newDir === 'asc' ? 1 : -1;
            return 0;
          });
          renderHistory(sorted);
        });
      });
    }

    if (dividendChartInstance) {
      dividendChartInstance.destroy();
      dividendChartInstance = null;
    }

    if (!dividends.length) {
      list.innerHTML = '<p class="empty-message">Nenhum dividendo registrado.</p>';
      document.getElementById('dividend-chart').classList.add('hidden');
    } else {
      renderHistory(dividends);
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
    document.getElementById('history-modal').classList.remove('hidden');
  } catch (err) {
    alert('Erro ao carregar dividendos: ' + err.message);
  }
}

document.getElementById('history-modal-close').addEventListener('click', () => {
  document.getElementById('history-modal').classList.add('hidden');
  if (dividendChartInstance) {
    dividendChartInstance.destroy();
    dividendChartInstance = null;
    document.getElementById('dividend-chart').classList.add('hidden');
  }
});

document.getElementById('history-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    e.target.classList.add('hidden');
    if (dividendChartInstance) {
      dividendChartInstance.destroy();
      dividendChartInstance = null;
      document.getElementById('dividend-chart').classList.add('hidden');
    }
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
