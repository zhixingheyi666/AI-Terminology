import {
  STATUS_LABELS, createDefinition, createDefinitionExample, createGrammarAnalysis,
  createGrammarPart, normalizeSearch, normalizeTags,
} from "./model.js?v=1.4.2";
import { checkDraftCoverage } from "./draft-client.js?v=1.4.2";
import { hasEncounter, termKey } from "./draft-library.js?v=1.4.2";
import { findWordFormMatch, loadWordFormIndex, resolveWordForms } from "./word-forms.js?v=1.4.2";

const separators = /[\s,，、;；]/u;

export function parseTargetTerms(text) {
  const terms = [];
  const seen = new Set();
  let current = "";
  let closingQuote = "";
  function finishTerm() {
    const term = current.trim();
    current = "";
    if (!term) return;
    if (term.length > 120) throw new Error("每个目标词或短语最多 120 个字符。");
    const key = termKey(term);
    if (!seen.has(key)) terms.push(term);
    seen.add(key);
  }
  for (const char of text) {
    if (closingQuote) {
      if (char === closingQuote) {
        closingQuote = "";
        finishTerm();
      } else current += char;
    } else if (char === '"' || char === "“") {
      finishTerm();
      closingQuote = char === "“" ? "”" : char;
    } else if (separators.test(char)) {
      finishTerm();
    } else current += char;
  }
  if (closingQuote) throw new Error("短语的双引号尚未闭合。");
  finishTerm();
  if (!terms.length) throw new Error("请填写至少一个目标词。");
  if (terms.length > 8) throw new Error("一次最多填写 8 个不同的目标词。");
  return terms;
}

export function chooseWordForm(term, candidates, selectedLemma) {
  const lemmas = [...new Set(candidates.map(item => item.lemma))];
  const lemma = selectedLemma ?? (lemmas.length === 1 ? lemmas[0] : term);
  if (termKey(lemma) === termKey(term)) return null;
  const matches = candidates.filter(item => item.lemma === lemma && item.form !== "base");
  if (!matches.length) return null;
  return { text: term, lemma, label: [...new Set(matches.map(item => item.label))].join(" / ").slice(0, 150) };
}

export function buildIntakePlan({ terms, sentence, library, choices = new Map(), forms = new Map(), wordFormIndex }) {
  const items = terms.map(term => {
    const wordForm = forms.get(termKey(term));
    const lookupTerm = wordForm?.lemma || term;
    const key = termKey(lookupTerm);
    const match = findWordFormMatch(library, lookupTerm, wordFormIndex);
    const sameSentence = Boolean(match.entry && hasEncounter(match.entry, sentence));
    const action = match.kind === "new" ? "new" : match.kind === "ambiguous" ? "blocked"
      : choices.get(key) === match.entry.id ? "update" : "skip";
    return { term, lookupTerm, wordForm, key, match, sameSentence, action };
  });
  const selected = [...new Map(items.filter(item => item.action === "new" || item.action === "update")
    .map(item => [item.key, item])).values()];
  const wordFormsByTerm = Object.create(null);
  for (const selectedItem of selected) {
    wordFormsByTerm[normalizeSearch(selectedItem.lookupTerm)] = items.filter(item => item.key === selectedItem.key && item.wordForm)
      .map(item => item.wordForm);
  }
  return { items, terms: selected.map(item => item.lookupTerm),
    existingEntryIds: selected.map(item => item.match.entry?.id || ""), wordFormsByTerm };
}

// Consent to updating an existing word is tied to its ID, never just its spelling.
export function assertIntakeTargets(library, terms, existingEntryIds, wordFormIndex) {
  if (!Array.isArray(existingEntryIds) || terms.length !== existingEntryIds.length) {
    throw new Error("录入选择已失效，请返回输入框重新检查。");
  }
  terms.forEach((term, index) => {
    const match = findWordFormMatch(library, term, wordFormIndex);
    const expectedId = existingEntryIds[index];
    if (match.kind === "ambiguous" || (expectedId ? match.entry?.id !== expectedId : match.kind !== "new")) {
      throw new Error("「" + term + "」的已有词条或录入选择已变化，请返回输入框重新检查后生成。");
    }
  });
}

function formatTerm(term) {
  return separators.test(term) ? '"' + term + '"' : term;
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function action(label, handler, accessibleLabel = label) {
  const button = el("button", "link-button", label);
  button.type = "button";
  button.setAttribute("aria-label", accessibleLabel);
  button.addEventListener("click", handler);
  return button;
}

// Editable values are assigned as DOM properties, including text from APIs.
function field(label, target, key, { rows, options, tags, type = "text", wide, readOnly, update } = {}) {
  const wrapper = el("label", wide ? "field field-span-2" : "field");
  wrapper.append(el("span", "", label));
  const control = el(options ? "select" : rows ? "textarea" : "input");
  if (options) {
    for (const [value, name] of Object.entries(options)) control.add(new Option(name, value));
  } else if (rows) control.rows = rows;
  else control.type = type;
  control.value = tags ? (target[key] || []).join(", ") : target[key] || "";
  if (tags) control.placeholder = "多个标签用逗号分隔";
  if (readOnly) control.readOnly = true;
  control.addEventListener(options ? "change" : "input", () => {
    target[key] = tags ? normalizeTags(control.value.replace(/、/g, ",")) : control.value;
    update?.(target[key]);
  });
  wrapper.append(control);
  return wrapper;
}

function grid(...children) {
  const result = el("div", "field-grid");
  result.append(...children);
  return result;
}

function editableList(title, items, createItem, renderItem, addText) {
  const section = el("section", "intake-stack");
  const list = el("div", "dynamic-list");
  const header = el("div", "intake-repeat-head");
  const add = action(addText, () => {
    const item = createItem();
    items.push(item);
    appendItem(item).querySelector("input, textarea")?.focus();
  });
  header.append(el("h4", "intake-subheading", title), add);
  function appendItem(item) {
    const remove = action("移除", () => {
      items.splice(items.indexOf(item), 1);
      node.remove();
      add.focus();
    }, "移除" + title + "中的这一项");
    const node = renderItem(item, remove);
    list.append(node);
    return node;
  }
  items.forEach(appendItem);
  section.append(header, list);
  return section;
}

function pair(firstField, secondField, remove) {
  const row = el("div", "intake-pair");
  row.append(firstField, secondField, remove);
  return row;
}

export function orderedDefinitions(definitions) {
  if (!definitions.some(definition => definition.senseGuide)) return definitions;
  const rank = definition => definition.senseGuide ? 0 : /deepseek|AI\s*生成/iu.test(definition.dictionary) ? 2 : 1;
  return [...definitions].sort((a, b) => rank(a) - rank(b));
}

// The leading sense is already stored on the definition itself.
export function groupGuideSenses(definition) {
  const guide = definition.senseGuide;
  const key = sense => {
    const gloss = normalizeSearch(sense.definitionEn || sense.definitionZh);
    return gloss ? normalizeSearch(sense.partOfSpeech) + "\n" + gloss : "";
  };
  const primaryKey = key(definition);
  const seen = new Set([primaryKey]);
  const basic = [], common = [], other = [];
  let alsoBasic = guide.alsoBasic;
  for (const sense of guide.senses) {
    const id = key(sense);
    if (id === primaryKey && sense.role === "basic") alsoBasic = true;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (sense.role === "basic") basic.push(sense);
    else if (sense.role === "common") common.push(sense);
    else other.push(sense);
  }
  return { basic, common: common.slice(0, 2), more: [...common.slice(2), ...other], alsoBasic };
}

function senseText(sense, editable, primary = false) {
  const block = el("div", "sense-text");
  for (const [key, label, cls] of [
    ["partOfSpeech", "词性", "part-of-speech"], ["definitionEn", "英文释义", "definition-en"],
    ["definitionZh", "中文释义", "definition-zh"],
  ]) {
    if (editable) {
      const item = field(label, sense, key, key === "partOfSpeech" ? {} : { rows: 2 });
      if (primary) item.lastElementChild.dataset.definitionField = key;
      block.append(item);
    } else if (sense[key]) block.append(el("p", cls, sense[key]));
  }
  return block;
}

// Detail view and both editors follow the same sense order. API text never becomes HTML.
export function senseGuidePanel(definition, { editable = false } = {}) {
  const guide = definition.senseGuide;
  const { basic, common, more, alsoBasic } = groupGuideSenses(definition);
  const section = el("div", "sense-guide" + (editable ? " sense-guide-editor" : ""));
  const firstRow = el("div", "sense-overview");
  const primary = el("section", "sense-primary");
  const title = guide.fit === "contextual" ? "本句最相关的词典义项" : "词典通用义项";
  primary.append(el("h4", "sense-heading", title));
  if (alsoBasic) primary.append(el("span", "sense-basic-note", "亦为基本义"));
  primary.append(senseText(definition, editable, true));
  firstRow.append(primary);
  if (editable || guide.usage || guide.sentence) {
    const usage = el("section", "sense-usage");
    const heading = el("h4", "sense-heading", "本句用法");
    heading.append(el("small", "sense-usage-credit", "AI 辅助解读"));
    usage.append(heading);
    if (guide.sentence) usage.append(el("blockquote", "sense-sentence", guide.sentence));
    if (editable) usage.append(field("用法说明", guide, "usage", { rows: 3 }));
    else if (guide.usage) usage.append(el("p", "sense-usage-text", guide.usage));
    firstRow.append(usage);
  }
  section.append(firstRow);

  function addGroup(group, label, collapsed = false) {
    if (!group.length) return;
    const wrap = el(collapsed ? "details" : "section", "sense-group");
    wrap.append(el(collapsed ? "summary" : "h4", "sense-heading", label));
    function showItems() {
      const list = el("ol", "sense-list");
      for (const sense of group) {
        const row = el("li");
        row.append(senseText(sense, editable));
        list.append(row);
      }
      wrap.append(list);
    }
    if (collapsed) {
      // A large entry can have hundreds of senses. Build their fields on demand.
      wrap.addEventListener("toggle", () => { if (wrap.open && !wrap.querySelector("ol")) showItems(); });
    } else showItems();
    section.append(wrap);
  }
  addGroup(basic, "常用基本义");
  addGroup(common, "其他常见义");
  addGroup(more, "其余 " + more.length + " 个义项", true);
  return section;
}

function sourceCard(definition, remove) {
  const isAI = !definition.senseGuide && /deepseek|AI\s*生成/iu.test(definition.dictionary);
  const card = el("section", "intake-source intake-stack" + (isAI ? " intake-source-ai" : ""));
  const header = el("div", "intake-repeat-head");
  header.append(el("strong", "", isAI ? "AI 释义" : "词典释义"), remove);
  const name = field("来源名称", definition, "dictionary", { readOnly: isAI });
  const url = field("来源网址", definition, "url", { type: "url", wide: !definition.senseGuide });
  if (definition.senseGuide) {
    card.append(header, grid(name, url), senseGuidePanel(definition, { editable: true }));
  } else {
    card.append(header, grid(name, field("词性", definition, "partOfSpeech"), url,
      field("英文释义", definition, "definitionEn", { rows: 3 }),
      field("中文释义", definition, "definitionZh", { rows: 3 })));
  }
  card.append(editableList("来源例句", definition.examples, createDefinitionExample,
    (example, removeExample) => pair(field("英文例句", example, "en", { rows: 2 }),
      field("中文翻译", example, "zh", { rows: 2 }), removeExample), "添加例句"));
  return card;
}

function grammarEditor(grammar) {
  const section = el("section", "intake-stack");
  section.append(el("h3", "intake-subheading", "共享语法分析"),
    field("断句结构", grammar, "structure", { rows: 3 }),
    editableList("句子成分", grammar.parts, createGrammarPart,
      (part, remove) => pair(field("成分", part, "label"), field("说明", part, "explanation", { rows: 2 }), remove),
      "添加成分"),
    grid(field("句子主干", grammar, "core", { rows: 2 }), field("自然改写", grammar, "rewrite", { rows: 2 })));
  return section;
}

function entryCard(entry, detailed, index, existing = false) {
  const example = entry.personalExamples[0];
  const card = el("details", "intake-draft");
  card.open = index === 0;
  const summary = el("summary");
  const headword = el("strong", "", entry.term);
  summary.append(headword);
  summary.append(el("span", "intake-entry-action", existing ? "补充已有词条" : "新词条"));
  const body = el("div", "intake-draft-body intake-stack");
  if (example.wordForms?.length) {
    body.append(editableList("原句词形 → 词条原形", example.wordForms,
      () => ({ text: "", lemma: entry.term, label: "" }),
      (wordForm, remove) => pair(field("原句词形", wordForm, "text"),
        field("形式说明", wordForm, "label"), remove), "添加词形记录"));
  }
  body.append(grid(
    field("目标词", entry, "term", { update: value => { headword.textContent = value || "未填写目标词"; } }),
    field("音标", entry, "phonetic"),
    field("学习状态", entry, "status", { options: STATUS_LABELS }),
    field("主题标签", entry, "tags", { tags: true }),
    field("复习标签", entry, "reviewTags", { tags: true }),
    field("这条原句的主题标签", example, "exampleTags", { tags: true }),
    field("词汇笔记", entry, "notes", { rows: 2, wide: true }),
  ));
  if (detailed) {
    body.append(grid(field("这个词在原句中的作用", example, "contextAnalysis", { rows: 3 }),
      field("个人例句笔记", example, "note", { rows: 3 })));
  }
  body.append(editableList("释义来源", entry.definitions, createDefinition, sourceCard, "添加来源"));
  card.append(summary, body);
  return card;
}

export function prepareDraft(result, request) {
  const { successfulTerms, missingTerms } = checkDraftCoverage(result, request.terms);
  const entries = structuredClone(result.entries);
  for (const entry of entries) {
    if (entry.personalExamples?.length !== 1 ||
        !Array.isArray(entry.definitions) || !entry.personalExamples[0]?.zh?.trim()) {
      throw new Error("返回的词条或例句不完整，请重新生成。");
    }
    entry.definitions = orderedDefinitions(entry.definitions);
    const forms = request.wordFormsByTerm?.[normalizeSearch(entry.term)];
    if (Array.isArray(forms) && forms.length) entry.personalExamples[0].wordForms = structuredClone(forms);
  }
  const first = entries[0].personalExamples[0];
  const selectedIds = new Map(request.terms.map((term, index) => [normalizeSearch(term), request.existingEntryIds?.[index] || ""]));
  return {
    entries, detailed: request.detailed, warnings: result.warnings, saveTarget: result.saveTarget,
    requestedTerms: [...request.terms], successfulTerms, missingTerms,
    existingEntryIds: successfulTerms.map(term => selectedIds.get(normalizeSearch(term))),
    skippedTerms: request.skippedTerms || [],
    requestedWordForms: request.wordFormsByTerm || {},
    shared: { en: request.sentence, zh: first.zh, source: request.source,
      encounteredAt: first.encounteredAt, grammarAnalysis: createGrammarAnalysis(first.grammarAnalysis) },
  };
}

export function mergeRepair(previous, repaired) {
  if (previous.saveTarget !== repaired.saveTarget) throw new Error("仓库已切换，不能合并两次草稿。请返回原仓库或重新生成全部词条。");
  if (previous.detailed !== repaired.detailed || previous.shared.en !== repaired.shared.en ||
      previous.shared.source.trim() !== repaired.shared.source.trim()) throw new Error("两次草稿的输入不同，无法合并。");
  const wanted = new Set(previous.missingTerms.map(normalizeSearch));
  if (repaired.requestedTerms.some(term => !wanted.has(normalizeSearch(term)))) {
    throw new Error("补录结果包含不在待补录清单中的词。");
  }
  // Use the submitted terms as identities. The displayed headwords may already be edited.
  const byTerm = new Map();
  const idsByTerm = new Map();
  for (const batch of [previous, repaired]) {
    batch.successfulTerms.forEach((term, index) => byTerm.set(normalizeSearch(term), batch.entries[index]));
    batch.successfulTerms.forEach((term, index) => idsByTerm.set(normalizeSearch(term), batch.existingEntryIds?.[index] || ""));
  }
  const successfulTerms = previous.requestedTerms.filter(term => byTerm.has(normalizeSearch(term)));
  return { ...previous, successfulTerms, entries: successfulTerms.map(term => byTerm.get(normalizeSearch(term))),
    existingEntryIds: successfulTerms.map(term => idsByTerm.get(normalizeSearch(term))),
    missingTerms: previous.requestedTerms.filter(term => !byTerm.has(normalizeSearch(term))),
    warnings: [...new Set([...previous.warnings, ...repaired.warnings])] };
}

function renderReview(container, draft, beginRepair) {
  const { shared, detailed, entries, warnings } = draft;
  container.replaceChildren();
  if (draft.skippedTerms?.length) container.append(el("p", "intake-skipped", "本次已跳过：" + draft.skippedTerms.join("、")));
  if (draft.missingTerms.length) {
    const summary = el("section", "intake-partial");
    summary.setAttribute("aria-label", "部分词条待补录");
    summary.append(el("strong", "", "已生成 " + entries.length + " / " + draft.requestedTerms.length + " 个词条"),
      el("p", "", "待补录 " + draft.missingTerms.length + " 个：" + draft.missingTerms.join("、")),
      action("只补录缺少的词", beginRepair));
    container.append(summary);
  }
  if (warnings.length) {
    const list = el("ul", "intake-warnings");
    list.setAttribute("aria-label", "生成提示");
    warnings.forEach(text => list.append(el("li", "", text)));
    container.append(list);
  }
  const cards = el("section", "form-section intake-stack");
  const sharedEditor = el("section", "form-section form-section-personal intake-stack");
  sharedEditor.append(el("h3", "intake-subheading", "共用例句"),
    field("英文原句", shared, "en", { rows: 3, update: value => {
      cards.querySelectorAll(".sense-sentence").forEach(quote => { quote.textContent = value; });
    } }), field("中文翻译", shared, "zh", { rows: 2 }),
    grid(field("出处", shared, "source"), field("遇见日期", shared, "encounteredAt", { type: "date" })));
  if (detailed) sharedEditor.append(grammarEditor(shared.grammarAnalysis));
  cards.append(el("h3", "intake-subheading", "词条草稿 · " + entries.length));
  entries.forEach((entry, index) => cards.append(entryCard(entry, detailed, index, Boolean(draft.existingEntryIds?.[index]))));
  container.append(sharedEditor, cards);
}

export function entriesForSave(draft) {
  const { shared, detailed } = draft;
  if (!shared.en.trim() || !shared.zh.trim()) throw new Error("请补全共享的英文原句和中文翻译。");
  const seen = new Set();
  const entries = structuredClone(draft.entries);
  for (const entry of entries) {
    entry.term = entry.term.trim();
    const key = termKey(entry.term);
    if (!key || entry.term.length > 120) throw new Error("请填写 1 至 120 个字符的目标词。");
    if (seen.has(key)) throw new Error("草稿中有重复的目标词，请修改后再保存。");
    seen.add(key);
    if (!entry.definitions.length || entry.definitions.some(def => !def.dictionary.trim() ||
        !(def.definitionEn.trim() || def.definitionZh.trim()))) {
      throw new Error("请为「" + entry.term + "」补全来源名称和释义。");
    }
    for (const definition of entry.definitions) {
      if (definition.senseGuide) definition.senseGuide.sentence = shared.en;
      if (!definition.url.trim()) continue;
      if (!URL.canParse(definition.url) || !["https:", "http:"].includes(new URL(definition.url).protocol)) {
        throw new Error("请检查「" + entry.term + "」的来源网址，使用包含 https:// 或 http:// 的完整地址。");
      }
    }
    const example = entry.personalExamples[0];
    if (example.wordForms) example.wordForms = example.wordForms.map(item => ({ ...item, lemma: entry.term }));
    Object.assign(example, shared, { grammarAnalysis: detailed ? createGrammarAnalysis(shared.grammarAnalysis) : createGrammarAnalysis() });
    if (!detailed) {
      example.note = "";
      example.contextAnalysis = "";
    }
  }
  return entries;
}

export function createIntakeUI({ generate, save, openSettings, getLibrary, getLibraryKey }) {
  const dialog = document.getElementById("intakeDialog");
  const find = id => dialog.querySelector("#intake" + id);
  const form = find("Form");
  const controls = form.elements;
  const inputPanel = find("Inputs");
  const reviewPanel = find("Review");
  const progress = find("Progress");
  const submit = find("Submit");
  const stop = find("Stop");
  const back = find("Back");
  const revise = find("Revise");
  const duplicates = find("Duplicates");
  const choices = new Map();
  const formChoices = new Map();
  let wordFormIndex = null;
  let loadingForms = null;
  let formLoadFailed = false;
  let carriedForms = {};
  let libraryKey = "";
  let plan = null;
  let draft = null;
  let review = false;
  let saving = false;
  let pending = null;
  let editedDraft = false;
  let repairing = false;
  let initial = { terms: "", sentence: "", source: "", detailed: false };

  function updateDuplicates() {
    const key = getLibraryKey();
    if (libraryKey !== key) {
      choices.clear();
      formChoices.clear();
      carriedForms = {};
      libraryKey = key;
    }
    duplicates.replaceChildren();
    plan = null;
    duplicates.hidden = !controls.terms.value.trim();
    if (duplicates.hidden) return;
    const library = getLibrary();
    if (!library) {
      duplicates.append(el("p", "", "词库尚未读取完成，读取后会自动检查是否已收录。"));
      return;
    }
    let terms;
    try { terms = parseTargetTerms(controls.terms.value); }
    catch (error) {
      duplicates.append(el("p", "", error.message));
      return;
    }
    if (!wordFormIndex && !formLoadFailed) {
      duplicates.append(el("p", "", "正在检查词形和已有词条…"));
      return;
    }
    const forms = new Map();
    const candidatesByTerm = new Map();
    for (const term of terms) {
      const candidates = wordFormIndex ? resolveWordForms(term, wordFormIndex) : [];
      candidatesByTerm.set(term, candidates);
      const chosen = chooseWordForm(term, candidates, formChoices.get(termKey(term)));
      if (chosen) forms.set(termKey(term), chosen);
    }
    plan = buildIntakePlan({ terms, sentence: controls.sentence.value, library, choices, forms, wordFormIndex });
    if (formLoadFailed) duplicates.append(el("p", "intake-match-note", "词形表暂时未能读取，当前按输入拼写检查。可稍后重新打开录入框重试。"));
    for (const item of plan.items) {
      const row = el("div", "intake-match");
      const info = el("div", "intake-match-info");
      info.append(el("strong", "", item.term));
      const candidates = candidatesByTerm.get(item.term);
      const alternatives = [...new Set(candidates.map(candidate => candidate.lemma))]
        .filter(lemma => termKey(lemma) !== termKey(item.term));
      if (alternatives.length && !repairing) {
        const formSelect = el("select", "intake-match-choice");
        formSelect.setAttribute("aria-label", item.term + " 的词条原形");
        formSelect.dataset.surfaceKey = termKey(item.term);
        formSelect.add(new Option("保留输入词形 " + item.term, item.term));
        for (const lemma of alternatives) {
          const form = chooseWordForm(item.term, candidates, lemma);
          formSelect.add(new Option("→ " + lemma + "（" + form.label + "）", lemma));
        }
        formSelect.value = item.lookupTerm;
        formSelect.addEventListener("change", () => {
          formChoices.set(termKey(item.term), formSelect.value);
          updateDuplicates();
          refresh();
          [...duplicates.querySelectorAll("select")].find(node => node.dataset.surfaceKey === termKey(item.term))?.focus();
        });
        info.append(formSelect);
        if (!item.wordForm) info.append(el("span", "intake-match-note", "有不同词义或原形，请按本句用法选择。"));
      }
      if (item.match.kind === "new") info.append(el("span", "intake-match-note", "新词 · 将录入"));
      else if (item.match.kind === "ambiguous") {
        info.append(el("span", "intake-match-note", "匹配到多个已有词条，请使用词库中的准确拼写。已跳过。"));
      } else {
        const existing = item.match.entry;
        info.append(el("span", "intake-match-note", "已收录" + (existing.term !== item.term ? "为「" + existing.term + "」" : "")
          + (item.sameSentence ? " · 这句也已收录" : " · 已有 " + existing.personalExamples.length + " 条语境")));
        const link = el("a", "link-button", "查看已有词条 ↗");
        link.href = "#/entry/" + encodeURIComponent(existing.id);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        info.append(link);
        const select = el("select", "intake-match-choice");
        select.setAttribute("aria-label", item.term + " 的录入方式");
        select.dataset.termKey = item.key;
        select.add(new Option("跳过，不重复录入", "skip"));
        const rename = termKey(existing.term) !== termKey(item.lookupTerm);
        select.add(new Option(rename ? "归为原形并补充语境" : item.sameSentence ? "更新这条语境 / 补全释义" : "补充本次语境", "update"));
        select.value = item.action;
        select.addEventListener("change", () => {
          if (select.value === "update") choices.set(item.key, existing.id);
          else choices.delete(item.key);
          updateDuplicates();
          refresh();
          [...duplicates.querySelectorAll("select")].find(node => node.dataset.termKey === item.key)?.focus();
        });
        row.append(info, select);
      }
      if (!info.parentNode) row.append(info);
      duplicates.append(row);
    }
    const count = type => new Set(plan.items.filter(item => item.action === type).map(item => item.key)).size;
    const summary = el("p", "intake-match-summary", "本次：" + count("new") + " 个新词，补充 " + count("update")
      + " 个已有词，跳过 " + (count("skip") + count("blocked")) + " 个。"
      + (!plan.terms.length ? "可选择补充语境，或继续添加其他词。" : "同一原形只生成一个词条。"));
    summary.setAttribute("role", "status");
    duplicates.append(summary);
    if (wordFormIndex) {
      const credit = el("a", "intake-match-credit", "词形依据：Open English WordNet 2025");
      credit.href = "https://en-word.net/";
      credit.target = "_blank";
      credit.rel = "noopener noreferrer";
      duplicates.append(credit);
    }
  }

  function ensureWordForms() {
    if (wordFormIndex || loadingForms) return;
    formLoadFailed = false;
    loadingForms = loadWordFormIndex().then(index => { wordFormIndex = index; })
      .catch(() => { formLoadFailed = true; })
      .finally(() => {
        loadingForms = null;
        if (dialog.open && !review) { updateDuplicates(); refresh(); }
      });
  }

  for (const control of [controls.terms, controls.sentence]) {
    control.addEventListener("input", () => { carriedForms = {}; updateDuplicates(); refresh(); });
  }

  function hasUnsavedInput() {
    return draft || pending || controls.terms.value !== initial.terms || controls.sentence.value !== initial.sentence ||
      controls.source.value !== initial.source || (controls.analysis.value === "detailed") !== initial.detailed;
  }

  function clearError() {
    find("ErrorText").textContent = "";
    find("Error").hidden = true;
    find("Settings").hidden = true;
  }
  function showError(error, settingsUseful) {
    find("ErrorText").textContent = error?.message || "操作失败，请重试。";
    find("Settings").hidden = !(settingsUseful && openSettings);
    find("Error").hidden = false;
  }
  function status(text) {
    progress.textContent = text;
    progress.hidden = !text;
  }
  function refresh() {
    inputPanel.hidden = review;
    inputPanel.disabled = review || Boolean(pending);
    controls.sentence.readOnly = repairing;
    controls.source.readOnly = repairing;
    inputPanel.querySelector(".intake-mode").disabled = repairing;
    reviewPanel.hidden = !review;
    reviewPanel.inert = saving;
    back.hidden = review || pending || !draft;
    revise.hidden = !review || saving;
    stop.hidden = !pending;
    find("Close").disabled = saving;
    submit.disabled = saving || Boolean(pending) || (!review && !plan?.terms.length);
    if (review) {
      const label = draft.missingTerms.length ? "保存已生成的 " : "保存全部 ";
      submit.textContent = saving ? "正在保存…" : label + draft.entries.length + " 个词条";
    } else {
      submit.textContent = pending ? "自动填写中…" : repairing ? "补录缺少的词" : draft ? "重新生成草稿" : "自动填写";
    }
    find("Title").textContent = review ? "核对词条草稿" : "记录新词";
  }
  function switchView(showReview) {
    review = showReview;
    clearError();
    status("");
    if (!review) updateDuplicates();
    refresh();
    find("Body").scrollTop = 0;
    if (review) find("Title").focus({ preventScroll: true });
    else controls.terms.focus();
  }
  function abortWait() {
    pending?.abort();
    pending = null;
  }
  function requestClose() {
    if (saving) return;
    if (hasUnsavedInput() && !window.confirm("关闭后将丢弃本次输入和未保存的草稿。确定关闭？")) return;
    abortWait();
    dialog.close();
  }
  find("Close").addEventListener("click", requestClose);
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    requestClose();
  });
  // Other dialogs have a global backdrop handler. This dialog protects unsaved work.
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    event.stopImmediatePropagation();
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) requestClose();
  }, true);
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    abortWait();
    draft = null;
    reviewPanel.replaceChildren();
    form.reset();
  });
  window.addEventListener("beforeunload", event => {
    if (dialog.open && hasUnsavedInput()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  reviewPanel.addEventListener("input", () => { editedDraft = true; });
  reviewPanel.addEventListener("change", () => { editedDraft = true; });
  reviewPanel.addEventListener("click", event => {
    if (event.target.closest("button")) editedDraft = true;
  });
  stop.addEventListener("click", () => {
    abortWait();
    status("已停止等待。你可以修改输入后重新填写。");
    refresh();
    controls.terms.focus();
  });
  function editRequest(onlyMissing) {
    repairing = onlyMissing;
    carriedForms = draft.requestedWordForms || {};
    const currentNames = new Map(draft.successfulTerms.map((term, i) => [normalizeSearch(term), draft.entries[i].term]));
    const terms = onlyMissing ? draft.missingTerms : draft.requestedTerms.map(term => currentNames.get(normalizeSearch(term)) || term);
    controls.terms.value = terms.map(formatTerm).join(", ");
    controls.sentence.value = draft.shared.en;
    controls.source.value = draft.shared.source;
    controls.analysis.value = draft.detailed ? "detailed" : "ordinary";
    switchView(false);
    if (onlyMissing) status("补录使用同一条原句，已有草稿和修改会保留。");
  }
  revise.addEventListener("click", () => editRequest(false));
  back.addEventListener("click", () => {
    repairing = false;
    switchView(true);
  });
  find("Settings").addEventListener("click", () => openSettings?.());

  async function fill() {
    updateDuplicates();
    if (!getLibrary()) throw new Error("请先成功读取词库，再自动填写。");
    if (!plan) { parseTargetTerms(controls.terms.value); return; }
    if (!plan.terms.length) throw new Error("这些词已收录且均已跳过。请选择补充语境，或添加其他词。");
    const request = {
      libraryKey,
      terms: plan.terms,
      existingEntryIds: plan.existingEntryIds,
      skippedTerms: plan.items.filter(item => item.action === "skip" || item.action === "blocked").map(item => item.term),
      wordFormsByTerm: Object.fromEntries(plan.terms.map(term => [normalizeSearch(term),
        plan.wordFormsByTerm[normalizeSearch(term)] || carriedForms[normalizeSearch(term)] || []])),
      sentence: controls.sentence.value,
      source: controls.source.value.trim(),
      detailed: controls.analysis.value === "detailed",
    };
    if (!request.sentence.trim()) {
      controls.sentence.focus();
      throw new Error("请粘贴希望录入的英文原句。");
    }
    if (repairing) {
      const wanted = new Set(draft.missingTerms.map(normalizeSearch));
      if (request.terms.some(term => !wanted.has(normalizeSearch(term)))) {
        throw new Error("补录时请使用清单中的目标词。要更改整批输入，请先返回现有草稿。");
      }
    } else if (draft && editedDraft && !window.confirm("重新生成会覆盖已修改的草稿。确定继续？")) return;
    const job = new AbortController();
    pending = job;
    refresh();
    status("正在生成草稿，请保持此窗口打开…");
    try {
      const result = await generate(request, {
        signal: job.signal,
        onProgress: message => {
          if (pending === job && typeof message === "string") status(message);
        },
      });
      if (pending !== job || !dialog.open) return;
      const generated = prepareDraft(result, request);
      const nextDraft = repairing ? mergeRepair(draft, generated) : generated;
      const preview = document.createDocumentFragment();
      renderReview(preview, nextDraft, () => editRequest(true));
      reviewPanel.replaceChildren(preview);
      draft = nextDraft;
      if (!repairing) editedDraft = false;
      repairing = false;
      pending = null;
      switchView(true);
    } catch (error) {
      if (pending === job) {
        status("");
        showError(error, !error.code);
      }
    } finally {
      if (pending === job) {
        pending = null;
        refresh();
      }
    }
  }

  async function persist() {
    const entries = entriesForSave(draft);
    saving = true;
    refresh();
    status("正在保存 " + entries.length + " 个词条…");
    try {
      await save(entries, { saveTarget: draft.saveTarget, originalTerms: draft.successfulTerms,
        existingEntryIds: draft.existingEntryIds });
      if (!draft.missingTerms.length) {
        dialog.close();
        status("");
        return;
      }
      // Leave the original sentence and only the unrecorded words ready for the next request.
      initial = { terms: draft.missingTerms.map(formatTerm).join(", "), sentence: draft.shared.en,
        source: draft.shared.source, detailed: draft.detailed };
      carriedForms = draft.requestedWordForms || {};
      controls.terms.value = initial.terms;
      controls.sentence.value = initial.sentence;
      controls.source.value = initial.source;
      controls.analysis.value = initial.detailed ? "detailed" : "ordinary";
      draft = null;
      editedDraft = false;
      repairing = false;
      reviewPanel.replaceChildren();
      switchView(false);
      status("已保存 " + entries.length + " 个词条。剩余目标词和原句已填好，可以继续录入。");
    } catch (error) {
      status("");
      throw error;
    } finally {
      saving = false;
      refresh();
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving || pending) return;
    clearError();
    try {
      if (review) await persist();
      else await fill();
    } catch (error) {
      showError(error, review);
    }
  });

  return {
    refreshLibrary() {
      if (dialog.open && !review && !pending) { updateDuplicates(); refresh(); }
    },
    open({ term = "", sentence = "", source = "", existingEntryId = "" } = {}) {
      if (dialog.open) return;
      form.reset();
      abortWait();
      draft = null;
      editedDraft = false;
      repairing = false;
      saving = false;
      choices.clear();
      formChoices.clear();
      carriedForms = {};
      libraryKey = getLibraryKey();
      if (existingEntryId) {
        choices.set(termKey(term), existingEntryId);
        formChoices.set(termKey(term), term);
      }
      reviewPanel.replaceChildren();
      initial = { terms: formatTerm(term), sentence, source, detailed: false };
      controls.terms.value = initial.terms;
      controls.sentence.value = sentence;
      controls.source.value = source;
      dialog.showModal();
      ensureWordForms();
      switchView(false);
    },
  };
}
