/* MIDAD Theme Management System - stable, route-safe, additive layer. */
(() => {
  const SUPABASE_URL = "https://clobfjrjhdysmqhbwzlc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_LEFYVl0Y8VOnMIbBZev1Vg_0pYSMWpv";
  if (!window.supabase) return;

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // Canonical map to the files that actually exist in the repository.
  const THEME_MAP = {
    "theme-1": { display_name: "التصميم 1", theme_js: './themes/theme-1.js' },
    "theme-2": { display_name: "التصميم الأخضر", theme_js: './themes/theme-2.js' },
    "theme-3": { display_name: "التصميم الإبداعي", theme_js: './themes/theme-3.js' },
    "theme-4": { display_name: "التصميم التحريري", theme_js: './themes/theme-4.js' },
    "theme-5": { display_name: "الرمادي المصقول والكهرماني", theme_js: './themes/theme-5.js' },
    "theme-6": { display_name: "الأزرق الملكي والذهبي", theme_js: './themes/theme-6.js' },
    "theme-7": { display_name: "دراسة الزمرد", theme_js: './themes/theme-7.js' },
    "theme-8": { display_name: "العنابي الملكي والشمبانيا", theme_js: './themes/theme-8.js' },
    "theme-baby-blue": { display_name: "الأزرق الفاتح", theme_js: './themes/theme-baby-blue.js' },
    "theme-aurora-glass": { display_name: "زجاج الشفق", theme_js: './themes/theme-aurora-glass.js' },
    "theme-warda-pink": { display_name: "الوردي الورد", theme_js: './themes/theme-warda-pink.js' },
    "theme-legend-pink": { display_name: "الوردي الأسطوري", theme_js: './themes/theme-legend-pink.js' },
    "theme-legend-babyblue": { display_name: "بيبي بلو الأسطوري", theme_js: './themes/theme-legend-babyblue.js' },
    "theme-legend-night": { display_name: "الليل الساحر", theme_js: './themes/theme-legend-night.js' },
    "theme-pop-pink": { display_name: "وردي بابلجم", theme_js: './themes/theme-pop-pink.js' },
    "theme-frost-blue": { display_name: "الجليدي", theme_js: './themes/theme-frost-blue.js' },
    "theme-galaxy": { display_name: "المجرة", theme_js: './themes/theme-galaxy.js' },
    "theme-forest": { display_name: "الغابة الساحرة", theme_js: './themes/theme-forest.js' },
    'theme-emerald': { display_name: 'التصميم الأخضر', theme_js: './themes/theme-2.js' },
    'theme-editorial': { display_name: 'التصميم التحريري', theme_js: './themes/theme-4.js' },
    'theme-saas': { display_name: 'التصميم الإبداعي', theme_js: './themes/theme-3.js' },
  };

  const state = { themes: [], user: null, profile: null, isAdmin: false, userThemeButtonEnabled: false, userThemeBottomButtonEnabled: false };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = v => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  function infoFor(t) {
    const key = canonicalKey(String(t?.theme_key || '').trim());
    const map = THEME_MAP[key];
    if (map) return map;
    return { display_name: t?.display_name || key || 'سمة', theme_js: './themes/theme-1.js' };
  }

  function displayName(t) {
    const key = canonicalKey(String(t?.theme_key || '').trim());
    const raw = String(t?.display_name || '').trim();
    if (key === 'theme-2' && (raw === 'التصميم الإبداعي' || raw.startsWith('التصميم الإبداعي - نسخة'))) return raw.replace(/^التصميم الإبداعي/, 'التصميم الأخضر');
    if (key === 'theme-3' && (raw === 'التصميم الأخضر' || raw.startsWith('التصميم الأخضر - نسخة'))) return raw.replace(/^التصميم الأخضر/, 'التصميم الإبداعي');
    return raw || infoFor(t).display_name;
  }

  function canonicalRoute(t) { return infoFor(t).theme_js; }

  function currentThemeKey() { return String(window.__midadThemeKey || 'theme-1'); }

  function canonicalKey(key) {
    if (key === 'theme-emerald') return 'theme-2';
    if (key === 'theme-editorial') return 'theme-4';
    if (key === 'theme-saas') return 'theme-3';
    return key;
  }

  function normalizeThemeRow(row) {
    const key = canonicalKey(String(row?.theme_key || '').trim());
    const def = THEME_MAP[key];
    return { ...row, theme_key: key, theme_js: def?.theme_js || row?.theme_js || './themes/theme-1.js' };
  }

  const toast = (msg, ok = true) => {
    let x = document.getElementById('midad-theme-toast');
    if (!x) {
      x = document.createElement('div');
      x.id = 'midad-theme-toast';
      x.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);z-index:100000;background:#111827;color:#fff;padding:12px 18px;border-radius:14px;box-shadow:0 15px 45px rgba(0,0,0,.2);opacity:0;transition:.25s;font:700 14px Cairo,sans-serif;direction:rtl';
      document.body.appendChild(x);
    }
    x.textContent = msg;
    x.style.border = '1px solid ' + (ok ? '#34d399' : '#f87171');
    requestAnimationFrame(() => { x.style.opacity = 1; x.style.transform = 'translateX(-50%) translateY(0)'; });
    clearTimeout(x._hideTimer);
    x._hideTimer = setTimeout(() => { x.style.opacity = 0; x.style.transform = 'translateX(-50%) translateY(20px)'; }, 2600);
  };

  async function session() {
    const { data } = await client.auth.getSession();
    return data?.session || null;
  }

  async function getProfile(uid) {
    const { data, error } = await client.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function loadThemes() {
    const { data, error } = await client.from('platform_themes').select('*').order('sort_order', { ascending: true });
    if (error || !Array.isArray(data)) {
      state.themes = Object.entries(THEME_MAP)
        .filter(([k]) => ['theme-1','theme-2','theme-3','theme-4','theme-5','theme-6','theme-7','theme-8','theme-baby-blue','theme-aurora-glass','theme-warda-pink','theme-legend-pink','theme-legend-babyblue','theme-legend-night','theme-pop-pink','theme-frost-blue','theme-galaxy','theme-forest'].includes(k))
        .map(([theme_key, x], i) => ({ id: null, theme_key, display_name: x.display_name, sort_order: i + 1, theme_js: x.theme_js, is_active: true, is_default: theme_key === 'theme-1' }));
      return state.themes;
    }
    state.themes = data.filter(x => x.is_active !== false).map(normalizeThemeRow).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    if (!state.themes.length) {
      state.themes = Object.entries(THEME_MAP)
        .filter(([k]) => ['theme-1','theme-2','theme-3','theme-4','theme-5','theme-6','theme-7','theme-8','theme-baby-blue','theme-aurora-glass','theme-warda-pink','theme-legend-pink','theme-legend-babyblue','theme-legend-night','theme-pop-pink','theme-frost-blue','theme-galaxy','theme-forest'].includes(k))
        .map(([theme_key, x], i) => ({ id: null, theme_key, display_name: x.display_name, sort_order: i + 1, theme_js: x.theme_js, is_active: true, is_default: theme_key === 'theme-1' }));
    }
    return state.themes;
  }

  let themeStyleNodes = [];

  async function loadThemeDefinition(key) {
    key = canonicalKey(key) || 'theme-1';
    window.MIDAD_THEME_DEFINITIONS = window.MIDAD_THEME_DEFINITIONS || {};
    if (window.MIDAD_THEME_DEFINITIONS[key]) return window.MIDAD_THEME_DEFINITIONS[key];
    const map = THEME_MAP[key] || THEME_MAP['theme-1'];
    const src = new URL(map.theme_js || './themes/theme-1.js', document.baseURI).href;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src; script.async = true;
      script.onload = resolve; script.onerror = () => reject(new Error('تعذر تحميل ملف السمة'));
      document.head.appendChild(script);
    });
    return window.MIDAD_THEME_DEFINITIONS[key] || window.MIDAD_THEME_DEFINITIONS['theme-1'];
  }

  function clearThemeAssets() {
    document.querySelectorAll('[data-midad-theme-style]').forEach(n => n.remove());
    document.querySelectorAll('[data-midad-theme-decoration]').forEach(n => n.remove());
    themeStyleNodes = [];
    if (document.body) {
      [...document.body.classList].filter(c => c === 'theme-saas' || c === 'theme-editorial').forEach(c => document.body.classList.remove(c));
    }
  }

  function injectStyle(css, label) {
    if (!css) return;
    const s = document.createElement('style');
    s.dataset.midadThemeStyle = label || 'theme';
    s.textContent = css;
    document.head.appendChild(s);
    themeStyleNodes.push(s);
  }

  function injectDecorations(html) {
    if (!html) return;
    const holder = document.createElement('template');
    holder.innerHTML = html;
    [...holder.content.childNodes].forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        node.setAttribute('data-midad-theme-decoration', '1');
        document.body.insertBefore(node, document.getElementById('app') || null);
      }
    });
  }

  async function applyTheme(key, silent = false) {
    key = canonicalKey(key) || 'theme-1';
    const def = await loadThemeDefinition(key);
    clearThemeAssets();
    injectStyle(def.css, 'theme-base');
    (def.extra_css || []).forEach((css, i) => injectStyle(css, 'theme-extra-' + i));
    if (def.body_class) document.body.classList.add(def.body_class);
    injectDecorations(def.decorations || '');
    window.__midadThemeKey = key;
    document.documentElement.dataset.midadTheme = key;
    if (!silent) toast('تم تغيير السمة');
    return key;
  }
  window.midadApplyTheme = applyTheme;

  async function choose(uid) {
    try {
      const { data: pref } = await client.from('user_theme_preferences').select('theme_id').eq('user_id', uid).maybeSingle();
      const themes = await loadThemes();
      if (pref?.theme_id) {
        const t = themes.find(x => String(x.id) === String(pref.theme_id));
        if (t) return canonicalKey(t.theme_key);
      }
      const t = themes.find(x => x.is_default) || themes[0];
      return canonicalKey(t?.theme_key || 'theme-1');
    } catch (_) { return 'theme-1'; }
  }
  window.midadChooseTheme = choose;

  async function init() {
    const s = await session();
    if (!s) return;
    state.user = s.user;
    state.profile = await getProfile(s.user.id).catch(() => null);
    state.isAdmin = ['admin', 'super_admin'].includes(state.profile?.role);
    await loadThemes();
    let targetKey = 'theme-1';
    try {
      const { data: pref } = await client.from('user_theme_preferences').select('theme_id').eq('user_id', s.user.id).maybeSingle();
      const target = pref?.theme_id ? state.themes.find(x => String(x.id) === String(pref.theme_id)) : null;
      targetKey = canonicalKey(target?.theme_key || state.themes.find(x => x.is_default)?.theme_key || 'theme-1');
    } catch (_) {}
    await applyTheme(targetKey, true);
    if (state.isAdmin && !window.__midadViewAsMember) { setupAdminUI(); observeThemeButton(); }
    else { await setupUserThemeButton(); observeThemeButton(); }
  }

  function createThemeButton(id, position) {
    let b = document.getElementById(id);
    if (!b) {
      b = document.createElement('button');
      b.id = id;
      b.type = 'button';
      b.innerHTML = '<i class="fas fa-palette" aria-hidden="true"></i><span>سمات</span>';
      b.title = 'السمات';
      b.setAttribute('aria-label', 'السمات');
      b.onclick = (e) => { e.stopPropagation(); openThemePicker(state.isAdmin ? 'admin' : 'user'); };
      b.onmouseenter = () => { b.style.transform = 'translateY(-2px)'; };
      b.onmouseleave = () => { b.style.transform = ''; };
    }
    if (position === 'bottom') {
      // Anchored bottom-left, same corner as the admin "إدارة السمات" button
      // (#midadThemeManage), instead of the old center-of-screen placement.
      // These two buttons never render for the same session (one is
      // admin-only, the other member-only) — see addBottomThemeButton and
      // addManageButton — but positionBottomThemeButton() below still
      // defensively re-stacks this one above the manage button if it ever
      // finds both present, so nothing overlaps.
      b.style.cssText = [
        'position:fixed','left:22px','bottom:20px','right:auto','transform:none','z-index:99980',
        'display:inline-flex','align-items:center','justify-content:center','gap:7px','min-width:96px','height:44px','padding:0 15px',
        'border:1px solid var(--border,#e2e8f0)','background:var(--surface,#fff)','color:var(--primary,#0ea5e9)','border-radius:14px',
        'font:800 13px Cairo,sans-serif','cursor:pointer','box-shadow:0 10px 28px rgba(15,23,42,.16)','transition:transform .18s,box-shadow .18s,border-color .18s,bottom .18s',
        'direction:rtl','white-space:nowrap'
      ].join(';');
      return b;
    }
    const host = document.querySelector('#app > header.header');
    if (!host) return null;
    const actions = host.querySelector('.header-actions');
    if (!actions) return null;
    b.style.cssText = [
      'position:relative','left:auto','top:auto','transform:none','z-index:100','display:inline-flex','align-items:center','justify-content:center','gap:7px',
      'min-width:88px','height:40px','padding:0 13px','border:1px solid var(--border,#e2e8f0)','background:var(--surface,#fff)',
      'color:var(--primary,#0ea5e9)','border-radius:12px','font:800 13px Cairo,sans-serif','cursor:pointer','box-shadow:0 4px 14px rgba(15,23,42,.08)',
      'transition:transform .18s,box-shadow .18s,border-color .18s','direction:rtl','white-space:nowrap','flex:0 0 auto','margin:0'
    ].join(';');
    const adminBtn = actions.querySelector('.admin-panel-trigger');
    const managerWrap = actions.querySelector('.manager-trigger-wrap');
    if (state.isAdmin && adminBtn) adminBtn.insertAdjacentElement('afterend', b);
    else if (!state.isAdmin && managerWrap) managerWrap.insertAdjacentElement('beforebegin', b);
    else if (adminBtn) adminBtn.insertAdjacentElement('afterend', b);
    else actions.appendChild(b);
    return b;
  }

  function addThemeButton() {
    createThemeButton('midadThemeButton', 'top');
  }

  function positionBottomThemeButton(b) {
    // Safety net: the member bottom button and the admin "إدارة السمات"
    // button (#midadThemeManage) share the same bottom-left spot but never
    // render for the same session in the current app. If that ever changes
    // and both end up in the DOM together, stack this one above the manage
    // button instead of overlapping it.
    if (!b) return;
    const manage = document.getElementById('midadThemeManage');
    if (manage && manage.offsetParent !== null) {
      b.style.bottom = (20 + manage.offsetHeight + 12) + 'px';
    } else {
      b.style.bottom = '20px';
    }
  }

  function addBottomThemeButton() {
    // Hide on the "subsection" page (the رفوف/rectangles list with the
    // تحميل buttons — window.__midadCurrentView is set by app/index.html's
    // render() on every navigation) since the fixed bottom-left button
    // covers the last row's تحميل label there. It reappears automatically
    // the moment the view changes back, via the same MutationObserver that
    // re-adds this button after every render() — no manual refresh needed.
    if (state.isAdmin || !state.userThemeBottomButtonEnabled || window.__midadViewAsMember || window.__midadCurrentView === 'subsection') {
      const old = document.getElementById('midadThemeBottomButton');
      if (old) old.remove();
      return;
    }
    if (!document.body) return;
    const b = createThemeButton('midadThemeBottomButton', 'bottom');
    if (b && !b.parentNode) document.body.appendChild(b);
    positionBottomThemeButton(b);
  }

  function applyViewAsMemberMode() {
    // Bridge for the "المشاهدة" (view-as-member) toggle in the main app: while
    // active, the admin-only floating buttons this script injects (which live
    // outside #app and so survive normal re-renders) must hide too, for a true
    // member-like preview. #midadThemeButton is forced visible elsewhere with
    // !important, so it must be overridden the same way here.
    const on = !!window.__midadViewAsMember;
    const manageBtn = document.getElementById('midadThemeManage');
    if (manageBtn) manageBtn.style.setProperty('display', on ? 'none' : '', on ? 'important' : '');
    const themeBtn = document.getElementById('midadThemeButton');
    if (themeBtn) themeBtn.style.setProperty('display', on ? 'none' : '', on ? 'important' : '');
    const bottomBtn = document.getElementById('midadThemeBottomButton');
    if (bottomBtn) bottomBtn.style.setProperty('display', on ? 'none' : '', on ? 'important' : '');
  }
  window.__midadApplyViewMode = applyViewAsMemberMode;

  function observeThemeButton() {
    if (window.__midadThemeHeaderObserver) return;
    const start = () => {
      const app = document.querySelector('#app');
      if (!app) return false;
      const obs = new MutationObserver(() => {
        if (window.__midadThemeButtonRaf) cancelAnimationFrame(window.__midadThemeButtonRaf);
        window.__midadThemeButtonRaf = requestAnimationFrame(() => {
          if (state.isAdmin && !window.__midadViewAsMember) addThemeButton();
          else if (!state.isAdmin) {
            if (state.userThemeButtonEnabled) addThemeButton();
            addBottomThemeButton();
          }
        });
      });
      obs.observe(app, {childList:true, subtree:true});
      window.__midadThemeHeaderObserver = obs;
      return true;
    };
    if (!start()) {
      let tries = 0;
      const timer = setInterval(() => {
        tries++;
        if (start() || tries > 40) clearInterval(timer);
      }, 100);
    }
  }

  function setupAdminUI() {
    addManageButton();
    const ensureHeaderButton = () => addThemeButton();
    if (!ensureHeaderButton()) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (ensureHeaderButton() || attempts >= 30) clearInterval(timer);
      }, 150);
    }
    injectPlusButtons();
    observeUsers();
  }

  async function setupUserThemeButton() {
    try {
      const { data: p } = await client.from('user_theme_preferences').select('themes_button_enabled,themes_bottom_button_enabled').eq('user_id', state.user.id).maybeSingle();
      state.userThemeButtonEnabled = !!p?.themes_button_enabled;
      state.userThemeBottomButtonEnabled = !!p?.themes_bottom_button_enabled;
      if (state.userThemeButtonEnabled) addThemeButton();
      if (state.userThemeBottomButtonEnabled) addBottomThemeButton();
    } catch (_) { state.userThemeButtonEnabled = false; }
  }

  function addManageButton() {
    if (document.getElementById('midadThemeManage')) return;
    const btn = document.createElement('button');
    btn.id = 'midadThemeManage';
    btn.type = 'button';
    btn.textContent = 'إدارة السمات';
    btn.style.cssText = 'position:fixed;left:22px;bottom:20px;z-index:99990;border:0;background:linear-gradient(135deg,#0ea5e9,#7c3aed);color:#fff;padding:12px 17px;border-radius:14px;font:800 13px Cairo,sans-serif;box-shadow:0 12px 30px rgba(14,165,233,.25);cursor:pointer;direction:rtl';
    btn.onclick = () => openThemeManager();
    document.body.appendChild(btn);
  }

  function observeUsers() {
    if (window.__midadThemeUsersObserver) return;
    const obs = new MutationObserver(() => injectPlusButtons());
    window.__midadThemeUsersObserver = obs;
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(injectPlusButtons, 300);
    setTimeout(injectPlusButtons, 1000);
  }

  function injectPlusButtons() {
    if (!state.isAdmin) return;
    document.querySelectorAll('.um-user-card').forEach(card => {
      if (card.querySelector('[data-midad-theme-user]')) return;
      const uid = card.querySelector('[data-user-id]')?.getAttribute('data-user-id');
      if (!uid) return;
      const actions = card.querySelector('.um-card-actions') || card;
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-midad-theme-user', '1');
      b.setAttribute('aria-label', 'إعدادات السمات لهذا المستخدم');
      b.title = 'إعدادات السمات لهذا المستخدم';
      b.innerHTML = '<i class="fas fa-palette" aria-hidden="true"></i><span>سمات</span>';
      b.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:38px;padding:8px 12px;border-radius:12px;border:1px solid #bfdbfe;background:linear-gradient(180deg,#eff6ff,#e0f2fe);color:#0369a1;font:800 12px Cairo,sans-serif;cursor:pointer;box-shadow:0 3px 10px rgba(3,105,161,.08);transition:.2s;direction:rtl';
      b.onmouseenter = () => { b.style.transform = 'translateY(-2px)'; b.style.boxShadow = '0 7px 16px rgba(3,105,161,.14)'; };
      b.onmouseleave = () => { b.style.transform = ''; b.style.boxShadow = '0 3px 10px rgba(3,105,161,.08)'; };
      b.onclick = e => { e.stopPropagation(); openUserThemeMenu(uid); };
      actions.prepend(b);
    });
  }

  async function getUserPrefs(uid) {
    try {
      const { data, error } = await client.from('user_theme_preferences').select('*').eq('user_id', uid).maybeSingle();
      if (error) throw error;
      const { data: a } = data ? await client.from('user_allowed_themes').select('theme_id').eq('user_id', uid) : { data: [] };
      return { ...(data || {}), allowed: (a || []).map(x => String(x.theme_id)) };
    } catch (_) { return { allowed: [] }; }
  }

  async function saveUserPrefs(uid, pref, allowed) {
    let { data: old } = await client.from('user_theme_preferences').select('id').eq('user_id', uid).maybeSingle();
    const payload = { user_id: uid, ...pref };
    let err;
    if (old) ({ error: err } = await client.from('user_theme_preferences').update(payload).eq('id', old.id));
    else ({ error: err } = await client.from('user_theme_preferences').insert(payload));
    if (err) throw err;
    await client.from('user_allowed_themes').delete().eq('user_id', uid);
    if (pref.restricted_theme_selection && allowed.length) {
      const rows = allowed.map(id => ({ user_id: uid, theme_id: id }));
      const { error: e } = await client.from('user_allowed_themes').insert(rows);
      if (e) throw e;
    }
  }

  async function openUserThemeMenu(uid) {
    const [themes, pref] = await Promise.all([loadThemes(), getUserPrefs(uid)]);
    const box = document.createElement('div');
    box.className = 'midad-theme-overlay';
    box.innerHTML = `<div class="midad-theme-modal user-theme-modal"><div class="midad-theme-head"><div><b>سمات المستخدم</b><small>حدد شكل المنصة وصلاحيات زر السمات</small></div><button class="midad-x">×</button></div><div class="midad-theme-body">
      <label class="midad-label">1 — اختيار السمة</label><select id="mtUserTheme" class="midad-select"><option value="">استخدام السمة الافتراضية</option>${themes.map(t => `<option value="${esc(t.id)}" ${String(pref?.theme_id || '') === String(t.id) ? 'selected' : ''}>${esc(displayName(t))}</option>`).join('')}</select>
      <div class="midad-switch-row"><div><b>2 — إتاحة الزر العلوي للسمات</b><small>يظهر زر السمات أعلى الشاشة بجانب أدوات الرأس.</small></div><label class="midad-switch"><input id="mtBtn" type="checkbox" ${pref?.themes_button_enabled ? 'checked' : ''}><span></span></label></div>
      <div class="midad-switch-row"><div><b>3 — إتاحة الزر السفلي للسمات</b><small>يظهر زر سمات ثابت أسفل الشاشة.</small></div><label class="midad-switch"><input id="mtBottomBtn" type="checkbox" ${pref?.themes_bottom_button_enabled ? 'checked' : ''}><span></span></label></div>
      <div class="midad-switch-row"><div><b>4 — إتاحة زر السمات مع تحديد السمات</b><small>المستخدم يرى فقط السمات التي تختارها له.</small></div><label class="midad-switch"><input id="mtRestrict" type="checkbox" ${pref?.restricted_theme_selection ? 'checked' : ''}><span></span></label></div>
      <div id="mtAllowed" class="midad-allowed">${themes.map(t => `<label><input type="checkbox" value="${esc(t.id)}" ${pref?.allowed?.includes(String(t.id)) ? 'checked' : ''}> <span>${esc(displayName(t))}</span></label>`).join('')}</div>
      <button id="mtSave" class="midad-primary">حفظ إعدادات المستخدم</button></div></div>`;
    document.body.appendChild(box); addOverlayHandlers(box, () => box.remove());
    const restrict = $('#mtRestrict', box), allowed = $('#mtAllowed', box);
    const sync = () => { allowed.style.display = restrict.checked ? 'grid' : 'none'; };
    restrict.onchange = sync; sync();
    $('#mtSave', box).onclick = async () => {
      const themeId = $('#mtUserTheme', box).value || null;
      const button = $('#mtBtn', box).checked;
      const rest = restrict.checked;
      const checks = [...allowed.querySelectorAll('input:checked')].map(i => i.value);
      try {
        const bottomButton = $('#mtBottomBtn', box).checked;
        await saveUserPrefs(uid, { theme_id: themeId, themes_button_enabled: button, themes_bottom_button_enabled: bottomButton, restricted_theme_selection: rest }, checks);
        box.remove(); toast('تم حفظ إعدادات السمات للمستخدم');
      } catch (e) { toast('تعذر حفظ إعدادات السمات', false); }
    };
  }

  function previewArt(t) {
    const k = canonicalKey(t?.theme_key || 'default');
    if (k === 'theme-1') return `<div class="midad-preview-art art-theme-1"><div class="pv-nav"><b></b><span></span><span></span><span></span></div><div class="pv-canvas"><div class="pv-hero"><i></i><i></i></div><div class="pv-cards"><i></i><i></i><i></i></div></div></div>`;
    if (k === 'theme-2') return `<div class="midad-preview-art art-theme-3"><div class="pv-top"><b></b><span></span><span></span><em></em></div><div class="pv-hero"><i></i><b></b></div><div class="pv-grid"><i></i><i></i><i></i></div></div>`;
    if (k === 'theme-3') return `<div class="midad-preview-art art-theme-2"><div class="pv-top"><b></b><span></span><span></span></div><div class="pv-layout"><div class="pv-side"><i></i><i></i><i></i></div><div class="pv-stack"><i></i><i></i></div></div></div>`;
    if (k === 'theme-4') return `<div class="midad-preview-art art-theme-4"><div class="pv-head"><b></b><span></span></div><div class="pv-editor"><div class="pv-paper"><i></i><i></i><i></i></div><div class="pv-column"><i></i><i></i></div></div></div>`;
    if (k === 'theme-5') return `<div class="midad-preview-art art-theme-5"><div class="pv-top"><b></b><span></span><span></span></div><div class="pv-frame"><div class="pv-side"><i></i><i></i></div><div class="pv-panel"><i></i><i></i><i></i></div></div></div>`;
    if (k === 'theme-6') return `<div class="midad-preview-art art-theme-6"><div class="pv-top"><b></b><span></span><em></em></div><div class="pv-banner"><i></i><b></b></div><div class="pv-grid"><i></i><i></i><i></i></div></div>`;
    if (k === 'theme-7') return `<div class="midad-preview-art art-theme-7"><div class="pv-top"><b></b><span></span><span></span></div><div class="pv-layout"><div class="pv-main"><i></i><i></i><i></i></div><div class="pv-side"><i></i><i></i></div></div></div>`;
    if (k === 'theme-8') return `<div class="midad-preview-art art-theme-8"><div class="pv-top"><b></b><span></span><span></span></div><div class="pv-banner"><i></i><b></b></div><div class="pv-cards"><i></i><i></i><i></i></div></div>`;
    if (k === 'theme-baby-blue') return `<div class="midad-preview-art art-baby-blue"><div class="pv-top"><b></b><span></span><span></span></div><div class="pv-banner"><i></i><b></b></div><div class="pv-grid"><i></i><i></i><i></i></div></div>`;
    if (k === 'theme-aurora-glass') return `<div class="midad-preview-art art-aurora-glass"><div class="pv-glass-top"><b></b><span></span><em></em></div><div class="pv-glass-body"><div class="pv-glass-card"><i></i><i></i><i></i></div><div class="pv-glass-side"><i></i><i></i></div></div></div>`;
    if (k === 'theme-warda-pink') return `<div class="midad-preview-art art-warda-pink"><div class="pv-pink-top"><b></b><span></span><span></span></div><div class="pv-pink-hero"><i></i><b></b></div><div class="pv-pink-cards"><i></i><i></i><i></i></div></div>`;
    if (k === 'theme-legend-pink') return `<div class="midad-preview-art art-legend-pink"><div class="pv-lp-petal"></div><div class="pv-lp-top"><b></b><span></span><em></em></div><div class="pv-lp-cards"><i></i><i></i><i></i></div></div>`;
    if (k === 'theme-legend-babyblue') return `<div class="midad-preview-art art-legend-babyblue"><div class="pv-lb-sun"></div><div class="pv-lb-top"><b></b><span></span></div><div class="pv-lb-cards"><i></i><i></i><i></i></div></div>`;
    if (k === 'theme-legend-night') return `<div class="midad-preview-art art-legend-night"><div class="pv-ln-moon"></div><div class="pv-ln-star" style="top:10px;left:20px"></div><div class="pv-ln-star" style="top:22px;left:60px"></div><div class="pv-ln-star" style="top:14px;left:95px"></div><div class="pv-ln-top"><b></b><span></span></div><div class="pv-ln-cards"><i></i><i></i><i></i></div></div>`;
    if (k === 'theme-pop-pink') return `<div class="midad-preview-art art-pop-pink"><div class="pv-pp-top"><b></b><span></span><em></em></div><div class="pv-pp-confetti" style="top:8px;left:14px"></div><div class="pv-pp-confetti" style="top:14px;left:60px"></div><div class="pv-pp-confetti" style="top:6px;left:100px"></div><div class="pv-pp-cards"><i></i><i></i><i></i></div></div>`;
    if (k === 'theme-frost-blue') return `<div class="midad-preview-art art-frost-blue"><div class="pv-fb-top"><b></b><span></span></div><div class="pv-fb-flake" style="top:8px;left:20px">❄</div><div class="pv-fb-flake" style="top:16px;left:70px">❄</div><div class="pv-fb-cards"><i></i><i></i><i></i></div></div>`;
    if (k === 'theme-galaxy') return `<div class="midad-preview-art art-galaxy"><div class="pv-gx-star" style="top:8px;left:18px"></div><div class="pv-gx-star" style="top:16px;left:55px"></div><div class="pv-gx-star" style="top:10px;left:95px"></div><div class="pv-gx-top"><b></b><span></span></div><div class="pv-gx-cards"><i></i><i></i><i></i></div></div>`;
    if (k === 'theme-forest') return `<div class="midad-preview-art art-forest"><div class="pv-fr-top"><b></b><span></span></div><div class="pv-fr-leaf" style="top:8px;left:22px"></div><div class="pv-fr-leaf" style="top:14px;left:80px"></div><div class="pv-fr-cards"><i></i><i></i><i></i></div></div>`;
    return `<div class="midad-preview-art art-default"><div class="pv-top"><b></b><span></span><span></span></div><div class="pv-layout"><div class="pv-side"><i></i><i></i><i></i></div><div class="pv-main"><i></i><i></i><i></i></div></div></div>`;
  }

  async function openThemePicker(mode) {
    const themes = await loadThemes();
    let visible = themes;
    if (mode !== 'admin' && state.user) {
      try {
        const { data: p } = await client.from('user_theme_preferences').select('restricted_theme_selection').eq('user_id', state.user.id).maybeSingle();
        if (p?.restricted_theme_selection) {
          const { data: a } = await client.from('user_allowed_themes').select('theme_id').eq('user_id', state.user.id);
          const allowed = new Set((a || []).map(x => String(x.theme_id)));
          visible = themes.filter(t => allowed.has(String(t.id)));
        }
      } catch (_) {}
    }
    const modal = document.createElement('div');
    modal.className = 'midad-theme-overlay';
    const current = currentThemeKey();
    modal.innerHTML = `<div class="midad-theme-modal"><div class="midad-theme-head"><div><b>${mode === 'admin' ? 'سمات منصة مِداد' : 'سمات'}</b><small>${mode === 'admin' ? 'اختر السمة التي تريد عرضها الآن' : 'اختر من السمات المسموح بها لك'}</small></div><button class="midad-x">×</button></div><div class="midad-theme-grid">${visible.map(t => {
      const k = canonicalKey(t.theme_key);
      return `<button class="midad-theme-card ${k === current ? 'active' : ''}" data-theme-id="${esc(t.id)}">${previewArt(t)}<strong>${esc(displayName(t))}</strong>${t.is_default ? '<span class="midad-default">افتراضية</span>' : ''}</button>`;
    }).join('')}</div></div>`;
    document.body.appendChild(modal); addOverlayHandlers(modal, () => modal.remove());
    modal.querySelectorAll('[data-theme-id]').forEach(b => b.onclick = async () => {
      const id = b.dataset.themeId;
      const t = state.themes.find(x => String(x.id) === id);
      if (!t) return;
      if (mode === 'admin') await setOwnTheme(id);
      else {
        try {
          const { data: p } = await client.from('user_theme_preferences').select('restricted_theme_selection').eq('user_id', state.user.id).maybeSingle();
          if (p?.restricted_theme_selection) {
            const { data: a } = await client.from('user_allowed_themes').select('theme_id').eq('user_id', state.user.id);
            if (!(a || []).some(x => String(x.theme_id) === id)) { toast('هذه السمة غير متاحة لك', false); return; }
          }
        } catch (_) {}
        await saveOwnThemeChoice(id);
      }
      await applyTheme(canonicalKey(t.theme_key));
    });
  }

  async function saveOwnThemeChoice(id) {
    // Used when a regular member picks a theme from their own "زر السمات".
    // Unlike setOwnTheme (used by the admin's personal picker), this must NOT
    // reset restricted_theme_selection/themes_button_enabled — those stay
    // exactly as the admin configured them. Before this fix, no save call
    // happened here at all: the member's choice was never persisted, so the
    // very next page load re-read their old preference and bounced them
    // straight back to it a moment after they picked a new theme.
    const { data: old } = await client.from('user_theme_preferences').select('id').eq('user_id', state.user.id).maybeSingle();
    if (old) await client.from('user_theme_preferences').update({ theme_id: id }).eq('id', old.id);
    else await client.from('user_theme_preferences').insert({ user_id: state.user.id, theme_id: id, themes_button_enabled: true, restricted_theme_selection: false });
  }

  async function setOwnTheme(id) {
    const { data: old } = await client.from('user_theme_preferences').select('id').eq('user_id', state.user.id).maybeSingle();
    const payload = { user_id: state.user.id, theme_id: id, themes_button_enabled: true, restricted_theme_selection: false };
    if (old) await client.from('user_theme_preferences').update(payload).eq('id', old.id);
    else await client.from('user_theme_preferences').insert(payload);
  }

  async function deleteTheme(id, modal) {
    const t = state.themes.find(x => String(x.id) === String(id));
    if (!t) return;
    // الأصلية لا يمكن حذفها: الحذف مسموح للنسخ فقط.
    if (!t.parent_theme_id) {
      toast('لا يمكن حذف السمة الأصلية', false);
      return;
    }
    if (!confirm(`هل أنت متأكد من حذف السمة "${displayName(t)}"؟`)) return;
    const { error } = await client.from('platform_themes').delete().eq('id', id);
    if (error) {
      toast('تعذر حذف السمة', false);
      return;
    }
    state.themes = state.themes.filter(x => String(x.id) !== String(id));
    renderManagerModal(modal);
    toast('تم حذف السمة بنجاح');
  }

  async function openThemeManager() {
    const themes = await loadThemes();
    const modal = document.createElement('div');
    modal.className = 'midad-theme-overlay';
    modal.innerHTML = `<div class="midad-theme-modal manager-theme-modal"><div class="midad-theme-head"><div><b>إدارة السمات</b><small>ترتيب • تغيير الأسماء • تكرار • السمة الافتراضية</small></div><button class="midad-x">×</button></div><div class="midad-manager-default"><label>السمة الافتراضية للكل</label><select id="mtdDefault" class="midad-select">${themes.map(t => `<option value="${esc(t.id)}" ${t.is_default ? 'selected' : ''}>${esc(displayName(t))}</option>`).join('')}</select></div><div class="midad-theme-list">${themes.map((t, i) => `<div class="midad-theme-row" data-id="${esc(t.id)}"><span class="order">${i + 1}</span><div class="midad-row-preview ${esc(canonicalKey(t.theme_key))}">${previewArt(t)}</div><div class="midad-row-info"><b data-name>${esc(displayName(t))}</b><small>${esc(t.theme_key)}</small></div><div class="midad-row-actions"><button data-up>↑</button><button data-down>↓</button><button data-rename>تغيير</button><button data-dup>تكرار</button><button data-preview>معاينة</button><button data-delete style="color:#b91c1c;border-color:#fecaca;">حذف</button></div></div>`).join('')}</div></div>`;
    document.body.appendChild(modal); addOverlayHandlers(modal, () => modal.remove());
    $('#mtdDefault', modal).onchange = async e => { await setDefaultTheme(e.target.value); toast('تم تغيير السمة الافتراضية'); renderManagerModal(modal); };
    bindManagerRows(modal);
  }

  function bindManagerRows(modal) {
    modal.querySelectorAll('.midad-theme-row').forEach(row => {
      row.querySelector('[data-up]').onclick = () => moveTheme(row.dataset.id, -1, modal);
      row.querySelector('[data-down]').onclick = () => moveTheme(row.dataset.id, 1, modal);
      row.querySelector('[data-rename]').onclick = () => renameTheme(row.dataset.id, modal);
      row.querySelector('[data-dup]').onclick = () => duplicateTheme(row.dataset.id, modal);
      row.querySelector('[data-preview]').onclick = () => {
        const t = state.themes.find(x => String(x.id) === row.dataset.id);
        if (t) applyTheme(canonicalKey(t.theme_key));
      };
      const deleteBtn = row.querySelector('[data-delete]');
      if (deleteBtn) deleteBtn.onclick = () => deleteTheme(row.dataset.id, modal);
    });
  }

  async function setDefaultTheme(id) {
    await client.from('platform_themes').update({ is_default: false }).neq('id', id);
    await client.from('platform_themes').update({ is_default: true }).eq('id', id);
    await loadThemes();
  }

  async function moveTheme(id, delta, modal) {
    const arr = [...state.themes];
    const i = arr.findIndex(x => String(x.id) === String(id));
    const j = i + delta;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    for (let k = 0; k < arr.length; k++) await client.from('platform_themes').update({ sort_order: k + 1 }).eq('id', arr[k].id);
    state.themes = arr; renderManagerModal(modal);
  }

  async function renameTheme(id, modal) {
    const t = state.themes.find(x => String(x.id) === String(id));
    if (!t) return;
    const name = prompt('اكتب اسم السمة الجديد', displayName(t));
    if (!name || !name.trim()) return;
    const { error } = await client.from('platform_themes').update({ display_name: name.trim() }).eq('id', id);
    if (error) { toast('تعذر تغيير الاسم', false); return; }
    await loadThemes(); renderManagerModal(modal);
  }

  async function duplicateTheme(id, modal) {
    const t = state.themes.find(x => String(x.id) === String(id));
    if (!t) return;
    const max = Math.max(...state.themes.map(x => x.sort_order || 0), 0);
    const canonical = infoFor(t);
    const { error } = await client.from('platform_themes').insert({
      theme_key: t.theme_key,
      display_name: (displayName(t) || canonical.display_name || 'سمة') + ' - نسخة',
      sort_order: max + 1,
      is_active: true,
      is_default: false,
      parent_theme_id: t.id,
      route: canonical.route
    });
    if (error) { toast('تعذر تكرار السمة', false); return; }
    await loadThemes(); renderManagerModal(modal);
  }

  function renderManagerModal(modal) {
    const fresh = modal.querySelector('.midad-theme-list');
    if (!fresh) return;
    fresh.innerHTML = state.themes.map((t, i) => `<div class="midad-theme-row" data-id="${esc(t.id)}"><span class="order">${i + 1}</span><div class="midad-row-preview ${esc(canonicalKey(t.theme_key))}">${previewArt(t)}</div><div class="midad-row-info"><b>${esc(displayName(t))}</b><small>${esc(t.theme_key)}</small></div><div class="midad-row-actions"><button data-up>↑</button><button data-down>↓</button><button data-rename>تغيير</button><button data-dup>تكرار</button><button data-preview>معاينة</button><button data-delete style="color:#b91c1c;border-color:#fecaca;">حذف</button></div></div>`).join('');
    bindManagerRows(modal);
    const sel = $('#mtdDefault', modal);
    if (sel) sel.innerHTML = state.themes.map(t => `<option value="${esc(t.id)}" ${t.is_default ? 'selected' : ''}>${esc(displayName(t))}</option>`).join('');
  }

  function addOverlayHandlers(box, close) {
    box.querySelector('.midad-x')?.addEventListener('click', close);
    box.addEventListener('click', e => { if (e.target === box) close(); });
  }

  function installStyles() {
    if ($('#midadThemeStyles')) return;
    const s = document.createElement('style'); s.id = 'midadThemeStyles';
    s.textContent = `
      .header{position:relative}
      #midadThemeButton{pointer-events:auto!important;display:inline-flex!important;visibility:visible!important;opacity:1!important}
      .midad-theme-overlay{position:fixed;inset:0;background:rgba(2,6,23,.62);backdrop-filter:blur(8px);z-index:99995;display:flex;align-items:center;justify-content:center;padding:18px;direction:rtl;animation:midadFade .2s ease}
      .midad-theme-modal{width:min(1040px,96vw);max-height:90vh;overflow:auto;background:var(--surface,#fff);color:var(--text,#0f172a);border:1px solid var(--border,#e2e8f0);border-radius:26px;box-shadow:0 30px 80px rgba(0,0,0,.25);padding:22px}
      .midad-theme-head{display:flex;align-items:center;justify-content:space-between;gap:15px;padding-bottom:14px;border-bottom:1px solid var(--border,#e2e8f0)}
      .midad-theme-head b{display:block;font:900 22px Cairo,sans-serif}.midad-theme-head small{display:block;margin-top:3px;color:var(--text-secondary,#64748b);font:600 12px Cairo,sans-serif}
      .midad-x{width:40px;height:40px;border:0;border-radius:12px;background:var(--surface-alt,#f1f5f9);font-size:25px;cursor:pointer}
      .midad-theme-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding-top:18px}
      .midad-theme-card{background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:19px;padding:11px;text-align:right;cursor:pointer;position:relative;transition:.22s;box-shadow:0 5px 20px rgba(15,23,42,.05);font-family:Cairo,sans-serif}.midad-theme-card:hover,.midad-theme-card.active{transform:translateY(-3px);border-color:var(--primary,#0ea5e9);box-shadow:0 12px 28px rgba(15,23,42,.1)}
      .midad-preview-art{height:145px;border-radius:14px;overflow:hidden;border:1px solid rgba(0,0,0,.06);position:relative;box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}
      .midad-preview-art *{box-sizing:border-box}.midad-preview-art b,.midad-preview-art span,.midad-preview-art em,.midad-preview-art i{display:block}
      .art-default{background:#eef5fb;padding:9px}.art-default .pv-top,.art-theme-2 .pv-top,.art-theme-3 .pv-top,.art-theme-5 .pv-top,.art-theme-7 .pv-top,.art-theme-8 .pv-top{height:18px;border-radius:6px;background:#fff;border:1px solid #dbe5ef;display:flex;align-items:center;gap:5px;padding:0 6px}.art-default .pv-top b{width:20px;height:7px;border-radius:4px;background:#0ea5e9;margin-left:auto}.art-default .pv-top span,.art-theme-2 .pv-top span,.art-theme-3 .pv-top span,.art-theme-5 .pv-top span,.art-theme-7 .pv-top span,.art-theme-8 .pv-top span{width:16px;height:5px;border-radius:4px;background:#d7e7f4}.art-default .pv-layout{display:grid;grid-template-columns:38px 1fr;gap:7px;margin-top:7px;height:102px}.art-default .pv-side{background:#fff;border:1px solid #dce8f1;border-radius:8px;padding:6px}.art-default .pv-side i{height:7px;border-radius:4px;background:#d9edf9;margin-bottom:7px}.art-default .pv-side i:first-child{background:#0ea5e9}.art-default .pv-main{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.art-default .pv-main i{height:60px;border-radius:7px;background:#fff;border:1px solid #dbe5ef}
      .art-theme-1{background:#eef4fb;padding:9px}.art-theme-1 .pv-nav{height:22px;border-radius:7px;background:#2f5da8;display:flex;align-items:center;gap:5px;padding:0 7px}.art-theme-1 .pv-nav b{width:22px;height:8px;border-radius:4px;background:#e7c877}.art-theme-1 .pv-nav span{width:12px;height:5px;border-radius:4px;background:#a9c0e5}.art-theme-1 .pv-nav span:last-child{margin-right:auto}.art-theme-1 .pv-canvas{margin-top:8px}.art-theme-1 .pv-hero{display:flex;justify-content:space-between;gap:8px;background:#fff;border:1px solid #cbd8e8;border-radius:8px;padding:8px;height:45px}.art-theme-1 .pv-hero i{height:9px;border-radius:4px;background:#2f5da8;flex:1}.art-theme-1 .pv-hero i:last-child{max-width:35%;background:#e7c877}.art-theme-1 .pv-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:7px}.art-theme-1 .pv-cards i{height:57px;border-radius:8px;background:#fff;border:1px solid #cbd5e1}
      .art-theme-2{background:linear-gradient(145deg,#eef4ff,#fdf2ff);padding:9px}.art-theme-2 .pv-top{background:linear-gradient(90deg,#6366f1,#ec4899);border:0}.art-theme-2 .pv-top b{width:26px;height:7px;border-radius:4px;background:#fff;margin-left:auto}.art-theme-2 .pv-top em{width:18px;height:8px;border-radius:4px;background:#fff}.art-theme-2 .pv-hero{height:45px;margin-top:8px;background:#fff;border:1px solid #c7d2fe;border-radius:8px;display:grid;grid-template-columns:1fr 34px;gap:7px;padding:7px}.art-theme-2 .pv-hero i{height:7px;background:#6366f1;border-radius:4px}.art-theme-2 .pv-hero i:after{content:'';display:block;width:74%;height:7px;background:#ec4899;border-radius:4px;margin-top:9px}.art-theme-2 .pv-hero b{background:linear-gradient(145deg,#dfe3ff,#ffdbea);border-radius:7px}.art-theme-2 .pv-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:7px}.art-theme-2 .pv-grid i{height:58px;background:#fff;border:1px solid #c7d2fe;border-radius:8px}
      .art-theme-3{background:#eafaf3;padding:9px}.art-theme-3 .pv-top{background:#0f766e;border:0}.art-theme-3 .pv-top b{width:25px;height:7px;background:#d9f99d;border-radius:4px;margin-left:auto}.art-theme-3 .pv-layout{display:grid;grid-template-columns:1fr 60px;gap:7px;margin-top:8px}.art-theme-3 .pv-side{background:#fff;border:1px solid #99f6e4;border-radius:8px;padding:7px}.art-theme-3 .pv-side i{height:8px;background:#d8f7ef;border-radius:4px;margin-bottom:7px}.art-theme-3 .pv-side i:first-child{background:#0f766e}.art-theme-3 .pv-stack i{height:43px;background:#fff;border:1px solid #99f6e4;border-radius:8px;margin-bottom:7px}.art-theme-3 .pv-stack i:last-child{height:35px;background:#dff7ef}
      .art-theme-4{background:#f7f4ee;padding:9px}.art-theme-4 .pv-head{height:26px;border-bottom:2px solid #1a1a1a;display:flex;align-items:center}.art-theme-4 .pv-head b{width:35%;height:7px;background:#1a1a1a}.art-theme-4 .pv-head span{margin-right:auto;width:20%;height:5px;background:#cfc8bb}.art-theme-4 .pv-editor{display:grid;grid-template-columns:1fr 70px;gap:8px;margin-top:8px}.art-theme-4 .pv-paper{height:91px;background:#fff;border:1px solid #d6d0c5;border-radius:3px;padding:8px}.art-theme-4 .pv-paper i{height:5px;background:#2b2b2b;margin-bottom:6px}.art-theme-4 .pv-paper i:nth-child(2){width:78%;background:#7b7b7b}.art-theme-4 .pv-paper i:nth-child(3){width:55%;background:#b2aea7}.art-theme-4 .pv-column i{height:41px;background:#fff;border:1px solid #d6d0c5;margin-bottom:7px}.art-theme-4 .pv-column i:last-child{background:#1a1a1a}
      .art-theme-5{background:#eef1f4;padding:9px}.art-theme-5 .pv-top{background:#3b4a5a;border:0}.art-theme-5 .pv-top b{width:24px;height:7px;border-radius:4px;background:#f1c75b;margin-left:auto}.art-theme-5 .pv-frame{display:grid;grid-template-columns:54px 1fr;gap:7px;margin-top:8px}.art-theme-5 .pv-side i{height:40px;background:#f5f7f9;border:1px solid #c4cdd6;border-radius:6px;margin-bottom:7px}.art-theme-5 .pv-panel{height:87px;background:#fff;border:1px solid #aeb9c4;border-radius:8px;padding:7px}.art-theme-5 .pv-panel i{height:8px;background:#3b4a5a;border-radius:4px;margin-bottom:8px}.art-theme-5 .pv-panel i:nth-child(2){width:72%;background:#d8a940}.art-theme-5 .pv-panel i:nth-child(3){width:52%;background:#97a3ad}
      .art-theme-6{background:#edf3fb;padding:9px}.art-theme-6 .pv-top{height:20px;border-radius:6px;background:#2a578e;display:flex;align-items:center;gap:6px;padding:0 7px}.art-theme-6 .pv-top b{width:25px;height:7px;background:#f2d071;border-radius:4px;margin-left:auto}.art-theme-6 .pv-top span{width:13px;height:5px;background:#a9c2df}.art-theme-6 .pv-top em{width:18px;height:8px;background:#f2d071;border-radius:4px}.art-theme-6 .pv-banner{height:38px;margin-top:8px;background:#fff;border:1px solid #b9cae0;border-radius:8px;padding:7px}.art-theme-6 .pv-banner i{height:7px;background:#2a578e;border-radius:4px;width:75%}.art-theme-6 .pv-banner b{display:block;width:35%;height:6px;background:#f2d071;border-radius:4px;margin-top:8px}.art-theme-6 .pv-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:7px}.art-theme-6 .pv-grid i{height:57px;background:#fff;border:1px solid #b9cae0;border-radius:8px}
      .art-theme-7{background:#e7f3ed;padding:9px}.art-theme-7 .pv-top{background:#1f6e52;border:0}.art-theme-7 .pv-top b{width:24px;height:7px;background:#d8f4e3;border-radius:4px;margin-left:auto}.art-theme-7 .pv-layout{display:grid;grid-template-columns:1fr 62px;gap:7px;margin-top:8px}.art-theme-7 .pv-main{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.art-theme-7 .pv-main i{height:67px;background:#fff;border:1px solid #9bd3bb;border-radius:8px}.art-theme-7 .pv-side i{height:31px;background:#d9eee4;border:1px solid #9bd3bb;border-radius:7px;margin-bottom:7px}.art-theme-7 .pv-side i:last-child{height:41px;background:#fff}
      .art-theme-8{background:#f8ebee;padding:9px}.art-theme-8 .pv-top{background:#7a2e42;border:0}.art-theme-8 .pv-top b{width:25px;height:7px;background:#f2d3a7;border-radius:4px;margin-left:auto}.art-theme-8 .pv-banner{height:38px;margin-top:8px;background:#fff;border:1px solid #dfbdc6;border-radius:8px;padding:7px}.art-theme-8 .pv-banner i{height:7px;background:#7a2e42;border-radius:4px}.art-theme-8 .pv-banner b{display:block;width:62%;height:6px;background:#d6b178;border-radius:4px;margin-top:8px}.art-theme-8 .pv-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:7px}.art-theme-8 .pv-cards i{height:57px;background:#fff;border:1px solid #dfbdc6;border-radius:8px}
      .art-baby-blue{background:#f0f9ff;padding:9px}.art-baby-blue .pv-top{height:20px;border-radius:7px;background:#7dd3fc;display:flex;align-items:center;gap:5px;padding:0 7px}.art-baby-blue .pv-top b{width:24px;height:7px;border-radius:4px;background:#ffffff;margin-left:auto}.art-baby-blue .pv-top span{width:13px;height:5px;border-radius:4px;background:#bae6fd}.art-baby-blue .pv-banner{height:40px;margin-top:8px;background:#ffffff;border:1px solid #bae6fd;border-radius:9px;padding:7px}.art-baby-blue .pv-banner i{height:7px;background:#38bdf8;border-radius:4px;width:74%}.art-baby-blue .pv-banner b{display:block;width:38%;height:6px;background:#c4b5fd;border-radius:4px;margin-top:8px}.art-baby-blue .pv-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:7px}.art-baby-blue .pv-grid i{height:57px;background:#fff;border:1px solid #dceef9;border-radius:8px}
      .art-aurora-glass{background:linear-gradient(135deg,#eefdfb,#f5f3ff);padding:9px}.art-aurora-glass .pv-glass-top{height:22px;border-radius:8px;background:linear-gradient(90deg,#5eead4,#a78bfa);display:flex;align-items:center;gap:5px;padding:0 7px;box-shadow:inset 0 1px rgba(255,255,255,.7)}.art-aurora-glass .pv-glass-top b{width:22px;height:7px;background:#fff;border-radius:4px;margin-left:auto}.art-aurora-glass .pv-glass-top span{width:13px;height:5px;background:rgba(255,255,255,.7);border-radius:4px}.art-aurora-glass .pv-glass-top em{width:18px;height:8px;background:rgba(255,255,255,.85);border-radius:6px}.art-aurora-glass .pv-glass-body{display:grid;grid-template-columns:1fr 56px;gap:7px;margin-top:8px}.art-aurora-glass .pv-glass-card{height:92px;background:rgba(255,255,255,.72);border:1px solid #b5eee6;border-radius:10px;padding:8px;backdrop-filter:blur(3px)}.art-aurora-glass .pv-glass-card i{height:8px;background:#0f766e;border-radius:5px;margin-bottom:8px}.art-aurora-glass .pv-glass-card i:nth-child(2){background:#7c3aed;width:78%}.art-aurora-glass .pv-glass-card i:nth-child(3){background:#c4b5fd;width:52%}.art-aurora-glass .pv-glass-side i{height:41px;background:rgba(255,255,255,.7);border:1px solid #c6c9ff;border-radius:8px;margin-bottom:9px}
      .art-warda-pink{background:#fff0f7;padding:9px}.art-warda-pink .pv-pink-top{height:22px;border-radius:8px;background:linear-gradient(90deg,#ec4899,#fb7185);display:flex;align-items:center;gap:5px;padding:0 7px}.art-warda-pink .pv-pink-top b{width:24px;height:7px;border-radius:4px;background:#fff;margin-left:auto}.art-warda-pink .pv-pink-top span{width:13px;height:5px;border-radius:4px;background:#ffd1e7}.art-warda-pink .pv-pink-hero{height:45px;margin-top:8px;background:#fff;border:1px solid #fbcfe8;border-radius:9px;padding:7px;display:grid;grid-template-columns:1fr 38px;gap:8px}.art-warda-pink .pv-pink-hero i{height:7px;background:#db2777;border-radius:4px;margin-top:2px}.art-warda-pink .pv-pink-hero i:after{content:'';display:block;width:74%;height:6px;background:#f9a8d4;border-radius:4px;margin-top:9px}.art-warda-pink .pv-pink-hero b{background:#fbcfe8;border-radius:8px}.art-warda-pink .pv-pink-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:7px}.art-warda-pink .pv-pink-cards i{height:57px;background:#fff;border:1px solid #f9a8d4;border-radius:8px}
      .art-legend-pink{background:linear-gradient(160deg,#fff0f6,#ffe3ef);padding:9px;position:relative;overflow:hidden}.art-legend-pink .pv-lp-petal{position:absolute;top:6px;right:10px;width:20px;height:24px;background:linear-gradient(135deg,#ffb6d0,#e0447b);border-radius:70% 30% 70% 30%/60% 60% 40% 40%;opacity:.7}.art-legend-pink .pv-lp-top{height:20px;border-radius:7px;background:linear-gradient(90deg,#e0447b,#b33f86);display:flex;align-items:center;gap:5px;padding:0 7px}.art-legend-pink .pv-lp-top b{width:22px;height:7px;border-radius:4px;background:#fff;margin-left:auto}.art-legend-pink .pv-lp-top span{width:13px;height:5px;border-radius:4px;background:#ffd6e8}.art-legend-pink .pv-lp-top em{width:16px;height:8px;border-radius:6px;background:#f6ce8b}.art-legend-pink .pv-lp-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px}.art-legend-pink .pv-lp-cards i{height:60px;background:#fff;border:1px solid #fbd9e6;border-radius:10px}
      .art-legend-babyblue{background:linear-gradient(160deg,#eaf8ff,#dff3ff);padding:9px;position:relative;overflow:hidden}.art-legend-babyblue .pv-lb-sun{position:absolute;top:4px;right:8px;width:22px;height:22px;border-radius:50%;background:radial-gradient(circle,#ffe0a8,#ffb84d)}.art-legend-babyblue .pv-lb-top{height:20px;border-radius:7px;background:linear-gradient(90deg,#4fb8e8,#6fcbd3);display:flex;align-items:center;gap:5px;padding:0 7px}.art-legend-babyblue .pv-lb-top b{width:22px;height:7px;border-radius:4px;background:#fff;margin-left:auto}.art-legend-babyblue .pv-lb-top span{width:13px;height:5px;border-radius:4px;background:#eaf8ff}.art-legend-babyblue .pv-lb-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px}.art-legend-babyblue .pv-lb-cards i{height:60px;background:#fff;border:1px solid #d3eefb;border-radius:10px}
      .art-legend-night{background:linear-gradient(160deg,#12112a,#0b0b1a);padding:9px;position:relative;overflow:hidden}.art-legend-night .pv-ln-moon{position:absolute;top:5px;left:8px;width:16px;height:16px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff7de,#e8c766)}.art-legend-night .pv-ln-star{position:absolute;width:2px;height:2px;background:#f5e3a8;border-radius:50%;box-shadow:0 0 4px 1px rgba(245,227,168,.8)}.art-legend-night .pv-ln-top{height:20px;border-radius:7px;background:linear-gradient(90deg,#1b1a33,#2a2856);border:1px solid #2e2e52;display:flex;align-items:center;gap:5px;padding:0 7px;margin-top:20px}.art-legend-night .pv-ln-top b{width:22px;height:7px;border-radius:4px;background:#e8c766;margin-left:auto}.art-legend-night .pv-ln-top span{width:13px;height:5px;border-radius:4px;background:#8b7fd6}.art-legend-night .pv-ln-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px}.art-legend-night .pv-ln-cards i{height:55px;background:#14142b;border:1px solid #2e2e52;border-radius:10px}
      .art-pop-pink{background:linear-gradient(160deg,#fff7fb,#ffeef6);padding:9px}.art-pop-pink .pv-pp-top{height:20px;border-radius:10px 4px 10px 4px;background:linear-gradient(90deg,#ff3d9a,#d6127a);display:flex;align-items:center;gap:5px;padding:0 7px}.art-pop-pink .pv-pp-top b{width:22px;height:7px;border-radius:4px;background:#fff;margin-left:auto}.art-pop-pink .pv-pp-top span{width:13px;height:5px;border-radius:4px;background:#ffe98a}.art-pop-pink .pv-pp-top em{width:13px;height:8px;border-radius:50%;background:#7eede3}.art-pop-pink .pv-pp-confetti{position:absolute;width:5px;height:5px;background:#ffd23f;border-radius:2px}.art-pop-pink .pv-pp-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:22px}.art-pop-pink .pv-pp-cards i{height:55px;background:#fff;border:1px solid #ffd3eb;border-radius:16px 6px 16px 6px}
      .art-frost-blue{background:linear-gradient(160deg,#f1faff,#e4f4fc);padding:9px;position:relative;overflow:hidden}.art-frost-blue .pv-fb-top{height:20px;border-radius:7px;background:linear-gradient(90deg,#7ec1e8,#3e6e96);display:flex;align-items:center;gap:5px;padding:0 7px}.art-frost-blue .pv-fb-top b{width:22px;height:7px;border-radius:4px;background:#fff;margin-left:auto}.art-frost-blue .pv-fb-top span{width:13px;height:5px;border-radius:4px;background:#eaf6fd}.art-frost-blue .pv-fb-flake{position:absolute;font-size:9px;color:#7ec1e8}.art-frost-blue .pv-fb-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px}.art-frost-blue .pv-fb-cards i{height:57px;background:#fff;border:1px solid #d6ecf8;border-radius:10px}
      .art-galaxy{background:linear-gradient(160deg,#150a28,#0a0518);padding:9px;position:relative;overflow:hidden}.art-galaxy .pv-gx-star{position:absolute;width:2px;height:2px;background:#f0e6ff;border-radius:50%;box-shadow:0 0 4px 1px rgba(240,230,255,.8)}.art-galaxy .pv-gx-top{height:20px;border-radius:7px;background:linear-gradient(90deg,#1f1033,#33124f);border:1px solid #33234f;display:flex;align-items:center;gap:5px;padding:0 7px;margin-top:20px}.art-galaxy .pv-gx-top b{width:22px;height:7px;border-radius:4px;background:#ff6ec7;margin-left:auto}.art-galaxy .pv-gx-top span{width:13px;height:5px;border-radius:4px;background:#4fe0e8}.art-galaxy .pv-gx-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px}.art-galaxy .pv-gx-cards i{height:55px;background:#170f2b;border:1px solid #33234f;border-radius:10px}
      .art-forest{background:linear-gradient(160deg,#f7fbf5,#eef7f1);padding:9px;position:relative;overflow:hidden}.art-forest .pv-fr-top{height:20px;border-radius:7px;background:linear-gradient(90deg,#3fa66b,#237a4a);display:flex;align-items:center;gap:5px;padding:0 7px}.art-forest .pv-fr-top b{width:22px;height:7px;border-radius:4px;background:#fff;margin-left:auto}.art-forest .pv-fr-top span{width:13px;height:5px;border-radius:4px;background:#f0d98c}.art-forest .pv-fr-leaf{position:absolute;width:8px;height:8px;background:#3fa66b;border-radius:0 60% 0 60%}.art-forest .pv-fr-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px}.art-forest .pv-fr-cards i{height:57px;background:#fff;border:1px solid #dceedf;border-radius:10px}
      .midad-theme-card>strong{display:block;margin-top:9px;font:800 14px Cairo}.midad-default{display:inline-block;margin-top:5px;padding:3px 8px;border-radius:99px;background:#ecfdf5;color:#047857;font:800 10px Cairo}
      .midad-primary{width:100%;margin-top:18px;padding:12px;border:0;border-radius:13px;background:linear-gradient(135deg,#0ea5e9,#7c3aed);color:#fff;font:900 14px Cairo;cursor:pointer}.midad-select{width:100%;padding:11px 13px;border-radius:12px;border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);font:700 13px Cairo;color:inherit;direction:rtl}
      .midad-switch-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 0;border-bottom:1px dashed var(--border,#e2e8f0)}.midad-switch-row b{display:block;font:800 14px Cairo}.midad-switch-row small{display:block;color:var(--text-secondary,#64748b);font:600 11px Cairo;margin-top:3px}.midad-switch input{display:none}.midad-switch span{display:block;width:52px;height:30px;border-radius:99px;background:#cbd5e1;position:relative;cursor:pointer;transition:.2s}.midad-switch span:after{content:'';position:absolute;top:3px;right:3px;width:24px;height:24px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 2px 6px rgba(0,0,0,.15)}.midad-switch input:checked+span{background:#0ea5e9}.midad-switch input:checked+span:after{right:25px}.midad-allowed{display:none;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px;padding:12px;background:var(--surface-alt,#f8fafc);border-radius:14px}.midad-allowed label{padding:8px 10px;border:1px solid var(--border,#e2e8f0);border-radius:11px;font:700 12px Cairo;background:var(--surface,#fff)}
      .midad-manager-default{display:flex;align-items:center;gap:12px;padding:16px 0}.midad-manager-default label{font:800 13px Cairo;white-space:nowrap}.midad-theme-list{display:grid;gap:10px}.midad-theme-row{display:grid;grid-template-columns:36px 112px minmax(0,1fr) auto;align-items:center;gap:12px;padding:10px;border:1px solid var(--border,#e2e8f0);border-radius:16px;background:var(--surface-alt,#f8fafc)}.midad-row-preview{width:112px;height:58px;border-radius:11px;overflow:hidden}.midad-row-preview .midad-preview-art{height:58px;border:0;border-radius:11px}.midad-row-info b{font:800 13px Cairo}.midad-row-info small{display:block;color:var(--text-secondary,#64748b);font:600 10px monospace;direction:ltr;text-align:right}.midad-row-actions{display:flex;gap:6px;flex-wrap:wrap}.midad-row-actions button{border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);border-radius:10px;padding:7px 9px;font:800 11px Cairo;cursor:pointer}.midad-label{display:block;margin:16px 0 8px;font:900 13px Cairo}
      @keyframes midadFade{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:scale(1)}}
      @media(max-width:900px){#midadThemeButton{padding:8px 12px}.midad-theme-grid{grid-template-columns:repeat(2,1fr)}.midad-theme-row{grid-template-columns:30px 100px minmax(0,1fr) auto}.midad-row-preview{width:100px}.midad-row-preview .midad-preview-art{height:54px}}
      @media(max-width:650px){#midadThemeButton{font-size:12px;padding:7px 11px}.midad-theme-grid{grid-template-columns:1fr}.midad-theme-modal{padding:16px;border-radius:20px}.midad-theme-row{grid-template-columns:28px 1fr}.midad-row-preview{display:none}.midad-row-actions{grid-column:2}.midad-theme-head b{font-size:19px}.midad-manager-default{display:block}.midad-manager-default label{display:block;margin-bottom:7px}.midad-allowed{grid-template-columns:1fr}}
      .midad-manager-public-panels{display:grid;grid-template-columns:minmax(180px,.55fr) minmax(0,1.45fr);gap:14px;margin-top:18px;align-items:stretch}
      .midad-manager-version-card,.midad-manager-news-card{border:1px solid var(--border,#e2e8f0);background:linear-gradient(145deg,var(--surface,#fff),var(--surface-alt,#f8fafc));border-radius:20px;padding:16px;box-shadow:0 10px 30px rgba(15,23,42,.06)}
      .midad-manager-version-card{display:flex;align-items:center;gap:12px;min-height:120px}.midad-manager-panel-icon{width:46px;height:46px;border-radius:15px;display:grid;place-items:center;background:var(--primary-bg,#eff6ff);color:var(--primary,#2563eb);font-size:18px;flex:none}.midad-manager-version-card small{display:block;color:var(--text-muted,#64748b);font:700 11px Cairo,sans-serif;margin-bottom:2px}.midad-manager-version-card strong{display:block;font:900 clamp(24px,4vw,34px) 'Outfit',Cairo,sans-serif;letter-spacing:.2px;color:var(--text,#111827);direction:ltr;text-align:left}
      .midad-manager-panel-title{display:flex;align-items:center;gap:8px;color:var(--text,#111827);margin-bottom:10px}.midad-manager-panel-title i{color:var(--primary,#2563eb)}.midad-manager-panel-title b{font:900 16px Cairo,sans-serif}.midad-manager-news-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.midad-manager-news-item{position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:54px;padding:11px 13px;border-radius:15px;border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);color:var(--text,#111827);cursor:pointer;text-align:right;direction:rtl;transition:transform .18s,box-shadow .18s,border-color .18s}.midad-manager-news-item:hover{transform:translateY(-1px);box-shadow:0 8px 22px rgba(15,23,42,.08);border-color:var(--primary,#2563eb)}.midad-manager-news-item b{display:block;flex:1;font:900 13px Cairo,sans-serif;color:var(--text,#111827)}.midad-manager-news-item p{display:none}.midad-manager-news-arrow{width:30px;height:30px;border-radius:10px;display:grid;place-items:center;flex:none;background:linear-gradient(135deg,var(--primary,#2563eb),var(--secondary,#7c3aed));color:#fff;box-shadow:0 5px 12px rgba(37,99,235,.18);font-size:12px}.midad-manager-news-empty{padding:18px;border:1px dashed var(--border,#cbd5e1);border-radius:14px;text-align:center;color:var(--text-muted,#64748b);font:700 11px Cairo,sans-serif}
      .midad-manager-news-modal .manager-news-modal-title{display:flex;align-items:center;gap:9px;justify-content:flex-start;margin-bottom:12px}.midad-manager-news-modal .manager-news-modal-title .modal-news-icon{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:var(--primary-bg,#eff6ff);color:var(--primary,#2563eb);flex:none}.midad-manager-news-modal .manager-news-modal-body{margin-top:10px;padding:14px 15px;border:1px solid var(--border,#e2e8f0);border-radius:15px;background:var(--surface-alt,#f8fafc);white-space:pre-wrap;line-height:1.9;font:600 13px Cairo,sans-serif;color:var(--text-secondary,#475569);min-height:70px}.midad-manager-public-editor{display:grid;grid-template-columns:minmax(160px,.35fr) minmax(0,1.65fr);gap:14px;margin-top:14px}.midad-news-editor{border:1px solid var(--border,#e2e8f0);border-radius:16px;padding:13px;background:var(--surface-alt,#f8fafc)}.midad-news-editor-list{display:grid;gap:9px}.midad-news-editor-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:9px;align-items:start;padding:10px;border:1px solid var(--border,#e2e8f0);border-radius:14px;background:var(--surface,#fff)}.midad-news-editor-order{display:flex;flex-direction:column;align-items:center;gap:4px}.midad-news-editor-order span{font:900 11px Cairo,sans-serif;color:var(--text-muted,#64748b)}.midad-news-editor-order button,.midad-news-delete{width:28px;height:28px;border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);color:var(--text-secondary,#64748b);border-radius:9px;cursor:pointer}.midad-news-editor-order button:disabled{opacity:.35;cursor:not-allowed}.midad-news-delete{color:#b91c1c;border-color:#fecaca}.midad-news-editor-fields{display:grid;gap:7px}.midad-news-editor-fields input,.midad-news-editor-fields textarea{width:100%;border:1px solid var(--border,#dbe5ef);background:var(--surface,#fff);color:var(--text,#111827);border-radius:11px;padding:9px 10px;font:700 12px Cairo,sans-serif;outline:none}.midad-news-editor-fields textarea{min-height:78px;resize:vertical;line-height:1.7}.midad-news-add-btn{margin-top:10px;width:100%}.midad-news-editor-empty{padding:12px;text-align:center;color:var(--text-muted,#64748b);font:700 11px Cairo,sans-serif;border:1px dashed var(--border,#cbd5e1);border-radius:12px}
      @media(max-width:720px){.midad-manager-public-panels,.midad-manager-public-editor{grid-template-columns:1fr}.midad-manager-news-list{grid-template-columns:1fr}.midad-news-editor-row{grid-template-columns:auto minmax(0,1fr) auto}}

    `;
    document.head.appendChild(s);
  }

  document.addEventListener('DOMContentLoaded', () => { installStyles(); setTimeout(init, 80); });
})();
