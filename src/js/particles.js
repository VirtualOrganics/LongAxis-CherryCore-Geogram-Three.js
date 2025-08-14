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
    const sphereMat = new THREE.MeshNormalMaterial();
    instancedMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, NUM_PARTICLES);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(instancedMesh);

    dummy = new THREE.Object3D();

    window.addEventListener('resize', onResize);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function getPositionsView(ptr, count) {
    // ptr is a byte offset; use HEAPF32.subarray with element offset
    const floatOffset = ptr >>> 2; // divide by 4
    return Module.HEAPF32.subarray(floatOffset, floatOffset + count * 3);
}

function updateInstances(positions, count) {
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3 + 0];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];

        dummy.position.set(x, y, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
}

function animate(nowMs) {
    requestAnimationFrame(animate);

    if (!lastTime) lastTime = nowMs;
    const dt = Math.min(0.05, (nowMs - lastTime) / 1000);
    lastTime = nowMs;

    if (ps) {
        ps.update(dt);
        const ptr = ps.getPositionBufferPtr();
        const n = ps.getParticleCount();
        if (ptr && n > 0) {
            const positions = getPositionsView(ptr, n);
            updateInstances(positions, n);
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

    requestAnimationFrame(animate);
}

init();


