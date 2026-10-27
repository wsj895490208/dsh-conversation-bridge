# 接口与结构

统一前缀 `/api/conversation-bridge/v1`，由官方 `connection.fetch.register` 登记，沿用宿主认证、Host/Origin 校验。结果为 `{ok:true,data}` 或 `{ok:false,error:{code,message,details}}`。有状态写入串行，JSON 扫描使用独立任务队列。

|路径|方法|内容|
|---|---|---|
|`/status`|GET|会话、任务、工作区、模型来源、配置与用量|
|`/upload?kind=json/attachment&name=...`|POST|原始文件，最大200MiB，SHA256去重|
|`/scan`|POST / GET|传uploadId启动扫描；传jobId读取结果|
|`/scan/state?jobId=...`|GET|轻量解析状态，独立于索引队列|
|`/import/preview`|POST|uploadId、conversationId、leaf、referenceSessionId、workspaceId；返回previewId与冻结策略|
|`/import/confirm`|POST|previewId、requestId、可选label；幂等创建会话与准备任务|
|`/attachment`|POST|previewId、fileId、uploadId；确认前补入附件本体|
|`/job`|POST|jobId、action为pause/resume/retry/cancel；未知结果重试需用户明确操作|
|`/conversation?conversationId=...`|GET|上下文、索引健康、摘要检查点、尝试及RAG调用|
|`/interaction`|GET / POST|按sessionId读取；按conversationId和mode切换chat/engineering|
|`/search`|POST|conversationId、query，当前档案全文与向量混合检索|
|`/memories`|GET|conversationId及可选q，原文与索引健康|
|`/settings`|POST|导入准备额度与检索预算|
|`/storage`|POST|绝对dataDir及可选modelCache；空闲后保存；官方编辑器不支持重载时返回restartRequired并保存插件自己的启动设置，不搬迁原数据|
|`/conversation/remove`|POST|conversationId，归档原生记录并清理派生数据，不备份|

格式适配器登记在 `formats.mjs`，导出解析独立于宿主持久化。`BridgeService` 管理任务和绑定；`replay-host` 负责原生 Session、计量与压缩适配；`memory` 与独立向量进程只管理原文索引。原生V4头不包含插件自定义字段。

v0.2.0的`/status`新增`modelDelivery`（内置文件是否齐全、模型ID、总字节数和指纹，`downloadRequired:false`）。索引健康增加`modelMatches`及实际/期望指纹；不同指纹的向量不参与混合召回，升级后自动排队重建。模型准备仅从包内复制或复用已校验缓存，运行时不下载模型；缺失时报`model_missing`，哈希失败时报`model_integrity`。

摘要成功结果在提交原生压缩前缓存，以固定输入、源游标和策略作键。原生事件以追加方式写入、回读核验；已落盘前缀不一致时拒绝覆盖。未知供应商用量保留预留，不擅自返还。
