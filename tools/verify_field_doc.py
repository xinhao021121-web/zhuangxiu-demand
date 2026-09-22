"""校验产品设计文档中的分区字段数是否与字段清单一致。

用法（需使用内置 Python，因其带有 openpyxl）：
  python tools/verify_field_doc.py
退出码 0 表示一致，1 表示存在不一致。
"""

import re
import sys
from collections import Counter
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "装修需求发现助手_产品设计文档_V1.md"
BOOK = (
    ROOT
    / "outputs"
    / "01a0c95f-3b4f-7762-ad52-61bb13941fcc"
    / "装修需求采集表_字段清单_V1.xlsx"
)


def doc_counts() -> dict[str, int]:
    counts: dict[str, int] = {}
    for line in DOC.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\|\s*(\S+?)\s*\|\s*(\d+)\s*\|", line)
        if m:
            counts[m.group(1)] = int(m.group(2))
    return counts


def book_counts() -> dict[str, int]:
    ws = openpyxl.load_workbook(BOOK)["字段总表"]
    names = [ws.cell(r, 2).value for r in range(5, 204)]
    return dict(Counter(n for n in names if n))


def main() -> int:
    doc = doc_counts()
    book = book_counts()
    problems: list[str] = []

    for name, n in book.items():
        if name not in doc:
            problems.append(f"文档缺少分区：{name}")
        elif doc[name] != n:
            problems.append(f"分区「{name}」字段数不一致：文档 {doc[name]} / 清单 {n}")

    for name in doc:
        if name not in book and name not in {"分区"}:
            problems.append(f"文档中出现清单里没有的分区：{name}")

    total = sum(book.values())
    text = DOC.read_text(encoding="utf-8")
    if f"{len(book)} 个分区" not in text:
        problems.append(f"文档未声明分区总数 {len(book)}")
    if f"{total} 个字段" not in text:
        problems.append(f"文档未声明字段总数 {total}")

    if problems:
        print("FAIL")
        for p in problems:
            print(" -", p)
        return 1

    print(f"PASS 分区 {len(book)} 个，字段 {total} 个，与文档一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
