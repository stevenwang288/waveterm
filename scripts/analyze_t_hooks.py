#!/usr/bin/env python3
"""Analyze each error file: list component functions and which ones use t() but lack a hook."""
import re, subprocess, collections

root = r"D:\OneDrive\steven\code\ai\13IDE\wave"

out = subprocess.run(["npx", "tsc", "--noEmit"], cwd=root, capture_output=True, text=True).stdout
err_files = collections.OrderedDict()
for line in out.splitlines():
    m = re.match(r'^(.*?)\(\d+,\d+\): error TS2304: Cannot find name .t.', line.strip())
    if m and "/frontend/" in m.group(1):
        err_files.setdefault(m.group(1).replace("\\", "/"), set())

for fname in err_files:
    path = root + "/" + fname
    try:
        with open(path, "r", encoding="utf-8", newline="") as f:
            lines = f.read().split("\n")
    except FileNotFoundError:
        print(f"!! {fname}: MISSING")
        continue

    # find all component defs and their line ranges via brace counting
    defs = []  # (name, start_line, end_line, body_line)
    stack = []  # (name, def_line, brace_line, word_open_depth)
    # We'll do simplified scan: find "const X = memo(" / "const X = (" / "function X(" / "export function X("
    # then find matching close paren of the arrow function and its body braces.
    i = 0
    comp_pattern = re.compile(r'^(?:export\s+)?(?:const\s+(\w+)\s*=\s*(?:(?:memo|forwardRef)\s*\()?|function\s+(\w+)\s*\()')
    arity = 0  # not used
    # Track all function-ish boundaries: simpler approach - detect ' => {' lines and 'function'
    func_starts = []  # line index where a component/function body starts (the '{' of the body)
    func_def_lines = []  # name + start
    for idx, line in enumerate(lines):
        m = comp_pattern.search(line)
        if m:
            name = m.group(1) or m.group(2)
            func_def_lines.append((idx, name))
        if re.search(r'=>\s*\{', line) and not line.strip().startswith("//"):
            # body brace is on this line
            func_starts.append((idx, idx))
        elif re.search(r'\)\s*\{\s*$', line) and re.search(r'function|=>', line):
            func_starts.append((idx, idx))
    # For each t-use line, find the most recent def whose body encloses it
    t_uses = []
    for idx, line in enumerate(lines):
        if re.search(r'\bt\(\s*["\'`]', line):
            # find enclosing component: nearest func_le line before idx
            candidates = [d for d in func_def_lines if d[0] < idx]
            if candidates:
                t_uses.append((idx, candidates[-1][1], candidates[-1][0]))
    print(f"=== {fname} ===")
    print(f"  t-uses: {len(t_uses)}")
    # group t-uses by component name
    by_comp = collections.defaultdict(list)
    for use_line, comp_name, def_line in t_uses:
        by_comp[comp_name].append(use_line + 1)
    for comp_name, use_lines in by_comp.items():
        # check if this comp has hook in its body range
        # find hook presence: is there a 'const { t } = useTranslation();' line anywhere (per comp hard)
        print(f"  comp '{comp_name}' uses t at lines: {use_lines[:8]}{'...' if len(use_lines)>8 else ''}")
    # check current hook placements
    hook_lines = [idx + 1 for idx, l in enumerate(lines) if "const { t } = useTranslation();" in l]
    if hook_lines:
        print(f"  hooks currently at lines: {hook_lines}")