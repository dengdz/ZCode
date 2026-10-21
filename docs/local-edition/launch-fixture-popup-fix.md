# 03a 启动测试系统弹窗修复

Status: done

工单：[03a](../issues/zcode-local/03a-test-fixture-popups.md)。实现 `e277a9fe`，起点 `a7b5f4cb`，分支 `3.16.2-local.1`。本票修复 03 的测试副作用，未修改生产启动器、系统设置、应用安装或业务数据。

## 原因与修复

macOS 的 fixture 报告指向临时 official.app，签名 ID 为 com.apple.sleep，异常为 Code Signature Invalid。对应测试将系统 `/bin/sleep` 复制到临时应用中，完整 bundle 验证实际失败，随后清理发送 SIGTERM。该用例随全量执行，使后续工单开发重复弹出系统提示；以前的测试通过只证明占用断言，不证明测试没有系统副作用。

现用 xcrun clang 编译自有最小 C 程序，为整个临时 bundle 作 ad-hoc 签名。启动前 deep/strict 验证失败便停止测试，防止再启动签名损坏的夹具；不使用个人证书或公证，不修改系统安全策略。

原生程序先写 ready，测试确认 PID 与实际子进程一致后再请求另一版。入口须返回 occupied，第二版无启动记录，持有者仍存活；finally 写 release 并等待子进程 exit 0、signal null。程序处理清理信号正常退出，若测试宿主整体中断且无人释放，轮询上限只使自有夹具非零退出，不把超时当作正常释放或放宽生产占用判断。

只在原 macOS 用例中编译原生程序，其他平台保留原 skip 条件。其他 launcher 崩溃、无响应、并发、共享根与存储回归保持原有断言。

## Standards

独立审查未发现规范违规或高置信度 Fowler 异味。编译/签名封装在测试夹具内，异步 IO、中文修复依据与真实进程观察符合规范；生产所有者、数据与系统设置未变。

## Spec

独立审查未发现缺项、越界或错误实现。原有保护断言保持，自有限时退出不改变生产占用语义；审查明确要求完成全量和诊断增量核对后再宣告修复完成。

审查汇总：Standards 0 项；Spec 0 项。

## 验证

使用本机 Node 24.14.0、pnpm 10.33.2 及已安装的 Xcode clang、系统 codesign；所有数据和程序均在本次临时目录。

| 检查 | 已执行结果 |
|---|---|
| 红证据 | 原始签名检查失败，发生在 spawn 前，未为复现再次启动损坏程序 |
| 定向 | 修正后原用例通过，真实就绪、occupied、持有者存活、正常退出均有断言 |
| 启动回归 | 完整启动及契约两文件 / 17 项共三次通过；最终一轮使用带自有限时退出的最终夹具，13.37 秒 |
| 工程 | 根类型、Lint（0 errors，96 条既有警告）、架构通过；格式检查通过 |
| 系统记录 | 修复开始至全量结束后，fixture 诊断仍为原有 10 份，新增 0；本次全量创建的自有临时应用及已安装官网应用完整签名验证通过 |
| 全量 | 2059 文件通过、1 文件失败、2 文件跳过；20043 项通过、3 项失败、10 项跳过，349.14 秒。失败为既有 Web 固定 5173 被其他项目占用，与此修复无关；未改无关测试或终止其他项目，不记为全量通过 |
| 两轴审查 | Standards 0 项，Spec 0 项；全量及系统证据已按审查要求收尾 |

证据目录 `~/.local/share/zcode-local/research/issue-03a/`：`signature-red.log`、`signature-green.log`、`launch-suite-first.log`、`launch-suite-repeat.log`、`diagnostics-baseline.json`、`typecheck-final.log`、`lint-final.log`、`architecture-final-head.log`、`format.log`。全量原始记录为 `full-unit.log`，环境占用为 `full-failure-port-owner.log`。`audit-full-native.json` 与最终 `audit-final.json` 核对本次全量生成的真实临时 app，签名 ID 为 dev.zcode.app、Signature=adhoc，fixture 新报告为 0；审查记录为 `review-summary.md`。

这里的“未新增异常”以签名验证、实际进程退出及本机诊断记录为依据；没有声称自动读取了 macOS 对话框。旧弹窗可能仍需用户关闭，旧诊断文件保留作证据。已安装 `/Applications/ZCode.app` 的只读签名验证通过；不替换应用，不推进 07。

## 复验入口

固定 Node 24.14.0 与 pnpm 10.33.2 后，从仓库执行：

```sh
pnpm exec vitest run packages/desktop/test/localLaunch.test.ts packages/desktop/src/main/local-launch/contract.test.ts
```

macOS 原生用例需要已安装的 Xcode 命令行 clang 与系统 codesign；缺少时应明确失败，不能跳过签名检查或静默降级。其他平台继续沿原条件跳过 macOS 场景。该测试没有安装或启动日常 ZCode。
