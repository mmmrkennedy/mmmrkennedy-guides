import os
from PIL import Image


def split_image_fixed(image_path, output_folder, rows, cols):
    os.makedirs(output_folder, exist_ok=True)

    with Image.open(image_path) as image:
        width, height = image.size
        sub_image_width = width / cols
        sub_image_height = height / rows

        total = rows * cols
        pad = max(2, len(str(total - 1)))

        counter = 0
        for row in range(rows):
            for col in range(cols):
                left = col * sub_image_width
                upper = row * sub_image_height
                right = left + sub_image_width
                lower = upper + sub_image_height

                cropped = image.crop((left, upper, right, lower))
                name = f"picture_{str(counter).zfill(pad)}.png"
                cropped.save(os.path.join(output_folder, name))
                counter += 1

    print(f"Split into {rows}x{cols} grid ({sub_image_width:.0f}x{sub_image_height:.0f}px) at {output_folder}.")


if __name__ == "__main__":
    split_image_fixed(
        image_path=r"C:\Users\Markk\OneDrive\Desktop\Cod Ripping Tools\Greyhound\exported_files\infinite_warfare\ximages\ui_playercard_829.png",
        output_folder=r"C:\Users\Markk\OneDrive\Desktop\Cod Ripping Tools\Greyhound\exported_files\infinite_warfare\ximages\Cropped",
        rows=3,
        cols=5,
    )
