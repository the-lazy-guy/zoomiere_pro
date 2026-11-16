"""Builds dist/ZoomPro-v<version>.zip (Windows + macOS) from this repo.

Usage:  python tools/build-release.py
- .bat files get CRLF line endings, .command files get LF and the executable bit.
"""
import os, re, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
manifest = open(os.path.join(ROOT, "extension", "CSXS", "manifest.xml"), encoding="utf-8").read()
version = re.search(r'ExtensionBundleVersion="([^"]+)"', manifest).group(1)
out_dir = os.path.join(ROOT, "dist")
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, "ZoomPro-v%s.zip" % version)

files = ["Install-Windows.bat", "Uninstall-Windows.bat", "Install-Mac.command", "Uninstall-Mac.command", "README.md", "LICENSE"]
for base, _, names in os.walk(os.path.join(ROOT, "extension")):
    for n in names:
        files.append(os.path.relpath(os.path.join(base, n), ROOT))

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for rel in sorted(files):
        data = open(os.path.join(ROOT, rel), "rb").read()
        if rel.endswith(".bat"):
            data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
        if rel.endswith(".command"):
            data = data.replace(b"\r\n", b"\n")
        info = zipfile.ZipInfo("ZoomPro/" + rel.replace(os.sep, "/"), date_time=(2026, 1, 1, 0, 0, 0))
        info.create_system = 3  # unix, so macOS keeps the permissions
        info.external_attr = ((0o100755 if rel.endswith(".command") else 0o100644) << 16)
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, data)

print("built", out, "(%d files)" % len(files))
