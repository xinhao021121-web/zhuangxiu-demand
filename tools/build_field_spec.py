"""从字段清单 V2 导出领域包用的字段规格 JSON。

字段清单 Excel 是唯一的人类编辑入口，规则、渲染、摘要全部引用这里导出的 JSON。

用法（需使用带 openpyxl 的 Python）：
  python tools/build_field_spec.py

产物（可直接被 packages/field-spec 引用，禁止手工编辑）：
  packages/field-spec/src/field-spec.json        表单字段 191 项
  packages/field-spec/src/survey-checklist.json  量房确认清单 16 项
"""

import json
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_demo import BOOK, ROOT, build_spec  # noqa: E402

SPEC_OUT = ROOT / "packages" / "field-spec" / "src" / "field-spec.json"
SURVEY_OUT = ROOT / "packages" / "field-spec" / "src" / "survey-checklist.json"


def build_survey() -> list[dict]:
    ws = openpyxl.load_workbook(BOOK)["量房确认清单"]
    items = []
    for r in range(5, 40):
        no = ws.cell(r, 1).value
        item = ws.cell(r, 2).value
        if not isinstance(no, int) or not item:
            continue
        items.append(
            {
                "no": no,
                "item": item.strip(),
                "goal": (ws.cell(r, 3).value or "").strip(),
                "source": (ws.cell(r, 4).value or "").strip(),
            }
        )
    return items


def dump(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"生成 {path.relative_to(ROOT)}：{len(payload)} 项")


def main() -> None:
    spec = build_spec()
    survey = build_survey()
    sections: dict[str, int] = {}
    for f in spec:
        sections[f["section"]] = sections.get(f["section"], 0) + 1
    dump(SPEC_OUT, spec)
    dump(SURVEY_OUT, survey)
    print(f"分区 {len(sections)} 个：{sections}")


if __name__ == "__main__":
    main()
