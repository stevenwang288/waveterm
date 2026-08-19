#!/usr/bin/env python3
"""Fix all misplaced hooks: delete wrong hooks, find component functions that use t(), add hook at top."""
import re, subprocess, os

root = r"D:\OneDrive\steven\code\ai\13IDE\wave"

# Get tsc error files
out = subprocess.run(["npx", "tsc", "--noEmit"], cwd=root, capture_output=True, text=True, shell=True).stdout
err_files = set()
for line in out.splitlines():
    m = re.match(r'^(frontend/.*?)\(\d+,\d+\): error TS2304: Cannot find name .t.', line.strip())
    if m:
        err_files.add(m.group(1).replace("\\", "/"))

print(f"Files with errors: {len(err_files)}")

# Pattern for component/function definition lines
# Match: function name(, const name = memo((, const name = (, export function name(, export const name = (
COMP_RE = re.compile(r'^\s*((export\s+)?(function|const)\s+\w+|const\s+\w+\s*=\s*(memo|forwardRef)\s*\()')
# Also match simple arrow function component: const X = (props) => { or const X = ({...}) => {
COMP_RE2 = re.compile(r'^\s*const\s+\w+\s*=\s*\(.*\)\s*:\s*.*=>\s*\{')
# Export default function
COMP_RE3 = re.compile(r'^\s*export\s+default\s+function\s+\w+')

def is_component_def(line):
    return bool(COMP_RE.search(line) or COMP_RE2.search(line) or COMP_RE3.search(line))

def is_exported_component(line):
    return bool(re.match(r'^\s*(export\s+)?(const\s+\w+\s*=\s*(memo|forwardRef)\s*\(|function\s+\w+\s*\(|default\s+function\s+\w+\s*\()', line))

def fix_file(fpath):
    path = os.path.join(root, fpath.replace("/", os.sep))
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()
    lines = src.split("\n")
    orig = list(lines)

    # 1) Remove all misplaced hooks (those not at component top level)
    # Find all hook lines, check if they're in a callback/utility function
    # Simple heuristic: hook is misplaced if before it (on the same or previous line) there's a
    # callback definition (=>) or function call (then() or similar)
    hook_lines = [i for i, l in enumerate(lines) if "const { t } = useTranslation();" in l]
    removed = []
    for i in hook_lines:
        # Check if this hook is likely at component top level:
        # - The line before it is either a comment, blank, or component definition line
        # - The line before it is NOT a callback/arrow function start
        prev_line = lines[i-1].strip() if i > 0 else ""
        if prev_line == "" or prev_line.startswith("//") or is_component_def(lines[i-1]):
            continue  # Keep this hook - likely at component top level
        # Check if this hook is inside a callback (arrow function body)
        # Common pattern: callback definition at prev_line, hook at current line
        lines[i] = ""  # mark for removal
        removed.append(i+1)

    # 2) Find all t(" usage lines and add hooks to their component functions
    t_use_lines = [i for i, l in enumerate(lines) if re.search(r'\bt\(\s*["\']', l)]
    # For each t use, find the enclosing component function
    hooks_added = set()
    for t_line in t_use_lines:
        # Find component function definition line before t_line
        comp_found = None
        for j in range(t_line, -1, -1):
            if is_exported_component(lines[j]) or is_component_def(lines[j]):
                # Check if this component actually uses t() (by scanning forward to find t usage)
                # We'll check if the component body contains t() calls
                comp_found = j
                break
        if comp_found is None:
            continue
        # Insert hook at the body start of this component (after its definition line)
        # Find the first line with content that's at the component body indent level
        def_indent = len(lines[comp_found]) - len(lines[comp_found].lstrip())
        body_indent = def_indent + 4
        insert_pos = comp_found + 1
        # Find the actual first line of component body
        while insert_pos < len(lines) and lines[insert_pos].strip() in ("", "{"):
            insert_pos += 1
        # Also ensure we're at the right indent level
        # Check if this component already has a hook
        has_hook = False
        for k in range(comp_found, min(comp_found + 15, len(lines))):
            if "const { t } = useTranslation();" in lines[k]:
                has_hook = True
                break
        if not has_hook:
            hook = " " * body_indent + "const { t } = useTranslation();"
            # Check if hook already exists at this pos
            if insert_pos < len(lines) and lines[insert_pos].strip() == hook.strip():
                continue
            lines.insert(insert_pos, hook)
            hooks_added.add(comp_found)

    # 3) Remove empty hook lines (marked for removal)
    lines = [l for l in lines if l != ""]

    if lines != orig:
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        return (fpath, len(removed), len(hooks_added))
    return None

fixed = []
for f in sorted(err_files):
    result = fix_file(f)
    if result:
        fixed.append(result)
        print(f"  ✅ {result[0]} (removed {result[1]} hooks, added {result[2]} component hooks)")

print(f"Fixed: {len(fixed)} files")