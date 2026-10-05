# 外网域名与 V1/V2 整合代码设计

状态：设计提案，尚未实现或部署。2026-10-05。
范围依据：用户明确的“外网域名、V1/V2 合并”；未获得 Mac 端另行发布的任务原文。
分工：Cloud Codex 负责设计与代码改动；Mac Codex 负责综合回归、真实本机验收及发布。

## 1. 已核对的基线

- V2 main：881f80273fef9ea4650efcfcd1b4e1349417a8ae。
- V1 当前运行分支：fix/republish-selection-scope-20261004，d6b3f04ab48db7e18581dd7076c30f8ede2bfa72。
- Mac 发布反馈：V1 198/198 测试与类型检查通过，LaunchAgent 重启成功。该反馈不代表 V2 或外网站点已验收。
- CLOUD-DEPLOYMENT.md 指定候选入口 https://social.vietbridge.one。本文未验证 DNS、TLS 或目标服务器实际上线状态。
- V2 src/server.js 的 cloud 模式已经提供 Basic 登录、Host 检查、持久数据目录和部分本地操作阻断。
- compose.cloud.yaml 将容器 8080 映射到服务器 127.0.0.1:18082。
- V1 本地为 17880，V2 本地为 17882；二者数据库独立。
- V2 src/library.js 通过 ../../Publisher-P0/src/content-library.ts 导入 V1 内容识别代码；当前运行要求两个仓库并列。
- 云模式当前没有 Mac 执行器连接协议，也没有完整 V1 发布模块入口。

## 2. 整合决策

产品整合为一个入口和一套导航：客户、内容库、渠道发布、社群运营、互动、任务、结果、设置。
外网浏览器只访问 social.vietbridge.one 的同源 API。V1 的渠道发布能力成为统一产品的“渠道发布”模块，V2 负责客户与社群运营。

先整合应用服务与界面，保留两个执行引擎及各自 SQLite。
第一阶段不迁移生产历史库，不把 V2 库覆盖 V1 库，不在云端直接导入 V1 worker。
数据库物理合并是独立后续迁移，需有明确映射与证据保留方案；不是统一入口的前置条件。

服务器负责管理界面、客户配置、版本化计划、调度和结果投影。
Mac 保留浏览器登录、平台凭据、本地内容文件、冻结快照、执行 intent、Attempt 和回执。
Mac 主动连接云端；不要求公网访问 Mac 的 17880/17882 或 Chrome CDP 端口。

## 3. 网络与域名

| 入口 | 位置 | 用途 |
| --- | --- | --- |
| social.vietbridge.one:443 | 云端 HTTPS 反向代理 | 浏览器与 Mac 执行器共同访问 |
| 127.0.0.1:18082 | 云服务器 | 反向代理至 V2 容器 |
| 127.0.0.1:17880 | Mac | V1 本地执行引擎与兼容入口 |
| 127.0.0.1:17882 | Mac | V2 本地执行引擎与兼容入口 |
| Chrome CDP | Mac 回环地址 | 本地浏览器 Adapter |

DNS 的 A/AAAA 只能指向实际具备 TLS 代理的服务器；无可用 IPv6 时不要发布 AAAA。
PUBLIC_ORIGIN 必须与外网浏览器实际使用的 HTTPS 根地址一致。
代理保留经过验证的 Host，应用不信任客户端任意 X-Forwarded-Host。
HTTP 跳转 HTTPS；认证请求和执行器请求不跨域重定向。
反向代理设置请求体上限、登录限速和日志脱敏；长轮询超时大于应用等待窗口。

服务器端口和认证配置沿用当前 compose 部署方式。
临时域名可用于预发布，但须同步调整 PUBLIC_ORIGIN，且不能宣称正式域名已绑定。

## 4. 代码模块

建议逐步加入以下模块，不一次重写现有 server.js：

| 模块 | 责任 |
| --- | --- |
| src/http/route-policy.js | 显式标记 CONTROL、LOCAL_EXECUTION、EXECUTOR_PROTOCOL 路由 |
| src/auth/operator-session.js | 管理员会话、过期、退出、每会话 CSRF 校验 |
| src/executors/registry.js | 执行器配对、凭据摘要、客户范围、能力与在线状态 |
| src/executors/command-store.js | 幂等请求、待执行命令、租约、ack 与回执投影 |
| src/executors/protocol.js | 请求 schema、协议版本、大小限制和稳定错误码 |
| src/publishing/service.js | 统一渠道发布计划、审批及与 V1 作业的映射 |
| src/adapters/publisher-v1.js | 本地 V1 接口适配与状态投影，不直接改 V1 表 |
| src/adapters/operator-v2.js | 本地群任务/互动操作适配 |
| executor/agent.js | Mac 出站轮询、能力报告、命令本地持久化和回执上传 |
| packages/content-contract | 后续抽取内容识别/哈希/状态分类纯函数，固定版本 |

route-policy 应替换当前 cloud localOnly 正则。
所有执行路由必须显式声明策略，未知写路由默认拒绝。
现有 /api/publication-verification 系列也需要声明执行策略；云端 GET 不应尝试访问云服务器上的本地浏览器。
cloud 模式只构造管理服务；FacebookBrowser、PublicationVerifier 和本地库按运行模式延迟构造。

先保持并列仓库布局完成兼容；共享包抽取安排在 Adapter 合同稳定后。
共享包不能包含登录配置、固定 Mac 路径、全局账号、数据库连接或自动启动 worker 的副作用。

## 5. 外网 API 合同

所有私有数据查询显式携带 workspace_id；客户端切换客户不能替代服务端校验。
第一版仍是单运营团队管理端，不宣称已具备客户自行登录能力。

管理端合同：

- GET /api/workspaces/:workspaceId/publishing/capabilities
- POST /api/workspaces/:workspaceId/publishing/plans
- POST /api/workspaces/:workspaceId/publishing/plans/:planId/approve
- GET /api/workspaces/:workspaceId/tasks?cursor=...
- GET /api/workspaces/:workspaceId/tasks/:taskId
- POST /api/workspaces/:workspaceId/tasks/:taskId/control
- GET /api/workspaces/:workspaceId/executors

创建计划只创建待确认计划。批准绑定精确平台、目标、账号、身份、内容/媒体哈希、可见性和有效期。
control 使用明确动作 pause/resume/stop/reconcile；reconcile 只能触发独立回读，不能由浏览器提交 found=true 宣告发布成功。

命令体必须含 request_id 与 expected_version。
重放相同 request_id 和相同内容返回同一个对象；相同 request_id、不同内容返回 IDEMPOTENCY_CONFLICT。
响应返回稳定代码，例如 EXECUTOR_OFFLINE、STALE_REVISION、APPROVAL_REQUIRED、RECONCILIATION_REQUIRED。

## 6. Mac 执行器合同

第一版使用 HTTPS 长轮询，减少公网 WebSocket 和本机入站端口依赖。
执行器认证与管理员登录分离，不使用 ADMIN_PASSWORD 作为长期执行器密钥。

- POST /api/executor-pairings：管理员创建一次性、短有效期配对码。
- POST /api/executors/register：配对码一次消费，返回执行器独立凭据。
- POST /api/executors/:executorId/heartbeat：协议/应用版本、客户范围、平台能力。
- POST /api/executors/:executorId/commands/claim：最长等待约 25 秒，原子领取。
- POST /api/executors/:executorId/commands/:commandId/ack：确认命令已经本地持久化。
- POST /api/executors/:executorId/events：按 event_id 与 local_seq 幂等提交事件。
- POST /api/executors/:executorId/commands/:commandId/result：提交结构化结果引用。
- POST /api/executors/:executorId/revoke：管理员撤销执行器凭据并阻止新领取。

密钥只在配对时返回；云端保存摘要，Mac 使用系统 Keychain。
执行器被绑定到允许的 workspace、account、destination 集合。
心跳只报告所需状态，不回传 Cookie、平台 token、本机凭据文件或任意绝对路径。

命令对象包括 command_id、request_id、workspace_id、operation、protocol_version、
payload_revision、payload_hash、approval_ref、executor_id、lease_epoch 和 expires_at。
服务器与本机都校验客户、身份、目标及审批范围。
命令不能包含任意 shell、脚本、URL 抓取或本地文件路径；只接受合同中列出的业务操作。

## 7. 数据归属与可靠性

新增云端对象：executors、executor_scopes、command_requests、executor_commands、
executor_events、publishing_plans、approval_records、execution_links。
execution_links 保存 workspace_id、engine、local_job_id、local_batch_id；
历史 V1/V2 对象分别用 v1: / v2: 命名空间，不能只用相同裸 ID 合并。

云端是计划、审批与命令调度的权威；本机执行库是提交尝试及副作用边界的权威；
平台独立回读是外部发布事实的权威。云端结果是可重建的事件投影。

claim 在事务中推进 lease_epoch。收到命令后先本地持久化、去重，再 ack。
本机 V1/V2 Adapter 必须维护 command_id 到本机作业的唯一映射，重复领取不能新建第二个作业。
提交前仍遵循：冻结包、审批、预检、intent、表单快照、MAY_HAVE_SUBMITTED、单次提交、独立回读。
本地状态推进与待上传事件在同一事务内提交。

ack 丢失、心跳超时或云端租约到期不代表平台没有提交。
未知命令不能自动分配给另一台执行器重新发布；先向原执行器对账，或进入人工核对。
租约 epoch 只能阻止过期写入，不能证明旧执行器没有发起外部请求。
如果不能保证原执行器已停止/已核实未提交，禁止接管提交动作。

执行器离线时界面显示离线；计划可保存为待执行，但不伪装为正在上传或已成功。
云端离线、本机已提交时，本机继续保存回读证据，并在恢复后上传。
未知结果保留 RECONCILE_PENDING，普通 retry 不可用。
公众号 draft_written、无 ID 已核实结果、已删除作品分别保留语义。

## 8. 内容、媒体与历史整合

每个可执行计划绑定不可变 Revision 和媒体 SHA-256。
首阶段只发布执行器已经持有并可重新核验的资源；外网只展示授权的元数据。
如需媒体预览，使用显式同步到云端的快照或执行器上传代理：
按 workspace 与 revision 授权，支持 HEAD/Range，传输有上限；浏览器不能传本机 path 任意读取文件。
云端媒体快照是预览和审批证据，不把上传素材等同于授权平台发布。

旧 V1 客户归属需由已验证的包目录与账号映射建立。
无明确客户的旧任务进入 legacy-unassigned 只读集合，禁止默认为任意新客户所有。
历史导入追加映射及结果投影；不覆写原始 intent、receipt 或时间。
增量同步按 event_id/local_seq 去重；平台查询按索引与游标分页。

## 9. 交付阶段

1. 域名管理端：核对 DNS/TLS，落实显式路由策略与管理员会话，验证云端无本地执行副作用。
2. 统一查询：统一导航及任务投影，完成 V1/V2 命名空间、客户归属及内容元数据映射。
3. 配对与只读连接：Mac 长轮询、心跳、撤销、事件同步；只读能力先验收。
4. 渠道发布接入：V1 Adapter 完成计划/审批/单次命令映射，在 Mock 上验证完整路径。
5. 社群接入：V2 Adapter 保留现有目标校验与群发布人工最终确认语义。
6. 本机综合回归通过后逐阶段发布；数据库物理合并和多租户客户登录另列迁移任务。

每阶段均保留上一版本运行入口与兼容数据。切换统一 UI 不要求停止旧引擎。
应用回滚只回滚兼容代码；恢复数据库快照前必须保留升级后新增执行证据。

## 10. Mac Codex 综合回归任务

Cloud 提交设计和实现分支；Mac 负责完整 V1/V2 测试、本机/目标服务器验收，并回传准确提交和证据。
此设计提交本身不改变运行行为，不能作为新功能已上线的证明。

| 组别 | 必须验证的场景 |
| --- | --- |
| 域名 | 正确 Host/TLS 登录；错误 Host、Origin、过期会话被拒绝；PUBLIC_ORIGIN 不匹配明确失败 |
| 云端边界 | 全部路由策略有覆盖；GET/POST 不会误启动本地浏览器或读取本机文件 |
| 客户范围 | 跨 workspace ID、账号、内容、destination 越权均被拒绝；legacy-unassigned 不可执行 |
| 配对 | 过期/重复配对码、错误密钥、撤销执行器、协议不兼容；错误客户范围不能 claim |
| 幂等与并发 | 重复请求、并发 claim、相同 command_id 不同 payload；本机作业只创建一次 |
| 故障窗口 | claim 后断网、持久化后 ack 丢失、intent 后崩溃、点击后断网、回读后云端断线 |
| 租约 | epoch 过期不接受结果推进；失联命令不自动转移并重复提交 |
| 状态 | UNKNOWN 无普通重试；公众号草稿不当作正式发布；已删除作品不自动重发 |
| 兼容 | 198 项 V1 基线、V2 完整测试、V1 typecheck；已有任务/快照/回执不丢失 |
| 性能 | 1000+ 历史任务分页；媒体 HEAD/Range 不整文件缓冲；空闲轮询有退避；事件补传可恢复 |
| 发布 | 一致 SQLite 备份、升级重启恢复、版本显示、回滚演练、外网 UI 与本机结果一致 |

真实平台副作用仍需精确内容、身份和目标审批；回归默认使用隔离库与 Mock，不创建真实社媒发布。
