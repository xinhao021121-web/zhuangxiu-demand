"""校验产品设计文档与字段清单 V2 的一致性。

检查项：
1. 文档中的分区字段数与 V2「表单字段」一致
2. 文档声明的大类数、字段数、量房确认项数与 V2 一致
3. V2 中不含任何必填项，填写建议只有「推荐填写 / 选填」

用法（需使用内置 Python，因其带有 openpyxl）：
  python tools/verify_field_spec.py
"""

import re
import sys
from collections import Counter
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "问需_产品设计文档_V1.md"
BOOK = (
    ROOT
    / "outputs"
    / "01a0c95f-3b4f-7762-ad52-61bb13941fcc"
    / "装修需求采集表_字段清单_V2.xlsx"
)

SUGGEST_VALUES = {"推荐填写", "选填", "实例必选"}


def doc_counts() -> dict[str, int]:
    counts: dict[str, int] = {}
    for line in DOC.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\|\s*(\S+?)\s*\|\s*(\d+)\s*\|", line)
        if m and m.group(1) != "分区":
            counts[m.group(1)] = int(m.group(2))
    return counts


def read_book() -> tuple[dict[str, int], list[str], int, list[str]]:
    wb = openpyxl.load_workbook(BOOK)
    ws = wb["表单字段"]
    sections, suggests, bad = [], [], []
    for r in range(5, 200):
        fid = ws.cell(r, 1).value
        if not isinstance(fid, str) or not re.match(r"^[a-z][a-z0-9_]*$", fid):
            continue  # 跳过字段行下方的说明文字
        sections.append(ws.cell(r, 2).value)
        suggest = ws.cell(r, 7).value
        suggests.append(suggest)
        if suggest not in SUGGEST_VALUES:
            bad.append(f"{fid}:{suggest}")
        for c in range(1, 13):
            v = ws.cell(r, c).value
            if isinstance(v, str) and "必填" in v:
                bad.append(f"{fid}:含必填字样")
    survey = [r for r in range(5, 40) if wb["量房确认清单"].cell(r, 2).value]
    return dict(Counter(sections)), suggests, len(survey), bad


def main() -> int:
    doc = doc_counts()
    book, suggests, survey_n, bad = read_book()
    problems: list[str] = []

    for name, n in book.items():
        if name not in doc:
            problems.append(f"文档缺少大类：{name}")
        elif doc[name] != n:
            problems.append(f"大类「{name}」字段数不一致：文档 {doc[name]} / 清单 {n}")
    for name in doc:
        if name not in book:
            problems.append(f"文档中出现清单里没有的大类：{name}")

    total = sum(book.values())
    text = DOC.read_text(encoding="utf-8")
    if f"{len(book)} 个大类、{total} 个字段" not in text:
        problems.append(f"文档未声明「{len(book)} 个大类、{total} 个字段」")
    if f"{survey_n} 项" not in text:
        problems.append(f"文档未声明量房确认项数 {survey_n}")

    m = re.search(r"(\d+) 项标为「推荐填写」、(\d+) 项为实例必选", text)
    if not m:
        problems.append("文档未声明推荐填写与实例必选的数量")
    else:
        if int(m.group(1)) != suggests.count("推荐填写"):
            problems.append(f"推荐填写数量不一致：文档 {m.group(1)} / 清单 {suggests.count('推荐填写')}")
        if int(m.group(2)) != suggests.count("实例必选"):
            problems.append(f"实例必选数量不一致：文档 {m.group(2)} / 清单 {suggests.count('实例必选')}")

    if bad:
        problems.append("字段清单出现必填或非法填写建议：" + "、".join(bad[:6]))
    if suggests.count("推荐填写") == 0:
        problems.append("清单里没有任何推荐填写项")

    if problems:
        print("FAIL")
        for p in problems:
            print(" -", p)
        return 1

    print(
        f"PASS 大类 {len(book)} 个、表单字段 {total} 个、推荐填写 {suggests.count('推荐填写')} 项、"
        f"实例必选 {suggests.count('实例必选')} 项、量房确认 {survey_n} 项、无必填项，与文档一致"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
