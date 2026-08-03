/* ============================================================
   导航页逻辑：纯原生 JS，零依赖
   - 加载 data/site.json、data/categories.json、data/links.json
   - 分区渲染 + 分类内自动排序（pinned 置顶 → order → 标题拼音序）
   - 搜索过滤（标题/描述/URL/标签）并高亮命中
   - 主题切换（auto/dark/light）、快捷键（/ 聚焦、Esc 清空、T 换肤）
   ============================================================ */

"use strict";

const DATA_FILES = {
  site: "data/site.json",
  categories: "data/categories.json",
  links: "data/links.json",
};

// 中文拼音序（Node/浏览器内置 Intl 支持）
const collator = new Intl.Collator("zh-Hans-CN", { sensitivity: "base", numeric: true });

const $ = (sel) => document.querySelector(sel);

const els = {
  loading: $("#loading"),
  error: $("#error"),
  errorMsg: $("#error-msg"),
  retry: $("#retry-btn"),
  empty: $("#empty"),
  emptyText: $("#empty-text"),
  main: $("#main"),
  nav: $("#cat-nav"),
  search: $("#search-input"),
  footer: $("#footer"),
  title: $("#site-title"),
  github: $("#github-link"),
  themeToggle: $("#theme-toggle"),
  cardTpl: $("#card-tpl"),
};

let state = { site: null, categories: [], links: [], query: "" };

/* ---------------- 数据加载 ---------------- */

async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
  return res.json();
}

async function loadData() {
  const [site, categories, links] = await Promise.all([
    fetchJSON(DATA_FILES.site),
    fetchJSON(DATA_FILES.categories),
    fetchJSON(DATA_FILES.links),
  ]);
  state.site = site;
  // 分类按 order 排序；链接按 pinned → order → 标题 排序（自动排序兜底）
  state.categories = [...categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  state.links = [...links].sort(compareLinks);
}

/* ---------------- 自动排序（与 manage.mjs 保持同一规则） ---------------- */

function compareLinks(a, b) {
  const pa = a.pinned ? 0 : 1;
  const pb = b.pinned ? 0 : 1;
  if (pa !== pb) return pa - pb;
  const oa = a.order ?? 0;
  const ob = b.order ?? 0;
  if (oa !== ob) return oa - ob;
  return collator.compare(a.title, b.title);
}

/* ---------------- 渲染 ---------------- */

function buildCard(link) {
  const frag = els.cardTpl.content.cloneNode(true);
  const card = frag.querySelector(".card");
  card.href = link.url;

  const titleEl = frag.querySelector(".card-title-text");
  titleEl.textContent = link.title;

  const descEl = frag.querySelector(".card-desc");
  if (link.description) {
    descEl.textContent = link.description;
  } else {
    descEl.remove();
  }

  const img = frag.querySelector(".card-icon img");
  const fallback = frag.querySelector(".card-icon-fallback");
  fallback.textContent = (link.title || "?").trim().charAt(0).toUpperCase();

  if (link.icon) {
    img.src = link.icon;
  } else {
    // 自动取站点 favicon（Google s2 服务，国内一般可访问；失败则回退首字母）
    try {
      img.src = `https://www.google.com/s2/favicons?domain=${new URL(link.url).hostname}&sz=64`;
    } catch {
      img.remove();
    }
  }
  img.addEventListener("error", () => {
    img.closest(".card-icon").classList.add("no-img");
  });

  if (link.tags && link.tags.length) {
    const tagsEl = frag.querySelector(".card-tags");
    for (const t of link.tags) {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = t;
      tagsEl.appendChild(span);
    }
  } else {
    frag.querySelector(".card-tags").remove();
  }

  return frag;
}

function highlight(node, query) {
  // 仅在文本节点上做高亮，避免 XSS
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);
  for (const textNode of targets) {
    const text = textNode.nodeValue;
    if (!text || !text.toLowerCase().includes(query)) continue;
    const frag = document.createDocumentFragment();
    let rest = text;
    const lower = text.toLowerCase();
    let idx = lower.indexOf(query);
    while (idx !== -1) {
      frag.appendChild(document.createTextNode(rest.slice(0, idx)));
      const mark = document.createElement("mark");
      mark.textContent = rest.slice(idx, idx + query.length);
      frag.appendChild(mark);
      rest = rest.slice(idx + query.length);
      idx = rest.toLowerCase().indexOf(query);
    }
    if (rest) frag.appendChild(document.createTextNode(rest));
    textNode.replaceWith(frag);
  }
}

function render() {
  const query = state.query.trim().toLowerCase();
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = q ? new RegExp(q, "gi") : null;

  els.main.innerHTML = "";
  els.nav.innerHTML = "";
  document.body.classList.toggle("searching", !!query);

  const visibleCategories = [];

  for (const cat of state.categories) {
    const links = state.links
      .filter((l) => l.category === cat.id)
      .sort(compareLinks);

    const filtered = re
      ? links.filter((l) =>
          re.test(l.title) ||
          re.test(l.url) ||
          re.test(l.description || "") ||
          (l.tags || []).some((t) => re.test(t))
        )
      : links;

    if (filtered.length === 0 && !query) continue;
    visibleCategories.push(cat);

    // 分类区
    const section = document.createElement("section");
    section.className = "cat-section";
    section.id = `cat-${cat.id}`;

    const head = document.createElement("div");
    head.className = "cat-head";
    const icon = document.createElement("span");
    icon.className = "cat-icon";
    icon.textContent = cat.icon || "•";
    const name = document.createElement("h2");
    name.className = "cat-name";
    name.textContent = cat.name;
    const desc = document.createElement("span");
    desc.className = "cat-desc";
    desc.textContent = cat.description || "";
    const count = document.createElement("span");
    count.className = "cat-count";
    count.textContent = `${filtered.length} 项`;
    head.append(icon, name, desc, count);

    const grid = document.createElement("div");
    grid.className = "card-grid";
    if (query && filtered.length === 0) {
      // 分区无命中时隐藏（上面已 continue，这里不会走到）
    }
    for (const link of filtered) {
      const card = buildCard(link);
      if (re) {
        highlight(card, query);
      }
      grid.appendChild(card);
    }

    section.append(head, grid);
    els.main.appendChild(section);

    // 分类 chip
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "cat-chip";
    chip.dataset.target = `cat-${cat.id}`;
    chip.textContent = cat.name;
    const chipCount = document.createElement("span");
    chipCount.className = "chip-count";
    chipCount.textContent = filtered.length;
    chip.appendChild(chipCount);
    chip.addEventListener("click", () => {
      document.getElementById(`cat-${cat.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    els.nav.appendChild(chip);
  }

  if (query && visibleCategories.length === 0) {
    els.emptyText.textContent = `没有匹配 “${state.query.trim()}” 的链接`;
    els.empty.classList.remove("hidden");
    els.nav.classList.add("hidden");
  } else {
    els.empty.classList.add("hidden");
    els.nav.classList.remove("hidden");
  }

  // 滚动时高亮当前分类 chip
  observeSections();
}

/* ---------------- 分类 chip 跟随滚动 ---------------- */

let observer = null;
function observeSections() {
  if (observer) observer.disconnect();
  const chips = [...els.nav.querySelectorAll(".cat-chip")];
  const sections = [...els.main.querySelectorAll(".cat-section")];
  if (!sections.length) return;
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const first = visible[0];
      if (!first) return;
      for (const c of chips) c.classList.toggle("active", c.dataset.target === first.target.id);
    },
    { rootMargin: "-140px 0px -60% 0px", threshold: 0 }
  );
  for (const s of sections) observer.observe(s);
}

/* ---------------- 主题 ---------------- */

function applyTheme(mode) {
  // auto → 跟随系统；dark/light → 强制
  const resolved = mode === "auto"
    ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : mode;
  document.documentElement.dataset.theme = resolved;
  localStorage.setItem("nav-theme", mode);
}

function cycleTheme() {
  const order = ["auto", "dark", "light"];
  const cur = localStorage.getItem("nav-theme") || state.site?.theme || "auto";
  const next = order[(order.indexOf(cur) + 1) % order.length];
  applyTheme(next);
}

/* ---------------- 搜索 ---------------- */

function onSearch() {
  state.query = els.search.value;
  render();
}

/* ---------------- 页脚信息 ---------------- */

function renderFooter() {
  const count = state.links.length;
  const cats = state.categories.length;
  const base = state.site?.footer || "数据由 data/*.json 驱动";
  els.footer.textContent = `${base} · ${cats} 个分区 · ${count} 个链接`;
}

/* ---------------- 初始化 ---------------- */

async function init() {
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    els.loading.classList.add("hidden");
    els.errorMsg.textContent = `数据加载失败：${err.message}`;
    els.error.classList.remove("hidden");
    return;
  }

  els.loading.classList.add("hidden");

  // 站点信息
  if (state.site?.title) {
    els.title.textContent = state.site.title;
    document.title = state.site.title;
  }
  if (state.site?.github) {
    els.github.href = state.site.github;
  } else {
    els.github.remove();
  }
  renderFooter();
  render();

  // 主题
  applyTheme(localStorage.getItem("nav-theme") || state.site?.theme || "auto");

  // 事件
  els.search.addEventListener("input", onSearch);
  els.retry.addEventListener("click", () => {
    els.error.classList.add("hidden");
    els.loading.classList.remove("hidden");
    init();
  });
  els.themeToggle.addEventListener("click", cycleTheme);
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
      e.preventDefault();
      els.search.focus();
    } else if (e.key === "Escape" && document.activeElement === els.search) {
      els.search.value = "";
      onSearch();
      els.search.blur();
    } else if (e.key.toLowerCase() === "t" && tag !== "INPUT" && tag !== "TEXTAREA") {
      cycleTheme();
    }
  });
}

init();
