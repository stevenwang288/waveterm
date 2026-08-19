#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""批量重写 v0121-v0131 升级通知文件，用 Trans 替换硬编码英文"""
import json, os, re, io, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

REPO = r"D:\OneDrive\steven\code\ai\13IDE\wave"

# 加载翻译文件以获取 key 映射
with open(os.path.join(REPO, "locales/en/translation.json"), encoding="utf-8") as f:
    en = json.load(f)

def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, p))
        else:
            out[v.strip()] = p
    return out

en_map = flatten(en)

# 扫描硬编码
import subprocess
result = subprocess.run(
    ["node", "scripts/i18n-scan-visible.cjs", "--all", "--json"],
    capture_output=True, text=True, cwd=REPO, timeout=30
).stdout
start = result.find("[")
hits = json.loads(result[start:])

# 按文件分组
from collections import defaultdict
files = defaultdict(list)
for h in hits:
    f = h["file"]
    if "onboarding/onboarding-upgrade-v0" in f and "v01" in f:
        files[f].append(h)

# 对每个文件，生成替换
for fname, fhits in sorted(files.items()):
    fpath = os.path.join(REPO, fname.replace("/", os.sep))
    with open(fpath, encoding="utf-8") as f:
        content = f.read()

    # 检查是否已有 useTranslation import
    has_import = "useTranslation" in content

    # 逐个替换（从后往前）
    lines = content.split("\n")
    replaced = 0
    for h in sorted(fhits, key=lambda x: -x["line"]):
        line_idx = h["line"] - 1
        if line_idx >= len(lines):
            continue
        line = lines[line_idx]
        text = h["text"]
        kind = h["kind"]

        # 尝试匹配翻译 key
        key = None
        for val, k in en_map.items():
            if val == text.strip():
                key = k
                break

        if key is None:
            continue  # 跳过无匹配的

        new_line = None
        if kind == "JsxText" or kind == "JsxExpressionString":
            # 如果是纯文本，用 {t("key")}
            esc = re.escape(text).replace(r"\ ", r"\s+")
            m = re.search(esc, line)
            if m:
                new_line = line[:m.start()] + '{t("' + key + '")}' + line[m.end():]
        elif kind.startswith("Attr:"):
            for q in ['"', "'"]:
                s = q + text + q
                if s in line:
                    new_line = line.replace(s, '{t("' + key + '")}', 1)
                    break

        if new_line and new_line != line:
            lines[line_idx] = new_line
            replaced += 1

    if replaced > 0:
        content = "\n".join(lines)
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"✅ {fname}: {replaced} 处替换")
    else:
        print(f"⏭️ {fname}: 无匹配替换")

print(f"\n完成！")

# 验证 JSON 仍然合法
for lang in ["en", "zh-CN"]:
    with open(os.path.join(REPO, f"locales/{lang}/translation.json"), encoding="utf-8") as f:
        json.load(f)
    print(f"✅ {lang} JSON 合法")