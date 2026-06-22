const API = '/api';
const authKey = 'site-login-authenticated';

function getUser() {
  const stored = localStorage.getItem(authKey);
  return stored ? JSON.parse(stored) : null;
}

function clearUser() {
  localStorage.removeItem(authKey);
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

const isAdmin = currentUser && currentUser.username === 'admin';
if (!isAdmin) {
  window.location.href = '/dashboard';
}

document.querySelectorAll('.sidebar-link').forEach(el => {
  if (el.dataset.page === 'usuarios') el.classList.add('active');
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

async function loadUsers() {
  try {
    const users = await req('/api/admin/users');
    document.getElementById('user-count').textContent = users.length;
    const tbody = document.getElementById('users-tbody');
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-message">Nenhum usuario cadastrado.</td></tr>';
      return;
    }
    tbody.innerHTML = users.map(u => {
      const isAdminUser = u.username === 'admin';
      return `
        <tr>
          <td><strong>${u.id}</strong></td>
          <td>${u.username}</td>
          <td>${u.fullname || '—'}</td>
          <td>${u.email || '—'}</td>
          <td><span class="user-role-badge ${isAdminUser ? 'admin' : 'user'}">${isAdminUser ? 'Admin' : 'Usuario'}</span></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    document.getElementById('users-tbody').innerHTML =
      '<tr><td colspan="5" class="error">Erro ao carregar usuarios: ' + err.message + '</td></tr>';
  }
}

loadUsers();
