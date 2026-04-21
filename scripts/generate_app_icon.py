#!/usr/bin/env python3
"""
Legacy helper that now copies the canonical B4 app icon instead of
regenerating the retired mic-based mark.
"""
from pathlib import Path
import shutil


def main():
    script_dir = Path(__file__).resolve().parent
    source_path = script_dir / 'AppIcon.png'
    output_path = script_dir.parent / 'PorizoApp' / 'PorizoApp' / 'Assets.xcassets' / 'AppIcon.appiconset' / 'AppIcon.png'
    preview_path = script_dir / 'AppIcon_preview.png'

    if not source_path.exists():
        raise FileNotFoundError(f"Canonical icon missing at {source_path}")

    shutil.copy2(source_path, output_path)
    shutil.copy2(source_path, preview_path)
    print(f"Copied canonical app icon: {output_path}")
    print(f"Preview saved: {preview_path}")


if __name__ == '__main__':
    main()
