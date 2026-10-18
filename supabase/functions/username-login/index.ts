import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { username, password } = await req.json();

    const cleanUsername = String(username || "").trim();
    const cleanPassword = String(password || "");

    if (!cleanUsername || !cleanPassword) {
      return Response.json(
        { error: "Invalid username or password." },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("user_id")
      .ilike("username", cleanUsername)
      .maybeSingle();

    if (profileError || !profile) {
      return Response.json(
        { error: "Invalid username or password." },
        { status: 401, headers: corsHeaders }
      );
    }

    const { data: userData, error: userError } =
      await admin.auth.admin.getUserById(profile.user_id);

    const email = userData?.user?.email;

    if (userError || !email) {
      return Response.json(
        { error: "Invalid username or password." },
        { status: 401, headers: corsHeaders }
      );
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } =
      await authClient.auth.signInWithPassword({
        email,
        password: cleanPassword,
      });

    if (error || !data.session) {
      return Response.json(
        { error: "Invalid username or password." },
        { status: 401, headers: corsHeaders }
      );
    }

    return Response.json(
      {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
      { headers: corsHeaders }
    );
  } catch {
    return Response.json(
      { error: "Invalid username or password." },
      { status: 400, headers: corsHeaders }
    );
  }
});