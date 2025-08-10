import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function gh(token: string, path: string) {
  const resp = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!resp.ok) throw new Error(`GitHub API error ${resp.status}`);
  return resp.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { token, action, owner, repo } = await req.json();
    if (!token) throw new Error("Missing token");

    if (action === "branches") {
      const branches = await gh(token, `/repos/${owner}/${repo}/branches?per_page=100`);
      const repoInfo = await gh(token, `/repos/${owner}/${repo}`);
      return new Response(JSON.stringify({ branches, default: repoInfo.default_branch }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const repos = await gh(token, "/user/repos?per_page=100&sort=updated");
    return new Response(JSON.stringify({ repos }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
