<div align="center">

# AI Reader

把英文网页直接翻译成中文，原来的排版不动。

<p>
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-245c43">
  <img alt="Edge and Chrome" src="https://img.shields.io/badge/Edge%20%2F%20Chrome-supported-245c43">
  <img alt="No build step" src="https://img.shields.io/badge/build-none-f2a65a">
  <img alt="Tests" src="https://img.shields.io/badge/tests-30%20passing-f2a65a">
</p>

</div>

![AI Reader 同位置英文原页与中文译文对比](./docs/images/dflash2-before-after.png)

## 为什么写这个扩展

我一直想要一个很具体的浏览器功能：打开一篇英文技术文章，不跳转到翻译页，不做左右双栏，也不重新排版，只把网页里的英文逐步换成中文。

Chrome 和 Edge 自带翻译很方便，普通网页基本够用。但一碰到大模型、推理框架和算子文章，效果就不太稳定。`speculative decoding`、`draft model`、`serving stack`、`kernel` 这类术语经常被译错，句子稍微长一点，技术关系也容易变味。

另一方面，我已经在用 DeepSeek、GLM、Qwen、Kimi 等模型，也有自己的 coding plan、token plan 或 OpenAI 兼容 API。如果能把这些模型接到浏览器里，技术文章的翻译会靠谱得多。AI Reader 就是从这个需求开始的。

它不重建网页。扩展找到正文中的原始文本节点，让模型逐段翻译，再把中文写回同一个节点。标题还是标题，链接仍然能点，粗体、列表、表格和深色主题也都留在原位。

## 实际效果

上面的左右截图来自 [Inco AI 的 DFlash 2 文章](https://inco.ai/blog/dflash2/)，使用相同的视口和正文位置。可以直接对照红色链接、粗体、斜体、段落层级以及下方的文章配图；AI Reader 只替换文字，没有改动网页结构：

- 英文按生成进度逐步变成中文，没翻到的部分继续显示英文；
- 链接、强调样式、段落间距和页面主题保持不变；
- 刷新或点击“显示原文”可以回到原始内容。

侧栏保持在网页旁边，不会盖住正文：

<p align="center">
  <img alt="AI Reader Edge 侧栏" src="./docs/images/ai-reader-v0.2-sidepanel-width.png" width="420">
</p>

## 它怎么工作

```mermaid
flowchart LR
    A[当前网页] --> B[抽取可见正文和文本节点]
    B --> C[按长度安全分块]
    C --> D[DeepSeek / GLM / Qwen / Kimi 等模型]
    D -->|SSE 流式返回| E[逐 token 更新原文本节点]
    E --> F[网页结构和样式保持不变]
    B --> G{本地缓存命中?}
    G -->|是| E
    G -->|否| C
```

翻译协议要求模型为每个原始文本节点返回一份译文。内部标记会在写回网页前被解析和清理，不会出现在正文里。模型偶尔漏回节点时，扩展会自动补译一次；仍未返回的节点保留英文。

## 安装

AI Reader 暂时以解压缩扩展的方式安装，不需要构建。

1. 下载或克隆这个仓库。
2. 在 Edge 打开 `edge://extensions/`，Chrome 打开 `chrome://extensions/`。
3. 开启“开发人员模式”。
4. 点击“加载解压缩的扩展”，选择仓库根目录。
5. 打开普通 `http` 或 `https` 网页，点击工具栏中的 AI Reader。

更新代码后，在扩展管理页点击一次“重新加载”即可。

## 连接模型平台 API

AI Reader 使用 OpenAI Chat Completions 兼容协议，不绑定某一家平台。第一次配置时：

1. 在模型平台的开放平台或开发者控制台创建 API Key，并确认账号有可用 API 额度。
2. 打开 AI Reader 的“连接设置”，使用方式选择“模型 API 直连”。
3. 填入对应的 Base URL 和 API Key，点击“连接并读取模型”。
4. 从下拉框选择模型；如果平台没有提供标准模型列表接口，就手动填写控制台中的 Model ID。
5. 返回网页，点击“翻译当前网页”。

支持情况：

| 平台 | Base URL | 模型选择 |
| --- | --- | --- |
| [Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers/pricing) | `https://router.huggingface.co/v1` | 免费账号可用少量月度试用额度，支持自动读取模型 |
| [DeepSeek 开放平台](https://api-docs.deepseek.com/quick_start/pricing-details-cny/) | `https://api.deepseek.com` | 支持自动读取模型 |
| [阿里云百炼](https://help.aliyun.com/zh/model-studio/base-url) | `https://dashscope.aliyuncs.com/compatible-mode/v1`，或控制台显示的业务空间专属地址 | 自动读取失败时手动填写，例如 `qwen-plus` |
| [智谱开放平台](https://docs.bigmodel.cn/cn/api/introduction) | `https://open.bigmodel.cn/api/paas/v4` | 自动读取失败时填写控制台中的 GLM Model ID |
| [Kimi 开放平台](https://platform.kimi.com/docs/api/overview) | `https://api.moonshot.cn/v1` | 支持自动读取模型 |
| [火山方舟](https://www.volcengine.com/docs/82379/1795150) | `https://ark.cn-beijing.volces.com/api/v3` | 选择自动读取结果，或填写方舟控制台中的模型/推理接入点 ID |

### 用 Hugging Face 免费测试

Hugging Face 免费账号目前每月有少量 Inference Providers 试用额度，具体金额可能调整。它适合翻译一小段文字或短页面，确认 AI Reader 的连接、流式输出和原位替换都正常；完整技术文章可能很快用完额度。

1. 注册或登录 [Hugging Face](https://huggingface.co/)。
2. 打开 [Access Tokens](https://huggingface.co/settings/tokens)，点击“Create new token”。
3. 创建 Fine-grained Token，并勾选“Make calls to Inference Providers”权限。
4. 在 AI Reader 中选择“模型 API 直连”，填写：

```text
Base URL: https://router.huggingface.co/v1
API Key:  hf_开头的个人 Token
```

5. 点击“连接并读取模型”，从下拉框中选择支持 Chat Completions 的低价文本模型。
6. 先打开一个文字不多的英文网页，点击“翻译当前网页”完成测试。

免费额度只适用于通过 Hugging Face Router 计费的请求。额度用完后，需要等待下个月恢复或在 Hugging Face 购买额度。每位用户都应该使用自己的 Token；不要把个人 Token 写进扩展、提交到 GitHub，或作为公共 Key 分享。

### DeepSeek

在 DeepSeek 开放平台创建 API Key 并充值 API 余额，然后填写：

```text
Base URL: https://api.deepseek.com
API Key:  DeepSeek 开放平台生成的 Key
```

点击“连接并读取模型”后，AI Reader 会调用 DeepSeek 的 `/models` 接口生成下拉列表。这里需要的是开放平台 API 余额；网页聊天权益不等于 API 额度。

### 阿里云百炼 / Qwen

在[百炼控制台创建 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)，优先使用创建成功时显示的 API Host。北京地域的公共 OpenAI 兼容地址为：

```text
https://dashscope.aliyuncs.com/compatible-mode/v1
```

API Key、Base URL 和业务空间必须匹配。Token Plan、Coding Plan 能否用于浏览器扩展要以套餐规则为准；允许使用时也必须填写套餐专属 Key 和 Base URL，不能与按量付费地址混用。若模型列表读取失败，选择“手动填写 Model ID”，填入百炼模型广场给出的 ID。

### 智谱 GLM

在智谱开放平台创建通用 API Key，然后填写：

```text
https://open.bigmodel.cn/api/paas/v4
```

模型列表读取失败时，手动填写当前账号可调用的 GLM Model ID。智谱 Coding 套餐有单独的 Coding 端点和使用范围；网页翻译优先使用通用 API 额度。

### Kimi

在 Kimi 开放平台创建 API Key，然后填写：

```text
https://api.moonshot.cn/v1
```

Kimi 提供标准 `/v1/models` 接口，连接后可以直接选择当前可用模型。Kimi 网页会员与开放平台 API Key、API 余额不是同一项服务。

### 火山方舟

在火山方舟控制台创建 API Key，然后填写：

```text
https://ark.cn-beijing.volces.com/api/v3
```

选择自动读取到的模型；如果使用自定义网关或推理接入点且 `/models` 返回 404，就手动填写控制台中的模型 ID 或推理接入点 ID。

其他兼容 OpenAI Chat Completions 的 HTTPS 地址也可以使用。扩展会请求：

```text
POST {Base URL}/chat/completions
```

如果服务支持 `GET {Base URL}/models`，模型会自动出现在下拉框里。如果返回 404，侧栏会明确提醒，并切换到手动 Model ID。配置只需填写一次，之后会自动恢复。

Base URL、API Key 和选中的模型保存在当前浏览器扩展的 `chrome.storage.local` 中。这里不是加密保险箱，只适合自己的可信电脑。

## 翻译缓存和 Token

相同页面使用相同 Base URL 和模型再次翻译时，AI Reader 会直接读取本地译文缓存。只有新增或变化的文本才会发给模型。

翻译过程中，侧栏会显示本次输入、输出和总 Token：

```text
本次 Token：1,250 · 输入 820 · 输出 430 · 精确
缓存命中 35 段（不计入）
```

网关返回标准 `usage` 时显示精确值，否则显示动态估算值。缓存命中的部分不计入本次 Token；整页命中时总数为 0。

缓存默认开启，保存最近 20 个页面，总量限制在约 2 MB。可以在连接设置中关闭或清除缓存，API Key 和模型配置不会受影响。

## OpenCode 高级模式

如果模型已经配置在 OpenCode 中，可以在“使用方式”里切换到 OpenCode：

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

连接成功后，从 OpenCode 返回的 Provider 和 Model 列表中选择即可。OpenCode 密码只保存在 `chrome.storage.session`，浏览器会话结束后清除。

## 侧栏里的其他功能

| 功能 | 用途 |
| --- | --- |
| 翻译当前网页 | 自动读取正文，把译文流式写回原网页 |
| 显示原文 | 恢复本次读取时保存的英文 |
| 重新读取 | 页面内容变化后重新建立正文索引 |
| 全文分析 | 分块阅读全文，再生成中文分析 |
| 提问 | 只根据当前网页内容回答问题 |
| 停止 | 中止当前请求，未完成部分继续保持英文 |

## 当前边界

以下页面暂时不能或不适合处理：

- 浏览器内置页、扩展商店和受保护页面；
- PDF、跨域 iframe、Shadow DOM；
- 只渲染当前可见区域的超长虚拟列表。

单次正文上限为 60 万字符、5000 个内容块和 160 个模型分块。模型 API 模式会自动缩小分块，避免长时间流式连接被网关关闭。

## 安全说明

- 只有用户点击操作后，扩展才读取当前标签页。
- API Key 不会注入网页、写入日志或导出文件。
- 网页正文始终按不可信数据处理，模型请求固定禁用工具调用。
- 模型 API 直连只接受 HTTPS；OpenCode 地址固定为 `http://127.0.0.1:4096`。
- 译文缓存保存页面 URL、原文指纹和中文译文，不保存完整英文原文。敏感页面可以关闭缓存。

## 开发与测试

项目使用原生 JavaScript 和浏览器 API，没有打包步骤。测试需要 Node.js 20 或更高版本：

```powershell
npm test
npm run check
```

主要目录：

```text
manifest.json                 MV3 权限和 Side Panel 声明
src/content/page-bridge.js    正文抽取、文本节点替换、原文恢复
src/openai-compatible/client.js
                              OpenAI 兼容 Chat Completions 客户端
src/opencode/client.js        OpenCode 高级模式客户端
src/pipeline/                 分块、缓存、翻译协议和 Token 统计
src/sidepanel/                侧栏界面与任务编排
src/shared/                   安全边界和共享常量
tests/                        Node 内置测试
```

如果你也经常读英文技术文章，欢迎试用、提 issue，或者直接改成适合自己的模型入口。
