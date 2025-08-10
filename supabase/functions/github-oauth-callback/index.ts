import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);

  try {
    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state") || "";
    const state = JSON.parse(atob(stateRaw || "e30="));

    if (!code) throw new Error("Missing code");

    const clientId = Deno.env.get("GITHUB_CLIENT_ID");
    const clientSecret = Deno.env.get("GITHUB_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("Missing GitHub OAuth secrets");

    const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: `${url.origin}/functions/v1/github-oauth-callback` }),
    });

    const tokenJson = await tokenResp.json();
    if (!tokenResp.ok || tokenJson.error) throw new Error(tokenJson.error_description || "Failed to exchange code");

    const returnTo = state?.return_to || "/";
    const redirect = `${returnTo}#github_token=${encodeURIComponent(tokenJson.access_token)}`;
    return Response.redirect(redirect, 302);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
