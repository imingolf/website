from pathlib import Path
import re

path = Path('app/index.html')
s = path.read_text(encoding='utf-8')

marker = '/* Compact branded app header v1 */'
if marker not in s:
    css = r'''

/* Compact branded app header v1 */
header{
  background:linear-gradient(135deg,#10592f,#23864e);
  color:white;
  padding:calc(6px + env(safe-area-inset-top)) 18px 10px;
  min-height:112px;
  border-radius:0 0 24px 24px;
  display:flex;
  align-items:center;
  justify-content:center;
  position:relative;
}
.app-header-brand{position:relative;display:flex;align-items:center;justify-content:center}
.app-header-logo{display:block;width:64px;height:64px;object-fit:cover;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.16)}
.admin-mode-badge{position:absolute;left:50%;bottom:-10px;transform:translateX(-50%);white-space:nowrap;background:#c9ed4b;color:#183b23;border:1px solid rgba(24,59,35,.18);border-radius:999px;padding:4px 9px;font-size:11px;line-height:1;font-weight:900;letter-spacing:.02em;box-shadow:0 2px 6px rgba(0,0,0,.12)}
.demo-mode-badge{position:absolute;left:calc(50% + 45px);top:2px;white-space:nowrap;background:#fff1c7;color:#8a6500;border-radius:999px;padding:4px 7px;font-size:10px;line-height:1;font-weight:900}
.sync-status{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
[data-iig-admin-header]{display:none!important}
body.admin-mode nav.iig-admin-nav-bar{background:white!important}
body.admin-mode nav button:not(.hidden),body.admin-mode nav.iig-admin-nav-bar button:not(.hidden){background:#e2f2e6!important;color:var(--green)!important;border-radius:12px!important;font-weight:800!important;padding:8px 2px!important}
body.admin-mode nav button.active:not(.hidden),body.admin-mode nav.iig-admin-nav-bar button.active:not(.hidden){background:#cde8d5!important;color:#10592f!important}
@media (max-width:600px){header{min-height:108px;padding-top:calc(5px + env(safe-area-inset-top));padding-bottom:9px}.app-header-logo{width:62px;height:62px;border-radius:14px}}
'''
    if '</style>' not in s:
        raise SystemExit('Could not find closing style tag')
    s = s.replace('</style>', css + '\n</style>', 1)

if 'class="app-header"' not in s:
    new_header = '''<header class="app-header">
  <div class="app-header-brand">
    <img src="icon-192.png" alt="I'm In Golf" class="app-header-logo">
    <span id="adminModeBadge" class="admin-mode-badge hidden">ADMIN MODE</span>
    <span id="demoBadge" class="demo-mode-badge hidden">DEMO</span>
  </div>
  <p id="syncText" class="sync-status" aria-live="polite">Shared golf group</p>
</header>'''
    s2, count = re.subn(r'<header>[\s\S]*?</header>', new_header, s, count=1)
    if count != 1:
        raise SystemExit(f'Expected one app header, replaced {count}')
    s = s2

if 'document.body.classList.toggle("admin-mode"' not in s:
    target = 'function updateAdminUI(){'
    hook = '''function updateAdminUI(){
  document.body.classList.toggle("admin-mode", !!isAdmin);
  const adminModeBadge=$("adminModeBadge");
  if(adminModeBadge)adminModeBadge.classList.toggle("hidden", !isAdmin);'''
    if target not in s:
        raise SystemExit('Could not find updateAdminUI function')
    s = s.replace(target, hook, 1)

path.write_text(s, encoding='utf-8')
print('App header patch applied')
