---
title: Implementing a Dynamic "Memos" (Shuoshuo) Feature in VitePress
tags: ["Tech Tinkering", "VitePress", "Memos", "CloudFlare"]
lang: en
published: 2025-01-29T21:58:00+08:00
abbrlink: fiddling/vitepress-memos-component
description: "In dynamic blogs, adding a 'Memos' feature can greatly enhance the user experience. Unlike the cumbersome process required by static blogs, this feature allows users to post short thoughts anytime and anywhere, lowering the psychological barrier for sharing. By leveraging CloudFlare Workers for backend logic and KV storage for data, developers can easily manage memos. On the frontend, a Vue component embedded in the VitePress framework provides a lively, interactive display of these dynamic entries, enriching the blog with real-time flair."
---
### Preface

Many dynamic blogs come with a "Memos" feature—a special type of blog post that, thanks to the real-time nature of dynamic platforms, allows you to jot down and publish thoughts on the fly.

Static blogs, on the other hand, require you to compile HTML either locally or on a server before deployment, which makes instant publishing a challenge. When writing a long blog post, it's no trouble to sit at a computer and push updates via Git—deploying isn't a hassle. But when it comes to drafting a quick memo, having to boot up your PC and wrestle with Git commands (let alone doing this on mobile!) becomes a bit of a mental hurdle. You start to think, "Maybe I'll just skip posting this one."

So, I set out to develop a backend and frontend solution for a memo system. The result? The [Memos](/en/memos) page on this blog. The backend is powered by CloudFlare Workers and KV storage, and I whipped up a simple admin page for management. The blog framework is VitePress, and the frontend is built as a Vue component, directly embedded as a dedicated memo page.

Here’s a glimpse of the backend management interface:
![Memo Management Page](https://blog-img.shinya.click/2025/8551751fe98e55c4159d28b9ff5b9473.png)

### Backend: CloudFlare Workers + KV

#### Overview

The backend offers these main features:
- Add, delete, and update memos (basic CRUD)
- Authentication for both the main page and all write endpoints—secure enough
- Real-time Markdown preview (via marked.js)

There’s an `index` key stored in KV; its value is an array of uid strings, serving as the index for all memos. Each individual memo is stored under its unique `uid` as the key, with a value structure like:

```js
{
    "uid":"unique id",
    "createTime":"publish time",
    "content":"memo content",
}
```

#### Implementation

First, create a dedicated CloudFlare KV Space to store your memos. Head to `Account Home → Storage & Database → KV`, click‘Create’, and give it a memorable name—mine’s simply `memos`.

Next, create a CloudFlare Worker for logic handling. Go to `Account Home → Compute (Workers) → Workers and Pages`, hit‘Create’, and (again) give it a name—say, `memos-api`. Once it’s ready, click into your Worker for details, and under `Settings → Bindings`, add a new binding for `KV Namespace`. Set the variable name as `KV`, and select your freshly created KV Space (mine’s `memos`). Done! Now, code under `env.KV` directly accesses your memo KV data. Hit‘Edit Code’in the top right to get started.

Time for some coding magic! First, create an `index.html` file to house your admin page (HTML, CSS, and JS).

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
            /* 移除固定高度 */
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
            /* 显示 3 行文本 */
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
            /* 避免图片底部空隙 */
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

        /* Responsive Design */
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

        /* Markdown Preview Styles */
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

        /* Loading Spinner */
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
            <input type="password" id="password" placeholder="Enter password" required>
            <button type="submit" style="width: 100%">登录</button>
        </form>
    </div>

    <div class="container">
        <div class="memo-list">
            <div class="memo-list-header">
                <span>已发布</span>
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
                <div class="memo-info" id="memo-info">新 Memo</div>
                <button class="create-btn" onclick="createMemo()">
                    <i class="fas fa-plus"></i> 发布新 Memo
                </button>
            </div>
            <div class="memo-content">
                <div class="memo-edit">
                    <textarea id="memo-content" placeholder="Write your memo here..."></textarea>
                </div>
                <div class="memo-preview" id="memo-preview"></div>
            </div>
            <div class="memo-actions">
                <button onclick="saveMemo()" id="save-btn">
                    <i class="fas fa-save"></i> 保存
                </button>
                <button onclick="deleteMemo()" class="danger" id="delete-btn">
                    <i class="fas fa-trash"></i> 删除
                </button>
            </div>
        </div>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/2.0.3/marked.min.js"></script>
    <!-- JavaScript 代码与之前相同，但需要添加以下功能增强 -->
    <script>
        let password = '';
        let currentMemo = null;
        let offset = 0;
        const limit = 10;
        let total = 0;
        let currentPageMap = {};

        // Authentication
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
                    showNotification('密码错误', 'error');
                }
            } catch (error) {
                showNotification('密码错误', 'error');
            }
        });

        // Load memos
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
                document.getElementById('memo-count').textContent = `${total} memos`;
            } catch (error) {
                showNotification('加载列表错误', 'error');
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

                // Update selected state
                document.querySelectorAll('.memo-item').forEach(item => {
                    item.classList.remove('active');
                });
                document.querySelector(`.memo-item[data-id="${uid}"]`)?.classList.add('active');
            } catch (error) {
                showNotification('加载 Memo 错误', 'error');
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
                showNotification('Memo 内容不得为空', 'error');
                return;
            }

            try {
                showLoading(true);

                if (currentMemo) {
                    // Update existing memo
                    await fetch(`/api/memos/${currentMemo.uid}`, {
                        method: 'PUT',
                        headers: {
                            'Authorization': password,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ content })
                    });
                } else {
                    // Create new memo
                    await fetch('/api/memos', {
                        method: 'POST',
                        headers: {
                            'Authorization': password,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ content })
                    });
                }

                showNotification('保存 Memo 成功');
                loadMemos();
            } catch (error) {
                showNotification('保存 Memo 失败', 'error');
            } finally {
                showLoading(false);
            }
        }

        async function deleteMemo() {
            if (!currentMemo) return;

            if (confirm('确定要删除这条 Memo 吗？')) {
                try {
                    showLoading(true);
                    await fetch(`/api/memos/${currentMemo.uid}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': password
                        }
                    });
                    showNotification('删除 Memo 成功');
                    loadMemos();
                    clearMemoDetail();
                } catch (error) {
                    showNotification('删除 Memo 失败', 'error');
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
            document.getElementById('memo-info').innerHTML = '新 Memo';
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
                `Page ${currentPage} of ${totalPages}`;
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

        // 用于防止 XSS 攻击的辅助函数
        function escapeHtml(html) {
            const div = document.createElement('div');
            div.textContent = html;
            return div.innerHTML;
        }

        // 初始化 marked 配置
        marked.setOptions({
            breaks: true,
            gfm: true,
            headerIds: false
        });
    </script>
</body>

</html>
```

As you can see from the JS code, the backend includes the following API endpoints:
- `POST /api/auth`: Page authentication
- `GET /api/memos`: Fetch memos (with pagination)
- `POST /api/memos`: Publish a new memo
- `PUT /api/memos/{uid}`: Update a memo
- `DELETE /api/memos/{uid}`: Delete a memo

Next, write the logic in `worker.js` to implement these endpoints.

```js
import html from './index.html';

const CORRECT_PASSWORD = 'CORRECT_PASSWORD';
const CALLBACK_URL = 'https://CALLBACK_URL';
const ALLOWED_ORIGINS = ['https://example.com'];

function generateUID() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 22; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars[randomIndex];
  }
  return result;
}

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

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0'); // 月份从零开始
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');

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
  
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: handleCORS(request),
    });
  }

  if (url.pathname === '/manage') {
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  }

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

  if (url.pathname.startsWith('/api/memos')) {
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
    if (!validateAuth(request)) {
      return new Response('Unauthorized', {
        status: 401,
        headers: corsHeaders
      });
    }
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

Be sure to set these three top constants:
- `CORRECT_PASSWORD`: page/admin password
- `CALLBACK_URL`: a callback URL to trigger after publishing, updating, or deleting a memo
- `ALLOWED_ORIGINS`: list of allowed domains for CORS; at minimum, your blog and admin domains

Once configured, hit "Publish".

Due to firewall restrictions, the default `workers.dev` domain is hard to access—it's best to configure a custom domain for your worker. In the memos Worker details page under `Settings → Triggers`, add a custom domain that's managed via Cloudflare. Be sure to add this domain to your `ALLOWED_ORIGINS` array in `worker.js`.

Once that’s sorted, you can use the admin page at `https://{your-domain}/manage`, log in with your password, and enjoy the management experience!

### Frontend

Thanks to VitePress, embedding the front end is a breeze—just build your memo UI as a Vue component.

First, install the markedjs dependency using pnpm:

```shell
pnpm add marked
```

In your blog's theme directory (usually `docs/.vitepress/theme/index.ts`, but the path and extension may vary), create a `components` folder if it doesn't already exist, then add `memos.vue` inside:

```js
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
                <span v-if="!isLoading">Load More</span>
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
    const date = new Date(dateString);

    const options: Intl.DateTimeFormatOptions = {
        timeZone: timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };

    const formatter = new Intl.DateTimeFormat('zh-CN', options);
    const parts = formatter.formatToParts(date);

    const year = parts.find(part => part.type === 'year')?.value;
    const month = parts.find(part => part.type === 'month')?.value;
    const day = parts.find(part => part.type === 'day')?.value;
    const hour = parts.find(part => part.type === 'hour')?.value;
    const minute = parts.find(part => part.type === 'minute')?.value;
    const second = parts.find(part => part.type === 'second')?.value;

    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

const PAGE_SIZE = 10;
const data = reactive({
    memoList: [] as memo[],
    offset: 10,
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

onMounted(() => {
  const initialMemos = memosRaw.data as memo[];
  data.memoList = processMemos(initialMemos);
});

async function loadMoreMemos() {
  if (!data.hasMore || data.isLoading) return;
  
  data.isLoading = true;
  try {
    const url = `https://{your-domain}/api/memos?limit=${PAGE_SIZE}&offset=${data.offset}`;   // [!code highlight]
    const response = await fetch(url);
    const result: memosRes = await response.json();
    
    const processedMemos = processMemos(result.data);
    data.memoList.push(...processedMemos);
    data.offset += result.data.length;
    data.hasMore = result.hasMore;
  } catch (error) {
    console.error('Failed to load memos:', error);
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
    width: 120px;
    height: 40px;
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

Be sure to replace `{your-domain}` with your actual CloudFlare Worker domain!

Sharp-eyed readers may notice that initial memo content is loaded from a local JSON file (`import memosRaw from '../../../../memos.json'`), not directly from the API. Only when you click "Load More" does it fetch additional data from the Worker. Why?

- **User Experience**: If the initial data is fetched live via API, the page appears blank during loading, which isn’t great UX.
- **Saving Money**: CloudFlare Worker’s free tier is request-limited. Fetching the initial batch statically greatly reduces the number of API calls.

The `memos.json` file is generated at build time, grabbing the first ten memos via the API. As such, the Worker code includes a `CALLBACK_URL`—when you publish, delete, or update one of the first ten memos, it triggers a site rebuild, keeping your static data fresh. If you handle everything dynamically, you can skip this callback.

Use the code below to generate `memos.json` at build time. In your theme directory (usually `docs/.vitepress/theme`), create a `utils` folder and add `memos.js`:

```js
import https from 'https';
import { promises as fs } from 'fs';

const url = 'https://{your-domain}/api/memos?limit=10';// [!code highlight]

const requestOptions = {
    headers: {
      'Accept-Encoding': '',
    }
};

https.get(url, requestOptions, (resp) => {
  let data = [];

  resp.on('data', (chunk) => {
    data.push(chunk);
  });

  resp.on('end', async () => {
    try {
      const buffer = Buffer.concat(data);
      const decodedData = buffer.toString('utf-8');

      await fs.writeFile('memos.json', decodedData);
      console.log('JSON Saved to data.json');
    } catch (e) {
      console.error('Error parsing JSON:', e);
    }
  });

}).on('error', (err) => {
  console.error('Error getting data:', err);
});
```

Then, update your project's root `package.json` to run `memos.js` before dev/build. Here’s an example for reference:

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

This way, every time you run dev or build, the first thing that happens is generation of `memos.json` in your project's root. Be sure to adjust your import path in `memos.vue` if your directory structure differs.

Now that both the component and the data are ready, register `Memos` as a global component. In your theme config file (again, usually `docs/.vitepress/theme/index.ts`):

```js
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

With this setup, you can now use `<Memos />` anywhere in your blog.

For a dedicated memo page, simply create a new page.

> Never used a custom single page in VitePress before?
>
> Here’s how: add a `pages` folder in the root, then—in your core VitePress config (not the theme one, usually `docs/.vitepress/config.ts`)—add a rewrites rule: `'pages/:file.md': ':file.md'`. This lets you access everything in `pages/` directly via `/{filename}`. More info in the [official docs](https://vitepress.dev/guide/routing#route-rewrites).

Add a `balabala.md` file in your `pages` folder with the following content:

```markdown
---
title: Memos
hidden: true
comment: false
sidebar: false
aside: false
readingTime: false
showMeta: false
---

<Memos />
```

And that's all! Done and dusted.