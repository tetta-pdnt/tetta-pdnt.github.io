import { loadSiteData } from "../../lib/site-data.js";

export async function GET() {
  const { updatedAt, items, musicAlbums } = await loadSiteData();
  return new Response(JSON.stringify({ updatedAt, items, musicAlbums }, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
