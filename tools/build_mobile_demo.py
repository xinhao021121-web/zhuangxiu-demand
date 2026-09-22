"""从字段清单 V2 生成小程序端（移动端）Demo 页面。

用法（需使用内置 Python，因其带有 openpyxl）：
  python tools/build_mobile_demo.py
模板：tools/_mobile_template.html（勿直接打开，缺少字段数据时只会显示提示）
产物：mobile/装修需求发现助手_小程序端Demo_V0.1.html
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_demo import ROOT, build_spec  # noqa: E402

TEMPLATE = ROOT / "tools" / "_mobile_template.html"
OUTPUT = ROOT / "mobile" / "装修需求发现助手_小程序端Demo_V0.1.html"
PLACEHOLDER = "/*__FIELD_SPEC__*/[]"


def main() -> None:
    spec = build_spec()
    payload = json.dumps(spec, ensure_ascii=False, separators=(",", ":"))
    html = TEMPLATE.read_text(encoding="utf-8")
    if PLACEHOLDER not in html:
        raise SystemExit("模板中未找到字段占位符")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(html.replace(PLACEHOLDER, payload), encoding="utf-8")
    print(f"生成 {OUTPUT.name}：{len(spec)} 个字段，{OUTPUT.stat().st_size} 字节")


if __name__ == "__main__":
    main()
