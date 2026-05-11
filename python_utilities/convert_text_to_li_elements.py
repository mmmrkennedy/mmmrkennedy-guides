def remove_li_tags(text):
    text = text.strip()
    if text.startswith('<li>') and text.endswith('</li>'):
        return text[4:-5]
    return text


def add_li_tags(text):
    for item in text.split('\n'):
        item = item.strip()
        if item:
            print(f"<li>{item}</li>")


def add_a_tags_to_li(text, optional_path=""):
    if optional_path and not optional_path.endswith("/"):
        optional_path += "/"

    for item in text.split('\n'):
        item = item.strip()
        if item:
            print(f'<li><a href="pictures/{optional_path}">{remove_li_tags(item)}</a></li>')


def read_multiline_input():
    print("Paste your multiline text, then press Enter on an empty line:")
    lines = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line == '':
            break
        lines.append(line)
    return '\n'.join(lines)


if __name__ == "__main__":
    ask = input("1 for add li tags (default) or 2 for add a tags to li tags: ").strip()
    path = ""
    if ask == "2":
        path = input("Enter the path of pictures (after 'pictures/'): ").strip()

    text = read_multiline_input()

    if ask == "2":
        add_a_tags_to_li(text, path)
    else:
        add_li_tags(text)