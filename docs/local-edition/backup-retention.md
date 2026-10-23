# 15 应用与数据备份

Status: in-progress

设计及验收源：[15 工单](../issues/zcode-local/15-backup-retention.md)。父规格冻结不变；本票不启动候选、不安装或替换应用、不覆盖业务数据，16 尚未开始。

## 使用与所有权

使用 `mise.toml` 声明的 Node 24.14.0 / pnpm 10.33.2，在仓库根执行：

```sh
pnpm local:maintain backup --home /absolute/isolated-home --data-root /absolute/isolated-data --local-app '/absolute/current/ZCode Local.app' --official-app /absolute/official/ZCode.app --app-manifest /absolute/current-candidate/candidate.json --backup-root /absolute/private/backups
pnpm local:maintain backup-list --backup-root /absolute/private/backups
pnpm local:maintain backup-verify --backup-root /absolute/private/backups --id backup-UUID
```

所有路径必须显式绝对指定。`app-manifest` 对应当前要备份的 Local 应用，不能拿新候选清单描述旧应用；入口重新核对完整应用树、包内版本/源码和 deep/strict 签名。备份根首次必须不存在、父目录已存在，不能收编已有空目录或任意目录。根、分组及清单为本机私有，标记绑定真实根；不上传 fork。暂不支持 macOS 以外主机，Intel 仅沿用候选的系统边界 fixture，不宣称实机验证。

维护脚本独占 backup-root.json 和各组 backup.json；没有新增候选数据库。`local-launch.withMaintenance` 只提供原启动所有者的静止文件临界区，复用设置中的实际数据根、双根锁和进程观察；preparing/running、异常遗留或未知记录都拒绝。整个复制及校验期间持锁，不接管机器人任务、不强杀。绕过受控入口直接启动应用的竞争继续受 03 的已披露边界限制。

备份包括 Local 完整应用、home/实际业务根各自的 `.zcode` 文件、CLI 配置与历史、业务 v2 和 Local v1 记录；home/data 相同时只存一次。不包括项目工作区文件、Electron profile 缓存、启动 owner/锁或外部系统密钥库；不解密秘密。外部/绝对/悬空链接、特殊文件或缺失业务 v2 使操作失败，不能靠省略它们宣称完整。内部相对链接、模式和文件内容保留。

备份先预留快照、恢复演练及 64 MiB 余量，再创建 UUID pending 组；源/副本完整 hash 一致、源再次核对、独立复制恢复及 SQLite integrity_check 全部通过后，原子写 ready 清单。数据库页头及 .db/.sqlite/.sqlite3 均需识别，坏页头也不能绕过。文件恢复演练只使用备份根内临时副本，结束删除该副本，不覆盖源、不启动应用。

ready 清单记录版本、完整源码锚点、时间、创建顺序、数据身份和来源/快照 hash。list 每次核对内容、包元数据与签名；verify 另重做恢复演练和 SQLite 检查。`usable` 表示本机文件可完整复制还原、数据库结构有效及应用验签通过，不代表跨版兼容、系统凭据迁移、GUI、真实模型或群协作验收。16/17 使用前必须再 verify，不能只读取 status 文本。

仅在新快照完成后，按规范化 home/data 身份各保留最近三组有效基线；重新演练保留的三组后才能删除同身份更旧的有效组。失败、半成品、损坏、未知组和其他身份的唯一基线不被清理，也不计入三组。清理仅限带本根 owner token 且重新核验通过的 UUID 组目录，拒绝 symlink、穿越和来源重叠；不触碰未知文件。清理失败返回失败并保留恢复依据。根锁崩溃遗留需先人工核实维护进程确已结束，不自动按时间夺锁。

## 验证与证据边界（2026-10-23）

证据根为本机仓库外 `${HOME}/.local/share/zcode-local/research/issue-15/`，没有访问/复制日常业务数据或真实机器人凭据。

- 红→绿：新增公开 backup 入口；伪造源码锚点；危险目标须在写入前拒绝；坏 SQLite 页头。日志见 `logs/backup-red/green.log`、`retention-red/green.log`、`database-header-red/green.log`。
- 维护进程测试覆盖原 check/build、可恢复备份、三组保留、跨身份唯一基线、空间不足、复制 ENOSPC、复制中源变化、坏数据库、占用/未知状态、重定向、外部链接、私有根、穿越及目录别名；文件与 Git 使用真实临时目录，网络/打包/签名及故障在系统边界注入。真实 SQLite 建表、查询和 integrity_check 不使用替身。`logs/maintenance-final.log` 记录最终套件。
- 受控启动回归首轮 2 文件 / 17 项通过；补充公开维护契约后单文件 2 项通过，见 `logs/launch-regression.log`、`maintenance-contract.log`。并发复制测试实际持锁约 8 秒拒绝另一根的竞争操作，结束后同根再次备份成功，见 `maintenance-locks.log`。
- 实际签名文件演练：使用 14 的 `7d6141bcef0c5c79968532ea895dd1401b567d88` arm64 候选，加全新合成 home/数据、Local v1 标记和 SQLite 任务。backup 与独立 backup-verify 均成功，编号 `backup-9dbdc512-94f6-45b7-a6a9-cf2078aeb32e`，证据见 `actual-files/backups/`、`logs/actual-backup.log`、`actual-verify.log`。原签名候选未改动；备份应用独立 codesign 验证通过，备份数据库读回 `synthetic recovery evidence` 并 integrity_check=ok。没有 GUI 启动、安装或真实群操作。
- 类型、Lint、架构与格式结果在收尾记录。根完整单测未请求、未执行；维护脚本套件和受影响启动边界已实际运行，不以 affected 选择或文件存在冒充全量根测试。

失败披露：首次 Lint 因新增测试把原文件推过 800 行失败，拆分为两个命令测试文件并共享既有系统夹具后通过；首次源变化故障注入使用 macOS `/var` 路径别名而未命中，改为匹配实际源后用例通过，未把夹具错误计为产品根因。坏页头回归确实先暴露漏检，再修正为按 magic 与数据库扩展名共同识别。保留原始失败日志。

开工 HTTPS freshness fetch 超时；GitHub API 确认 fork 分支 HEAD 后，通过官方公布主机密钥的严格验证、SSH 443 和单次命令级 URL 映射完成实际 fetch，新鲜度检查通过。保存的 origin/upstream 地址和官方禁推配置未修改。

## Standards / Spec

待固定源码提交后进行独立双轴审查；最终结果在这里归档。
