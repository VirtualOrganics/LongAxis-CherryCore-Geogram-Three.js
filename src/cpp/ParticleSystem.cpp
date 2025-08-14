#include "ParticleSystem.h"

#include <random>
#include <cmath>

ParticleSystem::ParticleSystem()
    : repulsionStrength(1.0f),
      damping(0.98f) {}

void ParticleSystem::initialize(std::size_t numParticles, float defaultRadius, unsigned int seed) {
    particles.clear();
    positions.clear();
    radii.clear();

    particles.resize(numParticles);
    positions.resize(numParticles * 3u);
    radii.resize(numParticles);

    std::mt19937 rng(seed);
    std::uniform_real_distribution<float> uni(0.0f, 1.0f);

    for (std::size_t i = 0; i < numParticles; ++i) {
        Particle p;
        p.x = uni(rng);
        p.y = uni(rng);
        p.z = uni(rng);
        p.vx = 0.0f;
        p.vy = 0.0f;
        p.vz = 0.0f;
        p.radius = defaultRadius;
        p.id = static_cast<int>(i);
        particles[i] = p;

        positions[i * 3u + 0u] = p.x;
        positions[i * 3u + 1u] = p.y;
        positions[i * 3u + 2u] = p.z;
        radii[i] = p.radius;
    }
}

void ParticleSystem::update(float dt) {
    const std::size_t n = particles.size();
    if (n == 0) return;

    // Soft-sphere repulsion: iterate pairs (O(N^2) to start; replace with NNS later)
    for (std::size_t i = 0; i < n; ++i) {
        for (std::size_t j = i + 1; j < n; ++j) {
            // Displacement using minimum image convention
            float dx = particles[j].x - particles[i].x;
            float dy = particles[j].y - particles[i].y;
            float dz = particles[j].z - particles[i].z;
            float mx, my, mz;
            minimumImage(dx, dy, dz, mx, my, mz);

            const float dist2 = mx * mx + my * my + mz * mz;
            if (dist2 <= 0.0f) continue;

            const float sumR = particles[i].radius + particles[j].radius;
            const float sumR2 = sumR * sumR;
            if (dist2 < sumR2) {
                const float dist = std::sqrt(dist2);
                const float overlap = sumR - dist;
                if (overlap > 0.0f) {
                    // Normalized direction from i to j in minimum-image
                    const float nx = mx / dist;
                    const float ny = my / dist;
                    const float nz = mz / dist;
                    // Simple linear spring-like repulsion
                    const float forceMag = repulsionStrength * overlap;
                    const float fx = forceMag * nx;
                    const float fy = forceMag * ny;
                    const float fz = forceMag * nz;

                    // Apply equal and opposite impulses (unit mass)
                    particles[i].vx -= fx * dt;
                    particles[i].vy -= fy * dt;
                    particles[i].vz -= fz * dt;
                    particles[j].vx += fx * dt;
                    particles[j].vy += fy * dt;
                    particles[j].vz += fz * dt;
                }
            }
        }
    }

    // Integrate and apply damping + periodic wrap
    const float dampingFactor = std::pow(damping, dt * 60.0f); // roughly frame-rate independent
    for (std::size_t i = 0; i < n; ++i) {
        particles[i].vx *= dampingFactor;
        particles[i].vy *= dampingFactor;
        particles[i].vz *= dampingFactor;

        particles[i].x = wrap01(particles[i].x + particles[i].vx * dt);
        particles[i].y = wrap01(particles[i].y + particles[i].vy * dt);
        particles[i].z = wrap01(particles[i].z + particles[i].vz * dt);

        positions[i * 3u + 0u] = particles[i].x;
        positions[i * 3u + 1u] = particles[i].y;
        positions[i * 3u + 2u] = particles[i].z;
        radii[i] = particles[i].radius;
    }
}

std::size_t ParticleSystem::getParticleCount() const {
    return particles.size();
}

float* ParticleSystem::getPositionBufferPtr() {
    return positions.empty() ? nullptr : positions.data();
}

float* ParticleSystem::getRadiusBufferPtr() {
    return radii.empty() ? nullptr : radii.data();
}


