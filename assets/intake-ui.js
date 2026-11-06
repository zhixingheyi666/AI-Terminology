import {
  STATUS_LABELS, createDefinition, createDefinitionExample, createGrammarAnalysis,
  createGrammarPart, normalizeSearch, normalizeTags,
} from "./model.js?v=1.4.0";

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
    const key = normalizeSearch(term);
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

function entryCard(entry, detailed, index) {
  const example = entry.personalExamples[0];
  const card = el("details", "intake-draft");
  card.open = index === 0;
  const summary = el("summary");
  const headword = el("strong", "", entry.term);
  summary.append(headword);
  const body = el("div", "intake-draft-body intake-stack");
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

function prepareDraft(result, request) {
  if (!Array.isArray(result?.entries) || result.entries.length !== request.terms.length) {
    throw new Error("返回的词条数量与目标词不符，请重新生成。");
  }
  const entries = structuredClone(result.entries);
  const wanted = new Set(request.terms.map(normalizeSearch));
  for (const entry of entries) {
    if (!wanted.delete(normalizeSearch(entry.term)) || entry.personalExamples?.length !== 1 ||
        !Array.isArray(entry.definitions) || !entry.personalExamples[0]?.zh?.trim()) {
      throw new Error("返回的词条或例句不完整，请重新生成。");
    }
    entry.definitions = orderedDefinitions(entry.definitions);
  }
  const first = entries[0].personalExamples[0];
  return {
    entries, detailed: request.detailed, warnings: result.warnings || [],
    shared: { en: request.sentence, zh: first.zh, source: request.source,
      encounteredAt: first.encounteredAt, grammarAnalysis: createGrammarAnalysis(first.grammarAnalysis) },
  };
}

function renderReview(container, draft) {
  const { shared, detailed, entries, warnings } = draft;
  container.replaceChildren();
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
  entries.forEach((entry, index) => cards.append(entryCard(entry, detailed, index)));
  container.append(sharedEditor, cards);
}

export function entriesForSave(draft) {
  const { shared, detailed } = draft;
  if (!shared.en.trim() || !shared.zh.trim()) throw new Error("请补全共享的英文原句和中文翻译。");
  const seen = new Set();
  const entries = structuredClone(draft.entries);
  for (const entry of entries) {
    entry.term = entry.term.trim();
    const key = normalizeSearch(entry.term);
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
    Object.assign(example, shared, { grammarAnalysis: detailed ? createGrammarAnalysis(shared.grammarAnalysis) : createGrammarAnalysis() });
    if (!detailed) {
      example.note = "";
      example.contextAnalysis = "";
    }
  }
  return entries;
}

export function createIntakeUI({ generate, save, openSettings }) {
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
  let draft = null;
  let review = false;
  let saving = false;
  let pending = null;
  let editedDraft = false;
  let initial = { terms: "", sentence: "", source: "" };

  function hasUnsavedInput() {
    return draft || pending || controls.terms.value !== initial.terms || controls.sentence.value !== initial.sentence ||
      controls.source.value !== initial.source || controls.analysis.value === "detailed";
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
    reviewPanel.hidden = !review;
    reviewPanel.inert = saving;
    back.hidden = review || pending || !draft;
    revise.hidden = !review || saving;
    stop.hidden = !pending;
    find("Close").disabled = saving;
    submit.disabled = saving || Boolean(pending);
    submit.textContent = review
      ? (saving ? "正在保存…" : "保存全部 " + draft.entries.length + " 个词条")
      : (pending ? "自动填写中…" : draft ? "重新生成草稿" : "自动填写");
    find("Title").textContent = review ? "核对词条草稿" : "记录新词";
  }
  function switchView(showReview) {
    review = showReview;
    clearError();
    status("");
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
  revise.addEventListener("click", () => {
    controls.terms.value = draft.entries.map(entry => formatTerm(entry.term)).join(", ");
    controls.sentence.value = draft.shared.en;
    controls.source.value = draft.shared.source;
    controls.analysis.value = draft.detailed ? "detailed" : "ordinary";
    switchView(false);
  });
  back.addEventListener("click", () => switchView(true));
  find("Settings").addEventListener("click", () => openSettings?.());

  async function fill() {
    const request = {
      terms: parseTargetTerms(controls.terms.value),
      sentence: controls.sentence.value,
      source: controls.source.value.trim(),
      detailed: controls.analysis.value === "detailed",
    };
    if (!request.sentence.trim()) {
      controls.sentence.focus();
      throw new Error("请粘贴希望录入的英文原句。");
    }
    if (draft && editedDraft && !window.confirm("重新生成会覆盖已修改的草稿。确定继续？")) return;
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
      const nextDraft = prepareDraft(result, request);
      const preview = document.createDocumentFragment();
      renderReview(preview, nextDraft);
      reviewPanel.replaceChildren(preview);
      draft = nextDraft;
      editedDraft = false;
      pending = null;
      switchView(true);
    } catch (error) {
      if (pending === job) {
        status("");
        showError(error, true);
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
    status("正在保存全部词条…");
    try {
      await save(entries);
      dialog.close();
    } finally {
      saving = false;
      status("");
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
    open({ term = "", sentence = "", source = "" } = {}) {
      if (dialog.open) return;
      form.reset();
      abortWait();
      draft = null;
      editedDraft = false;
      saving = false;
      reviewPanel.replaceChildren();
      initial = { terms: formatTerm(term), sentence, source };
      controls.terms.value = initial.terms;
      controls.sentence.value = sentence;
      controls.source.value = source;
      dialog.showModal();
      switchView(false);
    },
  };
}
