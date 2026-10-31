# 词迹 · AI 术语库

一个以 GitHub 为长期存储、以 GitHub Pages 为查询入口的个人英语术语库。

它不是简单的“单词 + 中文意思”，而是把以下内容组织在同一个词条里：

- 同一个词来自多本词典的解释；
- 每本词典自己的中英文例句和来源链接；
- 你真实遇到这个词的英文原句、翻译、出处、日期和当时的笔记；
- 标签、学习状态和补充辨析。

搜索会同时覆盖单词、所有释义、词典例句、你的原句、翻译、出处、标签和笔记。

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
          "note": "为什么这个词在这里值得记下来。"
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

## 第一次部署

1. 在 GitHub 创建一个 **Public** 仓库，例如 `AI-Terminology`。
2. 把本项目推送到该仓库的 `main` 分支。
3. 打开仓库的 **Settings → Pages**，将 **Source** 设为 **GitHub Actions**。
4. 打开 **Actions → Deploy vocabulary site to GitHub Pages**，等待工作流成功。
5. 访问 `https://<你的用户名>.github.io/AI-Terminology/`。

仓库自带部署工作流。以后只要 `main` 分支有提交，Actions 会自动校验数据并重新发布。

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
│   └── validate-data.mjs
├── tests/
│   └── model.test.mjs
├── sw.js                   # 离线缓存
└── .github/workflows/
    └── pages.yml           # 校验并部署 GitHub Pages
```

首次打开会看到一条用于展示结构的 `grounding` 示例词条，可以直接删除或改成自己的记录。
