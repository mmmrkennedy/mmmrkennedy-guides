import os
import re

IMAGE_EXTS = ('.png', '.webp', '.jpg', '.jpeg', '.gif', '.avif', '.svg')
TEXT_EXTS = ('.html', '.htm', '.js', '.jsx', '.ts', '.tsx', '.css', '.json', '.md', '.txt')
SKIP_DIRS = {'node_modules', '.git', 'dist', 'build', '.idea', '.venv', '__pycache__'}

# Matches any path-ish token ending in an image extension, e.g.
#   pictures/pap/pap_bastion.png   /games/IW/.../pictures/blue_diamond.webp
REF_RE = re.compile(
    r'[\w./\\-]*\.(?:' + '|'.join(e.lstrip('.') for e in IMAGE_EXTS) + r')',
    re.IGNORECASE,
)


def norm(path):
    return path.replace('\\', '/').lower()


def find_repo_root(start):
    """Walk up from start until a folder containing .git or package.json."""
    current = os.path.abspath(start)
    while True:
        if any(os.path.exists(os.path.join(current, m)) for m in ('.git', 'package.json')):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return os.path.abspath(start)
        current = parent


def walk(root):
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for file in files:
            yield os.path.join(dirpath, file)


def find_images(map_dir):
    """All image files under map_dir, as paths relative to map_dir."""
    return [
        os.path.relpath(p, map_dir)
        for p in walk(map_dir)
        if p.lower().endswith(IMAGE_EXTS)
    ]


def collect_references(*roots):
    """Every image path referenced by any text file under the given roots."""
    refs = set()
    seen = set()
    for root in roots:
        for path in walk(root):
            if not path.lower().endswith(TEXT_EXTS):
                continue
            real = os.path.realpath(path)
            if real in seen:
                continue
            seen.add(real)
            try:
                with open(path, 'r', encoding='utf-8', errors='ignore') as file:
                    content = file.read()
            except OSError:
                continue
            for match in REF_RE.findall(content):
                refs.add(norm(match))
    return refs


def collect_unused(map_dir, refs):
    """Images under map_dir whose relative path is not referenced anywhere."""
    unused = []
    for rel in find_images(map_dir):
        rel_norm = norm(rel)
        base = os.path.basename(rel_norm)
        # A reference counts if it ends with the map-relative path (exact), or
        # falls back to the bare file name (paths built at runtime).
        if any(ref.endswith(rel_norm) or ref.endswith('/' + base) or ref == base for ref in refs):
            continue
        unused.append(os.path.join(map_dir, rel))
    return sorted(unused)


def list_direct_subfolders(folder_path):
    return [
        name for name in os.listdir(folder_path)
        if os.path.isdir(os.path.join(folder_path, name))
    ]


if __name__ == "__main__":
    mode = input(r"Game Path (games\BO4\) or Map Path (\games\BO4\tag_der_toten) (g or m): ").lower()

    if mode == "g":
        root_path = input(r"Enter game path (Example: D:\zombiesGuidesPublic\src\games\BO4\): ").strip('" ')
        map_dirs = [
            os.path.join(root_path, sub) for sub in list_direct_subfolders(root_path)
            if sub not in SKIP_DIRS
        ]
    else:
        root_path = input(r"Enter directory path (Example: D:\zombiesGuidesPublic\src\games\BO4\tag_der_toten): ").strip('" ')
        map_dirs = [root_path]

    repo_root = find_repo_root(root_path)
    print(f"Scanning references under {repo_root} ...")
    references = collect_references(repo_root)

    paths = []
    for map_dir in map_dirs:
        paths.extend(collect_unused(map_dir, references))

    if not paths:
        print("All images are being used")
    else:
        print(f"Unused images ({len(paths)}):")
        for path in paths:
            print(path)
