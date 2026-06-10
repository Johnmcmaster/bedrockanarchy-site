#!/usr/bin/env python3
"""
gen_ofja.py - Generate an "unbelievably large" obsidian schematic spelling "OFJA"
for the AutoBuild module (SchematicBlock { x, y, z, name, runtimeId, variant }).

The AutoBuild loadSchematic() walks a list of blocks placed relative to an
origin (pos1). This generator emits that block list. Each letter is drawn from a
5-wide x 7-tall pixel font, then every "pixel" is inflated into a SCALE x SCALE
column extruded DEPTH blocks deep, so the whole message becomes a solid 3D wall
of obsidian.

Output format (one block per line):

    x y z minecraft:obsidian

X = left -> right across the message
Y = bottom -> top (font row 0 is the TOP row, so it is flipped)
Z = front -> back (wall thickness)

Tune SCALE / DEPTH / SPACING below to make it as colossal as you like.
"""

# ----------------------------------------------------------------------------
# Tunables
# ----------------------------------------------------------------------------
SCALE = 12      # how many blocks each font pixel becomes on X and Y
DEPTH = 6       # wall thickness on Z (blocks)
SPACING = 1     # gap between letters, measured in font pixels (then * SCALE)
BLOCK = "minecraft:obsidian"

# ----------------------------------------------------------------------------
# 5x7 pixel font. '#' = block, ' '/'.' = empty. Row 0 is the top row.
# ----------------------------------------------------------------------------
FONT = {
    "O": [
        ".###.",
        "#...#",
        "#...#",
        "#...#",
        "#...#",
        "#...#",
        ".###.",
    ],
    "F": [
        "#####",
        "#....",
        "#....",
        "####.",
        "#....",
        "#....",
        "#....",
    ],
    "J": [
        "#####",
        "...#.",
        "...#.",
        "...#.",
        "...#.",
        "#..#.",
        ".##..",
    ],
    "A": [
        ".###.",
        "#...#",
        "#...#",
        "#####",
        "#...#",
        "#...#",
        "#...#",
    ],
}

MESSAGE = "OFJA"


def generate():
    blocks = []
    rows = 7
    cols = 5

    # Cursor in PIXEL space, advancing left -> right.
    pixel_x = 0

    for ch in MESSAGE:
        glyph = FONT[ch]
        for row in range(rows):
            for col in range(cols):
                if glyph[row][col] != "#":
                    continue
                # Flip vertically so font row 0 lands at the top.
                py = (rows - 1 - row)

                # Inflate this single pixel into a SCALE x SCALE x DEPTH cuboid.
                base_x = (pixel_x + col) * SCALE
                base_y = py * SCALE
                for dx in range(SCALE):
                    for dy in range(SCALE):
                        for dz in range(DEPTH):
                            blocks.append(
                                (base_x + dx, base_y + dy, dz)
                            )
        # advance past this glyph plus inter-letter spacing
        pixel_x += cols + SPACING

    return blocks


def main():
    blocks = generate()

    width = max(b[0] for b in blocks) + 1
    height = max(b[1] for b in blocks) + 1
    depth = max(b[2] for b in blocks) + 1

    out_path = "schematics/ofja_obsidian.schem.txt"
    with open(out_path, "w") as f:
        f.write(f"# OFJA obsidian message schematic\n")
        f.write(f"# message={MESSAGE} scale={SCALE} depth={DEPTH} spacing={SPACING}\n")
        f.write(f"# dimensions(x,y,z)={width},{height},{depth} blocks={len(blocks)}\n")
        f.write(f"# format: x y z block_name (relative to origin / pos1)\n")
        for (x, y, z) in blocks:
            f.write(f"{x} {y} {z} {BLOCK}\n")

    print(f"Wrote {out_path}")
    print(f"  message    : {MESSAGE}")
    print(f"  dimensions : {width} x {height} x {depth} (X,Y,Z)")
    print(f"  total blocks: {len(blocks):,}")


if __name__ == "__main__":
    main()
