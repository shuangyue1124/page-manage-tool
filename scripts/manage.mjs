#!/usr/bin/env node
/* ============================================================
 * 导航页管理脚本（零依赖，Node.js >= 18，Windows/macOS/Linux 通用）
 *
 * 用法：
 *   node scripts/manage.mjs list [分类]             查看链接（可按分类过滤）
 *   node scripts/manage.mjs add <分类> <标题> <URL> [--desc 描述] [--icon 图标URL] [--tags a,b,c] [--pin]
 *   node scripts/manage.mjs update <标题|id|URL> [--title 新标题] [--url 新URL] [--category 新分类]
 *                                              [--desc 新描述] [--icon 新图标] [--tags a,b,c] [--pin|--unpin]
 *   node scripts/manage.mjs remove <标题|id|URL> 删除链接
 *   node scripts/manage.mjs sort [--category id] 重新自动排序（pinned 置顶 → 中文标题拼音序）
 *   node scripts/manage.mjs categories           查看分区
 *   node scripts/manage.mjs add-category <名称> [--icon 🧰] [--desc 描述]
 *   node scripts/manage.mjs remove-category <id|名称> [--force]  删除分区（--force 同时删除其链接）
 *   node scripts/manage.mjs validate             校验数据完整性
 *   node scripts/manage.mjs push [提交说明]        git add + commit + push（触发 Cloudflare Pages 自动构建）
 *
 * 示例：
 *   node scripts/manage.mjs add 网页管理 "Nginx Proxy Manager" "http://192.168.1.1:81" --desc 反代与证书 --tags nginx,ssl
 *   node scripts/manage.mjs update 4 --title "NPM 面板" --tags nginx
 *   node scripts/manage.mjs remove 4
 *   node scripts/manage.mjs push "nav: 添加 NPM 入口"
 * ============================================================ */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = {
  site: path.join(ROOT, "data", "site.json"),
  categories: path.join(ROOT, "data", "categories.json"),
  links: path.join(ROOT, "data", "links.json"),
};

// 与前端 app.js 保持一致的排序规则：pinned 置顶 → order → 中文标题拼音序
const collator = new Intl.Collator("zh-Hans-CN", { sensitivity: "base", numeric: true });

/* ---------------- 小工具 ---------------- */

const log = (msg) => console.log(msg);

function readJSON(file) {
  if (!existsSync(file)) throw new Error(`缺少数据文件: ${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJSON(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function slugify(str) {
  const s = String(str)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "link";
}

function genId(title) {
  return `${slugify(title)}-${crypto.randomBytes(2).toString("hex")}`;
}

function parseArgs(argv) {
  // 位置参数 + --key value / --flag
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, opts };
}

function findLink(links, key) {
  // 支持按 id、标题、URL 精确/前缀匹配
  const k = String(key).toLowerCase();
  return (
    links.find((l) => l.id === k) ||
    links.find((l) => l.title.toLowerCase() === k) ||
    links.find((l) => l.url.toLowerCase() === k) ||
    links.find((l) => l.title.toLowerCase().includes(k)) ||
    links.find((l) => l.url.toLowerCase().includes(k))
  );
}

function findCategory(categories, key) {
  const k = String(key).toLowerCase();
  return (
    categories.find((c) => c.id === k) ||
    categories.find((c) => c.name.toLowerCase() === k)
  );
}

/* ---------------- 自动排序 ---------------- */

function compareLinks(a, b) {
  const pa = a.pinned ? 0 : 1;
  const pb = b.pinned ? 0 : 1;
  if (pa !== pb) return pa - pb;
  const oa = a.order ?? 0;
  const ob = b.order ?? 0;
  if (oa !== ob) return oa - ob;
  return collator.compare(a.title, b.title);
}

/** 重算某分类（或全部）链接的 order：pinned 置顶 → 中文标题拼音序 */
function reorder(links, categories, categoryId) {
  const sorted = [...links].sort(compareLinks);
  const byCat = new Map();
  for (const l of sorted) {
    if (!byCat.has(l.category)) byCat.set(l.category, []);
    byCat.get(l.category).push(l);
  }
  const touched = [];
  for (const [cat, list] of byCat) {
    if (categoryId && cat !== categoryId) continue;
    list.forEach((l, i) => {
      if (l.order !== i + 1) {
        l.order = i + 1;
        touched.push(`${l.title} → ${i + 1}`);
      }
    });
  }
  // 只保留排序后的顺序写入（保持文件稳定）
  links.splice(0, links.length, ...sorted);
  return touched;
}

/* ---------------- 命令实现 ---------------- */

function cmdList({ positional, opts }) {
  const { links, categories } = readAll();
  const filter = positional[1];
  const rows = [];
  for (const l of links) {
    if (filter && !(l.category === filter || (findCategory(categories, filter)?.id === l.category))) continue;
    const catName = categories.find((c) => c.id === l.category)?.name || l.category || "未分类";
    rows.push(
      `  [${l.order ?? "-"}]${l.pinned ? " ★" : "  "} ${l.id.padEnd(28)} ${l.title.padEnd(20)} → ${l.url}  (${catName})`
    );
  }
  log(rows.length ? rows.join("\n") : "（空）");
  log(`\n共 ${rows.length} 个链接`);
}

function cmdAdd({ positional, opts }) {
  const [cmd, catKey, title, url] = positional;
  if (!catKey || !title || !url) {
    throw new Error("用法: add <分类> <标题> <URL> [--desc 描述] [--icon 图标URL] [--tags a,b] [--pin]");
  }
  const { links, categories } = readAll();
  const cat = findCategory(categories, catKey);
  if (!cat) {
    throw new Error(
      `分类 “${catKey}” 不存在。现有分类：${categories.map((c) => `${c.name}(${c.id})`).join("、")}\n` +
        `可用 add-category 新建分类。`
    );
  }
  if (links.some((l) => l.url === url)) {
    throw new Error(`该 URL 已存在: ${url}`);
  }
  const link = {
    id: genId(title),
    title,
    url,
    category: cat.id,
    description: opts.desc ?? "",
    icon: opts.icon ?? "",
    tags: opts.tags ? String(opts.tags).split(",").map((t) => t.trim()).filter(Boolean) : [],
    pinned: opts.pin === true || opts.pin === "true",
  };
  links.push(link);
  reorder(links, categories);
  writeJSON(DATA.links, links);
  log(`[OK] 已添加: ${title} → ${url}（分区：${cat.name}，id：${link.id}）`);
  log(`   当前顺序为自动排序结果，可用 sort 重新排序。`);
}

function cmdUpdate({ positional, opts }) {
  const [cmd, key] = positional;
  if (!key) throw new Error("用法: update <标题|id|URL> [--title] [--url] [--category] [--desc] [--icon] [--tags] [--pin|--unpin]");
  const { links, categories } = readAll();
  const link = findLink(links, key);
  if (!link) throw new Error(`未找到链接: ${key}`);

  const changes = [];
  if (opts.title) { link.title = opts.title; changes.push("标题"); }
  if (opts.url) {
    if (links.some((l) => l.url === opts.url && l.id !== link.id)) throw new Error(`URL 已被占用: ${opts.url}`);
    link.url = opts.url; changes.push("URL");
  }
  if (opts.category) {
    const cat = findCategory(categories, opts.category);
    if (!cat) throw new Error(`分类不存在: ${opts.category}`);
    link.category = cat.id; changes.push("分类");
  }
  if (opts.desc !== undefined) { link.description = opts.desc; changes.push("描述"); }
  if (opts.icon !== undefined) { link.icon = opts.icon; changes.push("图标"); }
  if (opts.tags !== undefined) {
    link.tags = opts.tags ? String(opts.tags).split(",").map((t) => t.trim()).filter(Boolean) : [];
    changes.push("标签");
  }
  if (opts.pin === "true" || opts.pin === true) { link.pinned = true; changes.push("置顶"); }
  if (opts.unpin === "true" || opts.unpin === true) { link.pinned = false; changes.push("取消置顶"); }

  reorder(links, categories);
  writeJSON(DATA.links, links);
  log(`[OK] 已更新 ${link.title}（id: ${link.id}）：${changes.join("、") || "无字段变化"}`);
}

function cmdRemove({ positional }) {
  const [cmd, key] = positional;
  if (!key) throw new Error("用法: remove <标题|id|URL>");
  const { links } = readAll();
  const link = findLink(links, key);
  if (!link) throw new Error(`未找到链接: ${key}`);
  const idx = links.indexOf(link);
  links.splice(idx, 1);
  reorder(links, readJSON(DATA.categories));
  writeJSON(DATA.links, links);
  log(`[删除] 已删除: ${link.title}（${link.url}）`);
}

function cmdSort({ opts }) {
  const { links, categories } = readAll();
  const touched = reorder(links, categories, opts.category);
  writeJSON(DATA.links, links);
  log(`[OK] 排序完成${opts.category ? `（分类 ${opts.category}）` : ""}`);
  if (touched.length) {
    log("   顺序变化：");
    touched.forEach((t) => log(`   · ${t}`));
  } else {
    log("   顺序未变化");
  }
}

function cmdCategories() {
  const { categories, links } = readAll();
  for (const c of [...categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const n = links.filter((l) => l.category === c.id).length;
    log(`  ${c.order ?? "-"}. ${c.name} (${c.id}) — ${c.description || ""} [${n} 个链接]`);
  }
}

function cmdAddCategory({ positional, opts }) {
  const [cmd, name] = positional;
  if (!name) throw new Error("用法: add-category <名称> [--icon 🧰] [--desc 描述]");
  const { categories } = readAll();
  if (categories.some((c) => c.name === name)) throw new Error(`分类已存在: ${name}`);
  const id = slugify(name) || `cat-${crypto.randomBytes(2).toString("hex")}`;
  if (categories.some((c) => c.id === id)) throw new Error(`分类 id 冲突: ${id}，请换一个名称`);
  const order = categories.reduce((m, c) => Math.max(m, c.order ?? 0), 0) + 1;
  categories.push({
    id,
    name,
    icon: opts.icon ?? "🔗",
    description: opts.desc ?? "",
    order,
  });
  writeJSON(DATA.categories, categories);
  log(`[OK] 已新建分类: ${name} (${id})`);
}

function cmdRemoveCategory({ positional, opts }) {
  const [cmd, key] = positional;
  if (!key) throw new Error("用法: remove-category <id|名称> [--force]");
  const { categories, links } = readAll();
  const cat = findCategory(categories, key);
  if (!cat) throw new Error(`分类不存在: ${key}`);
  const orphan = links.filter((l) => l.category === cat.id);
  if (orphan.length && opts.force !== true && opts.force !== "true") {
    throw new Error(`分类 “${cat.name}” 下还有 ${orphan.length} 个链接，请先移动或删除，或加 --force 一并删除`);
  }
  categories.splice(categories.indexOf(cat), 1);
  if (orphan.length) {
    for (const l of orphan) links.splice(links.indexOf(l), 1);
  }
  reorder(links, categories);
  writeJSON(DATA.categories, categories);
  writeJSON(DATA.links, links);
  log(`[删除] 已删除分类: ${cat.name}${orphan.length ? `（连带删除 ${orphan.length} 个链接）` : ""}`);
}

function cmdValidate() {
  const { links, categories, site } = readAll();
  const errors = [];

  const catIds = new Set(categories.map((c) => c.id));
  for (const c of categories) {
    if (!c.id || !c.name) errors.push(`分类缺少 id/name: ${JSON.stringify(c)}`);
  }
  const linkIds = new Set();
  const urls = new Map();
  for (const l of links) {
    if (!l.id || !l.title || !l.url) errors.push(`链接缺少 id/title/url: ${JSON.stringify(l)}`);
    if (linkIds.has(l.id)) errors.push(`链接 id 重复: ${l.id}`);
    linkIds.add(l.id);
    if (!catIds.has(l.category)) errors.push(`链接 “${l.title}” 的分类不存在: ${l.category}`);
    const u = l.url.toLowerCase();
    if (urls.has(u)) errors.push(`链接 URL 重复: ${l.url}（${urls.get(u)} 与 ${l.title}）`);
    urls.set(u, l.title);
    if (l.pinned !== undefined && typeof l.pinned !== "boolean") errors.push(`链接 “${l.title}” 的 pinned 必须是布尔值`);
    if (l.tags !== undefined && !Array.isArray(l.tags)) errors.push(`链接 “${l.title}” 的 tags 必须是数组`);
  }
  if (!site || !site.title) errors.push("site.json 缺少 title");

  if (errors.length) {
    log(`[错误] 校验失败（${errors.length} 个问题）：`);
    errors.forEach((e) => log(`  · ${e}`));
    process.exitCode = 1;
  } else {
    log(`[OK] 校验通过：${categories.length} 个分区，${links.length} 个链接`);
  }
}

function cmdPush({ positional }) {
  const message = positional[1] || "nav: update links";
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT });
    if (r.error) throw new Error(`无法执行 ${cmd}: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`${cmd} 退出码 ${r.status}`);
  };
  run("git", ["rev-parse", "--is-inside-work-tree"]);
  run("git", ["add", "-A"]);
  run("git", ["commit", "-m", message]);
  const remotes = spawnSync("git", ["remote"], { cwd: ROOT, encoding: "utf8" });
  if (!remotes.stdout.trim()) {
    throw new Error("未配置 git remote。请先: git remote add origin <仓库地址>");
  }
  run("git", ["push"]);
  log(`[推送] 已推送 ${message}，Cloudflare Pages 将自动构建部署。`);
}

function readAll() {
  return {
    site: readJSON(DATA.site),
    categories: readJSON(DATA.categories),
    links: readJSON(DATA.links),
  };
}

/* ---------------- 交互式菜单（一键脚本模式） ---------------- */

const MENU = `
==================================================
  导航页管理 · 一键模式
  操作方式：输入数字编号后按回车键
==================================================
  1. 查看链接
  2. 添加链接
  3. 修改链接
  4. 删除链接
  5. 重新排序（置顶优先 → 中文拼音序）
  6. 分区管理（查看 / 新建）
  7. 推送部署（git 提交并推送，触发 Cloudflare 自动构建）
  0. 退出
--------------------------------------------------`;

async function fail(rl, msg) {
  log(`[错误] ${msg}`);
  return undefined;
}

/** 提问并去除可能的 BOM 前缀（兼容 PowerShell 管道注入的 UTF-8 BOM） */
const ask = async (rl, prompt) => (await rl.question(prompt)).replace(/^\uFEFF/, "");

/** 提示输入；空回车返回 undefined（不变），- 表示清空 */
async function promptKeep(rl, label, current) {
  const v = (await ask(rl, `${label} [${current}]（回车不变，- 清空）: `)).trim();
  return v === "" ? undefined : v;
}

function pickLink(rl, links, action) {
  log("");
  links.forEach((l, i) => {
    const cat = readJSON(DATA.categories).find((c) => c.id === l.category)?.name || l.category;
    log(`  ${String(i + 1).padStart(2)}. ${l.pinned ? "★" : " "} ${l.title}  →  ${l.url}  (${cat})`);
  });
  return links;
}

async function interactiveAdd(rl) {
  const { categories } = readAll();
  if (!categories.length) {
    await fail(rl, "还没有分区，请先进入 6 分区管理 新建");
    return;
  }
  log("\n可用分区：");
  categories.forEach((c, i) => log(`  ${i + 1}. ${c.name} (${c.id})`));
  const idx = parseInt(await ask(rl, "选择分区编号: "), 10);
  const cat = categories[idx - 1];
  if (!cat) { await fail(rl, "分区编号无效"); return; }

  const title = (await ask(rl, "标题: ")).trim();
  if (!title) { await fail(rl, "标题不能为空"); return; }
  const url = (await ask(rl, "URL: ")).trim();
  if (!url) { await fail(rl, "URL 不能为空"); return; }
  const desc = (await ask(rl, "描述（回车跳过）: ")).trim();
  const tags = (await ask(rl, "标签（逗号分隔，回车跳过）: ")).trim();
  const pin = (await ask(rl, "置顶? (y/n): ")).trim().toLowerCase();

  cmdAdd({
    positional: ["add", cat.id, title, url],
    opts: {
      desc: desc || undefined,
      tags: tags || undefined,
      pin: pin === "y" ? "true" : undefined,
    },
  });
  log("提示: 完成后选 7 推送部署，Cloudflare 会自动更新网页");
}

async function interactiveUpdate(rl) {
  const { links } = readAll();
  if (!links.length) { await fail(rl, "暂无链接"); return; }
  pickLink(rl, links, "update");
  const idx = parseInt(await ask(rl, "\n选择要修改的链接编号: "), 10);
  const link = links[idx - 1];
  if (!link) { await fail(rl, "编号无效"); return; }

  const opts = {};
  const title = await promptKeep(rl, "标题", link.title);
  if (title) opts.title = title;
  const url = await promptKeep(rl, "URL", link.url);
  if (url) opts.url = url;
  const desc = await promptKeep(rl, "描述", link.description || "");
  if (desc !== undefined) opts.desc = desc === "-" ? "" : desc;
  const icon = await promptKeep(rl, "图标(URL/emoji)", link.icon || "");
  if (icon !== undefined) opts.icon = icon === "-" ? "" : icon;
  const tags = await promptKeep(rl, "标签(逗号分隔)", (link.tags || []).join(","));
  if (tags !== undefined) opts.tags = tags === "-" ? "" : tags;
  const pin = await promptKeep(rl, "置顶(y/n)", link.pinned ? "y" : "n");
  if (pin === "y") opts.pin = "true";
  else if (pin === "n") opts.unpin = "true";

  if (!Object.keys(opts).length) { log("[提示] 未做任何修改"); return; }
  cmdUpdate({ positional: ["update", link.id], opts });
  log("提示: 完成后选 7 推送部署");
}

async function interactiveRemove(rl) {
  const { links } = readAll();
  if (!links.length) { await fail(rl, "暂无链接"); return; }
  pickLink(rl, links, "remove");
  const idx = parseInt(await ask(rl, "\n选择要删除的链接编号: "), 10);
  const link = links[idx - 1];
  if (!link) { await fail(rl, "编号无效"); return; }
  const confirm = (await ask(rl, `确认删除「${link.title}」? (y/n): `)).trim().toLowerCase();
  if (confirm !== "y") { log("已取消"); return; }
  cmdRemove({ positional: ["remove", link.id] });
  log("提示: 完成后选 7 推送部署");
}

async function interactiveCategories(rl) {
  log("\n  1. 查看分区  2. 新建分区  0. 返回");
  const c = (await ask(rl, "选择: ")).trim();
  if (c === "1") cmdCategories();
  else if (c === "2") {
    const name = (await ask(rl, "分区名称: ")).trim();
    if (!name) { await fail(rl, "名称不能为空"); return; }
    const icon = (await ask(rl, "图标（可填 emoji 或图片 URL，回车用默认）: ")).trim();
    const desc = (await ask(rl, "描述（回车跳过）: ")).trim();
    cmdAddCategory({
      positional: ["add-category", name],
      opts: { icon: icon || undefined, desc: desc || undefined },
    });
  }
}

async function interactivePush(rl) {
  // 推送前先校验数据
  cmdValidate();
  if (process.exitCode) {
    process.exitCode = 0;
    log("[错误] 数据校验未通过，已取消推送");
    return;
  }
  const msg = (await ask(rl, "提交说明（回车默认 nav: update links）: ")).trim();
  cmdPush({ positional: ["push", msg || undefined] });
}

async function cmdInteractive() {
  const rl = createInterface({ input, output });
  let running = true;
  try {
    log(MENU);
    while (running) {
      const choice = (await ask(rl, "\n请选择操作: ")).trim();
      switch (choice) {
        case "1": cmdList({ positional: ["list"], opts: {} }); break;
        case "2": await interactiveAdd(rl); break;
        case "3": await interactiveUpdate(rl); break;
        case "4": await interactiveRemove(rl); break;
        case "5": cmdSort({ opts: {} }); break;
        case "6": await interactiveCategories(rl); break;
        case "7": await interactivePush(rl); break;
        case "0": running = false; break;
        default: log("[错误] 无效选项，请输入菜单编号");
      }
    }
    log("再见！");
  } finally {
    rl.close();
  }
}

/* ---------------- 入口 ---------------- */

const USAGE = `导航页管理脚本
用法: node scripts/manage.mjs <命令> [参数...]
命令:
  list [分类]                 查看链接
  add <分类> <标题> <URL>     添加链接 [--desc] [--icon] [--tags a,b] [--pin]
  update <标题|id|URL>        修改链接 [--title] [--url] [--category] [--desc] [--icon] [--tags] [--pin|--unpin]
  remove <标题|id|URL>        删除链接
  sort [--category id]        自动排序
  categories                  查看分区
  add-category <名称>         新建分区 [--icon] [--desc]
  remove-category <id|名称>   删除分区 [--force]
  validate                    校验数据
  push [提交说明]              git 提交并推送（触发 Pages 构建）
  interactive                 一键交互菜单（配合 manage-nav.bat 双击使用）`;

function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  try {
    switch (cmd) {
      case "list": return cmdList({ positional, opts });
      case "add": return cmdAdd({ positional, opts });
      case "update": return cmdUpdate({ positional, opts });
      case "remove": return cmdRemove({ positional });
      case "sort": return cmdSort({ opts });
      case "categories": return cmdCategories();
      case "add-category": return cmdAddCategory({ positional, opts });
      case "remove-category": return cmdRemoveCategory({ positional, opts });
      case "validate": return cmdValidate();
      case "push": return cmdPush({ positional });
      case "interactive": return cmdInteractive().catch((err) => {
        console.error(`[错误] ${err.message}`);
        process.exitCode = 1;
      });
      case undefined:
      case "help":
      case "-h":
      case "--help":
        return log(USAGE);
      default:
        throw new Error(`未知命令: ${cmd}\n\n${USAGE}`);
    }
  } catch (err) {
    console.error(`[错误] ${err.message}`);
    process.exitCode = 1;
  }
}

main();

