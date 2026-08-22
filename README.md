# AI Reader

一个零构建的 Edge/Chrome Manifest V3 侧边栏扩展。点击一次即可读取当前网页，并把英文逐步原位替换为中文；链接、标题、粗体、列表、表格和其他 DOM 格式保持不变。

默认直接调用火山兼容接口，不需要启动本地服务。OpenCode 仍作为多 Provider 高级模式保留。

## 快速开始：火山直连

1. 打开 `edge://extensions/`，启用“开发人员模式”。
2. 点击“加载解压缩的扩展”，选择本仓库目录。
3. 在普通 `http`/`https` 网页中点击 AI Reader 图标。
4. 保持“火山直连（推荐）”，填写 Base URL 和 API Key。
5. 点击“连接并读取模型”。插件会自动列出网关返回的模型；如果网关不支持 `/models`，手动填写一次 Model ID。
6. 选中的模型会自动保存，然后点击“翻译当前网页”。

标准火山方舟 Base URL 为：

```text
https://ark.cn-beijing.volces.com/api/v3
```

也可以填写兼容 OpenAI Chat Completions 的 HTTPS 网关 Base URL。扩展会请求 `{Base URL}/chat/completions` 并使用 SSE 流式更新原网页。

API Key、Base URL、Model ID 和普通偏好设置都保存在 `chrome.storage.local`，浏览器重启后会自动恢复。OpenCode 服务密码仍只写入 `chrome.storage.session`。

## OpenCode 高级模式

在“使用方式”中选择 OpenCode，填写：

```text
地址：http://127.0.0.1:4096
用户名：opencode
服务密码：启动 OpenCode Server 时设置的密码
```

启动示例：

```powershell
$env:OPENCODE_SERVER_USERNAME = "opencode"
$env:OPENCODE_SERVER_PASSWORD = Read-Host "OpenCode server password"
opencode serve --hostname 127.0.0.1 --port 4096 --cors "chrome-extension://<extension-id>"
```

连接后从 OpenCode 返回的 Provider/Model 列表中选择模型即可。

## 使用方式

- `翻译当前网页`：自动读取正文并立即翻译，不需要先点“抽取”。
- `显示原文`：恢复本次读取时保存的原始文本。
- `重新读取`：页面内容变化后刷新正文索引。
- `全文分析`：自动重新读取当前网页，再生成全文分析。
- `提问`：首次提问时自动读取网页，后续问题复用会话。
- `停止`：中止当前模型请求；尚未翻译的内容保持原文。

模型漏回少量文本节点时，扩展会自动补译一次；仍未返回的节点保持原文，不会让整篇任务失败。

## 安全边界

- 仅在用户点击操作后读取当前标签页。
- 火山 API Key 保存在当前浏览器扩展的本地配置中，适合个人可信电脑；能访问该浏览器配置的人也可能读取它。卸载扩展会删除这份配置。
- OpenCode 密码只保存在浏览器会话内存中。
- 模型凭据不会注入网页、写入日志或导出文件。
- 网页正文被视为不可信数据，每个请求固定禁用工具调用。
- 火山直连只允许 HTTPS；OpenCode 只允许 `http://127.0.0.1:4096`。
- 正文上限为 60 万字符、5000 个内容块和 160 个模型分块。
- 内置页、扩展商店、PDF、跨域 iframe、Shadow DOM 和未渲染虚拟列表不在当前支持范围内。

## 测试

需要 Node.js 20 或更高版本：

```powershell
npm test
npm run check
```

## 目录

```text
manifest.json                 MV3 权限和 Side Panel 声明
src/content/page-bridge.js    正文抽取、逐文本节点翻译、原文恢复
src/volcengine/client.js      火山/OpenAI 兼容 Chat Completions 客户端
src/opencode/client.js        OpenCode 高级模式客户端
src/pipeline/                 分块、检索、翻译协议与提示词
src/sidepanel/                侧边栏 UI 和任务编排
src/shared/                   安全边界与共享常量
tests/                        Node 内置测试
```
