# Social Operator V2 架构基线

任务：SMO-PROTO-20260913-001。状态：可进入工程实施；真实平台集成尚未验收。

## 1. 产品和实施边界

采用本地模块化单体：一个本地服务、一个独立 SQLite 数据库、一个 Web 界面。保留当前 Node 运行基础；业务模块使用 TypeScript，浏览器界面经构建产生静态文件。暂不引入微服务、远程队列或桌面封装。

V2 服务绑定 127.0.0.1:17882。Publisher-P0 继续使用自己的目录、数据库和 17880 端口。V2 不导入 P0 的 web-server 或启动其 worker，不直接调用旧服务的写接口。实际平台接入前，通过独立端口的 Mock Adapter 验证完整行为。

本架构沿用 GPT V0.2 的产品目标：多客户运营、内容版本化、社群互动和可核对执行。自进化作为证据和规则治理模块，与确定性执行模块分开；日常发布不依赖模型在线。

## 2. 模块边界

| 模块 | 所有权 | 对其他模块的接口 |
| --- | --- | --- |
| Workspace | 客户、品牌、项目、授权范围 | 生成经过验证的 WorkspaceContext |
| Content | Drive 绑定、内容归属、不可变版本、素材 | 返回指定版本的冻结发布包 |
| Knowledge | 公共来源、事实版本、客户私有知识应用 | 提供事实核心及适用范围 |
| Distribution | 平台/群版本、投放目标、发布计划 | 创建指向明确版本和身份的 Task |
| Community | 群规则版本、匹配、冷却策略 | 提供规则与目标校验结果 |
| Execution | 审批、预检、Task、Attempt、Intent、锁、回执 | prepare / submit / reconcile |
| Engagement | 评论、回复任务、线索及其来源 | 通过 Execution 执行回复 |
| Analytics | 实际作品、指标快照、归因、实验 | 提供有质量标记的证据集 |
| Evolution | 候选规则、实验、反证、晋升和回滚 | 生成版本化规则包；不可直接提交平台动作 |
| Infrastructure | SQLite、文件、事件镜像、进程健康 | 事务、快照存储、凭据引用解析 |

UI 只调用应用服务；应用服务通过带 workspace_id 的仓储访问私有数据。Adapter 只接收冻结执行包，不能任意读取其他客户数据。禁止模块间直接修改对方表。

## 3. 数据对象与隔离

关系：Workspace → Brand / Project → ContentItem → ContentRevision → VariantRevision → Task → Attempt → Receipt。MediaRevision 通过有顺序和角色的关联表绑定内容版本。EngagementTask 关联原 Post、Comment 和 ReplyRevision，复用 Attempt/Receipt 机制。

ChannelAccount 表示平台账号，Identity 表示实际发言身份，ExecutionProfile 表示本地浏览器或 API 环境，Destination 表示 Page、Channel 或 Group；四者必须分别存储和校验。

每个客户私有表包含 workspace_id。父表具有 UNIQUE(workspace_id, id)，子表通过复合外键引用，阻止跨客户关系。所有仓储方法必须接收 WorkspaceContext；不存在省略客户范围的默认查询。Agency 使用单独聚合接口，仅返回必要的任务数量、客户标识和异常摘要。客户端过滤不能代替服务端隔离。

GlobalSource / GlobalFact 只包含获准共享的公共证据。KnowledgeUnit 对事实版本作引用；客户应用、策略、正文、指标和实验默认私有。跨客户共享规则只能使用已脱敏、经审核的证据摘要。

DriveBinding 使用 folder_id/file_id，不依赖文件夹显示名。来源移动触发归属冲突，不能改变已有客户所有权；删除原稿不删除历史。来源更新新增 Revision，不覆写已审批内容。事实更新创建新 fact_core_version，旧派生版本标记过期。

## 4. 存储与版本策略

V2 运行数据默认位于 macOS Application Support/VietBridgeSocialOperatorV2 下：db、assets、logs、backups。数据库和 WAL 不放 Drive。源码继续在独立 V2 Git 中，日志、凭据和运行数据不提交。Mock 和真实环境各自独立数据根。

SQLite 每条连接启用 WAL、synchronous=FULL、foreign_keys 和 busy timeout。迁移使用 schema_migrations，按版本递增；升级前用 SQLite backup API 生成一致快照，不复制活动中的裸数据库文件。回滚应用前检查 schema 兼容性，必要时恢复旧快照；保留升级后新增证据供人工合并。

发布包和媒体按 SHA-256 寻址，保留原文件名作为元数据。App、数据库 schema、Adapter、规则包分别版本化；每个 release manifest 固定四者版本和测试结果。P0 基线仅记录源文件校验值和兼容性测试，不复制登录配置。

## 5. 执行状态与可靠性

GPT 顶级状态作为产品生命周期投影，P0 的细粒度执行状态作为 execution_phase，两者不得混为一个 enum。operation_outcome 单独表示 published / draft_written / confirmed_without_id；公众号草稿不能映射成正式发布。REMOVED 是作品可用性状态，不触发重发。GROUP_MODERATION / VIDEO_TRANSCODING 是 PROCESSING 的原因。

审批绑定 workspace、project、destination、account、identity、execution profile、正文和媒体 Hash、规则版本、操作类型、可见性与有效期。预检再次读取实际身份、规则和会话；任一关键值变化必须重新审批或预检。

Task 的逻辑唯一键包括客户、目标、身份、内容与媒体版本、logical_release_key。重试新增 Attempt，保留 Task 和历史。BEGIN IMMEDIATE 原子 claim，增加 fencing_token；陈旧 worker 不能推进状态。浏览器 profile 锁覆盖整个操作阶段，跨进程共享同一数据库锁记录。

顺序：冻结包 → 审批 → 预检 → claim → 持久化 intent → 填表并保存快照 → 设置 MAY_HAVE_SUBMITTED → 单次提交 → 独立回读 → 保存回执和结果。intent 先于有副作用的网络/浏览器动作；即使在点击前崩溃，恢复也保守对账。

UNKNOWN 不允许普通 retry。对账结果只有 confirmed、authoritative_absence、ambiguous；读取超时、搜索空结果或找不到帖子不足以证明未发布。新 Attempt 需要记录明确的 absence 证据和授权。人工认领 URL 也需核对客户、身份、目标、内容和时间，不能接受客户端 found=true 就写 PUBLISHED。

Facebook Group 发布与回复停在人工最终点击。恢复不能信任旧 tab id 或已保存的 DOM，需要重观察当前页面。处理中或未知状态允许继续读回执；暂停不能终止已经可能提交的动作。

## 6. 本地 API 和启动

查询示例：GET /api/workspaces/:workspaceId/content；命令示例：POST /api/workspaces/:workspaceId/tasks/:taskId/prepare。命令包含 request_id、expected_version；服务端完成权限、版本、外键和状态检查后事务提交。响应只返回该客户允许的数据。

UI 的浏览客户选择是每个浏览器会话的状态，不是全局服务变量。切换活动执行客户的限制在服务端验证，不能通过先返回 Agency 绕过。Agency 不提供执行命令。

本地写接口验证 Host、Origin、JSON Content-Type 和本地会话防伪令牌。错误返回稳定业务代码、当前状态和恢复动作；禁止原样回显凭据及平台敏感响应。

提供启动器：检查 Node、端口与版本，启动服务，等待 health 与 readiness 后打开页面。readiness 验证 HTML、全部脚本模块和数据库迁移。前端有加载失败提示，不能只留空白。进程退出/重启要保留持久任务状态。

## 7. 自进化闭环

实际发布内容和回执 → 按平台窗口追加指标快照 → 质量/可比性检查 → Topic Discovery 或 Matched Packaging 实验 → RuleCandidate → 反证和验证 → 人工晋升 → 新规则版本 → 观察及回滚。

保留 Skill 1.1.0 的 Knowledge Unit、训练/社媒双评分、缺失为 null、平台分别归因和至少三项可比内容或两批独立证据的晋升门槛。公开内容手工改变后，学习使用 actual_body_hash，而不是原计划正文。学习不得自动改写事实、执行代码、身份策略或安全守卫。

## 8. P0 复用方案

优先复用概念和经过验证的纯函数：状态转换、快照校验、结果分类、回执校验。涉及全局账号、固定 profile、硬编码路径或启动 worker 的代码必须先注入客户上下文和明确配置。复制到 V2 的模块记录来源校验值，禁止通过相对路径运行旧应用。

集成顺序按实际能力验证决定：公众号草稿 → Facebook Page → 小红书 → 视频号。Facebook Groups 独立于 Page API，保持人工最终点击。每个 Adapter 先实现 Mock contract，再经过无提交预检和受控试点；任何真实发布仍使用准确内容和目标审批。

## 9. 开发顺序与验收

1. 基础：模块目录、独立持久库、迁移、可靠启动、静态资源和页面加载测试。
2. 客户与内容：服务端隔离、公共事实、DriveBinding、Revision、审批失效。验证越权 ID 和跨客户关联被拒绝。
3. 执行：Mock Adapter、原子 Attempt、intent、崩溃恢复、对账证据、状态投影。并发和断电窗口测试必须通过。
4. 社群互动：Group Rules、Variant、EngagementTask、身份校验、线索来源、人工接管。
5. 分析学习：实际内容归因、指标快照、实验和候选规则晋升；先用固定证据集跑通闭环。
6. UI 全流程与 UC-001—056 逐项验收；每个通过记录测试名或具体演示证据。
7. 评审后接入真实 Adapter，逐客户逐渠道试点并保留版本回滚点。

每阶段必须具备可运行结果、真实测试记录和尚未覆盖项目。用例清单存在不代表用例通过，静态页面存在不代表完整业务实现。

## 10. 当前代码核验与待处理事项

- 已确认页面白屏原因：app.js import /qa-cases.js，而服务器没有该静态路由。HTTP 200 的首页检查未覆盖脚本依赖。
- 全局内存 state 返回全部客户对象，界面过滤没有实现服务端隔离。
- Agency 切换可绕开活动客户切换约束；reconcile 无客户校验且信任布尔结果。
- 已发布/处理中任务缺少再次执行限制；部分社群/互动按钮无动作。
- 数据、客户导航复用 dashboard；无独立数据库和重启恢复。
- 现有测试数量和通过状态仅证明已写的局部检查；UC 自动/可点击覆盖标签不可靠。

这些问题作为新实施的明确入口。GPT 产品状态与 P0 执行状态的映射、REMOVED/草稿/无ID成功语义需要保留在 Review Packet 中；真实集成前完成裁定和兼容性测试。
