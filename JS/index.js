gsap.registerPlugin(ScrollTrigger);

const body = document.body;
const preloader = document.querySelector(".preloader");
const loaderLine = document.querySelector(".loader-line span");
const cursorGlow = document.querySelector(".cursor-glow");

if (body) {
  body.classList.add("no-scroll");
}

const loaderPercent = document.querySelector(".loader-percent");

const loaderTl = gsap.timeline();

loaderTl
  .from(".loader-orbit", {
    scale: 0.45,
    opacity: 0,
    rotateX: 90,
    duration: 0.9,
    stagger: 0.08,
    ease: "power4.out"
  })
  .from(".loader-house", {
    scale: 0,
    y: 40,
    rotateY: -35,
    opacity: 0,
    duration: 0.8,
    ease: "back.out(1.8)"
  }, "-=0.55")
  .from(".loader-chip", {
    y: 28,
    opacity: 0,
    scale: 0.86,
    stagger: 0.08,
    duration: 0.55,
    ease: "back.out(1.7)"
  }, "-=0.45")
  .from(".loader-content", {
    y: 35,
    opacity: 0,
    scale: 0.96,
    duration: 0.7,
    ease: "power4.out"
  }, "-=0.4");

gsap.to(".orbit-loader-one", {
  rotateZ: 360,
  duration: 7,
  repeat: -1,
  ease: "none"
});

gsap.to(".orbit-loader-two", {
  rotateZ: -360,
  duration: 5.8,
  repeat: -1,
  ease: "none"
});

gsap.to(".orbit-loader-three", {
  rotateZ: 360,
  duration: 4.7,
  repeat: -1,
  ease: "none"
});

gsap.to(".loader-house", {
  y: -12,
  rotateY: 10,
  duration: 1.8,
  repeat: -1,
  yoyo: true,
  ease: "sine.inOut"
});

gsap.to(".loader-chip", {
  y: -10,
  duration: 1.7,
  repeat: -1,
  yoyo: true,
  stagger: 0.18,
  ease: "sine.inOut"
});

if (loaderLine) {
  gsap.to(loaderLine, {
    width: "100%",
    duration: 2.05,
    ease: "power3.inOut"
  });
}

if (loaderPercent) {
  gsap.to(loaderPercent, {
    innerText: 100,
    duration: 2.05,
    ease: "power3.inOut",
    snap: { innerText: 1 },
    onUpdate: function () {
      if (loaderPercent) {
        loaderPercent.innerText = `${Math.ceil(parseFloat(loaderPercent.innerText))}%`;
      }
    },
    onComplete: () => {
      const exitTl = gsap.timeline({
        onComplete: () => {
          if (preloader) {
            preloader.style.display = "none";
          }
          if (body) {
            body.classList.remove("no-scroll");
          }
          introAnimation();
        }
      });

      exitTl
        .to(".loader-content", {
          y: -35,
          opacity: 0,
          scale: 0.96,
          duration: 0.45,
          ease: "power3.in"
        })
        .to(".loader-orbit-scene", {
          scale: 1.35,
          rotateX: 18,
          opacity: 0,
          duration: 0.7,
          ease: "power4.inOut"
        }, "-=0.25")
        .to(preloader, {
          yPercent: -100,
          duration: 0.9,
          ease: "power4.inOut"
        }, "-=0.2");
    }
  });
}

function introAnimation() {
  const tl = gsap.timeline();

  tl.from(".navbar", {
    y: -45,
    opacity: 0,
    duration: 0.9,
    ease: "power4.out"
  })
  .from(".reveal-hero", {
    y: 95,
    opacity: 0,
    duration: 1.08,
    stagger: 0.09,
    ease: "power4.out"
  }, "-=0.35")
  .from(".stage-ring", {
    scale: 0.45,
    opacity: 0,
    rotateX: 80,
    duration: 1.25,
    stagger: 0.08,
    ease: "power4.out"
  }, "-=0.9")
  .from(".orb", {
    scale: 0,
    opacity: 0,
    duration: 1,
    stagger: 0.12,
    ease: "back.out(1.8)"
  }, "-=0.75")
  .from(".floating-panel", {
    y: 70,
    opacity: 0,
    rotateX: 20,
    rotateY: -18,
    scale: 0.88,
    duration: 1,
    stagger: 0.14,
    ease: "power4.out"
  }, "-=0.85");

  animateCounters();
}

window.addEventListener("mousemove", (event) => {
  if (cursorGlow) {
    gsap.to(cursorGlow, {
      x: event.clientX,
      y: event.clientY,
      duration: 0.45,
      ease: "power3.out"
    });
  }
});

document.querySelectorAll(".floating-panel").forEach((panel) => {
  const depth = parseFloat(panel.dataset.depth || "1");

  window.addEventListener("mousemove", (event) => {
    const x = (event.clientX / window.innerWidth - 0.5) * 26 * depth;
    const y = (event.clientY / window.innerHeight - 0.5) * 22 * depth;

    gsap.to(panel, {
      x,
      y,
      rotateY: x * 0.12,
      rotateX: -y * 0.08,
      duration: 0.9,
      ease: "power3.out"
    });
  });
});

gsap.to(".orb-main", {
  y: -22,
  rotate: 12,
  duration: 3.2,
  repeat: -1,
  yoyo: true,
  ease: "sine.inOut"
});

gsap.to(".orb-small-a", {
  x: -18,
  y: 28,
  duration: 3.8,
  repeat: -1,
  yoyo: true,
  ease: "sine.inOut"
});

gsap.to(".orb-small-b", {
  x: 20,
  y: -16,
  duration: 3.4,
  repeat: -1,
  yoyo: true,
  ease: "sine.inOut"
});

gsap.to(".ring-one", {
  rotateZ: 360,
  duration: 28,
  repeat: -1,
  ease: "none"
});

gsap.to(".ring-two", {
  rotateZ: -360,
  duration: 24,
  repeat: -1,
  ease: "none"
});

gsap.to(".ring-three", {
  rotateZ: 360,
  duration: 18,
  repeat: -1,
  ease: "none"
});

gsap.to(".marquee-track", {
  xPercent: -50,
  duration: 18,
  repeat: -1,
  ease: "none"
});

gsap.utils.toArray(".reveal-up").forEach((item) => {
  gsap.from(item, {
    scrollTrigger: {
      trigger: item,
      start: "top 86%"
    },
    y: 80,
    opacity: 0,
    duration: 0.95,
    ease: "power4.out"
  });
});

gsap.utils.toArray(".reveal-card").forEach((card, index) => {
  gsap.from(card, {
    scrollTrigger: {
      trigger: card,
      start: "top 86%"
    },
    y: 90,
    opacity: 0,
    rotateX: 14,
    scale: 0.96,
    duration: 1,
    delay: index * 0.04,
    ease: "power4.out"
  });

  card.addEventListener("mousemove", (event) => {
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const rotateY = ((x / rect.width) - 0.5) * 10;
    const rotateX = -((y / rect.height) - 0.5) * 10;

    gsap.to(card, {
      rotateX,
      rotateY,
      transformPerspective: 1100,
      duration: 0.4,
      ease: "power3.out"
    });
  });

  card.addEventListener("mouseleave", () => {
    gsap.to(card, {
      rotateX: 0,
      rotateY: 0,
      duration: 0.8,
      ease: "elastic.out(1, 0.45)"
    });
  });
});

ScrollTrigger.matchMedia({
  "(min-width: 1051px)": function () {
    const cinemaTl = gsap.timeline({
      scrollTrigger: {
        trigger: ".cinematic-scroll",
        start: "top top",
        end: "bottom bottom",
        scrub: 1.15
      }
    });

    gsap.set(".card-one", {
      xPercent: -50,
      yPercent: -50,
      z: 180,
      rotateY: -12,
      rotateX: 5,
      opacity: 1
    });

    gsap.set(".card-two", {
      xPercent: -50,
      yPercent: -50,
      y: 520,
      z: -120,
      rotateY: 14,
      rotateX: -8,
      opacity: 0
    });

    gsap.set(".card-three", {
      xPercent: -50,
      yPercent: -50,
      y: 620,
      z: -160,
      rotateY: -16,
      rotateX: 8,
      opacity: 0
    });

    gsap.set(".card-four", {
      xPercent: -50,
      yPercent: -50,
      y: 720,
      z: -220,
      rotateY: 18,
      rotateX: -10,
      opacity: 0
    });

    cinemaTl
      .to(".card-one", {
        y: -520,
        z: -220,
        rotateY: 14,
        rotateX: -10,
        opacity: 0,
        ease: "none"
      }, 0)
      .to(".card-two", {
        y: 0,
        z: 180,
        rotateY: -10,
        rotateX: 4,
        opacity: 1,
        ease: "none"
      }, 0)
      .to(".card-two", {
        y: -520,
        z: -220,
        rotateY: 14,
        rotateX: -8,
        opacity: 0,
        ease: "none"
      }, 0.33)
      .to(".card-three", {
        y: 0,
        z: 180,
        rotateY: 10,
        rotateX: 4,
        opacity: 1,
        ease: "none"
      }, 0.33)
      .to(".card-three", {
        y: -520,
        z: -220,
        rotateY: -14,
        rotateX: -8,
        opacity: 0,
        ease: "none"
      }, 0.66)
      .to(".card-four", {
        y: 0,
        z: 180,
        rotateY: -10,
        rotateX: 4,
        opacity: 1,
        ease: "none"
      }, 0.66)
      .to(".cinema-copy", {
        y: -70,
        opacity: 0.74,
        ease: "none"
      }, 0);
  }
});

gsap.to(".match-orbit", {
  rotate: 360,
  duration: 30,
  repeat: -1,
  ease: "none"
});

gsap.to(".avatar", {
  rotate: -360,
  duration: 30,
  repeat: -1,
  ease: "none"
});

function animateCounters() {
  document.querySelectorAll("[data-count]").forEach((counter) => {
    const finalValue = parseInt(counter.dataset.count || "0", 10);

    gsap.fromTo(counter,
      { innerText: 0 },
      {
        scrollTrigger: {
          trigger: counter,
          start: "top 88%",
          once: true
        },
        innerText: finalValue,
        duration: 1.5,
        ease: "power3.out",
        snap: { innerText: 1 },
        onUpdate: function () {
          counter.innerText = Math.ceil(parseFloat(counter.innerText));
        }
      }
    );
  });
}

const canvas = document.getElementById("particleCanvas");
if (canvas) {
  const ctx = canvas.getContext("2d");

  let canvasWidth;
  let canvasHeight;
  let particles = [];
  let mouse = { x: 0, y: 0 };

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvasWidth = rect.width;
    canvasHeight = rect.height;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    createParticles();
  }

  function createParticles() {
    particles = [];

    const count = window.innerWidth < 760 ? 22 : 92;

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvasWidth,
        y: Math.random() * canvasHeight,
        r: Math.random() * 2.8 + 0.7,
        vx: (Math.random() - 0.5) * 0.24,
        vy: (Math.random() - 0.5) * 0.24,
        alpha: Math.random() * 0.35 + 0.12
      });
    }
  }

  function drawParticles() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const glow = ctx.createRadialGradient(
      canvasWidth * 0.72,
      canvasHeight * 0.42,
      20,
      canvasWidth * 0.72,
      canvasHeight * 0.42,
      canvasWidth * 0.45
    );

    glow.addColorStop(0, "rgba(122, 78, 45, 0.18)");
    glow.addColorStop(1, "rgba(122, 78, 45, 0)");

    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    particles.forEach((particle) => {
      const dx = (mouse.x - particle.x) * 0.0007;
      const dy = (mouse.y - particle.y) * 0.0007;

      particle.x += particle.vx + dx;
      particle.y += particle.vy + dy;

      if (particle.x < -20) particle.x = canvasWidth + 20;
      if (particle.x > canvasWidth + 20) particle.x = -20;
      if (particle.y < -20) particle.y = canvasHeight + 20;
      if (particle.y > canvasHeight + 20) particle.y = -20;

      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(122, 78, 45, ${particle.alpha})`;
      ctx.fill();
    });

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);

        if (distance < 120) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(122, 78, 45, ${0.12 * (1 - distance / 120)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(drawParticles);
  }

  window.addEventListener("resize", resizeCanvas);

  window.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
  });

  resizeCanvas();
  drawParticles();
}

const menuBtn = document.querySelector(".menu-btn");
const navLinks = document.querySelector(".nav-links");

if (menuBtn && navLinks) {
  menuBtn.addEventListener("click", () => {
    navLinks.classList.toggle("mobile-open");
  });
}

gsap.from(".footer", {
  scrollTrigger: {
    trigger: ".footer",
    start: "top 88%"
  },
  y: 90,
  opacity: 0,
  scale: 0.96,
  duration: 1,
  ease: "power4.out"
});

gsap.from(".footer-column a, .social-link", {
  scrollTrigger: {
    trigger: ".footer",
    start: "top 78%"
  },
  y: 28,
  opacity: 0,
  duration: 0.75,
  stagger: 0.045,
  ease: "power3.out"
});
