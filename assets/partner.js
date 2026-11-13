(function () {
  const SB_URL = (typeof INTL_SB_URL !== 'undefined') ? INTL_SB_URL : 'https://fckqmlwkujixwztzqqni.supabase.co';
  const SB_ANON = (typeof INTL_SB_ANON !== 'undefined') ? INTL_SB_ANON : '';
  const HUB = 'https://myacc.r6t5.dpdns.org/?app=open-platform&country=cf&return=' + encodeURIComponent(location.href);
  const SQL = `-- 在 R6T5 Hub 的 Supabase（国际节点）SQL Editor 执行一次
create table if not exists public.partner_profile (
  id uuid primary key default gen_random_uuid(),
  hub_sub text unique not null,
  email text,
  plan text default 'free',
  created_at timestamptz default now()
);

create table if not exists public.partner_supabase (
  partner_id uuid primary key references public.partner_profile(id) on delete cascade,
  url text not null,
  anon_key text not null,
  verify_token text,
  status text default 'pending',
  embed_enabled boolean default false,
  verified_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists public.partner_app (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.partner_profile(id) on delete cascade,
  emoji text default '📄',
  name text not null,
  site_url text,
  created_at timestamptz default now()
);

alter table public.partner_profile enable row level security;
alter table public.partner_supabase enable row level security;
alter table public.partner_app enable row level security;

drop policy if exists p_self on public.partner_profile;
create policy p_self on public.partner_profile for all
  using (hub_sub = coalesce(auth.jwt()->>'sub','')) with check (hub_sub = coalesce(auth.jwt()->>'sub',''));

drop policy if exists s_self on public.partner_supabase;
create policy s_self on public.partner_supabase for all
  using (partner_id in (select id from public.partner_profile where hub_sub = coalesce(auth.jwt()->>'sub','')))
  with check (partner_id in (select id from public.partner_profile where hub_sub = coalesce(auth.jwt()->>'sub','')));

drop policy if exists a_self on public.partner_app;
create policy a_self on public.partner_app for all
  using (partner_id in (select id from public.partner_profile where hub_sub = coalesce(auth.jwt()->>'sub','')))
  with check (partner_id in (select id from public.partner_profile where hub_sub = coalesce(auth.jwt()->>'sub','')));

-- 给嵌入组件公开读取（只读，且仅已开通嵌入的站点）
drop policy if exists s_public on public.partner_supabase;
create policy s_public on public.partner_supabase for select
  using (embed_enabled = true);

drop policy if exists a_public on public.partner_app;
create policy a_public on public.partner_app for select
  using (partner_id in (select partner_id from public.partner_supabase where embed_enabled = true));
`;

  const $ = id => document.getElementById(id);
  const setMsg = (id, text, kind) => { const el = $(id); if (!el) return; el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); };

  let token = null;
  let me = null;          // { email, sub }
  let profile = null;     // partner_profile 行
  let apps = [];

  async function getToken() {
    try {
      if (typeof sbGetAccessToken === 'function') return await sbGetAccessToken();
    } catch (e) {}
    return null;
  }

  async function rest(path, opt) {
    opt = opt || {};
    const headers = Object.assign({
      apikey: SB_ANON,
      Authorization: 'Bearer ' + (token || SB_ANON),
      'Content-Type': 'application/json',
    }, opt.headers || {});
    const r = await fetch(SB_URL + '/rest/v1/' + path, { method: opt.method || 'GET', headers, body: opt.body });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!r.ok) {
      const err = new Error((data && (data.message || data.error_description)) || ('HTTP ' + r.status));
      err.status = r.status; err.data = data;
      throw err;
    }
    return data;
  }

  function status(text, kind) {
    const el = $('status'); if (!el) return;
    el.textContent = text;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  async function boot() {
    token = await getToken();
    const hubUser = (typeof sbGetUser === 'function') ? sbGetUser() : null;
    renderAuth(hubUser);

    if (!hubUser) { status('请先登录 R6T5 Hub 账号', 'warn'); lockUI(true); return; }
    if (!token) {
      status('已识别账号 ' + (hubUser.email || '') + '，但缺少 Supabase 会话：写库会被拒。请从 Hub 重新登录一次（带 return 回来）', 'warn');
      lockUI(true);
      return;
    }
    lockUI(false);
    try {
      me = await fetchMe();
      if (!me || !me.sub) { status('无法解析 Supabase 用户，请重试', 'err'); lockUI(true); return; }
      await ensureProfile(hubUser);
      status('已登录：' + (hubUser.email || me.email || ''), 'ok');
      await refreshAll();
    } catch (e) {
      status('读取失败：' + e.message + (e.status === 404 || e.status === 400 ? '（数据库可能还没建表，先执行下方 SQL）' : ''), 'err');
    }
  }

  async function fetchMe() {
    const r = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    return await r.json();
  }

  async function ensureProfile(hubUser) {
    const sub = me.id;
    const rows = await rest('partner_profile?select=*&hub_sub=eq.' + encodeURIComponent(sub));
    if (rows && rows.length) { profile = rows[0]; return; }
    const ins = await rest('partner_profile', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ hub_sub: sub, email: me.email || hubUser.email || '' }),
    });
    profile = Array.isArray(ins) ? ins[0] : null;
  }

  function renderAuth(hubUser) {
    const btn = $('authBtn'), label = $('authLabel'), av = $('authAvatar'), mail = $('authMail');
    if (!btn) return;
    btn.hidden = false;
    if (hubUser) {
      const name = (hubUser.name || hubUser.email || '').trim();
      label.textContent = (hubUser.email || name).split('@')[0].slice(0, 14);
      av.textContent = name.slice(0, 1) || 'U';
      mail.textContent = hubUser.email || '';
    } else {
      label.textContent = '登录';
      av.textContent = '·';
    }
    btn.onclick = () => { if (hubUser) { $('authMenu').hidden = !$('authMenu').hidden; } else location.href = HUB; };
    $('authLogout').onclick = async () => { try { await msLogout(location.href); } catch (e) { location.reload(); } };
    document.addEventListener('click', e => { if (!e.target.closest('.auth-wrap')) $('authMenu').hidden = true; });
  }

  function lockUI(locked) {
    ['saveBind', 'clearBind', 'addApp'].forEach(id => { const b = $(id); if (b) b.disabled = locked; });
  }

  async function refreshAll() {
    await loadBinding();
    await loadApps();
  }

  // ---------- 绑定 ----------
  async function loadBinding() {
    const rows = await rest('partner_supabase?select=*&partner_id=eq.' + profile.id);
    const b = rows && rows[0];
    if (!b) { setMsg('bindMsg', '还没有绑定 Supabase。'); return; }
    $('sbUrl').value = b.url || '';
    $('sbAnon').value = b.anon_key || '';
    setMsg('bindMsg', '状态：' + (b.status === 'verified' ? '已验证 ✓' : '待验证（需在对方项目写入校验表）'), b.status === 'verified' ? 'ok' : '');
  }

  function decodeJwtRole(key) {
    try {
      const p = key.split('.')[1];
      const json = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
      return json.role || '';
    } catch (e) { return ''; }
  }

  async function probe(url, key) {
    const r = await fetch(url.replace(/\/$/, '') + '/auth/v1/settings', { headers: { apikey: key } });
    if (!r.ok) throw new Error('探活失败：' + r.status);
    return true;
  }

  async function saveBind() {
    const url = $('sbUrl').value.trim().replace(/\/$/, '');
    const key = $('sbAnon').value.trim();
    setMsg('bindMsg', '');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) return setMsg('bindMsg', 'URL 必须是 https://xxx.supabase.co', 'err');
    if (!key) return setMsg('bindMsg', '请填写 anon key', 'err');
    if (decodeJwtRole(key) !== 'anon') return setMsg('bindMsg', '这不像 anon key（解出 role=' + (decodeJwtRole(key) || '未知') + '），service_role 禁止填入', 'err');
    try {
      await probe(url, key);
    } catch (e) { return setMsg('bindMsg', e.message, 'err'); }

    const verify = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b => b.toString(16).padStart(2, '0')).join('');
    try {
      await rest('partner_supabase?partner_id=eq.' + profile.id, { method: 'DELETE' });
      await rest('partner_supabase', {
        method: 'POST',
        body: JSON.stringify({ partner_id: profile.id, url, anon_key: key, verify_token: verify, status: 'pending', embed_enabled: !!(profile && profile.plan === 'pro') }),
      });
      setMsg('bindMsg', '已保存（探活通过）。归属验证：在 ' + url + ' 建表 r6t5_verify(token text)，写入 ' + verify + '，然后点「校验归属」。', 'ok');
    } catch (e) {
      setMsg('bindMsg', '保存失败：' + e.message + (e.status === 401 ? '（当前缺少 Supabase 会话，REST 写库被拒）' : ''), 'err');
    }
  }

  // ---------- 应用 ----------
  async function loadApps() {
    apps = await rest('partner_app?select=*&partner_id=eq.' + profile.id + '&order=created_at.desc') || [];
    $('appCount').textContent = apps.length + ' 个';
    const box = $('appList');
    if (!apps.length) { box.innerHTML = '<p class="empty">还没有应用，先在上面登记一个。</p>'; renderCode(); return; }
    box.innerHTML = apps.map(a =>
      '<div class="app-item"><div class="app-icon">' + esc(a.emoji || '📄') + '</div>'
      + '<div class="app-meta"><div class="app-name">' + esc(a.name) + '</div>'
      + '<div class="app-url">' + esc(a.site_url || '未填官网') + '</div></div>'
      + '<button class="btn sm" data-code="' + a.id + '">嵌入代码</button>'
      + '<button class="btn sm ghost" data-preview="' + a.id + '">预览</button>'
      + '<button class="btn sm ghost" data-del="' + a.id + '">删除</button></div>'
    ).join('');
    renderCode();
  }

  async function addApp() {
    const name = $('appName').value.trim();
    const url = $('appUrl').value.trim();
    const emoji = $('appEmoji').value.trim() || '📄';
    setMsg('appMsg', '');
    if (!name) return setMsg('appMsg', '请填应用名称', 'err');
    if (url && !/^https:\/\//i.test(url)) return setMsg('appMsg', '官网链接必须以 https:// 开头', 'err');
    try {
      await rest('partner_app', {
        method: 'POST',
        body: JSON.stringify({ partner_id: profile.id, emoji, name, site_url: url }),
      });
      $('appName').value = ''; $('appUrl').value = '';
      setMsg('appMsg', '已添加', 'ok');
      await loadApps();
    } catch (e) { setMsg('appMsg', '添加失败：' + e.message, 'err'); }
  }

  async function delApp(id) {
    if (!confirm('删除这个应用？嵌入代码会立刻失效。')) return;
    try { await rest('partner_app?id=eq.' + id, { method: 'DELETE' }); await loadApps(); }
    catch (e) { setMsg('appMsg', '删除失败：' + e.message, 'err'); }
  }

  // ---------- 嵌入 ----------
  function embedEnabled() {
    return !!(profile && profile.plan === 'pro');
  }

  function snippet(appId) {
    const origin = location.origin;
    return `<iframe src="${origin}/embed.html?app=${appId}" width="420" height="520" style="border:0;max-width:100%" title="登录"></iframe>`;
  }

  let currentTab = 'html';
  function renderCode() {
    const box = $('codeBox'); if (!box) return;
    const app = apps[0];
    if (!app) { box.textContent = '先登记一个应用，这里会生成可复制的嵌入代码。'; return; }
    if (!embedEnabled()) {
      box.textContent = '当前账号不是专业版授权，内嵌组件受限。\n升级专业版后，这里会生成 iframe 代码与接入说明。';
      return;
    }
    box.textContent = currentTab === 'html' ? snippet(app.id) : `<!-- 1) 把下面这段贴到你的站点 -->
${snippet(app.id)}

<!-- 2) 接收登录结果（宿主页） -->
<script>
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'r6t5:auth') {
    console.log('登录成功', e.data.user, e.data.access_token);
    // 用 R6T5 Hub 的 JWKS 校验 access_token，sub 作为用户主键
  }
});
<\/script>`;
  }

  // ---------- 初始化 ----------
  const EMOJIS = ['📄','📘','🎓','🧠','🗂️','🔖','📝','🧩','⚙️','🌐','💡','📊'];
  function initEmojiRow() {
    const row = $('emojiRow'); if (!row) return;
    row.innerHTML = EMOJIS.map(e => '<button type="button">' + e + '</button>').join('');
    row.querySelectorAll('button').forEach(b => b.onclick = () => { $('appEmoji').value = b.textContent; });
  }

  document.addEventListener('DOMContentLoaded', initEmojiRow);
  document.addEventListener('DOMContentLoaded', () => {
    $('saveBind').onclick = saveBind;
    $('clearBind').onclick = async () => {
      if (!profile) return;
      await rest('partner_supabase?partner_id=eq.' + profile.id, { method: 'DELETE' });
      $('sbUrl').value = ''; $('sbAnon').value = ''; setMsg('bindMsg', '已清除绑定');
    };
    $('addApp').onclick = addApp;
    $('appList').addEventListener('click', e => {
      const code = e.target.closest('[data-code]');
      const del = e.target.closest('[data-del]');
      const pv = e.target.closest('[data-preview]');
      if (code) {
        if (!embedEnabled()) { setMsg('appMsg', '需要专业版授权才能使用内嵌组件', 'err'); return; }
        navigator.clipboard.writeText(snippet(code.dataset.code)).then(() => setMsg('appMsg', '嵌入代码已复制', 'ok'));
      }
      if (del) delApp(del.dataset.del);
      if (pv) window.open(location.origin + '/embed.html?app=' + pv.dataset.preview, '_blank');
    });
    $('copyCode').onclick = () => navigator.clipboard.writeText($('codeBox').textContent).then(() => setMsg('appMsg', '已复制', 'ok'));
    document.querySelectorAll('.tabs [data-tab]').forEach(b => b.onclick = () => {
      currentTab = b.dataset.tab;
      document.querySelectorAll('.tabs [data-tab]').forEach(x => x.classList.toggle('on', x === b));
      renderCode();
    });
    $('previewBtn').onclick = () => { if (apps[0]) window.open(location.origin + '/embed.html?app=' + apps[0].id, '_blank'); };
    $('sqlBox').textContent = SQL;
    $('copySql').onclick = () => navigator.clipboard.writeText(SQL).then(() => setMsg('bindMsg', 'SQL 已复制', 'ok'));
    boot();
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
