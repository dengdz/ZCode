# 07: 让纯确认轮真正静默结束

Status: done

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 明确静默意图覆盖整个可见投递链，同时保留正式工作、错误及阻塞消息。

**Blocked by:** [05 走通可信派单、回报与原需求用户归属](05-trusted-handoffs.md)

## Background

普通终答、流式内容和空输出兜底都可能重新提及机器人。

## Modules

Agent 输出契约、Bot 终答与流式投递、Provider 卡片和空输出处理。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [x] 纯确认轮不生成群消息、自动提及、引用或卡片，不先发后撤。
- [x] 空输出不被补成完成回报，普通终答与流式模式表现一致。
- [x] 正式派单、回报、追问、错误和最终交付仍能发送，未启用群保持既有行为。

## Spec coverage

用户故事：23、24、25。
验收场景：T08、T09、T10。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。


## Implementation contract

- 复用 ReplyToChannel，新增 `collaboration: {kind: "silent"}`；沿用 parts 非空数组，静默调用只提交一个空 text part，不接受收件人、引用或可见正文。返回严格 `{status: "silent"}`，没有 deliveryId、平台消息或成功完成含义。
- 唯一状态所有者仍为 bot-collaboration：在当前 revision / workspace / task / input 的 Local 输入记录保存输出意图。静默调用 key 保存在同一输入，重复调用只重放原接受结果、不覆盖后续 visible；同 key 改成正式发送被拒绝，服务重建仍有效；不扩充官网 Bot v3 或 CLI SQLite，不增加执行队列或发送器。
- 协作群沿既有 summary_changes 路径缓存模型输出，运行完成前不推送正文/工具卡片，也不在 admission 时发排队卡；排队/工作/终态表情保留。即使用户配置 streaming_card，协作群也保持这一发送边界。普通群及私聊原路径不变。
- 静默只抑制自动成功终答和兜底。正式发送尝试会取消本输入静默；该输入已有正式发送尝试后再声明静默被拒绝，不能将 sent/unknown/blocked 事实改称无事发生。错误、失败/拒绝工具及权限/提问阻塞提示始终可见。需要恢复正式交接可发新的显式 dispatch/report/question/final。
- Local 未声明静默的空输出不补“任务已完成”，而提示未收到可汇报结果，请检查任务状态；不从确认关键词、空输出或停止原因猜测任务完成。
- 终态投递按实际 inputId 重读输出意图；另一输入、旧授权、停止输入、普通群或桌面/手机续聊不会继承该静默。桌面 continuous 与手机 replayable 的既有任务事件广播均保留，静默仅控制群侧显示。

```mermaid
sequenceDiagram
  participant F as Feishu Provider
  participant B as Bot / existing delivery owner
  participant L as Local collaboration owner
  participant R as Existing runtime
  F->>B: trusted native input
  B->>L: bind current task/input/revision
  B->>R: admit input (no queued message)
  R-->>B: assistant stream (summary buffer only)
  R->>L: ReplyToChannel silent via authenticated Host
  L-->>R: silent (persist intent, no delivery)
  R-->>B: terminal event
  B->>L: reread current input intent
  alt silent + successful acknowledgement
    B->>B: clean lifecycle; no Provider message/card
  else error, blocking, formal work or ordinary output
    B->>F: existing authorized delivery path
  end
```

验证边界沿用已确认方案：真实 Bot Service/Repo 与 Feishu Provider HTTP 请求，外部 runtime 受理/流事件受控；CLI 工具入口与严格协议补充验证。真实群与实际模型是否遵循静默说明留待 18，不作本轮已验证声明。

## Delivery

实现 `736e3200`；完整记录见 [07 静默报告](../../local-edition/silent-acknowledgments.md)。14 文件 / 370 项相关回归、17 项 CLI、根及完整 CLI 类型、Lint、架构与两路审查通过。一次全量 20060 通过 / 3 既有端口环境失败 / 10 跳过（362.43 秒），未记全绿；本轮 fixture 新崩溃报告 0。未更新安装候选；真实模型与群验证按 18 执行。本票结束，08 未开始。
