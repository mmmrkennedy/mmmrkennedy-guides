#!/usr/bin/env python3
"""
fix_frontmatter_titles.py

Scans .html files recursively for YAML frontmatter title fields that contain
characters requiring quoting (like | : # & * ? { } [ ] > ! % @ ` or embedded
quotes), and wraps them in appropriate quotes so Eleventy can parse them.

Usage:
    python fix_frontmatter_titles.py <directory>
"""

import re
import sys
from pathlib import Path

FRONTMATTER_RE = re.compile(r'^---\s*\n(.*?)\n---', re.DOTALL)
TITLE_LINE_RE = re.compile(r'^(title:\s*)(.+)$', re.MULTILINE)

# Characters that cause YAML to misinterpret an unquoted value
YAML_SPECIAL = set(':|#&*?{}[]>!%@`')


def needs_quoting(value: str) -> bool:
    """Return True if the title value is not already quoted and contains special chars."""
    v = value.strip()
    # Already single-quoted
    if v.startswith("'") and v.endswith("'"):
        return False
    # Already double-quoted
    if v.startswith('"') and v.endswith('"'):
        return False
    return any(c in YAML_SPECIAL for c in v)


def safe_quote(value: str) -> str:
    """
    Wrap value in single quotes.
    If the value contains single quotes, wrap in double quotes instead
    and escape any existing double quotes.
    """
    v = value.strip()
    if "'" in v:
        escaped = v.replace('"', '\\"')
        return f'"{escaped}"'
    return f"'{v}'"


def fix_file(path: Path) -> bool:
    """Fix frontmatter titles in a single file. Returns True if the file was changed."""
    original = path.read_text(encoding='utf-8')

    match = FRONTMATTER_RE.match(original)
    if not match:
        return False

    frontmatter = match.group(1)
    fm_start, fm_end = match.span(1)
    changed = False

    def replace_title(m):
        nonlocal changed
        prefix, value = m.group(1), m.group(2)
        if needs_quoting(value):
            changed = True
            return f"{prefix}{safe_quote(value)}"
        return m.group(0)

    new_frontmatter = TITLE_LINE_RE.sub(replace_title, frontmatter)

    if not changed:
        return False

    new_content = original[:fm_start] + new_frontmatter + original[fm_end:]
    path.write_text(new_content, encoding='utf-8')
    return True


def main():
    root = Path(input("Enter the Path: "))
    if not root.exists():
        print(f"Error: '{root}' does not exist.")
        sys.exit(1)

    files = list(root.rglob('*.html'))
    print(f"Scanning {len(files)} .html file(s) in '{root}'...\n")

    fixed = []
    for f in files:
        if fix_file(f):
            fixed.append(f)
            print(f"  Fixed: {f}")

    print(f"\nDone. {len(fixed)} file(s) updated.")


if __name__ == '__main__':
    main()