// --- SCENE & RENDERER SETUP ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
const startZ = window.innerWidth <= 768 ? -150 : -120;
camera.position.set(startZ, 25, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputEncoding = THREE.sRGBEncoding; 
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

// --- STRICT CAMERA LAYERS ---
const SUN_LAYER = 1;
const SHADOW_CONES_LAYER = 2; 

telescopeCamera.layers.set(0); 
camera.layers.enable(SUN_LAYER);
camera.layers.enable(SHADOW_CONES_LAYER); 

// --- LIGHTING ---
const sunPosition = new THREE.Vector3(180, 0, 0);

const sunLight = new THREE.PointLight(0xffffff, 1.0, 1800);
sunLight.position.copy(sunPosition);
scene.add(sunLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.25);
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

const bloodLight = new THREE.SpotLight(0xff2200, 0, 50, 0.4, 1.0);
bloodLight.position.set(0, 0, 0); 
bloodLight.castShadow = false; 
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
  const u = Math.random(); const v = Math.random();
  const theta = u * 2.0 * Math.PI; const phi = Math.acos(2.0 * v - 1.0);
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

// --- 2. THE EARTH (PERFECTED SINGLE-SPHERE SHADER) ---
const earthRadius = 5.2;

// CRITICAL FIX: The multi-sphere hack is completely dead. The Earth is now EXACTLY ONE physical sphere. 
// It natively catches standard shadows, and seamlessly illuminates the night side using a custom PBR Emissive Mask!
// Z-fighting and texture tearing are permanently eliminated.
const earthMat = new THREE.MeshStandardMaterial({
  map: earthDayTex,
  emissiveMap: earthNightTex,
  emissive: 0xffffff,
  emissiveIntensity: 1.0,
  roughness: 0.8
});

earthMat.onBeforeCompile = function (shader) {
  shader.uniforms.sunPos = { value: sunPosition };

  shader.vertexShader = `
    varying vec3 vEarthWorldNormal;
    ${shader.vertexShader}
  `.replace(
    '#include <worldpos_vertex>',
    `
    #include <worldpos_vertex>
    vEarthWorldNormal = normalize(mat3(modelMatrix) * normal);
    `
  );

  shader.fragmentShader = `
    uniform vec3 sunPos;
    varying vec3 vEarthWorldNormal;
    ${shader.fragmentShader}
  `.replace(
    '#include <emissivemap_fragment>',
    `
    #ifdef USE_EMISSIVEMAP
      vec4 emissiveColor = texture2D( emissiveMap, vUv );
      emissiveColor.rgb = emissiveMapTexelToLinear( emissiveColor ).rgb;
      
      // Calculate where the sun is hitting
      vec3 sunDir = normalize(sunPos);
      float sunDot = dot(vEarthWorldNormal, sunDir);
      
      // Smoothly fade in the city lights exactly as the sun dot drops below the horizon
      float nightBlend = smoothstep(0.15, -0.15, sunDot);

      // Mask the emissive map so city lights ONLY show up on the dark side of the globe
      totalEmissiveRadiance *= (emissiveColor.rgb * nightBlend);
    #endif
    `
  );
};

const earth = new THREE.Mesh(new THREE.SphereGeometry(earthRadius, 64, 64), earthMat);
earth.receiveShadow = true; 
scene.add(earth);

// --- 3. ORBIT HIERARCHY ---
const orbitPivot = new THREE.Group();
scene.add(orbitPivot);

const moonOrbitPlane = new THREE.Group();
orbitPivot.add(moonOrbitPlane);

// --- 4. THE MOON ---
const moonRadius = 1.70;
const moonGeo = new THREE.SphereGeometry(moonRadius, 64, 64);
moonGeo.rotateY(-Math.PI / 2);

const moonMat = new THREE.MeshStandardMaterial({
  map: moonTex,
  roughness: 1.0,
  metalness: 0.0,
  emissive: 0x000000, 
  emissiveIntensity: 0
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
  geo.translate(0, height / 2, 0); geo.rotateZ(Math.PI / 2); 
  const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: opacity, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  
  mesh.layers.disable(0); 
  mesh.layers.enable(SHADOW_CONES_LAYER); 
  return mesh;
}

const earthUmbra = createCone(0, earthRadius, 86.6, 0x444400, 0.08); 
const earthPenumbra = createCone(15.4, earthRadius, 86.6, 0x444400, 0.02); 
shadowsGroup.add(earthUmbra); shadowsGroup.add(earthPenumbra);

const moonUmbra = createCone(0, moonRadius, 19.0, 0x888888, 0.10); 
const moonPenumbra = createCone(4.0, moonRadius, 19.0, 0x888888, 0.04); 
shadowsGroup.add(moonUmbra); shadowsGroup.add(moonPenumbra);

// --- SIMULATION DYNAMICS ---
let isPlaying = true;
let orbitSpeed = 1.0;
let orbitalAnomaly = 0; 
let activeCameraMode = 'free'; 
let eclipseMode = 'none'; 

const MAX_ORBIT_TILT = 5.14 * Math.PI / 180;

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
let targetCamPos = new THREE.Vector3();
let targetCtrlPos = new THREE.Vector3();

let lastPhaseName = "";
let lastIllumText = "";

function updatePhaseInfo() {
  moon.getWorldPosition(moonWorldPos);
  let phaseAngle = Math.atan2(-moonWorldPos.z, moonWorldPos.x);
  if (phaseAngle < 0) phaseAngle += Math.PI * 2;
  const exactIllum = Math.round(((1 - Math.cos(phaseAngle)) / 2) * 100);

  let activePhase = phases[0];
  if (phaseAngle >= 6.13 || phaseAngle <= 0.15) { activePhase = phases[0]; } 
  else { for (let p of phases) { if (phaseAngle >= p.min && phaseAngle < p.max) { activePhase = p; break; } } }
  
  const newTitle = activePhase.name;
  const newIllum = isPlaying ? `Illumination: ${exactIllum}%` : `Illumination: ${activePhase.illumRange}`;
  
  if (lastPhaseName !== newTitle) {
    document.getElementById('phase-title').innerText = newTitle;
    document.getElementById('phase-description').innerText = activePhase.desc;
    lastPhaseName = newTitle;
  }
  
  if (lastIllumText !== newIllum) {
    document.getElementById('phase-illumination').innerText = newIllum;
    lastIllumText = newIllum;
  }
}

function updateCameraOffset() {
  const isBottomPanel = window.innerWidth <= 768;
  if (isBottomPanel) { 
    camera.setViewOffset(window.innerWidth, window.innerHeight, 0, window.innerHeight * 0.10, window.innerWidth, window.innerHeight); 
  } else { 
    // Shift reduced to 145px to perfectly balance the newly refined Desktop Site Box width
    camera.setViewOffset(window.innerWidth, window.innerHeight, 145, 0, window.innerWidth, window.innerHeight); 
  }
  camera.updateProjectionMatrix();
}

function resizeTelescope() {
  const wrapper = document.getElementById('telescope-wrapper');
  const tWidth = wrapper.clientWidth;
  const tHeight = wrapper.clientHeight;
  
  const pixelRatio = window.devicePixelRatio || 1;
  const expectedWidth = Math.floor(tWidth * pixelRatio);
  const expectedHeight = Math.floor(tHeight * pixelRatio);

  if (telescopeCanvas.width !== expectedWidth || telescopeCanvas.height !== expectedHeight) {
    telescopeRenderer.setSize(tWidth, tHeight, false);
    telescopeCamera.aspect = tWidth / tHeight;
    telescopeCamera.updateProjectionMatrix();
  }
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

  if (eclipseMode === 'solar' || eclipseMode === 'lunar') {
    moonOrbitPlane.rotation.z = 0; moonOrbitPlane.rotation.x = MAX_ORBIT_TILT; 
  } else {
    moonOrbitPlane.rotation.z = MAX_ORBIT_TILT; moonOrbitPlane.rotation.x = 0; 
  }

  let v = parseFloat(document.getElementById('eclipse-slider').value);
  let sweep = (v - 0.5) * 0.7; 
  
  if (eclipseMode === 'solar') { orbitalAnomaly = 0 - sweep; } 
  else if (eclipseMode === 'lunar') { orbitalAnomaly = Math.PI + sweep; }

  moon.position.x = 20 * Math.cos(orbitalAnomaly);
  moon.position.z = -20 * Math.sin(orbitalAnomaly);
  moon.lookAt(earth.position);
  moon.getWorldPosition(moonWorldPos);

  let physicalDist = Math.abs(sweep);
  earth.castShadow = (eclipseMode === 'lunar');

  // --- PERFECTED PHYSICAL LIGHTING ---
  if (eclipseMode === 'solar') {
    let blackout = Math.max(0, 1.0 - (physicalDist / 0.05)); 
    ambientLight.intensity = 0.2 - (blackout * 0.18); 
    bloodLight.intensity = 0;
  } else if (eclipseMode === 'lunar') {
    ambientLight.intensity = 0.2; 
    let redIntensity = Math.max(0, 1.0 - (physicalDist / 0.28)) * 3.0; 
    bloodLight.intensity = redIntensity; 
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
    let zoomScalar = window.innerWidth <= 768 ? 7.5 : 5.5;
    let dirToMoon = moonWorldPos.clone().normalize();
    targetCamPos.copy(dirToMoon.multiplyScalar(zoomScalar)); 
    targetCtrlPos.copy(moonWorldPos);
  } else if (activeCameraMode === 'moon') {
    let zoomScalar = window.innerWidth <= 768 ? 2.8 : 1.9;
    let dirToEarth = moonWorldPos.clone().negate().normalize();
    targetCamPos.copy(moonWorldPos).add(dirToEarth.multiplyScalar(zoomScalar)); 
    targetCtrlPos.set(0, 0, 0);
  } else if (activeCameraMode === 'reset') {
    let resetZ = window.innerWidth <= 768 ? -150 : -120;
    targetCamPos.set(resetZ, 25, 0); targetCtrlPos.set(0, 0, 0);
  }

  if (activeCameraMode !== 'free') {
    let camDist = camera.position.distanceTo(targetCamPos);
    let ctrlDist = controls.target.distanceTo(targetCtrlPos);
    
    if (camDist < 2.0 && ctrlDist < 2.0) {
      camera.position.copy(targetCamPos);
      controls.target.copy(targetCtrlPos);
      if (activeCameraMode === 'reset') {
        activeCameraMode = 'free'; 
      }
    } else {
      camera.position.lerp(targetCamPos, 0.08);
      controls.target.lerp(targetCtrlPos, 0.08);
    }
    camera.lookAt(controls.target);
  } else {
    controls.update();
  }

  updatePhaseInfo();
  renderer.render(scene, camera);

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
    clearEclipseModes(); isPlaying = true; playBtn.innerText = "Pause";
  } else {
    clearEclipseModes(); eclipseMode = mode; document.getElementById(`btn-${mode}`).classList.add('active');
    orbitPivot.rotation.y = 0; isPlaying = false; playBtn.innerText = "Play";
    activeCameraMode = 'earth'; document.getElementById('eclipse-slider').value = 0.5; 
  }
  updatePhaseInfo();
}

// --- EVENT LISTENERS ---
const playBtn = document.getElementById('play-pause-btn');
playBtn.addEventListener('click', () => {
  isPlaying = !isPlaying; playBtn.innerText = isPlaying ? "Pause" : "Play";
  if (isPlaying) clearEclipseModes(); updatePhaseInfo();
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

document.getElementById('btn-live-date').addEventListener('click', () => {
  document.getElementById('calendar-picker').value = '';
  isPlaying = true; playBtn.innerText = "Pause"; clearEclipseModes(); updatePhaseInfo();
});

const buttonAngles = { "New": 0, "Wax. Crescent": 0.785, "1st Qtr": 1.57, "Wax. Gibbous": 2.356, "Full": 3.141, "Wan. Gibbous": 3.927, "3rd Qtr": 4.712, "Wan. Crescent": 5.498 };
document.querySelectorAll('.phase-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const btnText = e.target.innerText.trim();
    if (buttonAngles[btnText] !== undefined) {
      orbitPivot.rotation.y = 0; orbitalAnomaly = buttonAngles[btnText];
      isPlaying = false; playBtn.innerText = "Play"; clearEclipseModes(); updatePhaseInfo();
    }
  });
});

document.getElementById('calendar-picker').addEventListener('change', (e) => {
  const selectedDate = new Date(e.target.value); if (isNaN(selectedDate)) return;
  selectedDate.setUTCHours(6, 30, 0, 0); 
  const knownNewMoon = new Date(Date.UTC(2000, 0, 6, 18, 14, 0)).getTime();
  const synodicMonthMs = 29.53058770576 * 24 * 60 * 60 * 1000;
  const timeDiff = selectedDate.getTime() - knownNewMoon;
  let phaseFraction = (timeDiff % synodicMonthMs) / synodicMonthMs;
  if (phaseFraction < 0) phaseFraction += 1.0; 
  orbitPivot.rotation.y = 0; orbitalAnomaly = phaseFraction * Math.PI * 2;
  isPlaying = false; playBtn.innerText = "Play"; clearEclipseModes(); updatePhaseInfo();
});

document.getElementById('reset-cam-btn').addEventListener('click', () => { activeCameraMode = 'reset'; });
controls.addEventListener('start', () => { if (activeCameraMode !== 'free' && activeCameraMode !== 'reset') activeCameraMode = 'free'; });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; 
  updateCameraOffset(); 
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeTelescope(); 
});

updateCameraOffset();
resizeTelescope(); 
animate();
