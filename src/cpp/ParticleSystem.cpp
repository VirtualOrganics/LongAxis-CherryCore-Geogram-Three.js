#include "ParticleSystem.h"

#include <random>
#include <cmath>
#include <limits>

// Geogram (PSM version vendored in this repo)
#include "Delaunay_psm.h"

// Eigen for PCA
#include <Eigen/Dense>

// Compute tetrahedron circumcenter using linear system approach.
// Falls back to simple average if the system is ill-conditioned.
static inline Eigen::Vector3f computeTetraCircumcenter(
    const Eigen::Vector3f& a,
    const Eigen::Vector3f& b,
    const Eigen::Vector3f& c,
    const Eigen::Vector3f& d
) {
    const Eigen::Vector3f u = b - a;
    const Eigen::Vector3f v = c - a;
    const Eigen::Vector3f w = d - a;

    Eigen::Matrix3f A;
    A.row(0) = u.transpose();
    A.row(1) = v.transpose();
    A.row(2) = w.transpose();

    Eigen::Vector3f rhs;
    rhs[0] = 0.5f * (b.squaredNorm() - a.squaredNorm());
    rhs[1] = 0.5f * (c.squaredNorm() - a.squaredNorm());
    rhs[2] = 0.5f * (d.squaredNorm() - a.squaredNorm());

    Eigen::ColPivHouseholderQR<Eigen::Matrix3f> solver(A);
    if (solver.isInvertible()) {
        return solver.solve(rhs);
    }
    // Fallback: average (not geometrically exact, but stable)
    return (a + b + c + d) * 0.25f;
}

ParticleSystem::ParticleSystem()
    : repulsionStrength(1.0f),
      damping(0.98f),
      steeringStrength(0.20f),
      steeringEveryNFrames(10),
      frameCounter(0) {}

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

    // Apply Long-Axis steering at a throttled cadence (expensive step)
    if (steeringStrength > 0.0f && steeringEveryNFrames > 0) {
        if ((frameCounter % steeringEveryNFrames) == 0) {
            applyVoronoiSteering(dt);
        }
        frameCounter++;
    }

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

void ParticleSystem::applyVoronoiSteering(float dt) {
    const std::size_t n = particles.size();
    if (n < 4) return; // Need tetrahedra

    // Build point array for Geogram (double precision)
    std::vector<double> verts;
    verts.resize(n * 3);
    for (std::size_t i = 0; i < n; ++i) {
        verts[i * 3 + 0] = static_cast<double>(particles[i].x);
        verts[i * 3 + 1] = static_cast<double>(particles[i].y);
        verts[i * 3 + 2] = static_cast<double>(particles[i].z);
    }

    // Ensure Geogram is initialized (idempotent)
    static bool g_geogram_initialized_ps = false;
    if (!g_geogram_initialized_ps) {
        GEO::initialize();
        g_geogram_initialized_ps = true;
    }

    // Construct periodic Delaunay
    std::unique_ptr<GEO::PeriodicDelaunay3d> delaunay;
    delaunay = std::make_unique<GEO::PeriodicDelaunay3d>(GEO::vec3(1.0, 1.0, 1.0));
    delaunay->set_stores_cicl(false);
    delaunay->set_vertices(static_cast<int>(n), verts.data());
    try {
        delaunay->compute();
    } catch (...) {
        return; // Fail silently this frame
    }

    const int numTets = delaunay->nb_cells();
    if (numTets <= 0) return;

    // For each particle, store circumcenters of incident tetrahedra (unwrapped around the particle)
    std::vector<std::vector<Eigen::Vector3f>> cellCenters(n);

    auto toVec3 = [](float x, float y, float z) -> GEO::vec3 { return GEO::vec3(double(x), double(y), double(z)); };

    for (int t = 0; t < numTets; ++t) {
        int vIdx[4];
        for (int k = 0; k < 4; ++k) {
            vIdx[k] = delaunay->cell_vertex(t, k);
        }

        // Map to base indices in [0, n)
        int base[4];
        for (int k = 0; k < 4; ++k) {
            int vi = vIdx[k];
            if (vi < 0) { base[k] = 0; } else { base[k] = vi % int(n); }
        }

        // Base positions
        Eigen::Vector3f p[4];
        for (int k = 0; k < 4; ++k) {
            p[k].x() = particles[base[k]].x;
            p[k].y() = particles[base[k]].y;
            p[k].z() = particles[base[k]].z;
        }

        // For each vertex in the tetrahedron, compute circumcenter unwrapped around that vertex's particle
        for (int local = 0; local < 4; ++local) {
            const int particleIndex = base[local];
            const Eigen::Vector3f pi(particleIndex >= 0 ? particles[particleIndex].x : 0.0f,
                                     particleIndex >= 0 ? particles[particleIndex].y : 0.0f,
                                     particleIndex >= 0 ? particles[particleIndex].z : 0.0f);

            // Unwrap other vertices around pi using minimum-image convention
            Eigen::Vector3f q[4];
            for (int m = 0; m < 4; ++m) {
                Eigen::Vector3f d = p[m] - pi;
                d.x() -= std::round(d.x());
                d.y() -= std::round(d.y());
                d.z() -= std::round(d.z());
                q[m] = pi + d;
            }

            // Compute circumcenter (Eigen-based)
            Eigen::Vector3f center = computeTetraCircumcenter(q[0], q[1], q[2], q[3]);
            cellCenters[particleIndex].push_back(center);
        }
    }

    // Apply PCA per particle to get the principal axis and steer velocity
    for (std::size_t i = 0; i < n; ++i) {
        const auto& centers = cellCenters[i];
        if (centers.size() < 4) continue; // Need at least a few samples

        // Compute mean
        Eigen::Vector3f mean(0.0f, 0.0f, 0.0f);
        for (const auto& c : centers) mean += c;
        mean /= float(centers.size());

        // Covariance
        Eigen::Matrix3f cov = Eigen::Matrix3f::Zero();
        for (const auto& c : centers) {
            Eigen::Vector3f d = c - mean;
            cov += d * d.transpose();
        }
        cov /= std::max(1, int(centers.size() - 1));

        Eigen::SelfAdjointEigenSolver<Eigen::Matrix3f> solver(cov);
        if (solver.info() != Eigen::Success) continue;
        Eigen::Vector3f eigenvalues = solver.eigenvalues();
        Eigen::Matrix3f eigenvectors = solver.eigenvectors();

        // Index of max eigenvalue
        int idx = 0;
        if (eigenvalues[1] > eigenvalues[idx]) idx = 1;
        if (eigenvalues[2] > eigenvalues[idx]) idx = 2;
        Eigen::Vector3f axis = eigenvectors.col(idx).normalized();

        // Disambiguate direction by aligning with current velocity
        Eigen::Vector3f vel(particles[i].vx, particles[i].vy, particles[i].vz);
        if (vel.dot(axis) < 0.0f) axis = -axis;

        // Apply steering as acceleration
        particles[i].vx += steeringStrength * axis.x() * dt;
        particles[i].vy += steeringStrength * axis.y() * dt;
        particles[i].vz += steeringStrength * axis.z() * dt;
    }
}

