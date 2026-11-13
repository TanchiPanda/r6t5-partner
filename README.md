# r6t5-partner · R6T5 合作伙伴控制台

`https://partner.r6t5.dpdns.org`（GitHub Pages + CNAME）

## 能做什么

用 R6T5 Hub 账号登录后：

1. **绑定自己的 Supabase**（URL + anon key，探活 + 归属校验）
2. **登记应用**：emoji 图标 + 名称 + 官网链接
3. **取嵌入登录组件**：`embed.html?app=<id>` 的 iframe 代码，含邮箱登录/注册与「或 · R6T5 Hub 通行证登录」

非专业版账号可以用 1、2，**内嵌组件受限**（`partner_profile.plan` 为 `pro` 且绑定行 `embed_enabled=true` 才放行）。

## 数据

全部存在 R6T5 Hub 的国际节点 Supabase：`fckqmlwkujixwztzqqni`。表结构与 RLS 见页面底部「数据库准备」，或本仓库 `supabase/schema.sql`。

## 部署

纯静态，推 `main` 即由 GitHub Pages 发布；`CNAME` 已写 `partner.r6t5.dpdns.org`，DNS 侧加一条 CNAME 指向 `tanchipanda.github.io`。
