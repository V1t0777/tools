from pathlib import Path
import re
import subprocess


def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text(encoding="utf-8")
    if old not in s:
        raise SystemExit(f"{label}: expected text not found in {path}")
    if s.count(old) != 1:
        raise SystemExit(f"{label}: expected exactly one match in {path}, got {s.count(old)}")
    p.write_text(s.replace(old, new, 1), encoding="utf-8")


def regex_once(path, pattern, replacement, label):
    p = Path(path)
    s = p.read_text(encoding="utf-8")
    out, n = re.subn(pattern, replacement, s, count=1, flags=re.S)
    if n != 1:
        raise SystemExit(f"{label}: expected exactly one regex match in {path}, got {n}")
    p.write_text(out, encoding="utf-8")


# Night shift: remove floating third-party SDK and use the same-origin shared auth client.
replace_once(
    "night-shift/index.html",
    '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
    '<script src="../shared/toolbox-auth.js?v=20260917-4"></script>',
    "night sdk",
)
replace_once(
    "night-shift/index.html",
    '  const SUPABASE_URL = "https://tmxpueakxibsaakdyusn.supabase.co";\n  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8sCgnOXk3XuRE28Qmk_ekg_9VSS4ASZ";\n\n  const db = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);',
    '  const db = ToolboxAuth.createClient();',
    "night client",
)
replace_once(
    "night-shift/index.html",
    'if(error) throw new Error("邮箱或密码错误，或该账号未获授权。");',
    'if(error) throw error;',
    "night login throw",
)
replace_once(
    "night-shift/index.html",
    '}catch(err){ showError($("loginError"),err.message); }',
    '}catch(err){ showError($("loginError"),ToolboxAuth.authMessage(err)); }',
    "night login message",
)

# Department roster: same auth/session client and no remote SDK dependency.
replace_once(
    "admin-night-shift/index.html",
    '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
    '<script src="../shared/toolbox-auth.js?v=20260917-4"></script>',
    "roster sdk",
)
replace_once(
    "admin-night-shift/index.html",
    '  const SUPABASE_URL = "https://tmxpueakxibsaakdyusn.supabase.co";\n  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8sCgnOXk3XuRE28Qmk_ekg_9VSS4ASZ";\n  const db = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);',
    '  const db = ToolboxAuth.createClient();',
    "roster client",
)
replace_once(
    "admin-night-shift/index.html",
    'if (error) throw new Error("邮箱或密码错误，或账号未获授权。");',
    'if (error) throw error;',
    "roster login throw",
)
replace_once(
    "admin-night-shift/index.html",
    '      $("loginError").textContent = err.message || "登录失败。";',
    '      $("loginError").textContent = ToolboxAuth.authMessage(err);',
    "roster login message",
)

# Dinner page: load shared auth before its app and bump cache version.
replace_once(
    "dinner/index.html",
    '<script src="./app.js?v=20260917-security1" defer></script>',
    '<script src="../shared/toolbox-auth.js?v=20260917-4" defer></script>\n<script src="./app.js?v=20260917-4" defer></script>',
    "dinner scripts",
)

# Dinner app: keep business logic, replace bespoke session storage/refresh with the shared client.
replace_once(
    "dinner/app.js",
    "const URL='https://tmxpueakxibsaakdyusn.supabase.co',KEY='sb_publishable_8sCgnOXk3XuRE28Qmk_ekg_9VSS4ASZ',LOCAL='dinnerDecision.v3',AUTH_STORE='dinnerSupabaseAuth.v1';",
    "const LOCAL='dinnerDecision.v3';",
    "dinner constants",
)
replace_once(
    "dinner/app.js",
    "const uid=()=>crypto?.randomUUID?.()||'c_'+Date.now().toString(36)+Math.random().toString(36).slice(2)",
    "const uid=()=>globalThis.crypto?.randomUUID?.()||'c_'+Date.now().toString(36)+Math.random().toString(36).slice(2)",
    "dinner crypto",
)
regex_once(
    "dinner/app.js",
    r"function saveAuth\(\).*?const q=v=>encodeURIComponent\(v\);",
    "async function rest(path,opts={}){try{return await ToolboxAuth.rest(path,opts)}catch(e){if(e?.code==='SESSION_REVOKED'||e?.code==='AUTH_REQUIRED'){session=null;cloud=false;stopSync();renderSync()}throw e}}\nconst q=v=>encodeURIComponent(v);",
    "dinner auth transport",
)
replace_once(
    "dinner/app.js",
    "async function login(){const email=$('loginEmail').value.trim(),password=$('loginPassword').value;if(!email||!password)return toast('请输入邮箱和密码');$('loginBtn').disabled=true;try{const data=await authRequest('/auth/v1/token?grant_type=password',{body:{email,password}});session=data;saveAuth();if(await activate(data)){close('accountOverlay');$('loginPassword').value='';toast('多人同步已开启')}}catch(e){session=null;saveAuth();toast(e.message.includes('fetch')?'无法连接同步服务，请检查当前网络':'登录失败：邮箱或密码错误',2600)}finally{$('loginBtn').disabled=false}}",
    "async function login(){const email=$('loginEmail').value.trim(),password=$('loginPassword').value;if(!email||!password)return toast('请输入邮箱和密码');$('loginBtn').disabled=true;try{const data=await ToolboxAuth.signIn(email,password);session=data;if(await activate(data)){close('accountOverlay');$('loginPassword').value='';toast('多人同步已开启')}}catch(e){session=null;toast(ToolboxAuth.authMessage(e),2600)}finally{$('loginBtn').disabled=false}}",
    "dinner login",
)
replace_once(
    "dinner/app.js",
    "async function logout(){stopSync();try{if(session?.access_token)await fetch(URL+'/auth/v1/logout',{method:'POST',headers:authHeaders()})}catch{}session=null;saveAuth();cloud=false;groupId=null;groupName='';myName='';members=[];loadLocal();renderAll();renderSync();close('accountOverlay');toast('已回到单机模式')}",
    "async function logout(){stopSync();await ToolboxAuth.signOut();session=null;cloud=false;groupId=null;groupName='';myName='';members=[];loadLocal();renderAll();renderSync();close('accountOverlay');toast('已回到单机模式')}",
    "dinner logout",
)
replace_once(
    "dinner/app.js",
    "(async()=>{session=readAuth();if(!session)return;try{if(await ensureAuth())await activate(session);else{session=null;saveAuth()}}catch(e){console.warn('restore session failed',e);session=null;saveAuth();cloud=false;renderSync()}})();",
    "ToolboxAuth.createClient().auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT'&&cloud){stopSync();session=null;cloud=false;groupId=null;groupName='';myName='';members=[];loadLocal();renderAll();renderSync();toast('登录状态已失效，请重新登录',2200)}});\n(async()=>{try{session=await ToolboxAuth.getSession();if(session)await activate(session)}catch(e){console.warn('restore session failed',e);session=null;cloud=false;renderSync()}})();",
    "dinner restore",
)

# Safety invariants.
for path in ["night-shift/index.html", "admin-night-shift/index.html"]:
    text = Path(path).read_text(encoding="utf-8")
    if "cdn.jsdelivr.net/npm/@supabase/supabase-js" in text:
        raise SystemExit(f"remote Supabase SDK remains in {path}")
    if "bfd3df5c469343eb91856b7f3275def8" not in text:
        raise SystemExit(f"Cloudflare Analytics missing in {path}")

app = Path("dinner/app.js").read_text(encoding="utf-8")
for forbidden in ["AUTH_STORE", "function saveAuth()", "function readAuth()", "authRequest('/auth/v1/token?grant_type=password'"]:
    if forbidden in app:
        raise SystemExit(f"legacy dinner auth remains: {forbidden}")
if "innerHTML=`<div style=\"font-size:27px\">${x.emoji}" in app:
    raise SystemExit("unsafe finalist innerHTML returned")

subprocess.run(["node", "--check", "dinner/app.js"], check=True)
print("phase4 patch validated")
