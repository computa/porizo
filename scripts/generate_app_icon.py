#!/usr/bin/env python3
"""
Generate Porizo app icon: white microphone inside rose circle on light background.
"""
from PIL import Image, ImageDraw

def create_app_icon(size=1024):
    """Create a 1024x1024 app icon with rose circle and white microphone."""
    # Colors
    rose_color = (244, 63, 94)  # #f43f5e from DesignTokens.swift
    white = (255, 255, 255)
    background = (255, 255, 255)  # White background

    # Create image with white background
    img = Image.new('RGB', (size, size), background)
    draw = ImageDraw.Draw(img)

    # Circle dimensions - centered with padding
    circle_padding = size * 0.08  # 8% padding from edges
    circle_diameter = size - (circle_padding * 2)
    circle_left = circle_padding
    circle_top = circle_padding
    circle_right = size - circle_padding
    circle_bottom = size - circle_padding

    # Draw rose circle
    draw.ellipse(
        [circle_left, circle_top, circle_right, circle_bottom],
        fill=rose_color
    )

    # Microphone dimensions (relative to circle, not full icon)
    center_x = size // 2
    center_y = size // 2

    # Scale mic to fit nicely in circle
    mic_scale = 0.55  # Mic takes up 55% of circle width

    # Mic body: tall rounded rectangle
    mic_width = circle_diameter * mic_scale * 0.5
    mic_height = circle_diameter * mic_scale * 0.75
    mic_top = center_y - mic_height * 0.45
    mic_left = center_x - mic_width // 2
    mic_right = center_x + mic_width // 2
    mic_bottom = mic_top + mic_height

    # Draw mic body with rounded top and bottom
    corner_radius = mic_width // 2

    draw.rounded_rectangle(
        [mic_left, mic_top, mic_right, mic_bottom],
        radius=corner_radius,
        fill=white
    )

    # Mic holder arc (curved part around the mic)
    arc_padding = circle_diameter * 0.05
    arc_left = mic_left - arc_padding
    arc_right = mic_right + arc_padding
    arc_top = mic_bottom - circle_diameter * 0.12
    arc_bottom = mic_bottom + circle_diameter * 0.06

    # Draw the arc
    line_width = int(circle_diameter * 0.035)
    draw.arc(
        [arc_left, arc_top, arc_right, arc_bottom + circle_diameter * 0.04],
        start=0,
        end=180,
        fill=white,
        width=line_width
    )

    # Stand (vertical line from arc bottom to base)
    stand_top = arc_bottom + circle_diameter * 0.015
    stand_bottom = arc_bottom + circle_diameter * 0.09
    draw.line(
        [(center_x, stand_top), (center_x, stand_bottom)],
        fill=white,
        width=line_width
    )

    # Base (horizontal line at bottom)
    base_width = circle_diameter * 0.14
    draw.line(
        [(center_x - base_width // 2, stand_bottom),
         (center_x + base_width // 2, stand_bottom)],
        fill=white,
        width=line_width
    )

    # Add small rounded caps to base ends
    cap_radius = line_width // 2
    draw.ellipse(
        [center_x - base_width // 2 - cap_radius, stand_bottom - cap_radius,
         center_x - base_width // 2 + cap_radius, stand_bottom + cap_radius],
        fill=white
    )
    draw.ellipse(
        [center_x + base_width // 2 - cap_radius, stand_bottom - cap_radius,
         center_x + base_width // 2 + cap_radius, stand_bottom + cap_radius],
        fill=white
    )

    return img


def main():
    import os

    # Output path
    output_dir = os.path.join(
        os.path.dirname(__file__),
        '../PorizoApp/PorizoApp/Assets.xcassets/AppIcon.appiconset'
    )
    output_path = os.path.join(output_dir, 'AppIcon.png')

    # Generate and save
    icon = create_app_icon(1024)
    icon.save(output_path, 'PNG')
    print(f"Generated app icon: {output_path}")

    # Also save to a visible location for verification
    preview_path = os.path.join(os.path.dirname(__file__), 'AppIcon_preview.png')
    icon.save(preview_path, 'PNG')
    print(f"Preview saved: {preview_path}")


if __name__ == '__main__':
    main()
