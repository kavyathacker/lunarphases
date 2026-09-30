// --- SCENE & RENDERER SETUP ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(-105, 20, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputEncoding = THREE.sRGBEncoding; 
// Enable shadow engine for deep black cast shadows
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxDistance = 800;
controls.minDistance = 1;
controls.target.set(0, 0, 0); 

const telescopeCanvas = document.getElementById('telescope-canvas');
const telescopeRenderer = new THREE.WebGLRenderer({ canvas: telescopeCanvas, antialias: true });
telescopeRenderer.setSize(telescopeCanvas.clientWidth, telescopeCanvas.clientHeight, false);
telescopeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
telescopeRenderer.outputEncoding = THREE.sRGBEncoding;

const telescopeCamera = new THREE.PerspectiveCamera(24, telescopeCanvas.clientWidth / telescopeCanvas.clientHeight, 1.0, 500);

// --- LAYERS ---
const SUN_LAYER = 1;
const SHADOW_CONES_LAYER = 2; // Isolate cones so they hide from the telescope

// --- LIGHTING (REAL PHYSICAL SHADOWS) ---
const sunPosition = new THREE.Vector3(180, 0, 0);

const sunLight = new THREE.PointLight(0xffffff, 1.0, 1800);
sunLight.position.copy(sunPosition);
scene.add(sunLight);

// Directional Light precisely configured to cast real physical shadows across the void
const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
dirLight.position.copy(sunPosition);
dirLight.castShadow = true;
dirLight.shadow.camera.left = -30;
dirLight.shadow.camera.right = 30;
dirLight.shadow.camera.top = 30;
dirLight.shadow.camera.bottom = -30;
dirLight.shadow.camera.near = 100;
dirLight.shadow.camera.far = 250;
dirLight.shadow.bias = -0.005;
dirLight.shadow.mapSize.width = 4096;
dirLight.shadow.mapSize.height = 4096;
scene.add(dirLight);

const ambientLight = new THREE.AmbientLight(0x111111, 0.2);
scene.add(ambientLight);

// The exact red hue spotlight that creates the Blood Moon effect ONLY on the Earth-facing side!
const bloodLight = new THREE.SpotLight(0xff3300, 0, 50, 0.3, 1.0);
bloodLight.position.set(0, 0, 0); 
scene.add(bloodLight);
scene.add(bloodLight.target);

// --- TEXTURE LOADER ---
const textureLoader = new THREE.TextureLoader();

function createColorTexture(hex) {
  const canvas = document.createElement('canvas');
  canvas.width = 2; canvas.height = 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = hex; ctx.fillRect(0, 0, 2, 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function safeLoad(path, fallbackHex) {
  return textureLoader.load(path, (loaded) => {
    loaded.encoding = THREE.sRGBEncoding;
  }, undefined, () => {
    return createColorTexture(fallbackHex);
  });
}

const earthDayTex = safeLoad('assets/8k_earth_daymap.jpg', '#1e40af');
const earthNightTex = safeLoad('assets/8k_earth_nightmap.jpg', '#050814');
const moonTex = safeLoad('assets/8k_moon.jpg', '#8a939e');
const sunTex = safeLoad('assets/8k_sun.jpg', '#f59e0b');

// --- STARFIELD ---
const starsGeo = new THREE.BufferGeometry();
const starCount = 2200;
const starPos = new Float32Array(starCount * 3);

for (let i = 0; i < starCount * 3; i += 3) {
  const u = Math.random();
  const v = Math.random();
  const theta = u * 2.0 * Math.PI;
  const phi = Math.acos(2.0 * v - 1.0);
  const r = 600 + (Math.random() * 200); 
  starPos[i] = r * Math.sin(phi) * Math.cos(theta);
  starPos[i+1] = r * Math.sin(phi) * Math.sin(theta);
  starPos[i+2] = r * Math.cos(phi);
}
starsGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, transparent: true, opacity: 0.85 });
scene.add(new THREE.Points(starsGeo, starsMat));

// --- 1. THE SUN ---
const sunGeo = new THREE.SphereGeometry(16, 64, 64);
const sunMat = new THREE.MeshBasicMaterial({ map: sunTex });
const sun = new THREE.Mesh(sunGeo, sunMat);
sun.position.copy(sunPosition);
sun.layers.set(SUN_LAYER); 
scene.add(sun);

camera.layers.enable(SUN_LAYER);
camera.layers.enable(SHADOW_CONES_LAYER); // Main camera sees the cones

telescopeCamera.layers.disable(SUN_LAYER);
telescopeCamera.layers.disable(SHADOW_CONES_LAYER); // Telescope completely ignores the cones

// --- 2. THE EARTH ---
const earthRadius = 5.2;
const earthGeo = new THREE.SphereGeometry(earthRadius, 64, 64);
const earthMat = new THREE.ShaderMaterial({
  uniforms: {
    dayTexture: { value: earthDayTex },
    nightTexture: { value: earthNightTex },
    sunWorldPosition: { value: sunPosition }
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    void main() {
      vUv = uv;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  fragmentShader: `
    uniform sampler2D dayTexture;
    uniform sampler2D nightTexture;
    uniform vec3 sunWorldPosition;
    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;
    void main() {
      vec3 toSun = normalize(sunWorldPosition - vWorldPosition);
      float sunDot = dot(vWorldNormal, toSun);
      float blend = smoothstep(-0.1, 0.1, sunDot);
      vec4 day = texture2D(dayTexture, vUv);
      vec4 night = texture2D(nightTexture, vUv);
      gl_FragColor = mix(night, day, blend);
    }
  `
});
const earth = new THREE.Mesh(earthGeo, earthMat);
earth.castShadow = true; 
scene.add(earth);

const shadowMat = new THREE.ShadowMaterial({ opacity: 0.85 });
const earthShadowCatcher = new THREE.Mesh(new THREE.SphereGeometry(earthRadius + 0.05, 64, 64), shadowMat);
earthShadowCatcher.receiveShadow = true;
scene.add(earthShadowCatcher);

// --- 3. ORBIT HIERARCHY ---
const orbitPivot = new THREE.Group();
scene.add(orbitPivot);

const moonOrbitPlane = new THREE.Group();
orbitPivot.add(moonOrbitPlane);

// --- 4. THE MOON ---
const moonRadius = 1.70;
const moonGeo = new THREE.SphereGeometry(moonRadius, 64, 64);
moonGeo.rotateY(-Math.PI / 2);

// Uses pure texture now—lighting is handled 100% by physics!
const moonMat = new THREE.MeshStandardMaterial({
  map: moonTex,
  roughness: 1.0,
  metalness: 0.0
});
const moon = new THREE.Mesh(moonGeo, moonMat);
moon.castShadow = true;
moon.receiveShadow = true;
moonOrbitPlane.add(moon);

const ringPoints = [];
for (let i = 0; i <= 128; i++) {
  const theta = (i / 128) * Math.PI * 2;
  ringPoints.push(new THREE.Vector3(20 * Math.cos(theta), 0, -20 * Math.sin(theta)));
}
const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints);
const ringMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.22 });
moonOrbitPlane.add(new THREE.Line(ringGeo, ringMat));

// --- 5. UMBRA & PENUMBRA CONES ---
const shadowsGroup = new THREE.Group();
shadowsGroup.visible = false;
scene.add(shadowsGroup);

function createCone(radiusTop, radiusBottom, height, colorHex, opacity) {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 32, 1, true);
  geo.translate(0, height / 2, 0); 
  geo.rotateZ(Math.PI / 2); 
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: opacity,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.layers.set(SHADOW_CONES_LAYER); // Confines cones strictly to main camera
  return mesh;
}

// Earth Shadows (Dull, highly translucent yellow)
const earthUmbra = createCone(0, earthRadius, 86.6, 0x888822, 0.1); 
const earthPenumbra = createCone(15.4, earthRadius, 86.6, 0x888822, 0.03); 
shadowsGroup.add(earthUmbra);
shadowsGroup.add(earthPenumbra);

// Moon Shadows (Dull, translucent whitish-grey)
const moonUmbra = createCone(0, moonRadius, 19.0, 0x999999, 0.15); 
const moonPenumbra = createCone(4.0, moonRadius, 19.0, 0x999999, 0.05); 
shadowsGroup.add(moonUmbra);
shadowsGroup.add(moonPenumbra);

// --- SIMULATION DYNAMICS ---
let isPlaying = true;
let orbitSpeed = 1.0;
let orbitalAnomaly = 0; 
let activeCameraMode = 'free'; 
let eclipseMode = 'none'; 
const MAX_ORBIT_TILT = 20 * Math.PI / 180;

const phases = [
  { name: "New Moon", min: 6.13, max: 0.15, illumRange: "0%", desc: "The unlit side faces Earth, making the Moon invisible in the night sky." },
  { name: "Waxing Crescent", min: 0.15, max: 1.42, illumRange: "0.1% to 49.9%", desc: "A thin sliver of light appears on the right side and is growing." },
  { name: "First Quarter", min: 1.42, max: 1.72, illumRange: "50%", desc: "The right half of the Moon is lit, appearing a quarter of the way through the cycle." },
  { name: "Waxing Gibbous", min: 1.72, max: 3.0, illumRange: "50.1% to 99.9%", desc: "More than half of the face is bright and continuing to grow." },
  { name: "Full Moon", min: 3.0, max: 3.28, illumRange: "100%", desc: "The full face of the Moon shines brightly opposite the Sun." },
  { name: "Waning Gibbous", min: 3.28, max: 4.56, illumRange: "99.9% down to 50.1%", desc: "More than half is still lit, but the light decreases and is shrinking." },
  { name: "Third Quarter (Last Quarter)", min: 4.56, max: 4.86, illumRange: "50%", desc: "The opposite half (the left side) is now lit." },
  { name: "Waning Crescent", min: 4.86, max: 6.13, illumRange: "49.9% down to 0.1%", desc: "A thin curve remains on the left, shrinking toward the next New Moon." }
];

const moonWorldPos = new THREE.Vector3();

function updatePhaseInfo() {
  moon.getWorldPosition(moonWorldPos);
  
  let phaseAngle = Math.atan2(-moonWorldPos.z, moonWorldPos.x);
  if (phaseAngle < 0) phaseAngle += Math.PI * 2;
  const exactIllum = Math.round(((1 - Math.cos(phaseAngle)) / 2) * 100);

  let activePhase = phases[0];
  if (phaseAngle >= 6.13 || phaseAngle <= 0.15) { activePhase = phases[0]; } 
  else { for (let p of phases) { if (phaseAngle >= p.min && phaseAngle < p.max) { activePhase = p; break; } } }
  
  document.getElementById('phase-title').innerText = activePhase.name;
  if (isPlaying) { document.getElementById('phase-illumination').innerText = `Illumination: ${exactIllum}%`; } 
  else { document.getElementById('phase-illumination').innerText = `Illumination: ${activePhase.illumRange}`; }
  document.getElementById('phase-description').innerText = activePhase.desc;
}

function updateCameraOffset() {
  if (window.innerWidth <= 768) {
    camera.setViewOffset(window.innerWidth, window.innerHeight, 0, window.innerHeight * 0.14, window.innerWidth, window.innerHeight);
  } else { camera.clearViewOffset(); }
  camera.updateProjectionMatrix();
}

// --- ANIMATION LOOP ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (isPlaying) {
    orbitalAnomaly += delta * 0.35 * orbitSpeed;
    if (orbitalAnomaly > Math.PI * 2) orbitalAnomaly -= Math.PI * 2;
    earth.rotation.y += delta * 0.22 * orbitSpeed;
    sun.rotation.y += delta * 0.03;
    orbitPivot.rotation.y += delta * 0.05 * orbitSpeed;
  }

  moon.position.x = 20 * Math.cos(orbitalAnomaly);
  moon.position.z = -20 * Math.sin(orbitalAnomaly);
  moon.lookAt(earth.position);
  moon.getWorldPosition(moonWorldPos);

  let v = parseFloat(document.getElementById('eclipse-slider').value);
  if (eclipseMode === 'solar' || eclipseMode === 'lunar') {
    moonOrbitPlane.rotation.z = (1 - v) * MAX_ORBIT_TILT; 
  } else {
    moonOrbitPlane.rotation.z = MAX_ORBIT_TILT; 
    v = 0; 
  }

  // --- PHYSICAL LIGHTING LOGIC ---
  if (eclipseMode === 'solar') {
    ambientLight.intensity = 0.2 - (v * 0.18); // Drops ambient to near 0, making the front pitch black!
    bloodLight.intensity = 0;
  } else if (eclipseMode === 'lunar') {
    ambientLight.intensity = 0.2;
    bloodLight.intensity = v * 5.0; // Shines red purely on the Earth-facing side!
    bloodLight.target.position.copy(moonWorldPos);
  } else {
    ambientLight.intensity = 0.2;
    bloodLight.intensity = 0;
  }

  if (shadowsGroup.visible) {
    moonUmbra.position.copy(moonWorldPos);
    moonPenumbra.position.copy(moonWorldPos);
  }

  if (activeCameraMode === 'earth') {
    camera.position.lerp(new THREE.Vector3(0, 0, 0), 0.08);
    controls.target.lerp(moonWorldPos, 0.08);
  } else if (activeCameraMode === 'moon') {
    camera.position.lerp(moonWorldPos, 0.08);
    controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.08);
  } else if (activeCameraMode === 'reset') {
    camera.position.lerp(new THREE.Vector3(-105, 20, 0), 0.08);
    controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.08);
    if (camera.position.distanceTo(new THREE.Vector3(-105, 20, 0)) < 1) { activeCameraMode = 'free'; }
  }

  updatePhaseInfo();
  controls.update();
  renderer.render(scene, camera);

  const tWidth = telescopeCanvas.clientWidth;
  const tHeight = telescopeCanvas.clientHeight;
  if (tWidth > 0 && tHeight > 0) {
    telescopeRenderer.setSize(tWidth, tHeight, false);
    telescopeCamera.aspect = tWidth / tHeight;
    telescopeCamera.updateProjectionMatrix();
  }

  const dirToMoon = moonWorldPos.clone().sub(earth.position).normalize();
  telescopeCamera.position.copy(earth.position).add(dirToMoon.multiplyScalar(5.3));
  telescopeCamera.up.set(0, 1, 0); 
  telescopeCamera.lookAt(moonWorldPos);

  telescopeRenderer.render(scene, telescopeCamera);
}

// --- UI TOGGLE LOGIC ---
function clearEclipseModes() {
  eclipseMode = 'none';
  document.getElementById('btn-solar').classList.remove('active');
  document.getElementById('btn-lunar').classList.remove('active');
}

function toggleEclipse(mode) {
  if (eclipseMode === mode) {
    // Second click: TURN OFF and resume regular orbit
    clearEclipseModes();
    isPlaying = true;
    playBtn.innerText = "Pause";
  } else {
    // First click: TURN ON, freeze orbit, snap to eclipse
    clearEclipseModes();
    eclipseMode = mode;
    document.getElementById(`btn-${mode}`).classList.add('active');
    
    orbitPivot.rotation.y = 0; 
    orbitalAnomaly = (mode === 'solar') ? 0 : Math.PI; 
    isPlaying = false;
    playBtn.innerText = "Play";
    activeCameraMode = 'earth'; 
    document.getElementById('eclipse-slider').value = 1;
  }
  updatePhaseInfo();
}

// --- EVENT LISTENERS ---
const playBtn = document.getElementById('play-pause-btn');
playBtn.addEventListener('click', () => {
  isPlaying = !isPlaying;
  playBtn.innerText = isPlaying ? "Pause" : "Play";
  if (isPlaying) clearEclipseModes();
  updatePhaseInfo();
});

document.getElementById('speed-slider').addEventListener('input', (e) => { orbitSpeed = parseFloat(e.target.value); });
document.getElementById('phase-slider').addEventListener('input', (e) => { orbitalAnomaly = parseFloat(e.target.value); updatePhaseInfo(); });

document.getElementById('btn-solar').addEventListener('click', () => toggleEclipse('solar'));
document.getElementById('btn-lunar').addEventListener('click', () => toggleEclipse('lunar'));

document.getElementById('btn-earth-surf').addEventListener('click', () => { activeCameraMode = 'earth'; });
document.getElementById('btn-moon-surf').addEventListener('click', () => { activeCameraMode = 'moon'; });
document.getElementById('btn-shadows').addEventListener('click', () => {
  shadowsGroup.visible = !shadowsGroup.visible;
  document.getElementById('btn-shadows').classList.toggle('active', shadowsGroup.visible);
});

const buttonAngles = { "New": 0, "Wax. Crescent": 0.785, "1st Qtr": 1.57, "Wax. Gibbous": 2.356, "Full": 3.141, "Wan. Gibbous": 3.927, "3rd Qtr": 4.712, "Wan. Crescent": 5.498 };

document.querySelectorAll('.phase-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const btnText = e.target.innerText.trim();
    if (buttonAngles[btnText] !== undefined) {
      orbitPivot.rotation.y = 0; 
      orbitalAnomaly = buttonAngles[btnText];
      isPlaying = false;
      playBtn.innerText = "Play";
      clearEclipseModes();
      updatePhaseInfo();
    }
  });
});

document.getElementById('calendar-picker').addEventListener('change', (e) => {
  const selectedDate = new Date(e.target.value);
  if (isNaN(selectedDate)) return;
  selectedDate.setUTCHours(6, 30, 0, 0); 
  const knownNewMoon = new Date(Date.UTC(2000, 0, 6, 18, 14, 0)).getTime();
  const synodicMonthMs = 29.53058770576 * 24 * 60 * 60 * 1000;
  
  const timeDiff = selectedDate.getTime() - knownNewMoon;
  let phaseFraction = (timeDiff % synodicMonthMs) / synodicMonthMs;
  if (phaseFraction < 0) phaseFraction += 1.0; 
  
  orbitPivot.rotation.y = 0; 
  orbitalAnomaly = phaseFraction * Math.PI * 2;
  isPlaying = false; 
  playBtn.innerText = "Play";
  clearEclipseModes();
  updatePhaseInfo();
});

document.getElementById('reset-cam-btn').addEventListener('click', () => { activeCameraMode = 'reset'; });
controls.addEventListener('start', () => { if (activeCameraMode !== 'free' && activeCameraMode !== 'reset') activeCameraMode = 'free'; });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  updateCameraOffset(); 
  renderer.setSize(window.innerWidth, window.innerHeight);
});

updateCameraOffset();
animate();
