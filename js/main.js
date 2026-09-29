// --- SCENE & RENDERER SETUP ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
// EXACT BACK-TO-FRONT FLAT ORIENTATION:
// Moved further back (-105 on X) to ensure orbit isn't cut off.
// Dropped Y (to 20) to make it look closer to a flat plane rather than top-down.
camera.position.set(-105, 20, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputEncoding = THREE.sRGBEncoding; 
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxDistance = 800;
controls.minDistance = 10;
// Centers the view elegantly between Earth and Sun
controls.target.set(50, 0, 0); 

// --- TELESCOPE VIEWPORT (RIGHT SCREEN) ---
const telescopeCanvas = document.getElementById('telescope-canvas');
const telescopeRenderer = new THREE.WebGLRenderer({ canvas: telescopeCanvas, antialias: true });
telescopeRenderer.setSize(telescopeCanvas.clientWidth, telescopeCanvas.clientHeight, false);
telescopeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
telescopeRenderer.outputEncoding = THREE.sRGBEncoding;

const telescopeCamera = new THREE.PerspectiveCamera(24, telescopeCanvas.clientWidth / telescopeCanvas.clientHeight, 1.0, 500);

// LAYER SETUP:
const SUN_LAYER = 1;

// --- LIGHTING ---
const sunPosition = new THREE.Vector3(180, 0, 0);

const sunLight = new THREE.PointLight(0xffffff, 2.8, 1800);
sunLight.position.copy(sunPosition);
scene.add(sunLight);

const ambientLight = new THREE.AmbientLight(0x111111, 0.2);
scene.add(ambientLight);

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
    console.warn(`Could not find ${path}. Using fallback.`);
    return createColorTexture(fallbackHex);
  });
}

const earthDayTex = safeLoad('assets/8k_earth_daymap.jpg', '#1e40af');
const earthNightTex = safeLoad('assets/8k_earth_nightmap.jpg', '#050814');
const moonTex = safeLoad('assets/8k_moon.jpg', '#8a939e');
const sunTex = safeLoad('assets/8k_sun.jpg', '#f59e0b');

// --- STARFIELD BACKGROUND ---
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
telescopeCamera.layers.disable(SUN_LAYER);

// --- 2. THE EARTH ---
const earthGeo = new THREE.SphereGeometry(5.2, 64, 64);
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
scene.add(earth);

// --- 3. ORBIT PIVOT ---
const orbitPivot = new THREE.Group();
orbitPivot.rotation.z = 0.12; 
scene.add(orbitPivot);

// --- 4. THE MOON ---
const moonGeo = new THREE.SphereGeometry(1.55, 64, 64);
moonGeo.rotateY(-Math.PI / 2);
const moonMat = new THREE.MeshStandardMaterial({
  map: moonTex,
  roughness: 1.0,
  metalness: 0.0
});
const moon = new THREE.Mesh(moonGeo, moonMat);
orbitPivot.add(moon);

const ringPoints = [];
for (let i = 0; i <= 128; i++) {
  const theta = (i / 128) * Math.PI * 2;
  ringPoints.push(new THREE.Vector3(20 * Math.cos(theta) - 2, 0, 19.9 * Math.sin(theta)));
}
const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints);
const ringMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.22 });
orbitPivot.add(new THREE.Line(ringGeo, ringMat));

// --- SIMULATION DYNAMICS ---
let isPlaying = true;
let orbitSpeed = 1.0;
let orbitalAnomaly = 0; 

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
  
  let phaseAngle = Math.atan2(moonWorldPos.z, moonWorldPos.x);
  if (phaseAngle < 0) phaseAngle += Math.PI * 2;

  const exactIllum = Math.round(((1 - Math.cos(phaseAngle)) / 2) * 100);

  let activePhase = phases[0];
  if (phaseAngle >= 6.13 || phaseAngle <= 0.15) {
    activePhase = phases[0];
  } else {
    for (let p of phases) {
      if (phaseAngle >= p.min && phaseAngle < p.max) {
        activePhase = p;
        break;
      }
    }
  }
  
  document.getElementById('phase-title').innerText = activePhase.name;
  
  if (isPlaying) {
    document.getElementById('phase-illumination').innerText = `Illumination: ${exactIllum}%`;
  } else {
    document.getElementById('phase-illumination').innerText = `Illumination: ${activePhase.illumRange}`;
  }

  document.getElementById('phase-description').innerText = activePhase.desc;
}

// --- VERTICAL CAMERA OFFSET MAGIC FOR MOBILE ---
function updateCameraOffset() {
  if (window.innerWidth <= 768) {
    camera.setViewOffset(window.innerWidth, window.innerHeight, 0, window.innerHeight * 0.16, window.innerWidth, window.innerHeight);
  } else {
    camera.clearViewOffset();
  }
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
    orbitPivot.rotation.y += delta * 0.05 * orbitSpeed;
  }

  moon.position.x = 20 * Math.cos(orbitalAnomaly) - 2;
  moon.position.z = 19.9 * Math.sin(orbitalAnomaly);
  moon.lookAt(earth.position);

  earth.rotation.y += delta * 0.22 * orbitSpeed;
  sun.rotation.y += delta * 0.03;
  
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

  moon.getWorldPosition(moonWorldPos);
  const dirToMoon = moonWorldPos.clone().sub(earth.position).normalize();
  telescopeCamera.position.copy(earth.position).add(dirToMoon.multiplyScalar(5.3));
  telescopeCamera.up.set(0, 1, 0); 
  telescopeCamera.lookAt(moonWorldPos);

  telescopeRenderer.render(scene, telescopeCamera);
}

// --- UI EVENT LISTENERS ---
const playBtn = document.getElementById('play-pause-btn');
playBtn.addEventListener('click', () => {
  isPlaying = !isPlaying;
  playBtn.innerText = isPlaying ? "Pause" : "Play";
  updatePhaseInfo();
});

document.getElementById('speed-slider').addEventListener('input', (e) => {
  orbitSpeed = parseFloat(e.target.value);
});

document.getElementById('phase-slider').addEventListener('input', (e) => {
  orbitalAnomaly = parseFloat(e.target.value);
  updatePhaseInfo();
});

const buttonAngles = {
  "New": 0,
  "Wax. Crescent": 0.785,
  "1st Qtr": 1.57,
  "Wax. Gibbous": 2.356,
  "Full": 3.141,
  "Wan. Gibbous": 3.927,
  "3rd Qtr": 4.712,
  "Wan. Crescent": 5.498
};

document.querySelectorAll('.phase-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const btnText = e.target.innerText.trim();
    if (buttonAngles[btnText] !== undefined) {
      orbitPivot.rotation.y = 0; 
      orbitalAnomaly = buttonAngles[btnText];
      
      isPlaying = false;
      playBtn.innerText = "Play";
      
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
  
  const targetAngle = phaseFraction * Math.PI * 2;
  orbitPivot.rotation.y = 0; 
  orbitalAnomaly = targetAngle;
  
  isPlaying = false; 
  playBtn.innerText = "Play";
  
  updatePhaseInfo();
});

document.getElementById('reset-cam-btn').addEventListener('click', () => {
  // Snaps perfectly back to the exact same flat, zoomed-out alignment
  camera.position.set(-105, 20, 0);
  controls.target.set(50, 0, 0);
  controls.update();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  updateCameraOffset(); 
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initialize dynamic camera positioning
updateCameraOffset();
animate();