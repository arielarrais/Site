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
}

document.querySelectorAll('.sidebar-link').forEach(el => {
  if (el.dataset.page === 'configuracoes') el.classList.add('active');
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

document.getElementById('logout-button').addEventListener('click', () => {
  clearUser();
  window.location.href = '/';
});

// Load saved settings
const savedSource = localStorage.getItem('price-source') || 'sheets';
document.querySelectorAll('input[name="price-source"]').forEach(r => {
  r.checked = r.value === savedSource;
});

// Save settings
document.getElementById('save-settings').addEventListener('click', () => {
  const source = document.querySelector('input[name="price-source"]:checked').value;
  localStorage.setItem('price-source', source);
  const status = document.getElementById('save-status');
  status.textContent = 'Configurações salvas com sucesso!';
  status.style.color = '#27ae60';
  setTimeout(() => { status.textContent = ''; }, 3000);
});

// === B3 XLSX Import ===
const b3xlsxFileInput = document.getElementById('b3xlsx-file-input');
const b3xlsxDropzone = document.getElementById('b3xlsx-dropzone');
const b3xlsxPreview = document.getElementById('b3xlsx-preview');
const b3xlsxPreviewBody = document.getElementById('b3xlsx-preview-body');
const b3xlsxPreviewCount = document.getElementById('b3xlsx-preview-count');
const b3xlsxStatus = document.getElementById('b3xlsx-status');
const b3xlsxImportBtn = document.getElementById('b3xlsx-import-btn');
let b3xlsxAssets = [];
let b3xlsxProcessing = false;

b3xlsxDropzone.addEventListener('click', () => b3xlsxFileInput.click());

b3xlsxDropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  b3xlsxDropzone.style.borderColor = '#1a73e8';
  b3xlsxDropzone.style.background = '#e8f0fe';
});

b3xlsxDropzone.addEventListener('dragleave', () => {
  b3xlsxDropzone.style.borderColor = '#ccc';
  b3xlsxDropzone.style.background = '#fafafa';
});

b3xlsxDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  b3xlsxDropzone.style.borderColor = '#ccc';
  b3xlsxDropzone.style.background = '#fafafa';
  if (e.dataTransfer.files.length > 0) processB3Xlsx(e.dataTransfer.files[0]);
});

b3xlsxFileInput.addEventListener('change', () => {
  if (b3xlsxFileInput.files.length > 0) processB3Xlsx(b3xlsxFileInput.files[0]);
});

async function processB3Xlsx(file) {
  if (b3xlsxProcessing) return;
  if (!file.name.endsWith('.xlsx')) {
    b3xlsxStatus.textContent = 'Selecione um arquivo .xlsx.';
    b3xlsxStatus.style.color = '#e74c3c';
    return;
  }

  b3xlsxProcessing = true;
  b3xlsxStatus.textContent = 'Processando arquivo...';
  b3xlsxStatus.style.color = '#666';
  b3xlsxPreview.style.display = 'none';
  b3xlsxImportBtn.style.display = 'none';

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
      reader.readAsDataURL(file);
    });

    const data = await req('/api/portfolio/parse-b3-xlsx', 'POST', {
      userId: currentUser.id,
      fileBase64: base64
    });

    if (data.error) {
      b3xlsxStatus.textContent = data.error;
      b3xlsxStatus.style.color = '#e74c3c';
      b3xlsxProcessing = false;
      return;
    }

    b3xlsxAssets = data.assets || [];
    if (b3xlsxAssets.length === 0) {
      b3xlsxStatus.textContent = 'Nenhum movimento encontrado.';
      b3xlsxStatus.style.color = '#e67e22';
      b3xlsxProcessing = false;
      return;
    }

    let html = '';
    let buys = 0, sells = 0;
    b3xlsxAssets.forEach(a => {
      const typeLabel = a.movementType === 'compra' ? 'Compra' : 'Venda';
      const qtyDisplay = a.quantity;
      if (a.movementType === 'compra') buys++; else sells++;
      html += `<tr><td><strong>${a.ticker}</strong></td><td>${qtyDisplay}</td><td>R$ ${Number(a.purchasePrice).toFixed(2)}</td><td>${a.institution || '—'}</td><td>${typeLabel}</td><td>${a.purchaseDate}</td></tr>`;
    });
    b3xlsxPreviewBody.innerHTML = html;
    b3xlsxPreviewCount.textContent = `${b3xlsxAssets.length} movimento(s): ${buys} compra(s), ${sells} venda(s).`;
    b3xlsxPreview.style.display = '';
    b3xlsxImportBtn.style.display = '';
    b3xlsxStatus.textContent = 'Confira os dados e clique em importar.';
    b3xlsxStatus.style.color = '#27ae60';
  } catch (err) {
    b3xlsxStatus.textContent = 'Erro: ' + (err.message || 'falha na conexão');
    b3xlsxStatus.style.color = '#e74c3c';
  }
  b3xlsxProcessing = false;
}

b3xlsxImportBtn.addEventListener('click', async () => {
  b3xlsxImportBtn.disabled = true;
  b3xlsxImportBtn.textContent = 'Importando...';
  try {
    let imported = 0;
    for (const asset of b3xlsxAssets) {
      try {
        await req('/api/portfolio', 'POST', {
          userId: currentUser.id,
          ticker: asset.ticker,
          quantity: asset.quantity,
          purchasePrice: asset.purchasePrice,
          purchaseDate: asset.purchaseDate,
          institution: asset.institution || '',
          movementType: asset.movementType || 'compra'
        });
        imported++;
      } catch (e) {
        console.warn('Falha ao importar ' + asset.ticker + ':', e.message);
      }
    }
    const total = b3xlsxAssets.length;
    b3xlsxStatus.textContent = '';
    b3xlsxPreview.style.display = 'none';
    b3xlsxImportBtn.style.display = 'none';
    b3xlsxAssets = [];
    alert(`Importação concluída: ${imported} de ${total} movimentos importados.`);
  } catch (err) {
    alert('Erro ao importar: ' + (err.message || 'desconhecido'));
  }
  b3xlsxImportBtn.disabled = false;
  b3xlsxImportBtn.textContent = 'Importar para carteira';
});

// === Clear Portfolio ===
document.getElementById('clear-portfolio-btn').addEventListener('click', async () => {
  if (!confirm('Tem certeza que deseja limpar TODA a sua carteira? Esta ação não pode ser desfeita.')) return;
  if (!confirm('ÚLTIMA CONFIRMAÇÃO: Todos os ativos serão removidos permanentemente. Deseja continuar?')) return;

  const status = document.getElementById('clear-portfolio-status');
  const btn = document.getElementById('clear-portfolio-btn');
  btn.disabled = true;
  status.textContent = 'Limpando...';
  status.style.color = '#888';
  try {
    await req('/api/portfolio/clear', 'DELETE', { userId: currentUser.id });
    status.textContent = 'Carteira limpa com sucesso!';
    status.style.color = '#27ae60';
  } catch (err) {
    status.textContent = 'Erro: ' + (err.message || 'falha na conexão');
    status.style.color = '#e74c3c';
  }
  btn.disabled = false;
});

// === Sync Dividends ===
const syncBtn = document.getElementById('sync-dividends-btn');
const syncStatus = document.getElementById('sync-dividends-status');
const syncLog = document.getElementById('sync-dividends-log');

if (syncBtn) {
  syncBtn.addEventListener('click', async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = 'Sincronizando...';
  syncStatus.textContent = 'Buscando dividendos...';
  syncStatus.style.color = '#888';
  syncLog.style.display = 'block';
  syncLog.textContent = '';

  try {
    const res = await fetch('/api/admin/sync-dividends', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao iniciar sincronização');

    syncStatus.textContent = data.message;
    syncStatus.style.color = '#27ae60';

    syncLog.textContent += 'Sincronização iniciada em segundo plano.\nAguardando conclusão...\n\n';

    // Poll logs (server logs to console, we simulate by checking status)
    let elapsed = 0;
    const poll = setInterval(async () => {
      elapsed += 5;
      syncLog.textContent += '.';
      if (elapsed >= 180) {
        clearInterval(poll);
        syncLog.textContent += '\n\nSincronização concluída ou tempo limite atingido. Verifique o console do servidor para detalhes.';
      }
    }, 5000);

    // Stop polling after a reasonable time
    setTimeout(() => clearInterval(poll), 200000);
  } catch (err) {
    syncStatus.textContent = 'Erro: ' + (err.message || 'falha na conexão');
    syncStatus.style.color = '#e74c3c';
  }

  syncBtn.disabled = false;
  syncBtn.textContent = 'Sincronizar dividendos';
});
}

// === Fetch All Dividends ===
document.getElementById('fetch-all-dividends-btn').addEventListener('click', async () => {
  const btn = document.getElementById('fetch-all-dividends-btn');
  const startLabel = document.getElementById('fetch-all-dividends-start');
  const finishLabel = document.getElementById('fetch-all-dividends-finish');
  const log = document.getElementById('fetch-all-dividends-log');

  btn.disabled = true;
  btn.textContent = 'Sincronizando...';
  startLabel.className = 'process-status start';
  startLabel.style.display = 'block';
  startLabel.textContent = 'Iniciando...';
  finishLabel.className = 'process-status';
  finishLabel.textContent = '';
  finishLabel.style.display = 'none';
  log.style.display = 'block';
  log.textContent = '';

  try {
    const data = await req('/api/admin/fetch-all-dividends', 'POST');
    startLabel.className = 'process-status finish';
    startLabel.textContent = `Processando ${data.total} ativos em segundo plano. Verifique o console do servidor quando finalizar.`;
    finishLabel.style.display = 'block';
    finishLabel.className = 'process-status';
    finishLabel.textContent = data.message;
    log.textContent += `${data.total} ativos sendo sincronizados...\n`;
  } catch (err) {
    startLabel.className = 'process-status error';
    startLabel.textContent = 'Erro ao iniciar';
    finishLabel.style.display = 'block';
    finishLabel.className = 'process-status error';
    finishLabel.textContent = err.message || 'Falha na conexão com o servidor';
  }

  btn.disabled = false;
  btn.textContent = 'Atualizar todos os dividendos';
});

// === Fix Payment Dates ===
const fixBtn = document.getElementById('fix-pgto-btn');
if (fixBtn) {
  fixBtn.addEventListener('click', async () => {
  const btn = document.getElementById('fix-pgto-btn');
  const status = document.getElementById('fix-pgto-status');
  btn.disabled = true;
  status.textContent = 'Corrigindo...';
  status.style.color = '#888';
  try {
    await req('/api/admin/fix-payment-dates', 'POST');
    status.textContent = 'Correção iniciada em segundo plano.';
    status.style.color = '#27ae60';
  } catch (err) {
    status.textContent = 'Erro: ' + (err.message || 'falha na conexão');
    status.style.color = '#e74c3c';
  }
  btn.disabled = false;
  });
}

