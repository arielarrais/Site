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

  const currentUser = getUser();
  if (!currentUser) {
    window.location.href = '/';
    return;
  }

  const isAdmin = currentUser.username === 'admin';
  if (isAdmin) {
    document.querySelectorAll('.admin-only').forEach(function (el) { el.classList.remove('hidden'); });
  }

  document.querySelectorAll('.sidebar-link').forEach(function (el) {
    if (el.dataset.page === 'dividendos') el.classList.add('active');
  });

  var sidebar = document.getElementById('sidebar');
  var toggleBtn = document.getElementById('sidebar-toggle');
  if (sidebar && toggleBtn) {
    if (localStorage.getItem('sidebar-collapsed') === 'true' && window.innerWidth >= 900) {
      sidebar.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
    }
    toggleBtn.addEventListener('click', function () {
      if (window.innerWidth < 900) return;
      var collapsed = sidebar.classList.toggle('collapsed');
      document.body.classList.toggle('sidebar-collapsed', collapsed);
      localStorage.setItem('sidebar-collapsed', String(collapsed));
    });
  }

  var mobileMenuBtn = document.getElementById('mobile-menu-btn');
  if (sidebar && mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      sidebar.classList.toggle('mobile-open');
    });
    document.addEventListener('click', function (e) {
      if (sidebar.classList.contains('mobile-open') && !sidebar.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        sidebar.classList.remove('mobile-open');
      }
    });
  }

  document.getElementById('logout-button').addEventListener('click', function () {
    clearUser();
    window.location.href = '/';
  });

  var tbody = document.getElementById('dividendos-body');
  var filterInput = document.getElementById('dividendos-filter');
  var countEl = document.getElementById('dividendos-count');

  var allMonthly = [];

  function monthLabel(ym) {
    var parts = ym.split('-');
    var months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return months[parseInt(parts[1]) - 1] + ' ' + parts[0];
  }

  function render(monthly) {
    var term = (filterInput.value || '').trim().toUpperCase();
    var filtered = term
      ? monthly.filter(function (m) { return (m.ticker || '').toUpperCase().includes(term); })
      : monthly;

    var totalGeral = 0;
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var m = filtered[i];
      totalGeral += m.total;
      html += '<tr>' +
        '<td><strong>' + (m.ticker || '—') + '</strong></td>' +
        '<td>' + monthLabel(m.month) + '</td>' +
        '<td style="color:#27ae60;font-weight:600">R$ ' + m.total.toFixed(2) + '</td>' +
        '<td>' + m.count + ' registro(s)</td>' +
        '</tr>';
    }

    if (html) {
      html += '<tr style="font-weight:700;background:#f0faf0">' +
        '<td>Total</td><td></td>' +
        '<td style="color:#1e7e34">R$ ' + totalGeral.toFixed(2) + '</td><td></td>' +
        '</tr>';
    }

    countEl.textContent = filtered.length + ' ativo(s) com dividendos';
    tbody.innerHTML = html || '<tr><td colspan="4" style="text-align:center;padding:24px;color:#999">Nenhum dividendo encontrado.</td></tr>';
  }

  filterInput.addEventListener('input', function () { if (allMonthly.length) render(allMonthly); });

  req('/api/dividends/monthly?userId=' + encodeURIComponent(currentUser.id)).then(function (data) {
    allMonthly = data;
    render(allMonthly);
  }).catch(function (e) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:#e74c3c">Erro ao carregar: ' + e.message + '</td></tr>';
  });
})();
