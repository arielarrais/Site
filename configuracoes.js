const authKey = 'site-login-authenticated';

function getUser() {
  const stored = localStorage.getItem(authKey);
  return stored ? JSON.parse(stored) : null;
}

function clearUser() {
  localStorage.removeItem(authKey);
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
}

document.querySelectorAll('.sidebar-link').forEach(el => {
  if (el.dataset.page === 'configuracoes') el.classList.add('active');
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

document.getElementById('logout-button').addEventListener('click', () => {
  clearUser();
  window.location.href = '/';
});

// Load saved settings
const savedSource = localStorage.getItem('price-source') || 'brapi';
document.querySelectorAll('input[name="price-source"]').forEach(r => {
  r.checked = r.value === savedSource;
});

const savedUrl = localStorage.getItem('sheet-url') || '';
document.getElementById('sheet-url').value = savedUrl;

function toggleSheetConfig() {
  const selected = document.querySelector('input[name="price-source"]:checked').value;
  document.getElementById('sheet-config').classList.toggle('hidden', selected !== 'sheets');
}

document.querySelectorAll('input[name="price-source"]').forEach(r => {
  r.addEventListener('change', toggleSheetConfig);
});
toggleSheetConfig();

// Test sheet connection
document.getElementById('test-sheet').addEventListener('click', async () => {
  const url = document.getElementById('sheet-url').value.trim();
  const status = document.getElementById('sheet-status');
  if (!url) {
    status.textContent = 'Informe a URL da planilha.';
    status.style.color = '#e74c3c';
    return;
  }
  const exportUrl = url.includes('/export?format=csv')
    ? url
    : url.replace(/\/edit.*$/, '') + '/export?format=csv';
  status.textContent = 'Testando...';
  status.style.color = '#888';
  try {
    const result = await req(`/api/quotes/sheets?url=${encodeURIComponent(exportUrl)}`);
    const count = Object.keys(result).length;
    status.textContent = `Conexão OK! ${count} ativos encontrados.`;
    status.style.color = '#27ae60';
  } catch (err) {
    status.textContent = 'Erro: ' + err.message;
    status.style.color = '#e74c3c';
  }
});

// Save settings
document.getElementById('save-settings').addEventListener('click', () => {
  const source = document.querySelector('input[name="price-source"]:checked').value;
  const sheetUrl = document.getElementById('sheet-url').value.trim();
  localStorage.setItem('price-source', source);
  if (source === 'sheets') {
    const exportUrl = sheetUrl.includes('/export?format=csv')
      ? sheetUrl
      : sheetUrl.replace(/\/edit.*$/, '') + '/export?format=csv';
    localStorage.setItem('sheet-url', exportUrl);
  }
  const status = document.getElementById('save-status');
  status.textContent = 'Configurações salvas com sucesso!';
  status.style.color = '#27ae60';
  setTimeout(() => { status.textContent = ''; }, 3000);
});
