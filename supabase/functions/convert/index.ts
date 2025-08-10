import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY");

async function gh(token: string, path: string) {
  const resp = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!resp.ok) throw new Error(`GitHub API error ${resp.status}`);
  return resp.json();
}

function isCodeFile(path: string) {
  return /\.(ts|tsx|js|jsx|py|cs|java|go|rs|php|rb|kt|scala|sql|sh|yml|yaml|json)$/i.test(path);
}

async function fetchFiles(token: string, owner: string, repo: string, branch: string) {
  const branchInfo = await gh(token, `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
  const sha = branchInfo?.commit?.sha;
  const tree = await gh(token, `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  const files = (tree.tree || []).filter((n: any) => n.type === "blob" && isCodeFile(n.path)).slice(0, 50);

  const results: { path: string; content: string }[] = [];
  for (const f of files) {
    const contentResp = await gh(token, `/repos/${owner}/${repo}/contents/${encodeURIComponent(f.path)}?ref=${encodeURIComponent(branch)}`);
    const decoded = atob(contentResp.content.replace(/\n/g, ""));
    results.push({ path: f.path, content: decoded });
  }
  return results;
}

async function convertBatch(batch: { path: string; content: string }[], target: any) {
  if (!OPENROUTER_KEY) throw new Error("Missing OPENROUTER_API_KEY");
  const sys = `You are a senior software engineer that converts codebases between stacks. Convert each file to the target stack preserving functionality and folder structure. Return ONLY strict JSON with an array named files, each item {path, content}. Target: ${JSON.stringify(target)}.`;
  const user = batch.map((b) => ({ role: "user", content: `FILE PATH: ${b.path}\nCONTENT:\n\n${b.content}` }));

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://staxchange.ai",
      "X-Title": "StaxChange AI Converter",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        ...user,
      ],
      temperature: 0.2,
    }),
  });
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content || "";
  const jsonMatch = text.match(/\{[\s\S]*\}$/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { files: [] };
  return parsed.files as { path: string; content: string }[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { token, owner, repo, branch, target } = await req.json();
    if (!token || !owner || !repo || !branch) throw new Error("Missing required fields");

    const originals = await fetchFiles(token, owner, repo, branch);

    const batches: { path: string; content: string }[][] = [];
    const sizeLimit = 80_000; // ~80KB per batch
    let cur: { path: string; content: string }[] = [];
    let curSize = 0;
    for (const f of originals) {
      const len = f.content.length;
      if (curSize + len > sizeLimit && cur.length) {
        batches.push(cur);
        cur = [];
        curSize = 0;
      }
      cur.push(f);
      curSize += len;
    }
    if (cur.length) batches.push(cur);

    const converted: { path: string; content: string }[] = [];
    for (const b of batches) {
      try {
        const out = await convertBatch(b, target);
        if (Array.isArray(out)) converted.push(...out);
      } catch (_) {
        // Fallback: keep originals when conversion fails
        converted.push(...b);
      }
    }

    return new Response(JSON.stringify({ files: converted }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
