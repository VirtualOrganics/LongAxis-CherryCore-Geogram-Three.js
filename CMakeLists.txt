cmake_minimum_required(VERSION 3.16)

project(LongAxisCherryCoreGeogramThreeJS LANGUAGES CXX)

# C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Output directory to match existing structure
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR}/dist)

# Source files
set(SRC_DIR ${CMAKE_SOURCE_DIR}/src/cpp)
set(SRC_FILES
    ${SRC_DIR}/periodic_delaunay.cpp
    ${SRC_DIR}/Delaunay_psm.cpp
)

# Try to locate Eigen first; if not found, fetch it
set(EIGEN3_MIN_VERSION 3.3)
find_package(Eigen3 ${EIGEN3_MIN_VERSION} QUIET NO_MODULE)

if(NOT Eigen3_FOUND)
    include(FetchContent)
    FetchContent_Declare(
        eigen
        GIT_REPOSITORY https://gitlab.com/libeigen/eigen.git
        GIT_TAG 3.4.0
    )
    FetchContent_MakeAvailable(eigen)
    # Fallback include directory for Eigen headers
    if(NOT TARGET Eigen3::Eigen)
        add_library(Eigen3::Eigen INTERFACE IMPORTED)
        target_include_directories(Eigen3::Eigen INTERFACE ${eigen_SOURCE_DIR})
    endif()
endif()

add_executable(periodic_delaunay ${SRC_FILES})

target_include_directories(periodic_delaunay PRIVATE ${SRC_DIR})
target_link_libraries(periodic_delaunay PRIVATE Eigen3::Eigen)

# Emscripten-specific flags to mirror existing build.sh behavior
if(CMAKE_SYSTEM_NAME STREQUAL "Emscripten")
    # Enable embind and growth, modularize the output, and name the module
    set(EM_FLAGS
        "-sALLOW_MEMORY_GROWTH=1"
        "-sMODULARIZE=1"
        "-sEXPORT_NAME=\"PeriodicDelaunayModule\""
        "-sASSERTIONS=1"
        "--bind"
    )
    target_compile_options(periodic_delaunay PRIVATE -O2)
    target_link_options(periodic_delaunay PRIVATE ${EM_FLAGS} -O2)

    # Ensure output goes to dist/ and is named like the existing JS glue
    set_target_properties(periodic_delaunay PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR}/dist
        OUTPUT_NAME "periodic_delaunay"
    )
endif()

# Notes:
# - Build with Emscripten using:
#     emcmake cmake -S . -B build
#     cmake --build build -j
# - Outputs: dist/periodic_delaunay.js and dist/periodic_delaunay.wasm


