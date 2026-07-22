import os
import re

folder = input("Enter the folder path: ").strip().strip('"')

if not os.path.isdir(folder):
    print("That folder does not exist. Exiting.")
    raise SystemExit(1)

# find an html file
html_files = [f for f in os.listdir(folder) if f.lower().endswith(".html")]
if not html_files:
    print("No HTML file found in the folder. Exiting.")
    raise SystemExit(1)

html_path = os.path.join(folder, html_files[0])
print("Using HTML file:", html_files[0])

# make the pictures dir if it is missing
pictures_dir = os.path.join(folder, "pictures")
if not os.path.isdir(pictures_dir):
    os.makedirs(pictures_dir)
    print("Created pictures folder.")

# read the html
with open(html_path, encoding="utf-8") as f:
    html = f.read()

# grab anchor hrefs that point into pictures/ and end with a slash (the incomplete ones)
matches = re.findall(r'<a\s[^>]*href="(pictures/[^"]*/)"', html)
paths = sorted(set(matches))

if not paths:
    print("No incomplete picture paths found.")
    raise SystemExit(0)

for rel in paths:
    target = os.path.join(folder, *rel.split("/"))
    os.makedirs(target, exist_ok=True)
    print("Made:", target)

print(f"Done. Created/verified {len(paths)} directories.")
