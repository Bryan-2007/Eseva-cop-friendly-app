(function () {
  const page = document.body && document.body.dataset ? document.body.dataset.page : null;
  const REF_STORAGE_KEY = 'tnpol_referral';

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function setError(el, msg) {
    if (!el) return;
    el.textContent = msg || '';
  }

  function getReferralFromUrlOrStorage() {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('ref');
    if (fromUrl) {
      localStorage.setItem(REF_STORAGE_KEY, fromUrl.trim().toUpperCase());
    }
    return localStorage.getItem(REF_STORAGE_KEY);
  }

  async function apiJson(url, options) {
    const res = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options && options.headers ? options.headers : {}),
      },
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  async function apiForm(url, formData) {
    const res = await fetch(url, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  async function loadMe() {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user;
  }

  function formatTime(ts) {
    if (!ts) return '-';
    try {
      const d = new Date(ts);
      return d.toLocaleString();
    } catch {
      return String(ts);
    }
  }

  function renderComplaints(container, complaints) {
    if (!container) return;
    if (!complaints || complaints.length === 0) {
      container.classList.remove('hidden');
      container.innerHTML = '<div class="muted">No reports yet.</div>';
      return;
    }
    container.classList.remove('hidden');

    container.innerHTML = '';
    for (const c of complaints) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div>
            <div class="status">Status: ${escapeHtml(c.status)}</div>
            <div class="muted">Submitted: ${escapeHtml(formatTime(c.createdAt))}</div>
            <div style="margin-top:6px;"><b>Location:</b> ${escapeHtml(c.locationTag)}</div>
            <div style="margin-top:6px;"><b>Description:</b> ${escapeHtml(c.description)}</div>
            ${c.identityText ? `<div style="margin-top:6px;"><b>Identity (optional):</b> ${escapeHtml(c.identityText)}</div>` : ''}
            ${c.policeNotes ? `<div style="margin-top:6px;"><b>Police notes:</b> ${escapeHtml(c.policeNotes)}</div>` : ''}
          </div>
        </div>
        <div class="thumbs" style="margin-top:10px;">
          ${c.images && c.images.length ? c.images.map((u) => `<img src="${escapeHtml(u)}" alt="evidence" />`).join('') : '<div class="muted">No images</div>'}
        </div>
      `;
      container.appendChild(card);
    }
  }

  async function initComplaintPage() {
    const meNotice = document.getElementById('meNotice');
    const loginLink = document.getElementById('loginLink');
    const registerLink = document.getElementById('registerLink');
    const form = document.getElementById('complaintForm');
    const formError = document.getElementById('formError');
    const gpsBtn = document.getElementById('gpsBtn');
    const locationTagInput = document.getElementById('locationTag');
    const identityTextInput = document.getElementById('identityText');
    const viewMyReportsBtn = document.getElementById('viewMyReportsBtn');
    const myReports = document.getElementById('myReports');

    const user = await loadMe();
    if (user) {
      if (meNotice) meNotice.classList.add('hidden');
      if (loginLink) loginLink.classList.add('hidden');
      if (registerLink) registerLink.classList.add('hidden');
    }

    gpsBtn && gpsBtn.addEventListener('click', async () => {
      formError.textContent = '';
      if (!navigator.geolocation) {
        setError(formError, 'GPS not supported on this device.');
        return;
      }
      gpsBtn.disabled = true;
      gpsBtn.textContent = 'Getting GPS...';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          locationTagInput.value = `${lat.toFixed(6)},${lng.toFixed(6)}`;
          gpsBtn.disabled = false;
          gpsBtn.textContent = 'Use my GPS location';
        },
        (err) => {
          gpsBtn.disabled = false;
          gpsBtn.textContent = 'Use my GPS location';
          setError(formError, err && err.message ? err.message : 'Could not get location.');
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 1000 }
      );
    });

    const sosBtn = document.getElementById('sosBtn');
    if (sosBtn) {
      let tapCount = 0;
      let lastTapAt = 0;
      const maxGapMs = 2200;
      sosBtn.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastTapAt > maxGapMs) tapCount = 0;
        tapCount += 1;
        lastTapAt = now;
        if (tapCount >= 3) {
          // Works on mobile browsers that support tel: links.
          window.location.href = 'tel:100';
          tapCount = 0;
        } else {
          sosBtn.textContent = `SOS (Tap ${Math.max(0, 3 - tapCount)} times)`;
          setTimeout(() => {
            sosBtn.textContent = 'SOS (Tap 3 times)';
          }, 1400);
        }
      });
    }

    viewMyReportsBtn && viewMyReportsBtn.addEventListener('click', async () => {
      formError.textContent = '';
      myReports.classList.toggle('hidden');
      if (!myReports.classList.contains('hidden')) {
        try {
          const res = await fetch('/api/complaints/mine', { credentials: 'include' });
          if (!res.ok) throw new Error('Please login to view your reports.');
          const data = await res.json();
          renderComplaints(myReports, data.complaints);
        } catch (e) {
          setError(formError, e.message);
        }
      }
    });

    form && form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setError(formError, '');

      const currentUser = await loadMe();
      if (!currentUser) {
        setError(formError, 'Please login first.');
        location.href = '/login';
        return;
      }

      const fd = new FormData();
      fd.append('locationTag', locationTagInput.value);
      fd.append('description', document.getElementById('description').value);
      if (identityTextInput && identityTextInput.value) {
        fd.append('identityText', identityTextInput.value);
      }
      const evidenceInput = document.getElementById('evidence');
      if (evidenceInput && evidenceInput.files && evidenceInput.files.length) {
        for (const f of evidenceInput.files) fd.append('evidence', f);
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      const prev = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
      try {
        const data = await apiForm('/api/complaints', fd);
        setError(formError, '');
        alert('Report submitted. Police will verify it for rewards.');
        form.reset();
        if (myReports && !myReports.classList.contains('hidden')) {
          const res = await fetch('/api/complaints/mine', { credentials: 'include' });
          const mine = await res.json();
          renderComplaints(myReports, mine.complaints);
        }
      } catch (err) {
        setError(formError, err.message || 'Submission failed');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = prev;
      }
    });
  }

  async function initRewardsPage() {
    const meLine = document.getElementById('meLine');
    const referralCodeEl = document.getElementById('referralCode');
    const referralLinkEl = document.getElementById('referralLink');
    const copyBtn = document.getElementById('copyReferralBtn');
    const rewardsList = document.getElementById('rewardsList');

    try {
      const user = await loadMe();
      if (!user) {
        meLine.textContent = 'Please login to view rewards.';
        location.href = '/login';
        return;
      }

      meLine.textContent = `Logged in as ${user.displayName}`;
      referralCodeEl.textContent = user.referralCode;
      const link = `${location.origin}/?ref=${encodeURIComponent(user.referralCode)}`;
      referralLinkEl.value = link;

      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(link);
          alert('Referral link copied.');
        } catch {
          referralLinkEl.select();
          document.execCommand('copy');
        }
      });

      const res = await fetch('/api/rewards/mine', { credentials: 'include' });
      if (!res.ok) throw new Error('Could not load rewards.');
      const data = await res.json();
      const rewards = data.rewards || [];

      if (rewards.length === 0) {
        rewardsList.textContent = 'No rewards yet.';
        return;
      }

      rewardsList.innerHTML = '';
      for (const r of rewards) {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <div class="status">+ ${escapeHtml(r.amount)} ${escapeHtml(r.currency)} (${escapeHtml(r.status)})</div>
          <div class="muted">Source: ${escapeHtml(r.sourceType)} • ${escapeHtml(formatTime(r.createdAt))}</div>
        `;
        rewardsList.appendChild(card);
      }
    } catch (e) {
      if (meLine) meLine.textContent = e.message || 'Failed to load rewards.';
    }
  }

  async function initRegisterPage() {
    const form = document.getElementById('registerForm');
    const errorEl = document.getElementById('formError');
    const goLoginBtn = document.getElementById('goLoginBtn');
    const referralCode = getReferralFromUrlOrStorage();
    goLoginBtn && goLoginBtn.addEventListener('click', () => (location.href = '/login'));

    form && form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setError(errorEl, '');

      const payload = {
        displayName: document.getElementById('displayName').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      };
      if (referralCode) payload.referralCode = referralCode;

      try {
        const data = await apiJson('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
        if (data && data.ok) location.href = '/';
      } catch (err) {
        setError(errorEl, err.message || 'Registration failed');
      }
    });
  }

  async function initLoginPage() {
    const form = document.getElementById('loginForm');
    const errorEl = document.getElementById('formError');
    const goRegisterBtn = document.getElementById('goRegisterBtn');
    goRegisterBtn && goRegisterBtn.addEventListener('click', () => (location.href = '/register'));

    form && form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setError(errorEl, '');

      const payload = {
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      };

      try {
        const data = await apiJson('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
        if (data && data.ok) location.href = '/';
      } catch (err) {
        setError(errorEl, err.message || 'Login failed');
      }
    });
  }

  // Capture referral code as early as possible.
  // This supports “referrals on install + register” as “referrals on first open + register”.
  getReferralFromUrlOrStorage();

  if (page === 'complaint') initComplaintPage();
  if (page === 'rewards') initRewardsPage();
  if (page === 'register') initRegisterPage();
  if (page === 'login') initLoginPage();
})();

