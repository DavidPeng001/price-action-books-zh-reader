---
name: chapter-study-guide
description: >
  Create or update source-grounded Chinese chapter summaries and mind maps for
  the price-action-books-zh reader. Use when asked to organize a chapter,
  generate a chapter guide, or create an offline mind map.
---

# Chapter Study Guide Agent

## Reusable prompt

> Read the complete Chinese chapter at `books/<book-id>/zh/chapters/<chapter-file>.md`.
> Use the matching English chapter and `books/<book-id>/glossary/glossary.md` to
> check meaning and terminology. Create a concise Chinese study guide for that
> chapter and save it as `books/<book-id>/study-guides/zh/<chapter-id>.json`.
> Do not edit either source chapter. Keep the author’s concept order and
> relationships. Do not add trading advice, external facts, or claims that are
> not supported by the chapter. If the source states a condition or caveat,
> preserve it. Organize the mind map as a topic-centered hierarchy: central
> topic → chapter concepts → supporting conditions, interpretations, examples,
> or limitations where the source provides them. Keep it to about 3 levels and
> use short labels that fit in a visual node. The summary should state the
> chapter’s main idea followed by its important distinctions and implications;
> do not merely copy the table of contents. Include concise source heading and
> PDF page references where available. Output valid UTF-8 JSON only, following
> the data contract below. Do not generate guides for front matter, part title
> pages, author/site pages, or the index.

## Data contract

One JSON file per substantive chapter, named with the chapter's catalog ID:

```json
{
  "schema_version": 1,
  "status": "ready",
  "chapter_id": "<catalog chapter id>",
  "title": "<Chinese chapter title>",
  "summary": {
    "overview": "<one short paragraph>",
    "key_points": ["<source-grounded point>"]
  },
  "mindmap": {
    "label": "<central topic>",
    "children": [
      { "label": "<branch>", "children": [{ "label": "<detail>" }] }
    ]
  },
  "sources": ["<heading or PDF page reference>"]
}
```

## Quality checks

- Read the full source chapter before summarizing; compare the English source if
  the Chinese wording is ambiguous.
- Prefer glossary terms and preserve numbered pattern names such as High 1/Low 2.
- Separate the author's statements from any unavoidable explanatory wording.
- Keep the overview to 1–3 sentences and key points to 3–8 items.
- Ensure every mind-map node is a short phrase, not a paragraph; avoid duplicate
  branches and unsupported causal links.
- Validate JSON syntax and confirm `chapter_id` matches the filename and catalog.
- Never modify `en/chapters` or `zh/chapters` as part of guide generation.
