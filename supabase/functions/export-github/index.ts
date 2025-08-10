import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function gh(token: string, path: string, init?: RequestInit) {
  const resp = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!resp.ok) throw new Error(`GitHub API error ${resp.status}`);
  return resp.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { token, repoName, files } = await req.json();
    if (!token || !repoName || !files) throw new Error("Missing fields");

    const created = await gh(token, "/user/repos", {
      method: "POST",
      body: JSON.stringify({ name: repoName, private: false, auto_init: true }),
    });

    for (const f of files as { path: string; content: string }[]) {
      const path = f.path.replace(/^\/+/, "");
      const content = btoa(unescape(encodeURIComponent(f.content)));
      await gh(token, `/repos/${created.owner.login}/${created.name}/contents/${encodeURIComponent(path)}`,
        { method: "PUT", body: JSON.stringify({ message: `add ${path}`, content }) });
    }

    return new Response(JSON.stringify({ html_url: created.html_url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
