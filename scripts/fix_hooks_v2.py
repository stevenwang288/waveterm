#!/usr/bin/env python3
"""Fix misplaced useTranslation hooks: remove all, then re-insert at correct component top-level per tsc error locations."""
import re, subprocess, sys, collections

root = r"D:\OneDrive\steven\code\ai\13IDE\wave"

# Get tsc errors: file(line,col): message
out = subprocess.run(["npx", "tsc", "--noEmit"], cwd=root, capture_output=True, text=True, shell=True).stdout
errs = collections.defaultdict(dict)  # file -> {lineno: msg}
cur_file = None
for line in out.splitlines():
    m = re.match(r'^(.*?)\((\d+),(\d+)\):\s*error (TS\d+): (.*)$', line.strip())
    if m:
        fname, ln, col, code, msg = m.groups()
        fname = fname.replace("/", "\\")
        msg = msg.strip()
        if code == "TS2304" and "Cannot find name 't'" in msg:
            errs[fname][int(ln)] = msg
        # also collect any unexpected syntax errors per file
        if code in ("TS1131", "TS1109", "TS1128", "TS1005", "TS1003", "TS1136", "TS2657", "TS1135"):
            errs.setdefault(fname, {})[-1] = msg  # marker for syntax errors

if not errs:
    print("No TS2304 t errors found. Done.")
    sys.exit(0)

def find_component_start(lines, use_line):
    """From use_line upward, find the enclosing component/function definition line."""
    # We track brace depth going up: walk from use_line-1 back to 0
    # Simpler: find candidate function definition lines above use_line by regex,
    # then verify the function's opening brace encloses use_line via brace counting.
    depth = 0
    opens = []  # (lineno, indent) of function-body opening positions
    i = use_line - 1  # 0-based line above the use
    # Walk upward counting braces to find the function body start
    for j in range(i, -1, -1):
        line = lines[j]
        opens_here = line.count("{")
        closes_here = line.count("}")
        # If closing braces make depth positive, we passed a function end while going up
        # We're walking up, so a '}' means we entered a deeper scope below (already passed)
        # Count: going up, adding opens decreases depth
        pass
    # Alternative simple approach: find nearest line above that starts a function/component
    # pattern and whose indent is <= the use line indent (i.e., a containing scope)
    use_indent = len(lines[use_line - 1]) - len(lines[use_line - 1].lstrip())
    for j in range(use_line - 2, -1, -1):
        line = lines[j]
        stripped = line.strip()
        # function/component definitions
        if re.match(r'^(export\s+)?(function|const)\s+\w+', stripped) or "=> {" in stripped or re.match(r'^\)\s*=>\s*\{', stripped):
            indent = len(line) - len(line.lstrip())
            # ensure this definition is at indentation <= use line (enclosing or same level)
            if indent <= use_indent or "memo" in stripped or "export" in stripped:
                return j  # line index of definition (insert after its body `{` + content)
    return None

def insert_hook_into_component(lines, def_line):
    """Insert hook after the def line's opening brace — find first line with content at deeper indent."""
    # Walk forward from def_line, track braces; insert right after the '{' that opens function body
    depth = 0
    for k in range(def_line, len(lines)):
        stripped = lines[k].strip()
        opens = stripped.count("{")
        closes = stripped.count("}")
        if k > def_line:
            depth += opens - closes
        else:
            depth += opens  # the def line opens the body
        if depth > 0 and k > def_line:
            # we are inside the body; find first non-blank statement line to insert before
            # Insert right after the brace line if body starts on next line with content
            # Look for first meaningful line inside body:
            for b in range(k, len(lines)):
                s = lines[b].strip()
                if s.startswith("//") or s == "" or s.startswith("*") or s.startswith("/*"):
                    continue
                if s == "{":
                    continue
                # check if this line belongs to def (indent > def indent)
                indent = len(lines[b]) - len(lines[b].lstrip())
                def_indent = len(lines[def_line]) - len(lines[def_line].lstrip())
                if indent <= def_indent:
                    continue
                return b, indent
        if depth == 0 and k > def_line:
            break
    return None

def get_body_indent(lines, idx):
    """Get indentation of first content line after idx."""
    for k in range(idx + 1, len(lines)):
        s = lines[k].strip()
        if s and not s.startswith("//"):
            return len(lines[k]) - len(lines[k].lstrip())
    return 4

changed = []
for fname in sorted(errs.keys()):
    path = root + "\\" + fname
    try:
        with open(path, "r", encoding="utf-8", newline="") as f:
            src = f.read()
    except FileNotFoundError:
        print("MISSING:", path); continue
    nl = "\r\n" if "\r\n" in src else "\n"
    lines = src.split(nl)
    orig_lines = list(lines)

    # 1) Remove all misplaced  const { t } = useTranslation(); lines
    new_lines = [l for l in lines if "const { t } = useTranslation();" not in l]
    lines = new_lines

    # 2) For each error line, find component start and insert hook
    # map line numbers from errs (original numbering) — after removal indices shift, so recompute
    # Recompute: we removed k lines before each error; easier: process by scanning current lines
    # and use errs line numbers approximately: find the t( usage lines in current content
    t_use_lines = []
    for ln in errs[fname]:
        if ln <= 0:  # syntax error marker
            continue
        # approximate original line -> current (after removals): shift by count of removed lines before ln
        removed_before = sum(1 for i, l in enumerate(orig_lines) if "const { t } = useTranslation();" in l and i < ln - 1)
        cur_ln = ln - removed_before
        t_use_lines.append(cur_ln)

    insert_points = set()
    for ln in t_use_lines:
        if ln - 1 >= len(lines):
            continue
        def_line = find_component_start(lines, ln)
        if def_line is None:
            continue
        res = insert_hook_into_component(lines, def_line)
        if res:
            body_ln, indent = res
            insert_points.add((body_ln, indent))
    if not insert_points:
        print(f"!! {fname}: could not locate insert point for {len(t_use_lines)} t-uses")
        continue

    # insert hooks (sorted desc so indices stay valid)
    for body_ln, indent in sorted(insert_points, reverse=True):
        hook = " " * indent + "const { t } = useTranslation();"
        # skip if already adjacent
        if body_ln - 1 >= 0 and lines[body_ln - 1].strip() == "const { t } = useTranslation();":
            continue
        lines.insert(body_ln, hook)

    if lines != orig_lines:
        with open(path, "w", encoding="utf-8", newline=nl) as f:
            f.write(nl.join(lines))
        changed.append((fname, len(insert_points), len(t_use_lines)))

print("changed files:")
for c in changed:
    print(f"  {c[0]}  hooks={c[1]} uses={c[2]}")
print("total:", len(changed))