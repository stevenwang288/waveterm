#!/usr/bin/env python3
"""Convert all git-modified .ts/.tsx files to LF (matches .editorconfig), keeping content."""
import subprocess, os

root = r"D:\OneDrive\steven\code\ai\13IDE\wave"
out = subprocess.run(["git", "diff", "--name-only"], cwd=root, capture_output=True, text=True).stdout
files = [l.strip() for l in out.splitlines() if l.strip().endswith((".ts", ".tsx"))]
converted = 0
for f in files:
    path = os.path.join(root, f)
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except FileNotFoundError:
        continue
    if b"\r\n" in data:
        with open(path, "wb") as fh:
            fh.write(data.replace(b"\r\n", b"\n"))
        converted += 1
print(f"converted {converted} files to LF")