(async function () {
  function getUser() {
    const stored = localStorage.getItem('site-login-authenticated');
    if (!stored) return null;
    try {
      const user = JSON.parse(stored);
      if (!user || !user.token) { localStorage.removeItem('site-login-authenticated'); return null; }
      const payload = JSON.parse(atob(user.token.split('.')[1]));
      if (payload.exp * 1000 < Date.now()) { localStorage.removeItem('site-login-authenticated'); return null; }
      return user;
    } catch { localStorage.removeItem('site-login-authenticated'); return null; }
  }
  function clearUser() {
    localStorage.removeItem('site-login-authenticated');
  }
  async function validateToken() {
      const user = getUser();
      if (!user) { window.location.href = '/'; return null; }
    try {
      const res = await fetch('/api/auth/validate', { headers: { 'Authorization': 'Bearer ' + user.token } });
      if (!res.ok) { clearUser(); window.location.href = '/'; return null; }
      return user;
    } catch { clearUser(); window.location.href = '/'; return null; }
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

  const currentUser = await validateToken();
  if (!currentUser) return;

  const isAdmin = currentUser.username === 'admin' || currentUser.username === 'admin@admin';
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

  var MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  var calHead = document.getElementById('cal-head');
  var calBody = document.getElementById('cal-body');
  var calFoot = document.getElementById('cal-foot');
  var calAno = document.getElementById('cal-ano');
  var calModo = document.getElementById('cal-modo');
  var calLegenda = document.getElementById('cal-legenda');

  var calData = null;
  var calYear = new Date().getFullYear();
  var calModoAtual = 'cota';

  function fmtNumber(v, min, max) {
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
  }

  function fmtValor(v) {
    if (v >= 1) return fmtNumber(v, 2, 2);
    return String(Number(v).toFixed(4)).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
  }

  function renderCalendar() {
    if (!calData) return;

    var head = '<th class="cal-ticker-col">Ativo</th>';
    for (var m = 0; m < 12; m++) head += '<th>' + MESES[m] + '</th>';
    head += '<th>Total ' + calYear + '</th>';
    calHead.innerHTML = head;

    var totals = new Array(12).fill(0);
    var html = '';
    for (var i = 0; i < calData.rows.length; i++) {
      var row = calData.rows[i];
      var label = '<strong>' + row.ticker + '</strong>';
      if (row.isFii) label += '<span class="cal-tag">FII</span>';
      html += '<tr><td class="cal-ticker-col">' + label +
        '<span class="cal-ticker-name">' + (row.name || '') + '</span></td>';
      for (var m2 = 0; m2 < row.months.length; m2++) {
        var cell = row.months[m2];
        var principal = calModoAtual === 'cota' ? cell.perShare : cell.total;
        var secundario = calModoAtual === 'cota' ? cell.total : cell.perShare;
        var fmtSec = calModoAtual === 'cota' ? fmtNumber(secundario, 2, 2) : fmtValor(secundario);
        var titulo = cell.payments + ' provento(s) em ' + MESES[m2] + '/' + calYear +
          ' | por cota: R$ ' + fmtValor(cell.perShare) +
          ' | total recebido: R$ ' + fmtNumber(cell.total, 2, 2);
        html += '<td class="cal-cell' + (principal > 0 ? '' : ' zero') + '" title="' + titulo + '">' +
          fmtValor(principal) +
          '<span class="cal-sub">' + (secundario > 0 ? fmtSec : '–') + '</span></td>';
        totals[m2] += principal;
      }
      var anoValor = calModoAtual === 'cota' ? row.perShareYear : row.totalYear;
      html += '<td class="cal-total-year">' + fmtValor(anoValor) + '</td></tr>';
    }

    if (!calData.rows.length) {
      html = '<tr><td colspan="14" style="text-align:center;padding:24px;color:#999">Nenhum ativo na carteira.</td></tr>';
      calBody.innerHTML = html;
      calFoot.innerHTML = '';
      return;
    }

    var totalAno = calModoAtual === 'cota'
      ? calData.rows.reduce(function (s, r) { return s + r.perShareYear; }, 0)
      : calData.rows.reduce(function (s, r) { return s + r.totalYear; }, 0);

    var foot = '<tr class="cal-foot-row"><td class="cal-ticker-col">Total</td>';
    for (var m3 = 0; m3 < 12; m3++) foot += '<td>' + fmtValor(totals[m3]) + '</td>';
    foot += '<td class="cal-total-year">' + fmtValor(totalAno) + '</td></tr>';

    calBody.innerHTML = html;
    calFoot.innerHTML = foot;

    calLegenda.textContent = calModoAtual === 'cota'
      ? 'Valor por cota pago no mês (R$) e, em cinza abaixo, o total recebido na carteira.'
      : 'Total recebido na carteira no mês (R$) e, em cinza abaixo, o valor por cota.';
  }

  function loadCalendar(year) {
    calYear = year;
    calBody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:24px;color:#999">Carregando...</td></tr>';
    calFoot.innerHTML = '';
    req('/api/dividends/calendar?userId=' + encodeURIComponent(currentUser.id) + '&year=' + year)
      .then(function (data) {
        calData = data;
        calData.rows.forEach(function (r) { r.months.sort(function (a, b) { return a.month - b.month; }); });
        calAno.innerHTML = '';
        (data.availableYears || []).forEach(function (y) {
          var opt = document.createElement('option');
          opt.value = y;
          opt.textContent = y;
          if (y === calYear) opt.selected = true;
          calAno.appendChild(opt);
        });
        renderCalendar();
      })
      .catch(function (e) {
        calBody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:24px;color:#e74c3c">Erro ao carregar: ' + e.message + '</td></tr>';
      });
  }

  calAno.addEventListener('change', function () { loadCalendar(parseInt(calAno.value, 10)); });

  calModo.addEventListener('click', function (e) {
    var btn = e.target.closest('.cal-modo-btn');
    if (!btn) return;
    calModoAtual = btn.dataset.modo;
    calModo.querySelectorAll('.cal-modo-btn').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    renderCalendar();
  });

  loadCalendar(calYear);
})();
