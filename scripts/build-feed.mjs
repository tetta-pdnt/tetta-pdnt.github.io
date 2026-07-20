import { appendFile, readdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { categoryPathForTags } from "../src/lib/category-path.js";

const PROJECT_ROOT = pathToFileURL(`${path.resolve(process.cwd())}${path.sep}`);
const FEED_CONFIG = new URL("feeds.json", PROJECT_ROOT);
const MANUAL_ITEMS = new URL("manual-items.json", PROJECT_ROOT);
const EXTERNAL_CONFIG = new URL("external.config.json", PROJECT_ROOT);
const TYPOGRAPHY_MANIFEST = new URL("content/typography.yaml", PROJECT_ROOT);
const MUSIC_MANIFEST = new URL("content/music.yaml", PROJECT_ROOT);
const VIDEO_MANIFEST = new URL("content/video.yaml", PROJECT_ROOT);
const CATEGORY_CONFIG = new URL("content/categories.yaml", PROJECT_ROOT);
const MAX_ITEMS_PER_FEED = 12;
const IGNORED_CONTENT_DIRECTORIES = new Set(["node_modules"]);
const assignMissingIds = process.argv.includes("--assign-missing-ids");

const entityMap = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " "
};

function decodeEntities(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, key) => entityMap[key] ?? `&${key};`)
    .trim();
}

function stripHtml(value = "") {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function firstTag(block, names) {
  for (const name of names) {
    const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
    const match = block.match(pattern);
    if (match) return decodeEntities(match[1]);
  }
  return "";
}

function attrTag(block, name, attr) {
  const pattern = new RegExp("<" + name + "[^>]*\\s" + attr + "=[\"\']([^\"\']+)[\"\'][^>]*>", "i");
  return decodeEntities(block.match(pattern)?.[1] ?? "");
}

function tagWithAttr(block, name, attr, valuePattern) {
  const pattern = new RegExp("<" + name + "[^>]*\\s" + attr + "=[\"\']" + valuePattern + "[\"\'][^>]*>", "i");
  return block.match(pattern)?.[0] ?? "";
}

function imageEnclosure(block) {
  const enclosure = tagWithAttr(block, "enclosure", "type", "image/[^\"']+");
  return enclosure ? attrTag(enclosure, "enclosure", "url") : "";
}

function firstImage(block) {
  const html = firstTag(block, ["description", "summary", "content:encoded", "content"]);

  return attrTag(block, "itunes:image", "href")
    || attrTag(block, "media:thumbnail", "url")
    || firstTag(block, ["media:thumbnail"])
    || attrTag(tagWithAttr(block, "media:content", "type", "image/[^\"']+"), "media:content", "url")
    || imageEnclosure(block)
    || attrTag(html, "img", "src")
    || "";
}

function blocksFor(xml) {
  const itemBlocks = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  if (itemBlocks.length) return itemBlocks;
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((m) => m[1]);
}

function normalizeDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toISOString() : null;
}

function pageId(value, context) {
  const id = String(value ?? "").toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error(`${context} needs a UUID-format id.`);
  }
  return id;
}

const legacyTagKeys = {
  "映像": "video",
  "タイポグラフィー": "typography",
  "音楽": "music",
  "散文": "prose",
  "日記": "prose",
  "小説": "novel",
  "開発": "dev"
};

function normalizeTags(tags = []) {
  return [...new Set(tags.map((tag) => legacyTagKeys[tag] ?? tag))];
}

function parseYamlValue(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") return "";
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).split(",").map((part) => parseYamlValue(part)).filter(Boolean);
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseYamlManifest(text, section = "items") {
  const items = [];
  let current;
  let inSection = false;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^[A-Za-z][A-Za-z0-9_-]*:\s*$/.test(line)) {
      inSection = line.trim() === `${section}:`;
      current = undefined;
      continue;
    }
    if (!inSection) continue;
    const entry = line.match(/^\s*-\s+([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/)
      ?? line.match(/^\s+([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!entry) continue;

    if (line.match(/^\s*-\s+/)) {
      current = {};
      items.push(current);
    }
    if (current) current[entry[1]] = parseYamlValue(entry[2]);
  }

  return items;
}

async function assignMissingYamlIds(manifestUrl) {
  const text = await readFile(manifestUrl, "utf8");
  const lines = text.split(/\r?\n/);
  let changed = false;
  let inItems = false;
  let itemStart = -1;
  let idLine = -1;
  const additions = [];

  const finishItem = (end) => {
    if (itemStart < 0) return;
    if (idLine < 0) {
      additions.push({ end, line: `    id: ${randomUUID()}` });
    }
    itemStart = -1;
    idLine = -1;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9_-]*:\s*$/.test(line)) {
      finishItem(index);
      inItems = line.trim() === "items:";
      continue;
    }
    if (!inItems) continue;

    if (/^\s*-\s+/.test(line)) {
      finishItem(index);
      itemStart = index;
      continue;
    }

    const id = line.match(/^(\s*id:\s*)(.*)$/);
    if (itemStart >= 0 && id) {
      idLine = index;
      if (!id[2].trim()) {
        lines[index] = `${id[1]}${randomUUID()}`;
        changed = true;
      }
    }
  }
  finishItem(lines.length);

  for (const addition of additions.sort((left, right) => right.end - left.end)) {
    lines.splice(addition.end, 0, addition.line);
    changed = true;
  }

  if (changed) {
    await writeFile(manifestUrl, `${lines.join("\n").replace(/\n*$/, "")}\n`);
    console.log(`Assigned missing ids in ${path.basename(manifestUrl.pathname)}.`);
  }
}

function parseCategoryConfig(text) {
  const categories = [];
  let current;
  let inCategories = false;
  let rootIndent;

  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#") || !line.trim()) continue;
    if (line.trim() === "categories:") {
      inCategories = true;
      continue;
    }
    if (!inCategories) continue;

    const entry = line.match(/^(\s*)-\s+(.+?)\s*$/);
    if (!entry) continue;

    const indent = entry[1].length;
    const value = entry[2];
    if (rootIndent === undefined) rootIndent = indent;

    if (indent === rootIndent) {
      const parent = value.match(/^([A-Za-z][A-Za-z0-9_-]*):$/);
      current = parent
        ? { key: parent[1], children: [] }
        : { key: parseYamlValue(value) };
      categories.push(current);
      continue;
    }

    if (indent > rootIndent && current?.children) {
      current.children.push(parseYamlValue(value));
    }
  }

  return categories.map((category) =>
    category.children?.length ? category : { key: category.key }
  );
}

async function readCategories() {
  const categories = parseCategoryConfig(await readFile(CATEGORY_CONFIG, "utf8"));
  if (!categories.length || categories.some((category) => !category.key)) {
    throw new Error("content/categories.yaml must define at least one category key.");
  }
  return categories;
}

async function typographyImagePath(image) {
  if (/^(?:\/|https?:\/\/)/.test(image)) return image;

  const directory = new URL("public/img/typography/", PROJECT_ROOT);
  const files = await readdir(directory);
  const filename = files.find((file) => file.normalize("NFC") === image.normalize("NFC")) ?? image;
  return `/img/typography/${filename}`;
}

async function readTypographyItems() {
  let manifest;
  try {
    manifest = await readFile(TYPOGRAPHY_MANIFEST, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { items: [], pages: [] };
    throw error;
  }

  const entries = parseYamlManifest(manifest);
  const items = [];
  const pages = [];

  for (const entry of entries) {
    if (!entry.image) {
      throw new Error("Each entry in content/typography.yaml needs image.");
    }

    const entryId = pageId(entry.id, `Typography entry ${entry.title ?? entry.image}`);
    const title = entry.title || entryId;
    const publishedAt = normalizeDate(entry.date);
    const slug = `typography/${entryId}`;
    const url = pageUrlForSlug(slug);
    const tags = ["typography"];
    const image = await typographyImagePath(entry.image);

    items.push({
      id: entryId,
      title,
      url,
      publishedAt,
      summary: entry.summary || "",
      image,
      source: "typography",
      type: "image",
      tags,
      local: true
    });
    pages.push({
      id: entryId,
      slug,
      title,
      body: entry.summary || "",
      image,
      imageAlt: entry.alt || "",
      source: "typography",
      publishedAt,
      tags,
      file: `content/typography.yaml#${entryId}`
    });
  }

  return { items, pages };
}

async function readMusicItems() {
  const manifest = await readFile(MUSIC_MANIFEST, "utf8");
  const entries = parseYamlManifest(manifest);
  const configuredAlbums = parseYamlManifest(manifest, "albums").map((entry) => {
    if (!entry.path) throw new Error("Each music album needs a path.");
    const path = albumSlug(entry.path);
    return {
      path,
      title: entry.title || entry.path,
      image: entry.image || "",
      link: entry.link || entry.url || "",
      summary: entry.summary || "",
      publishedAt: normalizeDate(entry.date),
      sc: entry.sc || ""
    };
  });
  const albumByPath = new Map(configuredAlbums.map((album) => [album.path, album]));
  const albumByTitle = new Map(configuredAlbums.map((album) => [album.title, album]));
  const items = entries.map((entry) => {
    if (!entry.title || !entry.url || !entry.id) {
      throw new Error("Each entry in content/music.yaml needs id, title and url.");
    }
    const id = pageId(entry.id, `Music entry ${entry.title}`);
    const configuredAlbum = entry.album
      ? albumByPath.get(albumSlug(entry.album)) || albumByTitle.get(entry.album)
      : undefined;
    const album = configuredAlbum?.path || (entry.album ? albumSlug(entry.album) : "");
    const albumMeta = configuredAlbum || albumByPath.get(album);

    return {
      id,
      title: entry.title,
      url: `/music/${album ? encodeURIComponent(album) + "/" : ""}${id}/`,
      sourceUrl: entry.url,
      publishedAt: normalizeDate(entry.date),
      summary: entry.summary || "",
      image: entry.image || "",
      source: "SoundCloud",
      type: "music",
      tags: ["music"],
      album,
      albumTitle: albumMeta?.title || entry.album || "",
      albumImage: albumMeta?.image || "",
      albumLink: albumMeta?.link || "",
      albumSummary: albumMeta?.summary || "",
      local: true
    };
  });
  const albums = [...configuredAlbums];
  for (const item of items) {
    if (item.album && !albumByPath.has(item.album)) {
      albums.push({ path: item.album, title: item.albumTitle, image: "", link: "", summary: "", publishedAt: null, sc: "" });
    }
  }
  return { entries, items, albums };
}

async function readVideoItems() {
  const entries = parseYamlManifest(await readFile(VIDEO_MANIFEST, "utf8"));
  const items = entries.map((entry) => {
    if (!entry.title || !entry.url || !entry.id) {
      throw new Error("Each entry in content/video.yaml needs id, title and url.");
    }
    const id = pageId(entry.id, `Video entry ${entry.title}`);
    const tags = normalizeTags(Array.isArray(entry.tags)
      ? entry.tags
      : entry.tags ? String(entry.tags).split(",").map((tag) => tag.trim()) : ["video"]);
    return {
      id,
      title: entry.title,
      url: `/video/${id}/`,
      sourceUrl: entry.url,
      publishedAt: normalizeDate(entry.date),
      summary: entry.summary || "",
      image: entry.image || "",
      source: "YouTube",
      type: "video",
      tags,
      local: true
    };
  });
  return { entries, items };
}

function yamlString(value) {
  return JSON.stringify(value);
}

async function syncManifest(manifestUrl, entries, rssItems, label) {
  const knownUrls = new Set(entries.map((entry) => entry.url));
  const missing = rssItems.filter((item) => !knownUrls.has(item.url));
  if (!missing.length) return;

  const additions = missing.map((item) => {
    const lines = [
      `  - title: ${yamlString(item.title)}`,
      `    id: ${randomUUID()}`,
      `    date: ${item.publishedAt?.slice(0, 10) ?? ""}`,
      `    url: ${yamlString(item.url)}`
    ];
    if (item.image) lines.push(`    image: ${yamlString(item.image)}`);
    if (item.summary) lines.push(`    summary: ${yamlString(item.summary)}`);
    return lines.join("\n");
  });

  await appendFile(manifestUrl, `\n${additions.join("\n")}\n`);
  console.log(`Added ${missing.length} ${label} item(s).`);
}

function parseFeed(xml, feed) {
  return blocksFor(xml).slice(0, MAX_ITEMS_PER_FEED).map((block) => {
    const link = firstTag(block, ["link"]) || attrTag(block, "link", "href");
    const description = firstTag(block, ["description", "summary", "content:encoded", "content"]);
    return {
      title: stripHtml(firstTag(block, ["title"])) || "Untitled",
      url: link,
      publishedAt: normalizeDate(firstTag(block, ["pubDate", "published", "updated", "dc:date"])),
      summary: stripHtml(description).slice(0, 220),
      image: firstImage(block),
      source: feed.title,
      type: feed.type,
      tags: normalizeTags(feed.tags ?? [])
    };
  }).filter((item) => item.url);
}

async function resolveFeedUrl(feed) {
  const url = new URL(feed.url);
  const channelId = url.searchParams.get("channel_id");

  if (url.hostname.includes("youtube.com") && channelId?.startsWith("@")) {
    const channelPage = await fetch(`https://www.youtube.com/${channelId}`, {
      headers: {
        "user-agent": "tetta-pdnt.github.io feed builder"
      }
    });

    if (!channelPage.ok) {
      throw new Error(`${feed.title}: could not resolve YouTube handle ${channelId}`);
    }

    const html = await channelPage.text();
    const resolved = html.match(/"externalId"\s*:\s*"(UC[^"]+)"/)?.[1]
      ?? html.match(/"browseId"\s*:\s*"(UC[^"]+)"/)?.[1]
      ?? html.match(/"channelId"\s*:\s*"(UC[^"]+)"/)?.[1]
      ?? html.match(/<meta itemprop="channelId" content="(UC[^"]+)">/)?.[1];

    if (!resolved) {
      throw new Error(`${feed.title}: YouTube channel ID not found for ${channelId}`);
    }

    url.searchParams.set("channel_id", resolved);
    return url.toString();
  }

  return feed.url;
}

async function readTextFile(fileUrl) {
  const buffer = await readFile(fileUrl);
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1];
      swapped[index - 1] = buffer[index];
    }
    return swapped.toString("utf16le");
  }
  return buffer.toString("utf8");
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: text };

  const data = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    const value = pair[2].trim();
    if (!value) {
      const values = [];
      while (lines[index + 1]?.match(/^\s+-\s+/)) {
        index += 1;
        values.push(lines[index].replace(/^\s+-\s+/, "").trim().replace(/^[\'"]|[\'"]$/g, ""));
      }
      data[pair[1]] = values;
    } else {
      data[pair[1]] = value.replace(/^[\'"]|[\'"]$/g, "");
    }
  }

  return { data, body: text.slice(match[0].length) };
}

function titleFromContent(body, filePath) {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim()
    || path.basename(filePath, path.extname(filePath)).replace(/[-_]+/g, " ");
}

function dateFromPath(filePath) {
  return filePath.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

function trimOuterBlankLines(body) {
  const lines = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}

function indentFirstJapaneseLine(body) {
  const lines = body.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim());
  if (index === -1) return body;
  if (!/^[　\s]/.test(lines[index]) && !/^(#{1,6}\s|[-*+]\s|\d+\.\s|>|`{3}|---)/.test(lines[index])) {
    lines[index] = "　" + lines[index];
  }
  return lines.join("\n");
}
function summaryFromMarkdown(body) {
  const summary = stripHtml(body
    .replace(/^#.*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .trim());
  return summary.length > 220 ? `${summary.slice(0, 220)}…` : summary;
}

function imageFromMarkdown(body) {
  const image = body.match(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/)?.[1]
    ?? body.match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+[\'"][^\'"]*[\'"])?\)/)?.[1]
    ?? "";
  return publicImagePath(image);
}

function publicImagePath(value, basePath = "") {
  if (!value || /^(https?:|data:|\/)/i.test(value)) return value;
  const imgPath = value.replace(/^(?:\.\/|public\/)?img\//, "");
  if (imgPath !== value) return `/img/${imgPath}`;
  if (basePath) return `${basePath.replace(/\/[^/]*$/, "/")}${value}`;
  return `/img/${value}`;
}

async function walkFiles(rootUrl, relativeDir = "") {
  let entries = [];
  try {
    entries = await readdir(new URL(relativeDir ? `${relativeDir}/` : "./", rootUrl), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory() && IGNORED_CONTENT_DIRECTORIES.has(entry.name)) continue;
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(rootUrl, relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

function slugPart(value) {
  return value
    .replace(/\.[^.]+$/, "")
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[?#%]+/g, "-");
}

function albumSlug(value) {
  return slugPart(value)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function pageUrlForSlug(slug) {
  return "/" + slug.split("/").map(encodeURIComponent).join("/") + "/";
}

function externalPageSlug(source, tags, id, categories) {
  const categoryPath = categoryPathForTags(categories, tags);
  if (categoryPath.length) return [...categoryPath, id].join("/");
  return `items/${slugPart(source)}/${id}`;
}

async function readExternalConfig() {
  try {
    return JSON.parse(await readFile(EXTERNAL_CONFIG, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        path: "external",
        tags: ["novel"],
        extensions: [".md", ".mdx", ".txt", ".phile"]
      };
    }
    throw error;
  }
}

async function externalRoots(config) {
  const externalRoot = new URL((config.path ?? "external") + "/", PROJECT_ROOT);
  let entries = [];
  try {
    entries = await readdir(externalRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({ name: entry.name, rootUrl: new URL(entry.name + "/", externalRoot) }));
}

async function assignMissingExternalMetadata() {
  const config = await readExternalConfig();
  const extensions = new Set(config.extensions ?? [".md", ".mdx", ".txt", ".phile"]);
  const excluded = new Set(config.exclude ?? []);

  for (const root of await externalRoots(config)) {
    const rootConfig = config.sources?.[root.name] ?? {};
    const included = rootConfig.include ? new Set(rootConfig.include) : null;
    const files = (await walkFiles(root.rootUrl))
      .filter((file) => extensions.has(path.extname(file).toLowerCase()))
      .filter((file) => !excluded.has(path.basename(file)))
      .filter((file) => !included || included.has(file));

    for (const file of files) {
      const fileUrl = new URL(file, root.rootUrl);
      const text = await readTextFile(fileUrl);
      const { data, body } = parseFrontmatter(text);
      const newline = text.includes("\r\n") ? "\r\n" : "\n";
      const frontmatter = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/);
      const metadata = frontmatter?.[2] ?? "";
      const existingIds = [...metadata.matchAll(/^id:\s*(.+?)\s*$/gm)]
        .map((match) => match[1])
        .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
      const id = existingIds[0] ?? randomUUID();
      const title = String(data.title ?? "").trim() || titleFromContent(body, file);
      const metadataLines = metadata
        .split(/\r?\n/)
        .filter((line) => !/^id:\s*/.test(line))
        .filter((line) => !/^title:\s*/.test(line));
      const nextMetadata = [`id: ${id}`, `title: ${yamlString(title)}`, ...metadataLines]
        .filter((line, index, lines) => line || index < lines.length - 1)
        .join(newline);
      const next = frontmatter
        ? `${frontmatter[1]}${nextMetadata}${frontmatter[3]}${text.slice(frontmatter[0].length)}`
        : `---${newline}${nextMetadata}${newline}---${newline}${newline}${text}`;
      if (next === text) continue;
      await writeFile(fileUrl, next);
      console.log(`Assigned missing metadata in ${root.name}/${file}.`);
    }
  }
}

async function assignMissingManualItemIds() {
  try {
    const payload = JSON.parse(await readFile(MANUAL_ITEMS, "utf8"));
    let changed = false;
    for (const item of payload.items ?? []) {
      if (!String(item.id ?? "").trim()) {
        item.id = randomUUID();
        changed = true;
      }
    }
    if (changed) {
      await writeFile(MANUAL_ITEMS, `${JSON.stringify(payload, null, 2)}\n`);
      console.log("Assigned missing ids in manual-items.json.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function readExternalItems(categories) {
  const config = await readExternalConfig();
  const extensions = new Set(config.extensions ?? [".md", ".mdx", ".txt", ".phile"]);
  const excluded = new Set(config.exclude ?? []);
  const items = [];
  const pages = [];

  for (const root of await externalRoots(config)) {
    const rootConfig = config.sources?.[root.name] ?? {};
    const included = rootConfig.include ? new Set(rootConfig.include) : null;
    const files = (await walkFiles(root.rootUrl))
      .filter((file) => extensions.has(path.extname(file).toLowerCase()))
      .filter((file) => !excluded.has(path.basename(file)))
      .filter((file) => !included || included.has(file));

    for (const file of files) {
      const text = await readTextFile(new URL(file, root.rootUrl));
      const { data, body } = parseFrontmatter(text);
      const title = data.title || titleFromContent(body, file);
      const publishedAt = normalizeDate(data.publishedAt || data.date || dateFromPath(file));
      const tags = normalizeTags(data.tags
        ? (Array.isArray(data.tags) ? data.tags : data.tags.split(",")).map((tag) => tag.trim()).filter(Boolean)
        : (rootConfig.tags ?? config.tags ?? []));
      const source = data.source || rootConfig.source || root.name;
      const id = pageId(data.id, `External entry ${root.name}/${file}`);
      const slug = externalPageSlug(source, tags, id, categories);
      const url = pageUrlForSlug(slug);

      const image = publicImagePath(data.image || imageFromMarkdown(body));

      items.push({
        id,
        title,
        url,
        publishedAt,
        summary: data.summary || summaryFromMarkdown(body),
        image,
        source,
        tags,
        local: true
      });

      pages.push({
        id,
        slug,
        title,
        body: tags.includes("novel") ? indentFirstJapaneseLine(trimOuterBlankLines(body)) : trimOuterBlankLines(body),
        image,
        imageAlt: data.imageAlt || "",
        source,
        publishedAt,
        tags,
        file: root.name + "/" + file
      });
    }
  }

  return { items, pages };
}

async function readManualItems() {
  try {
    const payload = JSON.parse(await readFile(MANUAL_ITEMS, "utf8"));
    return (payload.items ?? []).map((item) => ({
      id: pageId(item.id, `Manual entry ${item.title ?? item.url}`),
      title: item.title,
      url: item.url,
      publishedAt: normalizeDate(item.publishedAt),
      summary: item.summary ?? "",
      image: item.image ?? "",
      source: item.source ?? "manual",
      type: item.type ?? "link",
      tags: normalizeTags(item.tags ?? [])
    })).filter((item) => item.title && item.url);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function fetchFeed(feed) {
  if (/YOUR_(NOTE_ID|CHANNEL_ID|SOUNDCLOUD_USER_ID)/.test(feed.url)) return [];

  const url = await resolveFeedUrl(feed);
  const response = await fetch(url, {
    headers: {
      "user-agent": "tetta-pdnt.github.io feed builder"
    }
  });

  if (!response.ok) {
    throw new Error(`${feed.title}: ${response.status} ${response.statusText}`);
  }

  return parseFeed(await response.text(), feed);
}

if (assignMissingIds) {
  await Promise.all([
    assignMissingYamlIds(TYPOGRAPHY_MANIFEST),
    assignMissingYamlIds(MUSIC_MANIFEST),
    assignMissingYamlIds(VIDEO_MANIFEST),
    assignMissingExternalMetadata(),
    assignMissingManualItemIds()
  ]);
}

let cachedSiteData;

export async function loadSiteData({ syncRss = false } = {}) {
  if (!syncRss && cachedSiteData) return cachedSiteData;

  const categories = await readCategories();
  const [manualItems, externalData, typographyData, initialMusicData, initialVideoData] = await Promise.all([
    readManualItems(),
    readExternalItems(categories),
    readTypographyItems(),
    readMusicItems(),
    readVideoItems()
  ]);

  let musicData = initialMusicData;
  let videoData = initialVideoData;
  let otherFeedItems = [];

  if (syncRss) {
    const config = JSON.parse(await readFile(FEED_CONFIG, "utf8"));
    const settled = await Promise.allSettled(config.feeds.map(fetchFeed));
    const failures = settled.filter((result) => result.status === "rejected");
    for (const failure of failures) console.warn(failure.reason?.message ?? failure.reason);

    const fetchedItems = settled
      .filter((result) => result.status === "fulfilled")
      .flatMap((result) => result.value);
    const fetchedMusicItems = fetchedItems.filter((item) => item.source === "SoundCloud");
    const fetchedVideoItems = fetchedItems.filter((item) => item.source === "YouTube");
    otherFeedItems = fetchedItems.filter((item) => item.source !== "SoundCloud" && item.source !== "YouTube");

    await syncManifest(MUSIC_MANIFEST, initialMusicData.entries, fetchedMusicItems, "SoundCloud");
    await syncManifest(VIDEO_MANIFEST, initialVideoData.entries, fetchedVideoItems, "YouTube");
    if (fetchedMusicItems.length) musicData = await readMusicItems();
    if (fetchedVideoItems.length) videoData = await readVideoItems();
  }

  const seen = new Set();
  const items = [
    ...manualItems,
    ...musicData.items,
    ...videoData.items,
    ...externalData.items,
    ...typographyData.items,
    ...otherFeedItems
  ]
    .filter((item) => {
      if (!item.id) throw new Error(`Every item needs an id: ${item.title}`);
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));

  const updatedAt = items.find((item) => item.publishedAt)?.publishedAt ?? null;
  const data = {
    updatedAt,
    items,
    musicAlbums: musicData.albums,
    pages: [...externalData.pages, ...typographyData.pages],
    categories
  };
  if (!syncRss) cachedSiteData = data;
  return data;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const data = await loadSiteData({ syncRss: process.argv.includes("--sync-rss") });
  console.log(`Loaded ${data.items.length} items.`);
}
