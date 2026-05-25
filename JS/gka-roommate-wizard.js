/**
 * GSAP-powered step cards for roommate questionnaire.
 */
window.GKARoommateWizard = (function () {
  const STEPS = [
    {
      key: 'sleep',
      title: 'Sleep cycle',
      subtitle: 'When do you usually wake up and sleep?',
      options: [
        { val: 'early', label: 'Early riser — sleep & wake early' },
        { val: 'night', label: 'Night owl — late nights' },
        { val: 'fluid', label: 'Flexible — depends on semester' }
      ]
    },
    {
      key: 'cleanliness',
      title: 'Cleanliness',
      subtitle: 'How tidy should the shared space stay?',
      options: [
        { val: 'high', label: 'Strictly clean' },
        { val: 'moderate', label: 'Organized but chill' },
        { val: 'low', label: 'Weekly cleanup is fine' }
      ]
    },
    {
      key: 'diet',
      title: 'Food preference',
      subtitle: 'Kitchen and fridge compatibility',
      options: [
        { val: 'veg', label: 'Strictly vegetarian' },
        { val: 'mix', label: 'Non-veg allowed in flat' }
      ]
    },
    {
      key: 'guests',
      title: 'Guests & friends',
      subtitle: 'How often can people visit?',
      options: [
        { val: 'low', label: 'Rarely — family only' },
        { val: 'moderate', label: 'Weekends OK' },
        { val: 'high', label: 'Social flat culture' }
      ]
    },
    {
      key: 'study',
      title: 'Study vibe',
      subtitle: 'Your ideal room atmosphere',
      options: [
        { val: 'silent', label: 'Library silence' },
        { val: 'social', label: 'Group study + light music' }
      ]
    }
  ];

  function mount({ containerId, answers, onAnswer, onComplete }) {
    const host = document.getElementById(containerId);
    if (!host) return;

    let step = 0;
    host.innerHTML = `
      <div class="gka-wizard-progress" id="rmProgress"></div>
      <div class="rm-wizard-wrap" id="rmCardHost"></div>
      <div class="gka-wizard-nav">
        <button type="button" class="gka-btn gka-btn-ghost" id="rmPrev">Back</button>
        <button type="button" class="gka-btn gka-btn-primary" id="rmNext">Continue</button>
      </div>
    `;

    const progress = host.querySelector('#rmProgress');
    const cardHost = host.querySelector('#rmCardHost');
    const prevBtn = host.querySelector('#rmPrev');
    const nextBtn = host.querySelector('#rmNext');

    STEPS.forEach((_, i) => {
      const d = document.createElement('div');
      d.className = 'gka-wizard-dot';
      d.dataset.idx = i;
      progress.appendChild(d);
    });

    function renderStep(dir = 1) {
      const s = STEPS[step];
      progress.querySelectorAll('.gka-wizard-dot').forEach((dot, i) => {
        dot.classList.toggle('is-active', i === step);
        dot.classList.toggle('is-done', i < step);
      });

      prevBtn.style.visibility = step === 0 ? 'hidden' : 'visible';
      nextBtn.innerHTML =
        step === STEPS.length - 1
          ? '<span>Find matches</span><i class="fa-solid fa-sparkles"></i>'
          : '<span>Continue</span><i class="fa-solid fa-arrow-right"></i>';

      const opts = s.options
        .map(
          (o) =>
            `<button type="button" class="rm-opt${answers[s.key] === o.val ? ' selected' : ''}" data-val="${o.val}">${o.label}</button>`
        )
        .join('');

      const card = document.createElement('div');
      card.className = 'rm-step-card';
      card.innerHTML = `
        <div class="step-num">Step ${step + 1} of ${STEPS.length}</div>
        <h3>${s.title}</h3>
        <p class="gka-sub" style="margin-top:0;">${s.subtitle}</p>
        <div class="rm-opt-grid">${opts}</div>
      `;

      cardHost.innerHTML = '';
      cardHost.appendChild(card);

      card.querySelectorAll('.rm-opt').forEach((btn) => {
        btn.addEventListener('click', () => {
          card.querySelectorAll('.rm-opt').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          answers[s.key] = btn.dataset.val;
          if (onAnswer) onAnswer(s.key, btn.dataset.val);
          if (window.gsap) {
            gsap.fromTo(btn, { scale: 0.96 }, { scale: 1, duration: 0.35, ease: 'back.out(2)' });
          }
        });
      });

      if (window.gsap) {
        gsap.fromTo(
          card,
          { opacity: 0, y: dir > 0 ? 40 : -40, rotateX: dir > 0 ? 8 : -8 },
          { opacity: 1, y: 0, rotateX: 0, duration: 0.55, ease: 'power3.out' }
        );
      }
    }

    prevBtn.onclick = () => {
      if (step > 0) {
        step -= 1;
        renderStep(-1);
      }
    };

    nextBtn.onclick = () => {
      const key = STEPS[step].key;
      if (!answers[key]) {
        if (window.showToast) window.showToast('Pick an option to continue');
        return;
      }
      if (step < STEPS.length - 1) {
        step += 1;
        renderStep(1);
      } else if (onComplete) {
        onComplete(answers);
      }
    };

    renderStep(1);
  }

  return { mount, STEPS };
})();
