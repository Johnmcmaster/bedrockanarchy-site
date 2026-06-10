#!/usr/bin/env python3
"""Generate a giant obsidian wall-text schematic spelling OFJA.

Output matches the AutoBuild module's SchematicBlock layout:
    struct SchematicBlock { int x, y, z; std::string name; uint32_t runtimeId; int variant; };

The text is built as an upright wall: X = horizontal, Y = vertical (up),
Z = wall thickness/depth. Origin (0,0,0) is the bottom-left-front corner.

Tune SCALE (block size of each font pixel) and DEPTH (wall thickness) to
make it as large as you want.
"""

import json

# --- size knobs -------------------------------------------------------------
SCALE = 20   # each font pixel becomes SCALE x SCALE blocks
DEPTH = 4    # wall thickness in blocks (Z)
LETTER_SPACING = 1   # blank font-columns between letters
BLOCK_NAME = "minecraft:obsidian"
RUNTIME_ID = 0       # resolved by name in-game; leave 0 unless you hardcode it
VARIANT = 0
# ---------------------------------------------------------------------------

# 5 wide x 7 tall glyphs, row 0 = top.
GLYPHS = {
    "O": [
        "01110",
        "10001",
        "10001",
        "10001",
        "10001",
        "10001",
        "01110",
    ],
    "F": [
        "11111",
        "10000",
        "10000",
        "11110",
        "10000",
        "10000",
        "10000",
    ],
    "J": [
        "00111",
        "00010",
        "00010",
        "00010",
        "00010",
        "10010",
        "01100",
    ],
    "A": [
        "01110",
        "10001",
        "10001",
        "11111",
        "10001",
        "10001",
        "10001",
    ],
}

TEXT = "OFJA"
GLYPH_W = 5
GLYPH_H = 7


def generate():
    blocks = []
    col_cursor = 0  # in font-pixels, left to right
    for ch in TEXT:
        glyph = GLYPHS[ch]
        for row in range(GLYPH_H):
            for col in range(GLYPH_W):
                if glyph[row][col] != "1":
                    continue
                # font pixel -> SCALE x SCALE block patch
                px = (col_cursor + col) * SCALE
                # row 0 is top, so flip vertically: top row gets highest Y
                py = (GLYPH_H - 1 - row) * SCALE
                for dx in range(SCALE):
                    for dy in range(SCALE):
                        for dz in range(DEPTH):
                            blocks.append((px + dx, py + dy, dz))
        col_cursor += GLYPH_W + LETTER_SPACING
    return blocks


def main():
    blocks = generate()
    width = (len(TEXT) * GLYPH_W + (len(TEXT) - 1) * LETTER_SPACING) * SCALE
    height = GLYPH_H * SCALE
    print(f"OFJA schematic: {len(blocks):,} obsidian blocks")
    print(f"dimensions: {width} wide x {height} tall x {DEPTH} deep (blocks)")

    # JSON (portable)
    with open("ofja_schematic.json", "w") as f:
        json.dump(
            {
                "name": "OFJA",
                "block": BLOCK_NAME,
                "size": {"x": width, "y": height, "z": DEPTH},
                "count": len(blocks),
                "blocks": [
                    {"x": x, "y": y, "z": z, "name": BLOCK_NAME,
                     "runtimeId": RUNTIME_ID, "variant": VARIANT}
                    for (x, y, z) in blocks
                ],
            },
            f,
        )

    # C++ initializer you can paste into a hardcoded loader
    with open("ofja_schematic.cpp.inc", "w") as f:
        f.write("// Auto-generated OFJA obsidian schematic.\n")
        f.write("// schematicBlocks.reserve(%d);\n" % len(blocks))
        for (x, y, z) in blocks:
            f.write(
                'schematicBlocks.push_back({%d, %d, %d, "%s", %du, %d});\n'
                % (x, y, z, BLOCK_NAME, RUNTIME_ID, VARIANT)
            )

    print("wrote ofja_schematic.json and ofja_schematic.cpp.inc")


if __name__ == "__main__":
    main()
