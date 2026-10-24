P2.22 — 普通模式日常保存与恢复使用同一 Web Lock（未发布）

新增 merge/save-write-lock.mjs，暴露 coordinateNormalSaveWrite(state,storage,lockManager,{expectedRaw,confirmedReset})。与 P2.21 恢复流程使用完全相同的 RESTORE_LOCK_NAME 和非排队独占锁。保存必须具有可信原始字节基线，在持锁期间重新核对并调用既有 saveLocal 校验；写入后进行读回字节比对。缺失基线、Web Locks 不可用、锁冲突、旧页面修改、无效存档均拒绝。确认重置的参数只能由实际获得玩家确认的调用方传入；锁本身不构成用户授权。API 在写入后报错只给出不确定结果，不盲目重试。

专项测试 tests/merge-save-write-lock.test.mjs 覆盖普通保存、重置、同修订号竞争、恢复和普通写入的双向互斥、异常数据、写入验证、锁失效和剧情模式隔离。

局限：本轮只提供独立可测试适配器，未接入 merge/main.mjs，现有日常保存与初始化迁移等路径仍可能无锁写入。localStorage 不是事务性 CAS；旧标签和不支持锁的 WebView 都可能冲突。下一阶段需设计同步 UI 操作与异步锁的可靠队列及失败回退策略，完成真实 iPhone Safari/微信 WebView 测试。不做云端写入，不开放导入按钮，不宣称正式 RC。

禁止修改 main、合并 PR、部署 Pages/Cloudflare/Edge、调整正式部署白名单、运行线上 Supabase SQL/迁移、制作美术或作弊后门。最新提交对应三项 GitHub Actions 全部成功才算工程检查通过。
