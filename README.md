# AI Reader for OpenCode

一个零构建的 Chrome Manifest V3 侧边栏扩展。它只在用户主动操作后抽取当前网页，通过本机 OpenCode server 完成忠实翻译、全文分析和基于全文的问答。翻译会随模型输出逐步替换原网页中的英文文本节点，尚未翻译的文字保持英文；链接、标题、粗体、列表、表格等原始 DOM 和样式不被重建。

## 安全边界

- 扩展只拥有 `activeTab`，不会常驻读取所有网页。
- 扩展声明普通 `http/https` 页面访问权限，以兼容 Edge 侧栏不稳定授予 `activeTab` 的情况；代码仍只在用户点击“抽取”后读取当前页。
- 模型请求只发送到 `http://127.0.0.1:4096/*`，扩展不直接连接模型网关。
- 网关 API Key 继续由本机 OpenCode 管理，不进入扩展、Git、日志或导出文件。
- OpenCode 密码只写入 `chrome.storage.session`，关闭浏览器会话后失效。
- 每个模型请求固定传入 `tools: {}`，网页正文被标记为不可信 `<page-content>` 数据。
- 正文上限为 60 万字符、5000 个内容块和 160 个模型分块，可随时停止。

## 1. 启动 OpenCode

先确认本机配置和可用模型：

```powershell
opencode auth list
opencode models
```

在 PowerShell 当前进程中设置一个本地服务密码并启动服务。不要把密码写进本仓库：

```powershell
$env:OPENCODE_SERVER_USERNAME = "opencode"
$env:OPENCODE_SERVER_PASSWORD = Read-Host "OpenCode server password"
opencode serve --hostname 127.0.0.1 --port 4096
```

必须保持监听地址为 `127.0.0.1`，不要使用 `0.0.0.0` 或 `--mdns`。

首次加载扩展后，在 `chrome://extensions` 复制扩展 ID，然后重启 OpenCode 并加入精确 CORS 来源：

```powershell
opencode serve --hostname 127.0.0.1 --port 4096 --cors "chrome-extension://<extension-id>"
```

## 2. 加载扩展

1. 打开 `chrome://extensions`，启用“开发者模式”。
2. 点击“加载已解压的扩展程序”。
3. 选择本目录 `ai-reader-extension`。
4. 打开一个普通 `http`/`https` 文章页，点击工具栏中的 AI Reader 图标。
5. 在侧边栏填写与 OpenCode server 相同的用户名和密码，点击“连接并读取模型”。
6. 点击“抽取”，再选择翻译、分析或提问。

Chrome 内置页、Chrome Web Store、部分受保护页面、PDF、跨域 iframe、Shadow DOM 和未渲染的虚拟滚动内容不在 MVP 支持范围内。

## 3. 长文与引用

“单块字符上限”是显式的用户配置，默认 12000。扩展按标题与内容块切分文章；全文分析先逐块阅读，再分层压缩摘要，不会无条件把整个长页面一次提交给模型。问答会从本次抽取的内容中选择相关分块。

模型输出中的 `[block:b00001]` 会显示为来源按钮。点击后，原网页滚动到相应内容并短暂高亮。网页刷新或切换后需要重新抽取。

## 4. 测试

需要 Node.js 20 或更高版本，无需安装依赖：

```powershell
npm test
npm run check
```

手工验收建议覆盖：普通技术博客、超长文章、表格/代码、广告噪声、正文提示注入、错误密码、不存在的模型、网关 401/429/5xx、处理中切换标签页以及主动停止。

## 5. 常见故障

- `Failed to fetch`：确认 4096 端口在监听，并为准确的扩展 ID 设置 `--cors`。
- `HTTP 401`：侧边栏用户名/密码必须与启动 OpenCode 的环境变量一致。
- `HTTP 404` 或模型不存在：重新连接并从 `/provider` 动态返回的列表选择模型。
- 无法抽取：确认页面是普通 `http`/`https` 页面；刷新页面后重试。
- 网关 429/5xx：稍后重试或改选模型；MVP 默认串行处理，不会并发轰击网关。

## 目录

```text
manifest.json                 MV3 权限和 Side Panel 声明
src/content/page-bridge.js    正文抽取、逐文本节点原位翻译与来源高亮
src/opencode/client.js        health/provider/session/message/abort 客户端
src/pipeline/                 分块、检索与任务提示词
src/sidepanel/                侧边栏 UI 和任务编排
src/shared/                   安全边界与共享常量
tests/                        Node 内置测试
```
