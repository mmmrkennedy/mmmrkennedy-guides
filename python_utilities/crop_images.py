"""Crop every image in a folder to a fixed box.

Box: top-left (990, 0) -> bottom-right (1810, 1440), i.e. an 820x1440 region.
Edit the constants below to change the box.
"""

import os

from PIL import Image

# Crop box: (left, top) -> (right, bottom)
LEFT, TOP, RIGHT, BOTTOM = 990, 0, 1810, 1440

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".gif"}


def crop_folder(folder, output=None):
    if output is None:
        output = os.path.join(folder, "cropped")
    os.makedirs(output, exist_ok=True)

    box_w, box_h = RIGHT - LEFT, BOTTOM - TOP
    cropped = skipped = 0

    for name in os.listdir(folder):
        ext = os.path.splitext(name)[1].lower()
        if ext not in IMAGE_EXTS:
            continue

        src = os.path.join(folder, name)
        if not os.path.isfile(src):
            continue

        try:
            with Image.open(src) as image:
                w, h = image.size
                if w < RIGHT or h < BOTTOM:
                    print(f"SKIP  {name}: {w}x{h} is smaller than crop box "
                          f"(needs >= {RIGHT}x{BOTTOM})")
                    skipped += 1
                    continue

                region = image.crop((LEFT, TOP, RIGHT, BOTTOM))

                save_kwargs = {}
                if ext == ".webp":
                    # match the project's lossless webp pipeline
                    save_kwargs = {"lossless": True, "quality": 100, "method": 6}
                region.save(os.path.join(output, name), **save_kwargs)
                cropped += 1
        except Exception as exc:  # noqa: BLE001 - report and continue
            print(f"ERROR {name}: {exc}")
            skipped += 1

    print(f"\nCropped {cropped} image(s) to {box_w}x{box_h} "
          f"[({LEFT}, {TOP}) -> ({RIGHT}, {BOTTOM})] -> {output}. Skipped {skipped}.")


if __name__ == "__main__":
    folder = input("Folder containing images to crop: ").strip().strip('"')
    crop_folder(folder)
