"""
Originals are backed up to '_img_backup' next to 'src', mirroring the path under 'src'.

Default is lossy q95: on the site's lossless screenshots it saved 78% with worst
PSNR 45.4dB, not visible. Never re-encode an already-lossy WebP (second-generation
artifacts, usually larger); 'Include existing webp files' is for lossless WebP only.
"""

import os
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

DEFAULT_DIR = Path(r"D:\programming_projects\mmmrkennedy-guides\src\games")
DEFAULT_QUALITY = 95
# Lossless mode, where -q is compression effort, not quality.
DEFAULT_EFFORT = 90
SOURCE_EXTS = {".png", ".jpg", ".jpeg", ".bmp"}
BACKUP_FOLDER_NAME = "_img_backup"
SRC_SEGMENT = "src"
PICTURES_FOLDER = "pictures"


def find_images(root: Path, extensions: set[str]) -> list[Path]:
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
    """Uses the last 'src' segment, so C:/src/projects/src/games/... maps under the inner one."""
    parts = input_path.resolve().parts
    src_indices = [i for i, p in enumerate(parts) if p == SRC_SEGMENT]
    if not src_indices:
        return None
    src_idx = src_indices[-1]
    backup_root = Path(*parts[:src_idx]) / BACKUP_FOLDER_NAME
    relative_tail = Path(*parts[src_idx + 1:])
    return backup_root / relative_tail


def backup_original(input_path: Path) -> tuple[bool, str, Path | None]:
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


def convert_to_webp(input_path: Path, quality: int,
                    lossless: bool = False) -> tuple[Path, bool, str]:
    backup_ok, backup_msg, _ = backup_original(input_path)
    if not backup_ok:
        return input_path, False, f"skipped: {backup_msg}"

    output_path = input_path.with_suffix(".webp")
    # In lossless mode -q is compression effort. -pass is lossy-only.
    if lossless:
        encode_args = ["-lossless", "-q", str(quality), "-m", "6", "-mt"]
    else:
        encode_args = ["-q", str(quality), "-m", "6", "-pass", "10", "-mt"]
    try:
        subprocess.run(
            ["cwebp", *encode_args, str(input_path), "-o", str(output_path)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True,
        )
    except subprocess.CalledProcessError as e:
        err = e.stderr.decode("utf-8", errors="replace").strip().splitlines()[-1:] or [""]
        return input_path, False, f"cwebp failed: {err[0]}"
    except FileNotFoundError:
        return input_path, False, "cwebp not on PATH"

    if not output_path.exists():
        return input_path, False, "output not created"

    # Same path on a webp->webp re-encode.
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
    parts = image_path.parts
    try:
        idx = parts.index(PICTURES_FOLDER)
    except ValueError:
        return None
    return Path(*parts[:idx])


def update_html_references(converted: list[Path]) -> list[Path]:
    """Returns the modified HTML files so the git hook can re-stage them."""
    if not converted:
        return []

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
    changed_files: list[Path] = []

    for guide, images in by_guide.items():
        html_files = list(guide.glob("*.html"))
        if not html_files:
            print(f"  {guide.name}: no .html files found")
            continue

        # Paths in HTML are relative to the guide folder.
        replacements = []
        for img in images:
            try:
                rel = img.relative_to(guide)
            except ValueError:
                continue
            old_rel = rel.as_posix()
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
                changed_files.append(html_path)
                print(f"  {html_path.relative_to(guide.parent)}: "
                      f"{file_replacements} replacement(s)")

    print(f"\nHTML update: {total_replacements} replacement(s) "
          f"across {total_files_changed} file(s).")
    return changed_files


def warn_if_no_src(root: Path) -> bool:
    if SRC_SEGMENT not in root.resolve().parts:
        print(f"WARNING: '{root}' does not contain a '{SRC_SEGMENT}' folder.")
        print("Backups can't be created without a 'src' anchor.")
        return input("Continue anyway? (y/n): ").lower() == "y"
    return True


def convert_dir_to_webp(root: Path, quality: int, include_webp: bool,
                        lossless: bool = False) -> None:
    _check_tool("cwebp")
    if not warn_if_no_src(root):
        return
    exts = SOURCE_EXTS | {".webp"} if include_webp else SOURCE_EXTS
    images = find_images(root, exts)
    print(f"Found {len(images)} images in {root}")
    mode = "lossless" if lossless else f"q={quality}"
    converted = run_batch(images, lambda p: convert_to_webp(p, quality, lossless),
                          f"Conversion to WebP @ {mode}")
    suffix_changed = [p for p in converted if p.suffix.lower() != ".webp"]
    update_html_references(suffix_changed)


def convert_dir_to_png(root: Path) -> None:
    _check_tool("dwebp")
    if not warn_if_no_src(root):
        return
    images = find_images(root, {".webp"})
    print(f"Found {len(images)} webp files in {root}")
    run_batch(images, convert_to_png, "Conversion to PNG")


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
                convert_dir_to_webp(DEFAULT_DIR, DEFAULT_QUALITY, include_webp=False,
                                    lossless=False)
                image_dir = DEFAULT_DIR
            else:
                image_dir = prompt_dir(image_dir)
                if not image_dir.is_dir():
                    print(f"Not a directory: {image_dir}")
                    continue
                lossless = input("Lossless? (y/n) [n]: ").lower() == "y"
                default = DEFAULT_EFFORT if lossless else DEFAULT_QUALITY
                label = (f"Effort 1-100 [{default}]: " if lossless
                         else f"Quality 1-100 [{default}]: ")
                quality = prompt_int(label, default, 1, 100)
                include = input("Include existing webp files? (y/n) [n]: ").lower() == "y"
                convert_dir_to_webp(image_dir, quality, include, lossless)
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