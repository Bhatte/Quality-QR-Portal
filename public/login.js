(() => {
  const form = document.getElementById('login-form');
  const emailEl = document.getElementById('email');
  const codeEl = document.getElementById('code');
  const submit = document.getElementById('submit');
  const errorEl = document.getElementById('error');

  async function post(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      redirect: 'follow'
    });
    const ct = res.headers.get('content-type') || '';
    const json = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};
    return { ok: res.ok && json.ok !== false, status: res.status, body: json };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    submit.disabled = true;

    const email = (emailEl.value || '').trim();
    const code = (codeEl.value || '').trim();

    if (!email || !code) {
      errorEl.textContent = 'Please enter email and access code.';
      submit.disabled = false;
      return;
    }

    try {
      const out = await post('/auth/local/login', { email, code });
      if (out.ok) {
        const to = out.body?.redirectTo || '/admin.html';
        window.location.href = to;
        return;
      }
      const err = out.body?.error || 'login_failed';
      const msg = {
        missing_credentials: 'Please enter email and access code.',
        server_not_configured: 'Server is not configured for local login. Contact administrator.',
        not_allowed: 'This email is not allowed. Contact administrator.',
        invalid_code: 'Invalid access code.',
        too_many_attempts: 'Too many attempts. Please try again later.'
      }[err] || 'Login failed. Please try again.';
      errorEl.textContent = msg;
    } catch (ex) {
      errorEl.textContent = 'Network error. Please check your connection and try again.';
    } finally {
      submit.disabled = false;
    }
  });
})();
