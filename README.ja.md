# playwright-anchor

> **一度直して、ずっと再生。CI で LLM ゼロ。**

<p align="center">
  <img src="https://raw.githubusercontent.com/mk668a/playwright-anchor/main/demo/demo.gif" alt="壊れたロケーターが red になり、llama3.2 がローカルで一度だけ修復、heal は git diff として届き、CI は LLM エンドポイントが死んでいても green で replay する" width="100%">
</p>

Playwright のロケーターが壊れたとき、`playwright-anchor` は**あなた自身のローカル LLM**(Ollama / llama.cpp / LM Studio など OpenAI 互換なら何でも)に**一度だけ**要素を探させ、durable なセレクタを決定的に導出して `.playwright-anchors.json` に書き込みます — このファイルは **lockfile のように review してコミット**します。self-healing を「CI のランタイム挙動」ではなく「git diff」にする:

```diff
--- a/.playwright-anchors.json
+++ b/.playwright-anchors.json
@@
+    "#old-buy-button": {
+      "healed": "[data-testid=\"buy-now\"]",
+      "healedAt": "2026-06-11T09:14:03.512Z",
+      "model": "llama3.2",
+      "reason": "same purchase button, renamed id",
+      "via": "ref"
+    }
```

以後はローカルでも CI でも、コミット済みキャッシュから replay されるだけ。**CI は LLM に一切触れません。** API キーも Redis もクラウドサービスも不要、実行ごとの非決定性もありません。

## なぜランタイム self-healing ではないのか

既存のアプローチはどれも CI の**中で**、実行のたびに修復をやり直します。テスト結果が非決定的になる — これは Playwright チームが [self-healing の本体搭載を拒否した理由](https://github.com/microsoft/playwright/issues/10872)そのものです(「テストが落ちたのか通ったのかをユーザーが知れることが重要」)。

`playwright-anchor` は **修復をコード変更として扱います。** 修復はあなたのマシンで、あなたのモデルで行われ、review 可能な diff としてリポジトリに入る。CI はそれを replay するだけです。

|  | playwright-anchor | ランタイム self-healing 系 | エディタの healing agent |
|---|---|---|---|
| 修復が起きるタイミング | 一度だけ・ローカル・コミット前 | 毎 run・CI の中 | エディタ内で対話的に |
| CI での LLM 呼び出し | **0** | 壊れたロケーターごと | — |
| 修復の成果物 | コミットされる review 可能な JSON diff | ランタイム挙動 | テストソースへの patch |
| 追加インフラ | なし | cache ストアや API キー等 | agent loop |

## クイックスタート

```bash
npm i -D playwright-anchor
ollama pull llama3.2        # 好きなモデルで OK
```

import を 1 行差し替え、腐りやすいロケーターに `anchor()` を使うだけ:

```ts
// before: import { test, expect } from '@playwright/test';
import { test, expect } from 'playwright-anchor';

test('checkout', async ({ page, anchor }) => {
  await page.goto('/shop');

  await anchor('#buy-button').click();          // アクションは直接呼べる
  const status = await anchor('.order-status'); // `await` すると本物の Locator
  await expect(status).toHaveText('purchased'); // web-first assertion もそのまま
});
```

セレクタが生きている間、`anchor()` は `page.locator()` と完全に同じ挙動です。壊れたとき:

1. **ローカル**(heal mode): ローカルモデルがページのアクセシビリティスナップショットを受け取り、壊れたセレクタが指していた要素を選ぶ → `playwright-anchor` が durable なセレクタを導出(test-id → id → 安定属性 → CSS path、一意性検証付き)して `.playwright-anchors.json` に保存 → テストは続行。あなたは diff を review してコミット。
2. **CI**(replay mode、`CI` env で自動): コミット済みの修復が LLM ゼロで即座に解決。cache miss は「ローカルで heal してコミットせよ」と明確に fail — 黙って通したり、非決定的になったりしません。

## モード

| Mode | いつ | 挙動 |
|---|---|---|
| `heal` | ローカルの default | 壊れたセレクタ → cache → local LLM (一度だけ) → コミットへ |
| `replay` | `CI` env があれば default | cache のみ。miss は実用的なエラー。**LLM を絶対に呼ばない。** |
| `off` | — | `anchor()` は `page.locator()` と同じ |

## 設定

```ts
test.use({
  anchorOptions: {
    mode: 'heal',                          // heal | replay | off
    cacheFile: '.playwright-anchors.json', // Playwright rootDir からの相対
    resolveTimeout: 2000,                  // この ms を超えたら「壊れた」と判定
    testIdAttribute: 'data-testid',        // 導出セレクタの第一候補属性
    llm: {
      baseURL: 'http://127.0.0.1:11434/v1', // OpenAI 互換なら何でも
      model: 'llama3.2',
      // apiKey: 自前のエンドポイントが要求する場合のみ
    },
  },
});
```

env での上書き: `PLAYWRIGHT_ANCHOR_MODE` / `PLAYWRIGHT_ANCHOR_CACHE` / `PLAYWRIGHT_ANCHOR_LLM_URL` / `PLAYWRIGHT_ANCHOR_LLM_MODEL` / `PLAYWRIGHT_ANCHOR_LLM_API_KEY`。

## 修復の仕組み(小型モデルで十分な理由)

LLM にセレクタを**書かせません**。モデルは Playwright のアクセシビリティスナップショット(`ariaSnapshot({ mode: 'ai' })`、各要素に `[ref=eN]` マーカー付き)を受け取り、**正しい要素を指差すだけ**:

```json
{"ref": "e12", "reason": "same purchase button, renamed id"}
```

コミットされるセレクタは `playwright-anchor` がブラウザ内で**決定的に**導出します(test-id 属性 → id → 安定属性 → 最小 CSS path、一意に解決することを検証してから保存)。「ラベル付きリストから 1 要素を選ぶ」だけなら 3–8B のローカルモデルで十分にこなせます。精密さが要る部分はモデルに委ねません。

## CLI

```bash
npx playwright-anchor heal     # heal mode でテスト実行 → 何が直ったか表示
npx playwright-anchor replay   # CI が何をするかをローカルで検証 (LLM ゼロ)
npx playwright-anchor list     # コミット済みの修復を一覧
npx playwright-anchor rm "#old-selector"   # 修復を 1 件削除 (次回 re-heal)
```

`heal` / `replay` の追加引数はそのまま `npx playwright test` に渡されます。

## Claude Code / コーディングエージェントとの併用

playwright-anchor は「agent が提案 → 人間が review → CI は replay」のワークフロー前提で設計されています(**dev-time 限定**)。同梱の skill をリポジトリに置けば、agent が heal step を運転して diff を渡してくれます:

```bash
cp -r node_modules/playwright-anchor/skills/playwright-anchor .claude/skills/
```

skill の内容: `npx playwright-anchor heal` をローカルモデルに対して実行 → `git diff .playwright-anchors.json` を提示 → `replay`(LLM ゼロ = CI と同一)で検証 → コミット判断は人間に委ねる。

## BYO モデル — あなたのハードウェア、あなたのキー、あなたの選択

- **メンテナ提供の API・埋め込みキー・テレメトリは一切なし。** per-token コストを払うのはあなただけ — ローカルモデルならそれもゼロ。
- **Provider-agnostic。** OpenAI chat-completions プロトコルを話すものなら何でも: Ollama / llama.cpp server / LM Studio / vLLM — あるいは自前の Anthropic/OpenAI キー (各社の OpenAI 互換エンドポイント経由)。env var 1 つで差し替え可能。
- **完全ローカル / オフライン動作可。** default 設定 (`http://127.0.0.1:11434/v1`) はマシンの外に出ません。
- **CI にモデルは不要。** replay mode は純粋な JSON lookup です。

## FAQ

**元のセレクタが復活したら?**
常に元のセレクタが優先されます。cache は元が失敗した時だけ参照されます。

**要素が本当に消えた場合は?**
heal も失敗します — `anchor()` は要素を捏造しません。false green ではなく `AnchorHealError` / `AnchorReplayError` になります。修復するのは「リネーム・移動」であって、本物のリグレッションを隠すことはありません。

**全部のロケーターを包む必要は?**
ありません。歴史的に腐りやすいセレクタ(深い CSS、生成 id)にだけ `anchor()` を使い、他は `page.getByRole()` などをそのまま使ってください。

**Claude Code / Cursor などの agent loop から使える?**
使えます — dev-time の *heal step* として。agent に `PLAYWRIGHT_ANCHOR_MODE=heal npx playwright test` を実行させ、提案された `.playwright-anchors.json` の diff を他の変更と同じように review してください。どちらの場合も CI は変わらず、コミット済みの cache を replay するだけです。

## License

MIT
