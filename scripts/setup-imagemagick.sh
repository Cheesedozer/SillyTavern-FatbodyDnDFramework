#!/usr/bin/env bash
# Install ImageMagick 7 for PixelLab Pip.
#
# Ubuntu 24.04 ships only ImageMagick 6, which has no `magick` binary — Pip
# calls `magick -delay`, `magick identify`, and `magick compare`. This installs
# the upstream v7 static build instead, so no apt package is involved.
#
# The AppImage is extracted rather than run directly: the container has no
# FUSE, and an unextracted AppImage prints a fusermount error to stderr on
# every invocation.
set -euo pipefail

PREFIX=/opt/imagemagick7
URL=https://download.imagemagick.org/archive/binaries/magick

if [ -x /usr/local/bin/magick ] && /usr/local/bin/magick --version 2>/dev/null | grep -q 'ImageMagick 7'; then
  echo "ImageMagick 7 already installed: $(/usr/local/bin/magick --version | head -1)"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ImageMagick 7 …"
curl -fsSL --retry 3 --retry-delay 2 -o "$tmp/magick" "$URL"
chmod +x "$tmp/magick"

echo "Extracting …"
( cd "$tmp" && ./magick --appimage-extract >/dev/null )

rm -rf "$PREFIX"
mv "$tmp/squashfs-root" "$PREFIX"
ln -sfn "$PREFIX/AppRun" /usr/local/bin/magick

# Legacy names point at the real binaries; AppRun always dispatches to `magick`
# regardless of argv[0], so it cannot stand in for them.
for tool in convert identify compare composite mogrify montage; do
  [ -x "$PREFIX/usr/bin/$tool" ] && ln -sfn "$PREFIX/usr/bin/$tool" "/usr/local/bin/$tool"
done

echo "Installed: $(magick --version | head -1)"
