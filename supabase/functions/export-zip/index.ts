import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { ZipFile } from "https://deno.land/x/zipjs@v2.7.52/index.deno.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { files } = await req.json();
    if (!Array.isArray(files)) throw new Error("No files provided");

    const zip = new ZipFile();
    for (const f of files as { path: string; content: string }[]) {
      const path = (f.path || "file.txt").replace(/^\/+/, "");
      const data = new TextEncoder().encode(f.content || "");
      await zip.addBlob(path, new Blob([data], { type: "text/plain" }));
    }
    const blob = await zip.generate({ type: "blob" });
    const arrayBuffer = await blob.arrayBuffer();

    return new Response(new Uint8Array(arrayBuffer), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=converted.zip",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
