import {
  STATUS_LABELS,
  collectTags,
  createDefinition,
  createDefinitionExample,
  createEntry,
  createPersonalExample,
  displayEntrySnippet,
  filterEntries,
  normalizeData,
  normalizeDefinition,
  normalizePersonalExample,
  normalizeSearch,
  normalizeTags,
  nowIso,
  sortEntriesByUpdated,
  validateData,
} from "./model.js";

const STORAGE = Object.freeze({
  settings: "citrace.settings.v1",
  tokenSession: "citrace.github-token.session.v1",
  tokenPersistent: "citrace.github-token.local.v1",
  backup: "citrace.library-backup.v1",
  theme: "citrace.theme.v1",
});

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const repositoryFromPages = inferRepositoryFromPages();
const storedSettings = loadStoredSettings();
const initialHashEntryId = selectedIdFromHash();
const initialSettings = {
  owner: storedSettings.owner || repositoryFromPages.owner || "",
  repo: storedSettings.repo || repositoryFromPages.repo || "",
  branch: storedSettings.branch || "main",
  dataPath: storedSettings.dataPath || "data/vocabulary.json",
};

const state = {
  data: createEntryDataPlaceholder(),
  settings: initialSettings,
  token: loadStoredToken(),
  query: "",
  status: "all",
  tag: "",
  selectedId: initialHashEntryId,
  editor: null,
  editingId: "",
  dirty: false,
  baseSha: "",
  revision: 0,
  syncState: "local",
  syncText: "仅保存在本机",
  syncing: false,
  syncAgain: false,
  loadSource: "",
};

const elements = {
  entryList: document.querySelector("#entryList"),
  listEmpty: document.querySelector("#listEmpty"),
  resultCount: document.querySelector("#resultCount"),
  clearFilters: document.querySelector("#clearFilters"),
  tagCloud: document.querySelector("#tagCloud"),
  statusFilters: document.querySelector("#statusFilters"),
  searchInput: document.querySelector("#searchInput"),
  welcomeState: document.querySelector("#welcomeState"),
  noResultsState: document.querySelector("#noResultsState"),
  entryDetail: document.querySelector("#entryDetail"),
  detailBreadcrumb: document.querySelector("#detailBreadcrumb"),
  detailStatus: document.querySelector("#detailStatus"),
  detailTags: document.querySelector("#detailTags"),
  detailHeadword: document.querySelector("#detailHeadword"),
  detailPhonetic: document.querySelector("#detailPhonetic"),
  detailUpdatedAt: document.querySelector("#detailUpdatedAt"),
  definitionCount: document.querySelector("#definitionCount"),
  definitionList: document.querySelector("#definitionList"),
  personalExampleList: document.querySelector("#personalExampleList"),
  personalExampleEmpty: document.querySelector("#personalExampleEmpty"),
  notesSection: document.querySelector("#notesSection"),
  detailNotes: document.querySelector("#detailNotes"),
  welcomeEntryCount: document.querySelector("#welcomeEntryCount"),
  welcomeDefinitionCount: document.querySelector("#welcomeDefinitionCount"),
  welcomeExampleCount: document.querySelector("#welcomeExampleCount"),
  syncStatus: document.querySelector("#syncStatus"),
  syncStatusText: document.querySelector("#syncStatusText"),
  entryDialog: document.querySelector("#entryDialog"),
  entryForm: document.querySelector("#entryForm"),
  entryDialogEyebrow: document.querySelector("#entryDialogEyebrow"),
  entryDialogTitle: document.querySelector("#entryDialogTitle"),
  entryFormError: document.querySelector("#entryFormError"),
  definitionEditorList: document.querySelector("#definitionEditorList"),
  personalExampleEditorList: document.querySelector("#personalExampleEditorList"),
  saveEntryButton: document.querySelector("#saveEntryButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  settingsError: document.querySelector("#settingsError"),
  connectionSummary: document.querySelector("#connectionSummary"),
  testConnectionButton: document.querySelector("#testConnectionButton"),
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmTitle: document.querySelector("#confirmTitle"),
  confirmMessage: document.querySelector("#confirmMessage"),
  confirmActionButton: document.querySelector("#confirmActionButton"),
  importInput: document.querySelector("#importInput"),
  toast: document.querySelector("#toast"),
  themeToggle: document.querySelector("#themeToggle"),
  sidebar: document.querySelector("#sidebar"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  sidebarScrim: document.querySelector("#sidebarScrim"),
};

let toastTimer;
let syncTimer;

initializeTheme();
bindEvents();
loadLibrary();
registerServiceWorker();

function createEntryDataPlaceholder() {
  return {
    schemaVersion: 1,
    updatedAt: nowIso(),
    entries: [],
  };
}

async function loadLibrary() {
  setSync("saving", isConfigured() ? "正在读取 GitHub 词库" : "正在读取词库");
  renderSyncStatus();

  const localBackup = readLocalBackup();
  let remoteResult = null;
  let pageResult = null;
  let remoteError = null;

  if (isConfigured()) {
    try {
      remoteResult = await fetchGithubData(state.settings, state.token);
    } catch (error) {
      remoteError = error;
    }
  }

  if (!remoteResult) {
    try {
      pageResult = await fetchBundledData();
    } catch (error) {
      if (!remoteError) {
        remoteError = error;
      }
    }
  }

  const remoteData = remoteResult?.data || pageResult;
  const localData = localBackup?.data;
  let chosenData = null;
  let chosenSource = "";

  if (localBackup?.dirty && isUsableData(localData)) {
    chosenData = normalizeData(localData);
    chosenSource = "local-dirty";
    state.dirty = true;
    state.baseSha = localBackup.baseSha || "";
  } else if (isUsableData(remoteData)) {
    chosenData = normalizeData(remoteData);
    chosenSource = remoteResult ? "github" : "page";
    state.dirty = false;
    state.baseSha = remoteResult?.sha || "";
  } else if (isUsableData(localData)) {
    chosenData = normalizeData(localData);
    chosenSource = "local";
    state.dirty = Boolean(localBackup.dirty);
    state.baseSha = localBackup.baseSha || "";
  }

  if (!chosenData) {
    chosenData = createEntryDataPlaceholder();
    chosenSource = "empty";
    state.baseSha = "";
    setSync("error", "词库读取失败");
    showToast(
      remoteError?.message ||
        "无法读取词库文件。请检查网络或同步设置，本机数据不会被覆盖。",
      "error",
      7000,
    );
  }

  state.data = chosenData;
  state.loadSource = chosenSource;

  if (!state.selectedId) {
    state.selectedId = selectedIdFromHash();
  }

  if (state.dirty) {
    setSync(
      state.token ? "pending" : "local",
      state.token ? "有改动等待同步" : "有改动待连接 GitHub",
    );
    if (chosenSource === "local-dirty" && remoteResult) {
      showToast("已恢复本机尚未同步的修改。若 GitHub 也有新改动，请先导出本地备份。");
    }
  } else if (remoteResult) {
    setSync(
      state.token ? "synced" : "readonly",
      state.token ? "已与 GitHub 同步" : "GitHub 只读",
    );
  } else if (chosenSource === "page") {
    setSync("readonly", "已读取发布数据");
  } else {
    setSync("local", "仅保存在本机");
  }

  saveLocalBackup();
  render();
}

async function fetchGithubData(settings, token = "") {
  assertConnectionFields(settings);
  const endpoint = githubContentsUrl(settings);
  const headers = githubHeaders(token);
  let response = await fetch(`${endpoint}?ref=${encodeURIComponent(settings.branch)}&t=${Date.now()}`, {
    headers,
    cache: "no-store",
  });

  if (response.status === 401 && token) {
    response = await fetch(
      `${endpoint}?ref=${encodeURIComponent(settings.branch)}&t=${Date.now()}`,
      {
        headers: githubHeaders(""),
        cache: "no-store",
      },
    );
  }

  if (!response.ok) {
    throw await githubResponseError(response, "读取 GitHub 词库失败");
  }

  const payload = await response.json();
  if (!payload?.content || typeof payload.content !== "string") {
    if (payload?.download_url) {
      const rawResponse = await fetch(`${payload.download_url}?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!rawResponse.ok) {
        throw await githubResponseError(rawResponse, "读取 GitHub 词库文件失败");
      }
      return {
        data: await rawResponse.json(),
        sha: payload.sha || "",
      };
    }
    throw new Error("GitHub 返回的文件内容为空。");
  }

  const source = decodeBase64Utf8(payload.content.replace(/\s/g, ""));
  let data;
  try {
    data = JSON.parse(source);
  } catch {
    throw new Error("GitHub 上的 vocabulary.json 不是有效 JSON。");
  }

  const validation = validateData(data);
  if (!validation.valid) {
    throw new Error(`GitHub 词库格式有误：${validation.errors[0]}`);
  }

  return { data, sha: payload.sha || "" };
}

async function fetchBundledData() {
  const response = await fetch(`./data/vocabulary.json?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`无法读取项目内的 data/vocabulary.json（HTTP ${response.status}）。`);
  }

  const data = await response.json();
  const validation = validateData(data);
  if (!validation.valid) {
    throw new Error(`项目内词库格式有误：${validation.errors[0]}`);
  }
  return data;
}

async function syncToGithub(reason = "更新词库") {
  if (!state.dirty) {
    return;
  }

  if (!isConfigured()) {
    setSync("local", "仅保存在本机");
    return;
  }

  if (!state.token) {
    setSync("pending", "待连接 GitHub");
    renderSyncStatus();
    return;
  }

  if (state.syncing) {
    state.syncAgain = true;
    return;
  }

  if (!state.baseSha) {
    setSync("error", "需要重新读取远端版本");
    showToast("无法确认 GitHub 上的当前版本。请打开同步设置并测试连接后再保存。", "error", 6500);
    return;
  }

  state.syncing = true;
  state.syncAgain = false;
  const snapshotRevision = state.revision;
  setSync("saving", "正在提交到 GitHub");
  renderSyncStatus();

  try {
    const remote = await fetchGithubData(state.settings, state.token);
    if (remote.sha !== state.baseSha) {
      throw new Error(
        "GitHub 上的词库已被另一台设备更新。为避免覆盖，当前修改尚未提交。请先导出本机备份，再刷新页面检查。",
      );
    }

    const serialized = `${JSON.stringify(state.data, null, 2)}\n`;
    const message = buildCommitMessage(reason);
    const endpoint = githubContentsUrl(state.settings);
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        ...githubHeaders(state.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        content: encodeBase64Utf8(serialized),
        sha: state.baseSha,
        branch: state.settings.branch,
      }),
    });

    if (!response.ok) {
      throw await githubResponseError(response, "提交 GitHub 失败");
    }

    const result = await response.json();
    state.baseSha = result?.content?.sha || result?.commit?.sha || state.baseSha;

    if (state.revision === snapshotRevision) {
      state.dirty = false;
      state.syncAgain = false;
      saveLocalBackup();
      setSync("synced", "已与 GitHub 同步");
      showToast("已提交到 GitHub。其他设备重新打开或刷新后即可看到。");
    } else {
      state.syncAgain = true;
      setSync("saving", "正在同步新改动");
    }
  } catch (error) {
    setSync("error", "GitHub 同步失败");
    saveLocalBackup();
    showToast(`${error.message} 本机修改仍保留，可使用“导出备份”。`, "error", 8000);
  } finally {
    state.syncing = false;
    renderSyncStatus();
    if (state.syncAgain && state.dirty) {
      state.syncAgain = false;
      scheduleSync(`${reason}（继续）`, 80);
    }
  }
}

function scheduleSync(reason, delay = 280) {
  window.clearTimeout(syncTimer);
  if (!state.dirty) {
    return;
  }

  if (!isConfigured()) {
    setSync("local", "仅保存在本机");
    renderSyncStatus();
    return;
  }

  if (!state.token) {
    setSync("pending", "待连接 GitHub");
    renderSyncStatus();
    return;
  }

  setSync("pending", "等待同步");
  renderSyncStatus();
  syncTimer = window.setTimeout(() => syncToGithub(reason), delay);
}

function render() {
  const filteredEntries = getFilteredEntries();
  const filteredIds = new Set(filteredEntries.map((entry) => entry.id));

  if (state.selectedId && !filteredIds.has(state.selectedId)) {
    state.selectedId = filteredEntries[0]?.id || "";
  }
  if (!state.selectedId && filteredEntries.length > 0) {
    state.selectedId = filteredEntries[0].id;
  }

  renderFilters(filteredEntries.length);
  renderEntryList(filteredEntries);
  renderContent(filteredEntries);
  renderSyncStatus();
  writeEntryHash();
}

function renderFilters(filteredCount) {
  for (const button of elements.statusFilters.querySelectorAll("[data-status]")) {
    button.classList.toggle("is-active", button.dataset.status === state.status);
  }

  const tags = collectTags(state.data.entries);
  elements.tagCloud.innerHTML = tags
    .slice(0, 16)
    .map(
      (tag) => `
        <button
          class="tag-chip${normalizeSearch(tag.label) === normalizeSearch(state.tag) ? " is-active" : ""}"
          type="button"
          data-tag="${escapeAttribute(tag.label)}"
          aria-pressed="${normalizeSearch(tag.label) === normalizeSearch(state.tag)}"
        >#${escapeHtml(tag.label)}</button>
      `,
    )
    .join("");

  const total = state.data.entries.length;
  elements.resultCount.textContent =
    filteredCount === total ? `${total} 个词条` : `${filteredCount} / ${total} 个词条`;
  elements.clearFilters.hidden = !(state.query || state.status !== "all" || state.tag);
}

function renderEntryList(entries) {
  elements.entryList.innerHTML = entries
    .map((entry) => {
      const personalCount = entry.personalExamples.filter((example) => example.en).length;
      const tags = entry.tags.slice(0, 2).join(" · ");
      return `
        <button
          class="entry-card${entry.id === state.selectedId ? " is-active" : ""}"
          type="button"
          role="option"
          aria-selected="${entry.id === state.selectedId}"
          data-entry-id="${escapeAttribute(entry.id)}"
        >
          <span class="entry-card-head">
            <span class="entry-title">${escapeHtml(entry.term)}</span>
            <span class="status-mini" data-status="${escapeAttribute(entry.status)}">
              ${escapeHtml(STATUS_LABELS[entry.status] || entry.status)}
            </span>
          </span>
          <span class="entry-snippet">${escapeHtml(displayEntrySnippet(entry))}</span>
          <span class="entry-card-foot">
            <span>${entry.definitions.length} 个来源${personalCount ? ` · ${personalCount} 段语境` : ""}</span>
            <span class="entry-mini-tags">${escapeHtml(tags)}</span>
          </span>
        </button>
      `;
    })
    .join("");

  elements.listEmpty.hidden = entries.length > 0;
  elements.entryList.hidden = entries.length === 0;
}

function renderContent(filteredEntries) {
  const hasAnyEntries = state.data.entries.length > 0;
  const selectedEntry = state.data.entries.find((entry) => entry.id === state.selectedId);

  elements.welcomeEntryCount.textContent = String(state.data.entries.length);
  elements.welcomeDefinitionCount.textContent = String(
    state.data.entries.reduce((total, entry) => total + entry.definitions.length, 0),
  );
  elements.welcomeExampleCount.textContent = String(
    state.data.entries.reduce(
      (total, entry) => total + entry.personalExamples.filter((example) => example.en).length,
      0,
    ),
  );

  if (!hasAnyEntries) {
    elements.welcomeState.hidden = false;
    elements.noResultsState.hidden = true;
    elements.entryDetail.hidden = true;
    return;
  }

  if (filteredEntries.length === 0) {
    elements.welcomeState.hidden = true;
    elements.noResultsState.hidden = false;
    elements.entryDetail.hidden = true;
    return;
  }

  if (!selectedEntry) {
    elements.welcomeState.hidden = true;
    elements.noResultsState.hidden = false;
    elements.entryDetail.hidden = true;
    return;
  }

  elements.welcomeState.hidden = true;
  elements.noResultsState.hidden = true;
  elements.entryDetail.hidden = false;
  renderEntryDetail(selectedEntry);
}

function renderEntryDetail(entry) {
  elements.detailBreadcrumb.textContent = `术语库 / ${entry.term}`;
  elements.detailStatus.textContent = STATUS_LABELS[entry.status] || entry.status;
  elements.detailStatus.dataset.status = entry.status;
  elements.detailTags.innerHTML = entry.tags
    .map((tag) => `<span>${escapeHtml(tag)}</span>`)
    .join("");
  elements.detailHeadword.textContent = entry.term;
  elements.detailPhonetic.textContent = entry.phonetic || "";
  elements.detailPhonetic.hidden = !entry.phonetic;
  elements.detailUpdatedAt.textContent = `最后更新于 ${formatDateTime(entry.updatedAt)}`;

  elements.definitionCount.textContent = `· ${entry.definitions.length} 个来源`;
  elements.definitionList.innerHTML = entry.definitions
    .map((definition, index) => renderDefinitionCard(definition, index))
    .join("");

  const personalExamples = entry.personalExamples.filter(
    (example) => example.en || example.zh || example.source || example.note,
  );
  elements.personalExampleList.innerHTML = personalExamples
    .map((example, index) => renderEncounterCard(example, index))
    .join("");
  elements.personalExampleEmpty.hidden = personalExamples.length > 0;

  elements.notesSection.hidden = !entry.notes;
  elements.detailNotes.textContent = entry.notes || "";
}

function renderDefinitionCard(definition, index) {
  const safeUrl = safeWebUrl(definition.url);
  const examples = definition.examples.filter((example) => example.en || example.zh);
  return `
    <article class="definition-card">
      <div class="definition-card-head">
        <span class="dictionary-name" title="${escapeAttribute(definition.dictionary)}">
          ${escapeHtml(definition.dictionary || `词典来源 ${index + 1}`)}
        </span>
        ${
          safeUrl
            ? `<a class="source-link" href="${escapeAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer" aria-label="打开词典来源">
                <svg><use href="#icon-external"></use></svg>
              </a>`
            : ""
        }
      </div>
      ${
        definition.partOfSpeech
          ? `<p class="part-of-speech">${escapeHtml(definition.partOfSpeech)}</p>`
          : ""
      }
      ${definition.definitionEn ? `<p class="definition-en">${escapeHtml(definition.definitionEn)}</p>` : ""}
      ${definition.definitionZh ? `<p class="definition-zh">${escapeHtml(definition.definitionZh)}</p>` : ""}
      ${
        examples.length
          ? `<div class="dictionary-examples">
              ${examples
                .map(
                  (example) => `
                    <div class="dictionary-example">
                      ${example.en ? `<p>${escapeHtml(example.en)}</p>` : ""}
                      ${example.zh ? `<p>${escapeHtml(example.zh)}</p>` : ""}
                    </div>
                  `,
                )
                .join("")}
            </div>`
          : ""
      }
    </article>
  `;
}

function renderEncounterCard(example, index) {
  return `
    <article class="encounter-card">
      <span class="encounter-index">${String(index + 1).padStart(2, "0")}</span>
      <div class="encounter-body">
        <blockquote>${escapeHtml(example.en || example.note || "（未填写原句）")}</blockquote>
        ${example.zh ? `<p class="encounter-translation">${escapeHtml(example.zh)}</p>` : ""}
        <div class="encounter-meta">
          <span>${escapeHtml(example.source || "未记录出处")}</span>
          ${example.encounteredAt ? `<span>${escapeHtml(formatDateOnly(example.encounteredAt))}</span>` : ""}
        </div>
        ${example.note ? `<p class="encounter-note">${escapeHtml(example.note)}</p>` : ""}
      </div>
    </article>
  `;
}

function renderSyncStatus() {
  elements.syncStatus.dataset.state = state.syncState;
  elements.syncStatusText.textContent = state.syncText;
  elements.syncStatus.title = state.syncText;
  elements.syncStatus.setAttribute("aria-label", `${state.syncText}，打开同步设置`);
}

function setSync(mode, text) {
  state.syncState = mode;
  state.syncText = text;
}

function getFilteredEntries() {
  return sortEntriesByUpdated(
    filterEntries(state.data.entries, {
      query: state.query,
      status: state.status,
      tag: state.tag,
    }),
  );
}

function selectEntry(id) {
  if (!state.data.entries.some((entry) => entry.id === id)) {
    return;
  }
  state.selectedId = id;
  closeMobileSidebar();
  render();
}

function clearAllFilters() {
  state.query = "";
  state.status = "all";
  state.tag = "";
  elements.searchInput.value = "";
  render();
}

function openEntryEditor(entry = null, options = {}) {
  state.editingId = entry?.id || "";
  state.editor = entry
    ? clone(entry)
    : createEntry({
        definitions: [createDefinition()],
        personalExamples: [createPersonalExample()],
      });

  elements.entryForm.reset();
  elements.entryFormError.textContent = "";
  elements.entryDialogEyebrow.textContent = entry ? "EDIT ENTRY" : "NEW ENTRY";
  elements.entryDialogTitle.textContent = entry ? "编辑词条" : "记录新词";
  elements.entryForm.elements.namedItem("term").value = state.editor.term || "";
  elements.entryForm.elements.namedItem("phonetic").value = state.editor.phonetic || "";
  elements.entryForm.elements.namedItem("status").value = state.editor.status || "learning";
  elements.entryForm.elements.namedItem("tags").value = (state.editor.tags || []).join(", ");
  elements.entryForm.elements.namedItem("notes").value = state.editor.notes || "";
  renderDefinitionEditors();
  renderPersonalExampleEditors();
  elements.entryDialog.showModal();

  requestAnimationFrame(() => {
    if (options.focusEncounter && state.editor.personalExamples.length) {
      elements.personalExampleEditorList
        .querySelector('[data-personal-field="en"]')
        ?.focus();
    } else {
      elements.entryForm.elements.namedItem("term").focus();
    }
  });
}

function renderDefinitionEditors() {
  const definitions = state.editor.definitions || [];
  if (definitions.length === 0) {
    elements.definitionEditorList.innerHTML =
      '<div class="empty-dynamic">还没有词典来源。点击上方“添加来源”开始记录。</div>';
    return;
  }

  elements.definitionEditorList.innerHTML = definitions
    .map((definition, index) => definitionEditorMarkup(definition, index))
    .join("");
}

function definitionEditorMarkup(definition, index) {
  const examples = definition.examples || [];
  return `
    <div class="dynamic-card" data-definition-id="${escapeAttribute(definition.id)}">
      <div class="dynamic-card-head">
        <span class="dynamic-card-title">词典来源 ${String(index + 1).padStart(2, "0")}</span>
        <button class="remove-dynamic" type="button" data-action="remove-definition" aria-label="删除这个词典来源">
          <svg><use href="#icon-x"></use></svg>
        </button>
      </div>
      <div class="dynamic-grid">
        <label class="dynamic-field">
          <span>来源名称 *</span>
          <input data-definition-field="dictionary" value="${escapeAttribute(definition.dictionary)}" placeholder="例如：Oxford Learner's Dictionaries" />
        </label>
        <label class="dynamic-field">
          <span>词性</span>
          <input data-definition-field="partOfSpeech" value="${escapeAttribute(definition.partOfSpeech)}" placeholder="noun / verb / adj." />
        </label>
        <label class="dynamic-field dynamic-field-span-2">
          <span>英文释义（英文或中文至少一项）*</span>
          <textarea data-definition-field="definitionEn" rows="2" placeholder="保留原文或简短摘述">${escapeHtml(definition.definitionEn)}</textarea>
        </label>
        <label class="dynamic-field dynamic-field-span-2">
          <span>中文解释</span>
          <textarea data-definition-field="definitionZh" rows="2" placeholder="补充中文理解">${escapeHtml(definition.definitionZh)}</textarea>
        </label>
        <label class="dynamic-field dynamic-field-span-2">
          <span>来源网址（可选）</span>
          <input type="url" data-definition-field="url" value="${escapeAttribute(definition.url)}" placeholder="https://…" />
        </label>
      </div>
      <div class="sub-examples">
        <div class="sub-examples-label">
          <span>这本词典的例句</span>
          <button class="link-button" type="button" data-action="add-definition-example">+ 添加例句</button>
        </div>
        ${
          examples.length
            ? examples
                .map(
                  (example, exampleIndex) => `
                    <div class="sub-example">
                      <label class="dynamic-field">
                        <span>英文</span>
                        <textarea rows="2" data-example-index="${exampleIndex}" data-example-field="en" placeholder="Dictionary example…">${escapeHtml(example.en)}</textarea>
                      </label>
                      <label class="dynamic-field">
                        <span>中文</span>
                        <textarea rows="2" data-example-index="${exampleIndex}" data-example-field="zh" placeholder="例句翻译">${escapeHtml(example.zh)}</textarea>
                      </label>
                      <button class="remove-dynamic" type="button" data-action="remove-definition-example" data-example-index="${exampleIndex}" aria-label="删除例句">
                        <svg><use href="#icon-x"></use></svg>
                      </button>
                    </div>
                  `,
                )
                .join("")
            : ""
        }
      </div>
    </div>
  `;
}

function renderPersonalExampleEditors() {
  const examples = state.editor.personalExamples || [];
  if (examples.length === 0) {
    elements.personalExampleEditorList.innerHTML =
      '<div class="empty-dynamic">还没有记录真实语境。点击“添加语境”，保存你第一次遇到这个词的句子。</div>';
    return;
  }

  elements.personalExampleEditorList.innerHTML = examples
    .map(
      (example, index) => `
        <div class="dynamic-card" data-personal-id="${escapeAttribute(example.id)}">
          <div class="dynamic-card-head">
            <span class="dynamic-card-title">真实语境 ${String(index + 1).padStart(2, "0")}</span>
            <button class="remove-dynamic" type="button" data-action="remove-personal" aria-label="删除这段语境">
              <svg><use href="#icon-x"></use></svg>
            </button>
          </div>
          <div class="dynamic-grid">
            <label class="dynamic-field dynamic-field-span-2">
              <span>当时遇到的英文原句 *</span>
              <textarea data-personal-field="en" rows="3" placeholder="粘贴完整句子，保留原始上下文">${escapeHtml(example.en)}</textarea>
            </label>
            <label class="dynamic-field dynamic-field-span-2">
              <span>你的翻译 / 中文理解</span>
              <textarea data-personal-field="zh" rows="3" placeholder="写下当时你是怎么理解的">${escapeHtml(example.zh)}</textarea>
            </label>
            <label class="dynamic-field">
              <span>出处</span>
              <input data-personal-field="source" value="${escapeAttribute(example.source)}" placeholder="文章标题、书、对话…" />
            </label>
            <label class="dynamic-field">
              <span>遇到日期</span>
              <input type="date" data-personal-field="encounteredAt" value="${escapeAttribute(example.encounteredAt)}" />
            </label>
            <label class="dynamic-field dynamic-field-span-2">
              <span>语境笔记</span>
              <textarea data-personal-field="note" rows="2" placeholder="为什么这个词在这里重要？它与哪些词形成对比？">${escapeHtml(example.note)}</textarea>
            </label>
          </div>
        </div>
      `,
    )
    .join("");
}

function captureEditorFromForm() {
  if (!state.editor) {
    return;
  }

  state.editor.term = fieldValue("term");
  state.editor.phonetic = fieldValue("phonetic");
  state.editor.status = fieldValue("status") || "learning";
  state.editor.tags = normalizeTags(fieldValue("tags"));
  state.editor.notes = fieldValue("notes");
  state.editor.definitions = [...elements.definitionEditorList.querySelectorAll("[data-definition-id]")].map(
    (card) => ({
      id: card.dataset.definitionId,
      dictionary: card.querySelector('[data-definition-field="dictionary"]')?.value || "",
      partOfSpeech: card.querySelector('[data-definition-field="partOfSpeech"]')?.value || "",
      definitionEn: card.querySelector('[data-definition-field="definitionEn"]')?.value || "",
      definitionZh: card.querySelector('[data-definition-field="definitionZh"]')?.value || "",
      url: card.querySelector('[data-definition-field="url"]')?.value || "",
      examples: [...card.querySelectorAll(".sub-example")].map((row) => ({
        en: row.querySelector('[data-example-field="en"]')?.value || "",
        zh: row.querySelector('[data-example-field="zh"]')?.value || "",
      })),
    }),
  );

  state.editor.personalExamples = [
    ...elements.personalExampleEditorList.querySelectorAll("[data-personal-id]"),
  ].map((card) => ({
    id: card.dataset.personalId,
    en: card.querySelector('[data-personal-field="en"]')?.value || "",
    zh: card.querySelector('[data-personal-field="zh"]')?.value || "",
    source: card.querySelector('[data-personal-field="source"]')?.value || "",
    encounteredAt: card.querySelector('[data-personal-field="encounteredAt"]')?.value || "",
    note: card.querySelector('[data-personal-field="note"]')?.value || "",
  }));
}

function handleEntryFormClick(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) {
    return;
  }

  captureEditorFromForm();
  const action = actionButton.dataset.action;
  const definitionCard = actionButton.closest("[data-definition-id]");
  const personalCard = actionButton.closest("[data-personal-id]");

  if (action === "remove-definition" && definitionCard) {
    const id = definitionCard.dataset.definitionId;
    state.editor.definitions = state.editor.definitions.filter((item) => item.id !== id);
    renderDefinitionEditors();
  }

  if (action === "add-definition-example" && definitionCard) {
    const id = definitionCard.dataset.definitionId;
    const definition = state.editor.definitions.find((item) => item.id === id);
    definition?.examples.push(createDefinitionExample());
    renderDefinitionEditors();
    const cards = elements.definitionEditorList.querySelectorAll("[data-definition-id]");
    const targetCard = [...cards].find((card) => card.dataset.definitionId === id);
    targetCard?.querySelector(".sub-example:last-child textarea")?.focus();
  }

  if (action === "remove-definition-example" && definitionCard) {
    const id = definitionCard.dataset.definitionId;
    const definition = state.editor.definitions.find((item) => item.id === id);
    const exampleIndex = Number(actionButton.dataset.exampleIndex);
    definition?.examples.splice(exampleIndex, 1);
    renderDefinitionEditors();
  }

  if (action === "remove-personal" && personalCard) {
    const id = personalCard.dataset.personalId;
    state.editor.personalExamples = state.editor.personalExamples.filter(
      (item) => item.id !== id,
    );
    renderPersonalExampleEditors();
  }
}

async function saveEntry(event) {
  event.preventDefault();
  elements.entryFormError.textContent = "";
  captureEditorFromForm();

  const definitions = state.editor.definitions
    .map(normalizeDefinition)
    .filter((definition) => !isBlankDefinition(definition));
  const personalExamples = state.editor.personalExamples
    .map(normalizePersonalExample)
    .filter((example) => !isBlankPersonalExample(example));

  if (!state.editor.term.trim()) {
    elements.entryFormError.textContent = "请填写英文词汇。";
    elements.entryForm.elements.namedItem("term").focus();
    return;
  }

  if (definitions.length === 0) {
    elements.entryFormError.textContent = "请至少添加一个词典来源和释义。";
    return;
  }

  const newTermKey = normalizeSearch(state.editor.term);
  const duplicate = state.data.entries.find(
    (entry) => normalizeSearch(entry.term) === newTermKey && entry.id !== state.editingId,
  );
  if (duplicate) {
    elements.entryFormError.textContent = `“${duplicate.term}”已经存在。请在该词条中添加多个词典来源。`;
    return;
  }

  const timestamp = nowIso();
  const candidateEntry = createEntry({
    ...state.editor,
    definitions,
    personalExamples,
    notes: state.editor.notes.trim(),
    createdAt: state.editor.createdAt || timestamp,
    updatedAt: timestamp,
  });

  const entries = state.editingId
    ? state.data.entries.map((entry) => (entry.id === state.editingId ? candidateEntry : entry))
    : [...state.data.entries, candidateEntry];

  const candidateData = {
    schemaVersion: 1,
    updatedAt: timestamp,
    entries,
  };
  const validation = validateData(candidateData);
  if (!validation.valid) {
    elements.entryFormError.textContent = `暂时无法保存：${validation.errors.slice(0, 3).join(" ")}`;
    return;
  }

  const wasNew = !state.editingId;
  state.data = normalizeData(candidateData);
  state.selectedId = candidateEntry.id;
  state.dirty = true;
  state.revision += 1;
  saveLocalBackup();
  elements.entryDialog.close();
  render();
  showToast(
    wasNew
      ? state.token
        ? "词条已保存，正在同步到 GitHub。"
        : "词条已保存在本机。连接 GitHub 后才能跨设备同步。"
      : "词条修改已保存。",
  );
  scheduleSync(`${wasNew ? "新增" : "更新"} ${candidateEntry.term}`);
}

async function deleteCurrentEntry() {
  const entry = state.data.entries.find((item) => item.id === state.selectedId);
  if (!entry) {
    return;
  }

  const confirmed = await askForConfirmation({
    title: `删除“${entry.term}”？`,
    message: "这会移除该词的词典释义、所有例句和个人语境。删除会同步到 GitHub；如有疑虑，请先导出备份。",
    actionLabel: "确认删除",
  });
  if (!confirmed) {
    return;
  }

  const remaining = state.data.entries.filter((item) => item.id !== entry.id);
  state.data = {
    schemaVersion: 1,
    updatedAt: nowIso(),
    entries: remaining,
  };
  state.selectedId = sortEntriesByUpdated(remaining)[0]?.id || "";
  state.dirty = true;
  state.revision += 1;
  saveLocalBackup();
  render();
  showToast(`已删除“${entry.term}”。`);
  scheduleSync(`删除 ${entry.term}`);
}

async function importLibrary(file) {
  if (!file) {
    return;
  }

  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch (error) {
    showToast(`导入失败：${error.message}`, "error", 6500);
    return;
  }

  const validation = validateData(parsed);
  if (!validation.valid) {
    showToast(`导入失败：${validation.errors.slice(0, 2).join(" ")}`, "error", 8000);
    return;
  }

  const confirmed = await askForConfirmation({
    title: "用备份替换当前词库？",
    message: `备份中有 ${parsed.entries.length} 个词条。当前词库中的 ${state.data.entries.length} 个词条将被替换；此操作会同步到 GitHub。`,
    actionLabel: "导入并替换",
  });
  if (!confirmed) {
    return;
  }

  state.data = normalizeData({
    ...parsed,
    updatedAt: nowIso(),
  });
  state.selectedId = sortEntriesByUpdated(state.data.entries)[0]?.id || "";
  state.dirty = true;
  state.revision += 1;
  saveLocalBackup();
  closeMobileSidebar();
  render();
  showToast(`已导入 ${state.data.entries.length} 个词条。`);
  scheduleSync("导入词库备份");
}

function exportLibrary() {
  const serialized = `${JSON.stringify(state.data, null, 2)}\n`;
  const blob = new Blob([serialized], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ai-terminology-backup-${localDateStamp()}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("已导出完整词库备份。");
}

function openSettings() {
  const form = elements.settingsForm;
  form.elements.namedItem("repoOwner").value = state.settings.owner || "";
  form.elements.namedItem("repoName").value = state.settings.repo || "";
  form.elements.namedItem("branch").value = state.settings.branch || "main";
  form.elements.namedItem("dataPath").value =
    state.settings.dataPath || "data/vocabulary.json";
  form.elements.namedItem("token").value = state.token || "";
  form.elements.namedItem("rememberToken").checked = Boolean(
    readStorage(localStorage, STORAGE.tokenPersistent),
  );
  elements.settingsError.textContent = "";
  elements.connectionSummary.textContent = isConfigured()
    ? `${state.settings.owner}/${state.settings.repo} · ${state.settings.branch} · ${state.settings.dataPath}`
    : "尚未连接 GitHub 仓库。";
  elements.settingsDialog.showModal();
}

function readSettingsForm() {
  const form = elements.settingsForm;
  return {
    owner: form.elements.namedItem("repoOwner").value.trim(),
    repo: form.elements.namedItem("repoName").value.trim(),
    branch: form.elements.namedItem("branch").value.trim() || "main",
    dataPath: form.elements.namedItem("dataPath").value.trim() || "data/vocabulary.json",
    token: form.elements.namedItem("token").value.trim(),
    rememberToken: form.elements.namedItem("rememberToken").checked,
  };
}

async function saveSettings(event) {
  event.preventDefault();
  elements.settingsError.textContent = "";
  const settings = readSettingsForm();

  try {
    assertConnectionFields(settings);
  } catch (error) {
    elements.settingsError.textContent = error.message;
    return;
  }

  const previousTarget = repositoryTargetKey(state.settings);
  const nextTarget = repositoryTargetKey(settings);
  if (state.dirty && previousTarget !== nextTarget) {
    elements.settingsError.textContent =
      "当前还有尚未同步的修改。请先导出备份，或恢复原仓库设置并完成同步，再切换仓库。";
    return;
  }

  state.settings = {
    owner: settings.owner,
    repo: settings.repo,
    branch: settings.branch,
    dataPath: settings.dataPath,
  };
  state.token = settings.token;
  persistSettings(state.settings);
  persistToken(settings.token, settings.rememberToken);
  elements.settingsDialog.close();

  if (previousTarget !== nextTarget) {
    state.baseSha = "";
    state.selectedId = "";
    await loadLibrary();
    showToast("同步设置已更新，并重新读取了词库。");
    return;
  }

  if (settings.token && state.dirty) {
    showToast("同步设置已保存，正在提交当前修改。");
    scheduleSync("连接 GitHub 后同步", 80);
  } else if (!settings.token && state.dirty) {
    state.revision += 1;
    saveLocalBackup();
    setSync("pending", "待连接 GitHub");
    renderSyncStatus();
    showToast("设置已保存。填写有 Contents 写权限的令牌后即可提交。");
  } else {
    setSync(settings.token ? "synced" : "readonly", settings.token ? "已与 GitHub 同步" : "GitHub 只读");
    renderSyncStatus();
    showToast("同步设置已保存。");
  }
}

async function testGithubConnection() {
  elements.settingsError.textContent = "";
  const settings = readSettingsForm();
  try {
    assertConnectionFields(settings);
  } catch (error) {
    elements.settingsError.textContent = error.message;
    return;
  }

  elements.testConnectionButton.disabled = true;
  elements.testConnectionButton.textContent = "正在测试…";
  elements.connectionSummary.textContent = "正在读取仓库中的数据文件…";

  try {
    const remote = await fetchGithubData(settings, settings.token);
    const permission = settings.token ? "已携带令牌，可尝试写入" : "公开读取可用";
    elements.connectionSummary.textContent =
      `连接成功 · ${settings.owner}/${settings.repo}\n` +
      `${settings.branch} · ${settings.dataPath}\n` +
      `${remote.data.entries.length} 个词条 · ${remote.sha.slice(0, 7)} · ${permission}`;
  } catch (error) {
    elements.connectionSummary.textContent = `连接失败：${error.message}`;
    elements.settingsError.textContent = "请检查仓库、分支、文件路径和令牌权限。";
  } finally {
    elements.testConnectionButton.disabled = false;
    elements.testConnectionButton.textContent = "测试连接";
  }
}

async function askForConfirmation({ title, message, actionLabel }) {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmActionButton.textContent = actionLabel;
  elements.confirmDialog.showModal();

  return new Promise((resolve) => {
    elements.confirmDialog.addEventListener(
      "close",
      () => {
        resolve(elements.confirmDialog.returnValue === "confirm");
        elements.confirmDialog.returnValue = "";
      },
      { once: true },
    );
  });
}

function saveLocalBackup() {
  const payload = {
    version: 1,
    data: state.data,
    dirty: state.dirty,
    baseSha: state.baseSha,
    target: repositoryTargetKey(state.settings),
    savedAt: nowIso(),
  };

  try {
    localStorage.setItem(STORAGE.backup, JSON.stringify(payload));
  } catch {
    showToast("浏览器无法保存本地备份；请立即导出 JSON，避免刷新后丢失修改。", "error", 8000);
  }
}

function readLocalBackup() {
  const raw = readStorage(localStorage, STORAGE.backup);
  if (!raw) {
    return null;
  }

  try {
    const payload = JSON.parse(raw);
    if (payload?.version !== 1 || !payload.data) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function persistSettings(settings) {
  try {
    localStorage.setItem(STORAGE.settings, JSON.stringify(settings));
  } catch {
    showToast("浏览器无法保存同步设置。", "error");
  }
}

function persistToken(token, remember) {
  try {
    sessionStorage.removeItem(STORAGE.tokenSession);
    localStorage.removeItem(STORAGE.tokenPersistent);
    if (!token) {
      return;
    }
    if (remember) {
      localStorage.setItem(STORAGE.tokenPersistent, token);
    } else {
      sessionStorage.setItem(STORAGE.tokenSession, token);
    }
  } catch {
    showToast("令牌只能保留在当前页面会话中。", "error");
  }
}

function loadStoredToken() {
  return (
    readStorage(sessionStorage, STORAGE.tokenSession) ||
    readStorage(localStorage, STORAGE.tokenPersistent) ||
    ""
  );
}

function loadStoredSettings() {
  const raw = readStorage(localStorage, STORAGE.settings);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readStorage(storage, key) {
  try {
    return storage.getItem(key) || "";
  } catch {
    return "";
  }
}

function isUsableData(data) {
  return Boolean(data) && validateData(data).valid;
}

function isConfigured() {
  return Boolean(state.settings.owner && state.settings.repo);
}

function repositoryTargetKey(settings) {
  if (!settings?.owner || !settings?.repo) {
    return "local";
  }
  return `${settings.owner}/${settings.repo}@${settings.branch}:${settings.dataPath}`;
}

function buildCommitMessage(reason) {
  return `chore(vocabulary): ${reason} (${state.data.entries.length} entries)`;
}

function githubContentsUrl(settings) {
  const encodedPath = settings.dataPath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `${GITHUB_API}/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(
    settings.repo,
  )}/contents/${encodedPath}`;
}

function githubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function githubResponseError(response, prefix) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = payload?.message || "";
  } catch {
    detail = "";
  }

  let hint = "";
  if (response.status === 401) {
    hint = "令牌无效或已过期。";
  } else if (response.status === 403) {
    hint = "权限不足或 GitHub 请求频率受限。";
  } else if (response.status === 404) {
    hint = "仓库、分支或 data/vocabulary.json 不存在，或该仓库不是公开仓库。";
  } else if (response.status === 409) {
    hint = "文件版本已变化，需要先重新读取。";
  }
  return new Error(`${prefix}（HTTP ${response.status}）${detail || hint}`);
}

function assertConnectionFields(settings) {
  if (!settings.owner || !settings.repo) {
    throw new Error("请填写 GitHub 用户名和仓库名。");
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(settings.owner)) {
    throw new Error("GitHub 用户名或组织名格式不正确。");
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(settings.repo)) {
    throw new Error("仓库名格式不正确。");
  }
  if (!/^[A-Za-z0-9/_.-]+$/.test(settings.dataPath)) {
    throw new Error("数据文件路径格式不正确。");
  }
}

function inferRepositoryFromPages() {
  const hostname = location.hostname.toLowerCase();
  if (!hostname.endsWith(".github.io")) {
    return { owner: "", repo: "" };
  }

  const owner = hostname.slice(0, -".github.io".length);
  const firstPathPart = location.pathname.split("/").filter(Boolean)[0] || "";
  return {
    owner,
    repo: firstPathPart || `${owner}.github.io`,
  };
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function fieldValue(name) {
  return elements.entryForm.elements.namedItem(name)?.value || "";
}

function isBlankDefinition(definition) {
  return (
    !definition.dictionary &&
    !definition.partOfSpeech &&
    !definition.definitionEn &&
    !definition.definitionZh &&
    !definition.url &&
    definition.examples.every((example) => !example.en && !example.zh)
  );
}

function isBlankPersonalExample(example) {
  return (
    !example.en &&
    !example.zh &&
    !example.source &&
    !example.encounteredAt &&
    !example.note
  );
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "未知时间";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDateOnly(value) {
  if (!value) {
    return "";
  }
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function localDateStamp() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function safeWebUrl(value) {
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function clone(value) {
  if (globalThis.structuredClone) {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function selectedIdFromHash() {
  const match = location.hash.match(/^#\/entry\/(.+)$/);
  if (!match) {
    return "";
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function writeEntryHash() {
  const nextHash = state.selectedId ? `#/entry/${encodeURIComponent(state.selectedId)}` : "";
  if (location.hash === nextHash) {
    return;
  }
  history.replaceState(null, "", `${location.pathname}${location.search}${nextHash}`);
}

function initializeTheme() {
  let storedTheme = readStorage(localStorage, STORAGE.theme);
  if (!["light", "dark"].includes(storedTheme)) {
    storedTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  applyTheme(storedTheme);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  elements.themeToggle.setAttribute(
    "aria-label",
    theme === "dark" ? "切换浅色模式" : "切换深色模式",
  );
  elements.themeToggle.title = theme === "dark" ? "切换浅色模式" : "切换深色模式";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#151b19" : "#f4f1e8");
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  try {
    localStorage.setItem(STORAGE.theme, nextTheme);
  } catch {
    // Theme persistence is optional.
  }
}

function showToast(message, kind = "success", duration = 4000) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.kind = kind;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, duration);
}

function openMobileSidebar() {
  document.body.classList.add("sidebar-open");
  elements.sidebarToggle.setAttribute("aria-expanded", "true");
}

function closeMobileSidebar() {
  document.body.classList.remove("sidebar-open");
  elements.sidebarToggle.setAttribute("aria-expanded", "false");
}

function toggleMobileSidebar() {
  if (document.body.classList.contains("sidebar-open")) {
    closeMobileSidebar();
  } else {
    openMobileSidebar();
  }
}

function bindEvents() {
  elements.searchInput.addEventListener("input", () => {
    state.query = elements.searchInput.value;
    render();
  });

  elements.statusFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-status]");
    if (!button) {
      return;
    }
    state.status = button.dataset.status;
    render();
  });

  elements.tagCloud.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tag]");
    if (!button) {
      return;
    }
    const selectedTag = button.dataset.tag;
    state.tag = normalizeSearch(state.tag) === normalizeSearch(selectedTag) ? "" : selectedTag;
    render();
  });

  elements.entryList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-entry-id]");
    if (card) {
      selectEntry(card.dataset.entryId);
    }
  });

  elements.clearFilters.addEventListener("click", clearAllFilters);
  document.querySelector("#clearResultsButton").addEventListener("click", clearAllFilters);
  document.querySelector("#newEntryButton").addEventListener("click", () => openEntryEditor());
  document.querySelector("#welcomeAddButton").addEventListener("click", () => openEntryEditor());
  document.querySelector("#editEntryButton").addEventListener("click", () => {
    const entry = state.data.entries.find((item) => item.id === state.selectedId);
    if (entry) {
      openEntryEditor(entry);
    }
  });
  document.querySelector("#deleteEntryButton").addEventListener("click", deleteCurrentEntry);
  document.querySelector("#addEncounterButton").addEventListener("click", () => {
    const entry = state.data.entries.find((item) => item.id === state.selectedId);
    if (!entry) {
      return;
    }
    const draft = clone(entry);
    draft.personalExamples.push(createPersonalExample());
    openEntryEditor(draft, { focusEncounter: true });
  });

  document.querySelector("#addDefinitionButton").addEventListener("click", () => {
    captureEditorFromForm();
    state.editor.definitions.push(createDefinition());
    renderDefinitionEditors();
    elements.definitionEditorList.lastElementChild
      ?.querySelector('[data-definition-field="dictionary"]')
      ?.focus();
  });

  document.querySelector("#addPersonalExampleButton").addEventListener("click", () => {
    captureEditorFromForm();
    state.editor.personalExamples.push(createPersonalExample());
    renderPersonalExampleEditors();
    elements.personalExampleEditorList.lastElementChild
      ?.querySelector('[data-personal-field="en"]')
      ?.focus();
  });

  elements.entryForm.addEventListener("click", handleEntryFormClick);
  elements.entryForm.addEventListener("submit", saveEntry);
  elements.settingsForm.addEventListener("submit", saveSettings);
  elements.testConnectionButton.addEventListener("click", testGithubConnection);
  document.querySelector("#exportButton").addEventListener("click", exportLibrary);
  document.querySelector("#importButton").addEventListener("click", () => {
    elements.importInput.value = "";
    elements.importInput.click();
  });
  elements.importInput.addEventListener("change", () => {
    importLibrary(elements.importInput.files?.[0]);
  });

  document.querySelector("#settingsButton").addEventListener("click", openSettings);
  elements.syncStatus.addEventListener("click", openSettings);
  elements.themeToggle.addEventListener("click", toggleTheme);
  elements.sidebarToggle.addEventListener("click", toggleMobileSidebar);
  elements.sidebarScrim.addEventListener("click", closeMobileSidebar);

  document.querySelectorAll(".close-dialog").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });

  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        const bounds = dialog.getBoundingClientRect();
        const inside =
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom;
        if (!inside) {
          dialog.close();
        }
      }
    });
  }

  window.addEventListener("hashchange", () => {
    const id = selectedIdFromHash();
    if (id && id !== state.selectedId) {
      selectEntry(id);
    }
  });

  window.addEventListener("keydown", (event) => {
    const dialogOpen = document.querySelector("dialog[open]");
    const target = event.target;
    const isTyping =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      closeMobileSidebar();
      elements.searchInput.focus();
      elements.searchInput.select();
      return;
    }

    if (!dialogOpen && !isTyping && event.key === "/") {
      event.preventDefault();
      closeMobileSidebar();
      elements.searchInput.focus();
      return;
    }

    if (!dialogOpen && !isTyping && !event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      openEntryEditor();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

function registerServiceWorker() {
  const localHost = ["localhost", "127.0.0.1"].includes(location.hostname);
  if ("serviceWorker" in navigator && (location.protocol === "https:" || localHost)) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        // The application remains fully usable without offline caching.
      });
    });
  }
}
