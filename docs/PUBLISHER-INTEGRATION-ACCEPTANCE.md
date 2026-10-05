# V1/V2 可运行整合与 Mac 验收交接

task_id: `VB-PUBLISHER-V1-V2-INTEGRATION-PLAN-20261005-001`  
implementation owner: `CLOUD_CODEX`  
status: `REVIEW / 待 Mac 验收`，不能标记 DONE。  
任务原线程：https://vietbridge.slack.com/archives/C0C6PRGNGLQ/p1791189324132619  
验收要求：https://vietbridge.slack.com/archives/C0C6PRGNGLQ/p1791218265854549

## 交付与依赖

- V1：`ian453-ui/vietbridge-publisher-p0`，整合分支 `feat/v1-v2-integration-20261005`，基于运营分支 `fix/republish-selection-scope-20261004` 的 `d6b3f04ab48db7e18581dd7076c30f8ede2bfa72`。
- V2：`ian453-ui/vietbridge-social-operator-v2`，整合分支 `feat/v1-v2-integration-20261005`，基于 PR #5 分支 `fix/interaction-usability-20261005` 的 `21e5dd6541ed2b65787c4a855c340ad31370bbbb`。
- 两个最终 PR 和精确 HEAD 在原 Slack 线程回报；必须一起使用。V2 PR 堆叠在 PR #5 上，Mac 合并 PR #5 后再处理整合 PR 的目标分支。V1 的运营分支仍不是 main。
- 新入口为 V2 的同源 `/publisher/` 页面与 `/publisher/api/*`。只监听一个 V2 端口；V1 请求处理器在同进程内调用，不另起 17880 服务，不通过 HTTP 请求 V2。两个原数据库分别打开，不复制、合并或迁移记录。
- V2 客户和账号选择决定本次 V1 请求上下文。必须配置明确的 V2-account → V1-account 映射；不凭名称或 Page ID 猜测。其他客户当前仅允许 Facebook，其他平台沿用原 VietBridge 专用账号，不能冒充客户独立授权。
- 发布列表在 SQL 层只读取已确认归属的 batch、job、history，固定三次查询。旧任务没有客户字段，未确认归属的记录保留但隐藏，并禁止新任务静默收编它们。
- 浏览器资源锁保存在独立控制目录，按真实 Chrome 目录排他，跨模块与进程有效。V1 Facebook 浏览器端口必须对应 V2 已登记 profile。UNKNOWN 与进程崩溃不自动解锁或重新提交；仅同一 owner 的明确回读能解除。V1 原数据库锁仍保留。其他平台的专用浏览器目录必须由 Mac 核实没有与 V2 共享。
- 默认验收模式禁止 V1 批准提交；可读取、预览、建立待确认任务和停止。`workerEnabled=true` 且 `PUBLISHER_ENABLE_EXECUTION=1` 才会启动原执行器，这是后续 Mac 发布动作，不用于本次无真实社媒写入的验收。
- 全局历史清理、全局账号编辑、全量公众号库存/浏览器管理、Drive 来源重绑等尚无客户范围的功能不经整合入口开放。公众号仍可按已归属的单任务核对。自动 Drive 同步默认关闭，使用现有同步资料库；没有新增 Drive 或平台凭据。

## 安装与启动

需要 Node 24（云端隔离验证为 24.19.0）。在新、干净的 checkout 中准备相邻目录：

```text
release-root/
  Publisher-P0/          # V1 仓库，checkout Slack 中的精确 HEAD
  Social-Operator-V2/    # V2 仓库，checkout Slack 中的精确 HEAD
```

在两个目录分别执行：

```bash
npm install --ignore-scripts --package-lock=false --no-audit --no-fund
npm ls --depth=0
```

本轮云端无法完成 npm 下载；因此 Mac 必须记录实际依赖版本，并以正常安装的 SDK/YAML/axios 运行下面的测试，不能复用云端测试替身。现有依赖没有锁定新的 lockfile。

Mac 复用现有安全启动方式注入已有 `ADMIN_USER`、`ADMIN_PASSWORD`，不要把值写到 PR、Slack、命令输出或此文档。非秘密配置：

```text
PUBLISHER_MODE=mac-tunnel
PUBLIC_ORIGIN=https://publisher.vietbridge.one
DATA_DIR=/ABSOLUTE/EXISTING/V2/DATA/DIRECTORY
PUBLISHER_INTEGRATION_CONFIG=/ABSOLUTE/CONTROL/integration.json
PORT=17882
```

`DATA_DIR/mock.sqlite` 必须是实际现有 V2 数据库；如果其文件名不是 mock.sqlite，用下面的显式入口，不得创建空库替代历史库：

```bash
node src/integrated-server.js /ABSOLUTE/EXISTING/V2/operator.sqlite
```

`config/publisher-integration.example.json` 只是示例。Mac 在控制目录准备真实路径与现有账号 ID，scopeFile 的父目录必须存在；首次可以是空数组 `[]`。不能把同一个数据库同时填写给 V1/V2；启动会在 V2 构造前拒绝相同文件及缺失文件。保留原 staging、ledger、mirror 路径，避免改变既有冻结资源引用。

使用正常 `npm start` 会选择 `DATA_DIR/mock.sqlite`；配置整合时必须确认这个文件已存在。服务只绑定 127.0.0.1。localhost 与 127.0.0.1 两种 Host 均接受，但 mac-tunnel 模式仍要求认证；其他 Host 被拒绝。唯一公网入口保持 publisher.vietbridge.one。不要扩大 Host、关闭认证、增设域名或改动凭据权限。

Mac 在切换前停止旧 17880 发布 worker，防止第二个进程绕过新资源锁。不要在云端替 Mac 重启服务或修改 Tunnel。

## 历史任务归属

不要按文章编号、内容目录或账号名称批量推断。Mac 先依据冻结任务的原账号、快照、表单、凭据和客户记录核对 batch。认证后查询 `/api/publisher-integration?workspace=...&accountId=...` 可获得当前映射的 `scopeFingerprint`。逐条审核后，在 scopeFile 记录：

```json
[
  {
    "batchId": "REVIEWED_EXISTING_BATCH_ID",
    "workspace": "ws-vietbridge",
    "accountId": "EXISTING_V2_ACCOUNT_ID",
    "publisherAccountId": "EXISTING_V1_ACCOUNT_ID",
    "fingerprint": "64_HEX_CHARACTERS_FROM_SCOPE_FINGERPRINT",
    "sourceRef": "REVIEW_EVIDENCE_REFERENCE"
  }
]
```

这只登记归属，不迁移任务、凭据、状态或发布结果。改过账号/内容根目录/平台绑定后，旧 fingerprint 不再匹配；不得自动改归属来绕过检查。scopeFile 在启动时读取，人工调整后使用受控重启。由新入口建立的任务会原子登记归属；跨文件失败时任务保持待确认且不可见，必须检查原数据库后登记恢复，不能再次建任务代替恢复。

## 云端证据与边界

当前已通过：V2 61 项、V1 19 项相关测试，以及此前独立框架 20 项。生产代码测试覆盖真实 V1/V2 handler、真实 SQLite、待确认草稿建立、停止、内部校验报告、重启后归属、两客户隔离、未知历史保护、同文件拒绝；共享锁另覆盖物理目录别名、跨实例排他、UNKNOWN、崩溃保留与旧 token 防护。V1 新 UI 的两个 inline script 均编译验证，fetch/媒体路径携带冻结客户账号。测试数以最终 Slack 运行记录为准。

重要限制：云端 npm 网络连接遭 EPERM。上述生产处理器测试使用禁止外部调用的 MCP/axios 测试替身；YAML 使用上游源码 commit `528ef30d6ded4bd9f2c3521b670eb2b29d503c5c`，playwright-core 使用环境现有包。这些仅为本地测试依赖，不进入交付 PR。未调用真实平台。

云端测试是进程内请求处理器，未完成真实 socket HTTP、浏览器渲染、Mac Chrome、完整 SDK 依赖、全量测试或 TypeScript typecheck；不能据此宣称已上线或完整可用。真实 UI 页面需 Mac 检查 iframe、认证缓存、nonce CSP、图片/视频、切换账号后 iframe 更新及保留滚动状态。

## Mac 最终动作与验收

1. 获取两个 PR 的精确 HEAD；在隔离 checkout 记录 `git rev-parse HEAD`、`git status --short`、Node 与依赖版本。完成 V1 `npm test`、`npm run typecheck`，V2 `npm test`。本轮变更的专项用例：V1 integration-ui / batch-list-performance；V2 publisher-integration / browser-resources / publication-verifier / interaction-repair。
2. 在隔离数据副本中跑真实 HTTP：localhost、127.0.0.1、公网 Host、伪造 Host、未登录、错误 Origin/token、媒体 GET/HEAD。确认未授权仍为 401，错误 Host 被拒绝，合法认证 Host 不再是 409。
3. 用两个实际配置的隔离客户/账号测试：V1 Tab 同源打开；候选、正文、图片/视频可预览；建立任务后账号切换不会改变原任务；别的客户不能读取/停止该任务；历史归属和账号变更检查有效；停止/恢复/重试保持既有不重复提交约束。
4. 只读浏览器走完主题搜索与回复、群组扫描与互动两个视图：前者基于主题候选，后者按指定群组扫描，均使用所选账号。保留各自发现视图和共享额度/候选记录，不假装两者相互替代。只扫描与预览，不点击真实执行。真实发帖、点赞、回复不属于此轮验收。
5. 隔离执行适配器验证共享浏览器排他、不同目录并行、准备阶段失败、提交后不明结果、服务退出/重启和回读恢复。不得删除未知结果锁以通过测试。V1 Facebook 浏览器 CDP 端口要登记到现有 V2 profile；检查其他专用浏览器没有目录冲突。控制文件损坏、残留 readback 目录或不可核实 owner 只报告阻断，不能自动抢锁。
6. 合并顺序：V1 运营分支上的配套 PR；V2 PR #5 及其整合 PR（合并 #5 后必要时改目标分支）。由 Mac 处理原有未提交改动，云端不覆盖。两仓库必须成对发布，不能只更新 V2。
7. 发布前按下面备份。使用已有凭据和 publisher.vietbridge.one 的现有入口部署新 V2 单服务；停止旧 V1 worker。验收期间 V1 执行器保持关闭，不批准/调度真实任务。若 Tunnel 配置还不能访问，报告准确阻断，不另开第二域名或关闭认证。
8. 公网登录后完整回归同源 V1/V2 UI/API、客户隔离、历史数据保留、媒体和重启。回原 Slack 线程给出两仓库实际运行 HEAD、干净工作树证据、URL、HTTP 状态与测试结果、日志/截图位置、剩余缺口。线上回归前保持 REVIEW；不以能打开域名或旧测试结果代替验收。

## 备份与回滚

- Mac 停止两个旧服务与 worker 后，用 SQLite backup API 或 sqlite3 `.backup` 分别备份两个数据库；不能只拷贝正在写入的 `.sqlite` 而漏 WAL。记录各自表/任务数、状态分布和文件校验信息。
- 单独备份 scopeFile、browser-resource-locks、原 staging、ledger、mirror、启动参数及两个旧提交；不要把凭据内容打包到交接材料。保留未知结果锁。
- 发布失败先停新服务与所有 worker；恢复成对的旧代码与原启动方式。未改变数据库数据格式，不自动恢复旧数据库覆盖上线后的任务。若必须恢复数据库，先保留失败版本完整快照，由 Mac 核对新增任务/未知结果，禁止丢弃提交证据。
- 回滚也不能恢复第二个公网域名或绕过认证。未知提交先独立回读；没有证明失败时不重发。
