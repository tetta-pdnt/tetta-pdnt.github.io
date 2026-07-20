import { loadSiteData } from "../../lib/site-data.js";

export async function GET() {
  const { categories } = await loadSiteData();
  return new Response(JSON.stringify({ categories }, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
