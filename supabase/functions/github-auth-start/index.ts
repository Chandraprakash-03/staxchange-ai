import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const clientId = Deno.env.get("GITHUB_CLIENT_ID");
    if (!clientId) throw new Error("Missing GITHUB_CLIENT_ID secret");

    const returnTo = url.searchParams.get("return_to") ?? "";

    const isFunctionsSubdomain = url.hostname.endsWith(".functions.supabase.co");
    const redirectUri = isFunctionsSubdomain
      ? `${url.origin}/github-oauth-callback`
      : `${url.origin}/functions/v1/github-oauth-callback`;
    const state = btoa(JSON.stringify({ return_to: returnTo }));

    const ghUrl = new URL("https://github.com/login/oauth/authorize");
    ghUrl.searchParams.set("client_id", clientId);
    ghUrl.searchParams.set("redirect_uri", redirectUri);
    ghUrl.searchParams.set("scope", "repo");
    ghUrl.searchParams.set("state", state);

    console.log('github-auth-start redirect', { request_origin: url.origin, request_hostname: url.hostname, redirect_uri: redirectUri, gh_url: ghUrl.toString() });
    return Response.redirect(ghUrl.toString(), 302);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
