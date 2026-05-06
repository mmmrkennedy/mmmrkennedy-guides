"""
Convert images to/from WebP using cwebp/dwebp.

Originals are backed up to a sibling '_img_backup' folder next to 'src'
before conversion, mirroring the path structure under 'src'.
e.g. src/games/BO4/foo.png -> _img_backup/games/BO4/foo.png
"""

import os
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

DEFAULT_DIR = Path(r"D:\programming_projects\mmmrkennedy-guides\src\games")
SOURCE_EXTS = {".png", ".jpg", ".jpeg", ".bmp"}
BACKUP_FOLDER_NAME = "_img_backup"
SRC_SEGMENT = "src"
PICTURES_FOLDER = "pictures"


def find_images(root: Path, extensions: set[str]) -> list[Path]:
    """One walk, returns the full list. Beats walking twice for a count."""
    exts = {e.lower() for e in extensions}
    return [
        Path(dirpath) / name
        for dirpath, _, filenames in os.walk(root)
        for name in filenames
        if Path(name).suffix.lower() in exts
    ]


def _check_tool(name: str) -> None:
    if shutil.which(name) is None:
        sys.exit(f"Error: '{name}' not found on PATH. Install Google's libwebp.")


def resolve_backup_path(input_path: Path) -> Path | None:
    """
    Map src/games/foo/bar.png -> <parent of src>/_img_backup/games/foo/bar.png

    Returns None if 'src' isn't in the path. Uses the *last* 'src' segment so
    paths like C:/src/projects/src/games/... map under the inner one.
    """
    parts = input_path.resolve().parts
    src_indices = [i for i, p in enumerate(parts) if p == SRC_SEGMENT]
    if not src_indices:
        return None
    src_idx = src_indices[-1]
    backup_root = Path(*parts[:src_idx]) / BACKUP_FOLDER_NAME
    relative_tail = Path(*parts[src_idx + 1:])
    return backup_root / relative_tail


def backup_original(input_path: Path) -> tuple[bool, str, Path | None]:
    """
    Copy original to backup location before conversion.
    Returns (ok, message, backup_path). If backup exists, returns (False, ...)
    so the caller can skip conversion.
    """
    backup_path = resolve_backup_path(input_path)
    if backup_path is None:
        return False, f"no '{SRC_SEGMENT}' segment in path, can't determine backup location", None

    if backup_path.exists():
        return True, "backup already exists, proceeding", backup_path

    try:
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(input_path, backup_path)
    except OSError as e:
        return False, f"backup failed: {e}", backup_path

    return True, "ok", backup_path


def convert_to_webp(input_path: Path, quality: int) -> tuple[Path, bool, str]:
    """Returns (path, success, message). Original is deleted only on success."""
    backup_ok, backup_msg, _ = backup_original(input_path)
    if not backup_ok:
        return input_path, False, f"skipped: {backup_msg}"

    output_path = input_path.with_suffix(".webp")
    try:
        subprocess.run(
            ["cwebp", "-q", str(quality), "-m", "6", "-pass", "10", "-mt",
             str(input_path), "-o", str(output_path)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True,
        )
    except subprocess.CalledProcessError as e:
        err = e.stderr.decode("utf-8", errors="replace").strip().splitlines()[-1:] or [""]
        return input_path, False, f"cwebp failed: {err[0]}"
    except FileNotFoundError:
        return input_path, False, "cwebp not on PATH"

    if not output_path.exists():
        return input_path, False, "output not created"

    # Only delete the source if input and output are different files.
    # (They differ because suffix changed — but webp->webp re-encode would match.)
    if input_path != output_path:
        try:
            input_path.unlink()
        except OSError as e:
            return input_path, True, f"converted but couldn't delete original: {e}"

    return input_path, True, "ok"


def convert_to_png(input_path: Path) -> tuple[Path, bool, str]:
    backup_ok, backup_msg, _ = backup_original(input_path)
    if not backup_ok:
        return input_path, False, f"skipped: {backup_msg}"

    output_path = input_path.with_suffix(".png")
    try:
        subprocess.run(
            ["dwebp", str(input_path), "-o", str(output_path)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True,
        )
    except subprocess.CalledProcessError as e:
        err = e.stderr.decode("utf-8", errors="replace").strip().splitlines()[-1:] or [""]
        return input_path, False, f"dwebp failed: {err[0]}"
    except FileNotFoundError:
        return input_path, False, "dwebp not on PATH"

    if not output_path.exists():
        return input_path, False, "output not created"

    try:
        input_path.unlink()
    except OSError as e:
        return input_path, True, f"converted but couldn't delete original: {e}"

    return input_path, True, "ok"


def run_batch(images: list[Path], worker, label: str) -> list[Path]:
    """Generic parallel runner. Returns list of successfully-converted paths."""
    if not images:
        print("No images found.")
        return []

    total = len(images)
    succeeded: list[Path] = []
    skipped = 0
    failed: list[tuple[Path, str]] = []

    with ThreadPoolExecutor() as executor:
        futures = {executor.submit(worker, p): p for p in images}
        for i, future in enumerate(as_completed(futures), start=1):
            path, ok, msg = future.result()
            if ok:
                succeeded.append(path)
                print(f"[{i}/{total}] {path.name}")
            elif msg.startswith("skipped:"):
                skipped += 1
                failed.append((path, msg))
                print(f"[{i}/{total}] SKIP {path.name}: {msg}")
            else:
                failed.append((path, msg))
                print(f"[{i}/{total}] FAILED {path.name}: {msg}")

    print(f"\n{label}: {len(succeeded)}/{total} succeeded, "
          f"{skipped} skipped, {len(failed) - skipped} failed.")
    if failed:
        print("Issues:")
        for path, msg in failed[:20]:
            print(f"  {path}: {msg}")
        if len(failed) > 20:
            print(f"  ... and {len(failed) - 20} more")

    return succeeded


def find_guide_folder(image_path: Path) -> Path | None:
    """
    Given an image path, walk up to find the guide folder (the dir containing
    'pictures'). Returns None if no 'pictures' segment is found.

    src/games/WW2/groesten_haus/pictures/foo/bar.png -> src/games/WW2/groesten_haus
    """
    parts = image_path.parts
    try:
        idx = parts.index(PICTURES_FOLDER)
    except ValueError:
        return None
    return Path(*parts[:idx])


def update_html_references(converted: list[Path]) -> None:
    """
    For every successfully-converted image, rewrite its references in the
    HTML files of its guide folder. Each HTML is read/written exactly once
    even if many of its images were converted.
    """
    if not converted:
        return

    # Group converted images by guide folder so each HTML is only touched once.
    by_guide: dict[Path, list[Path]] = {}
    orphans: list[Path] = []
    for img in converted:
        guide = find_guide_folder(img)
        if guide is None:
            orphans.append(img)
        else:
            by_guide.setdefault(guide, []).append(img)

    if orphans:
        print(f"\n{len(orphans)} converted image(s) had no '{PICTURES_FOLDER}' "
              "ancestor — skipping HTML update for those.")

    print(f"\nUpdating HTML references in {len(by_guide)} guide folder(s)...")

    total_files_changed = 0
    total_replacements = 0

    for guide, images in by_guide.items():
        html_files = list(guide.glob("*.html"))
        if not html_files:
            print(f"  {guide.name}: no .html files found")
            continue

        # Build a list of (old_relative_path, new_relative_path) for this guide.
        # Paths in HTML are relative to the guide folder, e.g. "pictures/foo/bar.png".
        replacements = []
        for img in images:
            try:
                rel = img.relative_to(guide)
            except ValueError:
                continue
            old_rel = rel.as_posix()  # forward slashes for HTML
            new_rel = rel.with_suffix(".webp").as_posix()
            replacements.append((old_rel, new_rel))

        for html_path in html_files:
            try:
                content = html_path.read_text(encoding="utf-8")
            except OSError as e:
                print(f"  could not read {html_path}: {e}")
                continue

            new_content = content
            file_replacements = 0
            for old_rel, new_rel in replacements:
                count = new_content.count(old_rel)
                if count:
                    new_content = new_content.replace(old_rel, new_rel)
                    file_replacements += count

            if file_replacements:
                try:
                    html_path.write_text(new_content, encoding="utf-8")
                except OSError as e:
                    print(f"  could not write {html_path}: {e}")
                    continue
                total_files_changed += 1
                total_replacements += file_replacements
                print(f"  {html_path.relative_to(guide.parent)}: "
                      f"{file_replacements} replacement(s)")

    print(f"\nHTML update: {total_replacements} replacement(s) "
          f"across {total_files_changed} file(s).")


def warn_if_no_src(root: Path) -> bool:
    """Pre-flight: warn if the input dir doesn't sit under a 'src' folder."""
    if SRC_SEGMENT not in root.resolve().parts:
        print(f"WARNING: '{root}' does not contain a '{SRC_SEGMENT}' folder.")
        print("Backups can't be created without a 'src' anchor.")
        return input("Continue anyway? (y/n): ").lower() == "y"
    return True


def convert_dir_to_webp(root: Path, quality: int, include_webp: bool) -> None:
    _check_tool("cwebp")
    if not warn_if_no_src(root):
        return
    exts = SOURCE_EXTS | {".webp"} if include_webp else SOURCE_EXTS
    images = find_images(root, exts)
    print(f"Found {len(images)} images in {root}")
    converted = run_batch(images, lambda p: convert_to_webp(p, quality),
                          f"Conversion to WebP @ q={quality}")
    # Don't rewrite HTML for webp->webp re-encodes (suffix didn't change).
    suffix_changed = [p for p in converted if p.suffix.lower() != ".webp"]
    update_html_references(suffix_changed)


def convert_dir_to_png(root: Path) -> None:
    _check_tool("dwebp")
    if not warn_if_no_src(root):
        return
    images = find_images(root, {".webp"})
    print(f"Found {len(images)} webp files in {root}")
    run_batch(images, convert_to_png, "Conversion to PNG")


# ---------- prompts ----------

def prompt_dir(previous: Path | None) -> Path:
    if previous and input(f"Use previous directory ({previous})? (y/n): ").lower() != "n":
        return previous
    raw = input("Enter image directory (blank for default): ").strip().strip('\'"')
    if not raw:
        print(f"Using default: {DEFAULT_DIR}")
        return DEFAULT_DIR
    return Path(raw)


def prompt_int(prompt: str, default: int, lo: int, hi: int) -> int:
    raw = input(prompt).strip()
    if not raw:
        return default
    try:
        v = int(raw)
        if lo <= v <= hi:
            return v
    except ValueError:
        pass
    print(f"Invalid value, using {default}")
    return default


def main() -> None:
    image_dir: Path | None = None
    while True:
        choice = input("\n(1) PNG/JPG -> WebP   (2) WebP -> PNG   (3) Quit: ").strip()

        if choice == "1":
            if input("Default config? (y/n): ").lower() != "n":
                convert_dir_to_webp(DEFAULT_DIR, 90, include_webp=False)
                image_dir = DEFAULT_DIR
            else:
                image_dir = prompt_dir(image_dir)
                if not image_dir.is_dir():
                    print(f"Not a directory: {image_dir}")
                    continue
                quality = prompt_int("Quality 1-100 [90]: ", 90, 1, 100)
                include = input("Include existing webp files? (y/n) [n]: ").lower() == "y"
                convert_dir_to_webp(image_dir, quality, include)
                break

        elif choice == "2":
            image_dir = prompt_dir(image_dir)
            if not image_dir.is_dir():
                print(f"Not a directory: {image_dir}")
                continue
            convert_dir_to_png(image_dir)
            break

        elif choice == "3":
            break

        else:
            print("Pick 1, 2, or 3.")


if __name__ == "__main__":
    main()