(function () {
  function getUser() {
    const stored = localStorage.getItem('site-login-authenticated');
    return stored ? JSON.parse(stored) : null;
  }
  function clearUser() {
    localStorage.removeItem('site-login-authenticated');
  }
  async function req(url, method, body) {
    const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
    return data;
  }

  const currentUser = getUser();
  if (!currentUser) {
    window.location.href = '/';
    return;
  }

  document.getElementById('display-user').textContent = currentUser.fullName || currentUser.username;

  const isAdmin = currentUser.username === 'admin';
  if (isAdmin) {
    document.querySelectorAll('.admin-only').forEach(function (el) { el.classList.remove('hidden'); });
  }

  document.querySelectorAll('.sidebar-link').forEach(function (el) {
    if (el.dataset.page === 'lancamentos') el.classList.add('active');
  });

  var sidebar = document.getElementById('sidebar');
  var toggleBtn = document.getElementById('sidebar-toggle');
  if (sidebar && toggleBtn) {
    if (localStorage.getItem('sidebar-collapsed') === 'true') {
      sidebar.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
    }
    toggleBtn.addEventListener('click', function () {
      var collapsed = sidebar.classList.toggle('collapsed');
      document.body.classList.toggle('sidebar-collapsed', collapsed);
      localStorage.setItem('sidebar-collapsed', String(collapsed));
    });
  }

  document.getElementById('logout-button').addEventListener('click', function () {
    clearUser();
    window.location.href = '/';
  });

  var tbody = document.getElementById('lancamentos-body');
  var filterInput = document.getElementById('lancamentos-filter');
  var countEl = document.getElementById('lancamentos-count');

  var allItems = [];

  var typeLabels = { compra: 'Compra', venda: 'Venda', bonificacao: 'Bonif', desdobro: 'Desdobro', grupamento: 'Grupamento', incorporacao: 'Incorp', fracao: 'Fração', leilao: 'Leilão' };

  function render(items) {
    var term = (filterInput.value || '').trim().toUpperCase();
    var filtered = term ? items.filter(function (a) { return a.ticker.toUpperCase().includes(term); }) : items;
    countEl.textContent = filtered.length + ' lançamento(s)';
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var a = filtered[i];
      var dateStr = a.purchaseDate ? a.purchaseDate.split('T')[0] : '—';
      var color = a.quantity < 0 ? '#e74c3c' : '#27ae60';
      html += '<tr><td>' + dateStr + '</td><td>' + a.ticker + '</td><td>' + (typeLabels[a.movementType] || a.movementType) + '</td><td style="color:' + color + ';font-weight:600">' + a.quantity + '</td><td>R$ ' + Number(a.purchasePrice || 0).toFixed(2) + '</td><td>' + (a.institution || '—') + '</td></tr>';
    }
    tbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#999">Nenhum lançamento encontrado.</td></tr>';
  }

  filterInput.addEventListener('input', function () { if (allItems.length) render(allItems); });

  if (tbody) {
    var table = tbody.closest('table');
    if (table) {
      table.querySelectorAll('th[data-col]').forEach(function (th) {
        th.addEventListener('click', function () {
          var col = th.dataset.col;
          var sorted = allItems.slice().sort(function (a, b) {
            var va = a[col], vb = b[col];
            if (va == null) va = '';
            if (vb == null) vb = '';
            if (typeof va === 'number') return va - vb;
            return String(va).localeCompare(String(vb));
          });
          render(sorted);
        });
      });
    }
  }

  req('/api/portfolio?userId=' + encodeURIComponent(currentUser.id)).then(function (data) {
    allItems = data.map(function (item) {
      return {
        id: item.id,
        ticker: item.ticker,
        quantity: item.quantity,
        purchasePrice: item.purchasePrice || item.purchaseprice || 0,
        purchaseDate: item.purchaseDate || item.purchasedAt || item.purchasedat || item.purchasdate,
        movementType: item.movementType || 'compra',
        institution: item.institution || ''
      };
    });
    render(allItems);
  }).catch(function (e) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#e74c3c">Erro ao carregar: ' + e.message + '</td></tr>';
  });
})();