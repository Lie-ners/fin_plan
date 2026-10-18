import { withSupabase } from "npm:@supabase/server@1";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    let payload: { confirmation?: string } = {};
    try {
      payload = await req.json();
    } catch (_) {}

    if (String(payload.confirmation || "").toUpperCase() !== "DELETE") {
      return Response.json({ error: "Deletion confirmation is required." }, { status: 400 });
    }

    const { data: userData, error: userError } = await ctx.supabase.auth.getUser();
    if (userError || !userData.user) {
      return Response.json({ error: "Your session is invalid or expired. Sign in again and retry." }, { status: 401 });
    }

    const { error: deleteError } = await ctx.supabaseAdmin.auth.admin.deleteUser(userData.user.id);
    if (deleteError) {
      console.error("delete-account:", deleteError);
      return Response.json({ error: "Could not delete the account." }, { status: 500 });
    }

    return Response.json({ deleted: true });
  })
};
