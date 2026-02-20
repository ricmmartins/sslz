#!/bin/bash
# ==============================================================================
# Generate architecture diagrams from Mermaid markdown
# Outputs PNG and SVG files for use in docs and presentations
# Requires: npx (Node.js) OR docker
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"
mkdir -p "$OUTPUT_DIR"

# Mermaid config for consistent styling
MMDC_CONFIG='{ "theme": "default", "themeVariables": { "fontSize": "14px" } }'

generate_with_npx() {
  echo "Generating diagrams with mermaid-cli (npx)..."
  for fmt in png svg; do
    npx -y @mermaid-js/mermaid-cli mmdc \
      -i "$SCRIPT_DIR/architecture.md" \
      -o "$OUTPUT_DIR/architecture.${fmt}" \
      -b transparent \
      -C <(echo "$MMDC_CONFIG") \
      2>/dev/null
    echo "  Created: output/architecture.${fmt}"
  done
}

generate_with_docker() {
  echo "Generating diagrams with mermaid-cli (docker)..."
  for fmt in png svg; do
    docker run --rm \
      -v "$SCRIPT_DIR:/data" \
      minlag/mermaid-cli \
      -i /data/architecture.md \
      -o /data/output/architecture.${fmt} \
      -b transparent \
      2>/dev/null
    echo "  Created: output/architecture.${fmt}"
  done
}

if command -v npx &>/dev/null; then
  generate_with_npx
elif command -v docker &>/dev/null; then
  generate_with_docker
else
  echo "Error: Need either npx (Node.js) or docker to generate diagrams."
  echo "  Install Node.js: https://nodejs.org/"
  echo "  Or render natively on GitHub by viewing architecture.md"
  exit 1
fi

echo "Done! Diagrams saved to: ${OUTPUT_DIR}/"
