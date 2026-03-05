# GenU 環境
## 販促関連
[GenUセールス](https://github.com/birdworks-inc/genu-sales)

## 関連リポジトリの全体構成

```
upstream/main（本家）
    ↓ fetch & merge
generative-ai-base/
    ├── main          ← 本家ベース
    ├── custom/demo   ← デモ環境
    └── custom/self   ← 自社環境
    ↓ テンプレートとして使用
generative-ai-clientA/
generative-ai-clientB/
generative-ai-clientC/
```

---

## セットアップ手順

**baseリポジトリの準備：**
```bash
# 今のリポジトリをbaseとして整理
git checkout main
git checkout -b custom/demo   # デモ用ブランチ
git checkout -b custom/self   # 自社用ブランチ
```

**クライアントリポジトリの作成：**
```bash
# baseをテンプレートとしてA社リポジトリを作成
git clone generative-ai-base generative-ai-clientA
cd generative-ai-clientA

# baseをリモートとして登録
git remote rename origin base
git remote add origin https://github.com/自社/generative-ai-clientA.git

# A社用ブランチを作成
git checkout -b custom/clientA
git push -u origin custom/clientA
```

---

## 日常運用フロー

**①本家の更新をbaseに取り込む：**
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

**②baseの更新を各クライアントに反映：**
```bash
cd generative-ai-clientA
git fetch base
git checkout custom/clientA
git rebase base/main  # 必要な共通改善だけ取り込む
```

---

## ポイント

| 管理対象 | リポジトリ | ブランチ |
|---|---|---|
| 本家追跡・共通改善 | generative-ai-base | main |
| デモ環境 | generative-ai-base | custom/demo |
| 自社環境 | generative-ai-base | custom/self |
| A社 | generative-ai-clientA | custom/clientA |
| B社 | generative-ai-clientB | custom/clientB |

---
