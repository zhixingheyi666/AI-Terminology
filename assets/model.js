export const SCHEMA_VERSION = 1;

export const STATUS_LABELS = Object.freeze({
  learning: "学习中",
  review: "待复习",
  mastered: "已掌握",
});

export const STATUS_VALUES = Object.freeze(Object.keys(STATUS_LABELS));

export function createId(prefix = "entry") {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function createDefinition() {
  return {
    id: createId("definition"),
    dictionary: "",
    partOfSpeech: "",
    definitionEn: "",
    definitionZh: "",
    url: "",
    examples: [],
  };
}

export function createDefinitionExample(values = {}) {
  return {
    en: stringValue(values.en),
    zh: stringValue(values.zh),
  };
}

export function createPersonalExample(values = {}) {
  return {
    id: stringValue(values.id) || createId("encounter"),
    en: stringValue(values.en),
    zh: stringValue(values.zh),
    source: stringValue(values.source),
    encounteredAt: stringValue(values.encounteredAt),
    note: stringValue(values.note),
  };
}

export function createEntry(values = {}) {
  const timestamp = nowIso();
  return {
    id: stringValue(values.id) || createId("entry"),
    term: stringValue(values.term),
    phonetic: stringValue(values.phonetic),
    status: STATUS_VALUES.includes(values.status) ? values.status : "learning",
    tags: normalizeTags(values.tags),
    reviewTags: normalizeTags(values.reviewTags),
    definitions: Array.isArray(values.definitions)
      ? values.definitions.map(normalizeDefinition)
      : [createDefinition()],
    personalExamples: Array.isArray(values.personalExamples)
      ? values.personalExamples.map(normalizePersonalExample)
      : [],
    notes: stringValue(values.notes),
    createdAt: stringValue(values.createdAt) || timestamp,
    updatedAt: stringValue(values.updatedAt) || timestamp,
  };
}

export function createEmptyData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: nowIso(),
    entries: [],
  };
}

export function normalizeData(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const entries = Array.isArray(source.entries) ? source.entries : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: stringValue(source.updatedAt) || nowIso(),
    entries: entries.map(normalizeEntry),
  };
}

export function normalizeEntry(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const timestamp = nowIso();

  return {
    id: stringValue(source.id) || createId("entry"),
    term: stringValue(source.term),
    phonetic: stringValue(source.phonetic),
    status: STATUS_VALUES.includes(source.status) ? source.status : "learning",
    tags: normalizeTags(source.tags),
    reviewTags: normalizeTags(source.reviewTags),
    definitions: Array.isArray(source.definitions)
      ? source.definitions.map(normalizeDefinition)
      : [],
    personalExamples: Array.isArray(source.personalExamples)
      ? source.personalExamples.map(normalizePersonalExample)
      : [],
    notes: stringValue(source.notes),
    createdAt: stringValue(source.createdAt) || timestamp,
    updatedAt: stringValue(source.updatedAt) || timestamp,
  };
}

export function normalizeDefinition(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    id: stringValue(source.id) || createId("definition"),
    dictionary: stringValue(source.dictionary),
    partOfSpeech: stringValue(source.partOfSpeech),
    definitionEn: stringValue(source.definitionEn),
    definitionZh: stringValue(source.definitionZh),
    url: stringValue(source.url),
    examples: Array.isArray(source.examples)
      ? source.examples.map(createDefinitionExample)
      : [],
  };
}

export function normalizePersonalExample(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return createPersonalExample(source);
}

export function normalizeTags(tags) {
  const source = Array.isArray(tags) ? tags : stringValue(tags).split(/[,，;；]/);
  const seen = new Set();
  const result = [];

  for (const item of source) {
    const tag = stringValue(item).replace(/^#/, "").trim();
    const key = tag.toLocaleLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      result.push(tag);
    }
  }

  return result;
}

export function validateData(raw) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      valid: false,
      errors: ["文件根节点必须是一个 JSON 对象。"],
      warnings,
    };
  }

  if (raw.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须是 ${SCHEMA_VERSION}。`);
  }

  if (!isIsoDate(raw.updatedAt)) {
    errors.push("updatedAt 必须是有效的 ISO 日期时间。");
  }

  if (!Array.isArray(raw.entries)) {
    errors.push("entries 必须是数组。");
    return { valid: false, errors, warnings };
  }

  const allIds = new Set();
  const terms = new Map();

  raw.entries.forEach((entry, entryIndex) => {
    const path = `entries[${entryIndex}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${path} 必须是对象。`);
      return;
    }

    registerUniqueId(entry.id, `${path}.id`, allIds, errors);
    requireString(entry.term, `${path}.term`, errors);

    if (!STATUS_VALUES.includes(entry.status)) {
      errors.push(`${path}.status 必须是 learning、review 或 mastered。`);
    }

    if (!Array.isArray(entry.tags) || entry.tags.some((tag) => typeof tag !== "string")) {
      errors.push(`${path}.tags 必须是字符串数组。`);
    }

    if (
      entry.reviewTags !== undefined &&
      (!Array.isArray(entry.reviewTags) ||
        entry.reviewTags.some((tag) => typeof tag !== "string"))
    ) {
      errors.push(`${path}.reviewTags 必须是字符串数组。`);
    }

    const normalizedTerm = stringValue(entry.term).toLocaleLowerCase();
    if (normalizedTerm) {
      if (terms.has(normalizedTerm)) {
        warnings.push(
          `“${stringValue(entry.term)}”在 entries[${terms.get(normalizedTerm)}] 和 ${path} 中重复；建议把多个释义合并到同一条词项。`,
        );
      } else {
        terms.set(normalizedTerm, entryIndex);
      }
    }

    if (!Array.isArray(entry.definitions) || entry.definitions.length === 0) {
      errors.push(`${path}.definitions 至少需要一个词典来源。`);
    } else {
      entry.definitions.forEach((definition, definitionIndex) => {
        validateDefinition(
          definition,
          `${path}.definitions[${definitionIndex}]`,
          allIds,
          errors,
        );
      });
    }

    if (!Array.isArray(entry.personalExamples)) {
      errors.push(`${path}.personalExamples 必须是数组。`);
    } else {
      entry.personalExamples.forEach((example, exampleIndex) => {
        validatePersonalExample(
          example,
          `${path}.personalExamples[${exampleIndex}]`,
          allIds,
          errors,
        );
      });
    }

    if (entry.notes !== undefined && typeof entry.notes !== "string") {
      errors.push(`${path}.notes 必须是字符串。`);
    }

    if (!isIsoDate(entry.createdAt)) {
      errors.push(`${path}.createdAt 必须是有效的 ISO 日期时间。`);
    }

    if (!isIsoDate(entry.updatedAt)) {
      errors.push(`${path}.updatedAt 必须是有效的 ISO 日期时间。`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function filterEntries(entries, filters = {}) {
  const queryTokens = normalizeSearch(filters.query).split(/\s+/).filter(Boolean);
  const status = filters.status || "all";
  const tag = normalizeSearch(filters.tag);
  const reviewOnly = Boolean(filters.reviewOnly);

  return entries.filter((entry) => {
    if (status !== "all" && entry.status !== status) {
      return false;
    }

    if (reviewOnly && !(entry.reviewTags?.length > 0)) {
      return false;
    }

    if (
      tag &&
      ![...entry.tags, ...(entry.reviewTags || [])].some(
        (entryTag) => normalizeSearch(entryTag) === tag,
      )
    ) {
      return false;
    }

    if (queryTokens.length === 0) {
      return true;
    }

    const searchable = normalizeSearch(entrySearchText(entry));
    return queryTokens.every((token) => searchable.includes(token));
  });
}

export function entrySearchText(entry) {
  const definitions = Array.isArray(entry.definitions)
    ? entry.definitions.flatMap((definition) => [
        definition.dictionary,
        definition.partOfSpeech,
        definition.definitionEn,
        definition.definitionZh,
        ...(Array.isArray(definition.examples)
          ? definition.examples.flatMap((example) => [example.en, example.zh])
          : []),
      ])
    : [];

  const personalExamples = Array.isArray(entry.personalExamples)
    ? entry.personalExamples.flatMap((example) => [
        example.en,
        example.zh,
        example.source,
        example.note,
        example.encounteredAt,
      ])
    : [];

  return [
    entry.term,
    entry.phonetic,
    ...(Array.isArray(entry.tags) ? entry.tags : []),
    ...(Array.isArray(entry.reviewTags) ? entry.reviewTags : []),
    ...definitions,
    ...personalExamples,
    entry.notes,
  ]
    .filter(Boolean)
    .join(" ");
}

export function collectTags(entries) {
  const tags = new Map();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      const key = normalizeSearch(tag);
      const current = tags.get(key);
      tags.set(key, {
        label: current?.label || tag,
        count: (current?.count || 0) + 1,
      });
    }
  }

  return [...tags.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"),
  );
}

export function sortEntriesByUpdated(entries) {
  return [...entries].sort((a, b) => {
    const dateCompare = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    return dateCompare || a.term.localeCompare(b.term, "en");
  });
}

export function sortEntriesByCreated(entries) {
  return [...entries].sort((a, b) => {
    const dateCompare = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return dateCompare || a.term.localeCompare(b.term, "en");
  });
}

export function displayEntrySnippet(entry) {
  const personal = stringValue(entry.personalExamples?.[0]?.en);
  if (personal) {
    return personal;
  }

  const definition = entry.definitions?.[0];
  return (
    stringValue(definition?.definitionZh) ||
    stringValue(definition?.definitionEn) ||
    stringValue(entry.notes) ||
    "尚未添加释义"
  );
}

export function normalizeSearch(value) {
  return stringValue(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateDefinition(definition, path, allIds, errors) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    errors.push(`${path} 必须是对象。`);
    return;
  }

  registerUniqueId(definition.id, `${path}.id`, allIds, errors);
  requireString(definition.dictionary, `${path}.dictionary`, errors);

  for (const field of ["partOfSpeech", "definitionEn", "definitionZh"]) {
    if (definition[field] !== undefined && typeof definition[field] !== "string") {
      errors.push(`${path}.${field} 必须是字符串。`);
    }
  }

  if (
    (typeof definition.definitionEn !== "string" || !definition.definitionEn.trim()) &&
    (typeof definition.definitionZh !== "string" || !definition.definitionZh.trim())
  ) {
    errors.push(`${path} 至少需要一条英文或中文释义。`);
  }

  if (definition.url) {
    try {
      const url = new URL(definition.url);
      if (!["http:", "https:"].includes(url.protocol)) {
        errors.push(`${path}.url 必须使用 http 或 https。`);
      }
    } catch {
      errors.push(`${path}.url 不是有效网址。`);
    }
  }

  if (!Array.isArray(definition.examples)) {
    errors.push(`${path}.examples 必须是数组。`);
    return;
  }

  definition.examples.forEach((example, exampleIndex) => {
    if (!example || typeof example !== "object") {
      errors.push(`${path}.examples[${exampleIndex}] 必须是对象。`);
      return;
    }
    if (typeof example.en !== "string" || typeof example.zh !== "string") {
      errors.push(`${path}.examples[${exampleIndex}] 的 en 和 zh 必须是字符串。`);
    }
  });
}

function validatePersonalExample(example, path, allIds, errors) {
  if (!example || typeof example !== "object" || Array.isArray(example)) {
    errors.push(`${path} 必须是对象。`);
    return;
  }

  registerUniqueId(example.id, `${path}.id`, allIds, errors);
  requireString(example.en, `${path}.en`, errors);

  for (const field of ["zh", "source", "note"]) {
    if (example[field] !== undefined && typeof example[field] !== "string") {
      errors.push(`${path}.${field} 必须是字符串。`);
    }
  }

  if (
    example.encounteredAt &&
    !/^\d{4}-\d{2}-\d{2}$/.test(example.encounteredAt)
  ) {
    errors.push(`${path}.encounteredAt 必须使用 YYYY-MM-DD 格式。`);
  }
}

function registerUniqueId(value, path, allIds, errors) {
  requireString(value, path, errors);
  if (typeof value !== "string" || !value.trim()) {
    return;
  }

  const id = value.trim();
  if (allIds.has(id)) {
    errors.push(`${path} 与其他对象的 id 重复：${id}`);
  } else {
    allIds.add(id);
  }
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} 必须是非空字符串。`);
  }
}

function stringValue(value) {
  return value == null ? "" : String(value).trim();
}
