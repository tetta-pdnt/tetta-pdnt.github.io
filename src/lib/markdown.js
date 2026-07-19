function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHref(value) {
  return /^(https?:|mailto:|\/|#)/i.test(value) ? value : "";
}

function imageSource(value, imageBase) {
  if (/^(https?:|data:|\/)/i.test(value)) return value;
  const imgPath = value.replace(/^(?:\.\/|public\/)?img\//, "");
  if (imgPath !== value) return `/img/${imgPath}`;
  if (value.includes("/")) return `/img/${value}`;
  return imageBase ? `${imageBase.replace(/\/[^/]*$/, "/")}${value}` : `/img/${value}`;
}

const texSymbols = {
  notin: "∉",
  neq: "≠",
  ne: "≠",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neg: "¬",
  lnot: "¬",
  in: "∈",
  rightarrow: "→",
  to: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  land: "∧",
  wedge: "∧",
  lor: "∨",
  vee: "∨",
  forall: "∀",
  exists: "∃",
  therefore: "∴",
  because: "∵",
  times: "×",
  cdot: "·",
  pm: "±",
  infty: "∞",
  subseteq: "⊆",
  subset: "⊂",
  supseteq: "⊇",
  supset: "⊃"
};

function plainTex(value) {
  return value.replace(/\\(notin|neq|ne|leq|le|geq|ge|neg|lnot|in|rightarrow|to|leftarrow|leftrightarrow|land|wedge|lor|vee|forall|exists|therefore|because|times|cdot|pm|infty|subseteq|subset|supseteq|supset)(?![A-Za-z])/g, (_match, command) => texSymbols[command]);
}

function inlineMarkdown(value, imageBase) {
  const protectedHtml = [];
  const protect = (html) => {
    const token = `\u0000${protectedHtml.length}\u0000`;
    protectedHtml.push(html);
    return token;
  };
  const source = value
    .replace(/`([^`]+)`/g, (_match, code) => protect(`<code>${escapeHtml(code)}</code>`))
    .replace(/(?<!\\)\$([^$\n]+?)(?<!\\)\$(?!\$)/g, (_match, math) => protect(`<span class="tex-inline">${escapeHtml(plainTex(math))}</span>`));
  let html = escapeHtml(source);

  html = html
    .replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_match, alt, source) => {
      const href = imageSource(source, imageBase);
      return href ? `<img src="${href}" alt="${alt}" />` : _match;
    })
    .replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_match, label, source) => {
      const href = safeHref(source);
      return href ? `<a href="${href}">${label}</a>` : label;
    })
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>")
    .replace(/\\\$/g, "$");

  return html.replace(/\u0000(\d+)\u0000/g, (_match, index) => protectedHtml[Number(index)]);
}

function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function tableAlignment(marker) {
  const value = marker.trim();
  if (/^:-+:$/.test(value)) return "center";
  if (/^-+:$/.test(value)) return "right";
  if (/^:-+$/.test(value)) return "left";
  return "";
}

export function renderMarkdown(markdown, { imageBase = "" } = {}) {
  const lines = markdown
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, source, alt = "") => `![${alt}](${source})`)
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (line.trim() === "$$") {
      const math = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== "$$") math.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(`<div class="tex-block">${escapeHtml(plainTex(math.join("\n")))}</div>`);
      continue;
    }

    if (line.trim() === "::: center") {
      const closingIndex = lines.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.trim() === ":::");
      if (closingIndex !== -1) {
        const content = lines.slice(index + 1, closingIndex).join("\n");
        blocks.push(`<div class="reader-center">${renderMarkdown(content, { imageBase })}</div>`);
        index = closingIndex + 1;
        continue;
      }
    }

    const image = line.match(/^!\[([^\]]*)\]\(([^\s)]+)(?:\s+&quot;[^)]*&quot;)?\)$/);
    if (image) {
      const source = imageSource(image[2], imageBase);
      blocks.push(`<figure><img src="${source}" alt="${image[1]}" />${image[1] ? `<figcaption>${inlineMarkdown(image[1], imageBase)}</figcaption>` : ""}</figure>`);
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
      const headers = tableCells(line);
      const alignments = tableCells(lines[index + 1]).map(tableAlignment);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        rows.push(tableCells(lines[index++]));
      }
      const cell = (tag, value, column) => `<${tag}${alignments[column] ? ` style="text-align:${alignments[column]}"` : ""}>${inlineMarkdown(value ?? "", imageBase)}</${tag}>`;
      blocks.push(`<table><thead><tr>${headers.map((value, column) => cell("th", value, column)).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_header, column) => cell("td", row[column], column)).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${inlineMarkdown(line, imageBase)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      blocks.push(`<blockquote>${inlineMarkdown(quote.join("\n"), imageBase).replaceAll("\n", "<br />\n")}</blockquote>`);
      continue;
    }

    const list = line.match(/^\s*([-*+]|\d+\.)\s+(.+)$/);
    if (list) {
      const ordered = /\d+\./.test(list[1]);
      const items = [];
      const pattern = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const item = lines[index].match(pattern);
        if (!item) break;
        items.push(`<li>${inlineMarkdown(item[1], imageBase)}</li>`);
        index += 1;
      }
      blocks.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim()) {
      if (paragraph.length && (/^(#{1,6})\s+/.test(lines[index]) || lines[index].startsWith("```") || lines[index].trim() === "::: center" || /^>\s?/.test(lines[index]) || /^\s*([-*+]|\d+\.)\s+/.test(lines[index]))) break;
      paragraph.push(lines[index++]);
    }
    blocks.push(`<p>${inlineMarkdown(paragraph.join("\n"), imageBase).replaceAll("\n", "<br />\n")}</p>`);
  }

  return blocks.join("\n");
}
