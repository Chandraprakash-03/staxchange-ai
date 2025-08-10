import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { files } = await req.json();
    if (!Array.isArray(files)) throw new Error("No files provided");

    const zip = new JSZip();
    for (const f of files as { path: string; content: string }[]) {
      const path = (f.path || "file.txt").replace(/^\/+/, "");
      zip.file(path, f.content || "");
    }

    const uint8 = await zip.generateAsync({ type: "uint8array" });

    return new Response(uint8, {
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
