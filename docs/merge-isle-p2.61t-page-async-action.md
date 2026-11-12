# P2.61t 普通模式实际页面异步动作拒绝与内存隔离

## 问题及变更
P2.61s 已保护同步游戏动作的输入不可变性，但实际页面 `commit(result)` 对返回 Promise / thenable 的错误动作未明确拒绝：可能把它当作普通失败，且后续 rejection 未被观察，异步回调仍可能修改原先被页面持有的 state。

本轮仅修改实际普通模式的延迟求值动作入口。动作返回后立即检测 thenable 并通过 `Promise.resolve(result).catch(()=>{})` 观察拒绝；仍先进行输入不可变检查，若输入已被修改则沿用 `ACTION_MUTATED_BASELINE` 优先级。否则对异步结果设置 `ASYNC_ACTION_NOT_ALLOWED`、暂停写入、清除过期选中和引导，并用动作前 JSON 快照重建页面内存，隔离异步动作捕获的旧 state 引用。不会等待、重试、应用异步结果或修改原始 localStorage。同步合法动作与普通失败保持原行为。

## 验证
新增 `tests/merge-page-async-action.test.mjs` 六项针对实际页面函数的 Node VM 回归：Promise 拒绝、异步延迟污染、输入污染与拒绝叠加、抛错 then getter、自定义 thenable、同步成功/失败兼容。完整全仓库回归、静态安全/部署隔离和完整 Git 历史密钥扫描必须以本提交 HEAD 对应的实际 GitHub Actions 为准。

## 剩余风险及发布边界
此改动不是 Web Locks 跨标签原子写入。异步动作若直接写 localStorage、DOM 或产生其他外部副作用，内存快照无法回滚这些副作用；因此页面仍只允许同步纯函数动作。启动迁移、玩家动作、计时器、重置尚未全部迁入同一锁边界。真实 iPhone Safari、微信 WebView 和跨标签端到端尚未验收。

PR #58 保持 Open/Draft；不合并 main、不发布、不调整正式导航或部署白名单、不执行线上 SQL/迁移、不制作美术或作弊后门。
