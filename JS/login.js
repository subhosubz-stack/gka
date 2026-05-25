const safeStorage = (() => {
  const memory = new Map();

  function canUse(storage) {
    try {
      if (!storage) return false;
      const testKey = "__gka_storage_test__";
      storage.setItem(testKey, "1");
      storage.removeItem(testKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  const store =
    canUse(window.localStorage) ? window.localStorage :
    canUse(window.sessionStorage) ? window.sessionStorage :
    null;

  return {
    getItem(key) {
      if (store) return store.getItem(key);
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      if (store) {
        store.setItem(key, value);
        return;
      }
      memory.set(key, value);
    },
    removeItem(key) {
      if (store) {
        store.removeItem(key);
        return;
      }
      memory.delete(key);
    }
  };
})();

const API_BASE_URL =
  window.GKA_CONFIG?.API_BASE_URL ||
  "/api";

const cursorGlow = document.querySelector(".cursor-glow");
const authCard = document.querySelector(".auth-card");
const passwordInput = document.getElementById("password");
const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const loginAlert = document.getElementById("loginAlert");
const forgotPassword = document.getElementById("forgotPassword");
const loginPanda = document.getElementById("loginPanda");

let isSubmitting = false;

window.addEventListener("mousemove", (event) => {
  if (cursorGlow) {
    cursorGlow.style.left = `${event.clientX}px`;
    cursorGlow.style.top = `${event.clientY}px`;
  }

  if (isSubmitting) return;

  movePandaEyes(event.clientX, event.clientY);
});

function movePandaEyes(mouseX, mouseY) {
  const eyes = document.querySelectorAll(".eye-white");

  eyes.forEach((eyeWhite) => {
    const pupil = eyeWhite.querySelector(".eye-ball");
    if (!pupil) return;

    const rect = eyeWhite.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = mouseX - centerX;
    const dy = mouseY - centerY;
    const angle = Math.atan2(dy, dx);

    const radius = 7;
    const moveX = Math.cos(angle) * radius;
    const moveY = Math.sin(angle) * radius;

    pupil.style.setProperty("--eye-x", `${moveX}px`);
    pupil.style.setProperty("--eye-y", `${moveY}px`);
  });
}

function resetPandaEyes() {
  document.querySelectorAll(".eye-ball").forEach((eye) => {
    eye.style.setProperty("--eye-x", "0px");
    eye.style.setProperty("--eye-y", "0px");
  });
}

function pandaWink() {
  if (!loginPanda) return;

  loginPanda.classList.remove("panda-wink", "panda-happy", "panda-error");
  void loginPanda.offsetWidth;
  loginPanda.classList.add("panda-wink");

  setTimeout(() => {
    loginPanda.classList.remove("panda-wink");
  }, 900);
}

function pandaHappy() {
  if (!loginPanda) return;

  loginPanda.classList.remove("panda-wink", "panda-error");
  loginPanda.classList.add("panda-happy");

  setTimeout(() => {
    if (loginPanda) loginPanda.classList.remove("panda-happy");
  }, 1200);
}

function pandaError() {
  if (!loginPanda) return;

  loginPanda.classList.remove("panda-wink", "panda-happy");
  loginPanda.classList.add("panda-error");

  setTimeout(() => {
    if (loginPanda) loginPanda.classList.remove("panda-error");
  }, 900);
}

if (passwordInput && authCard) {
  passwordInput.addEventListener("focus", () => {
    authCard.classList.add("up");
    if (loginPanda) loginPanda.classList.add("panda-peek");
  });

  passwordInput.addEventListener("blur", () => {
    authCard.classList.remove("up");
    if (loginPanda) loginPanda.classList.remove("panda-peek");
  });
}

document.querySelectorAll(".toggle-password").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.target);
    const icon = button.querySelector("i");

    if (!target || !icon) return;

    const isPassword = target.type === "password";

    target.type = isPassword ? "text" : "password";
    icon.className = isPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";

    pandaWink();
  });
});

function showAlert(message) {
  if (!loginAlert || !authCard) {
    alert(message);
    return;
  }

  loginAlert.textContent = message;
  loginAlert.classList.add("show");

  authCard.classList.add("wrong-entry");
  pandaError();

  setTimeout(() => {
    if (authCard) authCard.classList.remove("wrong-entry");
  }, 400);

  setTimeout(() => {
    if (loginAlert) loginAlert.classList.remove("show");
  }, 4500);
}

function setLoading(isLoading) {
  if (!loginBtn) return;

  loginBtn.disabled = isLoading;

  loginBtn.innerHTML = isLoading
    ? `<span>Checking securely...</span><i class="fa-solid fa-spinner fa-spin"></i>`
    : `<span>Login securely</span><i class="fa-solid fa-arrow-right"></i>`;
}

function getPostLoginRedirect() {
  try {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      return decodeURIComponent(next);
    }
  } catch (_) {}
  return null;
}

async function redirectAfterLogin() {
  const token = safeStorage.getItem("gka_token") || safeStorage.getItem("gka_auth_token");
  if (!token) {
    return;
  }

  const directNext = getPostLoginRedirect();
  if (directNext) {
    window.location.href = directNext;
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      safeStorage.removeItem("gka_token");
      safeStorage.removeItem("gka_auth_token");
      return;
    }

    const rawText = await res.text();
    let data = {};
    try {
      data = JSON.parse(rawText);
    } catch (_) {
      console.error("Invalid response format on redirectAfterLogin check");
      return;
    }

    const user = data.user;
    if (window.GKAAuth) {
      GKAAuth.redirectAfterAuth(user);
      return;
    }
    window.location.href = "role-select.html";
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("Error in redirectAfterLogin:", error);
    showAlert("Could not load user profile details.");
  }
}

function saveAuthSession(token, user) {
  if (window.GKAAuth) {
    GKAAuth.saveSession(token, user);
    return;
  }
  safeStorage.setItem("gka_token", token);
  safeStorage.setItem("gka_auth_token", token);
  safeStorage.setItem("gka_user", JSON.stringify(user));
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    const emailInput = document.getElementById("email");

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;

    if (!email || !password) {
      showAlert("Please enter email and password.");
      return;
    }

    isSubmitting = true;
    resetPandaEyes();
    pandaWink();

    if (authCard) authCard.classList.add("auth-submitting");

    setLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      console.log("Login API:", `${API_BASE_URL}/auth/login`);
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({ email, password })
      });

      clearTimeout(timeoutId);

      const rawText = await res.text();
      let body = {};
      try {
        body = JSON.parse(rawText);
      } catch (parseErr) {
        console.error("JSON parse error during login:", parseErr, "Raw text:", rawText);
        throw new Error("Invalid format received from authentication server.");
      }

      setLoading(false);

      if (authCard) authCard.classList.remove("auth-submitting");

      if (!res.ok) {
        isSubmitting = false;
        const hint =
          rawText.trim().startsWith("<")
            ? "API not reachable. Run npm run dev and open http://127.0.0.1:3000/login.html"
            : body.error || "Login failed.";
        showAlert(hint);
        return;
      }

      pandaHappy();
      saveAuthSession(body.token, body.data?.user || body.user);

      setTimeout(() => {
        redirectAfterLogin();
      }, 650);
    } catch (err) {
      clearTimeout(timeoutId);
      console.error("Login exception caught:", err);
      setLoading(false);
      isSubmitting = false;
      if (authCard) authCard.classList.remove("auth-submitting");

      let errorMsg = err.message || "An unexpected error occurred during login.";
      if (err.name === 'AbortError') {
        errorMsg = "Login request timed out. Please check your network and try again.";
      }
      showAlert(errorMsg);
    }
  });
}

if (forgotPassword) {
  forgotPassword.addEventListener("click", async (event) => {
    event.preventDefault();

    const emailInput = document.getElementById("email");
    const email = emailInput.value.trim().toLowerCase();

    if (!email) {
      showAlert("Enter your email first, then click forgot password.");
      return;
    }

    pandaWink();
    showAlert(
      "Password reset is not live yet. Use the password from sign up, or sign up again with a new email."
    );
  });
}

window.addEventListener("load", async () => {
  if (window.GKAAuth) {
    GKAAuth.initGoogleButton("googleSignInBtn", (data) => {
      pandaHappy();
      setTimeout(() => GKAAuth.redirectAfterAuth(data.user), 500);
    }, (msg) => showAlert(msg));
  }

  const token = safeStorage.getItem("gka_token") || safeStorage.getItem("gka_auth_token");
  if (token) {
    await redirectAfterLogin();
  }
});
