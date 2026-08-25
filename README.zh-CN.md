# DSH Progressive Tools

为 DeepSeek Harness 提供缓存稳定的渐进式工具发现。默认模式从真实首个请求
开始只发送固定的小工具面，完整目录保留在进程内，搜索到的工具仍通过 DSH
原有执行管线完成调用。

[English](./README.md)

## 解决的问题

每个可见工具的名称、描述和参数 schema 都会重复占用请求 token。如果后续
再动态改变工具列表，请求前缀也会变化，导致上下文缓存无法继续复用。

默认的 `stable-proxy` 模式同时保证：

- 第一次请求就是精简工具面；
- 搜索前后顶层工具定义和系统文本保持逐字节稳定。

```text
完整工具注册表（仅进程内）
        │
        ├── 可搜索的精确工具定义
        │
        └── 固定请求工具面
              ├── tool_search
              ├── tool_dispatch
              └── 少量高频直连工具
                       │
tool_search 结果 ─────┴──► 把命中的精确定义追加到对话历史
                                  │
                                  └── tool_dispatch ──► DSH 原有执行管线
```

搜索只追加对话历史，不改变顶层 `tools` 数组。真实工具原有的审批、guard、
参数校验、超时、结果策略、延迟上下文和取消信号仍然生效。

## 主要能力

- 真实 AgentLoop 第一次请求即发送最小工具定义。
- 搜索前后原生工具数组和 Code Mode SDK 保持稳定。
- 返回精确工具名称、完整描述和参数 schema，不再激活整个工具族。
- 确定性的 BM25 风格词法排序，覆盖工具名、描述、嵌套参数说明、枚举、
  工具族元数据及多语言别名。
- `tool_dispatch` 使用原始工具定义进行运行时参数校验和执行。
- 单调 guard 阻止隐藏工具被直接调用，只允许分发器拥有的嵌套调用树进入。
- 同时支持继承工具和 Agent 自有工具的渐进式隐藏。
- 从顶层结果和 Code Mode 日志恢复已发现工具。
- 可选 Skill 到工具族的发现联动。
- 保留 `dynamic` 兼容模式，供必须动态暴露原生 schema 的场景使用。
- Cordis effect 完整可逆，支持卸载和配置重载。

## 安装

```sh
dsh plugin --profile web add github:everclear077/dsh-progressive-tools#v0.2.0
```

如果 pnpm 要求授权源码构建，把错误信息中给出的精确包名加入对应 profile 的
`pnpm-workspace.yaml`：

```yaml
allowBuilds:
  dsh-progressive-tools: true
```

安装后检查组合结果：

```sh
dsh --profile web --dump-config
```

输出中应包含本 bundle 提供的 `progressive-tools` 配置行。

## 使用

默认直连工具面包括：

- `tool_search`；
- `tool_dispatch`；
- 已注册的 `skill`、`ask_user_question`、`report`、`submit_*` 和
  `structured_output*`；
- 当前工具呈现模式所需的 Harness 保留传输工具。

正常对话不需要用户强制说明先调用 `tool_search`。插件会提供一段固定系统
说明，要求在判断能力不可用前先搜索。

搜索工具定义：

```json
{
  "query": "浏览器页面操作",
  "max_results": 3
}
```

按搜索返回的精确 schema 分发：

```json
{
  "name": "browser_open",
  "arguments": {
    "url": "https://example.com"
  }
}
```

`tool_search` 也支持 `{"action":"status"}`，会列出全部延迟工具族及其成员
工具名，并附带目录规模和 token 估算。搜索结果不会把命中工具加入下一次
请求的顶层工具数组。

## 配置

默认配置：

```yaml
- id: progressive-tools
  config:
    mode: stable-proxy
    toolName: tool_search
    dispatchToolName: tool_dispatch
    maxResults: 5
    requireDiscovery: true
    deferToolGuidance: true
    alwaysVisible:
      - skill
      - ask_user_question
      - report
      - submit_*
      - structured_output*
```

工具族只参与搜索排序，不会改变稳定请求工具面：

```yaml
- id: progressive-tools
  config:
    groups:
      - id: browser
        description: 浏览器导航与页面交互
        aliases: [browser, web page, 浏览器]
        include: [browser_*]
      - id: database
        description: 数据库检查与查询
        aliases: [database, sql, 数据库]
        include: [db_*, sql_*]
```

完整字段和 `dynamic` 迁移说明见[配置参考](./docs/configuration.md)。
[渐进式披露模型](./docs/progressive-disclosure.md)进一步说明 Skills、工具定义、
执行层和供应方能力边界之间的关系。

## 执行与安全语义

稳定模式在官方 `system-prompt/assemble` 边界过滤最终请求，不改变注册表本身。
如果直接调用被延迟的工具名，单调工具 guard 会拒绝它。`tool_dispatch` 使用
原 Agent、取消信号、根调用标识、真实工具名和参数创建嵌套执行，因此真实
工具仍会经过 DSH 的完整策略链。

该 guard 只维护调用路由，不替代 approval、sandbox 或其他安全策略。

## 取舍

- 延迟工具不会出现在顶层请求的原生参数 grammar 中；DSH 会在分发时使用原始
  schema 校验。
- 一项任务可能先增加一次搜索调用。
- 搜索是确定性词法排序，不依赖向量服务。
- 只有命中的定义进入对话，但会一直保留到常规 compaction。
- 工具注册或插件组合发生真实变化时，下一次系统前缀仍可能变化；普通搜索
  不会引起变化。

## 开发

```sh
pnpm install
pnpm run check
```

测试包含真实 AgentLoop 请求捕获，验证首个请求已经精简，并验证搜索后
`tools` 数组和系统文本完全不变。

实现依据官方的[架构参考](https://deepseek-harness.github.io/deepseek-harness/reference/)、
[系统提示子系统](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/system-prompt)、
[工具子系统](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/tools)、
[Skills 子系统](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/skills)
和[插件发布规范](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)。

## 许可证

[MIT](./LICENSE)
