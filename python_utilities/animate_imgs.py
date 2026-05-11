import os
from PIL import Image


def create_animation(image_folder, output_gif, frame_duration=2):
    images = []
    for file_name in sorted(os.listdir(image_folder)):
        if file_name.lower().endswith(".png"):
            file_path = os.path.join(image_folder, file_name)
            print(file_path)
            images.append(Image.open(file_path))

    if not images:
        raise ValueError("No images found in the specified folder.")

    # 30fps reference: 1 frame ≈ 33.33ms
    duration_in_ms = frame_duration * (1000 / 30)

    os.makedirs(os.path.dirname(output_gif), exist_ok=True)
    images[0].save(
        output_gif,
        save_all=True,
        append_images=images[1:],
        duration=duration_in_ms,
        loop=0,
    )

    print(f"Animation saved as {output_gif}")


if __name__ == "__main__":
    create_animation(
        image_folder=r"C:\Users\Markk\OneDrive\Desktop\Cod Ripping Tools\Greyhound\exported_files\infinite_warfare\ximages\Cropped",
        output_gif=r"C:\Users\Markk\OneDrive\Desktop\Cod Ripping Tools\Greyhound\exported_files\infinite_warfare\ximages\gif\spaceland_dc.gif",
        frame_duration=2,
    )
