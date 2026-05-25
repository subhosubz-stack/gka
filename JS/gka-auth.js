/**
 * Shared auth: Google Sign-In, post-login redirect, verification gate.
 */
window.GKAAuth = (function () {
  const API = () => window.GKA_CONFIG?.API_BASE_URL || '/api';

  function getStorage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function saveSession(token, user) {
    const s = getStorage();
    if (!s) return;
    s.setItem('gka_token', token);
    s.setItem('gka_auth_token', token);
    s.setItem('gka_user', JSON.stringify(user));
  }

  async function fetchAuthConfig() {
    const urls = [`${API()}/config/public`, `${API()}/auth/config`];
    let lastError = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
          lastError = new Error(`Auth config unavailable (${res.status}).`);
          continue;
        }
        const data = await res.json();
        return {
          googleClientId: data.googleClientId,
          googleEnabled: data.googleEnabled,
          verificationDevMode: data.verificationDevMode
        };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Could not load auth configuration.');
  }

  function showGoogleSlotMessage(el, text) {
    el.innerHTML = `<p class="gka-google-slot-msg">${text}</p>`;
  }

  function loadGsiScript() {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (window.__gkaGsiScriptPromise) return window.__gkaGsiScriptPromise;

    window.__gkaGsiScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-gka-gsi="1"]');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('GSI script error')));
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.gkaGsi = '1';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load Google Sign-In script.'));
      document.head.appendChild(script);
    });

    return window.__gkaGsiScriptPromise;
  }

  function renderGoogleButton(el, cfg, onSuccess, onError) {
    if (!window.google?.accounts?.id) {
      showGoogleSlotMessage(el, 'Google Sign-In failed to load. Check your connection or ad blocker.');
      return;
    }

    el.innerHTML = '';
    window.google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      auto_select: false,
      cancel_on_tap_outside: true,
      callback: async (response) => {
        try {
          const res = await fetch(`${API()}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ credential: response.credential })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Google sign-in failed');
          saveSession(data.token, data.user);
          if (onSuccess) onSuccess(data);
        } catch (e) {
          if (onError) onError(e.message || 'Google sign-in failed');
        }
      }
    });

    const paint = () => {
      const measured = el.getBoundingClientRect().width || el.offsetWidth || 0;
      const width = Math.min(Math.max(Math.round(measured) || 320, 280), 400);
      window.google.accounts.id.renderButton(el, {
        theme: 'outline',
        size: 'large',
        width,
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'left'
      });
    };

    requestAnimationFrame(() => requestAnimationFrame(paint));
  }

  function initGoogleButton(containerId, onSuccess, onError) {
    const el = document.getElementById(containerId);
    if (!el) return;

    showGoogleSlotMessage(el, 'Loading Google Sign-In…');

    fetchAuthConfig()
      .then(async (cfg) => {
        if (!cfg.googleEnabled || !cfg.googleClientId) {
          showGoogleSlotMessage(
            el,
            'Google Sign-In is off. Add GOOGLE_CLIENT_ID to .env and restart the server.'
          );
          return;
        }

        await loadGsiScript();
        renderGoogleButton(el, cfg, onSuccess, onError);
      })
      .catch((err) => {
        const api = API();
        const here = window.location.href;
        const devPort = window.GKA_CONFIG?.DEV_API_PORT || '3000';
        showGoogleSlotMessage(
          el,
          `Cannot reach the API (${api}). Start the server (node server.js), then open http://127.0.0.1:${devPort}/login.html — not Live Server. You are on: ${here}`
        );
        console.warn('[GKA] Google Sign-In config:', err.message);
      });
  }

  function redirectAfterAuth(user) {
    if (!user) {
      window.location.href = 'role-select.html';
      return;
    }

    if (user.needs_verification) {
      window.location.href = 'verify-account.html';
      return;
    }

    const role = user.role;
    const step = user.onboarding_step;

    if (!role || step === 'profile_created' || step === 'account_created') {
      const tourDone =
        window.GKAProductTour?.isCompleted(user.id) ||
        (() => {
          try {
            return localStorage.getItem(`gka_tour_done_${user.id}`) === '1';
          } catch {
            return false;
          }
        })();
      window.location.href = tourDone ? 'role-select.html' : 'product-tour.html';
      return;
    }

    if (role === 'tenant') {
      window.location.href =
        step === 'role_selected' ? 'tenant-match.html' : 'tenant-dashboard.html';
      return;
    }
    if (role === 'owner') {
      window.location.href =
        step === 'role_selected' ? 'owner-onboarding.html' : 'owner-dashboard.html';
      return;
    }
    if (role === 'broker') {
      window.location.href =
        step === 'role_selected' ? 'broker-onboarding.html' : 'broker-dashboard.html';
      return;
    }
    if (role === 'admin') {
      if (user.admin_tier === 'property') {
        window.location.href = 'property-admin/index.html';
      } else {
        window.location.href = 'super-admin/index.html';
      }
      return;
    }
    window.location.href = 'role-select.html';
  }

  return { initGoogleButton, redirectAfterAuth, saveSession, fetchAuthConfig };
})();
