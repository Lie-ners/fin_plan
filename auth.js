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

  async function usernameAvailable(username) {
    const clean = String(username || "").trim();
    if (clean.length < 2 || clean.length > 40) return false;
    const { data, error } = await window.financeSupabase.rpc("username_available", { candidate: clean });
    if (error) throw error;
    return data === true;
  }

  async function init() {
    if (!configured()) return;

    if (new URLSearchParams(location.search).get("accountDeleted") === "1") {
      setMessage("Your account and saved finance data have been deleted.");
    }

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
    const password = $("authPassword").value;
    const email = $("authEmail")?.value.trim() || "";
    const username = $("authUsername")?.value.trim() || "";
    submit.disabled = true;
    setMessage("");

    try {
      if (mode === "signup") {
        const displayName = $("displayName")?.value.trim() || "";
        if (displayName.length < 2 || displayName.length > 40) {
          throw new Error("Username must be between 2 and 40 characters.");
        }

        const available = await usernameAvailable(displayName);
        if (!available) {
          throw new Error("That username is already in use. Choose another username.");
        }

        const redirectUrl = new URL("index.html", location.href).href;
        const { data, error } = await window.financeSupabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName, username: displayName },
            emailRedirectTo: redirectUrl
          }
        });
        if (error) {
          // A second availability check turns the database's race-safe unique
          // constraint into a useful message if another signup claimed the name
          // between our first check and the Auth insert.
          try {
            if (!(await usernameAvailable(displayName))) {
              throw new Error("That username is already in use. Choose another username.");
            }
          } catch (availabilityError) {
            if (/already in use/i.test(availabilityError?.message || "")) throw availabilityError;
          }
          throw error;
        }
        if (data.session) {
          location.replace("import.html");
        } else {
          setMessage("Account created. Check your email to confirm your address, then sign in.");
          form.reset();
        }
      } else {
        const { data, error } = await window.financeSupabase.functions.invoke(
          "username-login",
          {
            body: {
              username,
              password
            }
          }
        );

        if (error) {
          throw new Error("Invalid username or password.");
        }

        if (!data?.access_token || !data?.refresh_token) {
          throw new Error(data?.error || "Invalid username or password.");
        }

        const { error: sessionError } =
          await window.financeSupabase.auth.setSession({
            access_token: data.access_token,
            refresh_token: data.refresh_token
          });

        if (sessionError) throw sessionError;

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
