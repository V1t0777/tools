#!/usr/bin/env bash
# Create LOCAL review files only. No production deploy. No SQL and no secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="dist-yunyu-private-review"
rm -rf "$OUT"
mkdir -p "$OUT/merge" "$OUT/shared/vendor" "$OUT/games"
cp -R merge/. "$OUT/merge/"
cp shared/toolbox-auth.js shared/toolbox-ui.js shared/toolbox-ui.css shared/toolbox-motion.css "$OUT/shared/"
cp shared/vendor/supabase-2.57.4.min.js shared/vendor/supabase-LICENSE "$OUT/shared/vendor/"

cat > "$OUT/index.html" <<'HTML'
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>云屿百物铺 · 私下验收</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color-scheme:light dark}
body{max-width:720px;margin:4vh auto;padding:0 20px;line-height:1.65}
h1{font-size:clamp(26px,5vw,36px)}
a.card{display:block;color:inherit;text-decoration:none;padding:18px;margin:16px 0;border:1px solid #8895a5;border-radius:15px;min-height:62px}
a.card:focus-visible,a.card:hover{outline:3px solid #7296a9}
.warning{border-left:4px solid #bf802b;padding:12px;background:rgba(176,114,43,.09)}
</style>
</head>
<body>
<p><b>PRIVATE REVIEW · NOT DEPLOYED</b></p>
<h1>云屿百物铺</h1>
<p>移动端 RC 验收候选版 · 2026年11月12日</p>
<a class="card" href="./merge/index.html"><b>🏝 普通经营</b><br>56 格棋盘、订单、仓库、补给、离线存档、导入/重置/恢复</a>
<a class="card" href="./merge/story.html"><b>📖 剧情模式</b><br>第一卷剧情交互与工作台，独立保存本地进度</a>
<a class="card" href="./merge/cloud-preview.html"><b>☁ 四账号云存档研发版</b><br>迪、晨、钊、test 的限定权限与同步界面；后台尚未部署，不能真正跨设备云同步</a>
<p class="warning"><b>重要：</b>这里交付的是本地可运行的研发验收构建，不是已经开通云存档的正式游戏。请不要将此文件夹上传到公开网站或使用唯一真实存档测试破坏性操作。</p>
<p>Windows 双击 START-WINDOWS.bat；浏览器打开 http://127.0.0.1:8765/。不要直接以 file:// 打开 HTML。</p>
</body></html>
HTML

cat > "$OUT/games/index.html" <<'HTML'
<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>返回私下验收目录</title><a href="../index.html">← 返回《云屿百物铺》验收目录</a>
</html>
HTML

cat > "$OUT/START-WINDOWS.bat" <<'BAT'
@echo off
cd /d "%~dp0"
echo Yunyu private local-only review on 127.0.0.1 port 8765
echo Use Chrome to open http://127.0.0.1:8765/
start "" "http://127.0.0.1:8765/"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m http.server 8765 --bind 127.0.0.1
) else (
  python -m http.server 8765 --bind 127.0.0.1
)
BAT

cat > "$OUT/START-MAC-LINUX.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo 'Open http://127.0.0.1:8765/'
exec python3 -m http.server 8765 --bind 127.0.0.1
SH
chmod +x "$OUT/START-MAC-LINUX.sh"

cat > "$OUT/README-验收说明.md" <<'MD'
# 云屿百物铺｜私下本地验收候选版

本 ZIP 来自未合并的 Draft PR #58，提供普通经营、剧情模式和四账号云存档研发界面，不代表正式发布。本轮重点针对320/375/390/430px移动屏幕、iOS安全区、44px点击区域、棋盘横向按钮、对白滚动和存档恢复。

## 启动方式
Windows：解压全部文件，双击 START-WINDOWS.bat，在 Chrome 打开 http://127.0.0.1:8765/。
Mac 或 Linux：运行 bash START-MAC-LINUX.sh，再打开同一地址。
本地监听严格绑定 127.0.0.1，不对局域网或互联网提供服务。不能直接双击 HTML 打开，ES Modules 和 IndexedDB 需要本地 HTTP。
iPhone 联调需要另外建立受控私有局域网环境，本包默认不开放网络端口。

## 建议验收
1. 普通经营：生产、合成、订单、仓库与补给 → 关闭浏览器 → 重启后核对进度。
2. 导出原始存档，另存备份，再测导入、重置和恢复；不得拿唯一真实存档进行破坏性试验。
3. 剧情：打开第一卷交互、保存进度、切换页面再进入，核对剧情与工作台互不污染。
4. 云存档研发界面：只检查 UI 和身份访问逻辑。数据库、Edge Function 尚未部署时云端读写失败是预期现象，绝不表示已同步。
5. 旧本地存档上云需要管理员审核与一次性授权，不能将本地金币或物品直接当作云端权威奖励。

## 移动端操作与验收条件
- 页面已按320、375、390、430px进行代码适配；Android Chromium模拟不等于真实iPhone Safari或微信WebView验收。
- 普通经营的小屏棋盘可用左右按钮查看边缘；剧情工作台和云存档研发棋盘新增左右按钮（必要时仍可横向滑动）。
- iPhone用户不能直接访问Windows电脑的127.0.0.1地址；这是默认的安全隔离。真正的iOS设备验收需要另行搭建仅测试设备可访问的、受控HTTPS私有环境，不得直接上传公共站点。
- 在Safari/微信WebView上分别核对：竖向滚动不误触游戏格；每个按钮可操作、登录键盘不引起页面异常放大；对白弹窗可从头滚到尾；切到后台返回后旧触控不可写档；断网和重进页面后不会丢失唯一存档。
- 以上真实设备、真实Edge与数据库测试尚未完成时只能标记为「移动端RC候选」，不得标为正式可上线完成版。

## 尚未验收／禁止操作
- 未完成真实隔离 PostgreSQL RLS、CAS 和 Edge JWT 联调；未完成 iPhone Safari／微信 WebView 的多设备故障恢复。
- 没有执行任何生产数据库迁移、Edge 部署、GitHub Pages 或 Cloudflare Pages 发布。
- 请勿将这个包公开部署，也勿放入公开云存储。
MD

printf '%s\n' "$YUNYU_SOURCE_SHA" > "$OUT/SOURCE-SHA.txt"
printf '%s\n' 'PRIVATE MOBILE RC CANDIDATE ONLY' 'IPHONE SAFARI QA: PENDING' 'CLOUD DATABASE: NOT DEPLOYED' 'CLOUD EDGE: NOT DEPLOYED' 'PUBLIC SITE: UNCHANGED' > "$OUT/DELIVERY-STATUS.txt"

# Only the game runtime and the small explicit shared dependency subset.
# Check that every displayed entrypoint exists, with no symlinks or secrets.
for path in \
  index.html merge/index.html merge/main-locked.mjs merge/engine.mjs \
  merge/story.html merge/story/indexeddb-persistence.mjs \
  merge/cloud-preview.html merge/cloud-preview.mjs \
  merge/cloud/client-session.mjs merge/cloud/story-private-sync.mjs \
  shared/toolbox-auth.js shared/vendor/supabase-2.57.4.min.js \
  START-WINDOWS.bat START-MAC-LINUX.sh README-验收说明.md
do
  test -s "$OUT/$path" || { echo "Missing runtime: $path" >&2; exit 1; }
done
if find "$OUT" -type l -print -quit | grep -q .; then
  echo "Symlink not allowed in review bundle" >&2; exit 1
fi
if find "$OUT" -type f \( -name '*.pem' -o -name '*.key' -o -name '.env*' \
  -o -name '*service-role*' \) -print -quit | grep -q .; then
  echo "Sensitive file name detected" >&2; exit 1
fi
(
  cd "$OUT"
  find . -type f ! -name CHECKSUMS-SHA256.txt -print0 | sort -z |
    xargs -0 -r sha256sum > CHECKSUMS-SHA256.txt
)
echo "Built $OUT from $YUNYU_SOURCE_SHA"
find "$OUT" -type f | wc -l
