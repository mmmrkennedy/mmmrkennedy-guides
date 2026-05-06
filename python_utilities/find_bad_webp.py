"""
Find webp images that were compressed with old aggressive settings
and should be re-encoded at q=90.

Signal: bytes-per-pixel (bpp). Aggressively compressed webp sits well
below what q=90 produces at the same resolution.

Rough reference points for screenshots at ~2K:
  - Aggressive (old): ~0.05 - 0.15 bpp
  - q=90 (new):       ~0.30 - 0.70 bpp
  - Lossless:         ~1.0+ bpp

Set THRESHOLD_BPP to the cutoff you want. Default 0.20 catches the old stuff
without flagging reasonable q=90 outputs.
"""

import os
import sys
import csv
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Install Pillow: pip install Pillow")
    sys.exit(1)

THRESHOLD_BPP = 0.20  # flag anything below this


def analyze_webp(path: Path):
    try:
        size = path.stat().st_size
        with Image.open(path) as img:
            w, h = img.size
            # Pillow exposes some webp info via img.info, though 'quality' isn't
            # always present. We mostly care about dimensions here.
    except Exception as e:
        return {"path": path, "error": str(e)}

    pixels = w * h
    if pixels == 0:
        return {"path": path, "error": "zero pixels"}

    return {
        "path": path,
        "width": w,
        "height": h,
        "pixels": pixels,
        "file_size": size,
        "bpp": (size * 8) / pixels,  # bits per pixel — more standard than bytes
        "kb_per_mpx": (size / 1024) / (pixels / 1_000_000),
    }


def find_webps(root: Path):
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            if name.lower().endswith(".webp"):
                yield Path(dirpath) / name


def main():
    folder = input("Folder path: ").strip().strip('"').strip("'")
    root = Path(folder).expanduser()
    if not root.is_dir():
        print(f"Not a directory: {root}")
        sys.exit(1)

    raw_thresh = input(f"BPP threshold [default {THRESHOLD_BPP*8:.2f} bits/px]: ").strip()
    try:
        threshold_bits = float(raw_thresh) if raw_thresh else THRESHOLD_BPP * 8
    except ValueError:
        threshold_bits = THRESHOLD_BPP * 8

    print(f"\nScanning {root}...\n")

    results = []
    errors = []
    for path in find_webps(root):
        m = analyze_webp(path)
        if "error" in m:
            errors.append(m)
        else:
            results.append(m)

    if not results:
        print("No webp files found.")
        return

    flagged = [m for m in results if m["bpp"] < threshold_bits]
    flagged.sort(key=lambda x: x["bpp"])

    # Distribution summary so you can sanity-check the threshold
    bpps = sorted(m["bpp"] for m in results)
    n = len(bpps)
    p = lambda q: bpps[min(n - 1, int(n * q))]
    print(f"Total webp files:  {n}")
    print(f"BPP percentiles:   p10={p(0.10):.3f}  p50={p(0.50):.3f}  p90={p(0.90):.3f}")
    print(f"Threshold:         {threshold_bits:.3f} bits/px")
    print(f"Flagged for replacement: {len(flagged)}\n")

    if flagged:
        print(f"{'BPP':>6}  {'Resolution':>11}  {'Size':>8}  Path")
        print("-" * 90)
        for m in flagged:
            kb = m["file_size"] / 1024
            size_str = f"{kb:.0f}KB" if kb < 1024 else f"{kb/1024:.1f}MB"
            try:
                rel = m["path"].relative_to(root)
            except ValueError:
                rel = m["path"]
            print(
                f"{m['bpp']:6.3f}  "
                f"{m['width']:>5}x{m['height']:<5}  "
                f"{size_str:>8}  "
                f"{rel}"
            )

        # Write a CSV + a plain list of paths for piping into cwebp
        csv_path = root / "_webp_replace_candidates.csv"
        list_path = root / "_webp_replace_candidates.txt"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["path", "width", "height", "file_size", "bpp"])
            for m in flagged:
                writer.writerow([str(m["path"]), m["width"], m["height"],
                                 m["file_size"], f"{m['bpp']:.4f}"])
        with open(list_path, "w", encoding="utf-8") as f:
            for m in flagged:
                f.write(str(m["path"]) + "\n")

        print(f"\nWrote {csv_path.name} and {list_path.name} to {root}")

    if errors:
        print(f"\nUnreadable files ({len(errors)}):")
        for e in errors[:10]:
            print(f"  {e['path']}: {e['error']}")


if __name__ == "__main__":
    main()