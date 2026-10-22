# 08: 通过候选卡片选人并自动续发原消息

Status: done

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 身份不明时给出卡片，合法用户选择后经角色和状态核对，自动续发原消息一次。

**Blocked by:** [06 在派发前拦截错误角色与错误引用](06-dispatch-role-validation.md)；[07 让纯确认轮真正静默结束](07-silent-acknowledgments.md)

## Background

现有澄清结果需要模型重新调用，没有完整的持久待发消息和用户选择闭环。

## Modules

Provider 交互卡片、Bot 待发记录与投递所有者、共享交互协议。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [x] 卡片出现时保持未发送；合法选择后原内容续发，无需重述，且不叠加普通终答或重复发送。
- [x] 取消、未选、越权点击、错角色、任务或配置已变、无候选及旧卡片均不发送。
- [x] 并发点击、平台重投和重启后回调沿同一持久去重路径处理；外部结果不明不假报成功。

## Spec coverage

用户故事：28、29、30、31、32、38。
验收场景：T12、T13、T14、T15、T35。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

2026-10-22 完成，实现 `8e6913e2`，见[交付与验证报告](../../local-edition/recipient-selection.md)。390 项相关回归及 18 项 CLI 通过，根/完整 CLI 类型、Lint、架构、格式及两轴审查通过。一次全量 20080 项通过、3 项既有端口环境失败、10 项跳过；固定官网 Reader 兼容与全量后原生夹具审计通过。当前完成源码交付，真实模型/群验收留 18；未打包或更新安装候选，09 未开始。


## Implementation contract

- 仅启用 Local 协作群使用本闭环，普通群保持现有名字澄清。PM dispatch 可省略 targetBotId，但须声明 requiredDuty；可信引用缺失/冲突/目标不符也可请求候选。职责不符仍按 06 拦截，不更改原声明。
- 原 bot-collaboration owner 在同一 Local sidecar 保存待发原请求、当前输入/任务/工作区/原授权、配置版本、候选快照和 15 分钟期限。待选记录不是运行时执行队列；Bot v3 与 SQLite 格式不增加字段。候选仅来自当前已核验且接入的配置成员（以及合法方向唯一原需求用户），标明职责，不猜测目录缺失身份。
- 既有群投递 owner 发送候选卡，沿原 Provider SelectionPrompt 渲染。卡片、原工作各有稳定投递 key；出站前 owner 重读原请求对应的卡片投影，不在 Bot v3 保存卡片结构。卡片领取和续发领取均在 Local 文件锁内持久化，跨 Host 并发只允许一次进入原投递链。领取后崩溃但没有投递收据时保持待核对，不自动重发；实际 sent/failed/unknown/invalidated 仍只由原投递 owner 保存。
- 卡片初始明确尚未发送。真实回调须经 Provider 原生位置验证，再核对真实操作者、应用、群/话题、实际卡片消息 ID、原 task/input/workspace/authorization 与当前配置。正文命令或伪造卡片参数不能授权选择。
- 保留既有渠道 1–2000 字符限制；超限原文不建待选卡，选择后的收件人加原文也须可投递，不截断或修改原文。
- 合法选择只替换原收件人身份，不更改原 text parts、requiredDuty、任务和原需求用户。原渠道回复入口使用同一原请求和调用 key，读取选定身份后只续发一次；重复调用/点击优先返回原投递事实。错误角色选择、取消或失效使该卡闭合，后续点击不继续派发。
- 待选及其本轮收口沿 07 群显示边界抑制普通终答/空兜底，保留错误与阻塞；回调只更新原卡和操作者提示，不另发完成气泡。越权回调不更新共享卡；UI 更新失败不重试工作发送。
- 桌面 continuous / 手机 replayable 的原任务广播不变；选择属于现有群回调，不新建 Host、运行时或执行者队列。真实模型/群验收留在 18。

```mermaid
sequenceDiagram
 participant R as Existing runtime
 participant L as Local collaboration owner
 participant D as Existing group delivery owner
 participant F as Provider / user
 R->>L: original intent, ambiguous identity
 L->>L: persist immutable original + candidates + expiry
 L->>D: claim card once
 D->>F: candidate card (work not sent)
 F->>L: verified native card callback
 L->>L: validate actor, role, scope and selection
 L->>D: original ReplyToChannel request, claim resume once
 D->>F: original work with selected native recipient
 D-->>L: existing persistent receipt
 L-->>F: update same card; receipt-aware feedback
```

测试边界沿既定真实 Service/Repo/Provider HTTP 与受控 runtime 端口，补原生卡片回调、并发及服务重建场景，不另问测试边界。
