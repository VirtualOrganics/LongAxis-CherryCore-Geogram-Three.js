import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Minimal InstancedMesh frontend for ParticleSystem (Cherry Core repulsion only)

let scene, camera, renderer, controls;
let instancedMesh, dummy;
let facesMesh, facesGeom, facesMat;
let axisLines, axisGeom, axisMat;
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
    minSpeed: 0.00,
    maxSpeed: 2.00,
    colorMode: 'none', // 'none' | 'axis' | 'speed'
    showAxis: true,
    axisOpacity: 1.0,
    showFaces: false,
    faceOpacity: 0.35,
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

    // Instanced spheres
    const sphereGeo = new THREE.SphereGeometry(DEFAULT_RADIUS, 12, 12);
    const sphereMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 20 });
    instancedMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, NUM_PARTICLES);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Per-instance colors
    const colors = new Float32Array(NUM_PARTICLES * 3);
    // Initialize to mid-grey so particles are visible before axes are computed
    for (let i = 0; i < NUM_PARTICLES; i++) {
        colors[i * 3 + 0] = 0.7;
        colors[i * 3 + 1] = 0.7;
        colors[i * 3 + 2] = 0.7;
    }
    instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    instancedMesh.instanceColor.needsUpdate = true;
    scene.add(instancedMesh);

    // Axis line segments (2 vertices per particle)
    axisGeom = new THREE.BufferGeometry();
    axisGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NUM_PARTICLES * 2 * 3), 3));
    axisMat = new THREE.LineBasicMaterial({ color: 0xff66ff, transparent: true, opacity: guiState.axisOpacity });
    axisLines = new THREE.LineSegments(axisGeom, axisMat);
    scene.add(axisLines);

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
        }
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (axisColors && guiState.colorMode !== 'none' && instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
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
        }

        // Update Voronoi faces only if enabled
        if (guiState.showFaces && ps.getFaceVertexCount) {
            const vcount = ps.getFaceVertexCount();
            if (vcount > 0) {
                const posOff = ps.getFacePositionBufferByteOffset();
                const norOff = ps.getFaceNormalBufferByteOffset();
                const axOff  = ps.getFaceAxisBufferByteOffset();
                const pos = new Float32Array(Module.HEAPF32.buffer, posOff, vcount * 3);
                const nrm = new Float32Array(Module.HEAPF32.buffer, norOff, vcount * 3);
                const pax = new Float32Array(Module.HEAPF32.buffer, axOff, vcount * 3);

                if (!facesGeom) {
                    facesGeom = new THREE.BufferGeometry();
                    const vert = new THREE.Float32BufferAttribute(pos, 3);
                    const norm = new THREE.Float32BufferAttribute(nrm, 3);
                    const axis = new THREE.Float32BufferAttribute(pax, 3);
                    facesGeom.setAttribute('position', vert);
                    facesGeom.setAttribute('normal', norm);
                    facesGeom.setAttribute('particleAxis', axis);

                    facesMat = new THREE.ShaderMaterial({
                        transparent: true,
                        depthWrite: false,
                        uniforms: { uOpacity: { value: guiState.faceOpacity } },
                        vertexShader: `
                            attribute vec3 particleAxis;
                            varying vec3 vNormal;
                            varying vec3 vAxis;
                            void main(){
                                vNormal = normalize(normalMatrix * normal);
                                vAxis = particleAxis;
                                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                            }
                        `,
                        fragmentShader: `
                            varying vec3 vNormal;
                            varying vec3 vAxis;
                            uniform float uOpacity;
                            float bayer(vec2 p){
                                int x = int(mod(p.x,4.0));
                                int y = int(mod(p.y,4.0));
                                int idx = y*4 + x;
                                float t[16];
                                t[0]=0.0; t[1]=8.0; t[2]=2.0; t[3]=10.0;
                                t[4]=12.0; t[5]=4.0; t[6]=14.0; t[7]=6.0;
                                t[8]=3.0; t[9]=11.0; t[10]=1.0; t[11]=9.0;
                                t[12]=15.0; t[13]=7.0; t[14]=13.0; t[15]=5.0;
                                return t[idx]/16.0;
                            }
                            void main(){
                                float d = bayer(gl_FragCoord.xy);
                                if(d > uOpacity) discard;
                                float light = max(0.0, dot(normalize(vNormal), normalize(vec3(0.5,1.0,0.2))));
                                vec3 col = abs(vAxis);
                                gl_FragColor = vec4(col*(0.35+0.65*light), 1.0);
                            }
                        `
                    });
                    facesMesh = new THREE.Mesh(facesGeom, facesMat);
                    scene.add(facesMesh);
                } else {
                    facesGeom.attributes.position.array = pos;
                    facesGeom.attributes.normal.array = nrm;
                    facesGeom.attributes.particleAxis.array = pax;
                    facesGeom.attributes.position.needsUpdate = true;
                    facesGeom.attributes.normal.needsUpdate = true;
                    facesGeom.attributes.particleAxis.needsUpdate = true;
                    facesGeom.computeBoundingSphere();
                    facesMat.uniforms.uOpacity.value = guiState.faceOpacity;
                }
            }
        } else if (facesMesh) {
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
    ps.initialize(NUM_PARTICLES, DEFAULT_RADIUS, SEED);

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
    }

    requestAnimationFrame(animate);
}

init();


