#!/bin/bash

# Build script for Geogram-Three.js
# Requires Emscripten SDK to be installed and activated

echo "Building Geogram-Three.js..."

# Check if emcc is available
if ! command -v em++ &> /dev/null; then
    echo "Error: Emscripten not found. Please install and activate the Emscripten SDK."
    echo "See: https://emscripten.org/docs/getting_started/downloads.html"
    exit 1
fi

# Navigate to source directory
cd src/cpp

# Compile with Emscripten
em++ --bind -o ../../dist/periodic_delaunay.js \
    periodic_delaunay.cpp Delaunay_psm.cpp ParticleSystem.cpp \
    -I. -I../../third_party/eigen-3.4.0 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s EXPORTED_RUNTIME_METHODS='["HEAPF32"]' \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="PeriodicDelaunayModule" \
    -s ASSERTIONS=1 \
    -std=c++17 \
    -O2

# Check if compilation was successful
if [ $? -eq 0 ]; then
    echo "Build successful! Output files:"
    echo "  - dist/periodic_delaunay.js"
    echo "  - dist/periodic_delaunay.wasm"
else
    echo "Build failed!"
    exit 1
fi 