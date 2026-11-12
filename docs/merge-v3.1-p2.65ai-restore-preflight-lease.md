# 云屿 V3.1 P2.65ai｜导入确认后的运行时预检许可

日期：2026-10-28。范围仅限未发布普通经营模式的离线存档恢复。

## 复现的 P0 竞争窗口
`createNormalPageRuntime().restore()` 原来在调用 `previewNormalSaveImport` 之后才记录 `epoch`。浏览器的同步存储读取可能触发 `pagehide`、BFCache 离开或旧标签事件，使 `runtime.invalidate()` 改变生命周期代次。若原始字节不变，旧代码会把失效后的新代次当作有效恢复许可，继续执行已经确认的旧恢复。

## 修复
在运行时预检之前固定确认代次；预检之后核对阶段、代次、单飞状态、取消信号和原始运行时基线。随后再读取一次真实原始存档；在读取之后重新核对许可。发现原始存档已变化则阻断并保留现有字节，绝不申请恢复锁或预留备份。实际锁内仍执行原有基线比较、备份与写入读回验证。

## 专项回归
`node --test tests/merge-normal-restore-preflight-lease.test.mjs`：预检读时失效、预检后复核读时失效、非协作标签在预检后替换原始字节、正常恢复并保留备份。还需最新 SHA 的全仓库 Node、`bash scripts/security-check.sh` / 部署隔离和完整历史密钥扫描三项 CI 通过才可认定代码门禁通过。

## 残余风险
localStorage 不提供跨标签原子 CAS；未采用同一 Web Lock 的旧标签仍可能竞争。Node 故障注入不是 iPhone Safari、微信 WebView、文件下载落盘或 BFCache 真实设备测试。Cloudflare Pages 真实部署记录若无独立接口仍未核实。剧情分支独立，未经授权不得合并 main、修改正式导航/部署白名单、发布 Pages/Cloudflare/Edge、操作线上 Supabase 或制作作弊入口。
