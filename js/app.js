/* GitBook-style bilingual optional reader */
(function () {
  const CATALOG_URL = "catalog.json";

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  function params() {
    return new URLSearchParams(location.search);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function loadCatalog() {
    const res = await fetch(CATALOG_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error("无法加载 catalog.json");
    return res.json();
  }

  function bookById(catalog, id) {
    return (catalog.books || []).find((b) => b.id === id || b.slug === id);
  }

  /** Flatten hierarchical toc pages in order */
  function flattenPages(toc) {
    const out = [];
    const walk = (nodes) => {
      for (const n of nodes || []) {
        if (n.type === "page") out.push(n);
        else if (n.children) walk(n.children);
      }
    };
    walk(toc || []);
    return out;
  }

  function findPageMeta(book, chapterId) {
    const pages = flattenPages(book.toc);
    return pages.find((p) => p.id === chapterId) || null;
  }

  function findGroupPath(toc, chapterId, trail = []) {
    for (const n of toc || []) {
      if (n.type === "page" && n.id === chapterId) return trail;
      if (n.type === "group") {
        const found = findGroupPath(n.children, chapterId, trail.concat(n));
        if (found) return found;
      }
    }
    return null;
  }

  function rewriteMdAssets(md, bookPath) {
    return md
      .replace(/\]\((\.\.\/)+assets\/figures\//g, `](${bookPath}/assets/figures/`)
      .replace(/\]\(assets\/figures\//g, `](${bookPath}/assets/figures/`);
  }

  function pageLabelKey(line) {
    return line.trim()
      .replace(/^#{1,6}\s*/, "")
      .replace(/[`*_~]/g, "")
      .replace(/\s+/g, " ")
      .toLocaleLowerCase();
  }

  function isPageLabelLine(line) {
    const trimmed = line.trim();
    if (!trimmed || /^<!--|^!\[|^>|^\|/.test(trimmed)) return false;
    const key = pageLabelKey(trimmed);
    return key.length >= 5 && key.length <= 100 && !/[.!?。！？;；]$/.test(trimmed);
  }

  function normalizedTitle(value) {
    return value.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, "");
  }

  function titleVariants(value) {
    const title = value.trim().replace(/^#{1,6}\s*/, "");
    const withoutChapterNumber = title
      .replace(/^第\s*[0-9一二三四五六七八九十百]+\s*章\s*/i, "")
      .replace(/^chapter\s+[0-9]+\s*[:.\-–—]?\s*/i, "");
    // Short headings such as “Failures” can be ordinary prose at a page start.
    return [...new Set([title, withoutChapterNumber].map(normalizedTitle).filter((item) => item.length >= 12))];
  }

  function matchingTitlePrefixEnd(text, normalized) {
    let matched = 0;
    for (let index = 0; index < text.length;) {
      const point = text.codePointAt(index);
      const char = String.fromCodePoint(point);
      const key = normalizedTitle(char);
      index += char.length;
      if (!key) continue;
      if (!normalized.startsWith(key, matched)) return -1;
      matched += key.length;
      if (matched === normalized.length) return index;
    }
    return -1;
  }

  function stripRepeatedPrintedTitles(md, pageMeta, lang) {
    const marker = /<!--\s*PDF page \d+\s*-->/gi;
    const matches = [...md.matchAll(marker)];
    if (matches.length < 2) return md;

    const headings = [...md.slice(0, matches[0].index).matchAll(/^#{1,6}\s+(.+)$/gm)]
      .map((match) => match[1]);
    const metadataTitle = pageMeta?.[lang === "en" ? "title_en" : "title_zh"];
    const candidates = [...new Set([metadataTitle, ...headings].filter(Boolean)
      .flatMap(titleVariants))];
    if (!candidates.length) return md;

    const pages = matches.map((match, index) => {
      const start = match.index + match[0].length;
      const end = matches[index + 1]?.index ?? md.length;
      const text = md.slice(start, end);
      // Printed running titles can follow a figure/caption, so inspect a few
      // opening blocks. Staying near the page boundary avoids body references.
      const lines = text.split("\n");
      let chars = 0;
      const leadingLines = [];
      for (let lineIndex = 0; lineIndex < lines.length && leadingLines.length < 10 && chars < 1800; lineIndex++) {
        const line = lines[lineIndex];
        chars += line.length + 1;
        if (line.trim()) leadingLines.push({ line, lineIndex });
      }
      return { start, end, text, lines, leadingLines };
    });

    const occurrences = new Map(candidates.map((candidate) => [candidate, 0]));
    for (const page of pages) {
      for (const candidate of candidates) {
        if (page.leadingLines.some(({ line }) => matchingTitlePrefixEnd(line.trimStart(), candidate) >= 0)) {
          occurrences.set(candidate, occurrences.get(candidate) + 1);
        }
      }
    }
    const repeated = new Set([...occurrences].filter(([, count]) => count >= 2).map(([title]) => title));
    if (!repeated.size) return md;

    const edits = [];
    for (const page of pages) {
      for (const { line, lineIndex } of page.leadingLines) {
        const leadingWhitespace = line.match(/^\s*/)?.[0].length || 0;
        const content = line.slice(leadingWhitespace);
        const candidate = [...repeated].sort((a, b) => b.length - a.length)
          .find((title) => matchingTitlePrefixEnd(content, title) >= 0);
        if (!candidate) continue;
        const titleEnd = matchingTitlePrefixEnd(content, candidate);
        const remainder = content.slice(titleEnd);
        let offset = 0;
        for (let i = 0; i < lineIndex; i++) offset += page.lines[i].length + 1;
        const start = page.start + offset + leadingWhitespace;
        // Remove the title text only. Any prose, figure label, or image syntax
        // sharing the line remains in place.
        edits.push([start, start + (remainder.trim() ? titleEnd : content.length)]);
      }
    }
    for (const [start, end] of edits.sort((a, b) => b[0] - a[0])) {
      md = md.slice(0, start) + md.slice(end);
    }
    return md;
  }

  function stripPrintedOpeningTitle(md) {
    const heading = md.match(/^#{1,6}\s+(.+)$/m);
    const marker = /<!--\s*PDF page \d+\s*-->/i.exec(md);
    if (!heading || !marker) return md;
    const title = normalizedTitle(heading[1]);
    if (title.length < 6) return md;

    const start = marker.index + marker[0].length;
    const nextMarker = /<!--\s*PDF page \d+\s*-->/i.exec(md.slice(start));
    const end = nextMarker ? start + nextMarker.index : md.length;
    const page = md.slice(start, end);
    let matched = 0;
    let cutAt = -1;
    for (let index = 0; index < page.length;) {
      const point = page.codePointAt(index);
      const char = String.fromCodePoint(point);
      const normalized = normalizedTitle(char);
      index += char.length;
      if (!normalized) continue;
      if (!title.startsWith(normalized, matched)) return md;
      matched += normalized.length;
      if (matched === title.length) { cutAt = index; break; }
    }
    if (cutAt < 0) return md;
    const remainder = page.slice(cutAt).replace(/^[\s#*_~]+/, "");
    return md.slice(0, start) + remainder + md.slice(end);
  }

  function stripRepeatedPageLabels(md) {
    const marker = /<!--\s*PDF page \d+\s*-->/gi;
    const matches = [...md.matchAll(marker)];
    if (matches.length < 2) return md;

    const pages = matches.map((match, index) => {
      const start = match.index + match[0].length;
      const end = matches[index + 1]?.index ?? md.length;
      const text = md.slice(start, end);
      const lines = text.split("\n");
      const first = lines.findIndex((line) => line.trim());
      let last = lines.length - 1;
      while (last >= 0 && !lines[last].trim()) last--;
      return { start, end, lines, first, last };
    });
    const countBoundaryLabels = (side) => {
      const counts = new Map();
      for (const page of pages) {
        const index = page[side];
        if (index < 0 || !isPageLabelLine(page.lines[index])) continue;
        const key = pageLabelKey(page.lines[index]);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return new Set([...counts].filter(([, count]) => count >= 2).map(([key]) => key));
    };
    const repeatedHeaders = countBoundaryLabels("first");
    const repeatedFooters = countBoundaryLabels("last");
    const removals = new Map();

    for (const page of pages) {
      for (const [side, repeated] of [["first", repeatedHeaders], ["last", repeatedFooters]]) {
        const lineIndex = page[side];
        if (lineIndex < 0) continue;
        const line = page.lines[lineIndex];
        if (!isPageLabelLine(line) || !repeated.has(pageLabelKey(line))) continue;
        let offset = 0;
        for (let index = 0; index < lineIndex; index++) offset += page.lines[index].length + 1;
        const start = page.start + offset;
        removals.set(start, start + line.length);
      }
    }
    for (const [start, end] of [...removals].sort((a, b) => b[0] - a[0])) md = md.slice(0, start) + md.slice(end);
    return md;
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`加载失败 ${url} (${res.status})`);
    return res.text();
  }

  function getMarked() {
    // UMD build exposes window.marked as the API object (has .parse)
    // Some builds also set marked.marked
    const m = typeof marked !== "undefined" ? marked : null;
    if (!m) return null;
    if (typeof m.parse === "function") return m;
    if (m.marked && typeof m.marked.parse === "function") return m.marked;
    if (typeof m === "function") return { parse: m, setOptions: m.setOptions?.bind(m) };
    return null;
  }

  function renderMarkdown(md, bookPath, pageMeta, lang) {
    const cleaned = stripRepeatedPageLabels(stripRepeatedPrintedTitles(stripPrintedOpeningTitle(md), pageMeta, lang));
    const fixed = rewriteMdAssets(cleaned, bookPath);
    // Keep source PDF page boundaries available to the live bilingual matcher.
    // This only changes rendered DOM; the source Markdown remains untouched.
    const withPageMarkers = fixed.replace(/<!--\s*PDF page (\d+)\s*-->/gi,
      '\n\n<div class="alignment-page-marker" data-pdf-page="$1" aria-hidden="true"></div>\n\n');
    const m = getMarked();
    if (!m) {
      console.error("marked.js failed to load; showing plain text fallback");
      return `<pre class="md-fallback whitespace-pre-wrap text-sm text-slate-800">${escapeHtml(fixed)}</pre>`;
    }
    if (typeof m.setOptions === "function") {
      m.setOptions({ gfm: true, breaks: false });
    }
    return m.parse(withPageMarkers);
  }

  const STORAGE_PREFIX = "price-action-reader:v1:";
  const alignmentBreakpoint = window.matchMedia("(min-width: 1024px)");
  let toastTimer = 0;
  let pendingHighlight = null;
  let glossaryEntries = null;
  let alignmentSnapshot = null;
  let imageFocusPanel = null;
  let imageFocusMode = null;

  async function loadGlossary(book) {
    if (glossaryEntries) return glossaryEntries;
    const base = book.path || `books/${book.id}`;
    const payload = JSON.parse(await fetchText(`${base}/glossary/terms.json`));
    glossaryEntries = (payload.entries || []).map((entry) => ({
      ...entry,
      terms: [...new Set([...(entry.aliases_en || []), ...(entry.aliases_zh || [])])]
        .map((term) => term.trim()).filter((term) => term.length > 1)
    })).sort((a, b) => Math.max(...b.terms.map((term) => term.length)) - Math.max(...a.terms.map((term) => term.length)));
    return glossaryEntries;
  }

  async function linkGlossaryTerms(root, book) {
    if (!root) return;
    let entries;
    try { entries = await loadGlossary(book); } catch (_) { return; }
    const candidates = entries.flatMap((entry) => entry.terms.map((term) => ({ term, entry })))
      .filter(({ term }) => term.length >= 2).sort((a, b) => b.term.length - a.term.length);
    const escaped = [...new Set(candidates.map(({ term }) => term))]
      .map((term) => {
        const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return /^[A-Za-z0-9]/.test(term) ? `(?<![A-Za-z0-9])${safe}(?![A-Za-z0-9])` : safe;
      });
    if (!escaped.length) return;
    const pattern = new RegExp(escaped.join("|"), "giu");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim() || node.parentElement.closest("a,code,pre,script,style,mark,[data-glossary-term]")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const textNodes = []; while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const textNode of textNodes) {
      const text = textNode.nodeValue; pattern.lastIndex = 0;
      const matches = [...text.matchAll(pattern)];
      if (!matches.length) continue;
      const fragment = document.createDocumentFragment(); let offset = 0;
      for (const match of matches) {
        if (match.index < offset) continue;
        fragment.append(document.createTextNode(text.slice(offset, match.index)));
        const term = match[0];
        const entry = candidates.find((candidate) => candidate.term.toLocaleLowerCase() === term.toLocaleLowerCase())?.entry;
        if (!entry) { fragment.append(document.createTextNode(term)); offset = match.index + term.length; continue; }
        const link = document.createElement("button");
        link.type = "button"; link.className = "glossary-term"; link.dataset.glossaryTerm = String(entry.id);
        link.textContent = term; link.setAttribute("aria-label", `查看术语解释：${term}`);
        fragment.append(link); offset = match.index + term.length;
      }
      fragment.append(document.createTextNode(text.slice(offset)));
      textNode.replaceWith(fragment);
    }
  }

  function unlinkGlossaryTerms(root) {
    if (!root) return;
    root.querySelectorAll("button.glossary-term").forEach((link) => {
      link.replaceWith(document.createTextNode(link.textContent || ""));
    });
  }

  function isContentsPage(chapterId) {
    return /^(?:00|01)-contents$/.test(chapterId || "");
  }

  function showGlossaryEntry(id) {
    const entry = glossaryEntries?.find((item) => item.id === id);
    if (!entry) return;
    $("#glossary-title").textContent = entry.term_en || entry.term_zh || "术语解释";
    const aliases = [...new Set([...(entry.aliases_en || []), ...(entry.aliases_zh || [])])];
    const content = [];
    if (entry.term_zh) content.push(`<p class="glossary-translation">${escapeHtml(entry.term_zh)}</p>`);
    if (entry.definition_zh) content.push(`<section class="glossary-definition"><h3>中文释义</h3><p>${escapeHtml(entry.definition_zh)}</p></section>`);
    if (entry.definition_en) content.push(`<section class="glossary-definition"><h3>English definition</h3><p>${escapeHtml(entry.definition_en)}</p></section>`);
    if (entry.note) content.push(`<section class="glossary-definition"><h3>补充说明</h3><p>${escapeHtml(entry.note)}</p></section>`);
    if (entry.source_type === "ai_generated_supplement") content.push('<p class="result-meta">释义由 AI 生成，依据本书 glossary.md 中的术语及备注整理；本书“本书所用术语表”章节未提供该词条的独立定义。</p>');
    else if (entry.source_type === "supplement_only") content.push('<p class="result-meta">本书“本书所用术语表”章节没有该词条的独立定义；以上为术语对照表提供的译名或备注。</p>');
    else content.push('<p class="result-meta">释义来源：本书“本书所用术语表”章节。</p>');
    const otherAliases = aliases.filter((term) => term !== entry.term_en && term !== entry.term_zh);
    if (otherAliases.length) content.push(`<p class="result-meta">别名：${escapeHtml(otherAliases.join(" / "))}</p>`);
    $("#glossary-content").innerHTML = content.join("");
    openDialog("glossary-dialog");
  }

  function readLocal(key, fallback) {
    try {
      const value = localStorage.getItem(STORAGE_PREFIX + key);
      return value ? JSON.parse(value) : fallback;
    } catch (_) { return fallback; }
  }

  function writeLocal(key, value) {
    try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }

  function toast(message) {
    const el = $("#reader-toast");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2300);
  }

  function openDialog(id) {
    const dialog = $("#" + id);
    if (dialog?.showModal) dialog.showModal();
  }

  function currentPosition() {
    const sc = $("#content-scroll");
    return sc && sc.scrollHeight > sc.clientHeight
      ? Math.max(0, Math.min(1, sc.scrollTop / (sc.scrollHeight - sc.clientHeight)))
      : 0;
  }

  function progressKey(bookId) { return `progress:${bookId}`; }
  function bookmarksKey(bookId) { return `bookmarks:${bookId}`; }
  function highlightsKey(bookId, chapterId, lang) { return `highlights:${bookId}:${chapterId}:${lang}`; }
  function noteKey(bookId, chapterId) { return `note:${bookId}:${chapterId}`; }

  function directBlocks(root) {
    return [...(root?.children || [])].filter((el) => el.textContent.trim() || el.querySelector("img,svg"));
  }

  function alignmentPages(root) {
    const pages = [];
    let page = { id: "intro", blocks: [] };
    for (const child of [...(root?.children || [])]) {
      if (child.matches(".alignment-page-marker")) {
        if (page.blocks.length) pages.push(page);
        page = { id: child.dataset.pdfPage || `page-${pages.length + 1}`, blocks: [] };
      } else if (child.textContent.trim() || child.querySelector("img,svg")) page.blocks.push(child);
    }
    if (page.blocks.length) pages.push(page);
    return pages;
  }

  function alignmentBlockKind(block) {
    if (!block) return "missing";
    if (/^H[1-6]$/.test(block.tagName)) return "heading";
    if (block.querySelector("img,svg")) return "media";
    if (["TABLE", "PRE", "UL", "OL", "BLOCKQUOTE"].includes(block.tagName)) return block.tagName.toLowerCase();
    return "text";
  }

  function alignPageBlocks(zhBlocks, enBlocks) {
    // A page is the reliable shared anchor. Within it, only split at matched
    // figures; prose is paired block-by-block only when both sides have the
    // same number of blocks. If paragraphing differs, keep the whole prose run
    // together instead of fabricating a paragraph correspondence.
    const rows = [];
    let zi = 0; let ei = 0;
    while (zi < zhBlocks.length || ei < enBlocks.length) {
      const zImage = zhBlocks.findIndex((block, index) => index >= zi && alignmentBlockKind(block) === "media");
      const eImage = enBlocks.findIndex((block, index) => index >= ei && alignmentBlockKind(block) === "media");
      const zEnd = zImage < 0 ? zhBlocks.length : zImage;
      const eEnd = eImage < 0 ? enBlocks.length : eImage;
      const zRun = zhBlocks.slice(zi, zEnd); const eRun = enBlocks.slice(ei, eEnd);
      if (zRun.length && eRun.length) {
        if (zRun.length === eRun.length) {
          for (let index = 0; index < zRun.length; index++) rows.push([[zRun[index]], [eRun[index]]]);
        } else rows.push([zRun, eRun]);
      } else if (zRun.length) rows.push([zRun, []]);
      else if (eRun.length) rows.push([[], eRun]);

      if (zImage >= 0 && eImage >= 0) {
        rows.push([[zhBlocks[zImage]], [enBlocks[eImage]]]);
        zi = zImage + 1; ei = eImage + 1;
      } else if (zImage >= 0) {
        rows.push([[zhBlocks[zImage]], []]); zi = zImage + 1;
      } else if (eImage >= 0) {
        rows.push([[], [enBlocks[eImage]]]); ei = eImage + 1;
      } else break;
    }
    return rows;
  }

  function clearAlignmentRows(root) {
    directBlocks(root).forEach((block) => {
      block.style.gridRowStart = "";
      block.style.gridColumnStart = "";
    });
  }

  function setBlockRow(block, row, column) {
    if (!block) return;
    block.style.gridRowStart = String(row);
    block.style.gridColumnStart = String(column);
  }

  function closeImageFocus() {
    if (!imageFocusPanel) return;
    const anchor = imageFocusMode === "single" ? captureReadingAnchor() : null;
    imageFocusPanel.remove();
    imageFocusPanel = null;
    const panels = $("#panels");
    panels?.classList.remove("image-focused", "single-image-focused");
    $$(".bilingual-alignment-cell[data-alignment-lang='en']").forEach((cell) => cell.removeAttribute("aria-hidden"));
    imageFocusMode = null;
    if (anchor) restoreReadingAnchor(anchor);
  }

  function captureReadingAnchor() {
    const scroller = $("#content-scroll"); const root = $("#md-zh");
    if (!scroller || !root) return null;
    const viewport = scroller.getBoundingClientRect();
    const element = [...root.children].find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.bottom > viewport.top + 8 && rect.top < viewport.bottom - 8;
    });
    if (!element) return null;
    return { element, offset: element.getBoundingClientRect().top - viewport.top };
  }

  function restoreReadingAnchor(anchor) {
    requestAnimationFrame(() => {
      const scroller = $("#content-scroll");
      if (!scroller || !anchor.element.isConnected) return;
      const viewport = scroller.getBoundingClientRect();
      const offset = anchor.element.getBoundingClientRect().top - viewport.top;
      scroller.scrollTop += offset - anchor.offset;
    });
  }

  function updateImageFocusPosition() {
    if (!imageFocusPanel) return;
    const panels = $("#panels"); const scroller = $("#content-scroll");
    if (!panels || !scroller) return;
    const bounds = panels.getBoundingClientRect(); const scrollBounds = scroller.getBoundingClientRect();
    const gutter = 16;
    imageFocusPanel.style.left = `${bounds.left + bounds.width / 2 + gutter}px`;
    imageFocusPanel.style.top = `${scrollBounds.top + 12}px`;
    imageFocusPanel.style.width = `${Math.max(0, bounds.width / 2 - gutter)}px`;
    imageFocusPanel.style.height = `${Math.max(0, scrollBounds.height - 24)}px`;
  }

  function focusImageInEnglishPanel(image) {
    const panels = $("#panels");
    if (!panels || !alignmentBreakpoint.matches) return false;
    const mode = state.showEn && alignmentSnapshot ? "bilingual" : !state.showEn ? "single" : null;
    if (!mode) return false;

    if (imageFocusPanel) {
      const preview = $("img", imageFocusPanel);
      if (preview) { preview.src = image.currentSrc || image.src; preview.alt = image.alt || "聚焦查看的图片"; }
      const caption = $(".image-focus-caption", imageFocusPanel);
      if (image.alt?.trim() && caption) caption.textContent = image.alt.trim();
      else if (image.alt?.trim()) {
        const label = document.createElement("p");
        label.className = "image-focus-caption";
        label.textContent = image.alt.trim();
        imageFocusPanel.append(label);
      } else caption?.remove();
      return true;
    }

    const anchor = mode === "single" ? captureReadingAnchor() : null;

    const panel = document.createElement("section");
    panel.className = "image-focus-panel";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "聚焦图片");

    const close = document.createElement("button");
    close.type = "button";
    close.className = "image-focus-close";
    close.setAttribute("aria-label", "关闭图片聚焦");
    close.title = "关闭图片聚焦";
    close.textContent = "×";
    close.addEventListener("click", closeImageFocus);

    const preview = document.createElement("img");
    preview.src = image.currentSrc || image.src;
    preview.alt = image.alt || "聚焦查看的图片";
    preview.draggable = false;

    const caption = image.alt?.trim();
    if (caption) {
      const label = document.createElement("p");
      label.className = "image-focus-caption";
      label.textContent = caption;
      panel.append(close, preview, label);
    } else panel.append(close, preview);

    if (mode === "bilingual") {
      panels.classList.add("image-focused");
      $$(".bilingual-alignment-cell[data-alignment-lang='en']").forEach((cell) => cell.setAttribute("aria-hidden", "true"));
    } else panels.classList.add("single-image-focused");
    document.body.append(panel);
    imageFocusPanel = panel;
    imageFocusMode = mode;
    updateImageFocusPosition();
    if (anchor) restoreReadingAnchor(anchor);
    return true;
  }

  function setupAlignment() {
    const panels = $("#panels"); const zh = $("#md-zh"); const en = $("#md-en");
    if (!panels || !zh || !en) return;
    const active = !!(state.showEn && state.enLoadedFor && alignmentBreakpoint.matches);
    if (active && alignmentSnapshot) return;
    if (!active) restoreAlignedContent();
    panels.classList.toggle("aligned", active);
    panels.style.gridTemplateColumns = active ? "minmax(0, 1fr) minmax(0, 1fr)" : "";
    if (!active) return;

    const zhChildren = [...zh.childNodes]; const enChildren = [...en.childNodes];
    const zhPages = alignmentPages(zh); const enPages = alignmentPages(en);
    const zhByPage = new Map(zhPages.map((page) => [page.id, page]));
    const enByPage = new Map(enPages.map((page) => [page.id, page]));
    const pageIds = [...new Set([...zhPages.map((page) => page.id), ...enPages.map((page) => page.id)])];
    const rows = [];
    for (const pageId of pageIds) {
      const left = zhByPage.get(pageId)?.blocks || [];
      const right = enByPage.get(pageId)?.blocks || [];
      if (left.length && right.length) {
        for (const [zGroup, eGroup] of alignPageBlocks(left, right)) rows.push([zGroup, eGroup]);
      } else {
        const remaining = left.length ? left : right;
        for (const block of remaining) rows.push(left.length ? [[block], []] : [[], [block]]);
      }
    }
    alignmentSnapshot = { zh, en, zhChildren, enChildren };
    zh.replaceChildren(); en.replaceChildren();
    $("#en-panel").classList.add("hidden");
    zh.parentElement.classList.add("hidden");
    for (const [zhBlocks, enBlocks] of rows) {
      const row = document.createElement("div"); row.className = "bilingual-alignment-row";
      row.append(alignmentCell("zh", zhBlocks), alignmentCell("en", enBlocks));
      panels.append(row);
    }
  }

  function alignmentCell(lang, blocks) {
    const cell = document.createElement("div");
    cell.className = `bilingual-alignment-cell prose-gitbook md-body${lang === "en" ? " text-[0.95rem] text-slate-700" : ""}`;
    cell.dataset.alignmentLang = lang;
    if (blocks.length) cell.append(...blocks);
    else { cell.setAttribute("aria-hidden", "true"); cell.classList.add("alignment-spacer"); }
    return cell;
  }

  function restoreAlignedContent() {
    closeImageFocus();
    if (!alignmentSnapshot) return;
    const { zh, en, zhChildren, enChildren } = alignmentSnapshot;
    for (const row of [...$("#panels").querySelectorAll(":scope > .bilingual-alignment-row")]) row.remove();
    zh.replaceChildren(...zhChildren); en.replaceChildren(...enChildren);
    zh.parentElement.classList.remove("hidden");
    $("#en-panel").classList.remove("hidden");
    alignmentSnapshot = null;
  }

  function languageRoots(lang) {
    if (alignmentSnapshot) return $$(`.bilingual-alignment-cell[data-alignment-lang="${lang}"]`);
    const root = lang === "en" ? $("#md-en") : $("#md-zh");
    return root ? [root] : [];
  }

  function languageParagraphs(lang) {
    return languageRoots(lang).flatMap((root) => [...root.querySelectorAll("p")]);
  }

  function renderMindmap(nodes, root = false) {
    if (!Array.isArray(nodes) || !nodes.length) return "";
    return `<ul${root ? ' class="mindmap-root"' : ""}>${nodes.map((node) => `<li><span class="mindmap-node">${escapeHtml(node.label || "")}</span>${renderMindmap(node.children || [])}</li>`).join("")}</ul>`;
  }

  async function loadStudyGuide() {
    const content = $("#study-content");
    const book = state.book; const page = findPageMeta(book, state.chapterId);
    if (!page || !/^\d+-ch\d+/.test(page.file || "")) {
      content.innerHTML = '<p class="study-note">本页不是正文主题章，暂无章节整理内容。</p>';
      return;
    }
    content.innerHTML = '<p class="text-slate-500">加载章节整理…</p>';
    const url = `${book.path || `books/${book.id}`}/study-guides/zh/${encodeURIComponent(page.id)}.json`;
    try {
      const guide = JSON.parse(await fetchText(url));
      const bullets = (guide.summary?.key_points || []).map((point) => `<li>${escapeHtml(point)}</li>`).join("");
      content.innerHTML = `
        <h3>${escapeHtml(guide.title || page.title_zh)}</h3>
        <p>${escapeHtml(guide.summary?.overview || "")}</p>
        <h3>核心要点</h3><ul>${bullets}</ul>
        <h3>章节导图</h3><div class="mindmap">${renderMindmap([guide.mindmap], true)}</div>
        <p class="result-meta">整理内容为离线生成；页面不调用在线 AI。</p>`;
    } catch (_) {
      content.innerHTML = '<p class="study-note">本章整理内容尚未生成。整理 agent 可按项目中的章节整理规范生成摘要与导图。</p>';
    }
  }

  function renderBookmarkList() {
    const list = $("#bookmark-list");
    const bookmarks = readLocal(bookmarksKey(state.book.id), []);
    const progress = readLocal(progressKey(state.book.id), null);
    $("#progress-status").textContent = progress
      ? `上次阅读：${findPageMeta(state.book, progress.chapterId)?.title_zh || progress.chapterId} · ${Math.round((progress.ratio || 0) * 100)}%`
      : "尚无阅读记录 · 本地保存于当前浏览器";
    list.innerHTML = "";
    if (!bookmarks.length) list.innerHTML = '<p class="dialog-status">还没有书签。可收藏当前阅读位置。</p>';
    bookmarks.forEach((bookmark, index) => {
      const page = findPageMeta(state.book, bookmark.chapterId);
      const card = document.createElement("div"); card.className = "bookmark-card";
      card.innerHTML = `<div class="bookmark-main"><button type="button" data-jump-bookmark="${index}">${escapeHtml(page?.title_zh || bookmark.chapterId)}</button><p>${Math.round((bookmark.ratio || 0) * 100)}% · ${new Date(bookmark.createdAt).toLocaleString()}</p></div><button type="button" class="bookmark-delete" data-delete-bookmark="${index}">删除</button>`;
      list.appendChild(card);
    });
    list.querySelectorAll("[data-jump-bookmark]").forEach((btn) => btn.addEventListener("click", () => {
      const item = bookmarks[Number(btn.dataset.jumpBookmark)];
      location.href = readerUrl(state.book.id, item.chapterId, state.showEn) + `&pos=${item.ratio || 0}`;
    }));
    list.querySelectorAll("[data-delete-bookmark]").forEach((btn) => btn.addEventListener("click", () => {
      bookmarks.splice(Number(btn.dataset.deleteBookmark), 1);
      writeLocal(bookmarksKey(state.book.id), bookmarks); renderBookmarkList();
    }));
  }

  let searchCache = null;
  async function buildSearchIndex(book) {
    if (searchCache?.bookId === book.id) return searchCache.items;
    const pages = flattenPages(book.toc); const items = [];
    const langs = ["zh", "en"];
    for (const page of pages) {
      for (const lang of langs) {
        const base = book.path || `books/${book.id}`;
        const text = await fetchText(`${base}/${lang}/chapters/${page.file}`).catch(() => "");
        if (text) items.push({ page, lang, text: text.replace(/<!--[^]*?-->/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/[#>*_`|\-]/g, " ").replace(/\s+/g, " ").trim() });
      }
    }
    searchCache = { bookId: book.id, items };
    return items;
  }

  let searchTimer = 0;
  async function runSearch(query) {
    const status = $("#search-status"); const resultsEl = $("#search-results");
    const value = query.trim(); resultsEl.innerHTML = "";
    if (!value) { status.textContent = "输入关键词开始搜索。"; return; }
    status.textContent = "正在读取本书中英文内容…";
    const items = await buildSearchIndex(state.book);
    const q = value.toLocaleLowerCase(); const results = [];
    for (const item of items) {
      const text = item.text.toLocaleLowerCase(); let from = 0; let index;
      while ((index = text.indexOf(q, from)) !== -1 && results.length < 100) {
        const start = Math.max(0, index - 90); const end = Math.min(item.text.length, index + value.length + 120);
        results.push({ ...item, index, snippet: (start ? "…" : "") + item.text.slice(start, end) + (end < item.text.length ? "…" : "") });
        from = index + Math.max(1, q.length);
      }
      if (results.length >= 100) break;
    }
    status.textContent = results.length ? `找到 ${results.length}${results.length === 100 ? "+" : ""} 条结果` : "没有找到匹配内容。";
    results.forEach((result) => {
      const card = document.createElement("div"); card.className = "result-card";
      const title = result.lang === "zh" ? result.page.title_zh : result.page.title_en;
      card.innerHTML = `<div class="result-meta">${result.lang === "zh" ? "中文" : "English"}</div><button type="button">${escapeHtml(title)}</button><p>${escapeHtml(result.snippet)}</p>`;
      card.querySelector("button").addEventListener("click", () => {
        location.href = readerUrl(state.book.id, result.page.id, state.showEn) + `&q=${encodeURIComponent(value)}`;
      });
      resultsEl.appendChild(card);
    });
  }

  function textOffset(root, node, offset) {
    const range = document.createRange(); range.selectNodeContents(root); range.setEnd(node, offset);
    return range.toString().length;
  }

  function wrapTextRange(root, start, end, id) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; let total = 0; let node;
    while ((node = walker.nextNode())) {
      const len = node.nodeValue.length;
      const overlapStart = Math.max(start, total); const overlapEnd = Math.min(end, total + len);
      if (overlapEnd > overlapStart) nodes.push({ node, from: overlapStart - total, to: overlapEnd - total });
      total += len;
    }
    nodes.reverse().forEach(({ node: text, from, to }) => {
      if (text.parentElement?.closest("mark.reader-highlight")) return;
      const after = text.splitText(to); const selected = text.splitText(from);
      const mark = document.createElement("mark"); mark.className = "reader-highlight"; mark.dataset.highlightId = id;
      selected.parentNode.insertBefore(mark, selected); mark.appendChild(selected);
      void after;
    });
  }

  function restoreHighlights(root, bookId, chapterId, lang) {
    const records = readLocal(highlightsKey(bookId, chapterId, lang), []);
    records.sort((a, b) => b.start - a.start).forEach((record) => {
      const blocks = Array.isArray(root) ? root.flatMap((item) => [...item.querySelectorAll("p")]) : [...root.querySelectorAll("p")];
      const block = blocks[record.blockIndex];
      if (!block) { record.unavailable = true; return; }
      const text = block.textContent;
      let start = record.start;
      if (text.slice(start, start + record.quote.length) !== record.quote) {
        const candidates = []; let at = text.indexOf(record.quote);
        while (at >= 0) { candidates.push(at); at = text.indexOf(record.quote, at + 1); }
        const matching = candidates.find((n) => text.slice(Math.max(0, n - record.prefix.length), n) === record.prefix && text.slice(n + record.quote.length, n + record.quote.length + record.suffix.length) === record.suffix);
        if (matching === undefined) { record.unavailable = true; return; }
        start = matching;
      }
      wrapTextRange(block, start, start + record.quote.length, record.id);
      record.start = start; record.unavailable = false;
    });
    writeLocal(highlightsKey(bookId, chapterId, lang), records);
  }

  function renderHighlightsList() {
    const list = $("#highlight-list"); if (!list || !state.book) return;
    list.innerHTML = "";
    const entries = ["zh", "en"].flatMap((lang) => readLocal(highlightsKey(state.book.id, state.chapterId, lang), [])
      .map((record) => ({ ...record, lang })));
    if (!entries.length) { list.innerHTML = '<p class="dialog-status">本章还没有高亮。</p>'; return; }
    entries.forEach((item) => {
      const card = document.createElement("div"); card.className = "result-card";
      card.innerHTML = `<div class="result-meta">${item.lang === "zh" ? "中文" : "English"}${item.unavailable ? " · 原文已变化，无法定位" : ""}</div><p>${escapeHtml(item.quote)}</p><button class="bookmark-delete" type="button" data-remove-highlight="${escapeHtml(item.id)}" data-highlight-lang="${item.lang}">删除高亮</button>`;
      list.appendChild(card);
    });
    list.querySelectorAll("[data-remove-highlight]").forEach((button) => button.addEventListener("click", () => {
      const lang = button.dataset.highlightLang; const id = button.dataset.removeHighlight;
      const key = highlightsKey(state.book.id, state.chapterId, lang);
      writeLocal(key, readLocal(key, []).filter((item) => item.id !== id));
      document.querySelectorAll(`mark.reader-highlight[data-highlight-id="${CSS.escape(id)}"]`).forEach((mark) => mark.replaceWith(...mark.childNodes));
      renderHighlightsList(); toast("高亮已删除。");
    }));
  }

  function saveSelectedHighlight() {
    const toolbar = $("#highlight-toolbar"); const selection = window.getSelection();
    const chosen = pendingHighlight;
    if (!chosen || chosen.bookId !== state.book.id || chosen.chapterId !== state.chapterId) { toast("请先在正文中选择一段文字。"); return; }
    const { lang, root, paragraph, quote, start, end, blockIndex } = chosen;
    const records = readLocal(highlightsKey(state.book.id, state.chapterId, lang), []);
    if (records.some((r) => r.blockIndex === blockIndex && start < r.start + r.quote.length && end > r.start)) {
      toast("该位置已有高亮。"); return;
    }
    const text = paragraph.textContent; const id = `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const record = { id, blockIndex, start, quote, prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32), createdAt: Date.now() };
    records.push(record);
    if (!writeLocal(highlightsKey(state.book.id, state.chapterId, lang), records)) { toast("浏览器本地存储不可用，未能保存高亮。"); return; }
    restoreHighlights(root, state.book.id, state.chapterId, lang);
    selection?.removeAllRanges(); pendingHighlight = null; toolbar.hidden = true; toast("高亮已保存到当前浏览器。");
  }

  function showHighlightToolbar() {
    const selection = window.getSelection(); const toolbar = $("#highlight-toolbar");
    if (!selection || selection.isCollapsed || !selection.rangeCount) { toolbar.hidden = true; return; }
    const range = selection.getRangeAt(0);
    const alignedRoot = range.startContainer.parentElement?.closest("[data-alignment-lang]");
    const root = alignedRoot || [$("#md-zh"), $("#md-en")].find((item) => item && item.contains(range.startContainer) && item.contains(range.endContainer));
    if (!root || (root.dataset.alignmentLang === "en" && !state.showEn) || (root.id === "md-en" && !state.showEn)) { toolbar.hidden = true; return; }
    const paragraph = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer.closest("p") : range.commonAncestorContainer.parentElement?.closest("p");
    if (!paragraph || !paragraph.contains(range.startContainer) || !paragraph.contains(range.endContainer)) { toolbar.hidden = true; return; }
    const lang = root.dataset.alignmentLang || (root.id === "md-en" ? "en" : "zh");
    const start = textOffset(paragraph, range.startContainer, range.startOffset);
    const end = textOffset(paragraph, range.endContainer, range.endOffset);
    const quote = selection.toString();
    if (!quote.trim()) { toolbar.hidden = true; return; }
    pendingHighlight = {
      bookId: state.book.id, chapterId: state.chapterId, lang, root: languageRoots(lang), paragraph,
      start, end, quote, blockIndex: languageParagraphs(lang).indexOf(paragraph),
    };
    const rect = range.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(window.innerWidth - 200, rect.left))}px`;
    toolbar.style.top = `${Math.max(8, rect.top - 48)}px`;
    toolbar.hidden = false;
  }

  function setupReaderFeatures(book, startingPosition) {
    const searchDialog = $("#search-dialog"); const searchInput = $("#search-input");
    const notesInput = $("#chapter-notes"); let notesTimer = 0;
    $("#open-search").addEventListener("click", () => { openDialog("search-dialog"); searchInput.focus(); });
    searchInput.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(searchInput.value), 220); });
    $("#open-bookmarks").addEventListener("click", () => { renderBookmarkList(); openDialog("bookmarks-dialog"); });
    const loadNotes = () => {
      const saved = readLocal(noteKey(book.id, state.chapterId), null);
      notesInput.value = saved?.text || "";
      $("#notes-status").textContent = saved?.updatedAt
        ? `上次保存：${new Date(saved.updatedAt).toLocaleString()} · 按章节保存在当前浏览器`
        : "还没有本章笔记 · 按章节保存在当前浏览器";
    };
    const saveNotes = () => {
      const saved = { text: notesInput.value, updatedAt: Date.now() };
      if (writeLocal(noteKey(book.id, state.chapterId), saved)) {
        $("#notes-status").textContent = `已保存：${new Date(saved.updatedAt).toLocaleString()} · 按章节保存在当前浏览器`;
      } else {
        $("#notes-status").textContent = "保存失败，请检查浏览器本地存储空间。";
      }
    };
    $("#open-notes").addEventListener("click", () => { loadNotes(); openDialog("notes-dialog"); notesInput.focus(); });
    notesInput.addEventListener("input", () => {
      $("#notes-status").textContent = "编辑中…自动保存至当前浏览器";
      clearTimeout(notesTimer); notesTimer = setTimeout(saveNotes, 500);
    });
    $("#save-notes").addEventListener("click", saveNotes);
    $("#notes-dialog").addEventListener("close", () => {
      if ($( "#notes-status").textContent.startsWith("编辑中")) { clearTimeout(notesTimer); saveNotes(); }
    });
    $("#save-bookmark").addEventListener("click", () => {
      const items = readLocal(bookmarksKey(book.id), []); const ratio = currentPosition();
      if (!items.some((item) => item.chapterId === state.chapterId && Math.abs(item.ratio - ratio) < 0.025)) {
        items.unshift({ chapterId: state.chapterId, ratio, createdAt: Date.now() });
        writeLocal(bookmarksKey(book.id), items.slice(0, 100));
      }
      renderBookmarkList(); toast("当前位置已加入书签。");
    });
    $("#resume-progress").addEventListener("click", () => {
      const progress = readLocal(progressKey(book.id), null);
      if (!progress) { toast("还没有可继续的阅读进度。"); return; }
      if (progress.chapterId !== state.chapterId) location.href = readerUrl(book.id, progress.chapterId, state.showEn) + `&pos=${progress.ratio || 0}`;
      else { const sc = $("#content-scroll"); if (sc) sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * (progress.ratio || 0); }
      $("#bookmarks-dialog").close();
    });
    $("#open-study").addEventListener("click", async () => { openDialog("study-dialog"); await loadStudyGuide(); });
    $$('[data-close-dialog]').forEach((btn) => btn.addEventListener("click", () => $("#" + btn.dataset.closeDialog).close()));
    $$("dialog").forEach((dialog) => dialog.addEventListener("click", (ev) => { if (ev.target === dialog) dialog.close(); }));
    $("#create-highlight").addEventListener("click", saveSelectedHighlight);
    $("#open-highlights").addEventListener("click", () => { renderHighlightsList(); openDialog("highlights-dialog"); });
    document.addEventListener("mouseup", (ev) => {
      if (ev.target.closest("#md-en") && !state.showEn) return;
      // Keep text selection behavior independent from bilingual alignment.
      setTimeout(showHighlightToolbar, 0);
    });
    document.addEventListener("selectionchange", () => setTimeout(showHighlightToolbar, 0));
    document.addEventListener("mousedown", (ev) => { if (!ev.target.closest("#highlight-toolbar")) $("#highlight-toolbar").hidden = true; });
    document.addEventListener("click", (ev) => {
      const image = ev.target.closest("#md-zh img, #md-en img, .bilingual-alignment-cell img");
      if (image && focusImageInEnglishPanel(image)) return;
      const glossaryTerm = ev.target.closest("[data-glossary-term]");
      if (glossaryTerm) { showGlossaryEntry(glossaryTerm.dataset.glossaryTerm); return; }
      const mark = ev.target.closest("mark.reader-highlight");
      if (!mark) return;
      const lang = mark.closest("[data-alignment-lang]")?.dataset.alignmentLang || (mark.closest("#md-en") ? "en" : "zh");
      const key = highlightsKey(book.id, state.chapterId, lang);
      const id = mark.dataset.highlightId;
      writeLocal(key, readLocal(key, []).filter((item) => item.id !== id));
      mark.replaceWith(...mark.childNodes); toast("高亮已删除。");
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && imageFocusPanel) closeImageFocus();
    });
    window.addEventListener("resize", updateImageFocusPosition);
    const sc = $("#content-scroll"); let progressTimer = 0;
    sc?.addEventListener("scroll", () => {
      clearTimeout(progressTimer);
      progressTimer = setTimeout(() => writeLocal(progressKey(book.id), { chapterId: state.chapterId, ratio: currentPosition(), updatedAt: Date.now() }), 300);
    }, { passive: true });
    if (startingPosition > 0) requestAnimationFrame(() => {
      if (sc) sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * startingPosition;
    });
    window.addEventListener("beforeunload", () => writeLocal(progressKey(book.id), { chapterId: state.chapterId, ratio: currentPosition(), updatedAt: Date.now() }));
  }

  /* ---------- Home ---------- */
  async function initHome() {
    const grid = $("#book-grid");
    if (!grid) return;
    try {
      const catalog = await loadCatalog();
      grid.innerHTML = "";
      for (const b of catalog.books || []) {
        const a = document.createElement("a");
        a.href = `reader.html?book=${encodeURIComponent(b.id)}`;
        a.className =
          "group block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md";
        a.innerHTML = `
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-lg font-semibold text-slate-900 group-hover:text-blue-700">${escapeHtml(b.title_zh || b.title_en)}</h3>
              <p class="mt-1 text-sm text-slate-500">${escapeHtml(b.title_en || "")}</p>
            </div>
            <span class="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">阅读</span>
          </div>
          <p class="mt-3 text-sm leading-relaxed text-slate-600">${escapeHtml(b.description_zh || b.description_en || "")}</p>
          <div class="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
            <span class="rounded-full bg-slate-100 px-2 py-0.5">${b.chapter_count || flattenPages(b.toc).length} 篇</span>
            <span class="rounded-full bg-slate-100 px-2 py-0.5">${b.figure_count || 0} 图</span>
            <span>${escapeHtml(b.author || "")}</span>
          </div>`;
        grid.appendChild(a);
      }
    } catch (e) {
      grid.innerHTML = `<p class="text-red-600">${escapeHtml(e.message)}</p>`;
    }
  }

  /* ---------- Reader ---------- */
  let state = {
    book: null,
    pages: [],
    chapterId: "",
    showEn: false,
    enLoadedFor: null,
    glossaryLinks: true,
    contentWidthMode: "full",
  };

  function setSidebarOpen(open) {
    const sb = $("#sidebar");
    const ov = $("#sidebar-overlay");
    if (!sb) return;
    if (open) {
      sb.classList.remove("-translate-x-full");
      ov && ov.classList.remove("hidden");
    } else {
      sb.classList.add("-translate-x-full");
      ov && ov.classList.add("hidden");
    }
  }

  function applyBilingualUI() {
    restoreAlignedContent();
    const panels = $("#panels");
    const enPanel = $("#en-panel");
    const zhLabel = $("#zh-label");
    const toggle = $("#toggle-en");
    if (toggle) toggle.checked = state.showEn;
    if (state.showEn) {
      panels.classList.add("bilingual");
      enPanel.classList.remove("hidden");
      zhLabel.classList.remove("hidden");
    } else {
      panels.classList.remove("bilingual");
      enPanel.classList.add("hidden");
      zhLabel.classList.add("hidden");
    }
    panels.classList.remove("aligned");
    updateReaderDisplayControls();
  }

  function updateReaderDisplayControls() {
    const widthButton = $("#toggle-content-width");
    const glossaryButton = $("#toggle-glossary-links");
    const panels = $("#panels");
    const comfortable = state.contentWidthMode === "comfortable";

    panels?.classList.toggle("single-language-comfortable",
      comfortable && !state.showEn && alignmentBreakpoint.matches);
    if (widthButton) {
      widthButton.hidden = state.showEn || !alignmentBreakpoint.matches;
      widthButton.setAttribute("aria-pressed", String(comfortable));
      widthButton.title = comfortable ? "切换为正文铺满宽度" : "切换为居中留白版式";
      widthButton.setAttribute("aria-label", widthButton.title);
      widthButton.classList.toggle("is-active", comfortable);
    }
    if (glossaryButton) {
      glossaryButton.setAttribute("aria-pressed", String(state.glossaryLinks));
      glossaryButton.title = state.glossaryLinks ? "关闭术语弹窗链接" : "开启术语弹窗链接";
      glossaryButton.setAttribute("aria-label", glossaryButton.title);
      glossaryButton.classList.toggle("is-active", state.glossaryLinks);
    }
  }

  async function refreshGlossaryLinks() {
    if (isContentsPage(state.chapterId)) return;
    const roots = [...languageRoots("zh"), ...(state.enLoadedFor ? languageRoots("en") : [])];
    if (!state.glossaryLinks) {
      roots.forEach(unlinkGlossaryTerms);
      return;
    }
    for (const root of roots) await linkGlossaryTerms(root, state.book);
  }

  function renderToc(book, chapterId) {
    const nav = $("#toc-nav");
    const toc = book.toc || [];
    nav.innerHTML = "";

    const activeTrail = findGroupPath(toc, chapterId) || [];
    const openIds = new Set(activeTrail.map((g) => g.id));

    for (const node of toc) {
      if (node.type === "group") {
        const wrap = document.createElement("div");
        wrap.className = "toc-group mb-1" + (openIds.has(node.id) ? " open" : "");
        wrap.dataset.groupId = node.id;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.innerHTML = `<span class="chev">▶</span><span class="truncate">${escapeHtml(node.title_zh || node.title_en)}</span>`;
        btn.addEventListener("click", () => {
          wrap.classList.toggle("open");
        });
        wrap.appendChild(btn);

        const kids = document.createElement("div");
        kids.className = "toc-children space-y-0.5 py-0.5";
        for (const child of node.children || []) {
          if (child.type !== "page") continue;
          const a = document.createElement("a");
          a.className = "toc-page" + (child.id === chapterId ? " active" : "");
          a.href = readerUrl(book.id, child.id, state.showEn);
          a.textContent = child.title_zh || child.title_en;
          a.dataset.id = child.id;
          kids.appendChild(a);
        }
        wrap.appendChild(kids);
        nav.appendChild(wrap);
      } else if (node.type === "page") {
        const a = document.createElement("a");
        a.className = "toc-page mb-0.5" + (node.id === chapterId ? " active" : "");
        a.href = readerUrl(book.id, node.id, state.showEn);
        a.textContent = node.title_zh || node.title_en;
        nav.appendChild(a);
      }
    }
  }

  function readerUrl(bookId, chId, showEn) {
    const u = new URL("reader.html", location.href);
    u.searchParams.set("book", bookId);
    u.searchParams.set("ch", chId);
    if (showEn) u.searchParams.set("en", "1");
    else u.searchParams.delete("en");
    return u.pathname.split("/").pop() + u.search;
  }

  function updateNavLinks(book, chapterId) {
    const pages = state.pages;
    const idx = pages.findIndex((p) => p.id === chapterId);
    const bind = (el, target) => {
      if (!el) return;
      if (!target) {
        el.hidden = true;
        el.removeAttribute("href");
      } else {
        el.hidden = false;
        el.href = readerUrl(book.id, target.id, state.showEn);
      }
    };
    const prev = idx > 0 ? pages[idx - 1] : null;
    const next = idx >= 0 && idx < pages.length - 1 ? pages[idx + 1] : null;
    bind($("#nav-prev"), prev);
    bind($("#nav-next"), next);
    bind($("#nav-prev-bottom"), prev);
    bind($("#nav-next-bottom"), next);
  }

  function updateCrumb(book, chapterId) {
    const trail = findGroupPath(book.toc, chapterId) || [];
    const page = findPageMeta(book, chapterId);
    const parts = trail.map((g) => g.title_zh || g.title_en);
    if (page) parts.push(page.title_zh || page.title_en);
    $("#crumb").textContent = parts.join(" / ");
    $("#chapter-title").textContent = page
      ? page.title_zh || page.title_en
      : chapterId;
  }

  async function loadChapter(book, chapterId) {
    const page = findPageMeta(book, chapterId) || (book.chapters || []).find((c) => c.id === chapterId);
    const base = book.path || `books/${book.id}`;
    const file = page?.file || `${chapterId}.md`;
    const zhEl = $("#md-zh");
    const enEl = $("#md-en");

    restoreAlignedContent();
    zhEl.innerHTML = `<p class="text-slate-500">加载中…</p>`;
    try {
      const zhMd = await fetchText(`${base}/zh/chapters/${file}`);
      zhEl.innerHTML = renderMarkdown(zhMd, base, page, "zh");
      restoreHighlights(zhEl, book.id, chapterId, "zh");
      if (state.glossaryLinks && !isContentsPage(chapterId)) await linkGlossaryTerms(zhEl, book);
    } catch (e) {
      zhEl.innerHTML = `<p class="text-red-600">${escapeHtml(e.message)}</p>`;
    }

    if (state.showEn) {
      await loadEnglish(book, file, chapterId);
    } else {
      enEl.innerHTML = `<p class="text-slate-400 text-sm">勾选右上角「英文对照」后加载英文原文。</p>`;
      state.enLoadedFor = null;
    }

    state.chapterId = chapterId;
    renderToc(book, chapterId);
    updateNavLinks(book, chapterId);
    updateCrumb(book, chapterId);
    setupAlignment();
    // scroll content top
    const sc = $("#content-scroll");
    if (sc) sc.scrollTop = 0;
    // close mobile sidebar after nav
    if (window.matchMedia("(max-width: 1023px)").matches) setSidebarOpen(false);
  }

  async function loadEnglish(book, file, chapterId = state.chapterId) {
    const base = book.path || `books/${book.id}`;
    const enEl = $("#md-en");
    const key = `${book.id}:${file}`;
    if (state.enLoadedFor === key) return;
    enEl.innerHTML = `<p class="text-slate-500">加载英文…</p>`;
    try {
      const enMd = await fetchText(`${base}/en/chapters/${file}`);
      const page = findPageMeta(book, chapterId) || (book.chapters || []).find((c) => c.id === chapterId);
      enEl.innerHTML = renderMarkdown(enMd, base, page, "en");
      state.enLoadedFor = key;
      restoreHighlights(enEl, book.id, chapterId || params().get("ch") || "", "en");
      if (state.glossaryLinks && !isContentsPage(chapterId)) await linkGlossaryTerms(enEl, book);
      setupAlignment();
    } catch (e) {
      enEl.innerHTML = `<p class="text-red-600">${escapeHtml(e.message)}</p>`;
    }
  }

  async function initReader() {
    alignmentBreakpoint.addEventListener("change", () => {
      setupAlignment();
      updateReaderDisplayControls();
    });
    const p = params();
    const bookId = p.get("book") || "trading-price-action-trends";
    let chapterId = p.get("ch") || "";
    // Default: Chinese only. en=1 enables bilingual.
    state.showEn = p.get("en") === "1" || p.get("mode") === "bilingual";
    state.glossaryLinks = readLocal("reader-glossary-links", true) !== false;
    state.contentWidthMode = readLocal("reader-content-width", "full") === "comfortable" ? "comfortable" : "full";

    const catalog = await loadCatalog();
    const book = bookById(catalog, bookId);
    if (!book) {
      $("#md-zh").innerHTML = `<p class="text-red-600">未找到书籍：${escapeHtml(bookId)}</p>`;
      return;
    }
    state.book = book;
    state.pages = flattenPages(book.toc).length
      ? flattenPages(book.toc)
      : (book.chapters || []).map((c) => ({
          type: "page",
          id: c.id,
          file: c.file,
          title_zh: c.title_zh,
          title_en: c.title_en,
        }));

    const savedProgress = readLocal(progressKey(book.id), null);
    if (!chapterId && savedProgress?.chapterId) chapterId = savedProgress.chapterId;
    if (!chapterId && state.pages.length) chapterId = state.pages[0].id;

    $("#book-title").textContent = book.title_zh || book.title_en;
    $("#book-author").textContent = book.author || "";
    $("#sidebar-brand").textContent = catalog.site_title || "译丛";

    applyBilingualUI();
    await loadChapter(book, chapterId);
    const posParam = Number(p.get("pos"));
    const startRatio = Number.isFinite(posParam) && p.has("pos")
      ? Math.max(0, Math.min(1, posParam))
      : savedProgress?.chapterId === chapterId ? (savedProgress.ratio || 0) : 0;
    setupReaderFeatures(book, startRatio);
    const q = p.get("q");
    if (q) { openDialog("search-dialog"); $("#search-input").value = q; runSearch(q); }

    // sidebar mobile
    $("#sidebar-open")?.addEventListener("click", () => setSidebarOpen(true));
    $("#sidebar-close")?.addEventListener("click", () => setSidebarOpen(false));
    $("#sidebar-overlay")?.addEventListener("click", () => setSidebarOpen(false));

    // English toggle (optional)
    $("#toggle-en")?.addEventListener("change", async (ev) => {
      state.showEn = !!ev.target.checked;
      applyBilingualUI();
      const url = new URL(location.href);
      if (state.showEn) url.searchParams.set("en", "1");
      else url.searchParams.delete("en");
      // clean legacy mode param
      url.searchParams.delete("mode");
      history.replaceState(null, "", url);
      updateNavLinks(book, state.chapterId);
      // update toc links en flag
      renderToc(book, state.chapterId);
      if (state.showEn) {
        const page = findPageMeta(book, state.chapterId);
        await loadEnglish(book, page?.file || `${state.chapterId}.md`, state.chapterId);
      }
      setupAlignment();
    });

    $("#toggle-content-width")?.addEventListener("click", () => {
      state.contentWidthMode = state.contentWidthMode === "comfortable" ? "full" : "comfortable";
      writeLocal("reader-content-width", state.contentWidthMode);
      updateReaderDisplayControls();
    });

    $("#toggle-glossary-links")?.addEventListener("click", async () => {
      state.glossaryLinks = !state.glossaryLinks;
      writeLocal("reader-glossary-links", state.glossaryLinks);
      updateReaderDisplayControls();
      await refreshGlossaryLinks();
    });

    // keyboard
    document.addEventListener("keydown", (ev) => {
      if (ev.target.matches("input,textarea,select")) return;
      const idx = state.pages.findIndex((c) => c.id === state.chapterId);
      if ((ev.key === "]" || ev.key === "ArrowRight") && idx < state.pages.length - 1) {
        location.href = readerUrl(book.id, state.pages[idx + 1].id, state.showEn);
      } else if ((ev.key === "[" || ev.key === "ArrowLeft") && idx > 0) {
        location.href = readerUrl(book.id, state.pages[idx - 1].id, state.showEn);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.dataset.page;
    if (page === "home") initHome();
    if (page === "reader") {
      initReader().catch((e) => {
        const el = $("#md-zh") || document.body;
        el.innerHTML = `<p class="text-red-600 p-6">${escapeHtml(e.message)}</p>`;
      });
    }
  });
})();
