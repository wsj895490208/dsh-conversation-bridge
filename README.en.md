# DSH Conversation Bridge

[中文](README.md) · English

Import an official DeepSeek web JSON export into DeepSeek Harness, reconstruct
context with the native compaction engine, build an isolated local history index,
and continue from the end of the branch you select.

**JSON → select branch/model → local preview → confirm preparation → continue**

> v0.1.0 is experimental. Validated on Windows, Harness 0.2.1-rc.3, V4 sessions.
> Other host versions are blocked pending validation. No npm package is published.

## Why this exists

The project began as an attempt to move the “soul” of a long, meaningful DeepSeek
web conversation to a local client. That original goal failed for me: preserving
history, reconstructing context and adding retrieval did not reliably preserve
the same feeling of familiarity. The reusable engineering work became this
generic plugin.

It migrates records and enables continuation; it does not promise personality,
emotional continuity or restoration of undisclosed web-service state. Better
fidelity may require an official context/session-state export and restore
contract. There is no evidence that missing KV cache is the cause: KV caching
normally reuses computation over previous tokens, rather than acting as an
independent personality archive. See [cache mechanics](https://huggingface.co/docs/transformers/cache_explanation)
and [DeepSeek's cache documentation](https://api-docs.deepseek.com/guides/kv_cache/).

## Features

- **Import:** DeepSeek official JSON, explicit parent-chain branch selection,
  original roles, text, timestamps, source nodes and attachment metadata.
- **Native rolling compaction:** preview without generation; replay original
  messages in order and compact only at the effective native threshold. A summary
  can see only its current prefix. Historical replies and tool operations are
  never regenerated or executed.
- **Independent memory:** a raw archive plus per-session full-text and local
  multilingual MiniLM vectors. New messages persist before incremental indexing.
- **Continuation:** native session write/read verification, resumable preparation
  jobs and successful-summary checkpoints, then open the native conversation.

Context leads; retrieval supplements it. Conversation mode declares only the
read-only `memory_search` tool, used on demand, with no fixed per-turn retrieval.
Engineering mode restores native tools and approvals. No custom chat persona,
style examples, extra chat system prompt or paid fact extraction is added.

## Install and use

Download the tgz from the [v0.1.0 experimental release](https://github.com/wsj895490208/dsh-conversation-bridge/releases/tag/v0.1.0),
fully quit Harness, and run from the download directory:

```powershell
dsh plugin --profile desktop add .\dsh-conversation-bridge-0.1.0.tgz --ignore-scripts
```

Use the bundled CLI if `dsh` is not on PATH. The repository root is not an
installable bundle: plugin sources live in `plugin/`; install the built tgz.

1. Restart Harness and choose **导入网页对话** in the sidebar.
2. Upload the official JSON, select a conversation/leaf, and verify the final messages.
3. Select a registered workspace and an already opened, model-configured native
   session as the settings source. A blank configured session is sufficient;
   there is no need to send a paid test message first.
4. Run local preview, check the model/threshold/attachments, and optionally supply missing attachment bodies.
5. Confirm preparation. The first local embedding model download is pinned and hash-verified.
6. After reconstruction, persistence and indexing pass verification, send your first new message.

Below the native threshold, all original branch messages remain and no summary
call is made. Above it, native summaries incur provider usage. The default import
summary budget is 2,000,000 input / 200,000 output tokens per day, configurable
separately from active chat. Unclear call outcomes pause; explicit retries may
incur another charge. Summary/chat context is sent to the provider you configure.

No web login token or online attachment downloader is included.

## Data and removal

Default data: `$DSH_HOME/conversation-bridge`, or `~/.dsh/conversation-bridge`
when unset. Configure `dataDir`/`modelCache` in the plugin's task/settings page.
Changing the location does not move old data; the page reports when restart is
required. Host credentials and native sessions remain managed by Harness.

Removing a conversation archives its native listing and cleans plugin-derived
memory/tasks without making a backup. Original uploads, shared attachments,
workspace files, existing backups and native logs remain. This is not physical
erasure of host logs. Uninstalling the plugin preserves user data.

## Validation and limits

- Ten synthetic unit tests; a ten-compaction native replay matches stock-engine
  summary requests. Native persistence, restart/cache reuse, tool modes and
  local embedding/image coexistence have offline integration checks.
- No real paid model calls or private-history reconstruction are run by these checks.
- Desktop entry/upload/branch scanning were checked; final confirmation/open
  still needs manual acceptance. API tests do not replace GUI acceptance.
- The unchanged factory summarizer currently favors English engineering
  checkpoints. Reconstructed context is not a reproduction of the web service's
  hidden window. Model weights are not distributed.

See [test results](docs/测试结果.md), [usage](docs/使用说明.md) and
[validation/rollback](docs/验收与回滚.md). The Windows/Node 24 CI runs synthetic
unit tests only; native integration checks need the supported installed Harness.

## Build

```powershell
.\tools\Prepare.ps1 -HarnessRoot "<Harness installation directory>"
.\tools\Build.ps1 -HarnessRoot "<Harness installation directory>"
```

The scripts use the selected Harness runtime, locate npm from PATH/standard
installations, and accept `-NpmCli` for a custom `npm-cli.js`. Build artifacts go
to `dist/`. No host patching is required. See the [API reference](docs/API.md).

## Credits and licensing

Project code is [MIT](LICENSE). Native compaction is DeepSeek Harness's work;
embedding runs on Transformers.js/ONNX Runtime and a pretrained multilingual
MiniLM model. Dependencies retain their original licenses, including Apache,
MIT, BSD and LGPL components.

The historical prototype used [deepseek-web-import](https://github.com/wpc0323/deepseek-web-import),
[its attachment-enhanced fork](https://github.com/LingSuiYA/deepseek-web-import-f),
[MemOS](https://github.com/MemTensor/MemOS) and
[the DSH compatibility fork](https://github.com/cnlove7777777-art/dsh-memos-compat).
Those implementations are not runtime dependencies or bundled vendor code.

The base MiniLM model declares Apache-2.0; the pinned Xenova conversion has no
separate explicit license metadata. We document that gap and do not distribute
weights or claim to grant rights over them. Consult the publishers before
mirroring them. Full provenance, qualifications and preserved texts are in
[THIRD_PARTY.md](plugin/THIRD_PARTY.md), [NOTICE](NOTICE) and `plugin/notices/`.

This is an independent community project without official endorsement. Report
issues with host version and synthetic reproductions; never post private chats,
API keys or login tokens.
