import os
from PIL import Image, UnidentifiedImageError

IMAGE_EXTS = ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp')


def list_pictures(folder, size):
    pictures = []
    for root, _, files in os.walk(folder):
        for file in files:
            if not file.lower().endswith(IMAGE_EXTS):
                continue
            file_path = os.path.join(root, file)
            try:
                with Image.open(file_path) as img:
                    if img.size == size:
                        pictures.append(file_path)
            except (UnidentifiedImageError, OSError) as e:
                print(f"Error opening image {file_path}: {e}")
    return pictures


def prompt_size():
    default_sizes = [(3840, 2160), (2560, 1440), (1920, 1080)]
    while True:
        raw = input("Resolution (1: 4K, 2: 2K, 3: 1080p, 4: Custom): ").strip()
        if raw in {"1", "2", "3"}:
            return default_sizes[int(raw) - 1]
        if raw == "4":
            try:
                return int(input("Width: ")), int(input("Height: "))
            except ValueError:
                print("Invalid number, try again.")
                continue
        print("Pick 1, 2, 3, or 4.")


def main():
    folder = input("Enter the folder path: ").strip().strip('\'"')
    if not os.path.isdir(folder):
        print(f"Not a directory: {folder}")
        return

    size = prompt_size()
    pictures = list_pictures(folder, size)

    if pictures:
        print(f"Found {len(pictures)} pictures of size {size}:")
        for picture in pictures:
            print(picture)
    else:
        print(f"No pictures of size {size} found in {folder}")


if __name__ == "__main__":
    main()
