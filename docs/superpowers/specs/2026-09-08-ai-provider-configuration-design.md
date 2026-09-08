# AI 供应商配置与设置界面重构设计

## 背景

当前 AI 配置将供应商限制为 `openai`、`anthropic` 和 `deepseek`。虽然可以修改 Base URL，但协议、鉴权方式、请求路径和自定义请求头没有独立表达，导致 OpenCode Go、OpenRouter、Ollama、LM Studio 以及其他兼容服务只能通过隐式配置接入。

OpenCode 将供应商、协议、`baseURL`、headers 和模型分开配置；Oh My Pi 也采用 `baseUrl`、`api`、`apiKey` 和模型列表组成自定义 provider。本设计吸收这两个项目的配置边界，但保持 WorkPulse 的本地单用户场景简单。

参考：

- https://opencode.ai/docs/providers
- https://github.com/can1357/oh-my-pi/blob/main/docs/providers.md

## 目标

- 支持预设供应商和自定义接口。
- 支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 三种协议。
- 支持 Bearer、`x-api-key` 和无鉴权三种方式。
- 支持 OpenCode Go 的 session header、OpenRouter 的自定义 headers 以及本地 Ollama/LM Studio。
- 将报告生成、收件箱 AI 整理和连接测试统一到同一个适配器边界。
- 保持一个当前生效配置，不引入多配置档案管理。
- 保持数据库 schema V1，不新增运行时依赖，不把密钥导出到数据库备份。

## 非目标

- 本轮不做 OAuth 登录。
- 不做自动模型目录、模型搜索和模型能力评级。
- 不做多个配置档案、按任务选择模型、故障转移和智能路由。
- 不做 MCP、工具调用编排或完整聊天会话历史。
- 不为每个厂商编写独立 UI；厂商差异通过预设和协议适配器表达。

## 用户界面

设置页的 AI 区域重构为一张独立的“AI 服务”卡片，按由简单到高级排列：

1. **供应商预设**：使用响应式卡片/下拉选择，包含 OpenAI、Anthropic、DeepSeek、OpenCode Go、OpenRouter、Ollama、LM Studio 和自定义接口。选择预设会填充默认 URL、协议、鉴权方式和模型，但所有值仍可编辑。
2. **常用配置**：API Key、Base URL、模型名称。无鉴权预设隐藏或禁用 API Key，并显示本地地址提示。
3. **协议与鉴权**：只有选择自定义接口或点击“高级设置”时显示。协议使用明确的中文说明，避免把“供应商名称”和“接口协议”混为一谈。
4. **高级请求头**：默认折叠，使用可增删的名称/值行。名称和值都限制长度；疑似密钥、token、authorization 的值默认遮罩。
5. **连接测试**：按钮位于卡片底部，显示测试中、成功延迟或可读错误。保存状态继续使用现有的字段级反馈。

界面行为：

- 预设切换立即保存非敏感配置，并清除上一次测试结果。
- Base URL、模型、协议和鉴权失焦保存；保存失败保留用户输入并显示错误。
- API Key 单独安全保存；自定义 header 值按敏感配置保存，不进入普通 settings 数据。
- 小屏幕下字段单列排列，高级设置不挤压主要操作。
- URL、协议、模型和 headers 的错误显示在对应字段旁，不只依赖 Toast。

## 配置模型

主进程和 preload 共享以下概念：

```ts
type AiProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages'
type AiAuthMode = 'bearer' | 'x-api-key' | 'none'

interface AiProviderConfig {
  presetId: string
  displayName: string
  protocol: AiProtocol
  authMode: AiAuthMode
  baseUrl: string
  model: string
  customHeaders: Record<string, string>
}
```

`apiKey` 不放入 `AiProviderConfig`，继续使用 Electron `safeStorage`。自定义 headers 中的值也通过安全存储保存；普通配置只保存预设、协议、鉴权方式、URL、模型和 header 名称等非敏感内容。备份和导出只包含非敏感配置。

预设的初始集合：

| presetId | 默认协议 | 鉴权 | 默认地址 |
| --- | --- | --- | --- |
| `openai` | OpenAI Chat | Bearer | `https://api.openai.com/v1` |
| `anthropic` | Anthropic Messages | `x-api-key` | `https://api.anthropic.com` |
| `deepseek` | OpenAI Chat | Bearer | `https://api.deepseek.com` |
| `opencode-go` | OpenAI Chat | Bearer | `https://opencode.ai/zen/go/v1` |
| `openrouter` | OpenAI Chat | Bearer | `https://openrouter.ai/api/v1` |
| `ollama` | OpenAI Chat | 无鉴权 | `http://127.0.0.1:11434/v1` |
| `lm-studio` | OpenAI Chat | 无鉴权 | `http://127.0.0.1:1234/v1` |
| `custom-openai` | 用户选择 | 用户选择 | 用户填写 |
| `custom-anthropic` | Anthropic Messages | 用户选择 | 用户填写 |

预设只是默认值来源，不限制用户修改 URL、模型或协议。OpenCode Go 继续附加 `x-opencode-session` 和 WorkPulse 客户端标识；该行为由适配器根据 endpoint 处理。

## 适配器与数据流

所有 AI 调用经过统一入口：

```text
Settings / Report / Inbox
          ↓
      loadAiConfig
          ↓
    validateAiConfig
          ↓
     createAdapter
          ↓
 protocol-specific request
```

适配器职责：

- 根据协议拼接 endpoint，识别用户已经填写完整路径的情况，避免重复追加 `/v1` 或 `/chat/completions`。
- 生成鉴权 headers 和自定义 headers，禁止 API Key 出现在日志与错误信息中。
- 解析 Chat Completions、Responses 和 Anthropic Messages 的普通响应及 SSE 流。
- 对 OpenCode endpoint 注入 session header；传入的 session ID 优先，否则按单次生成请求自动生成 UUID。
- 对本地无鉴权服务允许空 API Key。
- 统一超时、取消、HTTP 错误和无效响应的错误格式。

连接测试与正式生成使用完全相同的适配器和配置校验，避免“测试成功但正式请求失败”。

## IPC 与存储

- 将当前 provider、Base URL、model 的分散读写收敛到 AI 配置接口；保留普通 settings IPC 处理语言、报告偏好等非 AI 配置。
- 扩展 AI 连接测试契约，允许 `protocol`、`authMode` 和 headers 元数据，并对 URL、模型、header 名和值做类型、长度和协议校验。
- `none` 鉴权允许空 API Key；Bearer 和 `x-api-key` 必须有 API Key。
- `http` 仅允许本地地址（如 Ollama/LM Studio），远程服务默认要求 HTTPS；开发环境不放宽错误返回中的密钥脱敏规则。
- 敏感配置不进入 database export/import、日志和错误堆栈。
- 继续使用 schema V1，不新增数据库表；配置使用现有 settings 存储，密钥使用安全设置存储。

## 错误处理

- Base URL 无效：字段级提示“请输入有效的 HTTP(S) 地址”。
- 协议和 endpoint 不匹配：在测试前阻止请求并提示选择正确协议。
- 401/403：提示 API Key 或鉴权方式错误，不显示 Key 内容。
- 404：提示检查 Base URL 是否已经包含版本路径。
- 超时/取消：显示可重试状态，不将配置标记为已保存失败。
- 本地服务不可用：提示启动 Ollama/LM Studio 并保留当前配置。

## 测试与验收

主进程：

- 各协议生成正确 URL、headers 和请求体。
- OpenCode session header 能使用显式值，也能自动生成 UUID。
- OpenAI Responses 普通响应和流式响应可解析。
- Anthropic、OpenAI Chat、DeepSeek、OpenRouter 使用正确鉴权。
- Ollama/LM Studio 空 API Key 可以连接测试。
- 完整 endpoint 不会被重复拼接。
- 非法 URL、超长字段、非法 header 名和值被 IPC 拒绝。
- HTTP 错误和异常中不泄露 API Key 或敏感 header。

渲染层：

- 预设切换正确填充配置并保存。
- 自定义接口可选择协议和鉴权方式。
- 无鉴权预设不强制 API Key。
- 高级 headers 可增删、遮罩和保存。
- 测试连接显示 loading、成功延迟、错误和重试。
- 中英文文案齐全，小屏幕布局不产生横向溢出。

验收标准：用户只填写 API Key 和模型即可使用内置预设；用户选择自定义 OpenAI/Anthropic 兼容协议即可接入第三方或本地服务；报告、收件箱整理和连接测试的请求行为一致。
