(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const mode = document.body.dataset.authMode;
  const form = $("authForm");
  const message = $("authMessage");

  function setMessage(text, isError = false) {
    message.textContent = text || "";
    message.classList.toggle("error", Boolean(isError));
    message.classList.toggle("auth-success", Boolean(text) && !isError);
    message.hidden = !text;
  }

  function configured() {
    if (window.FinanceSupabaseConfig?.configured && window.financeSupabase) return true;
    setMessage("Supabase is not configured yet. Add your Project URL and publishable key to supabase-config.js.", true);
    form.querySelector("button[type=submit]").disabled = true;
    return false;
  }

  function requestedDestination() {
    const requested = new URLSearchParams(location.search).get("returnTo") || "console.html";
    return /^[a-z0-9_.-]+(?:\?.*)?$/i.test(requested) ? requested : "console.html";
  }

  async function init() {
    if (!configured()) return;

    const { data } = await window.financeSupabase.auth.getSession();
    if (data.session?.user) {
      location.replace(requestedDestination());
      return;
    }

  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!configured()) return;

    const submit = form.querySelector("button[type=submit]");
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    submit.disabled = true;
    setMessage("");

    try {
      if (mode === "signup") {
        const displayName = $("displayName")?.value.trim() || "";
        const redirectUrl = new URL("login.html", location.href).href;
        const { data, error } = await window.financeSupabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName, username: displayName },
            emailRedirectTo: redirectUrl
          }
        });
        if (error) throw error;
        if (data.session) {
          location.replace("index.html");
        } else {
          setMessage("Account created. Check your email to confirm your address, then sign in.");
          form.reset();
        }
      } else {
        const { error } = await window.financeSupabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        location.replace(requestedDestination());
      }
    } catch (error) {
      setMessage(error?.message || "Authentication failed.", true);
    } finally {
      submit.disabled = false;
    }
  });

  init();
})();
