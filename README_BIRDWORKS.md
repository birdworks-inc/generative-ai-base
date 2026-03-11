# GenU 環境
## 販促関連
[GenUセールス](https://github.com/birdworks-inc/genu-sales)

---

## 関連リポジトリの全体構成

```
upstream/main（本家）
    ↓ fetch & merge
generative-ai-base/
    ├── main          ← 本家ベース（カスタマイズ最小限）
    ├── custom/demo   ← デモ環境
    └── custom/self   ← 自社環境

generative-ai-addon-{name}/        ← アドオンごとに独立リポジトリ（main運用）
    generative-ai-addon-labeler/   ← AIラベル付与アドオン
        packages/
            web/    ← Reactコンポーネント（@birdworks/genu-addon-labeler-web）
            cdk/    ← CDK構成（@birdworks/genu-addon-labeler-cdk）
            lambda/ ← Lambda処理（@birdworks/genu-addon-labeler-lambda）

generative-ai-clientA/        ← テンプレートから作成
generative-ai-clientB/
generative-ai-clientC/
```

---

## 設計原則

### 1. GenU本体に手を入れない
本家更新への随時追従を維持するため、`generative-ai-base` 内の既存ファイル変更を最小限に抑える。

- **NG**: GenUの既存ファイル（`App.tsx`等）を直接編集してアドオン機能を追加する
- **OK**: 新規ファイルの追加、および拡張ポイント（後述）への最小限の追記

### 2. アドオンは別リポジトリで分離
- アドオンのコードは `generative-ai-addon-{name}/` として独立管理
- 各クライアントはアドオンの「オン・オフ」のみ設定する（コードカスタマイズなし）
- アドオンの更新がGenU本体・他クライアントに波及しない

### 3. クライアントリポジトリの変更頻度を最小化
| リポジトリ | 変更頻度 | 変更理由 |
|---|---|---|
| upstream/main | 高（本家依存） | 参照のみ |
| generative-ai-base | 中 | upstream merge + 拡張ポイント整備 |
| generative-ai-addon-{name} | 中 | 機能追加・改善 |
| generative-ai-clientX | **低** | アドオンのオン・オフ、設定値のみ |

---

## アドオン拡張ポイント（GenU本体への最小変更）

アドオンをプラグイン形式で追加するため、`generative-ai-base` に以下を追加する。  
**既存ファイルへの変更はApp.tsxの2箇所のみ。**

```
packages/web/src/addons/
    registry.ts   ← アドオン定義インターフェース（新規追加）
    index.ts      ← 空ファイル（各クライアントがオーバーライド）
```

```typescript
// packages/web/src/addons/registry.ts
export interface AddonDefinition {
  id: string
  label: string                              // サイドバーのメニュー名
  icon: JSX.Element | null                   // nullの場合はデフォルトアイコンにフォールバック
  path: string                               // /addons/{name}
  component: React.LazyExoticComponent<any>
}
export const addonRegistry: AddonDefinition[] = []
```

```typescript
// packages/web/src/App.tsx への追加（2箇所のみ）
// 1. サイドバーで addonRegistry をループしてメニュー追加
// 2. ルーターで addonRegistry をループしてRoute追加
```

各クライアントリポジトリでは以下のファイルのみ追加する：

```typescript
// packages/web/src/addons/index.ts（クライアントリポジトリ側）
import { addonRegistry } from './registry'
import { LabelerAddon } from '@birdworks/genu-addon-labeler-web'

addonRegistry.push(LabelerAddon)   // オン
// addonRegistry.push(XxxAddon)    // オフ（コメントアウト）
```

---

## アドオンのCDK統合（Authorizer共有設計）

### 背景
アドオンのAPIエンドポイントをGenU既存のAPI Gatewayに追加する際、認証（Authorizer）をどう扱うかを検討した。

**採用した方針：GenU側のAuthorizerを共有する**

```typescript
// packages/cdk/lib/construct/api.ts（GenU本体）に追加
export class Api extends Construct {
  readonly api: RestApi;
  readonly authorizer: CognitoUserPoolsAuthorizer;  // ← エクスポート追加
  ...
}

// packages/cdk/lib/generative-ai-use-cases-stack.ts に追加
export class GenerativeAiUseCasesStack extends Stack {
  public readonly backendApi: Api;  // ← エクスポート追加
  ...
}

// packages/cdk/lib/create-stacks.ts でアドオンスタックに渡す
new LabelerStack(app, 'LabelerStack', {
  restApi: generativeAiUseCasesStack.backendApi.api,
  authorizer: generativeAiUseCasesStack.backendApi.authorizer,  // ← 共有
  bedrockRegion: updatedParams.modelRegion,
});
```

### なぜ共有するのか
アドオンが独自にAuthorizerを作成する方法（`userPool`を受け取って自前で作る）も可能だが、アドオンが増えるたびにAuthorizerが増えていく。同じUserPoolを参照する冗長なリソースが累積するため、GenU側のAuthorizerを共有する設計を採用した。

| 方式 | GenU本体への変更 | アドオン増加時 |
|---|---|---|
| 独自Authorizer作成 | なし | アドオン数分だけ増加 |
| **GenU側を共有（採用）** | `api.ts` に1行追加 | 常に1つ |

### GenU本体への変更箇所（2ファイル・最小限）
- `packages/cdk/lib/construct/api.ts`：`readonly authorizer` をエクスポート・`this.authorizer = authorizer` を追加
- `packages/cdk/lib/generative-ai-use-cases-stack.ts`：`public readonly backendApi: Api` をエクスポート・`this.backendApi = api` を追加

---

## アドオンのnpm workspaces統合

アドオンのCDK・LambdaパッケージはGenUベースの `node_modules` を共有するため、`generative-ai-base/package.json` のworkspacesに追加する。

```json
// generative-ai-base/package.json
{
  "workspaces": [
    "packages/*",
    "../generative-ai-addon-labeler/packages/cdk",
    "../generative-ai-addon-labeler/packages/lambda"
  ]
}
```

これにより `aws-cdk-lib` 等の依存関係がbase側の `node_modules` に統一され、バンドルエラーが解消される。

**新しいアドオンを追加する際は同様にworkspacesへの追記が必要。**

---

## アドオン一覧

| アドオン名 | リポジトリ | 状態 | 概要 |
|---|---|---|---|
| AIラベル付与 | generative-ai-addon-labeler | ✅ 完了 | CSVデータをマスタ定義に基づきAIが自動ラベル付与（S3 Vectors + Bedrock） |

> アドオンが追加されたらここに追記する

---

## アドオン開発環境

### 基本方針
一人開発・AWS環境は custom/self を流用する前提のため、複雑な仕組みは不要。  
**addon-dev/{name} ブランチで開発し、動作確認時だけ custom/self にマージする。**

```
generative-ai-base/
  ├── main
  ├── custom/demo
  ├── custom/self          ← AWS環境（デプロイ先）
  └── addon-dev/labeler    ← 開発作業はここ（custom/selfから派生）
```

### 開発サイクル
```bash
# 1. 開発開始
git checkout custom/self
git checkout -b addon-dev/labeler

# 2. コードを書く（アドオンリポジトリ側）
# generative-ai-addon-labeler/packages/web/    ← Reactコンポーネント
# generative-ai-addon-labeler/packages/cdk/    ← CDK構成
# generative-ai-addon-labeler/packages/lambda/ ← Lambda処理

# 3. AWSで動作確認したいとき
git checkout custom/self
git merge addon-dev/labeler
npx cdk deploy --profile sandbox

# 4. 確認後、開発ブランチに戻る
git checkout addon-dev/labeler

# 5. 完成後、addonリポジトリにコミット・プッシュ
cd generative-ai-addon-labeler
git push origin main
```

### addonリポジトリへの切り出しタイミング
焦って切り出す必要はない。以下のいずれかになったタイミングで切り出す。

- 2社目のクライアントに適用したくなった　← **これが現実的なトリガー**
- 機能として完成・安定した
- 他のメンバーに渡す必要が出てきた

> 1社目は custom/self のコードをそのままデプロイしても問題ない。

---

## セットアップ手順

### baseリポジトリの準備
```bash
git checkout main
git checkout -b custom/demo   # デモ用ブランチ
git checkout -b custom/self   # 自社用ブランチ
```

### クライアントリポジトリの作成
```bash
# baseをテンプレートとしてA社リポジトリを作成
git clone generative-ai-base generative-ai-clientA
cd generative-ai-clientA

# baseをリモートとして登録
git remote rename origin base
git remote add origin https://github.com/birdworks-inc/generative-ai-clientA.git

# A社用ブランチを作成
git checkout -b custom/clientA
git push -u origin custom/clientA
```

### アドオンの追加（クライアントリポジトリ内）

#### 1. package.json のworkspacesにアドオンを追加
```json
{
  "workspaces": [
    "packages/*",
    "../generative-ai-addon-labeler/packages/cdk",
    "../generative-ai-addon-labeler/packages/lambda"
  ]
}
```

#### 2. Webパッケージの依存に追加
```json
// packages/web/package.json
{
  "dependencies": {
    "@birdworks/genu-addon-labeler-web": "file:../../../generative-ai-addon-labeler/packages/web"
  }
}
```

#### 3. アドオンを登録
```typescript
// packages/web/src/addons/index.ts
import { addonRegistry } from './registry'
import { LabelerAddon } from '@birdworks/genu-addon-labeler-web'
addonRegistry.push(LabelerAddon)
```

#### 4. CDKスタックに追加
```typescript
// packages/cdk/lib/create-stacks.ts
import { LabelerStack } from '../../../../generative-ai-addon-labeler/packages/cdk/lib';

new LabelerStack(app, `LabelerStack${updatedParams.env}`, {
  restApi: generativeAiUseCasesStack.backendApi.api,
  authorizer: generativeAiUseCasesStack.backendApi.authorizer,
  bedrockRegion: updatedParams.modelRegion,
});
```

#### 5. npm install
```bash
npm install
```

---

## 日常運用フロー

### ① 本家の更新をbaseに取り込む
```bash
cd generative-ai-base
git fetch upstream
git checkout main
git merge upstream/main

# demo・selfブランチにも反映
git checkout custom/demo
git rebase main
git checkout custom/self
git rebase main
```

### ② baseの更新を各クライアントに反映
```bash
cd generative-ai-clientA
git fetch base
git checkout custom/clientA
git rebase base/main  # 必要な共通改善だけ取り込む
```

### ③ アドオンの更新を各クライアントに反映
```bash
# アドオンリポジトリで更新・バージョンタグ付け
cd generative-ai-addon-labeler
git tag v1.x.x && git push origin v1.x.x

# 各クライアントでアドオン更新 → デプロイ
cd generative-ai-clientA
npx cdk deploy --profile sandbox
```

---

## クライアント一覧

| クライアント | リポジトリ | ブランチ | 有効アドオン |
|---|---|---|---|
| デモ環境 | generative-ai-base | custom/demo | - |
| 自社環境 | generative-ai-base | custom/self | AIラベル付与 |
| A社 | generative-ai-clientA | custom/clientA | - |
| B社 | generative-ai-clientB | custom/clientB | - |

> クライアントが追加されたらここに追記する

---

## 未決定事項（規模が見えたら判断する）

- [x] アドオンの参照方式：`file:` 参照（npm workspaces）で運用中
- [ ] npm private registry の要否（GitHub Packages等）：2社目以降で検討
- [ ] CI/CDによる全クライアント一括デプロイの自動化
- [ ] アドオンが増えた場合のモノレポ統合（`generative-ai-addons/`）の要否