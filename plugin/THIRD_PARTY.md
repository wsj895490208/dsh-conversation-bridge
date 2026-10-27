# Third-party components and provenance

The project's MIT license applies to its own code. Third-party software and
models retain their own copyright and license terms. No model weights, host
SDK implementation, dependency binaries, or historical vendor trees are bundled.

## Current components

| Component | Relationship | License / authoritative source |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Host SDK, native sessions, token measurement and the unchanged BasicCompactionEngine summarizer; validated against 0.2.1-rc.3 / V4 | [MIT](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE) |
| [Transformers.js](https://github.com/huggingface/transformers.js) 4.2.0 | Direct embedding runtime dependency | [Apache-2.0](https://github.com/huggingface/transformers.js/blob/4.2.0/LICENSE) |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | Transitive inference dependency | [MIT](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) |
| [sharp](https://github.com/lovell/sharp), libvips and associated prebuilt components | Transitive image-processing dependencies of Transformers.js; not vendored | Package-specific Apache-2.0 / LGPL / other notices; preserve their distributed notices if redistributing these binaries |
| [protobuf.js](https://github.com/protobufjs/protobuf.js) | Transitive dependency | [BSD-3-Clause](https://github.com/protobufjs/protobuf.js/blob/master/LICENSE) |
| [Node.js](https://github.com/nodejs/node) and [SQLite](https://www.sqlite.org/copyright.html) | Host-provided runtime and local storage | Node.js core MIT, with its own third-party notices; SQLite deliverable code is public domain |

`locks/runtime-dependencies.json` records 74 lockfile entries, including optional
platform packages, with versions, package-declared licenses and integrity values.
These entries are not 74 separately vendored projects. Additional dependencies
carry MIT, BSD, ISC, 0BSD, Apache-2.0, LGPL and other expressions recorded there.

`notices/dependencies/` preserves the license/notice files available from the
installed dependency packages used for the release build. Its index records
which texts were supplied or absent; it is not a claim to relicense dependencies
or an exhaustive license certification for every optional platform binary.
Dependencies install separately through the package manager. Preserve their
original license and notice files, especially when making a bundled installer.

## Embedding model: explicit qualification

- Base model: [sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2), whose model card declares Apache-2.0.
- Converted model used by the plugin: [Xenova/paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2), revision `2c4055b12046f11709e9df2c122e59ffbdc2f900`.
- The pinned conversion card does not separately declare a license. The base model's declaration is not represented here as a separate, verified permission statement for every converted file.
- Model files are downloaded from the publisher and SHA-256-verified against `locks/model.json`; they are **not** included in this repository or release assets. This project grants no additional rights over them. Check the publishers' terms before mirroring or redistributing weights.

## Historical prototype and acknowledgements

The earlier private prototype used the following projects. Their modules were
removed when extracting this generic plugin; they are not runtime dependencies:

- [wpc0323/deepseek-web-import](https://github.com/wpc0323/deepseek-web-import): native Harness import work, MIT, Copyright (c) 2026 wpc0323.
- [LingSuiYA/deepseek-web-import-f](https://github.com/LingSuiYA/deepseek-web-import-f), commit `a2503ae95b1813e2386f34f9c9054f440ffe7833`: attachment enhancement of the project above, MIT, Modifications Copyright (c) 2026 LingSuiYA. Their original LICENSE and NOTICE are preserved in `notices/historical-web-import/` as provenance, without redistributing their implementation.
- [MemTensor/MemOS](https://github.com/MemTensor/MemOS) and [cnlove7777777-art/dsh-memos-compat](https://github.com/cnlove7777777-art/dsh-memos-compat), compatibility commit `0596259934ee9fb9349d411ccd6959faea93784b`: the earlier memory core. MemOS upstream is Apache-2.0; the fork's README describes its own modifications as MIT. The fork's package metadata alone must not be used to label the entire upstream core MIT. No MemOS engine or adapter is shipped here.

The generic plugin contributes migration orchestration, sequential context
reconstruction, checkpoints, per-session isolation and user-facing controls.
Native compaction and pretrained embeddings remain the work of their respective
authors. No upstream affiliation or endorsement is implied.
