#!/usr/bin/env python3
"""根据译文 English→Key 映射自动替换新版前端硬编码英文为 t() 调用"""
import json, subprocess, os, re, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

REPO = r"D:\OneDrive\steven\code\ai\13IDE\wave"
os.chdir(REPO)

def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, p))
        else:
            out[v] = p
    return out

# 用新版 en 翻译文件建立映射（英文文本→key）
with open("locales/en/translation.json", encoding="utf-8") as f:
    en_data = json.load(f)
en_map = flatten(en_data)

# 扫描硬编码英文
result = subprocess.run(
    ["node", "scripts/i18n-scan-visible.cjs", "--all", "--json"],
    capture_output=True, text=True, cwd=REPO, timeout=30
)
data = result.stdout
start = data.find("[")
hits = json.loads(data[start:])

from collections import defaultdict
files = defaultdict(list)
unmatched = []
for h in hits:
    key = en_map.get(h["text"])
    if key:
        h["key"] = key
        files[h["file"]].append(h)
    else:
        unmatched.append(h)

print(f"可自动替换: {len(files)} 文件, {sum(len(v) for v in files.values())} 处")
print(f"无匹配（需手动添加 key）: {len(unmatched)} 处\n")

# 列出无匹配的文本（需要新增翻译 key）
print("=" * 60)
print("需要新增翻译 key 的文本:")
print("=" * 60)
for h in unmatched[:60]:
    print(f"  [{h['file']}:{h['line']}] {h['text'][:80]}")

# 开始替换
total_replaced = 0
for fpath, fhits in sorted(files.items()):
    abs_path = os.path.join(REPO, fpath.replace("/", os.sep))
    if not os.path.exists(abs_path):
        print(f"  SKIP: {fpath}")
        continue
    with open(abs_path, "r", encoding="utf-8") as f:
        content = f.read()
    lines = content.split("\n")

    has_import = "useTranslation" in content and "react-i18next" in content
    replaced = 0

    for h in sorted(fhits, key=lambda x: -x["line"]):
        line_idx = h["line"] - 1
        if line_idx >= len(lines):
            continue
        line = lines[line_idx]
        text = h["text"]
        kind = h["kind"]
        key = h["key"]
        new_line = None

        if kind == "JsxText":
            # JSX 文本节点: 直接替换文本 -> {t("key")}
            escaped = re.escape(text).replace(r"\ ", r"\s+")
            m = re.search(escaped, line)
            if m:
                new_line = line[:m.start()] + '{t("' + key + '")}' + line[m.end():]
        elif kind.startswith("Attr:") or kind.startswith("AttrExpr:"):
            for quote in ['"', "'"]:
                search = quote + text + quote
                if search in line:
                    new_line = line.replace(search, '{t("' + key + '")}', 1)
                    break
        elif kind == "JsxExpressionString":
            for quote in ['"', "'"]:
                search = quote + text + quote
                if search in line:
                    new_line = line.replace(search, '{t("' + key + '")}', 1)
                    break

        if new_line is not None and new_line != line:
            lines[line_idx] = new_line
            replaced += 1

    if replaced > 0:
        if not has_import:
            last_import = 0
            for i, l in enumerate(lines):
                if l.startswith("import ") or "from \"" in l or "from '" in l:
                    last_import = i
            lines.insert(last_import + 1, 'import { useTranslation } from "react-i18next";')
            has_import = True

        with open(abs_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        total_replaced += replaced
        print(f"  ✅ {fpath}: {replaced} 处替换")
    else:
        print(f"  ⚠️ {fpath}: {len(fhits)} 处扫描到但替换失败")

print(f"\n总替换: {total_replaced} 处")
print(f"剩余需手动处理: {len(unmatched)} 处")