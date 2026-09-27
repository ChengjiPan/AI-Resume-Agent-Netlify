# AI Resume Agent — Netlify

Netlify 专用部署版本。它与 Vercel 版本独立，网页由 Netlify 托管，聊天接口由 Netlify Function 在服务端调用千问。

## 架构

```
招聘经理 → 静态聊天网页 → /api/chat Netlify Function
                              ↓
                       本地知识库检索
                              ↓
                         千问 qwen-plus
```

## 部署前必须配置

在 Netlify 项目中新增环境变量：

- `DASHSCOPE_API_KEY`：你的千问 API Key

不要把 API Key 写入 GitHub、`netlify.toml` 或浏览器代码。

## 更新知识库

编辑 `netlify/functions/_shared/knowledge.js` 中的资料后推送到 GitHub。Netlify 会自动重新部署。
