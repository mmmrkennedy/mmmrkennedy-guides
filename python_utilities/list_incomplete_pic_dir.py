import re
import os

# <a ...>text</a> with any attribute order/count, text may span lines
LINK_RE = re.compile(r'<a\b([^>]*)>(.*?)</a>', re.IGNORECASE | re.DOTALL)
HREF_RE = re.compile(r'\bhref\s*=\s*"([^"]*)"', re.IGNORECASE)
HEADER_RE = re.compile(
    r'<h2\b[^>]*>(.*?)</h2>|<p\b[^>]*class="[^"]*\bstep-group-title\b[^"]*"[^>]*>(.*?)</p>',
    re.IGNORECASE | re.DOTALL,
)
TAG_RE = re.compile(r'<[^>]+>')
EXTERNAL_RE = re.compile(r'^(?:[a-z][a-z0-9+.-]*:|//)', re.IGNORECASE)


def clean_text(html):
    """Strip nested tags and collapse whitespace."""
    return re.sub(r'\s+', ' ', TAG_RE.sub('', html)).strip()


def is_incomplete(href):
    """A picture link left pointing at a directory instead of a file."""
    if not href or href.startswith('#'):
        return False
    if EXTERNAL_RE.match(href):  # http:, https:, mailto:, //cdn... - never a pic dir
        return False
    return href.rstrip().endswith('/')


def find_incomplete_links(text):
    """Yield (position, link_text) for every incomplete link in the document."""
    for match in LINK_RE.finditer(text):
        href_match = HREF_RE.search(match.group(1))
        if not href_match or not is_incomplete(href_match.group(1)):
            continue
        link_text = clean_text(match.group(2))
        if link_text:
            yield match.start(), link_text


def find_headers(text):
    """Yield (position, header_text) for every section header."""
    for match in HEADER_RE.finditer(text):
        header = clean_text(match.group(1) or match.group(2) or '')
        if header:
            yield match.start(), header


def build_report(text):
    # Walk headers and links together in document order so each link is
    # attributed to the header that precedes it.
    events = [(pos, 0, value) for pos, value in find_headers(text)]
    events += [(pos, 1, value) for pos, value in find_incomplete_links(text)]
    events.sort(key=lambda e: (e[0], e[1]))

    lines = []
    current_header = None
    last_written_header = None
    for _, kind, value in events:
        if kind == 0:
            current_header = value
            continue
        if current_header and current_header != last_written_header:
            lines.append(f"\n{current_header}\n")
            last_written_header = current_header
        lines.append(f" - {value}\n")
    return lines


def save_incomplete_links(html_path):
    try:
        with open(html_path, 'r', encoding='utf-8') as f:
            text = f.read()
    except FileNotFoundError:
        print(f"Error: File '{html_path}' not found")
        return
    except OSError as e:
        print(f"Error: {e}")
        return

    lines_to_write = build_report(text)

    if not lines_to_write:
        print("No incomplete links found")
        return

    with open("incomplete_links.txt", 'w', encoding='utf-8') as out:
        out.writelines(lines_to_write)

    count = sum(1 for line in lines_to_write if line.startswith(' - '))
    print(f"Found {count} incomplete links. Saved to incomplete_links.txt")

    if os.name == 'nt':
        os.system('start incomplete_links.txt')
    elif os.name == 'posix':
        os.system('open incomplete_links.txt')


if __name__ == "__main__":
    html_path = input("Enter the path to the HTML file: ").strip('\'"')
    save_incomplete_links(html_path)
