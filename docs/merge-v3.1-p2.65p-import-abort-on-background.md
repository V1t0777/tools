# 《云屿百物铺》V3.1 · P2.65p 后台挂起文件读取立即释放（未发布）

## P0 问题
上一轮的 File.text() 45 秒期限在 iPhone Safari / 微信 WebView 后台计时器冻结时可能被延长；已离开页面的导入仍占用按钮，玩家不能重新选择文件。浏览器不保证 File.text() 可以原生取消。

## 本轮修复
- 每次已经开始的文件读取使用独立 AbortController；pagehide/BFCache 与 visibilitychange 隐藏立即终止等待，释放导入按钮。文件选择器首次隐藏仍按旧规则允许，但真正读取开始后不再容忍后台运行。
- 读取协调器撤销 abort 监听并清理定时器；迟到的原生读取结果不会触发预检、确认或写入。
- 预检、两次确认及 Web Locks 恢复之前保留信号、原始存档字节和生命周期版本校验；旧环境无 AbortController 时仍保留原 45 秒期限与 epoch 防护。
- 仅普通模式页面，未修改剧情、经济、部署或云端。

## 验证与限制
新增专项 Node 测试：挂起读取立即释放与迟到结果隔离、预中止、确认期间中止；真实 HTML 入口 DOM 模拟 BFCache 往返后可再次导入且旧结果不写入。提交后以新 HEAD 的完整 Node、security-check.sh/部署隔离、全历史密钥扫描为准，不能借用旧 SHA。

真实 iPhone Safari、微信 WebView、下载落盘和真实浏览器双标签仍待验收。Cloudflare 实际部署状态若无法独立读取，保持未知风险。PR #58/#59 必须保持 Open/Draft；不合并 main、不改导航/白名单、不执行 Supabase SQL/迁移、不发布。
