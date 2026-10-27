# DSH Conversation Bridge

Import an official DeepSeek web JSON export into a native DeepSeek Harness session.

Select a conversation, branch, registered workspace and model configuration. The local preview does not generate content. Confirmation replays original messages through the shipped BasicCompactionEngine at normal request boundaries, builds an isolated local history index, verifies persistence, and opens the session.

Below the native threshold, the entire original branch is preserved without a summary call. Above it, earlier summaries participate in subsequent rolling compaction. No historical reply or tool operation is regenerated. The factory summarizer currently uses English engineering checkpoints; this plugin does not replace its template.

History is stored independently from compacted context. Only `memory_search` is declared in conversation mode; engineering mode restores native tools and approvals. Retrieval is on demand, never a fixed per-turn search. New messages are saved before incremental indexing. No persona, custom chat prompt or paid fact extraction is included.

Default data: `$DSH_HOME/conversation-bridge` (`~/.dsh/conversation-bridge` when unset). `dataDir` and `modelCache` can be configured through native plugin settings. The quantized multilingual MiniLM model downloads from a pinned revision and is SHA256-verified. Its runtime runs in a separate process. Models and user data are not bundled.

Validated on Windows, DSH 0.2.1-rc.3, session format V4. Other host versions are blocked until validated. Install the tgz with `dsh plugin --profile desktop add <package.tgz> --ignore-scripts`, then restart. Remove with `dsh plugin --profile desktop remove dsh-conversation-bridge`. Native logs and user data survive uninstall.

Removing a conversation archives its native listing and removes plugin-derived memory/tasks without creating a backup. Original uploads, attachments, workspace files and existing manual backups remain. This is not physical deletion of native logs.
