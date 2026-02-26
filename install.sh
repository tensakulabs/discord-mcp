#!/usr/bin/env bash
set -euo pipefail

REPO="tensakulabs/discord-mcp"
BIN_NAME="discord-mcp"

# Prefer ~/bin (no sudo), fall back to /usr/local/bin
if [ -d "$HOME/bin" ] || mkdir -p "$HOME/bin" 2>/dev/null; then
  INSTALL_DIR="$HOME/bin"
else
  INSTALL_DIR="/usr/local/bin"
fi

# --- Detect platform ---
OS="$(uname -s)"
ARCH="$(uname -m)"

case "${OS}-${ARCH}" in
  Darwin-arm64)  PLATFORM="mac-arm64" ;;
  Darwin-x86_64) PLATFORM="mac-x64" ;;
  Linux-x86_64)  PLATFORM="linux-x64" ;;
  Linux-aarch64) PLATFORM="linux-arm64" ;;
  *)
    echo "Unsupported platform: ${OS}-${ARCH}" >&2
    echo "Try: npx discord-mcp setup" >&2
    exit 1
    ;;
esac

# --- Get latest release ---
LATEST_URL="https://api.github.com/repos/${REPO}/releases/latest"
RELEASE_TAG=$(curl -fsSL "$LATEST_URL" | grep '"tag_name"' | sed 's/.*"tag_name": *"\(.*\)".*/\1/')

if [ -z "$RELEASE_TAG" ]; then
  echo "Could not fetch latest release. Check https://github.com/${REPO}/releases" >&2
  exit 1
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${RELEASE_TAG}/discord-mcp-${PLATFORM}"

echo "Installing discord-mcp ${RELEASE_TAG} for ${PLATFORM}..."

# --- Download ---
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMP_FILE"
chmod +x "$TMP_FILE"

# --- Install ---
mv "$TMP_FILE" "${INSTALL_DIR}/${BIN_NAME}"

# Add ~/bin to PATH hint if needed
if [[ ":$PATH:" != *":$HOME/bin:"* ]]; then
  echo ""
  echo "⚠ Add ~/bin to your PATH if discord-mcp isn't found:"
  echo "  echo 'export PATH=\"\$HOME/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
fi

echo ""
echo "✓ discord-mcp installed to ${INSTALL_DIR}/${BIN_NAME}"
echo ""
echo "Next step: run setup to connect your Discord account"
echo ""
echo "  discord-mcp setup"
echo ""
