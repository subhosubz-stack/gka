/**
 * Card-style product tour (skippable, step-by-step).
 */
window.GKAProductTour = (function () {
  const STEPS = [
    {
      title: 'Welcome to GharKaAdda',
      body: 'A verified student housing platform for Punjab and the Tricity region. Browse listings, match roommates, and manage your stay in one place.'
    },
    {
      title: 'Find verified properties',
      body: 'Search by college, budget, and amenities. Every listing goes through verification before it goes live.'
    },
    {
      title: 'Unlock contacts safely',
      body: 'Pay a small fee to unlock owner or broker contact details for 30 days. Chat stays on-platform until your stay is confirmed.'
    },
    {
      title: 'Lock your room',
      body: 'Submit a stay offer lock when you are ready. Owners review requests and approve move-in dates from their dashboard.'
    },
    {
      title: 'You are all set',
      body: 'Choose your role next to open the right dashboard. Owners and brokers can publish listings after onboarding.'
    }
  ];

  function tourKey(userId) {
    return `gka_tour_done_${userId || 'anon'}`;
  }

  function isCompleted(userId) {
    try {
      return localStorage.getItem(tourKey(userId)) === '1';
    } catch {
      return false;
    }
  }

  function markCompleted(userId) {
    try {
      localStorage.setItem(tourKey(userId), '1');
    } catch (_) {}
  }

  function run({ onFinish, userId } = {}) {
    let step = 0;
    const overlay = document.createElement('div');
    overlay.className = 'gka-tour-overlay';
    overlay.innerHTML = `
      <div class="gka-tour-backdrop"></div>
      <div class="gka-tour-card" role="dialog" aria-modal="true">
        <div class="gka-tour-progress"></div>
        <h3></h3>
        <p></p>
        <div class="gka-tour-actions">
          <button type="button" class="gka-tour-btn gka-tour-btn-ghost" data-skip>Skip tour</button>
          <button type="button" class="gka-tour-btn gka-tour-btn-primary" data-next>Next</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const card = overlay.querySelector('.gka-tour-card');
    const titleEl = card.querySelector('h3');
    const bodyEl = card.querySelector('p');
    const progressEl = card.querySelector('.gka-tour-progress');
    const nextBtn = card.querySelector('[data-next]');
    const skipBtn = card.querySelector('[data-skip]');

    function finish() {
      markCompleted(userId);
      overlay.remove();
      document.body.style.overflow = '';
      if (onFinish) onFinish();
    }

    function render() {
      const s = STEPS[step];
      titleEl.textContent = s.title;
      bodyEl.textContent = s.body;
      progressEl.textContent = `Step ${step + 1} of ${STEPS.length}`;
      nextBtn.textContent = step === STEPS.length - 1 ? 'Get started' : 'Next';
    }

    nextBtn.onclick = () => {
      if (step < STEPS.length - 1) {
        step += 1;
        render();
      } else {
        finish();
      }
    };
    skipBtn.onclick = finish;
    overlay.querySelector('.gka-tour-backdrop').onclick = finish;

    render();
  }

  return { run, isCompleted, markCompleted, STEPS };
})();
