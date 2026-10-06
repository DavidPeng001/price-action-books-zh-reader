#!/usr/bin/env python3
"""Build the reader glossary data from the book's bilingual glossary chapter."""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ZH_SOURCE = ROOT / "zh/chapters/03-list-of-terms-used-in-this-book.md"
EN_SOURCE = ROOT / "en/chapters/03-list-of-terms-used-in-this-book.md"
SUPPLEMENT = ROOT / "glossary/glossary.md"
AI_DEFINITIONS = ROOT / "glossary/ai_generated_definitions.json"
OUTPUT = ROOT / "glossary/terms.json"

ENTRY_RE = re.compile(r"^\*\*(?P<label>.+?)\*\*\s*[—–-]\s*(?P<definition>.*)$")
COMMENT_RE = re.compile(r"<!--.*?-->")
CJK_RE = re.compile(r"[\u3400-\u9fff]")


def clean_text(value: str) -> str:
    value = COMMENT_RE.sub("", value)
    value = unicodedata.normalize("NFKC", value)
    value = value.replace("\ufeff", "").replace("\u00a0", " ")
    return re.sub(r"\s+", " ", value).strip()


def key(value: str) -> str:
    value = clean_text(value).lower()
    value = re.sub(r"[‐‑‒–—−]", "-", value)
    value = re.sub(r"[^\w\u3400-\u9fff-]+", " ", value)
    return re.sub(r"\s+", " ", value).strip(" -")


def split_label(label: str) -> tuple[str, list[str], list[str]]:
    match = re.match(r"^(?P<main>[^（(]+?)(?:[（(](?P<inner>.*)[）)])?$", label.strip())
    main = (match.group("main") if match else label).strip()
    en_aliases = [main]
    zh_aliases: list[str] = []
    inner = (match.group("inner") or "") if match else ""
    for part in re.split(r"[，,、;；]", inner):
        part = part.strip().strip(" .")
        part = re.sub(r"^(?:或|亦称|也称|or\s+|also\s+known\s+as\s+)", "", part, flags=re.I).strip()
        if not part:
            continue
        if CJK_RE.search(part):
            # Keep bilingual variants together when the source pairs them in parentheses.
            zh_aliases.extend(x.strip() for x in re.split(r"\s*/\s*", part) if CJK_RE.search(x))
        elif re.search(r"[A-Za-z]", part):
            en_aliases.extend(x.strip() for x in re.split(r"\s*/\s*", part) if x.strip())
    return main, unique(en_aliases), unique(zh_aliases)


def unique(items: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        item = clean_text(item)
        ident = key(item)
        if item and ident and ident not in seen:
            seen.add(ident)
            result.append(item)
    return result


def parse_chinese_entries() -> list[dict]:
    entries: list[dict] = []
    current: dict | None = None
    for number, raw in enumerate(ZH_SOURCE.read_text(encoding="utf-8").splitlines(), 1):
        line = COMMENT_RE.sub("", raw).strip()
        match = ENTRY_RE.match(line)
        if match:
            if current:
                entries.append(current)
            main, en_aliases, zh_aliases = split_label(match.group("label"))
            current = {
                "term_en": main,
                "term_zh": zh_aliases[0] if zh_aliases else "",
                "aliases_en": en_aliases,
                "aliases_zh": zh_aliases,
                "definition_zh": clean_text(match.group("definition")),
                "definition_en": "",
                "note": "",
                "source": {"zh": f"zh/chapters/{ZH_SOURCE.name}#L{number}", "en": ""},
                "source_type": "book_definition",
            }
        elif current and line and not line.startswith("#"):
            continuation = clean_text(line)
            if continuation:
                current["definition_zh"] = clean_text(current["definition_zh"] + " " + continuation)
    if current:
        entries.append(current)
    return entries


def parse_supplement() -> list[dict]:
    rows: list[dict] = []
    for line in SUPPLEMENT.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|") or re.match(r"^\|\s*-", line):
            continue
        cells = [cell.strip() for cell in line.split("|")[1:-1]]
        if len(cells) < 3 or cells[0].lower() == "english":
            continue
        en = unique([part.strip() for part in re.split(r"\s*/\s*", cells[0])])
        zh = []
        for part in re.split(r"\s*/\s*", cells[1]):
            (zh if CJK_RE.search(part) else en).append(part.strip())
        en = unique(en)
        zh = unique(zh)
        rows.append({"aliases_en": en, "aliases_zh": zh, "note": clean_text(cells[2])})
    return rows


def parse_english_definitions(entries: list[dict]) -> tuple[int, list[str]]:
    lines = EN_SOURCE.read_text(encoding="utf-8").splitlines()
    alias_map: dict[str, list[int]] = {}
    for index, entry in enumerate(entries):
        for alias in entry["aliases_en"]:
            alias_map.setdefault(key(alias), []).append(index)

    starts: list[tuple[int, list[int]]] = []
    in_terms_section = False
    for line_number, raw in enumerate(lines):
        text = clean_text(raw)
        if not text:
            continue
        if key(text) == "list of terms used in this book":
            in_terms_section = True
            continue
        if not in_terms_section:
            continue
        # Definitions can themselves contain a phrase that matches another term (e.g. “Failed, failure.”).
        # Source term labels are standalone lines and do not end in sentence punctuation.
        if text.endswith((".", "!", "?")):
            continue
        # English source terms may carry parenthetical aliases, e.g. "failure (a failed move)".
        head = re.split(r"\s*\(", text, maxsplit=1)[0].strip(" .:;–—-")
        if re.fullmatch(r"(?:[ivxlcdm]+|\d+)", head.lower()) and key(head) not in alias_map:
            continue
        matches = alias_map.get(key(head))
        if matches:
            starts.append((line_number, matches))

    captured: set[int] = set()
    for start_index, (line_number, matched_entries) in enumerate(starts):
        end = starts[start_index + 1][0] if start_index + 1 < len(starts) else len(lines)
        definition_lines = []
        for raw in lines[line_number + 1 : end]:
            text = clean_text(raw)
            if not text or key(text) == "list of terms used in this book":
                continue
            definition_lines.append(text)
        definition = clean_text(" ".join(definition_lines))
        if not definition:
            continue
        # Exact canonical-name matches win when an alias collides with another entry.
        canonical = key(re.split(r"\s*\(", clean_text(lines[line_number]), maxsplit=1)[0])
        exact = [i for i in matched_entries if key(entries[i]["term_en"]) == canonical]
        target = exact[0] if exact else matched_entries[0]
        entries[target]["definition_en"] = definition
        entries[target]["source"]["en"] = f"en/chapters/{EN_SOURCE.name}#L{line_number + 1}"
        captured.add(target)
    missing = [entry["term_en"] for i, entry in enumerate(entries) if i not in captured]
    return len(captured), missing


def merge_supplement(entries: list[dict], rows: list[dict]) -> int:
    existing: dict[str, list[int]] = {}
    for index, entry in enumerate(entries):
        for alias in entry["aliases_en"]:
            existing.setdefault(key(alias), []).append(index)

    extras = 0
    for row in rows:
        matches = [(alias_index, alias, existing.get(key(alias), [])) for alias_index, alias in enumerate(row["aliases_en"])]
        targets = {target for _, _, indices in matches for target in indices}
        if targets:
            for alias_index, alias, indices in matches:
                for index in indices:
                    entry = entries[index]
                    zh_aliases = row["aliases_zh"]
                    if len(row["aliases_en"]) == len(row["aliases_zh"]):
                        zh_aliases = [row["aliases_zh"][alias_index]]
                    entry["aliases_en"] = unique(entry["aliases_en"] + [alias])
                    entry["aliases_zh"] = unique(entry["aliases_zh"] + zh_aliases)
                    if not entry["term_zh"] and zh_aliases:
                        entry["term_zh"] = zh_aliases[0]
                    if row["note"] and row["note"] not in entry["note"]:
                        entry["note"] = clean_text("; ".join(filter(None, [entry["note"], row["note"]])))
            continue

        term_en = row["aliases_en"][0] if row["aliases_en"] else ""
        entry = {
            "term_en": term_en,
            "term_zh": row["aliases_zh"][0] if row["aliases_zh"] else "",
            "aliases_en": row["aliases_en"],
            "aliases_zh": row["aliases_zh"],
            "definition_zh": "",
            "definition_en": "",
            "note": row["note"],
            "source": {"zh": "", "en": ""},
            "source_type": "supplement_only",
        }
        entries.append(entry)
        extras += 1
        for alias in entry["aliases_en"]:
            existing.setdefault(key(alias), []).append(len(entries) - 1)
    return extras


def apply_ai_definitions(entries: list[dict]) -> int:
    """Apply reviewed bilingual AI definitions to glossary-only entries."""
    definitions = json.loads(AI_DEFINITIONS.read_text(encoding="utf-8"))
    by_term = {key(item["term_en"]): item for item in definitions["entries"]}
    applied = 0
    for entry in entries:
        if entry["source_type"] != "supplement_only":
            continue
        definition = by_term.get(key(entry["term_en"]))
        if not definition:
            continue
        entry["definition_zh"] = clean_text(definition["definition_zh"])
        entry["definition_en"] = clean_text(definition["definition_en"])
        entry["source_type"] = "ai_generated_supplement"
        entry["definition_source"] = {
            "type": "ai_generated",
            "based_on": "glossary/glossary.md",
            "review_note": "Generated from the glossary term and its translation notes; not a quotation from chapter 03.",
        }
        applied += 1

    missing = [entry["term_en"] for entry in entries
               if entry["source_type"] == "supplement_only"]
    if missing:
        raise ValueError("缺少 AI 双语释义：" + ", ".join(missing))
    unused = sorted(set(by_term) - {key(entry["term_en"]) for entry in entries})
    if unused:
        raise ValueError("AI 释义中存在未匹配词条：" + ", ".join(unused))
    return applied


def main() -> None:
    entries = parse_chinese_entries()
    english_count, missing_english = parse_english_definitions(entries)
    supplement_rows = parse_supplement()
    extras = merge_supplement(entries, supplement_rows)
    ai_definitions = apply_ai_definitions(entries)

    for index, entry in enumerate(entries, 1):
        entry["id"] = f"term-{index:03d}"
        entry["aliases_en"] = unique(entry["aliases_en"])
        entry["aliases_zh"] = unique(entry["aliases_zh"])

    OUTPUT.write_text(json.dumps({
        "schema_version": 1,
        "book_id": "trading-price-action-trends",
        "primary_source": f"zh/chapters/{ZH_SOURCE.name}",
        "english_source": f"en/chapters/{EN_SOURCE.name}",
        "supplement_source": f"glossary/{SUPPLEMENT.name}",
        "entries": entries,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"中文正文词条：{len(entries) - extras}")
    print(f"配对到英文定义：{english_count}/{len(entries) - extras}")
    print(f"仅由 glossary.md 补充的词条：{extras}")
    print(f"带双语 AI 生成释义的补充词条：{ai_definitions}")
    if missing_english:
        print("缺少英文原文定义（仍保留中文释义）：" + ", ".join(missing_english))
    print(f"输出：{OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
