import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Minimal InstancedMesh frontend for ParticleSystem (Cherry Core repulsion only)

let scene, camera, renderer, controls;
let instancedMesh, dummy;
let Module, ps;
let lastTime = 0;

const NUM_PARTICLES = 300;    // Adjust freely
const DEFAULT_RADIUS = 0.015; // Visual + physical radius
const SEED = 42;
const guiState = {
    steeringStrength: 0.20,
    repulsionStrength: 1.00,
    damping: 0.98,
    throttleFrames: 10,
};

function initThree() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
    camera.position.set(1.8, 1.6, 1.8);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
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

    // Instanced spheres
    const sphereGeo = new THREE.SphereGeometry(DEFAULT_RADIUS, 12, 12);
    const sphereMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    instancedMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, NUM_PARTICLES);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Per-instance colors
    const colors = new Float32Array(NUM_PARTICLES * 3);
    instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    instancedMesh.instanceColor.needsUpdate = true;
    scene.add(instancedMesh);

    dummy = new THREE.Object3D();

    window.addEventListener('resize', onResize);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function getPositionsView(byteOffset, count) {
    // Create a view into the wasm heap without copying
    return new Float32Array(Module.HEAPF32.buffer, byteOffset, count * 3);
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
        if (axisColors) {
            // Map axis [-1,1] to RGB [0,1] with simple transform
            const ax = axisColors[i * 3 + 0];
            const ay = axisColors[i * 3 + 1];
            const az = axisColors[i * 3 + 2];
            const r = 0.5 * (ax + 1.0);
            const g = 0.5 * (ay + 1.0);
            const b = 0.5 * (az + 1.0);
            instancedMesh.instanceColor.setXYZ(i, r, g, b);
        }
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (axisColors) instancedMesh.instanceColor.needsUpdate = true;
}

function animate(nowMs) {
    requestAnimationFrame(animate);

    if (!lastTime) lastTime = nowMs;
    const dt = Math.min(0.05, (nowMs - lastTime) / 1000);
    lastTime = nowMs;

    if (ps) {
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
        }
    }

    controls.update();
    renderer.render(scene, camera);
}

async function init() {
    initThree();

    Module = await window.PeriodicDelaunayModule();
    ps = new Module.ParticleSystem();
    ps.initialize(NUM_PARTICLES, DEFAULT_RADIUS, SEED);

    // Apply initial params
    ps.setSteeringStrength(guiState.steeringStrength);
    ps.setRepulsionStrength(guiState.repulsionStrength);
    ps.setDamping(guiState.damping);
    ps.setSteeringEveryNFrames(guiState.throttleFrames);

    // Setup GUI
    if (window.lilgui) {
        const gui = new window.lilgui({ title: 'Cherry Core Controls' });
        gui.add(guiState, 'steeringStrength', 0.0, 2.0, 0.01).onChange((v) => ps.setSteeringStrength(v));
        gui.add(guiState, 'repulsionStrength', 0.0, 5.0, 0.01).onChange((v) => ps.setRepulsionStrength(v));
        gui.add(guiState, 'damping', 0.90, 1.00, 0.0005).onChange((v) => ps.setDamping(v));
        gui.add(guiState, 'throttleFrames', 1, 60, 1).onChange((v) => ps.setSteeringEveryNFrames(v));
    }

    requestAnimationFrame(animate);
}

init();


