# Brooks 价格行为译丛（price-action-books-zh）

Al Brooks 价格行为系列图书的**简体中文**开源翻译仓库，支持：

本仓库基于 [lihongjie0209/price-action-books-zh](https://github.com/lihongjie0209/price-action-books-zh) Fork，并在此基础上维护阅读站点与阅读增强功能。

- 按书分目录管理（可继续添加 Reversals、Trading Ranges 等）
- 统一**术语表**与**二次审计**流程（见下方 Skill）
- **GitHub Pages 中英对照阅读**

## 在线阅读

- GitBook 风格：左侧**分层目录**（前言 / 各部分 / 附录）
- **默认中文**；右上角可按需开启「英文对照」
- 阅读页支持中英章节实时对照、全文搜索、逐章笔记、书签、阅读进度和持久化高亮
- 章节整理以离线 JSON 提供摘要、要点和可折叠导图；缺少整理文件时显示生成占位提示

## 阅读增强功能

阅读页工具栏提供以下功能，个人数据保存在当前浏览器的 `localStorage` 中：

- **中英实时对照**：根据章节标题与相邻段落在页面运行时匹配，不改写英文或中文 Markdown 原文。
- **全文搜索**：搜索本书中文与英文分章内容，并可跳转到匹配章节。
- **书签与进度**：保存章节阅读位置、查看书签，并从上次阅读位置继续。
- **逐章笔记**：每章单独记录笔记并自动保存，可随时继续编辑。
- **持久化高亮**：选择单个段落中的文本并保存为高亮；高亮可在刷新后恢复，也可在高亮面板管理。
- **术语解释**：阅读中自动识别术语表里的中英文词条，点击带下划线的词即可弹窗查看译名与备注。
- **本章整理**：显示离线摘要、核心要点和可折叠章节导图；此静态站点不调用在线 AI。

章节整理规范、整理提示词、JSON 结构以及文件组织约定见 [章节整理 Skill](.grok/skills/chapter-study-guide/SKILL.md)。目前第 1、2 章附有示例整理文件，其他章节会显示占位提示。整理文件位于 `books/<book-id>/study-guides/zh/<chapter-id>.json`。

## 在线阅读

部署后地址（启用 Pages 后）：

**https://davidpeng001.github.io/price-action-books-zh-reader/**

本地预览：

```bash
cd price-action-books-zh
python3 -m http.server 8080
# 打开 http://127.0.0.1:8080/
```

## 仓库结构

```text
price-action-books-zh/
├── index.html / reader.html   # GitHub Pages 阅读站
├── css/ js/ catalog.json
├── books/
│   └── trading-price-action-trends/   # 第一本：TRENDS
│       ├── en/chapters/               # 英文 Markdown（按章）
│       ├── zh/chapters/               # 中文译本
│       ├── glossary/glossary.md       # 术语表
│       ├── study-guides/zh/           # 离线章节摘要与导图 JSON
│       ├── assets/figures/            # 共享图（fig_*.png）
│       ├── notes/                     # 抽取/审计记录
│       └── scripts/                   # 可选工具脚本
└── .grok/skills/
    ├── book-translation/              # 图书翻译 Skill
    └── chapter-study-guide/           # 章节整理 Skill 与 Agent 提示词
```

## 当前书目

| ID | 书名 | 状态 |
|----|------|------|
| `trading-price-action-trends` | Trading Price Action TRENDS | 已译 + 对照站 |

## 添加下一本书

1. 按 Skill 流程：`/book-translation` 或说明「翻译某某 PDF」
2. 在 `books/<book-id>/` 建立与 TRENDS 相同的布局
3. 更新根目录 `catalog.json` 的 `books` 数组
4. 提交并推送，Pages 自动更新

## 翻译 Skill

路径：[`.grok/skills/book-translation/SKILL.md`](.grok/skills/book-translation/SKILL.md)

覆盖：PDF→Markdown、分章、术语表、逐章翻译、二次审计与润色、图片抽取、对照站注册。

## 版权声明

原书 © Al Brooks / John Wiley & Sons。本仓库译本与图示提取**仅供学习交流**，请勿用于商业出版或再分发原书扫描件。请支持正版纸质书/电子书。

## License（译本编排）

仓库内原创编排脚本、站点代码与 Skill 文档采用 MIT（见 `LICENSE`）。译文文本权利仍受原书版权约束，仅限个人学习使用。
