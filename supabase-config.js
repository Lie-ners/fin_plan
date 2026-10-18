(() => {
  "use strict";

  // Replace these two values with the Project URL and Publishable key from
  // Supabase Dashboard -> Connect (or Settings -> API Keys).
  const SUPABASE_URL = "https://ghcwnjtbapmaikyvnftn.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_CP6byBAoisUigcaHX6R08w_ipHwiNuB";

  const configured =
    /^https:\/\/.+\.supabase\.co$/i.test(SUPABASE_URL) &&
    SUPABASE_PUBLISHABLE_KEY &&
    !SUPABASE_PUBLISHABLE_KEY.startsWith("YOUR_");

  window.FinanceSupabaseConfig = {
    url: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
    configured
  };

  if (!configured) {
    console.warn("Supabase is not configured yet. Update supabase-config.js with your project URL and publishable key.");
    return;
  }

  if (!window.supabase?.createClient) {
    console.error("Supabase client library was not loaded.");
    return;
  }

  window.financeSupabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
})();
