# CLI 诊断处理

失败结果形如 `{"protocol":1,"error":{"code":"CONTENT_INCOMPLETE","message":"..."}}`，写入 stderr。成功结果的 `warnings` 每项有 `code`、`message`、`severity`，可能带源码 `line`；行号用于定位 Markdown，消息以实际输出为准。

## 严格失败后定位问题

`CONTENT_INCOMPLETE` 表示本次严格导出未保存文档，但不一定包含逐项警告。必要时明确生成一份仅供诊断的普通模式文档：

```sh
bruce-md2word "docs/报告.md" -o "output/项目报告-诊断.docx"
```

读取成功 JSON 中的 `warnings`，修正源文件，再运行原来的 `--strict` 命令。诊断产物可能缺图、保留公式或图表源码，不作为完整交付；最终返回严格导出的真实路径。用户明确允许降级交付时，可以使用普通模式，但必须说明缺失或替代内容。

| 代码 | 处理方式 |
| --- | --- |
| `IMAGE_UNAVAILABLE` | 检查图片是否存在、格式及完整性、是否位于允许读取的目录。文件输入的图片相对 Markdown 目录解析；标准输入使用 `--asset-base-dir`。 |
| `MERMAID_NOT_RENDERED` | 根据源码行号检查图表类型和语法；饼图、甘特图、部分配置或指令不支持。保持原意修改，无法等价表达时说明限制。 |
| `MATH_NOT_CONVERTED` | 检查分隔符、公式语法和不支持的结构，保留数学含义。普通模式保留完整公式源码；不要把源码保留当成原生公式转换成功。 |
| `MERMAID_SMALL_TEXT` | 属于可读性提示，不触发严格失败；检查图表，简化标签或拆分后再导出，需要时检查实际版面。 |
| `MERMAID_LAYOUT_ADJUSTED` | 横向流程图在 Word 中会太小，已改为纵向排布；节点与连线保留。检查最终页面，确认调整后的阅读顺序符合用途。 |
| `DIAGNOSTICS_TRUNCATED` | 警告已截断，不能声称已列出全部问题。先修正已知问题，再导出获取后续诊断。 |
| `EMPTY_INPUT` / `INVALID_INPUT` | 检查输入内容、扩展名、路径、命令参数以及 UTF-8 编码。 |
| `LIMIT_EXCEEDED` | 查看消息，按内容含义拆分文档或降低图片大小与复杂度；可能是时间、内存、公式数量（每次最多 1000 个）或其他资源上限，不盲目重复执行。 |
| `ABORTED` | 导出被中断信号取消（退出码 130），未保存文件；确认是否为用户或宿主主动取消，不自动重试。 |
| `BUSY` | 等待当前任务结束后重试，避免增加并发。 |
| `CONFIGURATION_ERROR` / `CONVERSION_FAILED` | 保留实际错误，检查环境或依赖；无法定位时报告失败，不伪造产物路径。 |

`severity: degradation` 会使严格模式失败；`severity: info` 不会。对于未知代码仍读取其消息和严重级别，不把未知警告忽略成成功无警告。


## 排版与脚注

表格按内容估算列宽，短行尽量不拆页。`<!-- word:table widths=1,1,4 -->` 指定下一表格列宽比例。`<!-- word:list id=steps continue -->` 续接此前同名列表，`restart` 创建新实例。`<!-- word:numbering section=2 -->` 在二级标题范围内续接顶层列表、跨节重启；`source` 恢复独立列表。`<!-- word:caption -->` 标记紧邻图片/表格的题注。错误或错位指令产生 `LAYOUT_DIRECTIVE_INVALID`；不可用的续接产生 `LIST_CONTINUATION_UNAVAILABLE`。

命名脚注支持 `[^id]` 与多段定义。`FOOTNOTE_UNDEFINED`、`FOOTNOTE_DUPLICATE`、`FOOTNOTE_NESTED`、`FOOTNOTE_TABLE_FLATTENED` 为降级，严格模式拒绝保存；`FOOTNOTE_UNUSED` 是信息提示。重复脚注引用通过 Word NOTEREF 域显示，修改文档后需更新域。不要自动删除脚注正文来让严格模式通过。

`MERMAID_STYLE_UNSUPPORTED`：图表已生成，但部分主题变量、样式属性或字号/虚线值未应用；这是信息提示，不阻止 strict 导出，请检查图表样式。
