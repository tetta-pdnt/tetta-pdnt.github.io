const feed = document.querySelector("#feed");
const filterRoot = document.querySelector("#filters");
const updated = document.querySelector("#updated");

let activeFilter = "all";
let items = [];
let categories = [];
let filters = [];
let leafCategories = [];

function formatDate(value) {
  if (!value) return "----.--.--";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(value))
    .replaceAll("/", ".");
}

function hrefFor(item) {
  return item.url;
}

function renderFilters() {
  filterRoot.replaceChildren(
    ...filters.map((filter) => {
      const button = document.createElement("button");
      button.className = "tab";
      button.type = "button";
      button.textContent = filter;
      button.setAttribute(
        "aria-pressed",
        filter === activeFilter ? "true" : "false",
      );
      button.addEventListener("click", () => {
        activeFilter = filter;
        renderFilters();
        renderItems();
      });
      return button;
    }),
  );
}

function categoryFor(item) {
  return item.tags?.find((tag) => leafCategories.includes(tag)) ?? "misc";
}

function categoryLink(key) {
  if (key === "misc") return "/misc/";
  if (categories.some((category) => category.key === key)) return `/${key}/`;

  const parent = categories.find((category) => category.children?.includes(key));
  return parent ? `/${parent.key}/${key}/` : undefined;
}

function isWritingItem(item) {
  return categories.find((category) => category.key === "writing").children.includes(categoryFor(item));
}

function lineNode(text, className = "tree-line") {
  const line = document.createElement("div");
  line.className = className;
  line.textContent = text;
  return line;
}

function rootNode() {
  const row = document.createElement("div");
  row.className = "tree-line tree-root";
  const link = document.createElement("a");
  link.href = "/all/";
  link.textContent = "~";
  row.append(link);
  return row;
}

function branchNodes(ancestors, branch) {
  const nodes = ancestors.map((show) => {
    const ancestor = document.createElement("span");
    ancestor.className = "tree-branch tree-ancestor";
    ancestor.textContent = "│   ";
    ancestor.hidden = !show;
    return ancestor;
  });

  const twig = document.createElement("span");
  twig.className = "tree-branch";
  twig.textContent = branch;
  return [...nodes, twig];
}

function dirNode(label, ancestors, branch, hrefOverride) {
  const row = document.createElement("div");
  row.className = "tree-line tree-dir";

  const href = hrefOverride ?? categoryLink(label);
  const control = document.createElement(href ? "a" : "button");
  control.className = "tree-dir-link";
  control.textContent = label + "/";

  if (href) {
    control.href = href;
  } else {
    control.type = "button";
    control.setAttribute(
      "aria-pressed",
      label === activeFilter ? "true" : "false",
    );
    control.addEventListener("click", () => {
      activeFilter = label;
      renderFilters();
      renderItems();
    });
  }

  row.append(...branchNodes(ancestors, branch), control);
  return row;
}

function itemNode(item, ancestors, branch) {
  const row = document.createElement("div");
  row.className = "tree-line tree-item";

  const link = document.createElement("a");
  link.href = hrefFor(item);
  if (
    !item.local &&
    item.source !== "SoundCloud" &&
    item.source !== "YouTube"
  ) {
    link.rel = "noreferrer";
    link.target = "_blank";
  }
  link.textContent = item.title;

  const meta = document.createElement("span");
  meta.className = "tree-meta";
  meta.textContent = "  " + formatDate(item.publishedAt);

  row.append(...branchNodes(ancestors, branch), link, meta);
  return row;
}

function renderItems() {
  const visible =
    activeFilter === "all"
      ? items
      : activeFilter === "writing"
        ? items.filter(isWritingItem)
        : items.filter((item) => categoryFor(item) === activeFilter);

  if (!visible.length) {
    const message = document.createElement("p");
    message.className = "empty";
    message.textContent = "tree is empty. edit feeds.json or external/*";
    feed.replaceChildren(message);
    return;
  }

  const groups = categories
    .map((category) => {
      if (category.children) {
        const children = category.children
          .map((key) => ({
            label: key,
            items: visible.filter((item) => categoryFor(item) === key),
          }))
          .filter((group) => group.items.length);
        return children.length ? { label: category.key, children } : null;
      }

      const categoryItems = visible.filter(
        (item) => categoryFor(item) === category.key,
      );
      if (category.key === "music") {
        const albums = [...new Map(
          categoryItems
            .filter((item) => item.album)
            .map((item) => [item.album, { label: item.albumTitle, album: item.album, items: [] }]),
        ).entries()].map(([album, group]) => ({
          ...group,
          items: categoryItems.filter((item) => item.album === album),
        }));
        const singles = categoryItems.filter((item) => !item.album);
        return albums.length || singles.length
          ? { label: category.key, albums, items: singles }
          : null;
      }
      return categoryItems.length
        ? { label: category.key, items: categoryItems }
        : null;
    })
    .filter(Boolean);
  const miscItems = visible.filter((item) => categoryFor(item) === "misc");
  if (miscItems.length) groups.push({ label: "misc", items: miscItems });
  const nodes = [rootNode()];

  groups.forEach((group, groupIndex) => {
    const lastGroup = groupIndex === groups.length - 1;
    nodes.push(dirNode(group.label, [], lastGroup ? "└── " : "├── "));

    if (group.children || group.albums) {
      const entries = [
        ...(group.children ?? []).map((child) => ({ kind: "directory", ...child })),
        ...(group.albums ?? []).map((album) => ({ kind: "album", ...album })),
        ...(group.items ?? []).map((item) => ({ kind: "item", item })),
      ];
      entries.forEach((entry, entryIndex) => {
        const lastEntry = entryIndex === entries.length - 1;
        if (entry.kind === "item") {
          nodes.push(itemNode(entry.item, [!lastGroup], lastEntry ? "└── " : "├── "));
          return;
        }
        nodes.push(
          dirNode(entry.label, [!lastGroup], lastEntry ? "└── " : "├── ", entry.kind === "album" ? `/music/${encodeURIComponent(entry.album)}/` : undefined),
        );
        entry.items.forEach((item, itemIndex) => {
          nodes.push(
            itemNode(
              item,
              [!lastGroup, !lastEntry],
              itemIndex === entry.items.length - 1 ? "└── " : "├── ",
            ),
          );
        });
      });
    } else {
      group.items.forEach((item, itemIndex) => {
        nodes.push(
          itemNode(
            item,
            [!lastGroup],
            itemIndex === group.items.length - 1 ? "└── " : "├── ",
          ),
        );
      });
    }
  });

  feed.replaceChildren(...nodes);
}

async function boot() {
  try {
    const [itemsResponse, categoriesResponse] = await Promise.all([
      fetch("/data/items.json", { cache: "no-store" }),
      fetch("/data/categories.json", { cache: "no-store" })
    ]);
    if (!itemsResponse.ok || !categoriesResponse.ok) {
      throw new Error(`${itemsResponse.status} ${itemsResponse.statusText}`);
    }

    const [payload, categoryPayload] = await Promise.all([
      itemsResponse.json(),
      categoriesResponse.json()
    ]);
    items = payload.items ?? [];
    categories = categoryPayload.categories ?? [];
    leafCategories = categories.flatMap((category) => category.children ?? [category.key]);
    const hasMiscItems = items.some((item) => categoryFor(item) === "misc");
    filters = ["all", ...categories.map((category) => category.key)];
    if (hasMiscItems) filters.push("misc");
    updated.textContent = payload.updatedAt
      ? ":checkhealth " + formatDate(payload.updatedAt)
      : ":checkhealth no-rss";
  } catch (error) {
    updated.textContent = "E: data/items.json unreadable";
    console.error(error);
  }

  renderFilters();
  renderItems();
}

boot();
