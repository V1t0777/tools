# 云屿 V3.1 P2.65aj｜普通模式只读复核的旧按钮许可保护

日期：2026-10-28。范围：未发布的普通经营模式离线存档与页面运行时；不修改剧情源文件。

## P0 竞争窗口
`createNormalPageRuntime().reconcile()` 原先在首次 `peekLocalV3()` 读取后才记录发布代次；如果该读取同步触发 `pagehide`，即使返回原字节，`reconcile()` 仍可能报告 `changed:false`。页面入口已经增加外层可见性复核，但运行时自身不能把旧生命周期代次视为新的授权。另外，原字节相同的快速路径只读取一次，无法发现读取刚结束就被非协作标签替换的存档；变更路径已有双读保护。

## 本轮处理
在首次只读检查之前固定运行时代次，并在读取后核验阶段、代次及阻断状态；无论返回字节是否变化，失效都拒绝继续采用。原字节未变化时，再进行一次精确字节读回，发现跨标签替换则永久阻断旧按钮。第二次读取若触发生命周期失效同样拒绝。整个流程不写存档、不迁移、不修改经济；不采用 localStorage 假锁。

## 专项验证
`node --test tests/merge-normal-reconcile-read-lease.test.mjs` 覆盖：首次读取返回原字节却发生页面离开、首次读取为新存档却发生页面离开、首次读取后另一标签替换存档、第二次读取时页面离开。检查无额外写入、剧情存档不受影响、旧按钮无法继续动作。全仓库 Node、`bash scripts/security-check.sh` 与部署隔离、完整 Git 历史密钥扫描必须以最终 SHA 的 Actions 为准。

## 剩余限制
两次 localStorage 读取仍不是跨进程原子 CAS；未使用同名 Web Lock 的旧标签可在最后一次读回后继续竞争。真实 Safari/微信 WebView 双标签、BFCache、下载落盘尚未实测。Cloudflare Pages 后台部署记录无法独立核实时继续保留风险。保持 PR #58/#59 Open/Draft；禁止合并 main、发布 Pages/Cloudflare/Edge、更新正式导航/白名单、执行线上 Supabase SQL/迁移或添加作弊后门。
