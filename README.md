# DSH Conversation Bridge

[中文](README.md) · [English](README.en.md)

把 DeepSeek 网页版的对话记录导入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，重建上下文，建立本地历史检索库，然后从选定分支的末尾继续聊。

**导入 JSON → 核对分支与模型 → 本地预演 → 确认重建 → 打开接续会话**

> **v0.2.0 · 实验版，向量模型已内置。** [下载完整版](https://github.com/wsj895490208/dsh-conversation-bridge/releases/tag/v0.2.0)。暂未发布 npm 包。
>
> 目前只在 **Windows／DSH 0.2.1-rc.3／会话格式 V4** 上验证。其他宿主版本会停止导入，等待兼容性验证。

## 先说清楚：它做什么，不做什么

这个插件负责“搬运”和“接续”：把网页端的原始记录带进 DSH，按 DSH 的规则重新组织上下文，再为这段历史配一个独立的检索库。

它不负责复原网页端没有公开的东西。人物的语气、情感连续性、当时实际送入模型的窗口，以及服务端的内部状态，都不在迁移范围内；导入后也不保证得到和网页端相同的回答。

这个项目源于一次尝试：把一段长对话搬到本地。历史、上下文和检索都接上了，但那种熟悉的相处感没有稳定延续。于是把过程中可复用的工程成果整理成了这个通用插件。

所以它提供的是记录迁移与接续，不承诺还原人格或完整运行状态。如果想更接近原体验，可能需要官方提供上下文、隐藏摘要、模型配置或会话状态的导出与恢复机制。**目前没有证据表明缺失的 KV cache 是原因**：KV cache 通常只是复用已处理 token 的计算结果，并不是一份独立的人格存档。参见 [Transformers 缓存说明](https://huggingface.co/docs/transformers/cache_explanation) 与 [DeepSeek 缓存说明](https://api-docs.deepseek.com/guides/kv_cache/)。

## 四个核心能力

| 能力 | 你会得到什么 |
| --- | --- |
| 导入网页版 JSON | 读取 DeepSeek 官方导出，保留角色、顺序、时间、源节点和附件元数据；选哪条分支由你核对决定 |
| 滚动重建上下文 | 从第一条历史开始顺序回放，只有达到 DSH 原生有效阈值时才调用原生压缩引擎 |
| 自动建立记忆库 | 为每个导入会话建立独立的原文库、全文索引和本地向量索引；新聊天自动增量入库 |
| 创建接续会话 | 通过 DSH 接口写入并校验原生会话，准备完成后打开；第一条新消息由你发送 |

整个流程以上下文为主，RAG 检索只是按需查阅旧细节的辅助。插件不会添加人物设定、交流样例或自定义聊天系统提示词，也不会默认做付费事实提炼。宿主的运行上下文、时间、权限和审批机制照常生效。

## 安装与开始使用

### 前置条件

- Windows 版 DeepSeek Harness **0.2.1-rc.3**，使用 V4 会话格式。
- 已配置一个可用模型，并在原生页面打开过对应会话，作为设置来源。空白会话即可，**不需要先发一条付费测试消息**。
- 安装包或完整插件目录里带有原发布方的多语言 MiniLM ONNX 模型（5 个文件，约 **122 MiB** 未压缩），不需要单独下载模型、配置模型路径或申请向量服务 API 密钥。首次导入时会把模型复制到缓存并逐文件校验 SHA-256，不访问 Hugging Face。

安装只需要 Windows 版 Harness 和安装包或完整插件目录；用于聊天和摘要的对话模型、设置来源可以在第一次导入前再准备。

这里的“离线”只指模型准备和本地索引。首次安装时，包管理器仍可能联网获取插件依赖；聊天和滚动摘要仍使用你配置的模型服务。

### 安装

有两种方式：

- **方式 A：DSH 界面安装**：最方便，但要求你已经有本仓库的 `plugin` 目录，并且依赖和模型都齐全。
- **方式 B：Release 包安装**：适合普通用户、新机器，或者没有本仓库依赖目录的情况。

#### 方式 A：DSH 界面安装（本仓库目录）

如果你已经把仓库下载到本地，并且 `plugin\node_modules` 和 `plugin\models\multilingual-minilm` 都存在，可以直接在 DSH 里选这个目录：

```text
<仓库目录>\plugin
```

例如：

```text
E:\DeepSeek Harness\DSH-Conversation-Bridge\plugin
```

1. 打开 DSH 的插件管理/设置，点击 **“添加插件”**。
2. 把上面的目录路径粘贴到输入框。路径有空格时，加英文引号也可以。
3. 点 **“安装”**。
4. 如果侧边栏没有出现 **“导入网页对话”**，重启 Harness。

> 如果插件列表里已经有旧版（例如 0.1.0），先卸载旧版再装。这个弹窗对第三方插件通常不提供原地升级；卸载不会删除 `conversation-bridge` 数据目录。

**注意：这是本地链接安装，不是复制。**

- DSH 会把所选目录以 `link:` 方式挂进 profile，不会额外安装这个目录的 npm 依赖。所以目录里必须有 `node_modules`；如果缺依赖，改用方式 B。
- Release 包解压后的目录没有 `node_modules`，不要直接拿来走方式 A。
- 安装后不要移动、改名、删除或清理这个目录，否则插件会失效。
- 本地目录插件没有“更新”提示；换版本时先卸载，再选新目录。

#### 方式 B：Release 包安装（普通用户推荐）

如果你没有本仓库的完整开发目录，或者只想安装固定发布版，用这种方式。Release 包会由 pnpm 安装依赖，并带上模型。

1. 从上方 Release 下载 `dsh-conversation-bridge-0.2.0.tgz`（约 73 MiB）。
2. 完全退出 Harness：关闭所有窗口，并在任务管理器确认 `DeepSeek Harness.exe` 已结束。
3. 打开 PowerShell，进入 `.tgz` 所在目录。
4. 执行安装：

```powershell
dsh plugin --profile desktop add .\dsh-conversation-bridge-0.2.0.tgz --ignore-scripts
```

如果提示找不到 `dsh`，改用 Harness 自带的 CLI：

```powershell
& "<Harness 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add .\dsh-conversation-bridge-0.2.0.tgz --ignore-scripts
```

把 `<Harness 安装目录>` 换成 `DeepSeek Harness.exe` 所在目录，例如 `E:\DeepSeek Harness`。

5. 重新打开 Harness。侧边栏出现 **“导入网页对话”** 即安装完成。

说明：

- `--ignore-scripts` 是本插件要求的参数，不要省略。
- 安装阶段通常需要联网解析 JavaScript 依赖；模型文件已经在 tgz 里，不会访问 Hugging Face。
- 第一次安装可能需要几分钟，等待命令结束。
- 不需要管理员权限。

#### 安装失败时

- **方式 A 提示路径不存在 / 不是目录**：确认选的是 `plugin` 目录，不是仓库根目录。
- **方式 A 装完加载失败**：多半是目录里缺 `node_modules`，改用方式 B。
- **方式 B 提示找不到 `.tgz`**：先 `Get-ChildItem *.tgz` 确认文件名，再 `cd` 到文件所在目录。
- **装完没有入口**：重启 Harness；仍没有就确认安装目录里有 `package.json`、`client/`，并确认 DSH 是 0.2.1-rc.3。
- **首次导入提示模型缺失**：确认 `models/multilingual-minilm` 下有 5 个模型文件；缺了就用方式 B 重装。
- **安装时报依赖或网络错误**：检查网络、代理或安装源后重试。

#### 卸载

在插件列表里移除，或执行：

```powershell
dsh plugin --profile desktop remove dsh-conversation-bridge
```

卸载不会删除 `conversation-bridge` 数据目录，重新安装后还能继续用。

### 导入并继续

1. 选择 DeepSeek 官方导出的完整 conversation JSON。
2. 选择对话和分支末节点，核对末尾原文。不要默认把最长分支当成当前分支。
3. 选择已登记的工作区，以及一个已配置模型的原生会话作为设置来源。没有可选来源时，先在原生聊天页选好模型并打开会话，再回到导入页。
4. 运行**本地预演**，核对模型、阈值、消息数和附件状态。缺失的附件可以在确认前补入本体。
5. 确认准备。页面会显示上下文重建、摘要次数、用量和索引进度；任务支持暂停、继续和失败重试。
6. 原生会话写入并读回、上下文重建和索引核验都通过后，打开接续会话，发送你的第一条新消息。

同一个确认请求重复提交也不会重复创建会话；再次主动导入同一文件，则可以创建独立的新会话。首版不提供网页登录令牌，也不支持在线下载缺失的附件。

## 上下文怎样重建

### 先预演，再确认

本地预演会读取所选模型和宿主的压缩配置，固定模型路由、窗口、输出预留、工具声明和压缩策略，并标出预计首次达到阈值的位置。

预演**不调用模型，也不生成内容**。token 数不精确时会标注为估算。首次摘要尚未生成时，不预测后续压缩次数或最终窗口大小；更换模型或相关配置后，需要重新预演。

### 未到阈值保留原文，达到阈值顺序压缩

- **未达到有效阈值**：完整保留所选分支，不调用模型摘要。
- **达到有效阈值**：使用 DSH 原生计量器、选区和默认摘要，按“已有摘要 + 保留原话 + 后续原文”继续推进。
- 每次摘要只能看到当时的历史前缀，不读取后来的消息、末尾总结或未来的检索资料。
- 历史助手回答直接采用原文，历史工具操作不会重新执行。
- 成功摘要和检查点会持久保存，恢复时复用；调用结果不明确时暂停，明确重试可能重新计费。

阈值依据当前上下文压力判断，不按累计账单 token 触发。原始记录独立保存，压缩不会覆盖原文库。

重建结果称为**“按 Harness 规则重建的上下文”**。它不等同于网页端当时实际送入模型的窗口，也不宣称恢复了网页端未公开的处理流程。

## 记忆与两种对话模式

每个接续会话都有自己的检索库。检索结果会带上角色、时间和来源节点；旧记录不构成新的执行授权，也不会自动成为当前事实。

- **对话 · RAG**：默认模式，只向模型声明只读的 `memory_search` 工具。
- **工程模式**：恢复原生工程工具及其权限、审批机制。

普通聊天不会固定地逐轮预检索，而是由模型结合当前上下文决定是否调用记忆工具；页面上的手动搜索同样可用。默认最多等待检索 3 秒，返回内容最多 6,000 字符。切换模式前，请等当前回复和工具执行结束。

新消息会先保存原话，再增量建立索引。向量索引暂时不可用时，检索会明确降级为全文搜索，聊天原文仍然保留。插件也不会自动总结你的说话风格或人物设定。

## 费用与额度

本地解析、预演和向量计算都在本机完成，不调用聊天模型，也不产生 API 费用。超过阈值后的摘要，以及后续聊天，使用你在 DSH 中配置的模型服务，可能产生费用；相应的历史内容会作为必要上下文发送给该服务。

导入准备的默认每日摘要额度为 **200 万输入／20 万输出 token**，可以在页面调整。这个额度只约束本插件的导入摘要；主动聊天和会话就绪后的宿主压缩由 DSH 单独管理。

任务控制里可以暂停、取消、继续或重试。未知的模型调用结果会先暂停等待检查；明确重试可能再次计费。模型准备消耗的是本地磁盘和算力，不产生模型下载流量或向量服务 API 费用。

## 数据、缓存与移除

默认数据目录：

```text
$DSH_HOME/conversation-bridge
```

未设置 `DSH_HOME` 时为 `~/.dsh/conversation-bridge`。目录主要包含：

- `registry.sqlite`：登记信息
- `imports/`：导入原件
- `archives/`：归档
- `conversations/`：每个接续会话的原文、来源、检查点和索引
- `models/`：本地向量模型缓存
- `exports/`：导出文件

可以在 **任务与设置 → 存储位置** 配置 `dataDir` 和 `modelCache`，优先使用官方配置编辑器。更改位置不会自动搬迁已有数据；如果 DSH 无法在线重载配置，页面会提示正常重启后生效。方式 A 安装后不要移动所选插件目录；方式 B 不受影响。数据不会写进插件目录。

宿主凭据与原生会话仍由 Harness 管理。用户数据、运行缓存和本地备份不会进入 Git 或安装包；模型权重只随 Release 完整版分发，不提交 Git，也不进入源码 ZIP。

从 v0.1.0 升级时会检查模型指纹，把新旧向量隔开，并在后台重建旧向量，同时保留原文、修正和停用记录。重建期间可以使用全文检索，也不会因此重新调用聊天模型来压缩历史。

**“移除会话及记忆”** 会通过官方接口归档隐藏宿主会话，并清理插件派生的记忆、快照和任务，不自动备份。导入原件、共享附件、工作区文件和既有手动备份都会保留。这个操作不等同于物理删除宿主原生日志。

卸载插件同样保留私人数据。需要迁移或手动备份数据目录时，请先正常退出 DSH。

## 验证范围与已知限制

- 16 项合成单元测试覆盖导入、隔离和模型准备；合成历史跨越 10 个压缩点，摘要请求和触发次数都与同配置的原生引擎一致。
- 对实际解包后的安装包，用全新缓存做了离线准备测试：禁用网络后，仍能复制、校验、生成 384 维向量，并完成合成中文内容的 Top-1 召回。
- 原生 V4 持久化回读、检查点恢复、模式切换、会话检索隔离，以及向量计算后的原生图片保存，均已通过自动检查。
- 自动检查使用合成数据和模拟模型响应，没有真实模型调用，也没有重建私人历史。
- 桌面端已验证入口、文件选择、上传和分支解析；最终确认与打开会话仍需人工验收。API 自动检查不能替代完整 GUI 验收。
- DSH 自带的摘要模板偏英文工程检查点，本插件保留该模板；它可能不适合所有日常交流场景。
- 首版只支持 DeepSeek 官方网页版 JSON，其他格式预留了适配接口；不保证导入后与网页端产生相同回答。

详细记录见 [测试结果](docs/测试结果.md) 和 [验收与回滚说明](docs/验收与回滚.md)。

## 开发与构建

源码在 `plugin/`，合成测试在 `tests/`，构建安装工具在 `tools/`。

使用已安装 Harness 的运行时准备依赖、执行验收并打包：

```powershell
.\tools\Prepare.ps1 -HarnessRoot "<Harness 安装目录>"
.\tools\Build.ps1 -HarnessRoot "<Harness 安装目录>"
```

开发脚本会从 PATH 和标准安装位置定位 npm；自定义布局可以通过 `-NpmCli` 指定 `npm-cli.js` 的路径。产物写入 `dist/`，包括安装包和通用源码包。

`Prepare.ps1` 是开发者构建步骤，会从固定的原发布方地址下载模型到忽略提交的 `plugin/models/`；`Build.ps1` 会把它们纳入完整版并校验哈希。安装 Release 完整版的用户不需要执行这些脚本。

GitHub CI 只使用 Windows／Node 24 运行合成单元测试，不能替代原生集成验收。

模型出处、许可证和逐文件来源见 [模型说明](plugin/notices/model/SOURCE.json)，接口说明见 [接口与结构](docs/API.md)。

### 与已有插件的关系

[deepseek-web-import](https://github.com/wpc0323/deepseek-web-import) 已支持网页历史导入与接续，[附件增强版](https://github.com/LingSuiYA/deepseek-web-import-f) 补齐了图片和文档；[dsh-chat-import](https://github.com/Nwflower/dsh-chat-import) 则覆盖多种外部工具的会话迁移、导出和同步。

本项目侧重 DeepSeek 官方本地 JSON、明确的分支选择、按原生阈值滚动重建、独立历史检索库，以及可恢复的准备流程，不宣称是首个对话导入插件。

## 来源、致谢与许可

这个项目建立在已有开源工作的基础上。以下区分当前依赖和早期原型的使用经历，不把上游能力算作本项目原创。

### 当前使用

| 项目 | 用途 | 许可说明 |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 宿主 SDK、原生会话、计量和压缩引擎 | [MIT](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE)；运行时调用，不随插件重新分发宿主代码 |
| [Transformers.js](https://github.com/huggingface/transformers.js) | 本地向量推理，直接依赖 4.2.0 | [Apache-2.0](https://github.com/huggingface/transformers.js/blob/4.2.0/LICENSE) |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | 经 Transformers.js 使用的推理运行库 | [MIT](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) |
| [多语言 MiniLM 与原发布方 ONNX 导出](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/tree/e8f8c211226b894fcb81acc59f3b34ba3efd5f42/onnx) | 固定原发布方版本的量化模型，随完整版提供 | Apache-2.0；保留模型卡、许可文本和哈希，仅重命名 ONNX 文件供本地加载，文件内容未改动 |
| [Node.js](https://github.com/nodejs/node)／[SQLite](https://www.sqlite.org/copyright.html) | 宿主运行环境与本地存储 | Node.js 主项目为 MIT，SQLite 交付代码为公共领域；均由宿主提供 |

Transformers.js 还会引入 sharp/libvips、protobuf.js 等间接依赖，包含 Apache、MIT、BSD、ISC、LGPL 等许可。各依赖保持原有条款，不能统一改标为本项目的 MIT。版本和包级许可见 [依赖锁定清单](plugin/locks/runtime-dependencies.json)，模型版本和文件哈希见 [模型清单](plugin/locks/model.json)。

### 早期原型使用过的项目

- [wpc0323/deepseek-web-import](https://github.com/wpc0323/deepseek-web-import)：提供网页历史导入原生 DSH 会话的实现，MIT。
- [LingSuiYA/deepseek-web-import-f](https://github.com/LingSuiYA/deepseek-web-import-f)：在上游基础上补充图片、附件和导入体验，MIT。原型使用固定提交 `a2503ae95b1813e2386f34f9c9054f440ffe7833`。
- [MemTensor/MemOS](https://github.com/MemTensor/MemOS) 与 [DSH 兼容分支](https://github.com/cnlove7777777-art/dsh-memos-compat)：原型曾使用独立记忆核心，固定兼容分支提交 `0596259934ee9fb9349d411ccd6959faea93784b`。上游核心为 Apache-2.0；兼容分支说明其自身修改为 MIT，不能把整个来源统称为 MIT。
- [Xenova ONNX 转换模型](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2)：v0.1.0 使用过，转换页未单独标明许可。v0.2.0 已改用原发布方明确标注许可的 ONNX 文件，不把旧版的许可疑点带入当前内置模型。

当前通用版已移除上述原型的网页下载模块和 MemOS 依赖，但保留这段来源记录与致谢。本项目的主要工作是导入编排、顺序重建、检查点恢复、会话隔离和操作界面。

本项目自身代码使用 [MIT 许可证](LICENSE)，内置模型仍按 Apache-2.0 授权，其他第三方组件遵循各自条款。[第三方说明](plugin/THIRD_PARTY.md)、[NOTICE](NOTICE) 和 `plugin/notices/` 记录了用途、来源、历史署名，以及构建环境中可取得的许可文本；包级元数据扫描不等于所有组件的完整许可认证。项目与 DeepSeek 官方及上述作者没有隶属或背书关系。

## 文档与反馈

- [使用说明](docs/使用说明.md)
- [接口与结构](docs/API.md)
- [测试结果](docs/测试结果.md)
- [验收与回滚](docs/验收与回滚.md)

报告问题时，请提供宿主版本、错误信息和可复现步骤，尽量使用合成对话。请勿在公开反馈中上传私人聊天、API 密钥或网页登录令牌。
