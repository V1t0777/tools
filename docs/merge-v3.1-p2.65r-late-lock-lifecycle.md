# 云屿 V3.1 · P2.65r｜普通模式迟到 Web Lock 写入阻断

## P0 发行阻塞与修复

P2.65q 已在恢复事务中阻断页面失效后迟到的锁内写入，但普通模式玩家动作、每秒计时器及已确认重置仍可能在 Web Locks 请求等待期间经历 pagehide/BFCache。旧 UI flight 仅阻止迟到结果渲染，不能撤销锁回调内已经发生的写入。

本轮给这三类真实页面写入统一添加可选的同步 canCommit 守卫（默认 true 保持独立调用兼容）：取得正确的同源独占锁后，先校验页面 epoch 与运行时阶段，再读取/写入存档或预留异常备份。守卫返回非 true 或抛异常时拒绝且不写入；不会执行过期玩家动作，也不会因迟到重置清空进度。

- 玩家动作：ACTION_CANCELLED_BEFORE_WRITE；计时器：CLOCK_CANCELLED_BEFORE_WRITE。
- 重置：RESET_CANCELLED_BEFORE_WRITE，必须在备份槽及普通存档任何写入之前拒绝。
- 普通页面运行时在发起操作时绑定 epoch；pagehide、BFCache、跨标签冲突调用 invalidate 后，锁内授权立即失效。UI 仍遵循既有不确定事务阻断策略，不自动重试。
- 旧存档 CAS、Web Locks 独占锁、读回验证、剧情存档独立键均保持原样。

## 可复现验证

新增直接事务守卫拒绝/异常测试，以及真实页面运行时三种迟到锁回调故障注入：动作、计时器、重置在等待期间被 invalidate 后，不得写普通档、异常备份或剧情档，不得发布过期 UI。

## 仍需验收

Node 故障注入不能替代真实浏览器双标签、iPhone Safari、微信 WebView、下载落盘、页面生命周期与经济长线测试。当前不触碰 main、剧情源文件、正式导航、部署白名单、Cloudflare、Pages、Edge、线上 Supabase 或作弊后门；保持 Draft PR #58/#59，绝不自行发布。
