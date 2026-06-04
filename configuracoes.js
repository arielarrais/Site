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
      b3xlsxStatus.textContent = 'Nenhum ativo encontrado nas movimentações.';
      b3xlsxStatus.style.color = '#e67e22';
      b3xlsxProcessing = false;
      return;
    }

    let html = '';
    b3xlsxAssets.forEach(a => {
      const typeLabel = { 'compra': 'Compra', 'venda': 'Venda', 'bonificacao': 'Bonif', 'desdobro': 'Desdobro', 'grupamento': 'Grupamento', 'incorporacao': 'Incorp', 'fracao': 'Fração', 'leilao': 'Leilão' }[a.movementType] || a.movementType;
      html += `<tr><td>${a.ticker}</td><td>${a.quantity}</td><td>R$ ${Number(a.purchasePrice).toFixed(2)}</td><td>${a.institution || '—'}</td><td>${typeLabel}</td></tr>`;
    });
    b3xlsxPreviewBody.innerHTML = html;
    b3xlsxPreviewCount.textContent = `${b3xlsxAssets.length} ativo(s) encontrado(s).`;
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
    alert(`Importação concluída: ${imported} de ${total} ativos importados.`);
  } catch (err) {
    alert('Erro ao importar: ' + (err.message || 'desconhecido'));
  }
  b3xlsxImportBtn.disabled = false;
  b3xlsxImportBtn.textContent = 'Importar para carteira';
});
