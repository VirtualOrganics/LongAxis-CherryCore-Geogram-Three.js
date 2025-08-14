#pragma once

#include <vector>
#include <cstddef>

// ParticleSystem implements the simulation core for Cherry Core (soft-sphere repulsion)
// and will later include Long Axis steering informed by Voronoi cell PCA.
//
// Design goals:
// - Keep state in contiguous arrays for fast interop with JavaScript (via a raw pointer)
// - Start with a simple, robust repulsion step (O(N^2)), replace with spatial index later
// - Operate in a unit periodic domain [0,1)^3 (minimum image convention for distances)
// - Provide a minimal embind-friendly API: init, update, get buffer pointer, count

struct Particle {
    // Position in unit cube [0,1)^3
    float x;
    float y;
    float z;

    // Velocity in world units per second
    float vx;
    float vy;
    float vz;

    // Physical radius for Cherry Core soft contact
    float radius;

    // Identifier (optional for debugging/selection)
    int id;
};

class ParticleSystem {
public:
    ParticleSystem();

    // Initialize N particles with the given defaultRadius, deterministic seed for reproducibility
    // Places particles randomly in the unit cube with zero initial velocity.
    void initialize(std::size_t numParticles, float defaultRadius, unsigned int seed);

    // Advance simulation by dt seconds.
    // Applies: soft-sphere repulsion (Cherry Core), simple damping.
    // Periodic boundary conditions are enforced after integration.
    void update(float dt);

    // Number of particles
    std::size_t getParticleCount() const;

    // Raw pointer to tightly packed float array of positions (x,y,z for each particle).
    // Memory layout: [x0,y0,z0, x1,y1,z1, ...]
    float* getPositionBufferPtr();

    // Raw pointer to radii array (float per particle)
    float* getRadiusBufferPtr();

private:
    // Helper to wrap a coordinate into [0,1)
    static inline float wrap01(float v) {
        // Use fmod-like behavior without calling std::fmod for speed and WASM size.
        if (v >= 1.0f) {
            v -= static_cast<int>(v);
            if (v >= 1.0f) v -= 1.0f;
        } else if (v < 0.0f) {
            v -= static_cast<int>(v);
            if (v < 0.0f) v += 1.0f;
        }
        return v;
    }

    // Compute minimum image displacement in periodic unit cube
    static inline void minimumImage(float dx, float dy, float dz, float& outDx, float& outDy, float& outDz) {
        // Shift into [-0.5, 0.5) range for each component
        outDx = dx - std::round(dx);
        outDy = dy - std::round(dy);
        outDz = dz - std::round(dz);
    }

    // Simulation parameters (tuned later for aesthetics/performance)
    float repulsionStrength;   // Scales the soft contact force magnitude
    float damping;             // Simple velocity damping per second (e.g., 0.98 -> mild)

    std::vector<Particle> particles;
    std::vector<float> positions; // x,y,z packed for interop
    std::vector<float> radii;     // radii packed for interop
};


