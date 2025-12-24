#!/usr/bin/env python3
"""
Generate yellow PNG icons for CrawlGoogle extension
Author: ofjaaah
"""

import struct
import zlib
import os

def create_icon(size, filename):
    """Create a yellow themed icon"""
    width = height = size

    # Colors
    yellow = (255, 193, 7)      # Main yellow
    dark_yellow = (255, 160, 0)  # Darker yellow
    dark_bg = (30, 30, 46)       # Dark background

    pixels = []

    for y in range(height):
        row = []
        for x in range(width):
            cx, cy = width // 2, height // 2
            dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5

            # Circle radius
            outer_r = size * 0.45
            inner_r = size * 0.35

            if dist <= outer_r:
                if dist >= inner_r:
                    # Yellow ring
                    row.extend(yellow)
                else:
                    # Inside - draw magnifying glass lines
                    rel_y = y - (cy - size * 0.15)
                    if 0 <= rel_y < size * 0.35:
                        line_spacing = size * 0.1
                        if rel_y % line_spacing < size * 0.04:
                            row.extend(dark_yellow)
                        else:
                            row.extend(dark_bg)
                    else:
                        row.extend(dark_bg)
            else:
                # Handle
                handle_start_x = cx + size * 0.28
                handle_start_y = cy + size * 0.28
                handle_dist = ((x - handle_start_x) ** 2 + (y - handle_start_y) ** 2) ** 0.5

                # Check if on handle line
                if x > cx + size * 0.2 and y > cy + size * 0.2:
                    line_dist = abs((y - cy) - (x - cx))
                    if line_dist < size * 0.12 and x < cx + size * 0.45 and y < cy + size * 0.45:
                        row.extend(yellow)
                    else:
                        row.extend(dark_bg)
                else:
                    row.extend(dark_bg)

        pixels.append(bytes([0] + row))

    # Create PNG
    def png_chunk(chunk_type, data):
        chunk = chunk_type + data
        return struct.pack('>I', len(data)) + chunk + struct.pack('>I', zlib.crc32(chunk) & 0xffffffff)

    signature = b'\x89PNG\r\n\x1a\n'
    ihdr = png_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    idat = png_chunk(b'IDAT', zlib.compress(b''.join(pixels), 9))
    iend = png_chunk(b'IEND', b'')

    with open(filename, 'wb') as f:
        f.write(signature + ihdr + idat + iend)

    print(f"Created: {filename}")


if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))

    for size in [16, 48, 128]:
        create_icon(size, os.path.join(script_dir, f'icon{size}.png'))

    print("\nYellow icons created!")
