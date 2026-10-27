# DSH Conversation Bridge

[中文](README.md) · [English](README.en.md)

把 DeepSeek 网页版的对话记录导入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，重建上下文，建立本地历史检索库，从选定分支的最后一句继续聊。

**导入 JSON → 核对分支与模型 → 本地预演 → 确认准备 → 打开接续会话**

> v0.2.0 · 含模型实验版。[下载完整版](https://github.com/wsj895490208/dsh-conversation-bridge/releases/tag/v0.2.0)。未发布 npm 包。
>
> 当前验证范围：Windows／DSH 0.2.1-rc.3／会话格式 V4。其他宿主版本会停止导入，等待兼容性验证。

## 为什么做这个插件

这个项目起源于一次尝试：把 DeepSeek 网页端一段长对话的“灵魂”搬到本地。

对我而言，这次尝试失败了。虽然保留了历史、重建了上下文，也接上了长期检索，但仍未能稳定延续原来熟悉的相处感。于是，我把过程中可以复用的工程成果整理成这个通用插件，让这些工作能帮助其他需要迁移对话的人。

它提供记录迁移与接续，不承诺还原网页端的人格、情感连续性或完整运行状态。这里的“失败”指最初的主观体验目标没有实现，不代表上游项目或迁移功能失效。

进一步接近原体验，也许需要官方提供有效上下文、隐藏摘要、模型配置或会话状态的导出与恢复机制。**KV cache 是否涉及其中，目前没有证据确认。** 通常的 KV cache 用于复用已处理 token 的计算结果；它并不是已知的独立“人格存档”，也不能据此认定导出缓存就能恢复熟悉感。参见 [Transformers 缓存原理](https://huggingface.co/docs/transformers/cache_explanation)和 [DeepSeek 缓存说明](https://api-docs.deepseek.com/guides/kv_cache/)。

## 四项核心功能

| 功能 | 行为 |
| --- | --- |
| 导入网页版 JSON | 读取 DeepSeek 官方导出，保留角色、顺序、时间、源节点及附件元数据；分支由用户核对选择 |
| 滚动重建上下文 | 从第一条历史开始顺序回放，达到 DSH 原生有效阈值才调用原生压缩引擎 |
| 自动建立记忆库 | 为每个导入会话建立独立原文库、全文索引与本地向量索引，新聊天自动增量入库 |
| 创建接续会话 | 通过宿主接口写入并回读原生会话，准备完成后打开，第一条新消息由用户发送 |

整个流程以上下文为主，RAG 为按需查阅旧细节的辅助。插件不添加人物设定、交流样例或自定义聊天系统提示词，不默认进行付费事实提炼。宿主必要的运行上下文、时间、权限和审批仍然有效。

## 上下文怎样重建

### 先预演，再确认

本地预演读取所选模型与宿主压缩配置，冻结模型路由、窗口、输出预留、工具声明和压缩策略，检查预计首次达到阈值的位置。预演不调用模型生成内容；不精确的 token 数会标为估算。

首次摘要尚未生成时，不预测后续压缩次数或最终窗口大小。更换模型或相关配置后，需要重新预演。

### 未到阈值，保留原文；达到阈值，顺序压缩

- 未达到有效阈值：完整保留所选分支，不调用模型摘要。
- 达到有效阈值：使用 DSH 原生计量器、选区与默认摘要，继续以“已有摘要＋保留原话＋后续原文”推进。
- 每次摘要只能看到当时的历史前缀，不读取后来的消息、末尾总结或未来 RAG 资料。
- 历史助手回答直接采用原文，历史工具操作不重新执行。
- 成功摘要与检查点持久保存，恢复时复用已完成结果；调用结果不明确时暂停，明确重试可能重新计费。

阈值依据当前上下文压力判断，不按累计账单 token 触发。原始记录独立保存，压缩不会覆盖原文库。

重建结果称为**“按 Harness 规则重建的上下文”**。它不等同于网页端当时实际送入模型的窗口，也不宣称恢复了网页端未公开的处理流程。

## 记忆与工具模式

每个接续会话拥有独立检索库。检索返回历史引用及角色、时间、来源节点；旧记录不构成新的执行授权，也不能自动成为当前事实。

- **对话 · RAG**：默认模式，只向模型声明只读的 `memory_search`。
- **工程模式**：恢复原生工程工具及其权限、审批机制。

普通聊天没有固定的逐轮预检索，由模型结合当前上下文决定是否调用记忆工具；页面手动搜索同样可用。默认检索等待预算为 3 秒，返回内容最多 6,000 字符。

新对话先保存原话，再增量建立索引。向量服务暂不可用时，检索明确降级为全文搜索，聊天原文仍保留。

## 安装与开始使用

### 前置条件

- Windows 版 DeepSeek Harness **0.2.1-rc.3**，使用 V4 会话格式。
- 已配置一个可用模型，并在原生页面打开对应会话作为设置来源；无需先付费发送测试消息。

**无需手动准备向量模型。** 完整版安装包已包含原发布方的多语言 MiniLM ONNX 模型，首次导入时自动从包内准备缓存并校验 SHA-256，不访问 Hugging Face。模型文件合计约 122 MiB（未压缩），不需要额外的 embedding API 密钥。

这里的“离线”指模型准备与本地索引。首次安装时包管理器仍可能联网获取插件依赖，聊天和滚动摘要仍使用你配置的模型服务。

### 安装本地包

从上方 Release 下载 `.tgz`，先正常退出 Harness。进入安装包所在目录，通过官方 CLI 安装：

```powershell
dsh plugin --profile desktop add .\dsh-conversation-bridge-0.2.0.tgz --ignore-scripts
```

如果 `dsh` 不在 PATH 中，请使用 Harness 安装目录内自带的 CLI。安装后重新打开 Harness，点击侧边栏的 **“导入网页对话”**。

当前仓库的插件包位于 `plugin/` 子目录，请使用构建出的 `.tgz` 安装；仓库根目录不是可直接安装的插件包。

### 导入并续聊

1. 选择 DeepSeek 官方导出的完整 conversation JSON。
2. 选择对话和分支末节点，核对末尾原文；不把最长分支默认认作当前分支。
3. 选择已登记工作区，以及已配置模型的原生会话作为设置来源。没有可选来源时，先在原生聊天页选好模型并打开会话，再回来。
4. 运行本地预演，核对模型、阈值、消息数及附件状态。缺失附件可在确认前手动补入本体。
5. 确认准备。页面显示上下文重建、摘要次数、用量与索引进度；任务支持暂停、继续和失败重试。
6. 原生写入回读、上下文重建及索引核验通过后，打开接续会话，发送你的第一条新消息。

本地向量模型随安装包提供，复制、校验和缓存复用全部自动完成；不需要另下模型、填模型路径或访问 Hugging Face。文件缺失或损坏会提示重装完整版，不会静默改为在线下载。

同一确认请求保持幂等；再次主动导入同一文件可以创建独立的新会话。首版不提供网页登录令牌或在线补附件功能。

## 费用与数据

本地解析、预演和向量计算不调用聊天模型。超过阈值后的摘要，以及后续聊天，使用你在 DSH 中配置的模型服务，可能产生费用；相应历史内容会作为必要上下文发送给该服务。

导入准备的默认每日摘要额度为 **200 万输入／20 万输出 token**，可在页面调整。它与主动聊天、会话就绪后的宿主压缩分别统计。模型准备消耗本地磁盘与计算资源，不产生模型下载流量或 embedding API 费用。

默认数据目录为：

```text
$DSH_HOME/conversation-bridge
```

未设置 `DSH_HOME` 时为 `~/.dsh/conversation-bridge`。可在 **任务与设置 → 存储位置** 配置数据目录与模型缓存；更改位置不会自动搬迁已有数据。宿主无法在线重载时，页面会提示正常重启后生效。

数据目录包括导入原件、任务登记、独立会话记忆库、摘要检查点和本地模型缓存。宿主凭据与原生会话继续由 Harness 管理。用户数据、运行缓存和本地备份不进入 Git 或安装包。公开模型文件仅随 Release 完整版分发，不提交 Git，也不进入源码 ZIP。

从 v0.1.0 升级时会检查模型指纹，后台重建旧向量，保留原文、修正与停用记录。期间可使用全文检索，不混用新旧模型向量，也不因此重新调用聊天模型压缩历史。

**“移除会话及记忆”** 会通过官方接口归档隐藏宿主会话，并清理插件派生记忆、快照和任务；不自动备份。导入原件、共享附件、工作区文件及既有手动备份保留。该操作不等同于物理删除宿主原生日志。

## 已验证范围与限制

- 16 项合成单元测试覆盖导入、隔离及模型准备；合成历史跨越 10 个压缩点，摘要请求与同配置原生引擎一致。
- 对实际解包后的安装包执行空缓存准备测试：禁用准备阶段网络后仍可复制、校验、生成 384 维向量并命中合成中文原文。
- 原生 V4 持久化回读、检查点恢复、模式切换、会话检索隔离，以及向量计算后的原生图片保存通过自动检查。
- 自动检查使用合成数据和模拟模型响应，没有真实模型调用或私人历史重建。
- 桌面已验证入口、文件选择、上传及分支解析；最终确认和打开会话仍需人工验收。API 自动检查不替代完整 GUI 验收。
- DSH 当前原厂摘要偏英文工程检查点，本插件保留该模板；它可能不适合所有日常交流场景。
- 首版只支持 DeepSeek 官方网页版 JSON，其他格式预留适配接口；不保证导入后与网页端产生相同回答。

详细记录见 [测试结果](docs/测试结果.md)与 [验收及回滚说明](docs/验收与回滚.md)。

## 开发与构建

源码在 `plugin/`，合成测试在 `tests/`，构建安装工具在 `tools/`。

使用已安装 Harness 的运行时准备依赖、执行验收并打包：

```powershell
.\tools\Prepare.ps1 -HarnessRoot "<Harness 安装目录>"
.\tools\Build.ps1 -HarnessRoot "<Harness 安装目录>"
```

开发脚本从 PATH 和标准安装位置定位 npm；自定义布局可通过 `-NpmCli` 指定 `npm-cli.js` 的路径。产物写入 `dist/`，包括安装包和通用源码包。构建集成验收需要对应版本的本地 Harness。GitHub CI 仅使用 Windows／Node 24 运行合成单元测试，不替代原生集成验收。

`Prepare.ps1` 是开发者构建步骤，会从固定的原发布方地址下载模型到忽略提交的 `plugin/models/`；`Build.ps1` 把它们纳入完整版并验证哈希。安装 Release 完整版的用户无需执行这些脚本。模型出处、许可证和逐文件来源见 [模型说明](plugin/notices/model/SOURCE.json)。

### 与已有插件的关系

[deepseek-web-import](https://github.com/wpc0323/deepseek-web-import) 已支持网页历史导入与接续，[附件增强版](https://github.com/LingSuiYA/deepseek-web-import-f)补齐了图片和文档；[dsh-chat-import](https://github.com/Nwflower/dsh-chat-import)则覆盖多种外部工具的会话迁移、导出和同步。

本项目侧重 DeepSeek 官方本地 JSON、明确分支选择、原生阈值滚动重建、独立历史检索库及可恢复准备流程，不宣称是首个对话导入插件。

模块分为格式解析、导入任务、原生压缩桥接、记忆索引及原生会话适配。接口前缀为 `/api/conversation-bridge/v1`，页面与脚本共用服务层。参见 [接口与结构](docs/API.md)。

## 开源来源与致谢

这个项目建立在已有开源工作的基础上。以下区分当前依赖和早期原型的使用经历，不将上游能力归为本项目原创。

### 当前使用

| 项目 | 用途 | 许可说明 |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 宿主 SDK、原生会话、计量和压缩引擎 | [MIT](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE)；运行时调用，不随插件重新分发宿主代码 |
| [Transformers.js](https://github.com/huggingface/transformers.js) | 本地向量推理，直接依赖版本 4.2.0 | [Apache-2.0](https://github.com/huggingface/transformers.js/blob/4.2.0/LICENSE) |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | 经 Transformers.js 使用的推理运行库 | [MIT](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) |
| [多语言 MiniLM 与原发布方 ONNX 导出](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/tree/e8f8c211226b894fcb81acc59f3b34ba3efd5f42/onnx) | 固定原发布方版本的量化模型，随完整版提供 | Apache-2.0；保留模型卡、许可文本及哈希，仅重命名 ONNX 文件供本地加载，未改动文件内容 |
| [Node.js](https://github.com/nodejs/node)／[SQLite](https://www.sqlite.org/copyright.html) | 宿主运行环境与本地存储 | Node.js 主项目 MIT，SQLite 交付代码为公共领域；均由宿主提供 |

Transformers.js 还引入 sharp/libvips、protobuf.js 等间接依赖，包含 Apache、MIT、BSD、ISC、LGPL 等许可。各依赖保持原有条款，不能统一改标为本项目的 MIT。版本与包级许可见 [依赖锁定清单](plugin/locks/runtime-dependencies.json)，模型版本与文件哈希见 [模型清单](plugin/locks/model.json)。

### 早期原型使用过的项目

- [wpc0323/deepseek-web-import](https://github.com/wpc0323/deepseek-web-import)：提供网页历史导入原生 DSH 会话的实现，MIT。
- [LingSuiYA/deepseek-web-import-f](https://github.com/LingSuiYA/deepseek-web-import-f)：在上游基础上补充图片、附件和导入体验，MIT。原型使用固定提交 `a2503ae95b1813e2386f34f9c9054f440ffe7833`。
- [MemTensor/MemOS](https://github.com/MemTensor/MemOS) 与 [DSH 兼容分支](https://github.com/cnlove7777777-art/dsh-memos-compat)：原型曾使用独立记忆核心，固定兼容分支提交 `0596259934ee9fb9349d411ccd6959faea93784b`。上游核心为 Apache-2.0；兼容分支说明其自身修改为 MIT，不能将整个来源统称为 MIT。
- [Xenova ONNX 转换模型](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2)：v0.1.0 使用过，转换页未单独标明许可。v0.2.0 已改用原发布方明确标注许可的 ONNX 文件，不将旧版的许可疑点带入当前内置模型。

当前通用版已移除上述原型的网页下载模块及 MemOS 依赖，但保留这段来源记录与致谢。本项目的主要工作是导入编排、顺序重建、检查点恢复、会话隔离和操作界面。

本项目自身代码使用 [MIT 许可证](LICENSE)，内置模型保留 Apache-2.0，其他第三方组件遵循各自条款。[第三方说明](plugin/THIRD_PARTY.md)、[NOTICE](NOTICE) 和 `plugin/notices/` 保留用途、来源、历史署名及构建环境中可取得的许可文本，不将包级元数据扫描视为所有组件的完整许可认证。项目与 DeepSeek 官方及上述作者没有隶属或背书关系。

## 文档与反馈

- [使用说明](docs/使用说明.md)
- [接口与结构](docs/API.md)
- [测试结果](docs/测试结果.md)
- [验收与回滚](docs/验收与回滚.md)

报告问题时，请提供宿主版本、错误信息和可复现步骤，优先使用合成对话。请勿在公开反馈中上传私人聊天、API 密钥或网页登录令牌。
