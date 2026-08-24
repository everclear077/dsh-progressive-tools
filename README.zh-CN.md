# DSH Progressive Tools

为 DeepSeek Harness 提供渐进式工具发现与按需激活。插件只让一个很小的
发现入口进入请求上下文，完整工具目录保留在进程内，搜索命中后才在下一步
暴露相关工具族。

[English](./README.md)

## 解决的问题

只要工具可见，其名称、描述和参数 schema 就会重复占用每次请求的 token。
当 profile 安装了大量 bundle 时，即使任务完全用不到其中多数能力，也要为
全部工具定义持续付出上下文成本。

本插件通过官方 scoped tool registry 实现渐进式披露：

```text
已注册工具
    │
    ├── 进程内可搜索目录
    │
    └── tool_search + 常驻工具 ──► 当前请求
                 │
                 └── 命中的工具族 ──► 下一次请求
```

## 主要能力

- 基于 `agent.ctx.tools.restrict()` 的逐 Agent 隔离。
- 一次 `tool_search` 完成搜索和激活。
- 可配置工具族规则，并提供前缀分组与单工具回退。
- schema token 预算、LRU 淘汰、工具族数量上限和回合 TTL。
- 工具注册、卸载或其他限制变化后自动刷新目录。
- 保留 Agent 自有的回报和结构化输出工具。
- 可选的 skill 到工具族联动。
- 从顶层结果元数据和嵌套 Code Mode dispatch 日志恢复状态。
- Cordis effect 完整可逆，支持插件卸载与配置热重载。

## 安装

```sh
dsh plugin --profile desktop add github:everclear077/dsh-progressive-tools#v0.1.0
```

GitHub 源码安装会运行 `prepare` 构建。pnpm 10 及以上版本需要按照安装失败
信息中打印的精确包名，在 profile 的 `pnpm-workspace.yaml` 中授权：

```yaml
allowBuilds:
  dsh-progressive-tools: true
```

然后重新执行安装命令。建议固定 tag 或 commit，避免安装内容随分支变化。

安装后先检查组合结果：

```sh
dsh --profile desktop --dump-config
```

输出中应包含本 bundle 提供的 `progressive-tools` 配置行。

## 使用

默认常驻面包含 `tool_search`、已注册的 `skill`、已注册的
`ask_user_question`、当前 Agent 自有工具，以及 Harness 管理的保留传输工具。

```json
{"query":"浏览器页面操作"}
{"action":"status"}
{"action":"reset"}
```

- `search`：返回排序结果，并让最高分工具族在下一步可用。
- `status`：查看当前激活状态和估算值。
- `reset`：释放全部已激活工具族，常驻工具不受影响。

## 配置

在 profile 的 `cordis.patch.yml` 中覆盖 bundle 配置：

```yaml
- id: progressive-tools
  config:
    maxActiveToolTokens: 4000
    maxActiveGroups: 2
    retentionTurns: 4
    alwaysVisible: [skill, ask_user_question]
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

追求更低上下文占用时，可以只保留一个激活工具族并缩短 TTL：

```yaml
- id: progressive-tools
  config:
    maxActiveToolTokens: 2000
    maxActiveGroups: 1
    retentionTurns: 2
```

完整字段和默认工具族见[配置参考](./docs/configuration.md)。

## 语义与边界

插件在 `agent/pre-step` 边界获取当前工具视图，区分继承工具和 Agent 自有工具，
必要时重建隐藏目录，然后安装 scoped allow-list。成功的 `tool_search` 结果在
下一次 pre-step 生效。

token 数字是确定性的 schema 估算值，不是供应方账单值。默认按紧凑 JSON
每四个字符估算一个 token；常驻、保留和 Agent 自有工具不属于受管目录，
因此不计入节省估算。

工具可见性属于组合机制，不是权限边界。涉及安全控制时，仍应启用原有的
approval、sandbox 和 guard 策略。

## 已知限制

- 官方公开 schema 不提供工具注册包来源，因此工具族通过有序名称规则与自动
  回退确定；自定义命名的部署应显式配置 groups。
- 当前使用确定性词法搜索，不使用向量语义搜索。
- 新请求的单个工具族如果自身超过预算，仍会保留并在结果中报告超预算；否则
  该能力会一直不可用。
- Agent 自有工具无法被自身 restriction 隐藏，且有意排除在受管预算外。
- 其他 scoped restriction 可以继续收窄能力；本插件不会恢复其他层已移除的工具。

## 开发

```sh
pnpm install
pnpm run check
```

实现依据官方的[架构参考](https://deepseek-harness.github.io/deepseek-harness/reference/)、
[工具子系统](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/tools)、
[渐进式披露扩展方式](https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/extension-cookbook)
和[插件打包规范](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish)。

## 许可证

[MIT](./LICENSE)
