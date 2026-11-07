# 词迹 · AI 术语库

一个以 GitHub 为长期存储、以 GitHub Pages 为查询入口的个人英语术语库。

它不是简单的“单词 + 中文意思”，而是把以下内容组织在同一个词条里：

- 同一个词来自多本词典的解释；
- 每本词典自己的中英文例句和来源链接；
- 英式、美式单词发音及例句朗读；
- 你真实遇到这个词的英文原句、翻译、出处、日期和当时的笔记；
- 主题标签、可筛选的例句标签、复习标签、学习状态和补充辨析；
- 例句级的断句结构、语法成分、核心主干、自然改写和语境分析；
- 更宽松的词条列表滚动，以及默认加大的释义与中文解释字号。

搜索会同时覆盖单词、所有释义、词典例句、你的原句、翻译、出处、标签和笔记。
词条列表按首次录入时间排列，最新录入的词条位于最上方；后续编辑不会改变这个顺序。

## 为什么适合跨设备使用

- **主数据是一个 JSON 文件**：`data/vocabulary.json`，容易备份、迁移和做版本比较。
- **任何浏览器都能查询**：部署后访问固定的 GitHub Pages 地址即可，不需要安装数据库。
- **可以跨设备编辑**：页面连接 GitHub 仓库后，每次保存都会创建一次 Git 提交。
- **变更可追溯**：Git 历史本身就是版本备份，误改时可以恢复旧提交。
- **不锁在浏览器里**：清空浏览器缓存不会删除 GitHub 上的词库；页面另有导入和完整导出。
- **离线可读**：首次打开后，静态页面和最近读取的数据会进入浏览器缓存。

## 数据组织

每个单词只建立一条词项。多个词典解释放进 `definitions` 数组，个人遇到的句子放进
`personalExamples` 数组。这样搜索一次，就能看到同一个词的全部语义和真实语境。

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-31T00:00:00.000Z",
  "entries": [
    {
      "id": "entry-uuid",
      "term": "grounding",
      "phonetic": "/ˈɡraʊndɪŋ/",
      "status": "learning",
      "tags": ["AI", "LLM"],
      "reviewTags": ["高频复习", "易混"],
      "definitions": [
        {
          "id": "definition-uuid",
          "dictionary": "词典名称",
          "partOfSpeech": "noun",
          "definitionEn": "英文解释",
          "definitionZh": "中文理解",
          "url": "https://example.com/grounding",
          "examples": [
            {
              "en": "A dictionary example.",
              "zh": "这个例句的翻译。"
            }
          ]
        }
      ],
      "personalExamples": [
        {
          "id": "encounter-uuid",
          "en": "The sentence you actually encountered.",
          "zh": "你当时对这个句子的翻译或理解。",
          "source": "文章标题、论文名、书或对话",
          "encounteredAt": "2026-10-31",
          "note": "为什么这个词在这里值得记下来。",
          "exampleTags": ["句法分析", "教材例句"],
          "contextAnalysis": "这个词在句法和专业知识中的具体作用。",
          "grammarAnalysis": {
            "structure": "较长的句子可以在这里分行展示。",
            "parts": [
              {
                "label": "句子成分",
                "explanation": "该成分的语法作用和中文解释。"
              }
            ],
            "core": "去掉修饰成分后的核心主干。",
            "rewrite": "可选的更自然表达。"
          }
        }
      ],
      "notes": "辨析、联想或待解决的问题。",
      "createdAt": "2026-10-31T00:00:00.000Z",
      "updatedAt": "2026-10-31T00:00:00.000Z"
    }
  ]
}
```

`status` 只使用三个值：`learning`（学习中）、`review`（待复习）、`mastered`（已掌握）。
`reviewTags` 是独立的复习标签，可以使用“主题句复习”“易混”“高频”等自由组合；
左侧“复习标签”按钮会只显示带有复习标签的词条。

左侧标签筛选默认显示单词的 `tags`。点击“例句标签”后，会改为显示所有
`personalExamples[].exampleTags`，并只保留包含所选例句标签的词条。

发音优先使用在线词典音频，浏览器无法取得音频时会回退到系统语音合成。
例句朗读使用浏览器提供的英语语音；新版 Chrome、Edge 和 Safari 通常已经内置。

上面的结构展示了详细模式的可选字段。普通模式保留整句翻译与标签，断句、
成分和语境解读由详细模式填写。

## 第一次部署

1. 在 GitHub 创建一个 **Public** 仓库，例如 `AI-Terminology`。
2. 把本项目推送到该仓库的 `main` 分支。
3. 打开仓库的 **Settings → Pages**，将 **Source** 设为 **GitHub Actions**。
4. 打开 **Actions → Deploy vocabulary site to GitHub Pages**，等待工作流成功。
5. 访问 `https://<你的用户名>.github.io/AI-Terminology/`。

仓库自带部署工作流。以后只要 `main` 分支有提交，Actions 会自动校验数据并重新发布。

## 在网页中批量录入

1. 在[词迹](https://zhixingheyi666.github.io/AI-Terminology/)点「＋」。输入多个目标词，并粘贴它们共用的原句。一次最多录 8 个词，空格、逗号、分号、顿号和换行都可分词。用双引号包住短语，例如 `token, predict, "language model"`。
2. 输入框下方会显示收录情况。已有词默认跳过，可选择补充本次语境；同一句已收录时也会提示。全部跳过就不会调用 AI。点「自动填写」后，普通模式的原文部分只有整句翻译。详细模式增加断句、成分、主干、改写和语境说明。两种模式都会生成词条笔记、标签、复习标签和双语例句。
3. 在同一张表单里核对共享原文、翻译和各词的资料。词典卡首先显示最贴近原句的义项，旁边的「本句用法」解释这个词在原句里的意思。随后列出常用基本义、最多两个其他常见义项，其余可展开。首义也是基本义时只展示一次。英文释义取自词典，义项选择和中文解读取自 AI。DeepSeek 的原创释义和例句另列来源。
4. 修改后点击「保存全部」。整批词合并为一次词库更新，已有词条沿用原 ID 和首次录入日期。

词形提示使用随站点提供的 Open English WordNet 2025 索引。只有一个确定原形时会自动选中，如 `statisticians → statistician`；`saw`、`running` 等同时有独立词义或其他原形时，由你选择。按选定原形查询和去重，原句保留输入词形及「名词复数」「过去式 / 过去分词」等说明，草稿中可修改说明。同批多个变化形式归到同一原形时只生成一条，保留各个词形。词形本身不能唯一确定句中时态，`-ing` 不直接等同于进行时。

旧词条若以复数等形式为词头，也会匹配经过词典验证且无歧义的原形。默认跳过，明确选择「归为原形并补充语境」并保存后，沿用原词条 ID、首次录入日期及既有资料。不会批量修改旧词库。大小写、空格、连字符变体以及仅排版不同的重复原句也会去重。

一批词中只有部分生成成功时，页面列出待补录的词。可以先保存成功项，也可以只补录缺词，再一起保存。原句、出处和已经修改过的草稿会随补录保留。程序按选定的目标词匹配结果；词典没有对应语境时，会分别标明词典通用义和 AI 对原句的解读。

已有原句的旧词条可从详情页点「补全词典义项」，核对后保存。后台优先使用查到的 Wiktionary 义项，在线查询无结果时会用随项目提供的 Open English WordNet 2025 查询。

### 一次性配置

- 在仓库的 [Actions Secrets 设置](https://github.com/zhixingheyi666/AI-Terminology/settings/secrets/actions) 保存 `DEEPSEEK_API_KEY`，确保账户可调用 DeepSeek API。可选仓库变量 `DEEPSEEK_MODEL` 用于更换模型，默认 `deepseek-flash`。
- 在词迹右上角的同步设置中填写仓库所有者的 GitHub 令牌，权限见下节。DeepSeek 密钥只需保存在 GitHub Actions。
- 自动填写会把本次目标词、原句和出处交给 GitHub Actions 与 DeepSeek 处理，并向词典服务查询目标词。草稿通过加密的运行结果传回发起请求的页面。生成期间请保持页面打开；刷新后需重新生成。保存后，公开词库中的内容可被他人查看。

## 在网页里编辑并同步

查询不需要登录。若要直接在网页中新增或修改词条，需要创建一个权限很小的
GitHub fine-grained personal access token：

1. 在 GitHub 的 **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens** 创建令牌。
2. **Repository access** 只选择这个词汇仓库。
3. **Permissions → Contents** 设为 **Read and write**。私有仓库另需 **Checks → Read**。
4. 在词迹页面点击右上角齿轮，填写仓库信息和令牌，然后测试连接并保存。
5. 新建或修改词条后，页面会直接向 `data/vocabulary.json` 创建一个提交。

令牌只保存在当前浏览器，不会写进仓库。公共或共享电脑不要勾选“记住令牌”。
如果另一台设备也有令牌，可以同样编辑；无令牌设备仍可正常查询和导出。

没有令牌时，编辑内容会先保存在当前浏览器，并把顶部状态标记为“待连接 GitHub”。
此时应该导出 JSON 备份，再配置令牌完成提交，避免只依赖浏览器缓存。

## 同步冲突

如果两台设备都修改了词库，页面会拒绝覆盖 GitHub 上较新的版本，并保留本机修改。
处理方式是：

1. 先点击左侧“导出备份”，保存本机未提交的 JSON；
2. 刷新页面取得 GitHub 最新版；
3. 对比或人工合并两个 JSON；
4. 通过页面导入合并后的文件，或用 Git 提交它。

这是有意的安全限制。普通词典查询永远不会触发写入。

## 数据备份与恢复

- 页面左下角“导出备份”会下载完整的 JSON 文件。
- “导入数据”会用备份替换当前词库，并尝试同步到 GitHub。
- GitHub 仓库本身保留每次提交，可以在 GitHub 的提交历史中恢复。
- 不建议只保留浏览器缓存作为唯一备份。

## 本地预览

项目没有第三方运行时依赖。用任意静态文件服务器打开根目录即可：

```powershell
python -m http.server 8000
```

然后访问 `http://localhost:8000/`。不要直接双击 `index.html`，因为浏览器通常会阻止
页面读取本地 JSON 文件。

运行检查：

```powershell
node scripts/validate-data.mjs
node --test
```

## 隐私与 GitHub Pages 限额

GitHub Free 可以使用 GitHub Pages 托管 **公开仓库**。标准个人词库无需单独支付 Pages
费用，但有官方使用限制（截至 2026-10-31）：

- 发布站点最大 1 GB；
- Pages 源仓库建议不超过 1 GB；
- 每月约 100 GB 软带宽限制；
- 默认构建每小时 10 次软限制；自定义 Actions 工作流不受这一条限制；
- 单次部署超过 10 分钟会超时。

这些额度远超个人词典查阅所需。注意：免费方案下，仓库和词库数据是公开的。
如果个人例句不适合公开，需要使用 GitHub Pro、Team 或 Enterprise 的私有仓库方案；
是否允许限制站点访问还取决于具体的 GitHub 方案。正式选择前请核对官方页面：

- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [GitHub plans](https://github.com/pricing)

公开仓库意味着任何人都能查看 `data/vocabulary.json`。不要在例句或笔记中写入密码、
私人联系方式、公司机密或其他敏感信息。

## 项目结构

```text
.
├── index.html
├── assets/
│   ├── app.js              # 搜索、编辑、同步和界面交互
│   ├── model.js            # 数据规范、校验和搜索
│   └── styles.css
├── data/
│   └── vocabulary.json     # 唯一需要长期维护的词汇数据
├── scripts/
│   ├── validate-data.mjs
│   └── generate-draft.mjs  # 查询词典并生成可编辑的学习草稿
├── tests/
│   ├── model.test.mjs
│   └── generate-vocabulary.test.mjs
├── sw.js                   # 离线缓存
└── .github/
    └── workflows/
        ├── pages.yml       # 校验并部署 GitHub Pages
        └── draft.yml       # 仅所有者可触发的网页草稿生成
```

首次打开会看到一条用于展示结构的 `grounding` 示例词条，可以直接删除或改成自己的记录。
