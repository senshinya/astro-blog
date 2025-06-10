---
title: VitePressで動的なつぶやき機能を実装する
tags: ["試行錯誤","VitePress","メモ","CloudFlare"]
lang: ja
published: 2025-01-29T21:58:00+08:00
abbrlink: fiddling/vitepress-memos-component
description: "動的なブログを構築する際、つぶやき機能を追加するとユーザー体験が大幅に向上します。静的ブログの煩雑な手順に比べ、この機能はユーザーがいつでもどこでも短い思考を共有でき、投稿の心理的負担を軽減します。CloudFlare Workersを利用してバックエンドロジックを実装し、KVストレージと組み合わせることで、開発者はつぶやき内容を簡単に管理可能です。フロントエンドはVitePressフレームワークとVueコンポーネントの埋め込みにより、これらの動的情報を素早く表示し、ブログに生き生きとしたインタラクティブ性を加えます。"
---
### はじめに

多くの動的ブログには「つぶやき」機能があります。これは本質的に特殊なブログ記事であり、動的ブログのリアルタイム性を活かして、書いたらすぐに発信できる仕組みです。

静的ブログはローカルやサーバー上で HTML に静的コンパイルしてからデプロイするため、リアルタイム性に欠けます。長文の記事を書くのはパソコンの前で行い、git でプッシュしてデプロイするのはそれほど面倒ではありませんが、つぶやきを投稿するためにわざわざパソコンを開くのは心理的負担が大きいです。スマホで git 操作するのも煩雑で優雅とは言えず、結局「まあいいや」となりがちです。

そこで、つぶやきシステムのフロントエンドとバックエンドを一式実装しました。結果として本ブログの [碎碎念](/ja/memos) がそれです。バックエンドは CloudFlare Workers で実装し、ストレージは親切な KV に近接保存。管理ページも簡単に作りました。ブログフレームワークは VitePress で、フロントエンドは Vue コンポーネントとして作成し、ページに直接埋め込んでつぶやきページとしています。

フロントエンドの見た目は割愛し、バックエンド管理ページの様子はこちらです。
![Memo 管理ページ](https://blog-img.shinya.click/2025/8551751fe98e55c4159d28b9ff5b9473.png)

### バックエンド CloudFlare Workers + KV

#### 基本概要

バックエンドは以下の機能を含みます：
- つぶやきの追加・削除・編集（基本機能）
- ページおよび全ての書き込み API に認証を設け、安全性を確保
- Markdown 形式のリアルタイムプレビュー（marked 使用）

KV には `index` キーを保存し、値は UID の配列で全つぶやきのインデックスとなります。その他のつぶやきは UID をキーにしたエントリに保存し、値の形式は以下の通りです。

```js
{
    "uid":"ユニーク ID",
    "createTime":"投稿日時",
    "content":"つぶやき内容",
}
```

#### 実装

まず CloudFlare の KV スペースを作成し、つぶやき関連の KV ペアを保存します。場所は「アカウントホーム - ストレージとデータベース - KV」で作成。名前は重要ではなく、覚えやすければ良いです。ここでは簡単に `memos` と命名しました。

次に CloudFlare Workers を作成し、ロジック処理を担当させます。場所は「アカウントホーム - 計算（Workers）- Workers と Pages」で作成。名前も重要ではなく、ここでは `memos-api` としました。作成後、Workers 名をクリックして詳細画面へ。設定の「バインド」からバインドを追加し、「KV 名前空間」を選択。変数名は `KV`、KV 名前空間は先ほど作成した `memos` を選びます。これでコード内で`env.KV` を使って `memos`KV 空間を操作可能になります。最後に画面右上の「コード編集」ボタンを押します。

以下、コードの説明です。

まず `index.html` を作成し、管理ページの HTML・CSS・JS を格納します。

```html
<!DOCTYPE html>
<html>

<head>
    <title>Memos 管理</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        :root {
            --primary-color: #2c3e50;
            --secondary-color: #34495e;
            --accent-color: #3498db;
            --background-color: #f5f6fa;
            --text-color: #2c3e50;
            --border-color: #dcdde1;
            --hover-color: #f1f2f6;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background-color: var(--background-color);
            color: var(--text-color);
            line-height: 1.6;
        }

        #auth-panel {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255, 255, 255, 0.95);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
            backdrop-filter: blur(5px);
        }

        #auth-form {
            background: white;
            padding: 2rem;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            width: 300px;
        }

        #auth-form input {
            width: 100%;
            padding: 0.8rem;
            margin-bottom: 1rem;
            border: 1px solid var(--border-color);
            border-radius: 5px;
            font-size: 1rem;
        }

        .container {
            max-width: 1400px;
            margin: 2rem auto;
            padding: 0 1rem;
            display: flex;
            gap: 2rem;
            height: calc(100vh - 4rem);
        }

        .memo-list {
            width: 350px;
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            display: flex;
            flex-direction: column;
        }

        .memo-list-header {
            padding: 1rem;
            border-bottom: 1px solid var(--border-color);
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .memo-items {
            flex: 1;
            overflow-y: auto;
            padding: 0.5rem;
        }

        .memo-item {
            padding: 1rem;
            border-radius: 8px;
            margin-bottom: 0.5rem;
            cursor: pointer;
            transition: all 0.2s ease;
            border: 1px solid var(--border-color);
            height: auto;
            /* 固定高さを削除 */
            overflow: hidden;
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }

        .memo-item:hover {
            background-color: var(--hover-color);
            transform: translateY(-2px);
        }

        .memo-item.active {
            border-color: var(--accent-color);
            background-color: var(--hover-color);
        }

        .memo-detail {
            flex: 1;
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            display: flex;
            flex-direction: column;
        }

        .memo-detail-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .memo-item-header {
            display: flex;
            justify-content: space-between;
            font-size: 0.8rem;
            color: #666;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 0.5rem;
        }

        .memo-item-content {
            font-size: 0.9rem;
            line-height: 1.4;
            max-height: 4.2em;
            /* 3 行分のテキストを表示 */
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
        }

        .memo-uid {
            font-family: monospace;
            color: var(--accent-color);
        }

        .memo-info {
            font-size: 0.9rem;
            color: #666;
            margin-left: 10px;
            margin-top: 10px;
        }

        .memo-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            padding: 1rem;
            gap: 1rem;
        }

        .memo-edit {
            flex: 1;
        }

        .memo-edit textarea {
            width: 100%;
            height: 100%;
            border: 1px solid var(--border-color);
            border-radius: 5px;
            padding: 1rem;
            font-size: 1rem;
            resize: vertical;
            font-family: inherit;
        }

        .memo-preview {
            flex: 1;
            padding: 1rem;
            border: 1px solid var(--border-color);
            border-radius: 5px;
            overflow-y: auto;
            overflow-x: hidden;
            background-color: var(--background-color);
        }

        .memo-preview img {
            max-width: 100%;
            max-height: 150px;
            object-fit: contain;
            display: block;
            /* 画像下の隙間を防止 */
            margin: 5px 0;
        }

        .memo-preview blockquote {
            border-left: 2px solid #e2e2e3;
            padding-left: 16px;
            color: rgba(60, 60, 67, .78);
        }

        .memo-actions {
            padding: 1rem;
            border-top: 1px solid var(--border-color);
            display: flex;
            justify-content: flex-end;
            gap: 1rem;
        }

        .pagination {
            padding: 1rem;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 1rem;
            border-top: 1px solid var(--border-color);
        }

        button {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            transition: all 0.2s ease;
            font-size: 0.9rem;
            background-color: var(--primary-color);
            color: white;
        }

        button:hover {
            opacity: 0.9;
        }

        button.secondary {
            background-color: var(--secondary-color);
        }

        button.danger {
            background-color: #e74c3c;
        }

        .create-btn {
            padding: 0.5rem 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-right: 10px;
            margin-top: 10px;
        }

        /* レスポンシブデザイン */
        @media (max-width: 768px) {
            .container {
                flex-direction: column;
                height: auto;
            }

            .memo-list {
                width: 100%;
                height: 300px;
            }

            .memo-detail {
                height: calc(100vh - 400px);
            }

            .memo-preview img {
                max-height: 100px;
            }
        }

        /* Markdown プレビュー用スタイル */
        .memo-preview h1,
        .memo-preview h2,
        .memo-preview h3 {
            margin-top: 1rem;
            margin-bottom: 0.5rem;
        }

        .memo-preview p {
            margin-bottom: 1rem;
        }

        .memo-preview code {
            background-color: #f8f9fa;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
            font-family: monospace;
        }

        .memo-preview pre {
            background-color: #f8f9fa;
            padding: 1rem;
            border-radius: 5px;
            overflow-x: auto;
        }

        /* ローディングスピナー */
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2px solid rgba(0, 0, 0, 0.1);
            border-radius: 50%;
            border-top-color: var(--accent-color);
            animation: spin 1s ease-in-out infinite;
        }

        @keyframes spin {
            to {
                transform: rotate(360deg);
            }
        }
    </style>
</head>

<body>
    <div id="auth-panel">
        <form id="auth-form">
            <h2 style="margin-bottom: 1rem;">Memos 管理</h2>
            <input type="password" id="password" placeholder="パスワードを入力" required>
            <button type="submit" style="width: 100%">ログイン</button>
        </form>
    </div>

    <div class="container">
        <div class="memo-list">
            <div class="memo-list-header">
                <span>公開済み</span>
                <span id="memo-count"></span>
            </div>
            <div class="memo-items" id="memo-items"></div>
            <div class="pagination">
                <button onclick="prevPage()" class="secondary">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <span id="page-info"></span>
                <button onclick="nextPage()" class="secondary">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        </div>

        <div class="memo-detail">
            <div class="memo-detail-header">
                <div class="memo-info" id="memo-info">新規 Memo</div>
                <button class="create-btn" onclick="createMemo()">
                    <i class="fas fa-plus"></i> 新規 Memo を投稿
                </button>
            </div>
            <div class="memo-content">
                <div class="memo-edit">
                    <textarea id="memo-content" placeholder="ここにメモを書いてください..."></textarea>
                </div>
                <div class="memo-preview" id="memo-preview"></div>
            </div>
            <div class="memo-actions">
                <button onclick="saveMemo()" id="save-btn">
                    <i class="fas fa-save"></i> 保存
                </button>
                <button onclick="deleteMemo()" class="danger" id="delete-btn">
                    <i class="fas fa-trash"></i> 削除
                </button>
            </div>
        </div>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/2.0.3/marked.min.js"></script>
    <!-- JavaScript コードは以前と同様ですが、以下の機能強化を追加 -->
    <script>
        let password = '';
        let currentMemo = null;
        let offset = 0;
        const limit = 10;
        let total = 0;
        let currentPageMap = {};

        // 認証処理
        document.getElementById('auth-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            password = document.getElementById('password').value;
            try {
                const response = await fetch('/api/auth', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ password }),
                });
                if (response.ok) {
                    document.getElementById('auth-panel').style.display = 'none';
                    loadMemos();
                } else {
                    showNotification('パスワードが間違っています', 'error');
                }
            } catch (error) {
                showNotification('パスワードが間違っています', 'error');
            }
        });

        // メモ一覧を読み込む
        async function loadMemos() {
            try {
                const response = await fetch(`/api/memos?offset=${offset}&limit=${limit}`);
                const data = await response.json();
                displayMemos(data.data);
                currentPageMap = data.data.reduce((acc, item) => {
                    acc[item.uid] = item;
                    return acc;
                }, {})
                total = data.total;
                updatePagination();
                document.getElementById('memo-count').textContent = `${total} 件のメモ`;
            } catch (error) {
                showNotification('リストの読み込みに失敗しました', 'error');
            }
        }

        function displayMemos(memos) {
            const container = document.getElementById('memo-items');
            container.innerHTML = memos.map(memo => `
        <div class="memo-item" data-id="${memo.uid}" onclick="selectMemo('${memo.uid}')">
            <div class="memo-item-header">
                <span class="memo-uid">${memo.uid.slice(0, 8)}...</span>
                <span>${new Date(memo.createTime).toLocaleString()}</span>
            </div>
            <div class="memo-item-content">
                ${escapeHtml(memo.content)}
            </div>
        </div>
    `).join('');
        }

        async function selectMemo(uid) {
            try {
                const memo = currentPageMap[uid];
                currentMemo = memo;
                displayMemoDetail(memo);

                // 選択状態の更新
                document.querySelectorAll('.memo-item').forEach(item => {
                    item.classList.remove('active');
                });
                document.querySelector(`.memo-item[data-id="${uid}"]`)?.classList.add('active');
            } catch (error) {
                showNotification('Memo の読み込みに失敗しました', 'error');
            }
        }

        function displayMemoDetail(memo) {
            document.getElementById('memo-info').innerHTML = memo.uid;
            document.getElementById('memo-content').value = memo.content;
            updatePreview();
        }

        function updatePreview() {
            const content = document.getElementById('memo-content').value;
            document.getElementById('memo-preview').innerHTML = marked(content);
        }

        document.getElementById('memo-content').addEventListener('input', updatePreview);

        async function saveMemo() {
            const content = document.getElementById('memo-content').value;
            if (!content.trim()) {
                showNotification('Memo の内容は空にできません', 'error');
                return;
            }

            try {
                showLoading(true);

                if (currentMemo) {
                    // 既存のメモを更新
                    await fetch(`/api/memos/${currentMemo.uid}`, {
                        method: 'PUT',
                        headers: {
                            'Authorization': password,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ content })
                    });
                } else {
                    // 新規メモを作成
                    await fetch('/api/memos', {
                        method: 'POST',
                        headers: {
                            'Authorization': password,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ content })
                    });
                }

                showNotification('Memo を保存しました');
                loadMemos();
            } catch (error) {
                showNotification('Memo の保存に失敗しました', 'error');
            } finally {
                showLoading(false);
            }
        }

        async function deleteMemo() {
            if (!currentMemo) return;

            if (confirm('この Memo を削除してもよろしいですか？')) {
                try {
                    showLoading(true);
                    await fetch(`/api/memos/${currentMemo.uid}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': password
                        }
                    });
                    showNotification('Memo を削除しました');
                    loadMemos();
                    clearMemoDetail();
                } catch (error) {
                    showNotification('Memo の削除に失敗しました', 'error');
                } finally {
                    showLoading(false);
                }
            }
        }

        function createMemo() {
            currentMemo = null;
            clearMemoDetail();
        }

        function clearMemoDetail() {
            document.getElementById('memo-info').innerHTML = '新規 Memo';
            document.getElementById('memo-content').value = '';
            document.getElementById('memo-preview').innerHTML = '';
        }

        function prevPage() {
            if (offset - limit >= 0) {
                offset -= limit;
                loadMemos();
            }
        }

        function nextPage() {
            if (offset + limit < total) {
                offset += limit;
                loadMemos();
            }
        }

        function updatePagination() {
            const currentPage = Math.floor(offset / limit) + 1;
            const totalPages = Math.ceil(total / limit);
            document.getElementById('page-info').textContent =
                `ページ ${currentPage} / ${totalPages}`;
        }

        function showLoading(show) {
            const saveBtn = document.getElementById('save-btn');
            if (show) {
                saveBtn.innerHTML = '<div class="loading"></div> 保存中...';
                saveBtn.disabled = true;
            } else {
                saveBtn.innerHTML = '<i class="fas fa-save"></i> 保存';
                saveBtn.disabled = false;
            }
        }

        function showNotification(message, type = 'success') {
            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            notification.textContent = message;
            notification.style.position = 'fixed';
            notification.style.top = '20px';
            notification.style.right = '20px';
            notification.style.padding = '1rem';
            notification.style.borderRadius = '5px';
            notification.style.backgroundColor = type === 'success' ? '#2ecc71' : '#e74c3c';
            notification.style.color = 'white';
            notification.style.zIndex = '1000';
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 3000);
        }

        // XSS 攻撃防止のための補助関数
        function escapeHtml(html) {
            const div = document.createElement('div');
            div.textContent = html;
            return div.innerHTML;
        }

        // marked の初期設定
        marked.setOptions({
            breaks: true,
            gfm: true,
            headerIds: false
        });
    </script>
</body>

</html>
```

JS コードからわかるように、バックエンドは以下のエンドポイントを持ちます。

- `POST /api/auth`：ページ認証
- `GET /api/memos`：つぶやき詳細取得（ページネーション対応）
- `POST /api/memos`：新規つぶやき投稿
- `PUT /api/memos/{uid}`：つぶやき更新
- `DELETE /api/memos/{uid}`：つぶやき削除

続いて `worker.js` を編集し、これらのエンドポイントを実装します。

```js
import html from './index.html';

const CORRECT_PASSWORD = 'CORRECT_PASSWORD';        // パスワードを設定    // [!code highlight]
const CALLBACK_URL = 'https://CALLBACK_URL';        // コールバック URL を設定   // [!code highlight]
const ALLOWED_ORIGINS = ['https://example.com'];    // 許可するドメインリスト  // [!code highlight]

// ランダム UID 生成
function generateUID() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 22; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars[randomIndex];
  }
  return result;
}
// CORS 処理
function handleCORS(request) {
  const origin = request.headers.get('Origin');
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  return corsHeaders;
}
function getCurrentTimeInISOFormat() {
  const now = new Date();
  // 各パーツ取得
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0'); // 月は 0 始まり
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  // ISO 8601 形式の文字列に組み立て
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
}
async function handleRequest(request, env) {
  const url = new URL(request.url);
  function validateAuth(request) {
    const auth = request.headers.get('Authorization');
    return auth === CORRECT_PASSWORD;
  }
  async function shouldNotify(uid) {
    const indexStr = await env.KV.get('index');
    if (!indexStr) return false;
    const index = JSON.parse(indexStr);
    return index.indexOf(uid) < 10;
  }
  async function executeCallback() {
    try {
      await fetch(CALLBACK_URL);
    } catch (error) {
      console.error('Callback failed:', error);
    }
  }
  const corsHeaders = handleCORS(request);
  
  // CORS プリフライトリクエスト処理
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: handleCORS(request),
    });
  }
  // 管理ページ
  if (url.pathname === '/manage') {
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  }
  // パスワード認証
  if (url.pathname === '/api/auth' && request.method === 'POST') {
    const { password } = await request.json();
    return new Response(
      JSON.stringify({ success: password === CORRECT_PASSWORD }),
      {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        },
      }
    );
  }
  // API ルーティング処理
  if (url.pathname.startsWith('/api/memos')) {
    // つぶやき一覧取得
    if (request.method === 'GET') {
      const offset = parseInt(url.searchParams.get('offset')) || 0;
      const limit = parseInt(url.searchParams.get('limit')) || 10;
      const indexStr = await env.KV.get('index');
      const index = indexStr ? JSON.parse(indexStr) : [];
      const pageUids = index.slice(offset, offset + limit);
      const posts = await Promise.all(
        pageUids.map(uid => env.KV.get(uid).then(JSON.parse))
      );
      return new Response(JSON.stringify({
        offset,
        limit,
        data: posts,
        total: index.length,
        hasMore: (offset + limit) < index.length,
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        },
      });
    }
    // 認証が必要な操作
    if (!validateAuth(request)) {
      return new Response('Unauthorized', {
        status: 401,
        headers: corsHeaders
      });
    }
    // 新規つぶやき投稿
    if (request.method === 'POST') {
      const { content } = await request.json();
      if (!content || !content.trim()) {
        return new Response('Content cannot be empty', {
          status: 400,
          headers: corsHeaders
        });
      }
      const indexStr = await env.KV.get('index');
      const index = indexStr ? JSON.parse(indexStr) : [];
      let uid = generateUID();
      while (true) {
        if (!index.includes(uid)) {
          break;
        }
        uid = generateUID();
      }
      const post = {
        uid,
        createTime: getCurrentTimeInISOFormat(),
        content: content.trim()
      };
      index.unshift(uid);
      await Promise.all([
        env.KV.put('index', JSON.stringify(index)),
        env.KV.put(uid, JSON.stringify(post))
      ]);
      await executeCallback();
      return new Response(JSON.stringify(post), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        },
      });
    }
    // つぶやき編集
    if (request.method === 'PUT') {
      const uid = url.pathname.split('/').pop();
      const { content } = await request.json();
      if (!content || !content.trim()) {
        return new Response('Content cannot be empty', {
          status: 400,
          headers: corsHeaders
        });
      }
      const postStr = await env.KV.get(uid);
      if (!postStr) {
        return new Response('Post not found', {
          status: 404,
          headers: corsHeaders
        });
      }
      const post = JSON.parse(postStr);
      post.content = content.trim();
      await env.KV.put(uid, JSON.stringify(post));
      // コールバックが必要か判定
      if (await shouldNotify(uid)) {
        await executeCallback();
      }
      return new Response(JSON.stringify(post), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        },
      });
    }
    // つぶやき削除
    if (request.method === 'DELETE') {
      const uid = url.pathname.split('/').pop();
      const indexStr = await env.KV.get('index');
      if (!indexStr) {
        return new Response('Post not found', {
          status: 404,
          headers: corsHeaders
        });
      }
      const needCallback = await shouldNotify(uid);
      const index = JSON.parse(indexStr);
      const newIndex = index.filter(id => id !== uid);
      await Promise.all([
        env.KV.put('index', JSON.stringify(newIndex)),
        env.KV.delete(uid)
      ]);
      if (needCallback) {
        await executeCallback();
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        },
      });
    }
  }
  return new Response('Not Found', {
    status: 404,
    headers: corsHeaders
  });
}
export default {
  async fetch(request, env) {
    try {
      return handleRequest(request, env);
    } catch (error) {
      return new Response(`Internal Server Error: ${error.message}`, {
        status: 500,
        headers: handleCORS(request)
      });
    }
  },
};
```
最上部の 3 つの定数は設定が必要です：

- `CORRECT_PASSWORD`：ページのパスワード
- `CALLBACK_URL`：新規投稿や更新・削除後に呼び出すコールバック URL
- `ALLOWED_ORIGINS`：クロスオリジン対応のため許可するドメインリスト。最低でもブログのドメインと管理ページのドメインの 2 つを含めること。

設定が完了したら公開ボタンを押します。

中国のネット環境の影響で、デフォルトの `workers.dev` ドメインはアクセスが困難な場合が多いので、Worker に新しいドメインを設定するのが望ましいです。`memos` 詳細ページの「設定 - ドメインとルーティング」でカスタムドメインを追加し、Cloudflare で管理しているドメインを入力します。このドメインも `worker.js` の `ALLOWED_ORIGINS` に追加してください。

これで管理ページが使えるようになります。管理ページの URL は `https://{あなたのドメイン}/manage` です。アクセス時にパスワード入力が求められます。入力後は快適に管理できます！

### フロントエンド

VitePress のおかげで、Vue コンポーネントとしてつぶやきのフロントエンドを簡単に作成し、ブログに埋め込めます。

まず markedjs 依存をインストールします。pnpm なら以下のコマンドを実行。

```shell
pnpm add marked
```

ブログのテーマ設定ファイル（通常は `docs/.vitepress/theme/index.ts`、ファイルパスや拡張子は環境により異なる場合あり）と同じ階層に `components` フォルダを作成（既存なら不要）、その中に`memos.vue` を新規作成します。

```vue
<template>
    <div class="memos-container">
        <div v-for="memo of memoList" :key="memo.uid">
            <div class="card">
                <div class="header">
                    <span class="time-text">{{ memo.createTime }}</span>
                </div>

                <div class="memo-content" v-html="memo.content" />
            </div>
        </div>
        <div v-if="hasMore" class="load-more">
            <button @click="loadMoreMemos" :disabled="isLoading" class="load-more-button">
                <span v-if="!isLoading">もっと読み込む</span>
                <span v-else class="loading-spinner"></span>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { marked, Tokens } from "marked"
import { reactive, toRefs, onMounted } from "vue"
import memosRaw from '../../../../memos.json'       // [!code highlight]

interface memosRes {
    data: memo[]
    hasMore: boolean
}

interface image {
    name: string
    filename: string
    url: string
}

interface memo {
    uid: string
    createTime: string
    content: string
}

function convertToLocalTime(dateString: string, timeZone: string = 'Asia/Shanghai'): string {
    // Date オブジェクトを作成
    const date = new Date(dateString);

    // 必要な時間要素を抽出
    const options: Intl.DateTimeFormatOptions = {
        timeZone: timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false // 24 時間制を使用
    };

    const formatter = new Intl.DateTimeFormat('zh-CN', options);
    const parts = formatter.formatToParts(date);

    // 最終的な出力形式を構築
    const year = parts.find(part => part.type === 'year')?.value;
    const month = parts.find(part => part.type === 'month')?.value;
    const day = parts.find(part => part.type === 'day')?.value;
    const hour = parts.find(part => part.type === 'hour')?.value;
    const minute = parts.find(part => part.type === 'minute')?.value;
    const second = parts.find(part => part.type === 'second')?.value;

    // 目標フォーマットに連結
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

const PAGE_SIZE = 10;
const data = reactive({
    memoList: [] as memo[],
    offset: 10, // ファイルから 10 件読み込んだので初期 offset は 10
    hasMore: true,
    isLoading: false
})
const { memoList, hasMore, isLoading } = toRefs(data);

const renderer = new marked.Renderer();
renderer.image = function({href, title, text}: Tokens.Image):string {
  return `
    <div class="img-container">
        <img class="imgwrp" loading="lazy" src="${href}" />
    </div>
  `
};
marked.use({
    renderer: renderer,
    breaks: true,
    gfm: true,
})

function processMemos(memos: memo[]) {
  return memos.map(memo => ({
    ...memo,
    content: marked.parse(memo.content) as string,
    createTime: convertToLocalTime(memo.createTime)
  }));
}

// 初期データのセットアップ
onMounted(() => {
  const initialMemos = memosRaw.data as memo[];
  data.memoList = processMemos(initialMemos);
});

async function loadMoreMemos() {
  if (!data.hasMore || data.isLoading) return;
  
  data.isLoading = true;
  try {
    const url = `https://{あなたのドメイン}/api/memos?limit=${PAGE_SIZE}&offset=${data.offset}`;   // [!code highlight]
    const response = await fetch(url);
    const result: memosRes = await response.json();
    
    const processedMemos = processMemos(result.data);
    data.memoList.push(...processedMemos);
    data.offset += result.data.length;
    data.hasMore = result.hasMore;
  } catch (error) {
    console.error('メモの読み込みに失敗しました:', error);
  } finally {
    data.isLoading = false;
  }
}
</script>

<style lang="scss">
.card {
    border-style: solid;
    margin-bottom: .5rem;
    border-width: 1px; 
    position: relative;
    border-radius: .5rem;
    border-color: var(--vp-c-bg);
    padding-top: .75rem;
    padding-bottom: .75rem;
    padding-left: 1rem;
    padding-right: 1rem;
    background-color: var(--memo-bg);
    font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", Segoe UI Symbol, "Noto Color Emoji";

    .header {
        display: flex;
        justify-content: space-between;
        align-items: center;

        .time-text {
            display: inline-block;
            font-size: .875rem;
            text-decoration: none;
            color: var(--memo-time)
        }
    }

    .memo-content {
        margin-top: 5px;
        font-size: 1rem;
        word-break: break-word;
        color: var(--memo-content);

        * {
            margin: 0;
        }

        *:not(:first-child):not([hidden]) {
            margin-top: .5rem;
        }

        .img-container {
            width: 40%;

            .imgwrp {
                width:100%;
                height: 100%;
            }
        }
    
    }
    
}

.card:hover {
    border-color: var(--memo-card-border);
}

.load-more {
  text-align: center;
  margin-top: 40px;
  margin-bottom: 40px;

  .load-more-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 120px; // 固定幅
    height: 40px; // 固定高さ
    background-color: transparent;
    color: var(--vp-c-text-2);
    border: 1px solid var(--vp-c-divider);
    border-radius: 4px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    outline: none;

    &:hover:not(:disabled) {
      background-color: var(--vp-c-bg-soft);
      color: var(--vp-c-text-1);
      border-color: var(--vp-c-text-2);
    }

    &:active:not(:disabled) {
      transform: translateY(1px);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .loading-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--vp-c-text-3);
      border-radius: 50%;
      border-top-color: var(--vp-c-text-1);
      animation: spin 0.8s linear infinite;
    }
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
```

`{あなたのドメイン}` は CloudFlare Worker のドメインに置き換えてください。

鋭い方はお気づきかもしれませんが、このコンポーネントの初期読み込みは Worker の API から取得しているのではなく、JSON ファイル（`import memosRaw from '../../../../memos.json'`）から取得しています。読み込み時に「もっと読み込む」を押すと Worker の API から追加取得します。なぜでしょうか？

- UX の観点から、つぶやきページに入った際、初期データを API から取得するとデータ取得まで画面が空白になり、体験が悪くなるため
- <mark>コスト節約</mark>の観点から、CloudFlare Worker 無料枠はリクエスト回数制限があるため、初期データを静的に取得することでリクエスト数を大幅に減らせるため

この `memos.json` はビルド時に API から取得した最新 10 件のつぶやきです。だから Worker コードに `CALLBACK_URL` があり、新規投稿や上位 10 件の更新・削除時に再ビルドをトリガーするためのコールバック URL を設定しています。完全に動的取得にしたい場合はこのコールバックは不要です。

以下のコードはビルド時に `memos.json`を生成するためのものです。テーマ設定ファイル（通常は `docs/.vitepress/theme/index.ts`）と同じ階層に`utils` フォルダを作成（既存なら不要）、その中に`memos.js` を作成します。

```js
import https from 'https';
import { promises as fs } from 'fs';

const url = 'https://{あなたのドメイン}/api/memos?limit=10';// [!code highlight]

const requestOptions = {
    headers: {
      'Accept-Encoding': '',
    }
};

// GET リクエストを送信
https.get(url, requestOptions, (resp) => {
  let data = [];

  // データを逐次受信
  resp.on('data', (chunk) => {
    data.push(chunk);
  });

  // 受信完了
  resp.on('end', async () => {
    try {
      // Buffer 配列を結合
      const buffer = Buffer.concat(data);
      const decodedData = buffer.toString('utf-8'); // UTF-8 エンコードと仮定

      // JSON データをファイルに保存
      await fs.writeFile('memos.json', decodedData);
      console.log('JSON データを data.json に保存しました');
    } catch (e) {
      console.error('JSON 解析エラー:', e);
    }
  });

}).on('error', (err) => {
  console.error('データ取得エラー:', err);
});
```

続いてブログルートの `package.json` を編集し、dev と build コマンドの前に`node docs/.vitepress/theme/utils/memos.js`を追加します。追加位置は環境により異なりますが、例として：

```json
{
  ...
  "scripts": {
    "dev": "node docs/.vitepress/theme/utils/memos.js && vitepress dev docs",
    "build": "node docs/.vitepress/theme/utils/memos.js && vitepress build docs",
    "serve": "vitepress serve docs"
  },
  ...
}
```

こうすることで dev・build 時にまず `memos.js`が呼ばれ、ブログルートに `memos.json` が生成されます。パスはディレクトリ構成に応じて`memos.vue` の import パスも調整してください。

これでコンポーネントとデータの準備が整いました。次にこのコンポーネントをグローバル登録します。

テーマ設定ファイル（通常は `docs/.vitepress/theme/index.ts`）でコンポーネントをインポートし、登録します。

```ts
...
import Memos from './components/memos.vue'
...
export default {
    ...
    enhanceApp({ app }) {
        ...
        app.component('Memos', Memos);// [!code highlight]
    }
} satisfies Theme
```

これでブログのどこでも`<Memos />`でこのコンポーネントを呼び出せます。

最後に、このコンポーネントを置く単一ページを作成します。

> え？VitePress で単一ページを使ったことがない？
> 
> では、ルートに `pages` フォルダを作成し、VitePress のコア設定ファイル（テーマ設定ファイルではなく、通常は `docs/.vitepress/config.ts`）に以下の rewrites ルールを追加してください。
> 
> ```ts
> rewrites: {
>   'pages/:file.md': ':file.md'
> }
> ```
> 
> これで `pages` 配下のファイルが `/ファイル名` でアクセス可能になります。rewrites の詳細は [公式ドキュメント](https://vitepress.dev/guide/routing#route-rewrites) を参照。

`pages` フォルダに `balabala.md` を作成し、内容は以下。

```markdown
---
title: 碎碎念
hidden: true
comment: false
sidebar: false
aside: false
readingTime: false
showMeta: false
---

<Memos />
```

これで完成です。お疲れさまでした。