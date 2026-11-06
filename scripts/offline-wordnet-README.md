# Open English WordNet 2025 离线词典

这是官方 WNDB 数据的精简索引，用于联网词典临时不可用或未命中时，在 GitHub Actions
内提供可核验的英语义项。运行时只使用 Node.js 22 内置库，不联网、不依赖第三方包。
压缩数据仅保存在 `scripts/`，不会进入 `assets/`、词库 `data/` 或网站 `_site/`。

来源是 [Open English WordNet 2025 官方下载](https://en-word.net/downloads)，
[官方源码 2025 发布标签](https://github.com/globalwordnet/english-wordnet/tree/2025-edition)。
原始 WNDB ZIP 为 `https://en-word.net/downloads/english-wordnet-2025.zip`，大小
9,616,299 字节，SHA-256：

```text
38b16326159f51853626b7d24a44c453fa88ab33f06fce5ec8fc5996d1c2be93
```

随包保留官方许可原文 `offline-wordnet-LICENSE.txt` 和 `offline-wordnet-WNDB-LICENSE.txt`。
它们固定取自官方 2025 标签提交 `dc343f2683279ecbb13fab4e2fd778d7b162d287`。
数据署名：Open English WordNet team；基于 Princeton WordNet；CC BY 4.0。
压缩索引的变更仅是格式转换：移除语义关系指针等未使用字段，按 lemma 组织查找，保留
原始英语释义、例句、各词性内的义项顺序及官方异常词形表。没有把 AI 文字混入词典。
英语释义与例句取自词典；本项目另行生成的中文翻译应继续标注为 AI 翻译。

## 复现生成

在项目根目录运行（Node.js 22）：

```powershell
node scripts/build-offline-wordnet.mjs
```

或先从官方下载 ZIP，再离线生成：

```powershell
node scripts/build-offline-wordnet.mjs C:\Downloads\english-wordnet-2025.zip
```

脚本校验固定下载哈希和许可哈希，读取 ZIP 内的 12 个固定 WNDB 成员，不执行其中代码，
也不把任意 ZIP 路径释放到磁盘。输出 `offline-wordnet-2025.json.gz` 及
`offline-wordnet-manifest.json`；gzip 不写当前时间，因此相同输入与 Node.js 版本可复现。
清单记录压缩文件哈希、字节数、lemma 和 synset 数量，运行时也会校验压缩文件完整性。

## 使用及范围

```javascript
import { lookupOfflineWordnet } from "./offline-wordnet.mjs";
const senses = await lookupOfflineWordnet("schemes");
```

精确词形在前，同时提供官方异常词形表和经过实际词条校验的常用复数、时态、比较级
候选。例如 `grasping` 既保留自身词条，也提供动词 `grasp` 的义项供判断当前语境。
词形规则验证了真实 lemma/词性后，也保留同一个 lemma 的其他真实词性义项；匹配词形的
词性优先，例如 `grasp` 的动词义先于它的名词义，便于同时展示语境义和常见基本义。
没有匹配项返回空数组。同一 lemma 的义项使用同一个官方词页 URL，附带每个词性
内的 `senseNumber` 和版本特定 WNDB 标识供区分；该标识不冒充远端 synset ID。
WNDB 不含可靠音标，`phonetic` 保持空字符串。它是英英 lexical database，不是完整英汉
学习词典；义项不一定都有例句，也不保证收录新兴技术术语。
