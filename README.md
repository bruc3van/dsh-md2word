# bruce-md2word

**面向 AI Agent 的 Markdown 转 Word 工具：开箱即用的中文排版、Mermaid 图表转图片、可编辑数学公式。**

让 Agent 写好的报告、方案和技术说明直接成为可交付的 `.docx`：中文内容自动应用预设排版，Mermaid 图表在本机渲染为图片并嵌入，LaTeX 数学公式转换为可继续编辑的 Word 原生公式，减少复制内容后重新排版、截图和录入公式的工作。

提供 **Skill + 独立 CLI**，供具备命令执行能力的 Agent 和自动化脚本调用；同时提供 **DSH 插件**，通过原生 `word_export` 工具导出。npm 包、CLI 和 Skill 均名为 `bruce-md2word`。

## 三个特色功能

- **开箱即用的中文排版**：A4 页面，正文宋体、标题黑体，覆盖六级标题、五级列表及常见文档元素；实际字体显示取决于阅读环境。
- **Mermaid 图表转图片**：将流程图、时序图、状态图、类图、ER 图和 XY 图的常用语法在本机渲染为 PNG，按比例嵌入 Word，支持中文标签，无需手工截图。
- **可编辑的数学公式**：将 LaTeX 行内及块公式转换为 Word 原生公式，支持分式、根式、上下标、向量、求和积分、矩阵和分段函数，方便在 Word 中继续修改。

适合项目报告、实施方案、会议纪要、技术说明等以结构化内容为主的文档。提供中文报告和技术文档预设，可统一配置字体、字号、边距、缩进、目录、页码与页眉页脚，支持标题/图表编号、交叉引用和显式横向分节；不提供自定义 Word 模板接口。配置入口见 [文档排版说明](docs/document-layout.md)。

## 导出效果

以下页面均由本项目 CLI 从 Markdown 导出为 DOCX，再使用 **Microsoft Word 原生渲染**截图。点击图片查看大图。

| 开箱即用的中文排版 | Mermaid 图表转图片 | 可编辑的数学公式 |
| :---: | :---: | :---: |
| [![Word 中文排版：分级标题、正文、列表与表格](docs/assets/word-chinese.png)](docs/assets/word-chinese.png) | [![Word 中嵌入的中文 Mermaid 流程图和时序图](docs/assets/word-mermaid.png)](docs/assets/word-mermaid.png) | [![Word 原生公式：分式、求和、积分、矩阵和分段函数](docs/assets/word-math.png)](docs/assets/word-math.png) |
| [查看 Markdown 源文件](fixtures/showcase/中文排版.md) | [查看 Markdown 源文件](fixtures/showcase/Mermaid图表.md) | [查看 Markdown 源文件](fixtures/showcase/数学公式.md) |

截图使用工具默认样式，未对导出的 Word 进行额外排版。[截图生成方式](docs/assets/README.md)。

## 单次实际转换测评

以下结果基于**同一份 31 KB Markdown，每个 Skill 各运行一次**。样本包含标题、表格、六类 Mermaid 图和 6 个公式；耗时为该次任务的全流程用时，不代表其他文档或环境中的性能。

| Skill（来源） | 成品效果 | 全流程耗时 | 手工编写代码与 token 消耗 | 主要优点 | 主要不足 |
| --- | --- | --- | --- | --- | --- |
| `bruce-md2word`（本项目） | **本次最好**。标题、表格和六类 Mermaid 图的结构与布局保留较完整；6 个公式为可编辑 Word 公式。 | **148.3 秒**，含首次安装 CLI | 无需编写转换代码；主要工作是检查、导出和验收；token 消耗最低。 | 严格模式一次导出成功；图形布局和公式保真度明显领先。 | 两张 Mermaid 图缩小后文字偏小；31 页中有些留白。 |
| `documents:documents`（Codex 官方） | 主要文字、表格和普通图片可用；Mermaid 只保留节点与关系文字，未还原方向和布局；脚注、部分编号失真。 | **381.8 秒** | 需要从零编写 Python 转换脚本和制图代码。 | 可按需要控制文档生成逻辑；最终文件可直接用 Word 打开。 | 并非 Markdown 一键转换 Skill；本轮规定的渲染器因缺少 `soffice.exe` 无法运行；公式虽有可编辑对象，部分结构被简化。 |
| `docx`（Anthropic 官方） | 有动态目录和原生脚注；普通图片、表格大体可用；Mermaid 布局未还原，块公式与表格内图片存在明显缺陷。 | **312.8 秒** | 需要从零编写 JavaScript 转换脚本并多次调试。 | `docx-js` 提供目录、脚注、表格和公式对象等构件。 | 初始文件虽通过附带的 XML 验证，Word 仍提示损坏；最终成品经 Word 修复另存，复杂内容保真不足。 |

**本次样本的选择结论**：若目标是把现有复杂 Markdown 尽量忠实地转成 Word，`bruce-md2word` 最省人工且效果最好。另两个是通用的 Word 制作 Skill；本次转换效果很大程度取决于临时编写的脚本，不能算作它们自带的一键转换能力。耗时只是这份样本的单次结果。

## 融入 Agent 的文档交付流程

Agent 可以导出已有 Markdown 文件，也可以直接传入生成的正文。正文、标题、列表和表格保持可编辑；工具返回实际文件位置和结构化警告，方便 Agent 修正缺失图片、不支持的图表或公式后重新导出。严格模式拒绝保存存在内容降级的文档。

安装依赖后，转换在本地完成，无需 Office、Python、浏览器或在线转换服务。默认保存到当前项目的 `output/`，同名文件自动编号。

## 安全与隐私

**默认 CLI 和 DSH 项目模式在运行它们的机器上完成转换，不将文档上传到在线转换服务，不调用大模型 API，也不需要 API Key。** 如果你使用云端 Agent，这台机器可能是其远程运行环境；Agent 在生成或读取文档时的数据处理规则由所用平台决定。

| 关注点 | 当前实现 |
| --- | --- |
| 何时联网 | 安装 Skill、安装依赖和检查或更新 CLI 时会访问 GitHub、npm 等对应的软件源；依赖就绪后的转换过程无需联网。本项目转换代码未集成遥测或使用情况上报。 |
| 读取哪些文件 | 读取指定的 Markdown，以及文档图片目录内的相对路径图片或内嵌图片；不扫描整个磁盘。图片拒绝网络 URL、绝对路径、`file:` URI、目录穿越和指向目录外的符号链接。 |
| 是否执行文档内容 | Markdown 代码块和原始 HTML 作为文档内容处理，不作为命令或脚本执行；Mermaid 与 LaTeX 通过本地解析器转换。`jsdom` 未启用脚本执行或远程资源加载。 |
| 是否覆盖原文件 | 不改写输入 Markdown；导出同名 DOCX 时自动编号。CLI 先完成临时文件写入，再以不覆盖的方式发布最终文件，并拒绝符号链接输出目录。 |
| 是否有资源限制 | 默认 Markdown 上限 5 MiB、单图 20 MiB、累计图片 100 MiB、图片数 100、输出 100 MiB、任务超时 120 秒；还有限定图片像素和公式复杂度的检查。超限返回错误，支持取消任务。 |
| 内容缺失如何处理 | 返回结构化警告；`--strict` 拒绝保存检测到内容降级的文档。严格模式检查的是转换完整性，不是恶意内容扫描或事实核验。 |

DSH 项目模式通过宿主执行器运行 CLI，正文和文件参数以标准输入 JSON 传递，不拼接为 shell 命令，并传递宿主的沙箱策略；沙箱执行失败时不会自动退回无沙箱执行。独立 CLI 的文件检查和转换 worker 不等于操作系统级沙箱，实际权限取决于运行账号和宿主配置。DSH 附件模式则由宿主附件服务决定存储与交付位置。

Skill 是可阅读的 [操作说明](skills/bruce-md2word/SKILL.md)，优先复用已有且符合宿主策略的可用 CLI；缺少可用版本或需要更新时，遵循宿主的安装审计、权限审批、包成熟期和构建授权规则，不自动追随 latest，也不自行添加安装豁免。它不替代 Agent 平台自身的数据与执行策略。源码、[依赖清单](package.json)、[锁文件](package-lock.json)和[自动化检查](https://github.com/bruc3van/bruce-md2word/actions)均可查看。这些措施便于核查实现，但不表示经过独立安全认证或不存在第三方依赖风险。

## 运行环境与依赖

使用 CLI 需要 **Node.js 24 或 26（`^24 || ^26`）和 npm 或兼容的包管理器**。中文图表需要运行机器安装中文字体。无需安装 Word、LibreOffice、Pandoc、Python、Chromium 或单独的 Mermaid CLI；Word 仅用于打开、编辑或人工检查生成的文档。

<details>
<summary>转换依赖及用途</summary>

以下为当前源码锁定的直接转换与配置依赖；安装时由包管理器解析安装，无需逐项手动准备。

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `markdown-it` | `14.3.2` | 解析 Markdown 结构；关闭原始 HTML 渲染、自动链接识别和 typographer。 |
| `markdown-it-footnote` | `4.0.0` | 解析命名脚注、多段定义及重复引用；映射为 Word 原生脚注。 |
| `docx` | `9.7.2` | 生成 Word 文档、样式、表格和原生数学公式。 |
| `temml` | `0.13.5` | 将 LaTeX 解析为 MathML，再由本项目转换为 Word 原生公式。 |
| `jsdom` | `27.4.0` | 在本地解析 HTML、XML、MathML 和生成的 SVG；不启动浏览器。 |
| `saxes` | `6.0.0` | 保存前校验生成 DOCX 内各 XML 部件的格式与关系引用。 |
| `yaml` / `json5` | `2.9.1` / `2.2.3` | 解析 Mermaid 前置配置和初始化配置。 |
| `sharp` | `0.35.4` | 解码和处理图片，将生成的图表栅格化为 PNG；包含平台相关原生依赖。 |
| `bmp-js` | `0.1.0` | 解码支持的 BMP 图片。 |
| `jszip` | `3.10.2` | 检查 DOCX 压缩包结构及内部资源。 |
| `@deepseek-ai/schemastery` | `3.18.2` | 定义配置与参数校验 Schema。 |
| `beautiful-mermaid` | `1.1.3` | Mermaid 图表布局与 SVG 生成；经本项目适配后在构建时打包，用户无需另装。 |

`beautiful-mermaid` 虽列于开发依赖，其渲染代码及相关依赖会随安装包内置。CLI 所需的部分 DSH 文件访问和运行辅助代码也在构建时打包；独立使用不要求启动 DSH 服务。`sharp` 的平台原生包及其他传递依赖会出现在安装清单中，具体以包管理器解析结果为准。

DSH 插件另外依赖宿主的 Cordis、工具、文件和执行器服务：当前声明 Cordis `~4.0.4`，DSH 服务包 `0.1.7-rc.2`。默认项目模式需要 `tools` 与 `shell`；附件模式需要 `fs` 和 `attachments`；`skills` 服务可选。依赖中的 `dsh-llm` 用于宿主类型与错误接口，不代表转换过程调用模型。完整声明见 [package.json](package.json)，运行条件见 [Agent 参考](docs/agent-reference.md#环境与工具注册)。

从源码构建还使用 TypeScript、esbuild、类型声明和 DSH 本地测试服务。直接安装已发布 npm 包无需手动配置这些开发工具。本项目采用 MIT 许可证；第三方代码保留各自许可证，来源见 [NOTICE](NOTICE)，打包组件的许可证随包存放于 `lib/CLI-LICENSES.txt` 和 `lib/MERMAID-LICENSES.txt`。

</details>

<details>
<summary>依赖安全检查</summary>

锁定版本用于复现构建，不代表依赖永远没有漏洞。可在源码目录执行 `npm audit --omit=dev` 查看当前运行依赖报告。

`bruce-md2word@0.3.1` 已将 `markdown-it` 升级到 `14.3.2`，修复旧依赖的 smartquotes 告警（[GHSA-6v5v-wf23-fmfq](https://github.com/advisories/GHSA-6v5v-wf23-fmfq)）。2026-09-22 对当前锁文件执行 `npm audit --omit=dev`，报告为 0 项已知漏洞；这不等于不存在未知风险，后续以实时审计结果为准。使用 `0.3.0` 或更早版本的用户应升级到 `0.3.1` 或更新版本。

</details>

## 选择安装方式

通用 Agent 选择 Skill + CLI；DSH 用户选择插件。两种方式复用同一转换引擎，无需同时安装。

### 方式一：Skill + CLI

#### 安装 Skill

Skill 名称为 `bruce-md2word`，支持按名称调用的 Agent 可使用该名称选择技能；npm 包名和 CLI 命令也统一为 `bruce-md2word`。

仓库提供独立的 [Skill](skills/bruce-md2word/SKILL.md)，指导具备命令执行能力的 Agent 调用 CLI、处理诊断并交付真实文件路径。它不依赖 DSH 服务，与插件内部调用 `word_export` 的引导说明分别使用。

推荐使用 [skills CLI](https://github.com/vercel-labs/skills) 安装：

```sh
npx skills add bruc3van/bruce-md2word --skill bruce-md2word
```

默认安装到当前项目；添加 `-g` 可安装到用户级目录，添加 `-a <agent>` 可指定目标 Agent。安装后按目标 Agent 的方式重新加载技能。

`npx skills` 负责安装 Skill 文件。首次使用时，Agent 会按 Skill 检查 CLI，缺失时安装，版本落后时更新，然后继续导出；用户指定版本或项目锁定版本会被保留。需要 Node.js 24 或 26 和相应的命令执行权限。

如果希望提前准备 CLI，也可以手动安装：

```sh
npm install -g bruce-md2word@0.6.1
```

也可以直接让 Agent 帮你完成：

> 请使用 npx skills add bruc3van/bruce-md2word --skill bruce-md2word 安装到当前 Agent 的项目技能目录，再按 Skill 完成环境检查和 CLI 准备，将 docs/报告.md 严格导出为 Word，返回真实路径和警告。

需要手动安装时，将源码或 npm 包中的整个 `skills/bruce-md2word/` 目录复制到目标 Agent 的技能目录，保留 `SKILL.md` 和 `references/`。不同 Agent 的技能目录和发现机制以其配置为准；不支持自动发现 Skill 的 Agent，可将其作为项目指令读取。安装器识别成功不代表已逐一验证所有 Agent 的实际调用。

#### 直接使用 CLI

独立 CLI 可用于 DSH 之外的环境。给 Agent 的安装与使用指令：

> 请检查 Node.js 是否为 24 或 26，然后安装 bruce-md2word@0.6.1 的独立 CLI，将 docs/报告.md 严格导出为 Word。读取命令返回的 JSON，告诉我真实输出路径和警告；失败时说明错误码和原因。

对应命令：

```sh
npm install -g bruce-md2word@0.6.1
bruce-md2word docs/报告.md --strict -o output/项目报告.docx
bruce-md2word --help
```

CLI 支持文件输入，也支持以 `-` 从标准输入读取 Markdown；正文含相对图片时使用 `--asset-base-dir`。省略 `-o` 时输出到当前目录的 `output/`；显式指定输出目录时，其父目录须已存在。同名文件自动编号，无覆盖选项。

成功时 stdout 输出 JSON；失败时 stderr 输出结构化错误并返回非零退出码。严格模式的 `CONTENT_INCOMPLETE` 错误还包含 `error.diagnostics`（诊断代码、级别、消息和可用行号），无需先保存不完整文档即可修正内容。DSH 工具错误消息也列出这些诊断。

### 方式二：DSH 插件

把下面这句话发给 DSH Agent：

> 请从 npm 安装 DSH 插件 bruce-md2word，先核对该版本的 DSH 兼容范围，并告诉我如何使用。项目说明：https://github.com/bruc3van/bruce-md2word

安装时使用 npm 包名或精确版本，不要把 GitHub 说明链接作为 Git 依赖，也不要把 `[文字](URL)` 这样的 Markdown 链接传给安装命令。安装后重启对应 DSH 服务，即可让 Agent 导出 Word，无需另装 CLI 或 Skill。

若日志停在 `git ls-remote` 并提示未同意 Xcode 许可，说明安装尚未进入插件加载阶段。npm 包安装不需要从 GitHub 拉取源码；确实需要 Git 源码安装时，应由用户在终端运行 `sudo xcodebuild -license`，阅读并自行决定是否同意许可。

<details>
<summary>手动安装命令与环境要求</summary>

当前包要求 Node.js `^24 || ^26`、DSH 服务包 `0.1.7-rc.2`、Cordis `~4.0.4`。请在目标 DSH 环境中执行，将 `web` 换成实际 profile，并沿用该环境的 `DSH_HOME`。

```sh
dsh plugin --profile web add bruce-md2word@0.6.1
```

如果你的 DSH 通过 `npx` 启动，可使用对应版本的 CLI，例如：

```sh
npx @deepseek-ai/dsh@0.1.7-rc.2 plugin --profile web add bruce-md2word@0.6.1
```

安装后重启对应 profile。默认项目模式需要 DSH 的 `tools` 与 `shell` 服务就绪，才会注册 `word_export`。版本来源见 [npm 包](https://www.npmjs.com/package/bruce-md2word)，服务依赖见 [运行参考](docs/agent-reference.md#环境与工具注册)。

</details>

## 直接描述你要交付的文档

安装后，Agent 可根据当前入口使用 `bruce-md2word` CLI 或 DSH 的 `word_export`。

### 导出已有 Markdown

> 请将 docs/报告.md 导出为 Word，命名为“项目报告.docx”。使用已安装的 bruce-md2word，开启严格模式；完成后返回实际文件路径，并说明所有警告。

### 从资料生成报告并交付

> 请根据当前项目资料整理一份项目进展报告，包含背景、已完成事项、问题与下一步计划，用表格汇总任务。先保存为 docs/项目进展.md，再使用 bruce-md2word 严格导出为“项目进展报告.docx”。检查导出结果，返回实际路径和需要我关注的问题。

### 在方案中加入图表

> 请编写一份系统接入方案，包含中文 Mermaid 流程图和时序图，保存 Markdown 后使用 bruce-md2word 严格导出 Word。如果返回图中文字过小的提示，请根据对应行号简化标签或拆分图表，再重新导出。

文件保存在**运行 CLI 或 DSH 服务的机器上**。CLI 默认输出到命令工作目录的 `output/`，也可用 `-o` 指定路径；DSH 默认项目模式输出到当前会话项目的 `output/`。已有同名文件时自动追加编号，Agent 应返回实际结果中的真实路径。

## DSH 工具接口与结果处理

DSH 的 `word_export` 一次调用接收一个 Markdown 文件或一段正文，返回可由 Agent 继续处理的结构化结果。文件输入示例：

```json
{
  "source": { "kind": "file", "path": "docs/报告.md" },
  "fileName": "项目报告.docx",
  "strict": true
}
```

工作流程是：**生成或修改 Markdown → 调用导出 → 检查结果与警告 → 修正内容后再次导出 → 交付实际文件**。内容撰写、诊断处理与重试由调用方 Agent 完成，插件负责转换和反馈。

- `strict: true` 遇到缺失图片、不支持的图表等内容降级时拒绝保存；默认值为 `false`。
- 普通模式允许保留替代文字或图表源码，并返回降级警告，适合排查问题。
- `MERMAID_LAYOUT_ADJUSTED` 表示过宽的横向流程图已保留节点和连线、自动转为更易读的纵向布局；`MERMAID_SMALL_TEXT` 表示最终图中文字仍可能过小。两者都是可读性提示，严格模式仍可成功；Agent 应继续检查图表。
- 成功返回文件路径、实际文件名、大小、MIME 类型及 `warnings`。路径来自本地运行环境，不是下载链接。

严格模式通过表示未检测到内容降级，不代表文档事实正确或 Word 排版已验收。完整参数、诊断处理、附件模式与配置见 [Agent 接口与运行参考](docs/agent-reference.md)。

## 能转换哪些内容

| 内容 | 支持范围 |
| --- | --- |
| 正文与标题 | 段落、六级标题、粗体、斜体、删除线、链接 |
| 列表 | 有序与无序列表、五级编号样式、嵌套、指定起点与独立列表重启 |
| 结构化内容 | 表格、引用、行内代码、代码块、分隔线 |
| 图片 | PNG、JPEG、GIF、BMP；支持目录内相对路径和内嵌图片数据 |
| Mermaid | 流程图、状态图、时序图、类图、ER 图、XY 图的常用语法 |
| 数学公式 | LaTeX 行内及块公式转为可编辑 Word 原生公式，覆盖分式、根式、上下标、向量、求和积分、矩阵、分段函数与对齐方程 |

图片相对源 Markdown 所在目录解析；直接传正文时，CLI 使用 `--asset-base-dir`，DSH 使用 `assetBaseDir` 指定相对图片目录。网络图片不会自动下载，SVG 输入不受支持。

Mermaid 使用本地轻量渲染器，不覆盖官方全部语法。支持流程图节点字号、节点/连线虚线和常用 init/YAML 主题配置；饼图、甘特图以及超出支持范围的配置和指令仍会触发未渲染警告。中文图表需要生成机器安装中文字体；宽图仍可能缩小到不易阅读，建议拆分。具体范围见 [图表参考](docs/agent-reference.md#mermaid-图表)。

数学公式使用 Temml 在本地解析，通过自有转换层生成 Word 原生公式，无需浏览器、字体图片或外部转换服务。支持 `$...$`、`\(...\)` 行内公式，以及独立块中的 `$$...$$`、`\[...\]`。不支持的结构或错误语法保留完整源码并报告 `MATH_NOT_CONVERTED`，严格模式拒绝保存。自定义宏、公式编号与引用等暂不支持，具体边界见 [公式参考](docs/agent-reference.md#数学公式)。

原始 HTML 按文本保留，有限的 `<!-- word:... -->` 排版指令另行解析。命名脚注转换为 Word 原生脚注，支持多段内容及重复引用；未定义、重复定义或嵌套脚注会保留内容并报告诊断。任务复选框仍按普通文本输出。

正文使用首行两字符的独立样式；列表换行与续段对齐正文，嵌套代码、图片和表格按容器宽度排版。独立图片居中、不带首行缩进，小图默认不放大；表格保留 Markdown 指定的左、中、右对齐，默认按内容估算列宽；可显式指定列宽比例、图题、列表续接和章节重启策略。用法及分页边界见 [文档排版说明](docs/document-layout.md)。

文内链接支持标题文字的小写片段：保留字母、数字、组合字符、下划线和连字符，空白替换为连字符，移除其他标点；重复标题追加 `-1`、`-2`。中文片段及 URL 编码片段可用，没有匹配标题时保留链接文字并报告 `LINK_UNAVAILABLE`。不支持自定义标题 ID。

## 先用样例体验

仓库提供可直接导出的样例，方便检查自己的内容和运行环境：

| 样例 | 用途 |
| --- | --- |
| [综合测试](fixtures/综合测试.md) | 标题、格式、列表、表格、四种图片、六类图表及人工验收清单 |
| [异常降级测试](fixtures/异常降级测试.md) | 缺图、损坏数据、不支持的图表与严格模式失败行为 |
| [分页编号与脚注](fixtures/分页编号与脚注.md) | 自适应列宽、分页、列表续接与章节重启、原生脚注 |
| [完整样式](fixtures/完整样式.md) | 集中查看中文正文、标题和列表排版 |
| [Mermaid 中文](fixtures/Mermaid中文.md) | 检查中文图表、长标签和混排效果 |
| [数学公式](fixtures/数学公式.md) | 检查原生公式、矩阵、中文条件及 Word 编辑效果 |
| [数学公式降级](fixtures/数学公式降级.md) | 检查公式原文保留、行号诊断及严格拒绝行为 |

样例与配套图片位于源码仓库，不包含在 npm 安装包中。使用综合样例时，请保留 `fixtures/assets/` 的相对目录结构。

将仓库放入当前项目后，可以直接告诉 Agent：

> 请使用已安装的 bruce-md2word 严格导出 fixtures/综合测试.md，返回实际文件路径和所有警告。随后对照源文件中的验收清单，说明哪些检查已经完成，哪些需要在 Word 中人工确认。

## 开发与验证

在 Node.js 24 或 26 下执行：

```sh
npm ci
npm run typecheck
npm test
npm run test:pack
npm run example
```

从源码导出综合样例：

```sh
npm run build
node lib/cli.js fixtures/综合测试.md --strict -o output/综合测试.docx
```

自动化测试覆盖转换内容、样式 XML、DSH 服务集成、资源限制、取消和独立安装包。Word 的实际分页、字体及视觉效果仍需人工检查，完整 Web/Desktop 交互验收也应单独进行。

[更新日志](CHANGELOG.md) · [自动化检查](https://github.com/bruc3van/bruce-md2word/actions) · [发布流程](docs/releasing.md)

## 许可证

采用 [MIT](LICENSE) 许可证。
