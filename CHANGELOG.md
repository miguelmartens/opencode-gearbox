# Changelog

## [0.1.1](https://github.com/miguelmartens/opencode-gearbox/compare/v0.1.0...v0.1.1) (2026-11-11)


### Bug Fixes

* **package:** make TUI peers required so npm installs them ([#10](https://github.com/miguelmartens/opencode-gearbox/issues/10)) ([8406844](https://github.com/miguelmartens/opencode-gearbox/commit/8406844c14e8e2c9a6a902941cce3a035fbe8aef))

## 0.1.0 (2026-11-11)


### Features

* **core:** context, cache and stats math ([4b3867a](https://github.com/miguelmartens/opencode-gearbox/commit/4b3867a32b231ea057bf27683fc2b4ee1677d883))
* **core:** judge prompt and parser ([c5f3983](https://github.com/miguelmartens/opencode-gearbox/commit/c5f398309eb91bb53e0e6c42324e3649cb2c8af1))
* **core:** levels, prompt rules, settings ([8602e3d](https://github.com/miguelmartens/opencode-gearbox/commit/8602e3db5a70cb1e2bfb9a203fe42321e567b6f9))
* **core:** model ladder and cache-aware cost check ([b8af8f4](https://github.com/miguelmartens/opencode-gearbox/commit/b8af8f4cebcf7a932f858f3aef0dedd1afa8fafc))
* **server:** /gearbox commands, stats, bench and budget ([01f6ad5](https://github.com/miguelmartens/opencode-gearbox/commit/01f6ad54060f597f1f37d796cac07ab0a81cc703))
* **server:** effort and model routing for chats and subagents ([2907afa](https://github.com/miguelmartens/opencode-gearbox/commit/2907afa526d00bfe5ee6afa4655a77fe48d88ae6))
* **server:** small-model compaction, handoff and context advice ([1e1b348](https://github.com/miguelmartens/opencode-gearbox/commit/1e1b348e0cd3cfbe2d4ac2fe8f1f84e81a0413e6))
* **site:** add landing page and GitHub Pages workflow ([cc8eb3d](https://github.com/miguelmartens/opencode-gearbox/commit/cc8eb3df7b6772fadfd64e4aee6fa14731e045c6))
* **tui:** color the effort level in the status bar ([0473647](https://github.com/miguelmartens/opencode-gearbox/commit/047364709f9998411db4fd3b03750c58bc79a44a))
* **tui:** gearbox status bar over RPC ([44ac2b7](https://github.com/miguelmartens/opencode-gearbox/commit/44ac2b78c347ef34c5ddd63374ebef8fde233aae))


### Bug Fixes

* **care:** trim the handoff transcript to the judge model's context ([08eec61](https://github.com/miguelmartens/opencode-gearbox/commit/08eec61abf1448a9afd6a2e4d5e4c1ee569e154f))
* **core:** never read an echoed template or a level adjective as the judge's level ([8d759bf](https://github.com/miguelmartens/opencode-gearbox/commit/8d759bf2dfc2b7ee0463169c731191718bb5962b))
* **core:** singular judge call in stats summary ([895c319](https://github.com/miguelmartens/opencode-gearbox/commit/895c319a636a99101523e933de07ea5177b173ed))
* **deps:** pin @opencode/plugin to ^2.2.7 instead of latest ([4d8e9ef](https://github.com/miguelmartens/opencode-gearbox/commit/4d8e9efa695317078f7c7b50655452a0a9611b9b))
* **notify:** keep one notification emitter per plugin instance ([5b81454](https://github.com/miguelmartens/opencode-gearbox/commit/5b81454acad891aa6ab67ac10c3cb16d87b17829))
* **routing:** bound the catalog read and status emit in the context hook ([c6ffe46](https://github.com/miguelmartens/opencode-gearbox/commit/c6ffe46300535e578679333d80b72307ae833019))
* **server:** bound judge cost estimate, keep handoff sessions, never block admission ([fc6b8c6](https://github.com/miguelmartens/opencode-gearbox/commit/fc6b8c638d226408ed4707cf135983782f890e89))
* **server:** compact with the judge model only when cheaper and it fits ([48ae0da](https://github.com/miguelmartens/opencode-gearbox/commit/48ae0da3f2c2554964f2fe7849d38862b823500f))
* **server:** evict idle sessions, read the request model from session state ([d5dc44f](https://github.com/miguelmartens/opencode-gearbox/commit/d5dc44f301dff3f8ff95433b6f267f6f490cdc3d))
* **server:** gate resumed-subagent switches on cache cost, follow root pause, decide main-chat model once per turn ([38b2603](https://github.com/miguelmartens/opencode-gearbox/commit/38b260348a20e15a449bce0c439c45cfba3e6157))
* **server:** give each request its own prompt's decision; count unrouted turns as manual ([720b1cc](https://github.com/miguelmartens/opencode-gearbox/commit/720b1cca383273fcc2f6c5504f3417c7d9d5259c))
* **server:** harden stats, settings, handoff and notifications from a repo audit ([9dd6baf](https://github.com/miguelmartens/opencode-gearbox/commit/9dd6bafa0686a2d9f0f3258fa819094781790da6))
* **server:** honest bench, judge-running debug, per-turn stats ([2f39cb0](https://github.com/miguelmartens/opencode-gearbox/commit/2f39cb015891cc6567ff1ae0326024afd6e8fc64))
* **server:** keep the longer timeout for handoff summaries ([c69f4c4](https://github.com/miguelmartens/opencode-gearbox/commit/c69f4c41ee9f9b13cb4038895eec9a0741da42c8))
* **server:** never evict a session that is in use ([31e5b85](https://github.com/miguelmartens/opencode-gearbox/commit/31e5b8530fa09f98b5ef756a9a973f105858bdd3))
* **server:** one status builder, judge cost ledger and plugin lifecycle ([ea45e9e](https://github.com/miguelmartens/opencode-gearbox/commit/ea45e9e84b60c3f55630bc21f8232ec746148860))
* **server:** pass a /gearbox compact note to OpenCode's compaction when the judge does not summarize ([f47fe76](https://github.com/miguelmartens/opencode-gearbox/commit/f47fe76f82caa7cf997e834868265ff44fca79f3))
* **server:** pass the compact note as a SystemPart ([0b39323](https://github.com/miguelmartens/opencode-gearbox/commit/0b39323230d341e35a444ceb97ed7922eb5646b4))
* **server:** prune spend after the budget toast and never fail on it; no stats for deleted sessions; reset the request level first ([aea8cca](https://github.com/miguelmartens/opencode-gearbox/commit/aea8ccabfe083f5d4a9edc124efb591291637807))
* **server:** remove deleted sessions' stats and spend older than 30 days ([e45c0fa](https://github.com/miguelmartens/opencode-gearbox/commit/e45c0fa4aa78abe357a1cb93ea0d1dcc10d0fb72))
* **server:** route model-less subagents, keep root pauses across reloads, bound the subagent prompt hook ([44ebb09](https://github.com/miguelmartens/opencode-gearbox/commit/44ebb095260ad76bdec558d872f4bcabebe71d25))
* **settings:** reject a judge.model that is not provider/model[#variant] ([e4ca169](https://github.com/miguelmartens/opencode-gearbox/commit/e4ca1696aae2808d1d920b40451d0a5a45b85c01))
* **settings:** serialize settings updates so concurrent changes are kept ([d927bb4](https://github.com/miguelmartens/opencode-gearbox/commit/d927bb4ed18d61511d1752d9fbaa6f8b6f7762bd))
* **stats:** count a step under the turn and level it started with ([0ef795b](https://github.com/miguelmartens/opencode-gearbox/commit/0ef795b24e5762000241a9ed912121e0fdff23ae))
* **status:** show the effort variant actually sent ([79b120f](https://github.com/miguelmartens/opencode-gearbox/commit/79b120f7c7338e389144fffb6e292af775ad2c15))
* **tui:** back off failed status fetches and keep dialogs to the current session ([36d8c84](https://github.com/miguelmartens/opencode-gearbox/commit/36d8c84aff34dbfb25258609c9d0f66f2b4a6fd8))
