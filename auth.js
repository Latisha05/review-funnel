(function () {
  const apiBase = "/api/auth";
  const dashboardUrl = "/dashboard";
  const loginUrl = "/login";

  const loginForm = document.getElementById("loginForm");
  const resetForm = document.getElementById("resetPasswordForm");
  const forgotPasswordButton = document.getElementById("forgotPasswordButton");
  const statusElement = document.getElementById("authStatus");

  document.addEventListener("DOMContentLoaded", initialize);

  async function initialize() {
    const urlParams = new URLSearchParams(window.location.search);
    const client = urlParams.get("client") || urlParams.get("business") || "";
    if (client) {
      await applyDynamicBranding(client);
    }

    if (loginForm) {
      loginForm.addEventListener("submit", handleLogin);
      if (forgotPasswordButton) forgotPasswordButton.addEventListener("click", handleForgotPassword);
      // Note: we intentionally do NOT auto-redirect already-authenticated visitors to
      // /dashboard here. Combined with the dashboard's "no session -> /login" guard it
      // could create a redirect loop on the deployed domain. The login page always opens;
      // after a successful sign-in the form handler navigates to /dashboard.
    }

    if (resetForm) {
      resetForm.addEventListener("submit", handleResetPassword);
    }
  }

  async function applyDynamicBranding(client) {
    try {
      const response = await fetch(`/api/config?business=${encodeURIComponent(client)}`);
      if (!response.ok) return;
      const config = await response.json();
      if (config.businessName) {
        document.title = `${config.businessName} Client Login`;
        const titleEl = document.querySelector(".auth-brand h1");
        if (titleEl) titleEl.textContent = `${config.businessName} Dashboard`;
        const eyebrowEl = document.querySelector(".auth-eyebrow");
        if (eyebrowEl) eyebrowEl.textContent = `${config.businessName} Client Panel`;
        const logoEl = document.querySelector(".auth-logo");
        if (logoEl && config.logoUrl) {
          logoEl.src = config.logoUrl;
          logoEl.alt = `${config.businessName} logo`;
        }
      }
    } catch (error) {
      // Ignore branding load failures
    }
  }

  async function redirectIfAuthenticated() {
    try {
      const response = await fetch(`${apiBase}/session`, { credentials: "same-origin" });
      if (!response.ok) return;
      const data = await response.json();
      if (data.authenticated) {
        window.location.replace(dashboardUrl);
      }
    } catch {
      // Ignore session lookup failures here.
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    setStatus("Signing in...");

    const payload = {
      email: document.getElementById("emailInput").value.trim(),
      password: document.getElementById("passwordInput").value,
    };

    try {
      const response = await fetch(`${apiBase}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not sign in.");
      window.location.replace(dashboardUrl);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function handleForgotPassword() {
    const email = document.getElementById("emailInput").value.trim();
    if (!email) {
      setStatus("Enter your email address first.", true);
      return;
    }

    setStatus("Preparing reset email...");

    try {
      const response = await fetch(`${apiBase}/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start password reset.");
      if (data.debugResetUrl) {
        setStatus(`Reset link ready for local testing: ${data.debugResetUrl}`);
        return;
      }
      setStatus("Password reset instructions have been sent.");
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function handleResetPassword(event) {
    event.preventDefault();

    const token = new URLSearchParams(window.location.search).get("token");
    const password = document.getElementById("newPasswordInput").value;
    const confirmPassword = document.getElementById("confirmPasswordInput").value;

    if (!token) {
      setStatus("Reset link is missing or invalid.", true);
      return;
    }

    if (!password || password.length < 8) {
      setStatus("Use at least 8 characters for the new password.", true);
      return;
    }

    if (password !== confirmPassword) {
      setStatus("Passwords do not match.", true);
      return;
    }

    setStatus("Updating password...");

    try {
      const response = await fetch(`${apiBase}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not reset password.");
      setStatus("Password updated. Redirecting to login...");
      window.setTimeout(() => {
        window.location.replace(loginUrl);
      }, 1200);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function setStatus(message, isError) {
    if (!statusElement) return;
    statusElement.textContent = message || "";
    statusElement.classList.toggle("is-error", Boolean(isError));
  }
})();
