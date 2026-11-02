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

上面的完整结构展示了可选的详细分析字段。普通录入只保存单词、释义、英文原句、
中文翻译和词条级笔记 `notes`；个人例句的 `note`、`exampleTags`、`contextAnalysis`
以及 `grammarAnalysis` 中的内容保持为空。只有明确选择详细分析时才填写这些字段。

## 第一次部署

1. 在 GitHub 创建一个 **Public** 仓库，例如 `AI-Terminology`。
2. 把本项目推送到该仓库的 `main` 分支。
3. 打开仓库的 **Settings → Pages**，将 **Source** 设为 **GitHub Actions**。
4. 打开 **Actions → Deploy vocabulary site to GitHub Pages**，等待工作流成功。
5. 访问 `https://<你的用户名>.github.io/AI-Terminology/`。

仓库自带部署工作流。以后只要 `main` 分支有提交，Actions 会自动校验数据并重新发布。

## 用 DeepSeek 自动录入词汇

配置完成后，在电脑或手机上填写 GitHub 表单即可录入：

```text
提交单词和英文原句 → GitHub Actions 调用 DeepSeek
→ 检查并合并词库 → 提交到 main → 发布 GitHub Pages
```

### 首次配置

1. 将本项目的录入表单、脚本和工作流推送到仓库的 `main` 分支，确保 GitHub Actions
   已启用，并按上面的“第一次部署”完成 Pages 设置。
2. 在 DeepSeek 平台创建本项目专用的 API Key，确保账户可调用 API。
3. 打开仓库的 [Actions Secrets 设置](https://github.com/zhixingheyi666/AI-Terminology/settings/secrets/actions)，
   点击 **New repository secret**，名称填 `DEEPSEEK_API_KEY`，值填该 API Key。
   密钥只需要保存在这里，不要发到聊天、Issue、网页设置或提交到仓库。
4. 默认使用 `deepseek-flash`。如需更换模型，在同一设置区域的 **Variables** 页添加
   仓库变量 `DEEPSEEK_MODEL`，值为你的 DeepSeek 账户支持的模型名称。
5. 按下面步骤提交第一个真实词汇，检查 Actions 运行结果。仅添加文件不会完成密钥配置；
   未设置 `DEEPSEEK_API_KEY` 时，自动生成不能成功运行。

生成接口按 [DeepSeek JSON Output 文档](https://api-docs.deepseek.com/guides/json_mode/)
请求 JSON，并在保存前再次检查数据结构。API 调用使用你的 DeepSeek 账户额度。

### 日常使用

1. 使用仓库所有者账号登录 GitHub，打开 [词汇录入表单](https://github.com/zhixingheyi666/AI-Terminology/issues/new?template=vocabulary.yml)。
2. 保留标题开头的 `[词汇录入]`，填写 **单词**、**英文原句**，可选填写 **出处**。
3. **详细分析** 默认选“普通录入（不分析句子）”。只有选“详细分析（包含语法和语境）”
   才生成例句标签、语境说明和语法拆解。
4. 提交 Issue 后，在 [Actions](https://github.com/zhixingheyi666/AI-Terminology/actions)
   查看 `vocabulary.yml` 对应的运行进度和摘要。词库提交与 Pages 发布都成功后，
   打开 [词迹网站](https://zhixingheyi666.github.io/AI-Terminology/) 查看结果。

自动录入会保留提交的英文原句，生成中文翻译、英文与中文释义以及简短词汇笔记。
生成的释义标记为 **DeepSeek（AI 生成，待核对）**，不冒充词典原文，也不编造词典来源链接。
已有同名单词会合并新增例句和释义，保留原词条的创建时间、学习状态和已有笔记。
同一 Issue 已成功写入后，重复运行不会再次调用 API 或重复加入例句。

这个入口只允许仓库所有者触发；工作流和脚本会检查 Issue 作者及发起运行的账号。
它不会自动评论或关闭 Issue，处理状态以 Actions 的结果为准。当前仓库是公开仓库，
Issue 的单词、原句、出处和生成后的词库也会公开；不要在表单里填写私密内容或 API Key。

### 失败与重试

- 生成失败时，先在 Actions 日志中查看原因，检查密钥、账户额度和表单字段。
  修复后选择 **Re-run failed jobs**；也可以关闭后重新打开尚未成功录入的 Issue。
- 如果词库已提交、但网站发布失败，重跑失败的发布任务即可，不需要新建相同的 Issue。
- 如果同时在网页中编辑词库导致提交冲突，工作流会停止写入；取得最新版本后重新运行，
  不会强行覆盖其他设备的修改。
- 修改表单内容后，请关闭并重新打开 Issue 触发新请求；直接重跑会沿用原事件中的表单内容。
- 连续提交时，排队中的发布可能被更新的发布任务替换而显示“已取消”。如果摘要已显示词条
  保存成功，查看最新一次 Pages 部署即可；它会包含最新词库中已保存的全部词条。

录入工作流通过 GitHub 自带的 `GITHUB_TOKEN` 提交数据，再显式调用可复用的 `pages.yml`
发布。这里不能只等待 `push` 事件：由 `GITHUB_TOKEN` 产生的提交通常不会触发另一个工作流。
因此不需要为自动录入另外保存一个 GitHub 个人令牌。相关机制见
[GitHub 工作流触发说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。

## 在网页里编辑并同步

查询不需要登录。若要直接在网页中新增或修改词条，需要创建一个权限很小的
GitHub fine-grained personal access token：

1. 在 GitHub 的 **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens** 创建令牌。
2. **Repository access** 只选择这个词汇仓库。
3. **Permissions → Contents** 设为 **Read and write**。其他权限不需要。
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
│   └── generate-vocabulary.mjs # 解析表单、调用 DeepSeek、校验并合并词条
├── tests/
│   ├── model.test.mjs
│   └── generate-vocabulary.test.mjs
├── sw.js                   # 离线缓存
└── .github/
    ├── ISSUE_TEMPLATE/
    │   └── vocabulary.yml  # 跨设备词汇录入表单
    └── workflows/
        ├── pages.yml       # 校验并部署 GitHub Pages
        └── vocabulary.yml  # 仅所有者可触发的 DeepSeek 自动录入
```

首次打开会看到一条用于展示结构的 `grounding` 示例词条，可以直接删除或改成自己的记录。
