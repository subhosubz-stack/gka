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
const signupCard = document.getElementById("signupCard");
const verifyForm = document.getElementById("verifyForm");
const detailsForm = document.getElementById("detailsForm");
const signupAlert = document.getElementById("signupAlert");
const signupAlertStep2 = document.getElementById("signupAlertStep2");
const createAccountBtn = document.getElementById("createAccountBtn");
const continueVerifyBtn = document.getElementById("continueVerifyBtn");
const signupPanda = document.getElementById("signupPanda");
const stepDots = document.querySelectorAll("[data-step-dot]");

let preSignupSessionId = null;
let emailVerified = false;
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
  if (!signupPanda) return;

  signupPanda.classList.remove("panda-wink", "panda-happy", "panda-error");
  void signupPanda.offsetWidth;
  signupPanda.classList.add("panda-wink");

  setTimeout(() => {
    if (signupPanda) signupPanda.classList.remove("panda-wink");
  }, 900);
}

function pandaHappy() {
  if (!signupPanda) return;

  signupPanda.classList.remove("panda-wink", "panda-error");
  signupPanda.classList.add("panda-happy");

  setTimeout(() => {
    if (signupPanda) signupPanda.classList.remove("panda-happy");
  }, 1200);
}

function pandaError() {
  if (!signupPanda) return;

  signupPanda.classList.remove("panda-wink", "panda-happy");
  signupPanda.classList.add("panda-error");

  setTimeout(() => {
    if (signupPanda) signupPanda.classList.remove("panda-error");
  }, 900);
}

document.querySelectorAll("input[type='password']").forEach((input) => {
  input.addEventListener("focus", () => {
    if (signupCard) signupCard.classList.add("up");
    if (signupPanda) signupPanda.classList.add("panda-peek");
  });

  input.addEventListener("blur", () => {
    if (signupCard) signupCard.classList.remove("up");
    if (signupPanda) signupPanda.classList.remove("panda-peek");
  });
});

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

function friendlyError(message) {
  if (!message) return "Something went wrong. Please try again.";
  const text = String(message).trim();
  if (text.startsWith("{") && text.includes("message")) {
    try {
      const j = JSON.parse(text);
      return j.message || "Request failed. Please try again.";
    } catch {
      /* fall through */
    }
  }
  return text;
}

function showAlert(element, message, isSuccess) {
  if (!element || !signupCard) {
    alert(isSuccess ? message : friendlyError(message));
    return;
  }

  element.textContent = isSuccess ? message : friendlyError(message);
  element.classList.add("show");
  element.style.color = isSuccess ? "var(--success, #17803d)" : "";

  if (!isSuccess) {
    signupCard.classList.add("wrong-entry");
    pandaError();
    setTimeout(() => {
      if (signupCard) signupCard.classList.remove("wrong-entry");
    }, 400);
  }

  setTimeout(() => {
    element.classList.remove("show");
    element.style.color = "";
  }, 5000);
}

function validatePassword(password) {
  return password && password.length >= 6;
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[\s\-\(\)]+/g, "");

  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  if (cleaned.startsWith("0") && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }

  if (/^\d{10}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }

  if (/^91\d{10}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  if (/^\d{10,15}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  return cleaned;
}

function getSignupFields() {
  return {
    fullName: document.getElementById("fullName").value.trim(),
    email: document.getElementById("email").value.trim().toLowerCase(),
    phone: normalizePhone(document.getElementById("phone").value.trim())
  };
}

function validateBasicFields() {
  const { fullName, email, phone } = getSignupFields();

  if (fullName.length < 2) {
    showAlert(signupAlert, "Enter your full name.");
    return null;
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    showAlert(signupAlert, "Enter a valid email address.");
    return null;
  }

  if (!/^\+\d{10,15}$/.test(phone)) {
    showAlert(signupAlert, "Enter a valid 10-digit mobile number.");
    return null;
  }

  return { fullName, email, phone };
}

async function ensurePreSignupSession() {
  const fields = validateBasicFields();
  if (!fields) return null;

  if (preSignupSessionId) {
    return { sessionId: preSignupSessionId, ...fields };
  }

  const res = await fetch(`${API_BASE_URL}/auth/pre-signup/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: fields.email, phone: fields.phone })
  });

  const data = await res.json();
  if (!res.ok) {
    showAlert(signupAlert, data.error || "Could not start verification.");
    return null;
  }

  preSignupSessionId = data.session_id;
  emailVerified = !!data.email_verified;
  updateVerificationUi();

  return { sessionId: preSignupSessionId, ...fields };
}

function updateVerificationUi() {
  const emailBox = document.getElementById("emailOtpBox");
  const emailStatus = document.getElementById("emailOtpStatus");

  if (emailVerified) {
    emailBox?.classList.add("otp-verified");
    if (emailStatus) {
      emailStatus.textContent = "Email verified";
      emailStatus.classList.add("verified");
    }
    document.getElementById("sendEmailOtpBtn").disabled = true;
  }

  if (continueVerifyBtn) {
    continueVerifyBtn.disabled = !emailVerified;
  }
}

function setStep(step) {
  document.querySelectorAll(".signup-step").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.step) === step);
  });
  stepDots.forEach((dot) => {
    dot.classList.toggle("active", Number(dot.dataset.stepDot) === step);
  });
}

document.getElementById("sendEmailOtpBtn")?.addEventListener("click", async () => {
  const ctx = await ensurePreSignupSession();
  if (!ctx) return;

  const btn = document.getElementById("sendEmailOtpBtn");
  const box = document.getElementById("emailOtpBox");
  const emailStatus = document.getElementById("emailOtpStatus");
  btn.disabled = true;
  box?.classList.add("otp-sending");

  try {
    const res = await fetch(`${API_BASE_URL}/auth/pre-signup/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: ctx.sessionId, full_name: ctx.fullName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to send email code.");

    document.getElementById("emailOtpRow").hidden = false;
    if (emailStatus) {
      emailStatus.textContent = "Enter the 6-digit code from your email";
    }
    showAlert(signupAlert, data.message || "Check your email inbox for the code.", true);
    pandaWink();
  } catch (e) {
    showAlert(signupAlert, e.message);
    btn.disabled = false;
  } finally {
    box?.classList.remove("otp-sending");
  }
});

document.getElementById("verifyEmailOtpBtn")?.addEventListener("click", async () => {
  if (!preSignupSessionId) {
    showAlert(signupAlert, "Send email code first.");
    return;
  }

  const code = document.getElementById("emailOtp").value.trim();
  if (code.length < 6) {
    showAlert(signupAlert, "Enter the 6-digit email code.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/pre-signup/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: preSignupSessionId, code })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Invalid email code.");

    emailVerified = true;
    updateVerificationUi();
    showAlert(signupAlert, "Email verified!", true);
    pandaHappy();
  } catch (e) {
    showAlert(signupAlert, e.message);
  }
});

if (verifyForm) {
  verifyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!emailVerified) {
      showAlert(signupAlert, "Verify your email before continuing.");
      return;
    }

    const { email } = getSignupFields();
    const summary = document.getElementById("verifiedSummary");
    if (summary) {
      summary.textContent = `${email} is verified. Set your password.`;
    }

    setStep(2);
    pandaHappy();
  });
}

document.getElementById("backToVerifyBtn")?.addEventListener("click", () => {
  setStep(1);
});

function setCreateLoading(isLoading) {
  if (!createAccountBtn) return;

  createAccountBtn.disabled = isLoading;
  createAccountBtn.innerHTML = isLoading
    ? `<span>Creating securely...</span><i class="fa-solid fa-spinner fa-spin"></i>`
    : `<span>Create secure account</span><i class="fa-solid fa-arrow-right"></i>`;
}

if (detailsForm) {
  detailsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    if (!preSignupSessionId || !emailVerified) {
      showAlert(signupAlertStep2, "Complete email verification first.");
      setStep(1);
      return;
    }

    const { fullName, email, phone } = getSignupFields();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const terms = document.getElementById("terms").checked;

    if (!validatePassword(password)) {
      showAlert(signupAlertStep2, "Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      showAlert(signupAlertStep2, "Passwords do not match.");
      return;
    }

    if (!terms) {
      showAlert(signupAlertStep2, "Please accept terms and verification rules.");
      return;
    }

    isSubmitting = true;
    resetPandaEyes();
    pandaWink();

    if (signupCard) signupCard.classList.add("auth-submitting");
    setCreateLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(`${API_BASE_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          session_id: preSignupSessionId,
          full_name: fullName,
          email,
          phone,
          password,
          metadata: {
            onboarding_step: "account_created"
          }
        })
      });

      clearTimeout(timeoutId);

      const rawText = await res.text();
      let data = {};
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        console.error("JSON parse error:", parseErr, "Raw response was:", rawText);
        throw new Error("Invalid response format from server.");
      }

      setCreateLoading(false);
      if (signupCard) signupCard.classList.remove("auth-submitting");

      if (!res.ok) {
        isSubmitting = false;
        showAlert(signupAlertStep2, data.error || "Signup failed. Please try again.");
        return;
      }

      if (window.GKAAuth) {
        GKAAuth.saveSession(data.token, data.user);
      } else {
        safeStorage.setItem("gka_token", data.token);
        safeStorage.setItem("gka_auth_token", data.token);
        safeStorage.setItem("gka_user", JSON.stringify(data.user));
      }

      pandaHappy();

      setTimeout(() => {
        isSubmitting = false;
        if (window.GKAAuth) {
          GKAAuth.redirectAfterAuth(data.user);
        } else {
          window.location.href = "role-select.html";
        }
      }, 650);
    } catch (err) {
      clearTimeout(timeoutId);
      setCreateLoading(false);
      isSubmitting = false;
      if (signupCard) signupCard.classList.remove("auth-submitting");

      let friendlyMessage = err.message || "An unexpected error occurred. Please try again.";
      if (err.name === "AbortError") {
        friendlyMessage = "Signup request timed out. Check your connection and try again.";
      }
      showAlert(signupAlertStep2, friendlyMessage);
    }
  });
}

["email", "phone"].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", () => {
    preSignupSessionId = null;
    emailVerified = false;
    document.getElementById("emailOtpRow").hidden = true;
    document.getElementById("emailOtpBox")?.classList.remove("otp-verified");
    document.getElementById("sendEmailOtpBtn").disabled = false;
    document.getElementById("emailOtpStatus").textContent = "Enter email above, then send code";
    document.getElementById("emailOtpStatus").classList.remove("verified");
    updateVerificationUi();
  });
});

window.addEventListener("load", async () => {
  if (window.GKAAuth) {
    GKAAuth.initGoogleButton("googleSignInBtn", (data) => {
      pandaHappy();
      setTimeout(() => GKAAuth.redirectAfterAuth(data.user), 500);
    }, (msg) => showAlert(signupAlert, msg));
  }

  const token = safeStorage.getItem("gka_token") || safeStorage.getItem("gka_auth_token");
  if (token) {
    const user = JSON.parse(safeStorage.getItem("gka_user") || "null");
    if (user?.needs_verification) {
      window.location.href = "verify-account.html";
    } else if (window.GKAAuth) {
      GKAAuth.redirectAfterAuth(user);
    } else {
      window.location.href = "role-select.html";
    }
  }
});
