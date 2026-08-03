# 导航页（Cloudflare Pages 自动部署版）

个人导航首页：**分区管理**（个人工具 / 网页管理 / 开发资源…）、**自动排序**、实时搜索、暗色/亮色主题。
数据全部存放在 `data/*.json`，通过配套脚本增删改，推送 GitHub 后 **Cloudflare Pages 自动重新构建部署**。

## 特性

- 🔖 **分区管理**：`categories.json` 定义分区（个人工具、网页管理、开发资源…），链接归属分区
- 🔤 **自动排序**：每个分区内自动 `置顶(pinned) → order → 中文标题拼音序` 排序，脚本与前端双重保证
- 🔍 **实时搜索**：按标题/描述/URL/标签过滤并高亮，`/` 聚焦、`Esc` 清空
- 🌗 **主题切换**：auto（跟随系统）/ 暗色 / 亮色，快捷键 `T`
- 📦 **零构建**：纯静态 HTML/CSS/JS + JSON，无框架无依赖，Cloudflare Pages 直接托管
- 🧰 **管理脚本**：`scripts/manage.mjs`（Node 零依赖），增删改查 + 排序 + 校验 + 一键 git 推送

## 设计参考

界面设计参考了以下产品的风格与信息架构（详见 `assets/style.css` 头部注释）：

| 参考对象 | 借鉴点 |
|---|---|
| [Linear](https://linear.app) | 暗色底、柔和品牌光晕、1px 细边框、150ms 过渡、紫蓝品牌色 |
| [Vercel](https://vercel.com) | 卡片 hover 边框提亮 + 轻微位移、搜索框、小号大写分区标题、空态 |
| [Homepage](https://gethomepage.dev) | 自托管导航仪表盘的分区 + 图标卡片网格信息架构 |

## 目录结构

```
├── index.html              # 页面骨架
├── assets/
│   ├── style.css           # 样式（设计系统）
│   └── app.js              # 渲染/搜索/主题逻辑
├── data/
│   ├── site.json           # 站点标题、页脚、GitHub 链接
│   ├── categories.json     # 分区定义
│   └── links.json          # 链接数据（脚本维护）
├── scripts/
│   └── manage.mjs          # 管理脚本（增删改查/排序/校验/推送）
└── README.md
```

## 快速开始

```powershell
# 1. 本地预览（任选其一）
npx serve .                    # 或
python -m http.server 8000     # 或直接双击 index.html（需本地 HTTP 服务，JSON 用 fetch 加载）

# 2. 查看数据
node scripts/manage.mjs list

# 3. 添加一个链接（自动排序、自动生成 id）
node scripts/manage.mjs add 网页管理 "Nginx Proxy Manager" "http://192.168.1.1:81" --desc "反代与 SSL" --tags nginx,ssl

# 4. 修改 / 删除
node scripts/manage.mjs update "Nginx Proxy Manager" --title "NPM 面板" --pin
node scripts/manage.mjs remove "NPM 面板"

# 5. 校验数据完整性
node scripts/manage.mjs validate

# 6. 提交并推送 → Cloudflare Pages 自动构建
node scripts/manage.mjs push "nav: 添加 NPM 面板"
```

## 管理脚本速查

```powershell
node scripts/manage.mjs list [分类]
node scripts/manage.mjs add <分类> <标题> <URL> [--desc 描述] [--icon 图标URL] [--tags a,b,c] [--pin]
node scripts/manage.mjs update <标题|id|URL> [--title] [--url] [--category] [--desc] [--icon] [--tags] [--pin|--unpin]
node scripts/manage.mjs remove <标题|id|URL>
node scripts/manage.mjs sort [--category 分类id]
node scripts/manage.mjs categories
node scripts/manage.mjs add-category <名称> [--icon 🧰] [--desc 描述]
node scripts/manage.mjs remove-category <id|名称> [--force]
node scripts/manage.mjs validate
node scripts/manage.mjs push [提交说明]
```

> 要求 Node.js ≥ 18（零 npm 依赖）。中文标题按拼音排序（Node 内置 `Intl.Collator`）。

## 部署：Cloudflare Pages + GitHub（推荐）

目标链路：**脚本改 JSON → git push → Cloudflare 自动构建 → 网页更新**。

1. **推到 GitHub**（先建好仓库，然后把本地代码推上去）：

   ```powershell
   git init
   git add -A
   git commit -m "nav: init"
   git branch -M main
   git remote add origin git@github.com:<你的用户名>/<仓库名>.git
   git push -u origin main
   ```

2. **创建 Pages 项目**（[Cloudflare Dashboard → Workers & Pages → Create → Pages](https://dash.cloudflare.com)）：
   - 选择 **Connect to Git**，授权并选中上面的仓库
   - **Project name**：`my-nav`（部署后域名 `my-nav.pages.dev`）
   - **Build command**：留空（纯静态）
   - **Build output directory**：`/`（仓库根目录）
   - 点 **Save and Deploy**，首次部署完成

3. **自动更新**：之后每次 `node scripts/manage.mjs push "说明"`（= git commit + push），Cloudflare Pages 自动检测到 main 分支新提交并重新构建，几十秒后网页更新完毕。

4. **自定义域名**（可选）：Pages 项目 → Custom domains → 绑定你的域名并选择 CNAME 指向 `*.pages.dev`。

### 备选：wrangler CLI 手动部署

如果不想用 Git 集成，也可以本地构建后直接推：

```powershell
npm i -g wrangler
wrangler login
wrangler pages deploy . --project-name my-nav
```

（二选一即可，Git 集成方式与脚本 `push` 配合最省事。）

## 数据格式

`data/links.json` 每条链接：

```json
{
  "id": "nginx-proxy-manager-a1b2",   // 自动生成，保持稳定
  "title": "Nginx Proxy Manager",
  "url": "http://192.168.1.1:81",
  "category": "web-admin",            // 对应 categories.json 的 id
  "description": "反向代理与 SSL 证书面板",
  "icon": "",                         // 留空自动取站点 favicon；也可填 emoji 或图片 URL
  "tags": ["nginx", "proxy"],
  "pinned": false,                    // true 置顶
  "order": 3                          // 由 sort 命令自动维护
}
```

`data/categories.json` 每条分区：`id`（唯一）、`name`、`icon`（emoji）、`description`、`order`。

> 前端渲染时会再次自动排序（pinned → order → 拼音），即使手改 JSON 顺序错乱也会被纠正。
> 示例数据（Cloudflare 控制台、GitHub 等）可自行用脚本删除替换。

## 常见问题

- **图标不显示**？`icon` 留空时走 Google favicon 服务（`google.com/s2/favicons`），内网/无外网环境会回退显示标题首字母；也可手动填 `icon` 字段。
- **推送失败**？确认已 `git remote add origin ...` 且已登录 GitHub（SSH key 或 HTTPS 凭据）。
- **改了数据网页没更新**？检查 Cloudflare Pages 构建日志是否成功，以及是否推到了 Pages 关联的分支（默认 `main`）。
