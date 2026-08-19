#!/usr/bin/env python3
"""Auto-insert `const { t } = useTranslation();` into component functions that use t() but lack the hook call."""
import re, subprocess, sys

FILES = [
    "frontend/app/aipanel/aifeedbackbuttons.tsx",
    "frontend/app/aipanel/aipanel.tsx",
    "frontend/app/aipanel/aipanelheader.tsx",
    "frontend/app/aipanel/airatelimitstrip.tsx",
    "frontend/app/aipanel/aitooluse.tsx",
    "frontend/app/aipanel/restorebackupmodal.tsx",
    "frontend/app/block/connstatusoverlay.tsx",
    "frontend/app/block/durable-session-flyover.tsx",
    "frontend/app/element/markdown.tsx",
    "frontend/app/element/quicktips.tsx",
    "frontend/app/element/search.tsx",
    "frontend/app/element/streamdown.tsx",
    "frontend/app/modals/modal.tsx",
    "frontend/app/onboarding/fakechat.tsx",
    "frontend/app/onboarding/onboarding.tsx",
    "frontend/app/onboarding/onboarding-features.tsx",
    "frontend/app/onboarding/onboarding-starask.tsx",
    "frontend/app/onboarding/onboarding-upgrade-patch.tsx",
    "frontend/app/suggestion/suggestion.tsx",
    "frontend/app/tab/tabbar.tsx",
    "frontend/app/tab/vtabbar.tsx",
    "frontend/app/view/launcher/launcher.tsx",
    "frontend/app/view/preview/preview.tsx",
    "frontend/app/view/preview/preview-error-overlay.tsx",
    "frontend/app/view/preview/preview-streaming.tsx",
    "frontend/app/view/processviewer/processviewer.tsx",
    "frontend/app/view/tsunami/tsunami.tsx",
    "frontend/app/view/webview/webview.tsx",
    "frontend/app/workspace/widgets.tsx",
]

def find_t_use_lines(src):
    """Find lines containing t( calls that look like translations (t("..."))."""
    out = []
    for i, line in enumerate(src):
        # skip import/lib lines
        if "import" in line or "useTranslation" in line:
            continue
        # t("..." or t('...' or t(` or whitespace t(
        if re.search(r'\bt\(\s*["\'`]', line):
            out.append(i)
    return out

def find_insert_line(src, t_lines):
    """Find the line where hook should be inserted: top-level function body start that contains t lines."""
    # Find first t line, then scan backwards to locate the component function opening
    first_t = t_lines[0]
    # track brace/bracket depth from top to first_t to find enclosing function body '{'
    depth = 0
    func_open_line = None
    for i in range(first_t):
        for ch in src[i]:
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
        # function starts: "function Name(" or "=>" at depth that is a function
    # simpler: find nearest "=> {" or ") {"  or function keyword before first_t
    # We need the component body: look for "=> {" pattern start
    # Approach: scan backwards from first_t; track that we find the most recent
    # line matching `=> {` or `) {` or `function name(` whose opening brace is before first_t
    # We'll track depth while scanning backwards
    depth = 0
    for i in range(first_t - 1, -1, -1):
        line = src[i]
        for ch in reversed(line):
            if ch == '}':
                depth += 1
            elif ch == '{':
                depth -= 1
        # A function body opening: line ends with '{' (or contains '=> {' or ') {') when depth was 0 before counting
        # After processing, if depth < 0 we crossed the opening brace
        if depth < 0:
            # check the line looks like a function/component decl
            if re.search(r'=>\s*\{|\)\s*\{|function\s+\w+\s*\(|\w+\s*=\s*\(', line):
                # find the line after this one (first line inside body)
                return i + 1
            # maybe brace opened on the same line but it's a control flow - continue scanning for function
            pass
    return None

def fix_file(path):
    with open(path, 'r', encoding='utf-8', newline='') as f:
        src = f.read()
    # detect newline style
    nl = '\r\n' if '\r\n' in src else '\n'
    lines = src.split(nl)
    if any('const { t } = useTranslation();' in l for l in lines):
        return ("skip-has-hook", path)
    t_lines = find_t_use_lines(lines)
    if not t_lines:
        return ("skip-no-t", path)
    insert = find_insert_line(lines, t_lines)
    if insert is None:
        return ("FAIL-no-insert", path)
    indent = re.match(r'^(\s*)', lines[insert]).group(1)
    # indent one level deeper if line is not empty
    base_indent = indent if indent else '    '
    hook = base_indent + 'const { t } = useTranslation();'
    # avoid duplicate hook right above if exists
    if lines[insert].strip() == '':
        lines.insert(insert + 1, hook)
        actual = insert + 2
    else:
        lines.insert(insert, hook)
        actual = insert + 1
    with open(path, 'w', encoding='utf-8', newline=nl) as f:
        f.write(nl.join(lines))
    return ("ok", path, actual + 1, lines[actual].strip()[:80])

results = []
for fp in FILES:
    try:
        results.append(fix_file(fp))
    except Exception as e:
        results.append(("EXC", fp, str(e)))

for r in results:
    print(r)