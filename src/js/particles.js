import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DelaunayComputation } from './DelaunayComputation.js';

// Minimal InstancedMesh frontend for ParticleSystem (Cherry Core repulsion only)

let scene, camera, renderer, controls;
let instancedMesh, dummy;
let facesMesh, facesGeom, facesMat;
let axisLines, axisGeom, axisMat;
let voronoiEdgeLines, voronoiEdgeGeom, voronoiEdgeMat;
let Module, ps;
let lastTime = 0;
let delaunayComputation = null;
let voronoiFrameCounter = 0;
let isPaused = false;

const DEFAULT_RADIUS = 0.015; // Visual + physical radius
const SEED = 42;
const guiState = {
    numParticles: 300,        // Number of particles/seeds
    particleSize: 1.0,        // Particle size multiplier
    particleColor: '#ffffff', // Particle base color
    particleOpacity: 1.0,     // Particle opacity
    steeringStrength: 0.20,
    repulsionStrength: 1.00,
    damping: 0.98,
    throttleFrames: 10,
    minSpeed: 0.00,
    maxSpeed: 2.00,
    colorMode: 'none', // 'none' | 'axis' | 'speed'
    showAxis: true,
    axisOpacity: 1.0,
    showFaces: false,
    faceOpacity: 0.35,
    showVoronoiEdges: true,
    voronoiEdgeOpacity: 0.6,
    voronoiUpdateFrames: 30, // Update Voronoi mesh every N frames
};

function initThree() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
    camera.position.set(1.8, 1.6, 1.8);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0.5, 0.5, 0.5);
    controls.update();

    // Boundary box for unit cube
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const boxEdges = new THREE.EdgesGeometry(boxGeo);
    const boxLine = new THREE.LineSegments(boxEdges, new THREE.LineBasicMaterial({ color: 0x303030 }));
    boxLine.position.set(0.5, 0.5, 0.5);
    scene.add(boxLine);

    // Basic lights (for non-basic materials)
    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(2, 3, 1);
    scene.add(dir);

    // Instanced spheres (will be recreated when particle count changes)
    createParticleVisualization();

    // Voronoi edge lines (dynamic size based on computation)
    voronoiEdgeGeom = new THREE.BufferGeometry();
    voronoiEdgeMat = new THREE.LineBasicMaterial({ 
        color: 0x00aaff, 
        transparent: true, 
        opacity: guiState.voronoiEdgeOpacity 
    });
    voronoiEdgeLines = new THREE.LineSegments(voronoiEdgeGeom, voronoiEdgeMat);
    scene.add(voronoiEdgeLines);

    dummy = new THREE.Object3D();

    window.addEventListener('resize', onResize);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function createParticleVisualization() {
    const numParticles = guiState.numParticles;
    
    // Remove existing meshes if they exist
    if (instancedMesh) {
        scene.remove(instancedMesh);
        instancedMesh.dispose();
    }
    if (axisLines) {
        scene.remove(axisLines);
        axisGeom.dispose();
    }
    
    // Create new instanced spheres with dynamic size
    const radius = DEFAULT_RADIUS * guiState.particleSize;
    const sphereGeo = new THREE.SphereGeometry(radius, 12, 12);
    const sphereMat = new THREE.MeshPhongMaterial({ 
        vertexColors: true, 
        shininess: 20,
        transparent: guiState.particleOpacity < 1.0,
        opacity: guiState.particleOpacity
    });
    instancedMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, numParticles);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    
    // Per-instance colors
    const colors = new Float32Array(numParticles * 3);
    // Initialize to base color from GUI
    const baseColor = new THREE.Color(guiState.particleColor);
    for (let i = 0; i < numParticles; i++) {
        colors[i * 3 + 0] = baseColor.r;
        colors[i * 3 + 1] = baseColor.g;
        colors[i * 3 + 2] = baseColor.b;
    }
    instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    instancedMesh.instanceColor.needsUpdate = true;
    scene.add(instancedMesh);

    // Axis line segments (2 vertices per particle)
    axisGeom = new THREE.BufferGeometry();
    axisGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(numParticles * 2 * 3), 3));
    axisMat = new THREE.LineBasicMaterial({ color: 0xff66ff, transparent: true, opacity: guiState.axisOpacity });
    axisLines = new THREE.LineSegments(axisGeom, axisMat);
    scene.add(axisLines);
}

function getPositionsView(byteOffset, count) {
    // Create a view into the wasm heap without copying
    return new Float32Array(Module.HEAPF32.buffer, byteOffset, count * 3);
}

function reinitializeParticleSystem() {
    if (!ps) return;
    
    // Reinitialize the C++ particle system with new count
    ps.initialize(guiState.numParticles, DEFAULT_RADIUS, SEED);
    
    // Apply current parameters
    ps.setSteeringStrength(guiState.steeringStrength);
    ps.setRepulsionStrength(guiState.repulsionStrength);
    ps.setDamping(guiState.damping);
    ps.setSteeringEveryNFrames(guiState.throttleFrames);
    ps.setMinSpeed(guiState.minSpeed);
    ps.setMaxSpeed(guiState.maxSpeed);
    
    // Recreate visualization
    createParticleVisualization();
    
    // Reset Voronoi computation
    delaunayComputation = null;
    voronoiFrameCounter = 0;
}

function updateParticleAppearance() {
    if (!instancedMesh) return;
    
    // Update material properties
    instancedMesh.material.transparent = guiState.particleOpacity < 1.0;
    instancedMesh.material.opacity = guiState.particleOpacity;
    instancedMesh.material.needsUpdate = true;
    
    // Update base color if color mode is 'none'
    if (guiState.colorMode === 'none') {
        const baseColor = new THREE.Color(guiState.particleColor);
        const colors = instancedMesh.instanceColor.array;
        for (let i = 0; i < guiState.numParticles; i++) {
            colors[i * 3 + 0] = baseColor.r;
            colors[i * 3 + 1] = baseColor.g;
            colors[i * 3 + 2] = baseColor.b;
        }
        instancedMesh.instanceColor.needsUpdate = true;
    }
}

function updateParticleSize() {
    // For size changes, we need to recreate the geometry
    createParticleVisualization();
}

function updateInstances(positions, count, axisColors) {
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3 + 0];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];

        dummy.position.set(x, y, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
        if (axisColors && guiState.colorMode !== 'none') {
            if (guiState.colorMode === 'axis') {
                const ax = axisColors[i * 3 + 0];
                const ay = axisColors[i * 3 + 1];
                const az = axisColors[i * 3 + 2];
                const r = 0.5 * (ax + 1.0);
                const g = 0.5 * (ay + 1.0);
                const b = 0.5 * (az + 1.0);
                instancedMesh.setColorAt(i, new THREE.Color(r, g, b));
            } else {
                const ax = axisColors[i * 3 + 0];
                const ay = axisColors[i * 3 + 1];
                const az = axisColors[i * 3 + 2];
                const mag = Math.min(1.0, Math.sqrt(ax*ax + ay*ay + az*az));
                const r = mag;
                const g = 0.2 + 0.8 * (1.0 - mag);
                const b = 1.0 - mag;
                instancedMesh.setColorAt(i, new THREE.Color(r, g, b));
            }
        } else {
            // Use base color when color mode is 'none'
            const baseColor = new THREE.Color(guiState.particleColor);
            instancedMesh.setColorAt(i, baseColor);
        }
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
}

// Minimum Image Convention for periodic boundaries
function getMinimumImage(p1, p2) {
    let dx = p2[0] - p1[0];
    let dy = p2[1] - p1[1]; 
    let dz = p2[2] - p1[2];

    // Apply periodic boundary conditions
    if (dx > 0.5) dx -= 1.0; else if (dx < -0.5) dx += 1.0;
    if (dy > 0.5) dy -= 1.0; else if (dy < -0.5) dy += 1.0;
    if (dz > 0.5) dz -= 1.0; else if (dz < -0.5) dz += 1.0;

    return [p1[0] + dx, p1[1] + dy, p1[2] + dz];
}

async function updateVoronoiMesh(positions, count) {
    if (!guiState.showVoronoiEdges && !guiState.showFaces) return;
    
    try {
        // Convert positions to the format expected by DelaunayComputation
        const points = [];
        for (let i = 0; i < count; i++) {
            points.push([
                positions[i * 3 + 0],
                positions[i * 3 + 1], 
                positions[i * 3 + 2]
            ]);
        }
        
        // Create new computation or update existing one
        if (!delaunayComputation) {
            delaunayComputation = new DelaunayComputation(points, true); // periodic
        } else {
            // Update points in existing computation
            delaunayComputation.pointsArray = points;
            delaunayComputation.points = new Float64Array(points.flat());
            delaunayComputation.numPoints = points.length;
        }
        
        // Run the Delaunay-Voronoi computation
        await delaunayComputation.compute(Module);
        
        // Update Voronoi edges visualization with MIC
        if (guiState.showVoronoiEdges && delaunayComputation.voronoiEdges.length > 0) {
            const edgePositions = [];
            
            for (const edge of delaunayComputation.voronoiEdges) {
                const p1 = edge.start;
                const p2 = edge.end;
                
                // Apply Minimum Image Convention for periodic boundaries
                if (delaunayComputation.isPeriodic) {
                    const p2_mic = getMinimumImage(p1, p2);
                    edgePositions.push(p1[0], p1[1], p1[2]);
                    edgePositions.push(p2_mic[0], p2_mic[1], p2_mic[2]);
                } else {
                    edgePositions.push(p1[0], p1[1], p1[2]);
                    edgePositions.push(p2[0], p2[1], p2[2]);
                }
            }
            
            voronoiEdgeGeom.setAttribute('position', 
                new THREE.BufferAttribute(new Float32Array(edgePositions), 3));
            voronoiEdgeGeom.setDrawRange(0, delaunayComputation.voronoiEdges.length * 2);
            voronoiEdgeMat.opacity = guiState.voronoiEdgeOpacity;
            voronoiEdgeLines.visible = true;
        } else {
            voronoiEdgeLines.visible = false;
        }
        
    } catch (error) {
        console.warn('Error updating Voronoi mesh:', error);
        voronoiEdgeLines.visible = false;
    }
}

function animate(nowMs) {
    requestAnimationFrame(animate);

    if (!lastTime) lastTime = nowMs;
    const dt = Math.min(0.05, (nowMs - lastTime) / 1000);
    lastTime = nowMs;

    if (ps && !isPaused) {
        ps.update(dt);
        const byteOffset = ps.getPositionBufferByteOffset();
        const n = ps.getParticleCount();
        if (byteOffset && n > 0) {
            const positions = getPositionsView(byteOffset, n);
            let axisColors = null;
            if (ps.getAxisBufferByteOffset) {
                const axOff = ps.getAxisBufferByteOffset();
                if (axOff) axisColors = getPositionsView(axOff, n);
            }
            updateInstances(positions, n, axisColors);

            // Update axis lines using actual segment endpoints from C++
            if (guiState.showAxis && ps.getAxisSegmentBufferByteOffset) {
                const segOff = ps.getAxisSegmentBufferByteOffset();
                if (segOff) {
                    // axisSegments buffer contains 6 floats per particle: start_x,y,z, end_x,y,z
                    const segments = new Float32Array(Module.HEAPF32.buffer, segOff, n * 6);
                    const arr = axisGeom.attributes.position.array;
                    let p = 0;
                    for (let i = 0; i < n; i++) {
                        // Start point
                        arr[p++] = segments[i*6+0]; // start_x
                        arr[p++] = segments[i*6+1]; // start_y
                        arr[p++] = segments[i*6+2]; // start_z
                        // End point
                        arr[p++] = segments[i*6+3]; // end_x
                        arr[p++] = segments[i*6+4]; // end_y
                        arr[p++] = segments[i*6+5]; // end_z
                    }
                    axisGeom.setDrawRange(0, n * 2);
                    axisGeom.attributes.position.needsUpdate = true;
                    axisLines.visible = true;
                    axisMat.opacity = guiState.axisOpacity;
                } else {
                    axisLines.visible = false;
                }
            } else if (axisLines) {
                axisLines.visible = false;
            }

            // Update Voronoi mesh using DelaunayComputation (throttled)
            voronoiFrameCounter++;
            if (voronoiFrameCounter >= guiState.voronoiUpdateFrames) {
                voronoiFrameCounter = 0;
                updateVoronoiMesh(positions, n);
            }
        }

        // TODO: Implement proper Voronoi face rendering using Geogram-Three.js method
        // The old face triangulation method has been removed for performance
        if (facesMesh) {
            facesMesh.visible = false;
        }
    }

    controls.update();
    renderer.render(scene, camera);
}

async function init() {
    initThree();

    Module = await window.PeriodicDelaunayModule();
    ps = new Module.ParticleSystem();
    ps.initialize(guiState.numParticles, DEFAULT_RADIUS, SEED);

    // Apply initial params
    ps.setSteeringStrength(guiState.steeringStrength);
    ps.setRepulsionStrength(guiState.repulsionStrength);
    ps.setDamping(guiState.damping);
    ps.setSteeringEveryNFrames(guiState.throttleFrames);
    ps.setMinSpeed(guiState.minSpeed);
    ps.setMaxSpeed(guiState.maxSpeed);

    // Setup GUI
    if (window.lilgui) {
        const gui = new window.lilgui({ title: 'Cherry Core Controls' });
        
        // Pause/Play button
        const pauseState = { paused: false };
        gui.add(pauseState, 'paused').name('Pause').onChange((paused) => {
            isPaused = paused;
        });
        
        // Particle count control
        gui.add(guiState, 'numParticles', 50, 10000, 1).name('Seeds/Particles').onChange(() => {
            reinitializeParticleSystem();
        });
        
        // Particle appearance controls
        const particleFolder = gui.addFolder('Particle Appearance');
        particleFolder.add(guiState, 'particleSize', 0.1, 5.0, 0.1).name('Size').onChange(() => {
            updateParticleSize();
        });
        particleFolder.addColor(guiState, 'particleColor').name('Color').onChange(() => {
            updateParticleAppearance();
        });
        particleFolder.add(guiState, 'particleOpacity', 0.1, 1.0, 0.05).name('Opacity').onChange(() => {
            updateParticleAppearance();
        });
        
        gui.add(guiState, 'steeringStrength', 0.0, 2.0, 0.01).onChange((v) => ps.setSteeringStrength(v));
        gui.add(guiState, 'repulsionStrength', 0.0, 5.0, 0.01).onChange((v) => ps.setRepulsionStrength(v));
        gui.add(guiState, 'damping', 0.90, 1.00, 0.0005).onChange((v) => ps.setDamping(v));
        gui.add(guiState, 'throttleFrames', 1, 60, 1).onChange((v) => ps.setSteeringEveryNFrames(v));
        gui.add(guiState, 'minSpeed', 0.0, 2.0, 0.01).onChange((v) => ps.setMinSpeed(v));
        gui.add(guiState, 'maxSpeed', 0.5, 5.0, 0.01).onChange((v) => ps.setMaxSpeed(v));
        gui.add(guiState, 'colorMode', ['none', 'axis', 'speed']);
        const axisFolder = gui.addFolder('Axis');
        axisFolder.add(guiState, 'showAxis');
        axisFolder.add(guiState, 'axisOpacity', 0.1, 1.0, 0.05);
        const faceFolder = gui.addFolder('Faces');
        faceFolder.add(guiState, 'showFaces');
        faceFolder.add(guiState, 'faceOpacity', 0.05, 0.8, 0.05);
        const voronoiFolder = gui.addFolder('Voronoi');
        voronoiFolder.add(guiState, 'showVoronoiEdges');
        voronoiFolder.add(guiState, 'voronoiEdgeOpacity', 0.1, 1.0, 0.05);
        voronoiFolder.add(guiState, 'voronoiUpdateFrames', 5, 120, 1);
    }

    requestAnimationFrame(animate);
}

init();


