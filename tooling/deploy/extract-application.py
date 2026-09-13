"""Extract a verified GitHub artifact into a new private directory, never links."""
import os
from pathlib import Path
import stat
import sys
import zipfile


def extract(archive, directory):
    root = Path(directory)
    if not root.is_dir() or root.is_symlink() or any(root.iterdir()):
        raise ValueError("Expected an empty owned directory")
    with zipfile.ZipFile(archive) as package:
        files = package.infolist()
        if len(files) > 20001:
            raise ValueError("Too many application files")
        total = 0
        names = set()
        for entry in files:
            name = entry.filename
            mode = entry.external_attr >> 16
            if (entry.is_dir() or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)) or
                    name.lower() in names or "\\" in name or
                    any(ord(c) < 32 for c in name) or
                    any(p in ("", ".", "..") for p in name.split("/")) or
                    not (name == "package.json" or name.startswith(("public/", "private/")))):
                raise ValueError("Unsafe application file")
            names.add(name.lower())
            total += entry.file_size
            if entry.file_size < 0 or total > 512 * 1024 * 1024:
                raise ValueError("Application size budget exceeded")
        if "package.json" not in names:
            raise ValueError("Missing application manifest")
        for entry in files:
            target = root.joinpath(*entry.filename.split("/"))
            target.parent.mkdir(parents=True, exist_ok=True)
            with package.open(entry) as source, target.open("xb") as destination:
                os.chmod(target, 0o600)
                remaining = entry.file_size
                while remaining:
                    chunk = source.read(min(remaining, 1024 * 1024))
                    if not chunk:
                        raise ValueError("Truncated application file")
                    destination.write(chunk)
                    remaining -= len(chunk)
                if source.read(1):
                    raise ValueError("Application file exceeds declared size")


if __name__ == "__main__":
    extract(sys.argv[1], sys.argv[2])
