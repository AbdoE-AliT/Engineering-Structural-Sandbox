
/* ================= constants (SI units) ================= */

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import * as RAPIER from '@dimforge/rapier3d';
import elCentroNSData from './elcentro_NS.dat?raw';
import elCentroEWData from './elcentro_EW.dat?raw';
import { getLanguage, initializeLocalization, translateText } from './i18n.js';
const G = 9.81, DEG = Math.PI / 180, SF = 2.0, JOINT_SF = 2.0, GROUND = 'ground';
const MU_GROUND = 0.6, RHO_C = 2400;
const MIN_GEOMETRY_VOLUME = 1e-12;
const MIN_SECTION_AREA = 1e-8;
const MAX_BLOCK_MASS = 1e12;
const MAX_SCREEN_STRESS = 1e15;
const MAX_SCREEN_RATIO = 1e12;
// Edit these values to tune the generated atmosphere. Brightness and the light
// multipliers affect only the procedural sky; toneMappingExposure affects the whole scene.
const PROCEDURAL_SKY_SETTINGS = {
  brightness: 0.05,
  sunIntensity: 5.0,
  ambientIntensity: 1.0,
  turbidity: 1.0,
  rayleigh: 1.0,
  mie: 1.0,
  cloudCoverage: 0.4,
  cloudDensity: 0.7,
  cloudScale: 0.0002,
  cloudSpeed: 15,
  cloudElevation: 0.5,
  showSunDisc: 1
};
// Material data. Density is in kg/m^3, E and strength are in Pa, and fb is the flexural basis in Pa.
// Typical handbook values; real design must follow the governing code and tested data.
const MATS = {
  concrete: { name: 'Concrete C30/37', fam: 'concrete', rho: 2400, E: 30e9, strength: 30e6, ultimate: 30e6, fb: 3.5e6, type: 'brittle', mu: 0.6, impactEnergy: 24, color: 0xa6a39c, roughness: 0.9, metalness: 0 },
  steel: { name: 'Structural steel S275', fam: 'steel', rho: 7850, E: 200e9, strength: 275e6, ultimate: 410e6, fb: 275e6, type: 'ductile', mu: 0.5, impactEnergy: 180, color: 0x596573, roughness: 0.045, metalness: 1.0, clearcoat: 1.0, clearcoatRoughness: 0.025 },
  rubber: { name: 'Isolation rubber (screening)', fam: 'rubber', rho: 1100, E: 5e6, strength: 10e6, ultimate: 20e6, fb: 3e6, type: 'ductile', mu: 0.85, impactEnergy: 100, color: 0x282b30, roughness: 0.8, metalness: 0 },
  glass: { name: 'Laminated glass (visual infill)', fam: 'glass', rho: 2500, E: 70e9, strength: 45e6, ultimate: 70e6, fb: 35e6, type: 'brittle', mu: 0.45, impactEnergy: 18, color: 0x9bd5e8, roughness: 0.12, metalness: 0.05 },
  aluminum: { name: 'Aluminum 6061-T6', fam: 'alu', rho: 2700, E: 69e9, strength: 276e6, ultimate: 310e6, fb: 276e6, type: 'ductile', mu: 0.45, impactEnergy: 90, color: 0xb6c1ca, roughness: 0.28, metalness: 0.75 },
  brick: { name: 'Clay brick', fam: 'brick', rho: 1900, E: 5e9, strength: 15e6, ultimate: 15e6, fb: 0.5e6, type: 'brittle', mu: 0.6, impactEnergy: 12, color: 0x9b4935, roughness: 0.92, metalness: 0 },
  timber: { name: 'Oak timber (along grain)', fam: 'timber', rho: 750, E: 11e9, strength: 40e6, ultimate: 40e6, fb: 9e6, type: 'brittle', mu: 0.4, impactEnergy: 35, color: 0x80552f, roughness: 0.72, metalness: 0 }
};
// Corrected El Centro two-horizontal-component accelerogram, sampled at
// 0.02 s and stored in g. Data/source notes: vibrationdata.com/elcentro.htm;
// the page credits the PEER strong-motion archive and original CIT-SMARTS data.
// Presets scale this one measured record; scaling does not create new scenarios.
// Each preset states its moment magnitude (Mw). The scale is derived from the
// magnitude's estimated PGA so the recorded El Centro motion matches that intensity.
const QUAKES = {
  none: null,
  m45: { name: 'M4.5 Minor', mag: 4.5 },
  m5: { name: 'M5.0 Light', mag: 5.0 },
  m55: { name: 'M5.5 Moderate', mag: 5.5 },
  m6: { name: 'M6.0 Strong', mag: 6.0 },
  m65: { name: 'M6.5 Major', mag: 6.5 },
  m7: { name: 'M7.0 Major', mag: 7.0 },
  m75: { name: 'M7.5 Great', mag: 7.5 },
  m8: { name: 'M8.0 Great', mag: 8.0 }
};
// Fastener parameters. castC and castMu are ASSUMED design values, not taken from a code table.
const FAST = {
  nailD: 3.75, nailFu: 600, nailSpacing: 0.10,
  weldLeg: 0.006, weldSeg: 0.05, weldPhi: 0.75,
  mortarC: 0.2e6, mortarMu: 0.6,
  castC: 0.5e6, castMu: 0.7
};
const COL = { nail: 0xd9a441, weld: 0xff9d2e, mortar: 0xd8d0b8, cast: 0xb8c0c8,
  bearing: 0x5ba7d1, reinforced: 0x58d68d, bad: 0xff3b3b };

const byId = id => document.getElementById(id);
function resetControlsToDefaults() {
  for (const control of document.querySelectorAll('#start input, #start select, #app input, #app select')) {
    if (control instanceof HTMLInputElement) {
      if (control.type === 'file') continue;
      if (control.type === 'checkbox' || control.type === 'radio') control.checked = control.defaultChecked;
      else control.value = control.defaultValue;
    } else if (control instanceof HTMLSelectElement) {
      const defaultOption = [...control.options].find(option => option.defaultSelected);
      control.selectedIndex = defaultOption ? defaultOption.index : 0;
    }
  }
}
resetControlsToDefaults();
let uiLanguage = getLanguage();
let lastUiMessage = 'Ready.';
const AX = { x: 0, y: 1, z: 2 };
const AXV = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const AXCOL = [0xff5555, 0x55ff77, 0x5599ff];
const round = v => (Math.round(v * 1000) / 1000).toString();
const fosColor = f => !isFinite(f) ? 'var(--text)' : f < 1 ? 'var(--bad)' : f < SF ? 'var(--warn)' : 'var(--ok)';
const v3 = a => new THREE.Vector3(a.x ?? a[0], a.y ?? a[1], a.z ?? a[2]);
const isRot = b => b.rot.some(r => Math.abs(r) > 1e-6);
const MAX_STORED_RUNS = 30;
const MIN_PILLAR_SECTION = 0.5;
const newLearner = () => ({ version: 2, byQuake: {}, runs: [] });
let learner = newLearner();
try {
  localStorage.removeItem('structural-sandbox-adaptive-v2');
  localStorage.removeItem('structural-sandbox-language');
} catch { /* Storage is optional; session defaults still apply. */ }

/* ================= state ================= */
const S = { name: '', sim: false, t: 0, dirty: true, snap: true, grid: 1, stressView: false,
  speed: 4, sel: null, mat: 'concrete', undo: [], redo: [], sugs: [], quake: 'none', autoFasten: true,
  selected: new Set(), edit: null, vsel: new Set(), gizmoMode: 'move', hoverB: null, hoverH: -1, hoverV: -1,
  braceMode: false, braceThickness: 0.05, shearLinkThickness: 0.012, shearLinkSpacing: 0.16,
  infillMode: false, waveView: true, holdCount: 0, jointCount: 0,
  orbitTarget: null };
let T = null;
const blocks = [];
const joints = [];
const simulationFailures = { current: [], last: [] };
let simulationRunTracking = null;
const bodyMembers = new WeakMap();
const frameBraceRuntime = [];
let braceBayTargets = [];
let activeBraceBay = null;
let braceBayGroup = null;
let infillBayTargets = [];
let activeInfillBay = null;
let infillBayGroup = null;
let simulationLearningContext = null;
let simulationFrameModels = [];
let lastFrameReport = null;
let lastFrameReports = [];
let simulationPoseSnapshot = null;
let bakedSimulation = null;
let simulationBakeState = null;
let simulationPlayback = null;
let bakedPlaybackShown = false;
let sceneExplosion = null;
const SCENE_EXPLOSION_DURATION = 4;
const BAKED_CAPTURE_STRIDE = 4;
const BAKED_STEPS_PER_CHUNK = 24;
const BAKED_GRAVITY_DURATION = 8;
const MAX_BAKED_CACHE_BYTES = 128 * 1024 * 1024;
let nextId = 1;
let nextFrameId = 1;
let autoStabilizing = false;
let autoUndoCaptured = false;

function learningProfile(quake, create = true) {
  const key = quake === 'none' || !quake ? 'gravity' : quake;
  const profile = learner.byQuake[key];
  if (profile && Number.isFinite(profile.runs) &&
    Number.isFinite(profile.failedRuns) && profile.modes && typeof profile.modes === 'object' &&
    profile.members && typeof profile.members === 'object') {
    profile.joints ||= {};
    return profile;
  }
  if (!create) return null;
  return learner.byQuake[key] = {
    runs: 0, failedRuns: 0, completedRuns: 0, modes: {}, members: {}, joints: {}
  };
}

function memberLearningKey(b) {
  return `${b.id}:${b.mat}:${b.frame?.model || 'block'}:${b.frame?.role || ''}`;
}

function jointLearningKey(joint) {
  const endpoints = [memberLearningKey(joint.a), memberLearningKey(joint.b)].sort();
  return `${endpoints.join('|')}:${joint.kind}`;
}

function renderLearningStatus() {
  const el = byId('learnerStatus');
  if (!el) return;
  const profile = learningProfile(S.quake, false);
  if (!profile) {
    el.textContent = 'Select an earthquake preset to view its learned feedback.';
    return;
  }
  const modes = Object.entries(profile.modes || {}).filter(([, m]) => Number.isFinite(m?.ratio)).sort((a, b) => b[1].ratio - a[1].ratio);
  el.textContent = `${profile.runs} runs | ${profile.failedRuns} with failures${modes.length ? ` | highest observed: ${modes[0][0]} (${modes[0][1].ratio.toFixed(2)}x)` : ''}. Learning history resets when you refresh this page.`;
}

function saveLearner() {
  renderLearningStatus();
}

function currentSimulationLoad() {
  if (S.quake === 'none' || !QUAKES[S.quake]) return { direction: { x: 0, z: 0 }, accelerationG: { x: 0, z: 0 } };
  const x = groundA(S.t, QUAKES[S.quake], 'x');
  const z = groundA(S.t, QUAKES[S.quake], 'z');
  const magnitude = Math.hypot(x, z);
  return {
    direction: magnitude > 1e-9 ? { x: x / magnitude, z: z / magnitude } : { x: 0, z: 0 },
    accelerationG: { x: x / G, z: z / G }
  };
}

function recordSimulationPeaks() {
  if (!simulationRunTracking) return;
  const { direction, accelerationG } = currentSimulationLoad();
  const designAcceleration = S.quake !== 'none' && QUAKES[S.quake]
    ? groundPeaks(QUAKES[S.quake]).resultant * G : 0;
  for (const block of blocks) {
    if (!block.alive) continue;
    const ratio = Number.isFinite(block.breakRatio) && block.breakRatio > 0
      ? block.breakRatio : Number.isFinite(block.fos) && block.fos > 0 ? 1 / block.fos : 0;
    const stress = Math.max(0, block.stress || 0, block.flexStress || 0, block.shearStress || 0);
    const key = memberLearningKey(block);
    const peak = simulationRunTracking.blocks.get(key) || {
      id: block.id, material: MATS[block.mat].name, memberKey: key,
      peakRatio: 0, peakStress: 0, samples: 0, fractures: 0
    };
    peak.samples++;
    peak.peakStress = Math.max(peak.peakStress, stress);
    if (ratio >= peak.peakRatio) {
      Object.assign(peak, {
        peakRatio: ratio, mode: block.failureMode || 'modeled demand',
        position: [...block.pos], time: S.t, loadDirection: { ...direction },
        accelerationG: { ...accelerationG }
      });
    }
    simulationRunTracking.blocks.set(key, peak);
  }
  for (const joint of joints) {
    if (!joint.a.alive || !joint.b.alive) continue;
    const capacity = Math.max(joint.cap || 0, 1);
    const acceleration = Math.hypot(accelerationG.x, accelerationG.z) * G;
    const demand = joint.n === 1
      ? designAcceleration > 1e-9 ? (joint.V || 0) * acceleration / designAcceleration : 0
      : Math.min(joint.a.mass, joint.b.mass) * Math.hypot(G, acceleration);
    const ratio = Math.max(0, demand * (joint.materialSF || 1) / capacity);
    const key = jointLearningKey(joint);
    const peak = simulationRunTracking.joints.get(key) || {
      key, aId: joint.a.id, bId: joint.b.id, kind: joint.kind,
      peakRatio: 0, peakDemand: 0, samples: 0, failures: 0
    };
    peak.samples++;
    peak.peakDemand = Math.max(peak.peakDemand, demand);
    if (ratio >= peak.peakRatio) {
      const position = joint.pts?.length
        ? joint.pts.reduce((sum, point) => sum.add(point), new THREE.Vector3())
          .multiplyScalar(1 / joint.pts.length).toArray()
        : [...joint.a.pos];
      Object.assign(peak, {
        peakRatio: ratio, demand, capacity: joint.cap || 0, position, time: S.t,
        loadDirection: { ...direction },
        accelerationG: { ...accelerationG }
      });
    }
    simulationRunTracking.joints.set(key, peak);
  }
}

function recordSimulationOutcome(failures, context, elapsed, tracking) {
  if (!context) return;
  const profile = learningProfile(context.quake);
  const blockPeaks = [...(tracking?.blocks.values() || [])]
    .sort((a, b) => b.peakRatio - a.peakRatio);
  const jointPeaks = [...(tracking?.joints.values() || [])]
    .sort((a, b) => b.peakRatio - a.peakRatio);
  const run = {
    id: `${Date.now()}-${profile.runs + 1}`,
    startedAt: tracking?.startedAt || Date.now(),
    quake: context.quake || 'none',
    elapsed,
    completed: context.quake === 'none' || elapsed >= (QUAKES[context.quake]?.dur || Infinity) * 0.9,
    blockPeaks,
    jointPeaks,
    fractures: [...(tracking?.fractures || [])]
  };
  learner.runs.push(run);
  if (learner.runs.length > MAX_STORED_RUNS) learner.runs.splice(0, learner.runs.length - MAX_STORED_RUNS);
  profile.runs++;
  if (failures.length || run.fractures.length) {
    profile.failedRuns++;
  } else if (run.completed) {
    profile.completedRuns++;
  }
  const memberFracturesThisRun = new Map();
  for (const failure of run.fractures) {
    if (failure.kind === 'fracture' && failure.memberKey) {
      memberFracturesThisRun.set(failure.memberKey,
        (memberFracturesThisRun.get(failure.memberKey) || 0) + 1);
    }
  }
  for (const peak of blockPeaks) {
    const member = profile.members[peak.memberKey] || {
      id: peak.id, material: peak.material, mode: peak.mode, ratio: 0,
      peakStress: 0, samples: 0, fractures: 0
    };
    member.peakStress ||= 0;
    member.fractures ||= 0;
    if (peak.peakRatio >= member.ratio) {
      member.mode = peak.mode;
      member.position = peak.position;
      member.loadDirection = peak.loadDirection;
      member.accelerationG = peak.accelerationG;
    }
    member.ratio = Math.max(member.ratio, peak.peakRatio);
    member.peakStress = Math.max(member.peakStress || 0, peak.peakStress);
    member.recentRatio = peak.peakRatio;
    member.recentStress = peak.peakStress;
    member.recentMode = peak.mode;
    member.lastRunId = run.id;
    member.lastRunFractures = memberFracturesThisRun.get(peak.memberKey) || 0;
    member.samples++;
    profile.members[peak.memberKey] = member;
    if (peak.mode) {
      const mode = profile.modes[peak.mode] || { ratio: 0, samples: 0 };
      mode.ratio = Math.max(mode.ratio, peak.peakRatio);
      mode.samples++;
      profile.modes[peak.mode] = mode;
    }
  }
  for (const peak of jointPeaks) {
    const joint = profile.joints[peak.key] || {
      aId: peak.aId, bId: peak.bId, kind: peak.kind, ratio: 0, samples: 0, failures: 0
    };
    joint.ratio = Math.max(joint.ratio, peak.peakRatio);
    joint.recentRatio = peak.peakRatio;
    joint.recentFailures = peak.failures || 0;
    joint.position = peak.position;
    joint.loadDirection = peak.loadDirection;
    joint.accelerationG = peak.accelerationG;
    joint.samples++;
    profile.joints[peak.key] = joint;
  }
  for (const failure of run.fractures) {
    if (failure.kind === 'fracture' && failure.memberKey && profile.members[failure.memberKey]) {
      const member = profile.members[failure.memberKey];
      member.fractures = (member.fractures || 0) + 1;
    }
    if (failure.jointKey) {
      const joint = profile.joints[failure.jointKey] || {
        aId: failure.id, bId: failure.relatedMemberId, kind: failure.material,
        ratio: demandCapacityRatio(failure.demand, failure.capacity),
        recentRatio: demandCapacityRatio(failure.demand, failure.capacity), samples: 0, failures: 0
      };
      joint.failures++;
      joint.recentFailures = (joint.recentFailures || 0) + 1;
      joint.position = failure.position;
      joint.loadDirection = failure.loadDirection;
      joint.accelerationG = failure.accelerationG;
      profile.joints[failure.jointKey] = joint;
    }
  }
  saveLearner();
}

/* ================= renderer / scene / camera ================= */
const view = byId('view');
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();
view.insertBefore(renderer.domElement, byId('hint'));
const dom = renderer.domElement;

const scene = new THREE.Scene();
scene.background = null;
scene.fog = new THREE.Fog(0xb8c3d1, 120, 420);

const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1000);
camera.rotation.order = 'YXZ';
camera.position.set(12, 9, 14);
camera.rotation.set(-0.46, 0.7, 0);

// Procedural atmospheric sky.
const sky = new Sky();
sky.scale.setScalar(450000);
const proceduralSkyBrightness = { value: PROCEDURAL_SKY_SETTINGS.brightness };
sky.material.onBeforeCompile = shader => {
  shader.uniforms.proceduralSkyBrightness = proceduralSkyBrightness;
  shader.fragmentShader = shader.fragmentShader.replace(
    'void main() {',
    'uniform float proceduralSkyBrightness;\nvoid main() {'
  ).replace(
    '#include <tonemapping_fragment>',
    'gl_FragColor.rgb *= proceduralSkyBrightness;\n#include <tonemapping_fragment>'
  );
};
sky.material.customProgramCacheKey = () => 'procedural-sky-brightness-v1';
const sunDirection = new THREE.Vector3(30, 6, -20).normalize();
sky.material.uniforms.sunPosition.value.copy(sunDirection);
sky.material.uniforms.turbidity.value = 10;
sky.material.uniforms.rayleigh.value = 2.5;
sky.material.uniforms.mieCoefficient.value = 0.015;
sky.material.uniforms.mieDirectionalG.value = 0.85;
sky.material.uniforms.cloudCoverage.value = PROCEDURAL_SKY_SETTINGS.cloudCoverage;
sky.material.uniforms.cloudDensity.value = PROCEDURAL_SKY_SETTINGS.cloudDensity;
sky.material.uniforms.cloudScale.value = PROCEDURAL_SKY_SETTINGS.cloudScale;
sky.material.uniforms.cloudSpeed.value = PROCEDURAL_SKY_SETTINGS.cloudSpeed;
sky.material.uniforms.cloudElevation.value = PROCEDURAL_SKY_SETTINGS.cloudElevation;
sky.material.uniforms.showSunDisc.value = PROCEDURAL_SKY_SETTINGS.showSunDisc;
scene.add(sky);

const hemiLight = new THREE.HemisphereLight(0xdce6f5, 0x566273, 0.75); scene.add(hemiLight);
const sun = new THREE.DirectionalLight(0xfff8ef, 1.1);
sun.position.set(30, 6, -20);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -65, right: 65, top: 65, bottom: -65, far: 150 });
scene.add(sun);

// The ground moves during earthquakes; objects feel shaking only through contact with the ground.
const groundGroup = new THREE.Group();
scene.add(groundGroup);
const GROUND_HALF = 60;
const plateMesh = new THREE.Mesh(new THREE.BoxGeometry(GROUND_HALF * 2, 0.1, GROUND_HALF * 2), new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.95 }));
plateMesh.position.y = -0.05;
plateMesh.receiveShadow = true;
groundGroup.add(plateMesh);
let excavationDirty = true;
const gridGroup = new THREE.Group();
groundGroup.add(gridGroup);
(function buildGrid() {
  const reg = [];
  for (let i = -60; i <= 60; i++) reg.push(i, 0.003, -60, i, 0.003, 60, -60, 0.003, i, 60, 0.003, i);
  const axes = [-60, 0.004, 0, 60, 0.004, 0, 0, 0.004, -60, 0, 0.004, 60];
  const mk = (arr, col) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col }));
  };
  gridGroup.add(mk(reg, 0x3a4a5e), mk(axes, 0x6e8fb3));
})();

// QuakeLab incoming-wave visualization (MIT; see LICENSE.QuakeLab).
// The display is illustrative; its wave fronts do not drive solver input.
const quakeWaveGroup = new THREE.Group();
scene.add(quakeWaveGroup);
const quakeWaveDirection = new THREE.Vector3(0.965, 0, 0.262).normalize();
const quakeWaveSide = new THREE.Vector3(-quakeWaveDirection.z, 0, quakeWaveDirection.x).normalize();
let quakeWaveHalfDiag = 1;
const quakeWaveArrow = new THREE.ArrowHelper(
  quakeWaveDirection.clone(),
  new THREE.Vector3(),
  1,
  0x5bd8ff,
  2.0,
  1.1
);
quakeWaveGroup.add(quakeWaveArrow);
function setEarthquakeWaveDirection(degrees) {
  const parsedDegrees = Number(degrees);
  if (!Number.isFinite(parsedDegrees)) return;
  const angle = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(parsedDegrees, 0, 360));
  quakeWaveDirection.set(Math.cos(angle), 0, Math.sin(angle)).normalize();
  quakeWaveArrow.setDirection(quakeWaveDirection);
}
const quakeWaveMainSamples = 240;
const quakeWaveMainPositions = new Float32Array(quakeWaveMainSamples * 3);
const quakeWaveMainGeometry = new THREE.BufferGeometry();
quakeWaveMainGeometry.setAttribute(
  'position',
  new THREE.BufferAttribute(quakeWaveMainPositions, 3).setUsage(THREE.DynamicDrawUsage)
);
const quakeWaveMainLine = new THREE.Line(
  quakeWaveMainGeometry,
  new THREE.LineBasicMaterial({ color: 0x80e8ff, transparent: true, opacity: 0.92 })
);
quakeWaveGroup.add(quakeWaveMainLine);
const quakeWaveBands = [];
const quakeWaveNames = ['P', 'S', 'Rayleigh', 'Love'];
for (let index = 0; index < 8; index++) {
  const samples = 120;
  const positions = new Float32Array(samples * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
  );
  const waveName = quakeWaveNames[index % quakeWaveNames.length];
  const isP = waveName === 'P';
  const color = waveName === 'P' ? 0x86eeff
    : waveName === 'S' ? 0x63c9ff
      : waveName === 'Rayleigh' ? 0x49a8ff : 0x3a95ff;
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: isP ? 0.82 : 0.70
    })
  );
  line.frustumCulled = false;
  quakeWaveGroup.add(line);
  quakeWaveBands.push({ line, positions, samples, isP, index, waveName });
}
const quakeWaveLabels = [];
for (const [index, text, color] of [
  [0, 'P wave', 0xe6edf3],
  [1, 'S wave', 0x97a4b6],
  [2, 'Rayleigh', 0x97a4b6],
  [3, 'Love', 0x778497]
]) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '500 52px "Segoe UI", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const plateWidth = Math.min(context.measureText(text).width + 56, canvas.width - 8);
  const plateX = (canvas.width - plateWidth) / 2;
  context.fillStyle = '#141b22';
  context.fillRect(plateX, 27, plateWidth, 74);
  context.lineWidth = 3;
  context.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
  context.strokeRect(plateX, 27, plateWidth, 74);
  context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false
  }));
  sprite.scale.set(4.8, 1.2, 1);
  sprite.visible = false;
  quakeWaveGroup.add(sprite);
  quakeWaveLabels.push({ sprite, index, waveName: quakeWaveNames[index] });
}

// Procedural skins are used until a PBR map is supplied for that material.
function paintMaterialCanvas(kind) {
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const rand = (a, b) => a + Math.random() * (b - a);
  const base = { concrete: '#b9b6b0', steel: '#9aa2ab', rubber: '#3a3d42',
    aluminum: '#c3cad2', brick: '#a9604a', timber: '#8a5a33' }[kind] || '#b9b6b0';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  if (kind === 'concrete') {
    // Aggregate speckle plus faint formwork board lines.
    for (let i = 0; i < 9000; i++) {
      const v = Math.random();
      ctx.fillStyle = v < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(60,58,54,0.10)';
      ctx.fillRect(rand(0, S), rand(0, S), rand(1, 2.5), rand(1, 2.5));
    }
    ctx.globalAlpha = 0.16;
    for (let y = 0; y < S; y += 32) {
      ctx.fillStyle = y % 64 ? '#8f8c86' : '#c9c6c0';
      ctx.fillRect(0, y, S, 2);
    }
    ctx.globalAlpha = 1;
  } else if (kind === 'steel' || kind === 'aluminum') {
    // Brushed metal: fine vertical streaks.
    for (let x = 0; x < S; x += 2) {
      const v = rand(-14, 14);
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(20,24,30,${-v / 255})`;
      ctx.fillRect(x, 0, 1, S);
    }
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rand(0.02, 0.08)})`;
      ctx.fillRect(rand(0, S), rand(0, S), rand(1, 3), 1);
    }
  } else if (kind === 'brick') {
    // Running-bond brick with mortar joints.
    const bh = 32, bw = 64;
    ctx.fillStyle = '#c9c2b4';
    ctx.fillRect(0, 0, S, S);
    for (let row = 0; row < S / bh; row++) {
      const off = (row % 2) * bw / 2;
      for (let col = -1; col < S / bw + 1; col++) {
        const x = col * bw + off, y = row * bh;
        const shade = rand(-18, 18);
        ctx.fillStyle = `rgb(${169 + shade},${96 + shade * 0.7},${74 + shade * 0.5})`;
        ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = `rgba(60,30,20,${rand(0.05, 0.18)})`;
          ctx.fillRect(x + rand(3, bw - 3), y + rand(3, bh - 3), rand(1, 3), rand(1, 2));
        }
      }
    }
  } else if (kind === 'timber') {
    // Wood grain: long horizontal streaks with knots.
    for (let y = 0; y < S; y += 3) {
      const v = rand(-16, 16);
      ctx.fillStyle = v > 0 ? `rgba(255,220,170,${v / 255})` : `rgba(40,20,5,${-v / 255})`;
      ctx.fillRect(0, y, S, 2);
    }
    for (let i = 0; i < 8; i++) {
      const x = rand(20, S - 20), y = rand(20, S - 20);
      ctx.strokeStyle = 'rgba(50,28,10,0.5)';
      ctx.lineWidth = rand(1, 2);
      ctx.beginPath();
      ctx.ellipse(x, y, rand(4, 9), rand(2, 4), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (kind === 'rubber') {
    for (let i = 0; i < 6000; i++) {
      const v = rand(-10, 10);
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
      ctx.fillRect(rand(0, S), rand(0, S), rand(1, 2), rand(1, 2));
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}
const materialTextures = new Map();
function materialTexture(mat) {
  const kind = MATS[mat].fam === 'glass' ? null : mat;
  if (!kind) return null;
  if (!materialTextures.has(kind)) materialTextures.set(kind, paintMaterialCanvas(kind));
  return materialTextures.get(kind);
}
const PBR_TEXTURE_ASSETS = import.meta.glob(
  './assets/materials/*/*.{png,jpg,jpeg,webp}',
  { eager: true, query: '?url', import: 'default' }
);
// Approximate world-space size, in meters, of one texture repeat per material.
// Increase a value for larger-looking texture features; reduce it for denser tiling.
const TEXTURE_TILE_SIZE_METERS = {
  concrete: 2,
  steel: 4,
  rubber: 1,
  glass: 1,
  aluminum: 1,
  brick: 1,
  timber: 1
};
const PBR_MAP_SLOTS = new Map();
const addPbrCandidate = (mat, slot, url, path, priority) => {
  if (!PBR_MAP_SLOTS.has(mat)) PBR_MAP_SLOTS.set(mat, new Map());
  const slots = PBR_MAP_SLOTS.get(mat), current = slots.get(slot);
  if (!current || priority > current.priority) slots.set(slot, { url, path, priority });
};
for (const [path, url] of Object.entries(PBR_TEXTURE_ASSETS)) {
  const match = path.match(/\/assets\/materials\/([^/]+)\/([^/]+)\.(?:png|jpe?g|webp)$/i);
  if (!match || !MATS[match[1]]) continue;
  const filename = match[2].toLowerCase().replace(/_(?:\d+k|\d{3,4}p)$/, '');
  if (/(?:^|_)arm$/.test(filename)) {
    for (const slot of ['aoMap', 'roughnessMap', 'metalnessMap'])
      addPbrCandidate(match[1], slot, url, path, 1);
    continue;
  }
  const normal = filename.match(/(?:^|_)(?:nor|normal)(?:_(gl|dx))?$/);
  const slot = normal ? 'normalMap'
    : /(?:^|_)(?:diff|diffuse|basecolor|albedo|color)$/.test(filename) ? 'map'
      : /(?:^|_)rough(?:ness)?$/.test(filename) ? 'roughnessMap'
        : /(?:^|_)(?:metal|metallic|metalness)$/.test(filename) ? 'metalnessMap'
          : /(?:^|_)(?:ao|occlusion)$/.test(filename) ? 'aoMap'
            : /(?:^|_)(?:disp|displacement|height|bump)$/.test(filename) ? 'bumpMap' : null;
  if (!slot) continue;
  const priority = normal ? (normal[1] === 'gl' ? 3 : normal[1] === 'dx' ? 1 : 2)
    : slot === 'aoMap' || slot === 'roughnessMap' || slot === 'metalnessMap' ? 2 : 3;
  addPbrCandidate(match[1], slot, url, path, priority);
}
const materialPbrMaps = new Map();
const materialNormalScaleY = new Map();
for (const [mat, candidates] of PBR_MAP_SLOTS) {
  const maps = {};
  materialPbrMaps.set(mat, maps);
  const texturesByPath = new Map();
  for (const [slot, candidate] of candidates) {
    let texture = texturesByPath.get(candidate.path);
    if (!texture) {
      texture = new THREE.TextureLoader().load(candidate.url, loaded => {
        loaded.colorSpace = candidate.path.toLowerCase().includes('diff') ||
        /(?:basecolor|albedo|color)/i.test(candidate.path)
          ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        loaded.wrapS = loaded.wrapT = THREE.RepeatWrapping;
        loaded.anisotropy = renderer.capabilities.getMaxAnisotropy();
        refreshMaterialTextureUsers(mat);
      }, undefined, error => {
        console.error(`Could not load PBR texture ${candidate.path}:`, error);
      });
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texturesByPath.set(candidate.path, texture);
    }
    maps[slot] = texture;
    if (slot === 'normalMap') materialNormalScaleY.set(mat,
      /_nor(?:mal)?_dx(?:_|\.|$)/i.test(candidate.path) ? -1 : 1);
  }
}
function cloneTiledTexture(texture, mat) {
  if (!texture) return null;
  const clone = texture.clone();
  clone.wrapS = clone.wrapT = THREE.RepeatWrapping;
  const tileSize = TEXTURE_TILE_SIZE_METERS[mat] || 1;
  clone.repeat.set(1 / tileSize, 1 / tileSize);
  clone.needsUpdate = true;
  return clone;
}
function blockTextures(mat) {
  const procedural = materialTexture(mat);
  const maps = materialPbrMaps.get(mat) || {};
  const textures = {
    map: cloneTiledTexture(procedural, mat),
    bumpMap: maps.normalMap ? null : cloneTiledTexture(procedural, mat)
  };
  for (const [slot, texture] of Object.entries(maps)) textures[slot] = cloneTiledTexture(texture, mat);
  return textures;
}
function disposeMaterialMaps(material) {
  const maps = new Set(['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap']
    .map(slot => material[slot]).filter(Boolean));
  for (const map of maps) map.dispose();
}
function applyMaterialMaps(mesh, mat) {
  const material = mesh.material;
  disposeMaterialMaps(material);
  Object.assign(material, blockTextures(mat));
  material.normalScale.set(1, materialNormalScaleY.get(mat) ?? 1);
  material.color.setHex(materialPbrMaps.get(mat)?.map ? 0xffffff : MATS[mat].color);
  material.needsUpdate = true;
}
function refreshMaterialTextureUsers(mat) {
  for (const block of blocks) if (block.alive && block.mat === mat) {
    applyMaterialMaps(block.mesh, mat);
    block.paintKey = null;
    paint(block);
  }
  for (const piece of debris) if (piece.mat === mat) applyMaterialMaps(piece.mesh, mat);
}
function createMaterialVisual(mat, options = {}) {
  const descriptor = MATS[mat];
  const Material = descriptor.clearcoat != null ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  return new Material({
    color: materialPbrMaps.get(mat)?.map ? 0xffffff : descriptor.color,
    roughness: descriptor.roughness, metalness: descriptor.metalness,
    clearcoat: descriptor.clearcoat ?? 0,
    clearcoatRoughness: descriptor.clearcoatRoughness ?? 0,
    bumpScale: 0.05, normalScale: new THREE.Vector2(1, materialNormalScaleY.get(mat) ?? 1),
    ...blockTextures(mat), ...options
  });
}
/* ================= environments ================= */
// Ground skins are painted procedurally on a canvas so the app stays fully offline.
// Each preset also retunes fog, sky, and lights so the scene stays coherent.
function paintGroundCanvas(kind) {
  const S = 512, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const base = { grass: '#4c7a2e', desert: '#d9b878', snow: '#eef2f6', asphalt: '#3b3e43' }[kind] || '#8a7a6a';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  const rand = (a, b) => a + Math.random() * (b - a);
  // Large soft mottling for tonal variation.
  const mottle = { grass: 'rgba(30,60,15,0.10)', desert: 'rgba(160,120,60,0.10)',
    snow: 'rgba(160,180,205,0.08)', asphalt: 'rgba(10,10,12,0.12)' }[kind] || 'rgba(0,0,0,0.06)';
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = mottle;
    ctx.beginPath();
    ctx.ellipse(rand(0, S), rand(0, S), rand(20, 90), rand(15, 70), rand(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  if (kind === 'grass') {
    // Thousands of short blade strokes in layered greens.
    const greens = ['#3d6623', '#568c33', '#6aa344', '#87b954', '#a4cc6d', '#2f521a'];
    for (let i = 0; i < 9000; i++) {
      const x = rand(0, S), y = rand(0, S), len = rand(2, 7), lean = rand(-1.5, 1.5);
      ctx.strokeStyle = greens[(Math.random() * greens.length) | 0];
      ctx.globalAlpha = rand(0.25, 0.8);
      ctx.lineWidth = rand(0.6, 1.4);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + lean, y - len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (kind === 'desert') {
    // Wind ripples plus sand speckle.
    ctx.globalAlpha = 0.12;
    for (let y = 0; y < S; y += 14) {
      ctx.strokeStyle = (y / 14) % 2 ? '#b8935a' : '#e8cd96';
      ctx.lineWidth = rand(2, 4);
      ctx.beginPath();
      for (let x = 0; x <= S; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.05 + y) * 3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? '#c8a468' : '#efd9a4';
      ctx.globalAlpha = rand(0.2, 0.6);
      ctx.fillRect(rand(0, S), rand(0, S), rand(1, 2.5), rand(1, 2.5));
    }
    ctx.globalAlpha = 1;
  } else if (kind === 'snow') {
    // Soft blue-white drifts and sparkle.
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = Math.random() < 0.6 ? '#ffffff' : '#dbe7f2';
      ctx.globalAlpha = rand(0.15, 0.5);
      ctx.beginPath();
      ctx.arc(rand(0, S), rand(0, S), rand(1, 4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (kind === 'asphalt') {
    // Aggregate speckle and faint cracks.
    for (let i = 0; i < 7000; i++) {
      const v = rand(0, 1);
      ctx.fillStyle = v < 0.5 ? '#2e3136' : v < 0.8 ? '#4a4e55' : '#5d626a';
      ctx.globalAlpha = rand(0.2, 0.7);
      ctx.fillRect(rand(0, S), rand(0, S), rand(1, 2.2), rand(1, 2.2));
    }
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#1c1e22';
    for (let i = 0; i < 24; i++) {
      ctx.lineWidth = rand(0.5, 1.2);
      ctx.beginPath();
      let x = rand(0, S), y = rand(0, S);
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += rand(-30, 30); y += rand(-30, 30); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const ENVIRONMENTS = {
  grid: { label: 'Blueprint grid', ground: 0x777e87, map: null, repeat: 1, roughness: 0.95,
    grid: true, fog: [0xb8c3d1, 120, 420], hemi: [0xdce6f5, 0x566273, 0.75],
    sun: [0xfff8ef, 1.1], sky: { turbidity: 3, rayleigh: 2.5, mie: 0.006, g: 0.78 }, props: null },
  grass: { label: 'Grass field', ground: 0xffffff, map: 'grass', repeat: 48, roughness: 1.0,
    grid: false, fog: [0xcfe0d2, 140, 460], hemi: [0xbfd9ff, 0x4a6b3a, 0.95],
    sun: [0xfff2dd, 1.25], sky: { turbidity: 6, rayleigh: 1.5, mie: 0.008, g: 0.8 }, props: 'grass' },
  desert: { label: 'Desert', ground: 0xffffff, map: 'desert', repeat: 40, roughness: 1.0,
    grid: false, fog: [0xe8c98f, 130, 440], hemi: [0xffe0b0, 0xb08050, 0.9],
    sun: [0xffd9a8, 1.2], sky: { turbidity: 12, rayleigh: 3.0, mie: 0.02, g: 0.9 }, props: 'desert' },
  snow: { label: 'Snow field', ground: 0xffffff, map: 'snow', repeat: 44, roughness: 0.85,
    grid: false, fog: [0xe8eef4, 120, 420], hemi: [0xdfeaff, 0x8899aa, 1.0],
    sun: [0xf4f8ff, 1.05], sky: { turbidity: 4, rayleigh: 0.8, mie: 0.005, g: 0.75 }, props: 'snow' },
  asphalt: { label: 'Asphalt site', ground: 0xffffff, map: 'asphalt', repeat: 36, roughness: 0.9,
    grid: true, fog: [0x9aa0a6, 110, 400], hemi: [0xcfd8e0, 0x555a60, 0.85],
    sun: [0xffffff, 1.15], sky: { turbidity: 8, rayleigh: 1.2, mie: 0.01, g: 0.8 }, props: null }
};
const envTextures = new Map();
let envProps = null;
let activeEnvironment = 'grid';
let timeOfDayHours = 16.5;
let activeSkyStyle = 'natural';
let loadedHdri = null;
let hdriEnvironment = null;
let hdriLoadToken = 0;
const SKY_STYLES = {
  natural: { label: 'Natural atmosphere', turbidity: 1, rayleigh: 1, mie: 1 },
  clear: { label: 'Clear blue', turbidity: 0.32, rayleigh: 1.15, mie: 0.25 },
  hazy: { label: 'Hazy / overcast', turbidity: 1.4, rayleigh: 0.8, mie: 1.5 }
};

const TIME_OF_DAY_STOPS = [
  { hour: 0, sunLevel: 0.015, hemiLevel: 0.28, sunTint: 0x8294c4, sunMix: 0.72,
    hemiTint: 0x586b91, hemiMix: 0.7, groundTint: 0x111722, groundMix: 0.72,
    fogTint: 0x111827, fogMix: 0.85, skyTurbidity: 3 },
  { hour: 5, sunLevel: 0.015, hemiLevel: 0.28, sunTint: 0x8294c4, sunMix: 0.72,
    hemiTint: 0x586b91, hemiMix: 0.7, groundTint: 0x111722, groundMix: 0.72,
    fogTint: 0x111827, fogMix: 0.85, skyTurbidity: 3 },
  { hour: 6, sunLevel: 0.18, hemiLevel: 0.46, sunTint: 0xc5cfe3, sunMix: 0.75,
    hemiTint: 0xd0d9eb, hemiMix: 0.65, groundTint: 0x343d4c, groundMix: 0.65,
    fogTint: 0x8795aa, fogMix: 0.62, skyTurbidity: 3 },
  { hour: 7, sunLevel: 0.62, hemiLevel: 0.78, sunTint: 0xe2e7f0, sunMix: 0.5,
    hemiTint: 0xe5ebf5, hemiMix: 0.25, groundTint: 0x515b6a, groundMix: 0.3,
    fogTint: 0xc4cedc, fogMix: 0.35, skyTurbidity: 1 },
  { hour: 9, sunLevel: 0.78, hemiLevel: 0.78, sunTint: 0xffffff, sunMix: 0,
    hemiTint: 0xffffff, hemiMix: 0, groundTint: 0xffffff, groundMix: 0,
    fogTint: 0xffffff, fogMix: 0, skyTurbidity: -8 },
  { hour: 16, sunLevel: 0.78, hemiLevel: 0.78, sunTint: 0xffffff, sunMix: 0,
    hemiTint: 0xffffff, hemiMix: 0, groundTint: 0xffffff, groundMix: 0,
    fogTint: 0xffffff, fogMix: 0, skyTurbidity: -8 },
  { hour: 18, sunLevel: 0.58, hemiLevel: 0.72, sunTint: 0xe1e4ee, sunMix: 0.65,
    hemiTint: 0xd9deeb, hemiMix: 0.48, groundTint: 0x424957, groundMix: 0.55,
    fogTint: 0xaab4c4, fogMix: 0.58, skyTurbidity: 2 },
  { hour: 19, sunLevel: 0.2, hemiLevel: 0.46, sunTint: 0xb8c4dc, sunMix: 0.75,
    hemiTint: 0xaebad2, hemiMix: 0.6, groundTint: 0x242b3a, groundMix: 0.7,
    fogTint: 0x616d83, fogMix: 0.72, skyTurbidity: 1 },
  { hour: 20, sunLevel: 0.035, hemiLevel: 0.34, sunTint: 0x9a8fbc, sunMix: 0.75,
    hemiTint: 0x7584a6, hemiMix: 0.65, groundTint: 0x151b29, groundMix: 0.75,
    fogTint: 0x182033, fogMix: 0.82, skyTurbidity: 4 },
  { hour: 24, sunLevel: 0.015, hemiLevel: 0.28, sunTint: 0x8294c4, sunMix: 0.72,
    hemiTint: 0x586b91, hemiMix: 0.7, groundTint: 0x111722, groundMix: 0.72,
    fogTint: 0x111827, fogMix: 0.85, skyTurbidity: 3 }
];

function timeOfDayProfile(hour) {
  const time = Math.max(0, Math.min(24, hour));
  let index = 0;
  while (index < TIME_OF_DAY_STOPS.length - 2 && TIME_OF_DAY_STOPS[index + 1].hour < time) index++;
  const start = TIME_OF_DAY_STOPS[index], end = TIME_OF_DAY_STOPS[index + 1];
  const t = (time - start.hour) / (end.hour - start.hour);
  const profile = {};
  for (const key of Object.keys(start)) {
    if (key === 'hour') continue;
    if (key.endsWith('Tint')) {
      profile[key] = new THREE.Color(start[key]).lerp(new THREE.Color(end[key]), t);
    } else profile[key] = THREE.MathUtils.lerp(start[key], end[key], t);
  }
  return profile;
}

function formatTimeOfDay(hour) {
  const totalMinutes = Math.round(hour * 60) % (24 * 60);
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

function timeOfDayLabel(hour) {
  if (hour < 5.5 || hour >= 20) return 'Night';
  if (hour < 8) return 'Sunrise';
  if (hour < 16.5) return 'Day';
  return 'Sunset';
}

function blendHex(from, to, amount) {
  return new THREE.Color(from).lerp(new THREE.Color(to), amount).getHex();
}

async function loadHdriFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['hdr', 'exr'].includes(extension)) {
    flash('Choose an .hdr or .exr equirectangular environment image.');
    return;
  }
  const request = ++hdriLoadToken;
  const objectUrl = URL.createObjectURL(file);
  flash(`Loading ${file.name}...`);
  let texture = null;
  try {
    const module = extension === 'hdr'
      ? await import('three/examples/jsm/loaders/RGBELoader.js')
      : await import('three/examples/jsm/loaders/EXRLoader.js');
    const Loader = extension === 'hdr' ? module.RGBELoader : module.EXRLoader;
    const loader = new Loader();
    texture = await loader.loadAsync(objectUrl);
    URL.revokeObjectURL(objectUrl);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    const environment = pmremGenerator.fromEquirectangular(texture);
    if (request !== hdriLoadToken) {
      texture.dispose();
      environment.dispose();
      return;
    }
    if (loadedHdri) loadedHdri.dispose();
    if (hdriEnvironment) hdriEnvironment.dispose();
    loadedHdri = texture;
    hdriEnvironment = environment;
    scene.background = texture;
    scene.environment = environment.texture;
    sky.visible = false;
    byId('hdriName').textContent = file.name;
    flash(`Loaded HDRI "${file.name}" for the sky and material reflections.`);
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    texture?.dispose();
    if (request === hdriLoadToken) {
      console.error(`Could not load HDRI ${file.name}:`, error);
      flash(`Could not load "${file.name}". Choose a valid equirectangular .hdr or .exr file.`);
    }
  }
}

function clearHdri() {
  hdriLoadToken++;
  if (loadedHdri) loadedHdri.dispose();
  if (hdriEnvironment) hdriEnvironment.dispose();
  loadedHdri = null;
  hdriEnvironment = null;
  scene.background = null;
  scene.environment = null;
  sky.visible = true;
  byId('hdriName').textContent = 'Procedural sky';
  byId('hdriFile').value = '';
  flash('Using the procedural sky.');
}

function applyTimeOfDay(hour) {
  timeOfDayHours = Math.max(0, Math.min(24, hour));
  const env = ENVIRONMENTS[activeEnvironment] || ENVIRONMENTS.grid;
  const profile = timeOfDayProfile(timeOfDayHours);
  const skyStyle = SKY_STYLES[activeSkyStyle] || SKY_STYLES.natural;
  sun.color.setHex(blendHex(env.sun[0], profile.sunTint, profile.sunMix));
  sun.intensity = env.sun[1] * profile.sunLevel * PROCEDURAL_SKY_SETTINGS.sunIntensity;
  hemiLight.color.setHex(blendHex(env.hemi[0], profile.hemiTint, profile.hemiMix));
  hemiLight.groundColor.setHex(blendHex(env.hemi[1], profile.groundTint, profile.groundMix));
  hemiLight.intensity = env.hemi[2] * profile.hemiLevel * PROCEDURAL_SKY_SETTINGS.ambientIntensity;
  scene.fog.color.setHex(blendHex(env.fog[0], profile.fogTint, profile.fogMix));
  sky.material.uniforms.turbidity.value =
    Math.max(1, env.sky.turbidity + profile.skyTurbidity) * skyStyle.turbidity *
    PROCEDURAL_SKY_SETTINGS.turbidity;
  sky.material.uniforms.rayleigh.value =
    env.sky.rayleigh * skyStyle.rayleigh * PROCEDURAL_SKY_SETTINGS.rayleigh;
  sky.material.uniforms.mieCoefficient.value =
    env.sky.mie * skyStyle.mie * PROCEDURAL_SKY_SETTINGS.mie;
  sky.material.uniforms.mieDirectionalG.value = env.sky.g;

  const phase = (timeOfDayHours - 6) * Math.PI / 12;
  const altitude = Math.sin(phase);
  const azimuth = (timeOfDayHours - 6) * Math.PI / 12;
  const horizontal = Math.sqrt(Math.max(0, 1 - altitude * altitude));
  sunDirection.set(horizontal * Math.cos(azimuth), altitude, horizontal * Math.sin(azimuth)).normalize();
  sky.material.uniforms.sunPosition.value.copy(sunDirection);
  sun.position.copy(sunDirection).multiplyScalar(80);

  const slider = byId('timeOfDay');
  if (slider) {
    slider.value = String(timeOfDayHours);
    byId('timeOfDayValue').textContent =
      `${formatTimeOfDay(timeOfDayHours)} · ${translateText(timeOfDayLabel(timeOfDayHours), uiLanguage)}`;
  }
}

function disposeGroup(group) {
  group.traverse(o => {
    const oo = /** @type {any} */ (o); if (oo.geometry) oo.geometry.dispose();
    if (oo.material) (Array.isArray(oo.material) ? oo.material : [oo.material]).forEach(m => m.dispose());
  });
}
function scatterProps(group, make, count, minR, maxR) {
  for (let i = 0; i < count; i++) {
    const obj = make();
    const a = Math.random() * Math.PI * 2, r = minR + Math.random() * (maxR - minR);
    obj.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    obj.rotation.y = Math.random() * Math.PI * 2;
    const s = 0.8 + Math.random() * 0.7;
    obj.scale.setScalar(s);
    group.add(obj);
  }
}
function buildEnvProps(kind) {
  const group = new THREE.Group();
  const std = (color, rough = 0.9, flat = false) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: flat });
  if (kind === 'grass') {
    const trunkG = new THREE.CylinderGeometry(0.12, 0.22, 1.7, 7);
    const crownG = new THREE.IcosahedronGeometry(1.15, 0);
    const bushG = new THREE.IcosahedronGeometry(0.55, 0);
    const trunkM = std(0x6b4a2e, 0.95), leafM = std(0x3f7a26, 0.9, true), bushM = std(0x4c8a2e, 0.95, true);
    scatterProps(group, () => {
      const t = new THREE.Group();
      const trunk = new THREE.Mesh(trunkG, trunkM); trunk.position.y = 0.85; trunk.castShadow = true;
      const crown = new THREE.Mesh(crownG, leafM); crown.position.y = 2.6; crown.scale.y = 1.3; crown.castShadow = true;
      t.add(trunk, crown);
      return t;
    }, 26, 20, 55);
    scatterProps(group, () => {
      const b = new THREE.Mesh(bushG, bushM);
      b.position.y = 0.35; b.scale.y = 0.7; b.castShadow = true;
      return b;
    }, 34, 12, 55);
  } else if (kind === 'desert') {
    const rockG = new THREE.DodecahedronGeometry(0.7, 0);
    const rockM = std(0x9a8a72, 0.95, true);
    const cactusG = new THREE.CylinderGeometry(0.16, 0.2, 2.2, 8);
    const armG = new THREE.CylinderGeometry(0.1, 0.1, 0.7, 6);
    const cactusM = std(0x4a7a3a, 0.85);
    scatterProps(group, () => {
      const r = new THREE.Mesh(rockG, rockM);
      r.position.y = 0.3; r.scale.set(1, 0.6 + Math.random() * 0.5, 1); r.castShadow = true;
      return r;
    }, 24, 14, 55);
    scatterProps(group, () => {
      const c = new THREE.Group();
      const main = new THREE.Mesh(cactusG, cactusM); main.position.y = 1.1; main.castShadow = true;
      const a1 = new THREE.Mesh(armG, cactusM); a1.position.set(0.35, 1.3, 0); a1.rotation.z = -0.9; a1.castShadow = true;
      const a2 = new THREE.Mesh(armG, cactusM); a2.position.set(-0.35, 1.0, 0); a2.rotation.z = 0.9; a2.castShadow = true;
      c.add(main, a1, a2);
      return c;
    }, 12, 18, 55);
  } else if (kind === 'snow') {
    const rockG = new THREE.DodecahedronGeometry(0.7, 0);
    const rockM = std(0x8a929c, 0.9, true);
    const trunkG = new THREE.CylinderGeometry(0.1, 0.18, 1.4, 6);
    const pineG = new THREE.ConeGeometry(1.0, 2.2, 8);
    const trunkM = std(0x4a3828, 0.95), pineM = std(0xe8eef4, 0.85, true);
    scatterProps(group, () => {
      const r = new THREE.Mesh(rockG, rockM);
      r.position.y = 0.25; r.scale.set(1, 0.55, 1); r.castShadow = true;
      return r;
    }, 18, 14, 55);
    scatterProps(group, () => {
      const t = new THREE.Group();
      const trunk = new THREE.Mesh(trunkG, trunkM); trunk.position.y = 0.7;
      const pine = new THREE.Mesh(pineG, pineM); pine.position.y = 2.2; pine.castShadow = true;
      t.add(trunk, pine);
      return t;
    }, 20, 20, 55);
  }
  return group;
}
function setEnvironment(key) {
  activeEnvironment = ENVIRONMENTS[key] ? key : 'grid';
  const env = ENVIRONMENTS[activeEnvironment];
  if (env.map) {
    if (!envTextures.has(env.map)) envTextures.set(env.map, paintGroundCanvas(env.map));
    const tex = envTextures.get(env.map);
    tex.repeat.set(env.repeat, env.repeat);
    plateMesh.material.map = tex;
    plateMesh.material.color.setHex(env.ground);
  } else {
    plateMesh.material.map = null;
    plateMesh.material.color.setHex(env.ground);
  }
  plateMesh.material.roughness = env.roughness;
  plateMesh.material.needsUpdate = true;
  gridGroup.visible = env.grid;
  scene.fog.near = env.fog[1];
  scene.fog.far = env.fog[2];
  if (envProps) { groundGroup.remove(envProps); disposeGroup(envProps); envProps = null; }
  if (env.props) { envProps = buildEnvProps(env.props); groundGroup.add(envProps); }
  applyTimeOfDay(timeOfDayHours);
}

/* ================= Rapier physics world ================= */
// Bodies are created only when simulation starts; fastened blocks share one compound body.
// The -compat package (used via importmap without a bundler) requires async WASM init.
const rapierInit = Object.getOwnPropertyDescriptor(RAPIER, 'init')?.value;
if (typeof rapierInit === 'function') await rapierInit();
const rapierWorld = new RAPIER.World({ x: 0, y: -G, z: 0 });
// Higher solver iterations for stable contact resolution in tall structures.
rapierWorld.numSolverIterations = 30;
rapierWorld.integrationParameters.numSolverIterations = 30;
rapierWorld.integrationParameters.contact_natural_frequency = 60;
// More CCD substeps to prevent tunneling when blocks fall fast during collapse.
rapierWorld.integrationParameters.maxCcdSubsteps = 8;
const bodyType = { DYNAMIC: RAPIER.RigidBodyType.Dynamic, STATIC: RAPIER.RigidBodyType.Fixed,
  KINEMATIC: RAPIER.RigidBodyType.KinematicPositionBased };
const CM = Object.fromEntries([...Object.keys(MATS).map(key => [key, key]), [GROUND, GROUND]]);
const vectorProxy = (read, write) => {
  const result = {};
  for (const axis of ['x', 'y', 'z']) Object.defineProperty(result, axis, {
    enumerable: true, get: () => read()[axis], set: value => write({ ...read(), [axis]: value })
  });
  result.set = (x, y, z) => write({ x, y, z });
  result.copy = value => write({ x: value.x, y: value.y, z: value.z });
  result.clone = () => ({ ...read() });
  return result;
};
const quaternionProxy = raw => {
  const result = {};
  for (const axis of ['x', 'y', 'z', 'w']) Object.defineProperty(result, axis, {
    enumerable: true, get: () => raw.rotation()[axis]
  });
  result.set = (x, y, z, w) => raw.setRotation({ x, y, z, w }, true);
  result.copy = value => result.set(value.x, value.y, value.z, value.w);
  result.vmult = (value, target) => {
    const rotated = new THREE.Vector3(value.x, value.y, value.z)
      .applyQuaternion(new THREE.Quaternion(result.x, result.y, result.z, result.w));
    target.set(rotated.x, rotated.y, rotated.z);
    return target;
  };
  return result;
};
class RapierBody {
  /**
   * @param {{ mass?: number, type?: number, material?: string, linearDamping?: number, angularDamping?: number }} [options]
   */
  constructor({ mass = 0, type = bodyType.DYNAMIC, material = 'concrete',
                linearDamping = 0.1, angularDamping = 0.15 } = {}) {
    this.material = material;
    this.shapes = [];
    this.constraints = new Set();
    this.force = { x: 0, y: 0, z: 0 };
    this.torque = { x: 0, y: 0, z: 0 };
    this._collisionFilterGroup = 0xffff;
    this._collisionFilterMask = 0xffff;
    const descriptor = type === bodyType.STATIC ? RAPIER.RigidBodyDesc.fixed()
      : type === bodyType.KINEMATIC ? RAPIER.RigidBodyDesc.kinematicPositionBased()
        : RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true);
    this.raw = rapierWorld.createRigidBody(descriptor
      .setLinearDamping(linearDamping).setAngularDamping(angularDamping).setCanSleep(true));
    this.position = vectorProxy(() => this.raw.translation(), value => {
      if (this.raw.isKinematic()) this.raw.setNextKinematicTranslation(value);
      else this.raw.setTranslation(value, true);
    });
    this.velocity = vectorProxy(() => this.raw.linvel(), value => {
      if (this.raw.isDynamic() || this.raw.isKinematic()) this.raw.setLinvel(value, true);
    });
    this.angularVelocity = vectorProxy(() => this.raw.angvel(), value => {
      if (this.raw.isDynamic() || this.raw.isKinematic()) this.raw.setAngvel(value, true);
    });
    this.quaternion = quaternionProxy(this.raw);
  }
  get mass() { return this.raw.mass(); }
  get collisionFilterGroup() { return this._collisionFilterGroup; }
  set collisionFilterGroup(value) { this._collisionFilterGroup = value; this.updateCollisionGroups(); }
  get collisionFilterMask() { return this._collisionFilterMask; }
  set collisionFilterMask(value) { this._collisionFilterMask = value; this.updateCollisionGroups(); }
  updateCollisionGroups() {
    const groups = ((this._collisionFilterGroup << 16) | this._collisionFilterMask) >>> 0;
    for (const collider of this.shapes) collider.setCollisionGroups(groups);
  }
  get type() { return this.raw.isDynamic() ? bodyType.DYNAMIC : this.raw.isKinematic() ? bodyType.KINEMATIC : bodyType.STATIC; }
  set type(value) {
    const target = value === bodyType.DYNAMIC ? RAPIER.RigidBodyType.Dynamic
      : value === bodyType.KINEMATIC ? RAPIER.RigidBodyType.KinematicPositionBased
        : RAPIER.RigidBodyType.Fixed;
    if (this.raw.bodyType() !== target) this.raw.setBodyType(target, true);
  }
  addShape(shape, offset = { x: 0, y: 0, z: 0 }, rotation = { x: 0, y: 0, z: 0, w: 1 }, material = this.material) {
    let desc;
    if (shape.kind === 'box') {
      desc = RAPIER.ColliderDesc.cuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
    } else {
      desc = RAPIER.ColliderDesc.convexHull(new Float32Array(shape.vertices.flat()));
      if (!desc) throw new Error('Rapier could not construct a convex collider from member geometry.');
    }
    const mat = material === GROUND ? null : MATS[material];
    // Near-zero restitution so structural materials don't bounce on impact.
    desc.setTranslation(offset.x, offset.y, offset.z).setRotation(rotation)
      .setFriction(mat?.mu ?? MU_GROUND).setRestitution(0.0)
      .setDensity(shape.density ?? 1);
    desc.setCollisionGroups(((this.collisionFilterGroup << 16) | this.collisionFilterMask) >>> 0);
    const collider = rapierWorld.createCollider(desc, this.raw);
    this.shapes.push(collider);
    return collider;
  }
  removeShape(collider) {
    const index = this.shapes.indexOf(collider);
    if (index >= 0) this.shapes.splice(index, 1);
    rapierWorld.removeCollider(collider, true);
  }
  setTranslation(value) { this.raw.setTranslation(value, true); }
  setNextKinematicTranslation(value) { this.raw.setNextKinematicTranslation(value); }
  setNextKinematicRotation(value) { this.raw.setNextKinematicRotation(value); }
  pointToLocalFrame(point) {
    const pos = new THREE.Vector3(point.x, point.y, point.z)
      .sub(new THREE.Vector3(this.position.x, this.position.y, this.position.z))
      .applyQuaternion(new THREE.Quaternion(this.quaternion.x, this.quaternion.y, this.quaternion.z, this.quaternion.w).invert());
    return { x: pos.x, y: pos.y, z: pos.z };
  }
  pointToWorldFrame(point) {
    const pos = new THREE.Vector3(point.x, point.y, point.z)
      .applyQuaternion(new THREE.Quaternion(this.quaternion.x, this.quaternion.y, this.quaternion.z, this.quaternion.w))
      .add(new THREE.Vector3(this.position.x, this.position.y, this.position.z));
    return { x: pos.x, y: pos.y, z: pos.z };
  }
  wakeUp() { this.raw.wakeUp(); }
  applyAccumulatedForces() {
    if (this.raw.isDynamic()) {
      if (this.force.x || this.force.y || this.force.z) this.raw.addForce(this.force, true);
      if (this.torque.x || this.torque.y || this.torque.z) this.raw.addTorque(this.torque, true);
    }
    this.force.x = this.force.y = this.force.z = 0;
    this.torque.x = this.torque.y = this.torque.z = 0;
  }
}
class RapierJoint {
  constructor(bodyA, bodyB, anchorA, anchorB, contactsEnabled = true) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    this.raw = rapierWorld.createImpulseJoint(
      RAPIER.JointData.spherical(anchorA, anchorB), bodyA.raw, bodyB.raw, true
    );
    this.raw.setContactsEnabled(contactsEnabled);
    bodyA.constraints.add(this);
    bodyB.constraints.add(this);
  }
}
const world = {
  bodies: [], constraints: [], contacts: [],
  addBody(body) { if (!this.bodies.includes(body)) this.bodies.push(body); },
  removeBody(body) {
    if (!this.bodies.includes(body)) return;
    for (const joint of [...body.constraints]) this.removeConstraint(joint);
    rapierWorld.removeRigidBody(body.raw);
    body.shapes.length = 0;
    this.bodies.splice(this.bodies.indexOf(body), 1);
  },
  addConstraint(joint) {
    if (!this.constraints.includes(joint)) this.constraints.push(joint);
  },
  removeConstraint(joint) {
    if (!this.constraints.includes(joint)) return;
    rapierWorld.removeImpulseJoint(joint.raw, true);
    joint.bodyA.constraints.delete(joint);
    joint.bodyB.constraints.delete(joint);
    this.constraints.splice(this.constraints.indexOf(joint), 1);
  },
  step(dt) {
    rapierWorld.timestep = dt;
    for (const body of this.bodies) body.applyAccumulatedForces();
    rapierWorld.step();
    this.collectContacts();
  },
  collectContacts() {
    this.contacts.length = 0;
    const visited = new Set();
    const vector = new RAPIER.Vector3(0, 0, 0);
    for (const bodyA of this.bodies) for (const shapeA of bodyA.shapes) {
      rapierWorld.contactPairsWith(shapeA, shapeB => {
        const key = `${Math.min(shapeA.handle, shapeB.handle)}:${Math.max(shapeA.handle, shapeB.handle)}`;
        if (visited.has(key)) return;
        visited.add(key);
        const bodyB = this.bodies.find(candidate => candidate.shapes.includes(shapeB));
        if (!bodyB || bodyA === bodyB) return;
        rapierWorld.contactPair(shapeA, shapeB, (manifold, flipped) => {
          if (!manifold.numContacts()) return;
          const normalValue = manifold.normal(vector);
          const normal = { x: normalValue.x, y: normalValue.y, z: normalValue.z };
          const point = manifold.numSolverContacts() ? manifold.solverContactPoint(0)
            : manifold.localContactPoint1(0, vector);
          if (!point) return;
          let worldPoint = point;
          if (!manifold.numSolverContacts()) {
            const pointShape = flipped ? shapeB : shapeA;
            const translation = pointShape.translation();
            const rotation = pointShape.rotation();
            worldPoint = new THREE.Vector3(point.x, point.y, point.z)
              .applyQuaternion(new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w))
              .add(new THREE.Vector3(translation.x, translation.y, translation.z));
          }
          const p = { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z };
          const firstBody = flipped ? bodyB : bodyA, secondBody = flipped ? bodyA : bodyB;
          const firstShape = flipped ? shapeB : shapeA, secondShape = flipped ? shapeA : shapeB;
          const firstNormal = flipped ? { x: -normal.x, y: -normal.y, z: -normal.z } : normal;
          this.contacts.push({
            bi: firstBody, bj: secondBody, si: firstShape, sj: secondShape,
            ri: { x: p.x - firstBody.position.x, y: p.y - firstBody.position.y, z: p.z - firstBody.position.z },
            rj: { x: p.x - secondBody.position.x, y: p.y - secondBody.position.y, z: p.z - secondBody.position.z },
            ni: firstNormal
          })
        });
      });
    }
  }
};
const makeBoxShape = (halfExtents, density = 1) => ({ kind: 'box', halfExtents, density });
const makeConvexShape = (vertices, density) => ({ kind: 'convex', vertices, density });
const plateBody = new RapierBody({ type: bodyType.STATIC, material: GROUND });
plateBody.addShape(makeBoxShape({ x: GROUND_HALF, y: 0.05, z: GROUND_HALF }), undefined, undefined, GROUND);
plateBody.position.set(0, -0.05, 0);
world.addBody(plateBody);
const debris = [];

/* ================= convex geometry ================= */
// Vertex i has bits: bit0 = +x, bit1 = +y, bit2 = +z. Faces are listed in cyclic order.
const FACES = [[0, 2, 6, 4], [1, 5, 7, 3], [0, 4, 5, 1], [2, 3, 7, 6], [0, 1, 3, 2], [4, 6, 7, 5]];

function boxVerts(size) {
  const [w, h, d] = size, out = [];
  for (let i = 0; i < 8; i++) out.push([
    (i % 2 ? 1 : -1) * w / 2,
    (Math.floor(i / 2) % 2 ? 1 : -1) * h / 2,
    (Math.floor(i / 4) % 2 ? 1 : -1) * d / 2
  ]);
  return out;
}
function cylinderVerts(radius, height, sides = 12) {
  const r = radius, h = height / 2, out = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push([Math.cos(a) * r, -h, Math.sin(a) * r]);
  }
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push([Math.cos(a) * r, h, Math.sin(a) * r]);
  }
  return out;
}
function sphereVerts(radius, segments = 12) {
  const out = [];
  const rings = Math.max(3, Math.floor(segments / 2));
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI;
    const y = Math.cos(phi) * radius;
    const r = Math.sin(phi) * radius;
    const segs = Math.max(3, Math.round(segments * Math.sin(phi)));
    for (let j = 0; j < segs; j++) {
      const theta = (j / segs) * Math.PI * 2;
      out.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
    }
  }
  return out;
}
function coneVerts(radius, height, sides = 12) {
  const r = radius, h = height / 2, out = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    out.push([Math.cos(a) * r, -h, Math.sin(a) * r]);
  }
  out.push([0, h, 0]);
  return out;
}
function wedgeVerts(w, h, d) {
  // Right-triangular prism: full height at z = -d/2, tapering down to the bottom at z = +d/2.
  const hw = w / 2, hh = h / 2, hd = d / 2;
  return [
    [-hw, -hh, -hd], [hw, -hh, -hd], [-hw, -hh, hd], [hw, -hh, hd],
    [-hw, hh, -hd], [hw, hh, -hd]
  ];
}
function shapeVolume(verts) {
  // Compute volume from the convex hull; invalid/degenerate geometry has no volume.
  let hull;
  try {
    const points = verts.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    hull = new ConvexGeometry(points);
    const pos = hull.getAttribute('position');
    const index = hull.getIndex();
    let vol = 0;
    const tri = (a, b, c) => {
      const v0 = new THREE.Vector3().fromBufferAttribute(pos, a);
      const v1 = new THREE.Vector3().fromBufferAttribute(pos, b);
      const v2 = new THREE.Vector3().fromBufferAttribute(pos, c);
      vol += v0.dot(new THREE.Vector3().crossVectors(v1, v2)) / 6;
    };
    if (index) {
      for (let i = 0; i < index.count; i += 3) tri(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    } else {
      for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
    }
    return Number.isFinite(vol) ? Math.abs(vol) : 0;
  } catch (error) {
    return 0;
  } finally {
    hull?.dispose();
  }
}
function shapeVerts(shape, size) {
  const [w, h, d] = size;
  if (shape === 'cylinder') return cylinderVerts(Math.min(w, d) / 2, h, 64);
  if (shape === 'sphere') return sphereVerts(Math.min(w, h, d) / 2, 32);
  if (shape === 'cone') return coneVerts(Math.min(w, d) / 2, h, 64);
  if (shape === 'wedge') return wedgeVerts(w, h, d);
  return boxVerts(size);
}
function smoothConvexGeometry(verts) {
  const geometry = new ConvexGeometry(verts.map(point => new THREE.Vector3(...point)));
  const smooth = toCreasedNormals(geometry, Math.PI / 6);
  if (smooth !== geometry) geometry.dispose();
  return smooth;
}
const _hullAxisCache = new WeakMap();
function hullAxes(verts) {
  let axes = _hullAxisCache.get(verts);
  if (axes) return axes;
  axes = [];
  try {
    const g = new ConvexGeometry(verts.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    const pos = g.getAttribute('position'), idx = g.getIndex();
    const seen = new Set();
    const tri = (a, b, c) => {
      const A = new THREE.Vector3().fromBufferAttribute(pos, a);
      const B = new THREE.Vector3().fromBufferAttribute(pos, b);
      const C = new THREE.Vector3().fromBufferAttribute(pos, c);
      const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
      if (n.lengthSq() < 1e-12) return;
      n.normalize();
      const key = `${n.x.toFixed(3)},${n.y.toFixed(3)},${n.z.toFixed(3)}`;
      if (!seen.has(key)) { seen.add(key); axes.push(n); }
    };
    if (idx) for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    else for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
    g.dispose();
  } catch (e) { /* leave axes empty */ }
  _hullAxisCache.set(verts, axes);
  return axes;
}
function mutableVector(x = 0, y = 0, z = 0) {
  return { x, y, z, set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; },
    copy(value) { this.set(value.x, value.y, value.z); } };
}
const _orientedFacesCache = new WeakMap();
function orientFaces(V) {
  if (!isAxisAlignedBox(V)) {
    // Non-box shapes (wedge, cylinder, sphere, cone): derive faces from the convex hull.
    let faces = _orientedFacesCache.get(V);
    if (faces) return faces;
    faces = [];
    try {
      const g = new ConvexGeometry(V.map(p => new THREE.Vector3(p[0], p[1], p[2])));
      const pos = g.getAttribute('position'), idx = g.getIndex();
      const c = new THREE.Vector3();
      V.forEach(p => c.add(v3(p)));
      c.multiplyScalar(1 / V.length);
      const maxCoordinate = Math.max(...V.flatMap(p => p.map(Math.abs)));
      const tolerance = Math.max(1e-7, maxCoordinate * 2e-7);
      const bucketOf = p => [p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]]
        .map(value => Math.floor(value / tolerance));
      const bucketKey = bucket => bucket.join(':');
      const vertexBuckets = new Map();
      V.forEach((point, index) => {
        const key = bucketKey(bucketOf(point));
        if (!vertexBuckets.has(key)) vertexBuckets.set(key, []);
        vertexBuckets.get(key).push(index);
      });
      const at = i => {
        const p = new THREE.Vector3().fromBufferAttribute(pos, i);
        const bucket = bucketOf(p), toleranceSq = tolerance * tolerance;
        let vi = null, nearest = toleranceSq;
        for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
          for (const candidate of vertexBuckets.get(bucketKey([bucket[0] + x, bucket[1] + y, bucket[2] + z])) || []) {
            const distanceSq = p.distanceToSquared(v3(V[candidate]));
            if (distanceSq <= nearest) { nearest = distanceSq; vi = candidate; }
          }
        }
        return { p, vi };
      };
      const tri = (a, b, d) => {
        const A = at(a), B = at(b), C = at(d);
        if (A.vi == null || B.vi == null || C.vi == null) return;
        const n = new THREE.Vector3().subVectors(B.p, A.p).cross(new THREE.Vector3().subVectors(C.p, A.p));
        if (n.lengthSq() < 1e-12) return;
        const fc = A.p.clone().add(B.p).add(C.p).multiplyScalar(1 / 3);
        faces.push(n.dot(fc.clone().sub(c)) < 0 ? [A.vi, C.vi, B.vi] : [A.vi, B.vi, C.vi]);
      };
      if (idx) for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
      else for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
      g.dispose();
    } catch (e) { faces = []; }
    _orientedFacesCache.set(V, faces);
    return faces;
  }
  const c = new THREE.Vector3();
  V.forEach(p => c.add(v3(p)));
  c.multiplyScalar(1 / V.length);
  return FACES.map(f => {
    const p = f.map(i => v3(V[i]));
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
    const fc = p.reduce((s, q) => s.add(q), new THREE.Vector3()).multiplyScalar(0.25);
    return n.dot(fc.clone().sub(c)) < 0 ? [...f].reverse() : f;
  });
}
// Exact volume of a closed polyhedron (divergence theorem, sum of signed tetrahedra).
function volumeOf(V, F) {
  let v = 0;
  for (const f of F) for (let k = 1; k < f.length - 1; k++) {
    const a = V[f[0]], b = V[f[k]], c = V[f[k + 1]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return Number.isFinite(v) ? Math.abs(v) : 0;
}
function isAxisAlignedBox(verts) {
  if (verts.length !== 8) return false;
  const mins = [0, 1, 2].map(axis => Math.min(...verts.map(p => p[axis])));
  const maxs = [0, 1, 2].map(axis => Math.max(...verts.map(p => p[axis])));
  return verts.every((point, index) => point.every((value, axis) =>
    Math.abs(value - ((Math.floor(index / (2 ** axis)) % 2) ? maxs[axis] : mins[axis])) <= 1e-9));
}
function geometryVolume(verts) {
  if (isAxisAlignedBox(verts)) {
    const spans = [0, 1, 2].map(axis =>
      Math.max(...verts.map(p => p[axis])) - Math.min(...verts.map(p => p[axis])));
    return spans.reduce((volume, span) => volume * span, 1);
  }
  return shapeVolume(verts);
}
function finiteTriplet(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}
function validPose(pos, rot) {
  return finiteTriplet(pos) && finiteTriplet(rot) &&
    pos.every(value => Math.abs(value) <= 1e6) &&
    rot.every(value => Math.abs(value) <= 360000);
}
function validGeometry(verts) {
  if (!Array.isArray(verts) || verts.length < 4 || verts.length > 4096 ||
    verts.some(point => !finiteTriplet(point) ||
      point.some(value => Math.abs(value) > 1e6))) return false;
  const spans = [0, 1, 2].map(axis =>
    Math.max(...verts.map(p => p[axis])) - Math.min(...verts.map(p => p[axis])));
  const volume = geometryVolume(verts);
  return spans.every(span => Number.isFinite(span) && span > 1e-6) &&
    Number.isFinite(volume) && volume >= MIN_GEOMETRY_VOLUME;
}
function boundedLoad(value) {
  return Number.isFinite(value) ? Math.min(MAX_BLOCK_MASS * G, Math.max(0, value)) : MAX_BLOCK_MASS * G;
}
function stressFromLoad(load, area) {
  const stress = Math.max(0, load) / Math.max(MIN_SECTION_AREA, area);
  return Number.isFinite(stress) ? Math.min(MAX_SCREEN_STRESS, stress) : MAX_SCREEN_STRESS;
}
function factorOfSafety(capacity, demand) {
  if (!Number.isFinite(capacity) || capacity < 0) capacity = 0;
  if (!Number.isFinite(demand) || demand < 0) demand = MAX_SCREEN_STRESS;
  if (demand === 0) return MAX_SCREEN_RATIO;
  return Math.min(MAX_SCREEN_RATIO, capacity / demand);
}
function demandCapacityRatio(demand, capacity) {
  if (!Number.isFinite(demand) || demand < 0) demand = MAX_SCREEN_STRESS;
  if (!Number.isFinite(capacity) || capacity <= 0) return demand > 0 ? MAX_SCREEN_RATIO : 0;
  return Math.min(MAX_SCREEN_RATIO, demand / capacity);
}
function centroidOf(V, F) {
  let volume6 = 0;
  const c = new THREE.Vector3();
  for (const f of F) for (let k = 1; k < f.length - 1; k++) {
    const a = v3(V[f[0]]), b = v3(V[f[k]]), d = v3(V[f[k + 1]]);
    const v6 = a.dot(new THREE.Vector3().crossVectors(b, d));
    volume6 += v6;
    c.addScaledVector(a.add(b).add(d), v6 / 4);
  }
  if (Math.abs(volume6) < 1e-12) return new THREE.Vector3();
  return c.multiplyScalar(1 / volume6);
}
// Valid if every vertex is on the inside of every face (convexity) and the volume is positive.
function convexOK(V) {
  const F = orientFaces(V);
  for (const f of F) {
    const p0 = v3(V[f[0]]);
    const n = new THREE.Vector3().subVectors(v3(V[f[1]]), p0).cross(new THREE.Vector3().subVectors(v3(V[f[2]]), p0));
    if (n.lengthSq() < 1e-12) return false;
    n.normalize();
    for (const q of V) if (n.dot(v3(q).sub(p0)) > 1e-5) return false;
  }
  return volumeOf(V, F) > 1e-6;
}
function recalcSize(b) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of b.verts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
  b.size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
}
// Keep the origin at the bounding-box center.
function recenter(b) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of b.verts) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
  const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  if (Math.hypot(...c) < 1e-9) return;
  b.verts.forEach(p => { p[0] -= c[0]; p[1] -= c[1]; p[2] -= c[2]; });
  const w = v3(c).applyQuaternion(quatOf(b.rot));
  b.pos = [b.pos[0] + w.x, b.pos[1] + w.y, b.pos[2] + w.z];
}
function quatOf(rot) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'));
}

/* ================= exact overlap tests (separating axis theorem) ================= */
function shapeWorld(s) {
  const q = quatOf(s.rot), P = v3(s.pos);
  return s.verts.map(p => v3(p).applyQuaternion(q).add(P));
}
// True if the interiors intersect. Faces that only touch are not an overlap.
function overlapShapes(sa, sb) {
  const EPS = 0.002;
  const A = shapeWorld(sa), B = shapeWorld(sb);
  for (let k = 0; k < 3; k++) {
    const a0 = Math.min(...A.map(p => p.getComponent(k))), a1 = Math.max(...A.map(p => p.getComponent(k)));
    const b0 = Math.min(...B.map(p => p.getComponent(k))), b1 = Math.max(...B.map(p => p.getComponent(k)));
    if (Math.min(a1, b1) - Math.max(a0, b0) <= EPS) return false;
  }
  const axes = [];
  const faceAxes = W => {
    for (const f of FACES) {
      const n = new THREE.Vector3().subVectors(W[f[1]], W[f[0]]).cross(new THREE.Vector3().subVectors(W[f[2]], W[f[0]]));
      if (n.lengthSq() > 1e-14) axes.push(n.normalize());
    }
  };
  const boxA = isAxisAlignedBox(sa.verts), boxB = isAxisAlignedBox(sb.verts);
  const hullWorldAxes = s => {
    const q = quatOf(s.rot);
    for (const n of hullAxes(s.verts)) axes.push(n.clone().applyQuaternion(q));
  };
  if (boxA) faceAxes(A); else hullWorldAxes(sa);
  if (boxB) faceAxes(B); else hullWorldAxes(sb);
  if (boxA && boxB) {
    const edgesOf = W => [new THREE.Vector3().subVectors(W[1], W[0]), new THREE.Vector3().subVectors(W[2], W[0]), new THREE.Vector3().subVectors(W[4], W[0])];
    const ea = edgesOf(A), eb = edgesOf(B);
    for (const x of ea) for (const y of eb) {
      const c = new THREE.Vector3().crossVectors(x, y);
      if (c.lengthSq() > 1e-14) axes.push(c.normalize());
    }
  }
  for (const n of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of A) { const d = p.dot(n); if (d < a0) a0 = d; if (d > a1) a1 = d; }
    for (const p of B) { const d = p.dot(n); if (d < b0) b0 = d; if (d > b1) b1 = d; }
    if (Math.min(a1, b1) - Math.max(a0, b0) <= EPS) return false;
  }
  return true;
}
// Returns 'ground', the block it overlaps, or null. self is excluded.
function shapeBlocked(sh, self, ignored = null) {
  const worldY = shapeWorld(sh).map(p => p.y);
  const minY = Math.min(...worldY), maxY = Math.max(...worldY);
  if ((!sh.foundation && minY < -0.001) || (sh.foundation && (minY < -10 || maxY > 0.02))) return 'ground';
  if (sh.foundation) {
    const worldVerts = shapeWorld(sh);
    if (worldVerts.some(p => Math.abs(p.x) > GROUND_HALF || Math.abs(p.z) > GROUND_HALF)) return 'ground';
  }
  for (const x of blocks) {
    if (x !== self && x.alive && !ignored?.has(x) && overlapShapes(sh, x)) return x;
  }
  return null;
}
function blockedBy(b) { return shapeBlocked({ verts: b.verts, pos: b.pos, rot: b.rot, foundation: b.foundation }, b); }

// A plan is valid if none of its new or resized shapes overlap an existing block, the ground, or each other.
function planFree(plan) {
  const shapes = [], self = new Set();
  const ignoredBlocks = plan.ignoreBlocks || new Set();
  for (const move of plan.moves || []) {
    if (!move.b?.alive || !blocks.includes(move.b) || self.has(move.b) ||
      !finiteTriplet(move.delta)) return false;
    const pos = move.b.pos.map((value, axis) => value + move.delta[axis]);
    if (!validPose(pos, move.b.rot)) return false;
    self.add(move.b);
    shapes.push({
      verts: move.b.verts, pos, rot: move.b.rot, foundation: move.b.foundation,
      moved: true, delta: move.delta
    });
  }
  for (const r of plan.resizes || []) {
    if (!r.b?.alive || !blocks.includes(r.b) || self.has(r.b) ||
      !Array.isArray(r.target) || r.target.length !== 3 ||
      !r.target.every(value => Number.isFinite(value) && value > 1e-6 && value <= 12) ||
      !canResize(r.b, r.target)) return false;
    const resized = resizedShape(r.b, r.target);
    self.add(r.b);
    shapes.push({ ...resized, foundation: r.b.foundation });
  }
  for (const c of plan.creates || []) {
    const verts = c.verts ?? (Array.isArray(c.size) && c.size.length === 3 &&
    c.size.every(value => Number.isFinite(value) && value > 1e-6) ? boxVerts(c.size) : null);
    if (!MATS[c.mat] || !validPose(c.pos, c.rot) ||
      !verts || !validGeometry(verts)) return false;
    const mass = MATS[c.mat].rho * geometryVolume(verts);
    if (!Number.isFinite(mass) || mass <= 0 || mass > MAX_BLOCK_MASS) return false;
    shapes.push({ verts, pos: c.pos, rot: c.rot, foundation: !!c.foundation });
  }
  for (const s of shapes) {
    if (!validGeometry(s.verts) || !finiteTriplet(s.pos) || !finiteTriplet(s.rot)) return false;
    for (let ax = 0; ax < 3; ax++) {
      const span = Math.max(...s.verts.map(p => p[ax])) - Math.min(...s.verts.map(p => p[ax]));
      if (span > 12) return false;
    }
    const worldY = shapeWorld(s).map(p => p.y);
    const minY = Math.min(...worldY), maxY = Math.max(...worldY);
    if ((!s.foundation && minY < -0.001) || (s.foundation && (minY < -10 || maxY > 0.02))) return false;
    if (s.foundation && shapeWorld(s).some(p => Math.abs(p.x) > GROUND_HALF || Math.abs(p.z) > GROUND_HALF)) return false;
  }
  const others = blocks.filter(b => b.alive && !self.has(b) && !ignoredBlocks.has(b));
  for (let i = 0; i < shapes.length; i++) {
    for (const b of others) if (overlapShapes(shapes[i], b)) return false;
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i], b = shapes[j];
      const sameTranslation = a.moved && b.moved &&
        a.delta.every((value, axis) => value === b.delta[axis]);
      if (!sameTranslation && overlapShapes(a, b)) return false;
    }
  }
  return true;
}

// Resize keeping the bottom face in place (suggestions and the inspector).
function resizedShape(b, target) {
  const bottom = b.pos[1] + Math.min(...b.verts.map(p => p[1]));
  const r = target.map((t, i) => b.size[i] > 1e-9 ? t / b.size[i] : 1);
  const verts = b.verts.map(p => [p[0] * r[0], p[1] * r[1], p[2] * r[2]]);
  const pos = [...b.pos];
  pos[1] = bottom - Math.min(...verts.map(p => p[1]));
  return { verts, pos, rot: [...b.rot] };
}
// Resize holding one face still (gizmo scale). keepLow holds the low face, otherwise the high face.
function anchoredShape(o, target, i, keepLow) {
  const r = target.map((t, k) => o.size[k] > 1e-9 ? t / o.size[k] : 1);
  const verts = o.verts.map(p => [p[0] * r[0], p[1] * r[1], p[2] * r[2]]);
  const pos = [...o.pos];
  if (keepLow) pos[i] = (o.pos[i] + Math.min(...o.verts.map(p => p[i]))) - Math.min(...verts.map(p => p[i]));
  else pos[i] = (o.pos[i] + Math.max(...o.verts.map(p => p[i]))) - Math.max(...verts.map(p => p[i]));
  return { verts, pos, rot: [...o.rot] };
}
function canResize(b, target) {
  if (!Array.isArray(target) || target.length !== 3 ||
    !target.every(value => Number.isFinite(value) && value > 1e-6)) return false;
  const resized = resizedShape(b, target);
  const mass = MATS[b.mat].rho * geometryVolume(resized.verts);
  return validGeometry(resized.verts) && Number.isFinite(mass) &&
    mass > 0 && mass <= MAX_BLOCK_MASS;
}
function setSizes(b, target) {
  if (!canResize(b, target)) return false;
  const s = resizedShape(b, target);
  b.verts = s.verts;
  b.pos = s.pos;
  sync(b);
  if (b.shearLinks) refreshShearLinkHardware(b);
  return true;
}
function executePlan(plan) {
  if ((!plan.moves || !plan.moves.length) && (!plan.resizes || !plan.resizes.length) &&
    (!plan.creates || !plan.creates.length)) return false;
  if (!planFree(plan)) return false;
  if (!autoStabilizing || !autoUndoCaptured) {
    pushUndo();
    autoUndoCaptured = true;
  }
  const resizedFrameBlocks = (plan.resizes || []).map(resize => resize.b).filter(block => block.frame);
  if (resizedFrameBlocks.length) invalidateFrameModel(resizedFrameBlocks);
  const movedFrameBlocks = (plan.moves || []).map(move => move.b).filter(block => block.frame);
  if (movedFrameBlocks.length) invalidateFrameModel(movedFrameBlocks);
  for (const move of plan.moves || []) {
    move.b.pos = move.b.pos.map((value, axis) => value + move.delta[axis]);
    sync(move.b);
  }
  for (const r of plan.resizes || []) setSizes(r.b, r.target);
  for (const c of plan.creates || []) makeBlock({
    mat: c.mat, size: c.size, verts: c.verts, pos: c.pos, rot: c.rot, ties: c.ties,
    foundation: c.foundation, shearKey: c.shearKey, suggestedBearing: c.suggestedBearing,
    suggestionConnection: c.suggestionConnection, frame: c.frame
  }, true);
  return true;
}

function animateBlockIn(mesh) {
  const materials = [];
  const baseScale = mesh.scale.clone();
  mesh.traverse(object => {
    const material = object.material;
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      materials.push({ material: item, opacity: item.opacity, transparent: item.transparent, depthWrite: item.depthWrite });
      item.transparent = true;
      item.depthWrite = false;
      item.opacity = 0;
    }
  });
  mesh.scale.copy(baseScale).multiplyScalar(0.76);
  const start = performance.now(), duration = 420;
  const tick = now => {
    const progress = Math.min(1, (now - start) / duration);
    const overshoot = 1.70158, shifted = progress - 1;
    const scaleEase = 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
    const opacityEase = progress * progress * (3 - 2 * progress);
    mesh.scale.copy(baseScale).multiplyScalar(0.76 + scaleEase * 0.24);
    for (const entry of materials) entry.material.opacity = entry.opacity * opacityEase;
    if (progress < 1) requestAnimationFrame(tick);
    else for (const entry of materials) {
      entry.material.opacity = entry.opacity;
      entry.material.transparent = entry.transparent;
      entry.material.depthWrite = entry.depthWrite;
      entry.material.needsUpdate = true;
    }
  };
  requestAnimationFrame(tick);
}

function animateBlockOut(mesh) {
  const cloneObject = source => {
    const material = Array.isArray(source.material)
      ? source.material.map(item => item.clone())
      : source.material?.clone() || null;
    const copy = source.isMesh ? new THREE.Mesh(source.geometry.clone(), material)
      : source.isLineSegments ? new THREE.LineSegments(source.geometry.clone(), material)
        : source.isLine ? new THREE.Line(source.geometry.clone(), material)
          : new THREE.Group();
    copy.position.copy(source.position);
    copy.quaternion.copy(source.quaternion);
    copy.scale.copy(source.scale);
    copy.visible = source.visible;
    copy.renderOrder = source.renderOrder;
    copy.castShadow = source.castShadow;
    copy.receiveShadow = source.receiveShadow;
    copy.frustumCulled = source.frustumCulled;
    copy.raycast = () => {};
    for (const child of source.children) copy.add(cloneObject(child));
    return copy;
  };
  const ghost = cloneObject(mesh);
  const materials = [], geometries = [];
  ghost.traverse(object => {
    if (object.geometry) geometries.push(object.geometry);
    for (const item of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      materials.push({ material: item, opacity: item.opacity });
      item.transparent = true;
      item.depthWrite = false;
    }
  });
  scene.add(ghost);
  const baseScale = mesh.scale.clone();
  const start = performance.now(), duration = 360;
  const tick = now => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = progress * progress * (3 - 2 * progress);
    ghost.scale.copy(baseScale).multiplyScalar(1 - eased * 0.32);
    for (const entry of materials) entry.material.opacity = entry.opacity * (1 - eased);
    if (progress < 1) requestAnimationFrame(tick);
    else {
      scene.remove(ghost);
      for (const entry of materials) entry.material.dispose();
      for (const geometry of geometries) geometry.dispose();
    }
  };
  requestAnimationFrame(tick);
}

/* ================= blocks ================= */
function makeBlock(o, animate = false) {
  const m = MATS[o.mat];
  if (!m || !validPose(o.pos, o.rot) || (o.ties != null && !Array.isArray(o.ties)) ||
    (o.id != null && (!Number.isSafeInteger(o.id) || o.id < 1 || o.id === Number.MAX_SAFE_INTEGER))) {
    throw new TypeError('Block requires a valid material and finite position/rotation.');
  }
  const sourceVerts = o.verts ?? (Array.isArray(o.size) && o.size.length === 3 &&
  o.size.every(value => Number.isFinite(value) && value > 1e-6) ? boxVerts(o.size) : null);
  if (!sourceVerts || !validGeometry(sourceVerts) ||
    sourceVerts.some(point => Math.max(...point.map(Math.abs)) > 1e6)) {
    throw new TypeError('Block geometry must be finite, convex, and have positive volume.');
  }
  const verts = sourceVerts.map(p => [...p]);
  const mass = m.rho * geometryVolume(verts);
  if (!Number.isFinite(mass) || mass <= 0 || mass > MAX_BLOCK_MASS) {
    throw new RangeError('Block mass must be finite, positive, and within the model limit.');
  }
  const foundation = !!o.foundation;
  const glass = m.fam === 'glass';
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), createMaterialVisual(o.mat, {
    transparent: foundation || glass, opacity: foundation ? 0.42 : glass ? 0.38 : 1,
    depthWrite: !foundation && !glass, depthTest: !foundation
  }));
  if (foundation) mesh.renderOrder = 2;
  else if (glass) mesh.renderOrder = 1;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
    color: 0x000000, transparent: true, opacity: foundation ? 0.8 : glass ? 0.18 : 0.35, depthTest: !foundation
  }));
  if (foundation) edges.renderOrder = 3;
  mesh.add(edges);
  const b = { id: o.id ?? nextId++, mat: o.mat, verts, pos: [...o.pos], rot: [...o.rot], size: [0, 0, 0],
    mass, mesh, alive: true, yielded: false, plasticStrain: 0, plasticOffset: 0,
    broken: false, overstressSteps: 0, failureMode: '', stress: 0, flexStress: 0, load: 0, fos: MAX_SCREEN_RATIO, minY: 0,
    seismic: null, ties: o.ties ? o.ties.map(t => ({ ...t })) : [], foundation,
    shearKey: !!o.shearKey, suggestedBearing: !!o.suggestedBearing,
    suggestionConnection: !!o.suggestionConnection,
    learnedRetrofitRiskRatio: o.learnedRetrofitRiskRatio || 0,
    frame: copyFrameMetadata(o.frame),
    shearLinks: o.shearLinks ? { ...o.shearLinks } : null,
    shearRatio: 0, shearStress: 0,
    frameDamage: 0, frameFailed: false, body: null, rel: null };
  if (b.id >= nextId) nextId = b.id + 1;
  recalcSize(b);
  mesh.userData.block = b;
  try {
    sync(b);
    if (b.frame?.role === 'brace' && b.frame.endpoints?.length === 2) {
      addBraceAnchorHardware(b);
    }
    if (b.shearLinks) addShearLinkHardware(b);
  } catch (error) {
    mesh.geometry.dispose();
    disposeMaterialMaps(mesh.material);
    mesh.material.dispose();
    edges.geometry.dispose();
    edges.material.dispose();
    throw error;
  }
  scene.add(mesh);
  blocks.push(b);
  if (animate) animateBlockIn(mesh);
  if (b.foundation) excavationDirty = true;
  return b;
}

function addShearLinkHardware(block) {
  const { diameter, spacing, endSpacing } = block.shearLinks;
  const { section, core: tieSection, axis, crossAxes } = shearLinkCoreSection(block);
  if (section.length < 3) throw new TypeError('Shear links require a valid column cross-section.');
  const minAxial = Math.min(...block.verts.map(point => point[axis]));
  const maxAxial = Math.max(...block.verts.map(point => point[axis]));
  const length = maxAxial - minAxial;
  if (tieSection.length < 3 || polygonArea(tieSection) <= 1e-6) {
    throw new RangeError('The selected column is too small for the configured clear cover.');
  }
  const endCover = Math.min(0.1, length * 0.05);
  const first = minAxial + endCover;
  const last = maxAxial - endCover;
  const sectionWidth = Math.max(...tieSection.map(point => point[0])) -
    Math.min(...tieSection.map(point => point[0]));
  const sectionDepth = Math.max(...tieSection.map(point => point[1])) -
    Math.min(...tieSection.map(point => point[1]));
  const endZone = Math.min(length * 0.25, Math.max(0.15, 0.75 * Math.max(sectionWidth, sectionDepth)));
  const endSpacingValue = endSpacing || Math.max(0.06, Math.min(spacing * 0.5, spacing));
  const positions = [first];
  const appendSpaced = (start, end, interval) => {
    let y = start;
    while (y + interval < end - 1e-5 && positions.length < 500) {
      y += interval;
      positions.push(y);
    }
    if (end > positions[positions.length - 1] + 1e-5 && positions.length < 500) positions.push(end);
  };
  const bottomEnd = Math.min(last, first + endZone);
  const topStart = Math.max(bottomEnd, last - endZone);
  appendSpaced(first, bottomEnd, endSpacingValue);
  appendSpaced(bottomEnd, topStart, spacing);
  appendSpaced(topStart, last, endSpacingValue);

  const material = new THREE.MeshStandardMaterial({
    color: MATS.steel.color, metalness: MATS.steel.metalness, roughness: MATS.steel.roughness,
    depthTest: false, depthWrite: false
  });
  const geometry = new THREE.CylinderGeometry(diameter / 2, diameter / 2, 1, 8);
  const group = new THREE.Group();
  group.renderOrder = 4;
  const addBar = (from, to) => {
    const a = new THREE.Vector3(from[0], from[1], from[2]);
    const b = new THREE.Vector3(to[0], to[1], to[2]);
    const delta = b.clone().sub(a);
    if (delta.lengthSq() < 1e-10) return;
    const bar = new THREE.Mesh(geometry, material);
    bar.userData.block = block;
    bar.position.copy(a.add(b).multiplyScalar(0.5));
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    bar.scale.y = delta.length();
    bar.castShadow = false;
    bar.receiveShadow = false;
    group.add(bar);
  };
  const pointOnSection = (point, axial) => {
    const coordinates = [];
    coordinates[axis] = axial;
    coordinates[crossAxes[0]] = point[0];
    coordinates[crossAxes[1]] = point[1];
    return coordinates;
  };
  for (const axial of positions) {
    for (let i = 0; i < tieSection.length; i++) {
      const start = tieSection[i], end = tieSection[(i + 1) % tieSection.length];
      addBar(pointOnSection(start, axial), pointOnSection(end, axial));
    }
    const hookLength = Math.max(10 * diameter, 0.06);
    const first = tieSection[0];
    const centroid = tieSection.reduce((sum, point) =>
      [sum[0] + point[0] / tieSection.length, sum[1] + point[1] / tieSection.length], [0, 0]);
    const direction = new THREE.Vector2(centroid[0] - first[0], centroid[1] - first[1]).normalize();
    const hookTip = [
      first[0] + direction.x * hookLength,
      first[1] + direction.y * hookLength
    ];
    addBar(pointOnSection(first, axial), pointOnSection(hookTip, axial));
  }
  block.mesh.add(group);
  block.shearLinkHardware = { group, material, geometry };
}

function insetConvexPolygon(polygon, inset) {
  if (inset <= 0) return polygon.map(point => [...point]);
  const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
  return polygon.map((point, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const next = polygon[(index + 1) % polygon.length];
    const previousDirection = [point[0] - previous[0], point[1] - previous[1]];
    const nextDirection = [next[0] - point[0], next[1] - point[1]];
    const previousLength = Math.hypot(...previousDirection);
    const nextLength = Math.hypot(...nextDirection);
    if (previousLength < 1e-9 || nextLength < 1e-9) return [...point];
    const previousNormal = [-previousDirection[1] / previousLength,
      previousDirection[0] / previousLength];
    const nextNormal = [-nextDirection[1] / nextLength, nextDirection[0] / nextLength];
    const a = [point[0] + previousNormal[0] * inset, point[1] + previousNormal[1] * inset];
    const b = [point[0] + nextNormal[0] * inset, point[1] + nextNormal[1] * inset];
    const denominator = cross2(previousDirection, nextDirection);
    if (Math.abs(denominator) < 1e-9) {
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
    const t = cross2([b[0] - a[0], b[1] - a[1]], nextDirection) / denominator;
    return [a[0] + t * previousDirection[0], a[1] + t * previousDirection[1]];
  });
}

function shearLinkCoreSection(block) {
  const axis = block.size.indexOf(Math.max(...block.size));
  const crossAxes = [0, 1, 2].filter(index => index !== axis);
  const section = hull2(block.verts.map(point => [point[crossAxes[0]], point[crossAxes[1]]]));
  const width = Math.max(...section.map(point => point[0])) -
    Math.min(...section.map(point => point[0]));
  const depth = Math.max(...section.map(point => point[1])) -
    Math.min(...section.map(point => point[1]));
  const requestedCover = block.shearLinks?.cover || 0.025;
  const cover = Math.min(requestedCover, Math.min(width, depth) * 0.2);
  return { section, core: insetConvexPolygon(section, cover), cover, axis, crossAxes };
}

function addBraceAnchorHardware(block) {
  const { orientation, endpoints, gridBay } = block.frame;
  const normalAxis = orientation === 'x' ? 2 : 0;
  const outward = (gridBay?.planeIndex === 0 ? -1 : 1);
  const planeGrid = orientation === 'x' ? block.frame.gridZ : block.frame.gridX;
  const planeCoordinate = Array.isArray(planeGrid) && planeGrid.length
    ? planeGrid[gridBay?.planeIndex === 0 ? 0 : planeGrid.length - 1]
    : null;
  const columnHalf = block.frame.columnHalf ?? (block.frame.columnSide || 0.4) / 2;
  const localFromWorld = quatOf(block.rot).invert();
  const hardware = new THREE.Group();
  const plateMaterial = new THREE.MeshStandardMaterial({
    color: 0x66717d, metalness: 0.88, roughness: 0.32
  });
  const boltMaterial = new THREE.MeshStandardMaterial({
    color: 0xb7c1cb, metalness: 0.95, roughness: 0.22
  });
  const plateSize = orientation === 'x'
    ? [0.34, 0.4, 0.035] : [0.035, 0.4, 0.34];
  const boltPositions = [[-0.115, -0.14], [0.115, -0.14], [-0.115, 0.14], [0.115, 0.14]];
  const boltGeometry = new THREE.CylinderGeometry(0.014, 0.014, 0.085, 8);
  const headGeometry = new THREE.CylinderGeometry(0.032, 0.032, 0.025, 8);
  const washerGeometry = new THREE.CylinderGeometry(0.041, 0.041, 0.009, 12);
  const plateNormalHalf = orientation === 'x' ? plateSize[2] / 2 : plateSize[0] / 2;

  for (const endpoint of endpoints) {
    const anchor = new THREE.Group();
    const worldOffset = new THREE.Vector3(
      endpoint[0] - block.pos[0], endpoint[1] - block.pos[1], endpoint[2] - block.pos[2]
    );
    if (planeCoordinate != null) {
      worldOffset.setComponent(normalAxis,
        planeCoordinate + outward * columnHalf - block.pos[normalAxis]);
    }
    anchor.position.copy(worldOffset.applyQuaternion(localFromWorld));
    anchor.quaternion.copy(localFromWorld);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(...plateSize), plateMaterial);
    plate.position.set(
      normalAxis === 0 ? outward * plateNormalHalf : 0,
      0,
      normalAxis === 2 ? outward * plateNormalHalf : 0
    );
    plate.castShadow = true;
    plate.receiveShadow = true;
    anchor.add(plate);

    for (const [across, vertical] of boltPositions) {
      const bolt = new THREE.Group();
      const shaft = new THREE.Mesh(boltGeometry, boltMaterial);
      const washer = new THREE.Mesh(washerGeometry, boltMaterial);
      const head = new THREE.Mesh(headGeometry, boltMaterial);
      if (normalAxis === 2) {
        shaft.rotation.x = Math.PI / 2;
        washer.rotation.x = Math.PI / 2;
        head.rotation.x = Math.PI / 2;
        bolt.position.set(across, vertical, outward * 0.045);
      } else {
        shaft.rotation.z = Math.PI / 2;
        washer.rotation.z = Math.PI / 2;
        head.rotation.z = Math.PI / 2;
        bolt.position.set(outward * 0.045, vertical, across);
      }
      washer.position[normalAxis === 2 ? 'z' : 'x'] = outward * 0.048;
      head.position[normalAxis === 2 ? 'z' : 'x'] = outward * 0.057;
      shaft.castShadow = washer.castShadow = head.castShadow = true;
      bolt.add(shaft, washer, head);
      anchor.add(bolt);
    }
    hardware.add(anchor);
  }
  block.mesh.add(hardware);
  block.braceAnchorHardware = { group: hardware, plateMaterial, boltMaterial,
    boltGeometry, headGeometry, washerGeometry };
}

// Update the mesh and mass from the block's shape and pose.
function foundationBuried(b) {
  let top = -Infinity;
  for (const p of b.verts) if (p[1] > top) top = p[1];
  return b.mesh.position.y + top <= 0.02;
}
function updateFoundationStyle(b) {
  if (!b.foundation) return;
  const buried = foundationBuried(b);
  if (b._buriedLook === buried) return;
  b._buriedLook = buried;
  const glass = MATS[b.mat].fam === 'glass';
  const mat = b.mesh.material;
  mat.transparent = buried || glass;
  mat.opacity = buried ? 0.42 : glass ? 0.38 : 1;
  mat.depthWrite = !buried && !glass;
  mat.depthTest = !buried;
  mat.needsUpdate = true;
  b.mesh.renderOrder = buried ? 2 : glass ? 1 : 0;
  const edges = b.mesh.children[0];
  const em = edges.material;
  em.opacity = buried ? 0.8 : glass ? 0.18 : 0.35;
  em.depthTest = !buried;
  em.needsUpdate = true;
  edges.renderOrder = buried ? 3 : glass ? 1 : 0;
}
function replaceBlockMaterial(b, matKey) {
  const glass = MATS[matKey].fam === 'glass';
  const buried = b.foundation && foundationBuried(b);
  const previous = b.mesh.material;
  b.mat = matKey;
  b.mesh.material = createMaterialVisual(matKey, {
    transparent: buried || glass, opacity: buried ? 0.42 : glass ? 0.38 : 1,
    depthWrite: !buried && !glass, depthTest: !buried
  });
  disposeMaterialMaps(previous);
  previous.dispose();
  const edges = b.mesh.children[0];
  edges.material.opacity = buried ? 0.8 : glass ? 0.18 : 0.35;
  edges.material.depthTest = !buried;
  edges.material.needsUpdate = true;
  b.mesh.renderOrder = buried ? 2 : glass ? 1 : 0;
  edges.renderOrder = buried ? 3 : glass ? 1 : 0;
  b._buriedLook = buried;
  b.paintKey = null;
  paint(b);
}
function sync(b, rebuildGeometry = true) {
  const q = quatOf(b.rot);
  b.mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
  b.mesh.quaternion.copy(q);
  if (!rebuildGeometry) {
    if (b.foundation) excavationDirty = true;
    updateFoundationStyle(b);
    return;
  }
  const isBox = isAxisAlignedBox(b.verts);
  b.mass = MATS[b.mat].rho * geometryVolume(b.verts);
  if (!Number.isFinite(b.mass) || b.mass <= 0 || b.mass > MAX_BLOCK_MASS) {
    throw new RangeError('Block mass must be finite, positive, and within the model limit.');
  }
  recalcSize(b);
  let g;
  if (isBox) {
    const F = orientFaces(b.verts), pos = [];
    for (const f of F) {
      const p = f.map(i => b.verts[i]);
      for (const t of [[p[0], p[1], p[2]], [p[0], p[2], p[3]]]) for (const v of t) pos.push(...v);
    }
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g = toCreasedNormals(g, Math.PI / 6);
  } else {
    g = smoothConvexGeometry(b.verts);
  }
  if (!g.getAttribute('uv')) {
    const positions = g.getAttribute('position'), normals = g.getAttribute('normal'), uv = [];
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      const nx = Math.abs(normals.getX(i)), ny = Math.abs(normals.getY(i)),
        nz = Math.abs(normals.getZ(i));
      if (nx >= ny && nx >= nz) uv.push(z, y);
      else if (ny >= nx && ny >= nz) uv.push(x, z);
      else uv.push(x, y);
    }
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }
  if (!g.getAttribute('uv2')) g.setAttribute('uv2', g.getAttribute('uv').clone());
  b.mesh.geometry.dispose();
  b.mesh.geometry = g;
  const edges = b.mesh.children[0];
  edges.geometry.dispose();
  edges.geometry = new THREE.EdgesGeometry(g, 20);
  if (b.foundation) excavationDirty = true;
  updateFoundationStyle(b);
}
function removeBlock(b, animate = false) {
  if (animate) animateBlockOut(b.mesh);
  scene.remove(b.mesh);
  b.alive = false;
  b.mesh.visible = false;
  b.mesh.geometry.dispose();
  disposeMaterialMaps(b.mesh.material);
  if (b.braceAnchorHardware) {
    const { group, plateMaterial, boltMaterial, boltGeometry, headGeometry, washerGeometry } =
      b.braceAnchorHardware;
    b.mesh.remove(group);
    group.traverse(object => {
      if (object.geometry && object.geometry !== boltGeometry &&
        object.geometry !== headGeometry && object.geometry !== washerGeometry) object.geometry.dispose();
    });
    boltGeometry.dispose();
    headGeometry.dispose();
    washerGeometry.dispose();
    plateMaterial.dispose();
    boltMaterial.dispose();
  }
  removeShearLinkHardware(b);
  for (const other of blocks) if (other !== b) {
    other.ties = other.ties.filter(tie => tie.to !== b.id);
    if (Array.isArray(other.frame?.anchorBlockIds)) {
      other.frame.anchorBlockIds = other.frame.anchorBlockIds.map(id => id === b.id ? null : id);
    }
  }
  const i = blocks.indexOf(b);
  if (i >= 0) blocks.splice(i, 1);
  if (b.foundation) excavationDirty = true;
  S.selected.delete(b);
  if (S.sel === b) S.sel = [...S.selected].pop() || null;
  if (S.edit === b) S.edit = null;
  if (S.hoverB === b) S.hoverB = null;
}
function removeShearLinkHardware(block) {
  if (!block.shearLinkHardware) return;
  const { group, material, geometry } = block.shearLinkHardware;
  block.mesh.remove(group);
  geometry.dispose();
  material.dispose();
  block.shearLinkHardware = null;
}
function refreshShearLinkHardware(block) {
  removeShearLinkHardware(block);
  addShearLinkHardware(block);
}
function clearAll(preservePlacement = false) {
  if (sceneExplosion) resetSceneExplosion();
  if (!preservePlacement && blockPlacement) cancelBlockPlacement();
  if (framePlacement) cancelFramePlacement();
  clearJoints();
  for (const b of [...blocks]) removeBlock(b);
  simulationPoseSnapshot = null;
  simulationFrameModels = [];
  lastFrameReport = null;
  lastFrameReports = [];
  S.sel = null;
  S.edit = null;
  S.selected.clear();
  S.vsel.clear();
  S.sugs = [];
  S.hoverB = null;
  S.hoverH = S.hoverV = -1;
}
function copyFrameMetadata(frame) {
  if (!frame) return null;
  return {
    ...frame,
    endpoints: Array.isArray(frame.endpoints) ? frame.endpoints.map(point => [...point]) : frame.endpoints,
    endpointLevels: Array.isArray(frame.endpointLevels) ? [...frame.endpointLevels] : frame.endpointLevels,
    anchorBlockIds: Array.isArray(frame.anchorBlockIds) ? [...frame.anchorBlockIds] : frame.anchorBlockIds,
    gridBay: frame.gridBay ? { ...frame.gridBay } : frame.gridBay
  };
}
function snapshot() {
  return blocks.filter(b => b.alive).map(b => ({ mat: b.mat, verts: b.verts.map(p => [...p]), pos: [...b.pos],
    rot: [...b.rot], id: b.id, ties: b.ties.map(t => ({ ...t })), foundation: b.foundation,
    shearKey: b.shearKey, suggestedBearing: b.suggestedBearing,
    suggestionConnection: b.suggestionConnection,
    learnedRetrofitRiskRatio: b.learnedRetrofitRiskRatio,
    frame: copyFrameMetadata(b.frame), shearLinks: b.shearLinks ? { ...b.shearLinks } : null }));
}
function restore(snap, recordUndo = false, preservePlacement = false) {
  if (!Array.isArray(snap)) throw new TypeError('Workspace blocks must be an array.');
  const ids = new Set();
  for (const o of snap) {
    if (!o || !MATS[o.mat] || !validPose(o.pos, o.rot) || (o.ties != null && !Array.isArray(o.ties))) {
      throw new TypeError('Workspace contains a block with invalid material or pose.');
    }
    if (o.suggestedBearing != null && typeof o.suggestedBearing !== 'boolean') {
      throw new TypeError('Workspace contains an invalid bearing-connection marker.');
    }
    if (o.suggestionConnection != null && typeof o.suggestionConnection !== 'boolean') {
      throw new TypeError('Workspace contains an invalid retrofit-connection marker.');
    }
    if (o.learnedRetrofitRiskRatio != null &&
      (!Number.isFinite(o.learnedRetrofitRiskRatio) || o.learnedRetrofitRiskRatio < 0)) {
      throw new TypeError('Workspace contains an invalid learned-retrofit marker.');
    }
    if (o.shearLinks != null && (!Number.isFinite(o.shearLinks.diameter) ||
      o.shearLinks.diameter < 0.006 || o.shearLinks.diameter > 0.04 ||
      !Number.isFinite(o.shearLinks.spacing) || o.shearLinks.spacing < 0.05 ||
      o.shearLinks.spacing > 0.3 ||
      (o.shearLinks.endSpacing != null && (!Number.isFinite(o.shearLinks.endSpacing) ||
        o.shearLinks.endSpacing < 0.05 || o.shearLinks.endSpacing > o.shearLinks.spacing)) ||
      (o.shearLinks.cover != null && (!Number.isFinite(o.shearLinks.cover) ||
        o.shearLinks.cover < 0.01 || o.shearLinks.cover > 0.08)) ||
      (o.shearLinks.material != null && o.shearLinks.material !== 'steel'))) {
      throw new TypeError('Workspace contains invalid shear-link dimensions.');
    }
    const verts = o.verts ?? (Array.isArray(o.size) && o.size.length === 3 &&
    o.size.every(value => Number.isFinite(value) && value > 1e-6) ? boxVerts(o.size) : null);
    const geometryIsValid = !!verts && validGeometry(verts);
    const mass = geometryIsValid ? MATS[o.mat].rho * geometryVolume(verts) : 0;
    if (!geometryIsValid || !Number.isFinite(mass) ||
      mass <= 0 || mass > MAX_BLOCK_MASS) {
      throw new TypeError('Workspace contains invalid block geometry or mass.');
    }
    if (o.id != null) {
      if (!Number.isSafeInteger(o.id) || o.id < 1 || o.id === Number.MAX_SAFE_INTEGER || ids.has(o.id)) {
        throw new TypeError('Workspace block IDs must be unique positive integers.');
      }
      ids.add(o.id);
    }
  }
  let assignedId = 1;
  const restoredIds = new Set(ids);
  const normalized = snap.map(block => {
    let id = block.id;
    if (id == null) {
      while (restoredIds.has(assignedId)) assignedId++;
      id = assignedId++;
      restoredIds.add(id);
    }
    return {
      ...block, id, frame: copyFrameMetadata(block.frame),
      suggestionConnection: !!block.suggestionConnection,
      learnedRetrofitRiskRatio: block.learnedRetrofitRiskRatio || 0,
      shearLinks: block.shearLinks ? {
        ...block.shearLinks,
        endSpacing: block.shearLinks.endSpacing ?? Math.max(0.06, block.shearLinks.spacing * 0.5),
        cover: block.shearLinks.cover ?? 0.025,
        material: block.shearLinks.material || 'steel'
      } : null
    };
  });
  const validIds = new Set(normalized.map(block => block.id));
  for (const block of normalized) {
    if (Array.isArray(block.ties)) block.ties = block.ties.filter(tie => tie && validIds.has(tie.to));
    if (Array.isArray(block.frame?.anchorBlockIds)) {
      block.frame.anchorBlockIds = block.frame.anchorBlockIds.map(id => validIds.has(id) ? id : null);
    }
  }
  if (recordUndo) pushUndo();
  clearAll(preservePlacement);
  nextId = 1;
  nextFrameId = 1;
  lastFrameReport = null;
  lastFrameReports = [];
  for (const o of normalized) makeBlock(o);
  while (validIds.has(nextId)) nextId++;
  for (const block of normalized) {
    const match = /^rc-frame-(\d+)$/.exec(block.frame?.assemblyId || '');
    if (match) nextFrameId = Math.max(nextFrameId, Number(match[1]) + 1);
  }
}
function refreshExcavation() {
  if (!excavationDirty) return;
  excavationDirty = false;
  plateMesh.visible = true;
}
function pushUndo() {
  S.undo.push(snapshot());
  if (S.undo.length > 100) S.undo.shift();
  S.redo.length = 0;
}
function restoreHistoryState(history, destination, emptyMessage, action) {
  if (S.sim) return flash(`Stop the simulation before ${action}.`);
  if (S.edit) return flash(`Leave edit mode (Tab) before ${action}.`);
  const state = history.pop();
  if (!state) return flash(emptyMessage);
  const previousIds = new Set(blocks.filter(block => block.alive).map(block => block.id));
  const targetIds = new Set(state.map(block => block.id));
  for (const block of blocks) {
    if (block.alive && !targetIds.has(block.id)) animateBlockOut(block.mesh);
  }
  destination.push(snapshot());
  if (destination.length > 100) destination.shift();
  restore(state, false, !!blockPlacement);
  for (const block of blocks) {
    if (block.alive && !previousIds.has(block.id)) animateBlockIn(block.mesh);
  }
  S.sel = null;
  S.selected.clear();
  S.hoverB = null;
  if (blockPlacement) updateBlockPlacement({ clientX: lastX, clientY: lastY });
  changed();
  renderProps();
  updateGizmo();
}
function undo() {
  restoreHistoryState(S.undo, S.redo, 'Nothing to undo.', 'undoing');
}
function redo() {
  restoreHistoryState(S.redo, S.undo, 'Nothing to redo.', 'redoing');
}
function changed() {
  S.dirty = true;
  if (bakedSimulation && !S.sim) discardBakedSimulation();
}
const snapV = v => S.snap ? Math.round(v / S.grid) * S.grid : v;

/* ================= loads, supports and contacts ================= */
// Each block passes its weight to real supporters in proportion to horizontal contact area.
function computeLoads(list, supOf, yOf, contactAreas = null) {
  const above = new Map();
  for (const b of list) above.set(b, []);
  for (const u of list) for (const l of supOf.get(u) || []) if (l !== GROUND) above.get(l)?.push(u);
  const shares = new Map();
  for (const upper of list) {
    const supports = supOf.get(upper) || [];
    const savedAreas = contactAreas?.get(upper);
    const areas = supports.map(support => savedAreas?.get(support) ??
      (support === GROUND ? groundContactArea(upper) : horizontalContactArea(upper, support)));
    const totalArea = areas.reduce((sum, area) => sum + (Number.isFinite(area) ? area : 0), 0);
    shares.set(upper, supports.map((support, index) => ({
      support,
      fraction: totalArea > MIN_SECTION_AREA && Number.isFinite(areas[index])
        ? Math.max(0, areas[index]) / totalArea
        : supports.length ? 1 / supports.length : 0
    })));
  }
  const W = new Map();
  for (const b of [...list].sort((a, b) => yOf(b) - yOf(a))) {
    let weight = boundedLoad(b.mass * G);
    for (const upper of above.get(b)) {
      const share = (shares.get(upper) || []).find(item => item.support === b)?.fraction || 0;
      const upperWeight = W.get(upper);
      if (Number.isFinite(upperWeight)) weight = boundedLoad(weight + boundedLoad(upperWeight * share));
    }
    W.set(b, weight);
  }
  return W;
}
function candidatePairs(list, boxes, tolerance) {
  if (list.length < 2) return [];
  let axis = 0, bestSpread = -Infinity;
  for (let k = 0; k < 3; k++) {
    let min = Infinity, max = -Infinity, width = 0;
    for (const b of list) {
      const box = boxes.get(b);
      min = Math.min(min, box.min.getComponent(k));
      max = Math.max(max, box.max.getComponent(k));
      width += box.max.getComponent(k) - box.min.getComponent(k);
    }
    const spread = (max - min) / (width / list.length + tolerance);
    if (spread > bestSpread) { bestSpread = spread; axis = k; }
  }
  const ordered = [...list].sort((a, b) => boxes.get(a).min.getComponent(axis) - boxes.get(b).min.getComponent(axis));
  const out = [];
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i], A = boxes.get(a), limit = A.max.getComponent(axis) + tolerance;
    for (let j = i + 1; j < ordered.length; j++) {
      const b = ordered[j], B = boxes.get(b);
      if (B.min.getComponent(axis) > limit) break;
      let overlaps = true;
      for (let k = 0; k < 3; k++) {
        if (Math.min(A.max.getComponent(k), B.max.getComponent(k)) -
          Math.max(A.min.getComponent(k), B.min.getComponent(k)) < -tolerance) {
          overlaps = false;
          break;
        }
      }
      if (overlaps) out.push([a, b]);
    }
  }
  return out;
}
// Vertical support from geometry: a block whose bottom meets another block's top within 2 cm and overlaps it.
function geometrySupports(list) {
  const boxes = new Map();
  for (const b of list) boxes.set(b, new THREE.Box3().setFromObject(b.mesh));
  const supOf = new Map();
  const contactAreas = new Map();
  const addSupport = (upper, support, area) => {
    if (supOf.get(upper).includes(support)) return;
    supOf.get(upper).push(support);
    contactAreas.get(upper).set(support, area);
  };
  for (const a of list) {
    supOf.set(a, []);
    contactAreas.set(a, new Map());
    if (boxes.get(a).min.y <= 0.02) addSupport(a, GROUND, groundContactArea(a));
  }
  for (const [a, c] of candidatePairs(list, boxes, 0.02)) {
    const A = boxes.get(a), B = boxes.get(c);
    if (Math.abs(A.min.y - B.max.y) <= 0.02) {
      const area = horizontalContactArea(a, c);
      if (area > MIN_SECTION_AREA) addSupport(a, c, area);
    }
    if (Math.abs(B.min.y - A.max.y) <= 0.02) {
      const area = horizontalContactArea(c, a);
      if (area > MIN_SECTION_AREA) addSupport(c, a, area);
    }
  }
  return { supOf, boxes, contactAreas };
}
// Every pair of blocks that touch face to face, with the contact plane and its rectangle.
function touchingPairs(list, boxes) {
  const out = [];
  for (const [a, b] of candidatePairs(list, boxes, 0.01)) {
    const A = boxes.get(a), B = boxes.get(b);
    let n = -1, lowerA = false;
    for (let ax = 0; ax < 3 && n < 0; ax++) {
      if (Math.abs(A.max.getComponent(ax) - B.min.getComponent(ax)) < 0.01) { n = ax; lowerA = true; }
      else if (Math.abs(B.max.getComponent(ax) - A.min.getComponent(ax)) < 0.01) { n = ax; lowerA = false; }
    }
    if (n < 0) continue;
    const u = (n + 1) % 3, v = (n + 2) % 3;
    const lo = [Math.max(A.min.getComponent(u), B.min.getComponent(u)), Math.max(A.min.getComponent(v), B.min.getComponent(v))];
    const hi = [Math.min(A.max.getComponent(u), B.max.getComponent(u)), Math.min(A.max.getComponent(v), B.max.getComponent(v))];
    if (hi[0] - lo[0] < 0.01 || hi[1] - lo[1] < 0.01) continue;
    const c = (lowerA ? A : B).max.getComponent(n);
    out.push({ a, b, n, lo, hi, c, lowerA });
  }
  return out;
}
// Union-find: connected groups of blocks given a list of linked pairs.
function groupBy(list, edges) {
  const par = new Map(list.map(b => [b, b]));
  const f = b => { while (par.get(b) !== b) { par.set(b, par.get(par.get(b))); b = par.get(b); } return b; };
  for (const e of edges) par.set(f(e.a), f(e.b));
  const g = new Map();
  for (const b of list) { const r = f(b); if (!g.has(r)) g.set(r, []); g.get(r).push(b); }
  return [...g.values()];
}
// Top of the highest block beneath (x, z) below height y (0 for the ground).
function supportTopBelow(x, z, y, list, boxes) {
  let top = 0;
  for (const o of list) {
    const bb = boxes.get(o);
    if (bb.max.y > y + 0.02) continue;
    if (x > bb.min.x && x < bb.max.x && z > bb.min.z && z < bb.max.z) top = Math.max(top, bb.max.y);
  }
  return top;
}
// Nearest ground-based column on the same grid line, 0.05 to 5 m away.
function neighbourCol(b, ax, list, boxes) {
  const other = ax === 0 ? 2 : 0;
  let best = null, bestGap = Infinity;
  for (const c of list) {
    if (c === b || boxes.get(c).min.y > 0.02) continue;
    if (c.size[1] < 2 * Math.min(c.size[0], c.size[2])) continue;
    if (Math.abs(c.pos[other] - b.pos[other]) > 0.05) continue;
    const gap = Math.abs(c.pos[ax] - b.pos[ax]) - (b.size[ax] + c.size[ax]) / 2;
    if (gap > 0.05 && gap <= 5 && gap < bestGap) { best = c; bestGap = gap; }
  }
  return best;
}
// Convex hull (monotone chain) and point-in-polygon, used for the centre-of-mass stability test.
function hull2(pts) {
  pts = pts.filter(p => p.every(Number.isFinite))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (pts.length < 3) return pts;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop();
  return lo.concat(up);
}
function polygonArea(poly) {
  if (poly.length < 3) return 0;
  let twiceArea = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  const area = Math.abs(twiceArea) * 0.5;
  return Number.isFinite(area) ? area : 0;
}
function polygonSectionProperties(poly) {
  if (poly.length < 3) return { area: 0, Iu: 0, Iv: 0, Su: 0, Sv: 0 };
  let twiceArea = 0, centerU = 0, centerV = 0, inertiaU = 0, inertiaV = 0;
  for (let i = 0; i < poly.length; i++) {
    const [u0, v0] = poly[i], [u1, v1] = poly[(i + 1) % poly.length];
    const cross = u0 * v1 - u1 * v0;
    twiceArea += cross;
    centerU += (u0 + u1) * cross;
    centerV += (v0 + v1) * cross;
    inertiaU += (v0 * v0 + v0 * v1 + v1 * v1) * cross;
    inertiaV += (u0 * u0 + u0 * u1 + u1 * u1) * cross;
  }
  const signedArea = twiceArea * 0.5;
  if (!Number.isFinite(signedArea) || Math.abs(signedArea) < MIN_SECTION_AREA) {
    return { area: 0, Iu: 0, Iv: 0, Su: 0, Sv: 0 };
  }
  const center = [centerU / (6 * signedArea), centerV / (6 * signedArea)];
  const area = Math.abs(signedArea);
  const Iu = Math.max(0, Math.abs(inertiaU / 12) - area * center[1] ** 2);
  const Iv = Math.max(0, Math.abs(inertiaV / 12) - area * center[0] ** 2);
  const depth = Math.max(...poly.map(point => Math.abs(point[1] - center[1])));
  const width = Math.max(...poly.map(point => Math.abs(point[0] - center[0])));
  const Su = depth > 1e-12 ? Iu / depth : 0;
  const Sv = width > 1e-12 ? Iv / width : 0;
  return [area, Iu, Iv, Su, Sv].every(Number.isFinite)
    ? { area, Iu, Iv, Su, Sv }
    : { area: 0, Iu: 0, Iv: 0, Su: 0, Sv: 0 };
}
function sectionPolygon(verts, axis, coordinate, faces = orientFaces(verts)) {
  const projectedAxes = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
  const edges = new Set(), intersections = [];
  const addPoint = point => intersections.push([point[projectedAxes[0]], point[projectedAxes[1]]]);
  for (const face of faces) {
    for (let i = 0; i < face.length; i++) {
      const aIndex = face[i], bIndex = face[(i + 1) % face.length];
      const edgeKey = aIndex < bIndex ? `${aIndex}:${bIndex}` : `${bIndex}:${aIndex}`;
      if (edges.has(edgeKey)) continue;
      edges.add(edgeKey);
      const a = verts[aIndex], b = verts[bIndex];
      const da = a[axis] - coordinate, db = b[axis] - coordinate;
      if (Math.abs(da) <= 1e-9) addPoint(a);
      if (Math.abs(db) <= 1e-9) addPoint(b);
      if ((da < -1e-9 && db > 1e-9) || (da > 1e-9 && db < -1e-9)) {
        const t = da / (da - db);
        addPoint(a.map((value, i) => value + (b[i] - value) * t));
      }
    }
  }
  return hull2(intersections);
}
function blockSectionProperties(b, axis, coordinate = 0) {
  const world = shapeWorld(b).map(point => [point.x, point.y, point.z]);
  return polygonSectionProperties(sectionPolygon(world, axis, coordinate, orientFaces(b.verts)));
}
function sectionSamples(b, axis) {
  const world = shapeWorld(b).map(point => [point.x, point.y, point.z]);
  const faces = orientFaces(b.verts);
  const coordinates = [...new Set(world.map(point => point[axis]))].sort((a, b) => a - b);
  const samples = [];
  for (let i = 0; i < coordinates.length - 1; i++) {
    if (coordinates[i + 1] - coordinates[i] <= 1e-9) continue;
    const section = polygonSectionProperties(sectionPolygon(
      world, axis, (coordinates[i] + coordinates[i + 1]) / 2, faces));
    samples.push(section);
  }
  return samples;
}
function minimumSection(b, axis) {
  const samples = sectionSamples(b, axis).filter(sample => sample.area > MIN_SECTION_AREA);
  if (!samples.length) return { area: MIN_SECTION_AREA, Iu: 0, Iv: 0, Su: 0, Sv: 0 };
  return {
    area: Math.min(...samples.map(sample => sample.area)),
    Iu: Math.min(...samples.map(sample => sample.Iu)),
    Iv: Math.min(...samples.map(sample => sample.Iv)),
    Su: Math.min(...samples.map(sample => sample.Su)),
    Sv: Math.min(...samples.map(sample => sample.Sv))
  };
}
function representativeSection(b, axis) {
  const coordinates = shapeWorld(b).map(point => point.getComponent(axis));
  const coordinate = (Math.min(...coordinates) + Math.max(...coordinates)) / 2;
  return blockSectionProperties(b, axis, coordinate);
}
function intersectConvexPolygons(subject, clip) {
  let output = subject.map(point => [...point]);
  if (output.length < 3 || clip.length < 3) return [];
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    const side = point => (b[0] - a[0]) * (point[1] - a[1]) -
      (b[1] - a[1]) * (point[0] - a[0]);
    let previous = input[input.length - 1], previousSide = side(previous);
    for (const current of input) {
      const currentSide = side(current);
      if ((currentSide >= -1e-9) !== (previousSide >= -1e-9)) {
        const ratio = previousSide / (previousSide - currentSide);
        output.push([
          previous[0] + (current[0] - previous[0]) * ratio,
          previous[1] + (current[1] - previous[1]) * ratio
        ]);
      }
      if (currentSide >= -1e-9) output.push(current);
      previous = current;
      previousSide = currentSide;
    }
  }
  return hull2(output);
}
function horizontalContactArea(a, b) {
  const worldA = shapeWorld(a), worldB = shapeWorld(b);
  const planeA = Math.min(...worldA.map(point => point.y));
  const planeB = Math.max(...worldB.map(point => point.y));
  if (Math.abs(planeA - planeB) > 0.02) return 0;
  const localA = worldA.map(point => [point.x, point.y, point.z]);
  const localB = worldB.map(point => [point.x, point.y, point.z]);
  const polygonA = sectionPolygon(localA, 1, planeA, orientFaces(a.verts));
  const polygonB = sectionPolygon(localB, 1, planeB, orientFaces(b.verts));
  return polygonArea(intersectConvexPolygons(polygonA, polygonB));
}
function groundContactArea(b) {
  const world = shapeWorld(b).map(point => [point.x, point.y, point.z]);
  const groundLevel = Math.min(...world.map(point => point[1]));
  return polygonArea(sectionPolygon(world, 1, groundLevel, orientFaces(b.verts)));
}
function polygonMargin(poly, p) {
  if (poly.length < 3 || !p.every(Number.isFinite)) return -MAX_SCREEN_RATIO;
  let margin = MAX_SCREEN_RATIO;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const edgeLength = Math.hypot(dx, dz);
    if (!Number.isFinite(edgeLength) || edgeLength <= 1e-12) return -MAX_SCREEN_RATIO;
    const edgeMargin = (dx * (p[1] - a[1]) - dz * (p[0] - a[0])) / edgeLength;
    if (!Number.isFinite(edgeMargin)) return -MAX_SCREEN_RATIO;
    margin = Math.min(margin, edgeMargin);
  }
  return margin;
}
// Square column side (m) for axial load P (N) and height L (m).
// Crushing: A >= SF*P/fc. Euler, pinned ends: I >= SF*P*L^2/(pi^2*E), with I = s^4/12.
function pillarSide(P, L, mat = 'concrete') {
  const m = MATS[mat];
  const load = boundedLoad(P), length = Number.isFinite(L) ? Math.max(0, L) : 0;
  const sC = Math.sqrt(load * SF / m.strength);
  const sE = Math.pow(12 * load * SF * length * length / (Math.PI ** 2 * m.E), 0.25);
  const side = Math.max(MIN_PILLAR_SECTION, Math.ceil(Math.max(sC, sE) / 0.05) * 0.05);
  return Number.isFinite(side) ? Math.min(12, side) : 12;
}
function sturdyPillarSection(members, mat, axialLoad, height, lateralAccelG = 0) {
  const peers = members.filter(block => block.alive && block.mat === mat &&
    block.size[1] >= 1.5 * Math.max(block.size[0], block.size[2]));
  const requiredSide = pillarSide(axialLoad, height, mat);
  let width = Math.max(requiredSide, ...peers.map(block => block.size[0]));
  let depth = Math.max(requiredSide, ...peers.map(block => block.size[2]));
  const material = MATS[mat], lateralForce = boundedLoad(axialLoad) * Math.max(0, lateralAccelG);
  const moment = lateralForce * Math.max(0, height) / 2;
  const capacityRatio = () => {
    const area = width * depth;
    const sectionModulus = Math.min(width * depth ** 2, depth * width ** 2) / 6;
    const shearArea = 0.8 * Math.min(width, depth) * Math.max(width, depth);
    return Math.max(
      axialLoad / Math.max(area * material.strength / SF, 1),
      moment / Math.max(sectionModulus * material.fb / SF, 1),
      lateralForce / Math.max(shearArea * material.strength / (Math.sqrt(3) * SF), 1)
    );
  };
  for (let iteration = 0; iteration < 16 && capacityRatio() > 1 && Math.max(width, depth) < 12; iteration++) {
    const scale = Math.max(1.05, Math.pow(capacityRatio() * 1.02, 1 / 3));
    width = Math.min(12, Math.ceil(width * scale * 20) / 20);
    depth = Math.min(12, Math.ceil(depth * scale * 20) / 20);
  }
  const ratio = capacityRatio();
  return { width, depth, capacityRatio: ratio, adequate: ratio <= 1 };
}
// Same-material tie between two ground-level columns along axis ax, at mid-height of the shorter one.
function barCreate(b, c, ax) {
  if (b.mat !== c.mat || !jointKind(b.mat, c.mat)) return null;
  const other = ax === 0 ? 2 : 0;
  const L = Math.abs(c.pos[ax] - b.pos[ax]) - (b.size[ax] + c.size[ax]) / 2;
  if (L <= 0.05) return null;
  const pos = [0, Math.min(b.size[1], c.size[1]) / 2, 0];
  pos[ax] = (b.pos[ax] + c.pos[ax]) / 2;
  pos[other] = b.pos[other];
  const size = [0.2, 0.2, 0.2];
  size[ax] = L;
  const axl = ax === 0 ? 'x' : 'z';
  return { mat: b.mat, size, pos, rot: [0, 0, 0], ties: [{ to: b.id, axis: axl }, { to: c.id, axis: axl }] };
}

// Search for at least 2 same-material piers (with spread footings on soil) whose combined support
// polygon contains the group's center of mass with the required margin. Returns
// { plan, volume } or null. Pier section includes group and pier self-weight, peer-column
// matching, and simplified axial, buckling, bending, and shear checks.
function pierSupportOption(comp, mass, cx, cz, contacts, requiredMargin, lateralAccelG = 0) {
  const mat = dominantMaterial(comp);
  if (!jointKind(mat, mat)) return null;
  const candidateSites = [];
  for (const b of comp) {
    if (b.mat !== mat) continue;
    const worldVerts = shapeWorld(b), bottomY = Math.min(...worldVerts.map(p => p.y));
    if (bottomY <= 0.02) continue;
    const bottom = worldVerts.filter(p => Math.abs(p.y - bottomY) <= 1e-4).map(p => [p.x, p.z]);
    const face = hull2(bottom);
    if (face.length < 3 || Math.abs(face.reduce((sum, p, i) => {
      const q = face[(i + 1) % face.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0)) < 0.02) continue;
    const faceCenter = face.reduce((p, q) => [p[0] + q[0] / face.length, p[1] + q[1] / face.length], [0, 0]);
    let section = sturdyPillarSection(comp, mat, mass * G, bottomY, lateralAccelG);
    for (let i = 0; i < 5; i++) section = sturdyPillarSection(comp, mat,
      mass * G + MATS[mat].rho * section.width * section.depth * bottomY * G, bottomY, lateralAccelG);
    if (!section.adequate) continue;
    const side = Math.ceil(Math.max(section.width, section.depth) * 1.5 * 20) / 20;
    const sites = [faceCenter];
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b2 = face[(i + 1) % face.length];
      const toward = p => {
        const dx = faceCenter[0] - p[0], dz = faceCenter[1] - p[1];
        const len = Math.hypot(dx, dz) || 1;
        return [p[0] + dx / len * (side / Math.SQRT2 + 0.02), p[1] + dz / len * (side / Math.SQRT2 + 0.02)];
      };
      sites.push(toward(a), toward([(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2]));
    }
    for (const [x, z] of sites) {
      const half = side / 2;
      const corners = [[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]];
      if (corners.some(p => polygonMargin(face, p) < -1e-6)) continue;
      if (candidateSites.some(p => Math.hypot(p.x - x, p.z - z) < side * 0.5)) continue;
      const pier = { mat, size: [side, bottomY, side], pos: [x, bottomY / 2, z],
        rot: [0, 0, 0], suggestionConnection: true };
      const pierFooting = { mat, size: [side + 0.4, 0.45, side + 0.4],
        pos: [x, -0.225, z], rot: [0, 0, 0], foundation: true,
        suggestionConnection: true };
      const plan = { creates: [pier, pierFooting] };
      if (planFree(plan)) candidateSites.push({ x, z, side, height: bottomY, pier, pierFooting });
    }
  }
  const supportOptionFor = chosen => {
    const newPoints = [...contacts];
    const creates = [];
    let volume = 0;
    for (const site of chosen) {
      const h = site.side / 2;
      newPoints.push([site.x - h, site.z - h], [site.x + h, site.z - h],
        [site.x + h, site.z + h], [site.x - h, site.z + h]);
      creates.push(site.pier);
      if (site.pierFooting) {
        creates.push(site.pierFooting);
        volume += site.pierFooting.size[0] * site.pierFooting.size[1] * site.pierFooting.size[2];
      }
      volume += site.side * site.side * site.height;
    }
    const hull = hull2(newPoints);
    if (polygonMargin(hull, [cx, cz]) < requiredMargin) return null;
    const plan = { creates };
    if (!planFree(plan)) return null;
    return { plan, volume };
  };
  let supportOption = null;
  candidateSites.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
  const sites = candidateSites.slice(0, 16);
  for (let count = 2; count <= Math.min(3, sites.length) && !supportOption; count++) {
    const search = (start, chosen) => {
      if (chosen.length === count) {
        const option = supportOptionFor(chosen);
        if (option && (!supportOption || option.volume < supportOption.volume)) supportOption = option;
        return;
      }
      for (let i = start; i <= sites.length - (count - chosen.length); i++) {
        chosen.push(sites[i]);
        search(i + 1, chosen);
        chosen.pop();
      }
    };
    search(0, []);
  }
  return supportOption;
}

/* ================= fastening ================= */
function jointKind(ma, mb) {
  const fa = MATS[ma].fam, fb = MATS[mb].fam;
  if (fa === 'timber' && fb === 'timber') return 'nail';
  if (fa === fb && (fa === 'steel' || fa === 'alu')) return 'weld';
  if (fa === 'concrete' && fb === 'concrete') return 'cast';
  if ((fa === 'brick' && (fb === 'brick' || fb === 'concrete')) || (fb === 'brick' && fa === 'concrete')) return 'mortar';
  return null;
}
// Single-shear lateral capacity of one nail (N): simplified Johansen bound, using EC5 8.2.2 embedment and yield-moment forms.
//   f_h = 0.082*(1 - 0.01*d)*density*d^-0.3 (N/mm^2), M_y = 0.3*f_u*d^2.6 (N*mm), F_v = min(f_h*t*d, sqrt(2*M_y*f_h*d)).
function nailCap(tMM) {
  const d = FAST.nailD;
  const fh = 0.082 * (1 - 0.01 * d) * MATS.timber.rho * Math.pow(d, -0.3);
  const My = 0.3 * FAST.nailFu * Math.pow(d, 2.6);
  return Math.min(fh * tMM * d, Math.sqrt(2 * My * fh * d));
}
// Fillet weld capacity for one seam segment (AWS D1.1 LRFD): phi*0.6*F_EXX*0.707*a*L.
function weldCap(fexx, seg) { return FAST.weldPhi * 0.6 * fexx * 0.707 * FAST.weldLeg * seg; }

function clearJoints() {
  for (const j of joints) {
    if (!j.vis) continue;
    j.vis.parent && j.vis.parent.remove(j.vis);
    j.vis.traverse(o => { const oo = /** @type {any} */ (o); if (oo.geometry) oo.geometry.dispose(); if (oo.material) oo.material.dispose(); });
  }
  joints.length = 0;
}

// Joint visuals are children of block a's mesh, so they move with the block.
function drawJoint(j) {
  const g = new THREE.Group();
  const loc = p => p.clone().sub(v3(j.a.pos));
  const col = new THREE.Color(j.holds ? (COL[j.kind] || COL.cast) : COL.bad);
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.5 });
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
  if (j.holds && j.kind === 'nail') {
    // A 3.75 mm nail, drawn at twice its size so it can be seen.
    const shaft = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.07, 8), mat, j.pts.length);
    const head = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 10), mat, j.pts.length);
    const dir = AXV[j.n];
    Q.setFromUnitVectors(Y, dir);
    j.pts.forEach((p, i) => {
      const lp = loc(p);
      shaft.setMatrixAt(i, M.compose(lp, Q, ONE));
      head.setMatrixAt(i, M.compose(lp.clone().addScaledVector(dir, 0.035), Q, ONE));
    });
    g.add(shaft, head);
  } else if (j.holds && j.kind === 'weld') {
    // Fillet bead along each seam segment.
    const bead = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), mat, j.segs.length);
    j.segs.forEach((s, i) => {
      Q.setFromUnitVectors(Y, s.dir);
      bead.setMatrixAt(i, M.compose(loc(s.mid), Q, new THREE.Vector3(1, s.len, 1)));
    });
    g.add(bead);
  } else {
    // Mortar, cast bond, or a joint that does not hold: outline of the contact face.
    const u = (j.n + 1) % 3, v = (j.n + 2) % 3;
    const corners = [[j.lo[0], j.lo[1]], [j.hi[0], j.lo[1]], [j.hi[0], j.hi[1]], [j.lo[0], j.hi[1]]];
    const pts = [];
    for (let k = 0; k < 4; k++) {
      for (const cc of [corners[k], corners[(k + 1) % 4]]) {
        const q = new THREE.Vector3();
        q.setComponent(j.n, j.c); q.setComponent(u, cc[0]); q.setComponent(v, cc[1]);
        pts.push(loc(q));
      }
    }
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col })));
  }
  j.a.mesh.add(g);
  j.vis = g;
}

// Lay out every touching material joint plus suggestion-created reinforced retrofit interfaces.
// Demand: a vertical contact carries the weight above it times the quake acceleration. A side contact carries
// the smaller block's weight (and its quake inertia). A joint holds if capacity >= JOINT_SF * demand.
// JOINT_SF scales with material brittleness: brittle materials use a lower threshold (easier to break),
// while ductile materials use a higher threshold (harder to break).
function buildJoints(pairs, W, aD) {
  clearJoints();
  for (const p of pairs) {
    const { a, b, n, lo, hi, c } = p;
    if (isRot(a) || isRot(b)) continue;
    // Only generic suggestion-created rubber bearings get this modeled anchor; RC-frame bearings stay unchanged.
    const suggestedBearing = n === 1 && ((a.suggestedBearing && a.mat === 'rubber') ||
      (b.suggestedBearing && b.mat === 'rubber'));
    const forcedConnection = a.suggestionConnection || b.suggestionConnection ||
      a.foundation || b.foundation;
    if (!S.autoFasten && !forcedConnection) continue;
    const kind = forcedConnection ? 'reinforced'
      : jointKind(a.mat, b.mat) || (suggestedBearing ? 'bearing' : null);
    if (!kind) continue;
    const u = (n + 1) % 3, v = (n + 2) % 3;
    const area = (hi[0] - lo[0]) * (hi[1] - lo[1]);
    const upper = p.lowerA ? b : a;
    const sigN = n === 1 ? (W.get(upper) || 0) / area : 0;     // only vertical contact carries compression
    const pts = [], segs = [];
    let cap = 0;
    const put = (pu, pv) => {
      const q = new THREE.Vector3();
      q.setComponent(n, c); q.setComponent(u, pu); q.setComponent(v, pv);
      pts.push(q);
      return q;
    };
    if (kind === 'reinforced') {
      cap = Math.max(1e9, MATS[a.mat].strength * area * 10,
        MATS[b.mat].strength * area * 10);
    } else if (kind === 'bearing') {
      cap = MATS.rubber.strength * area;
    } else if (kind === 'weld') {
      const fexx = MATS[a.mat].fam === 'alu' ? 165e6 : 483e6;
      const corners = [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]];
      for (let k = 0; k < 4; k++) {
        const p0 = corners[k], p1 = corners[(k + 1) % 4];
        const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const cnt = Math.max(1, Math.round(L / FAST.weldSeg)), seg = L / cnt;
        const dir = new THREE.Vector3();
        dir.setComponent(u, (p1[0] - p0[0]) / L); dir.setComponent(v, (p1[1] - p0[1]) / L);
        cap += cnt * weldCap(fexx, seg);
        const visibleCount = Math.min(cnt, 64);
        const visibleLength = L / visibleCount;
        for (let q = 0; q < visibleCount; q++) {
          const t = (q + 0.5) / visibleCount;
          const mid = put(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t);
          segs.push({ mid, dir, len: visibleLength });
        }
      }
    } else {
      const nu = Math.max(1, Math.round((hi[0] - lo[0]) / FAST.nailSpacing));
      const nv = Math.max(1, Math.round((hi[1] - lo[1]) / FAST.nailSpacing));
      const du = (hi[0] - lo[0]) / nu, dv = (hi[1] - lo[1]) / nv;
      const tMM = Math.min(a.size[n], b.size[n]) * 1000;
      if (kind === 'nail') {
        const count = nu * nv, perNail = nailCap(tMM);
        cap = count * perNail;
        const visibleCount = Math.min(count, 128);
        for (let i = 0; i < visibleCount; i++) {
          const index = Math.floor((i + 0.5) * count / visibleCount);
          const pu = lo[0] + (Math.floor(index / nv) + 0.5) * du;
          const pv = lo[1] + (index % nv + 0.5) * dv;
          put(pu, pv);
        }
      } else {
        const strength = kind === 'mortar' ? FAST.mortarC : FAST.castC;
        const friction = kind === 'mortar' ? FAST.mortarMu : FAST.castMu;
        cap = (strength + friction * sigN) * area;
      }
    }
    const V = n === 1 ? (W.get(upper) || 0) * aD / G : Math.min(a.mass, b.mass) * Math.hypot(G, aD);
    // Scale safety factor by material brittleness: brittle materials break more easily.
    // The weaker material in the pair determines the joint resilience.
    const matA = MATS[a.mat], matB = MATS[b.mat];
    const weakerStrength = Math.min(matA.strength, matB.strength);
    const weakerType = matA.type === 'brittle' ? 'brittle' : matB.type === 'brittle' ? 'brittle' : 'ductile';
    // Brittle joints: lower safety factor (easier to break under load)
    // Ductile joints: higher safety factor (more resilient)
    const materialSF = weakerType === 'brittle'
      ? Math.max(0.8, JOINT_SF * (weakerStrength / 100e6))  // scales with strength; glass ~0.45, brick ~0.15
      : JOINT_SF * Math.min(2.0, 1.0 + weakerStrength / 200e6);  // steel/concrete get higher SF
    const baseCapacity = cap;
    const hingeReinforcementFactor = n === 1 && kind !== 'reinforced'
      ? Math.max(shearLinkJointFactor(a), shearLinkJointFactor(b)) : 1;
    cap *= hingeReinforcementFactor;
    const holds = cap >= materialSF * V;
    const jt = { a, b, kind, n, lo, hi, c, pts, segs, cap, baseCapacity, V, holds, area,
      vis: null, materialSF, hingeReinforcementFactor };
    joints.push(jt);
    drawJoint(jt);
  }
}

/* ================= analysis and suggestions ================= */
// Checks use textbook formulas:
//  - Columns: Euler buckling Ncr = pi^2*E*I/(K*L)^2, with effective length halved per tie in that direction.
//  - Beams: stress = M/S and deflection <= L/360 over each gap between real support contacts.
//  - Crushing: stress = N/A <= fc/SF.
//  - Stability: each fastened assembly's gravity resultant must lie in its support polygon.
//  - Earthquake (only if one is selected): rigid-block overturning a = g*b/h and sliding a = friction*g (Housner 1963).
// Each failed check gets the cheapest available suggestion; fastened assemblies are checked as a whole for balance.
// Volume-weighted dominant material of a member list, so suggested retrofit
// members match the structure they reinforce instead of always defaulting to
// concrete or steel. Falls back to 'concrete' for empty/all-foundation lists.
function dominantMaterial(list) {
  const vol = {};
  for (const b of list) {
    if (!b.alive || b.foundation) continue;
    vol[b.mat] = (vol[b.mat] || 0) + b.size[0] * b.size[1] * b.size[2];
  }
  let best = 'concrete', bestVol = 0;
  for (const [mat, v] of Object.entries(vol)) if (v > bestVol) { best = mat; bestVol = v; }
  return best;
}
function frameRetrofitCreates(data, type, selectedStories) {
  const creates = [];
  const retrofitMat = data.suggestMat || 'concrete';
  if (!jointKind(retrofitMat, retrofitMat)) return creates;
  const frameData = { ...data };
  delete frameData.columns;
  delete frameData.frameMembers;
  const stories = selectedStories || Array.from({ length: data.floors }, (_, index) => index + 1);
  const thickness = type === 'shear-wall' ? 0.2 : type === 'damper' ? 0.14 : S.braceThickness;
  const baseY0 = data.baseY ?? 0;
  const gx = data.gridX || [-(data.bay || 4), 0, data.bay || 4];
  const gz = data.gridZ || [-(data.bay || 4), 0, data.bay || 4];
  const planCX = (gx[0] + gx[gx.length - 1]) / 2;
  const planCZ = (gz[0] + gz[gz.length - 1]) / 2;
  const bayX = gx.length > 1 ? (gx[gx.length - 1] - gx[0]) / (gx.length - 1) : (data.bay || 4);
  const bayZ = gz.length > 1 ? (gz[gz.length - 1] - gz[0]) / (gz.length - 1) : (data.bay || 4);
  const bay = Math.min(bayX, bayZ);
  const colSide = data.columnSide || 0.4;
  if (type === 'brace') {
    for (const story of stories) for (const orientation of ['x', 'z']) {
      const bayCount = (orientation === 'x' ? gx.length : gz.length) - 1;
      for (let planeIndex = 0; planeIndex < 2; planeIndex++) {
        for (let bayIndex = 0; bayIndex < bayCount; bayIndex++) {
          creates.push(...braceCreatesForBay(data, {
            story, orientation, planeIndex, bayIndex
          }));
        }
      }
    }
    return creates;
  }
  const addDiagonal = (p0, p1, story, orientation) => {
    const delta = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const length = delta.length();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
    const frameData = { ...data };
    delete frameData.columns;
    delete frameData.frameMembers;
    creates.push({
      mat: data.suggestMat || (type === 'shear-wall' ? 'concrete' : 'steel'),
      size: [thickness, length, thickness],
      pos: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2],
      rot: [euler.x, euler.y, euler.z].map(angle => angle / DEG),
      frame: {
        ...frameData, role: type, story, orientation, E: data.E || MATS[data.suggestMat || 'steel'].E,
        endpoints: [p0, p1], endpointLevels: [story - 1, story],
        dampingCoefficient: type === 'damper' ? 150e3 : 0
      }
    });
  };

  for (const story of stories) {
    const floorY = baseY0 + story * data.storyHeight;
    const baseY = story === 1 ? baseY0 : baseY0 + (story - 1) * data.storyHeight;
    const topY = floorY - data.beamDepth;
    if (topY - baseY < 1) continue;
    if (type === 'shear-wall') {
      const length = Math.min(3, bay * 0.75);
      const offset = length / 2 - thickness / 2;
      const returnLength = Math.max(0.5, length - 2 * thickness);
      const height = floorY - baseY;
      for (const z of [planCZ - offset, planCZ + offset]) creates.push({
        mat: data.suggestMat || 'concrete', size: [length, height, thickness],
        pos: [planCX, (baseY + floorY) / 2, z], rot: [0, 0, 0],
        frame: { ...frameData, role: type, story, orientation: 'x', E: data.E }
      });
      for (const x of [planCX - offset, planCX + offset]) creates.push({
        mat: data.suggestMat || 'concrete', size: [thickness, height, returnLength],
        pos: [x, (baseY + floorY) / 2, planCZ], rot: [0, 0, 0],
        frame: { ...frameData, role: type, story, orientation: 'z', E: data.E }
      });
      if (story === 1) creates.push({
        mat: data.suggestMat || 'concrete',
        size: [length + 0.4, 0.45, length + 0.4],
        pos: [planCX, -0.225, planCZ], rot: [0, 0, 0], foundation: true,
        frame: { ...frameData, role: 'footing', story: 0 }
      });
      continue;
    }
    // One diagonal per bay on each exterior plane, alternating direction so the
    // devices stay balanced in plan.
    const y0 = baseY + 0.08, y1 = topY - 0.08;
    const out = colSide / 2 + thickness / 2;
    for (let pi = 0; pi < 2; pi++) {
      const z = pi === 0 ? gz[0] - out : gz[gz.length - 1] + out;
      for (let i = 0; i < gx.length - 1; i++) {
        const x0 = gx[i] + colSide / 2, x1 = gx[i + 1] - colSide / 2;
        const ends = (i + pi) % 2 === 0 ? [[x0, y0, z], [x1, y1, z]] : [[x1, y0, z], [x0, y1, z]];
        addDiagonal(ends[0], ends[1], story, 'x');
      }
    }
    for (let pi = 0; pi < 2; pi++) {
      const x = pi === 0 ? gx[0] - out : gx[gx.length - 1] + out;
      for (let i = 0; i < gz.length - 1; i++) {
        const z0 = gz[i] + colSide / 2, z1 = gz[i + 1] - colSide / 2;
        const ends = (i + pi) % 2 === 0 ? [[x, y0, z0], [x, y1, z1]] : [[x, y0, z1], [x, y1, z0]];
        addDiagonal(ends[0], ends[1], story, 'z');
      }
    }
  }
  return creates;
}

function braceBayNodes(data, target) {
  const { story, orientation, planeIndex, bayIndex } = target;
  const gridX = data.gridX || [
    (data.gridOriginX ?? 0) - data.bay, data.gridOriginX ?? 0, (data.gridOriginX ?? 0) + data.bay];
  const gridZ = data.gridZ || [
    (data.gridOriginZ ?? 0) - data.bay, data.gridOriginZ ?? 0, (data.gridOriginZ ?? 0) + data.bay];
  let y0, y1;
  if (data.model === 'user-frame') {
    y0 = data.storyLevels[story - 1];
    y1 = data.storyLevels[story];
  } else {
    const baseY = data.baseY ?? 0;
    y0 = baseY + (story === 1 ? 0 : (story - 1) * data.storyHeight);
    y1 = baseY + story * data.storyHeight - data.beamDepth;
  }
  if (orientation === 'x') {
    const z = gridZ[planeIndex === 0 ? 0 : gridZ.length - 1];
    return [[gridX[bayIndex], y0, z], [gridX[bayIndex], y1, z],
      [gridX[bayIndex + 1], y1, z], [gridX[bayIndex + 1], y0, z]];
  }
  const x = gridX[planeIndex === 0 ? 0 : gridX.length - 1];
  return [[x, y0, gridZ[bayIndex]], [x, y1, gridZ[bayIndex]],
    [x, y1, gridZ[bayIndex + 1]], [x, y0, gridZ[bayIndex + 1]]];
}

function braceDiagonalEndpoints(nodes, diagonal) {
  return diagonal === 0 ? [nodes[0], nodes[2]] : [nodes[3], nodes[1]];
}

function braceAnchorColumn(data, endpoint, thickness = S.braceThickness, extraTolerance = 0) {
  const columns = data.columns || blocks.filter(block => block.alive &&
    block.frame?.model === 'rc-frame' && block.frame.role === 'column');
  const maxColumnHalf = Math.max(data.columnSide || 0.4,
    ...columns.map(block => Math.max(block.size[0], block.size[2]))) / 2;
  const planTolerance = maxColumnHalf + thickness * 2 + extraTolerance + 0.05;
  const candidates = columns.filter(block => {
    const world = shapeWorld(block);
    const minX = Math.min(...world.map(point => point.x));
    const maxX = Math.max(...world.map(point => point.x));
    const minZ = Math.min(...world.map(point => point.z));
    const maxZ = Math.max(...world.map(point => point.z));
    const minY = Math.min(...world.map(point => point.y));
    const maxY = Math.max(...world.map(point => point.y));
    const dx = Math.max(minX - endpoint[0], 0, endpoint[0] - maxX);
    const dz = Math.max(minZ - endpoint[2], 0, endpoint[2] - maxZ);
    return dx <= planTolerance && dz <= planTolerance &&
      endpoint[1] >= minY - 0.35 && endpoint[1] <= maxY + 0.35;
  });
  return candidates.sort((a, b) => {
    const score = block => {
      const world = shapeWorld(block);
      const x = world.reduce((sum, point) => sum + point.x, 0) / world.length;
      const z = world.reduce((sum, point) => sum + point.z, 0) / world.length;
      return Math.hypot(x - endpoint[0], z - endpoint[2]) +
        Math.max(0, Math.min(...world.map(point => point.y)) - endpoint[1],
          endpoint[1] - Math.max(...world.map(point => point.y))) * 4;
    };
    return score(a) - score(b);
  })[0] || null;
}

function braceCreatesForBay(data, target) {
  const [bottomLeft, topLeft, topRight, bottomRight] = braceBayNodes(data, target);
  const frameData = { ...data };
  delete frameData.columns;
  delete frameData.frameMembers;
  const braceMat = 'steel';
  if (!jointKind(braceMat, braceMat)) return [];
  const thickness = target.thickness ?? S.braceThickness;
  frameData.braceThickness = thickness;
  const infillFaceOffset = braceInfillFaceOffset(data, target);
  const planeAxis = target.orientation === 'x' ? 2 : 0;
  const planeSide = target.planeIndex === 0 ? -1 : 1;
  const exteriorOffset = infillFaceOffset == null ? 0 :
    planeSide * (infillFaceOffset + thickness * 2);
  // Inset the diagonals slightly from the floor levels so the bars stay inside
  // the story and clear of the ground plane.
  const inset = Math.min(0.06, thickness);
  const safeBottom = Math.max(
    Number.isFinite(bottomLeft[1]) ? bottomLeft[1] : 0,
    data.baseY ?? 0,
    0.08
  );
  const safeTop = Math.min(topLeft[1], topRight[1]) - inset;
  const nodes = [bottomLeft, topLeft, topRight, bottomRight]
    .map((p, i) => [p[0], i < 2
      ? (i === 0 ? safeBottom + inset : safeTop)
      : (i === 2 ? safeTop : safeBottom + inset), p[2]]);
  // Stop the diagonals at the column faces (real braces bolt to the column, they do
  // not run through its centre). This also keeps perpendicular perimeter braces
  // from overlapping inside shared corner columns.
  const insetPlan = (data.columnHalf ?? (data.columnSide || 0.4) / 2) + thickness * 0.5;
  const planAxis = target.orientation === 'x' ? 0 : 2;
  for (let i = 0; i < nodes.length; i++) nodes[i][planAxis] += (i < 2 ? insetPlan : -insetPlan);
  const diagonals = target.diagonals || [0, 1];
  const creates = diagonals.map(diagonal => {
    const diagonalEndpoints = braceDiagonalEndpoints(nodes, diagonal);
    const layerOffset = (diagonal === 0 ? -1 : 1) * thickness * 1.2;
    const endpoints = diagonalEndpoints.map(point => {
      const offsetPoint = [...point];
      offsetPoint[planeAxis] += exteriorOffset + layerOffset;
      return offsetPoint;
    });
    const delta = new THREE.Vector3(
      endpoints[1][0] - endpoints[0][0],
      endpoints[1][1] - endpoints[0][1],
      endpoints[1][2] - endpoints[0][2]
    );
    const length = delta.length();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), delta.clone().normalize()
    );
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
    const anchors = endpoints.map(endpoint =>
      braceAnchorColumn(data, endpoint, thickness,
        infillFaceOffset == null ? 0 : infillFaceOffset + thickness * 3.2));
    return {
      mat: braceMat,
      size: [thickness, length, thickness],
      pos: [
        (endpoints[0][0] + endpoints[1][0]) / 2,
        (endpoints[0][1] + endpoints[1][1]) / 2,
        (endpoints[0][2] + endpoints[1][2]) / 2
      ],
      rot: [euler.x / DEG, euler.y / DEG, euler.z / DEG],
      frame: {
        ...frameData, role: 'brace', story: target.story, orientation: target.orientation,
        E: MATS[braceMat].E, endpoints, endpointLevels: [target.story - 1, target.story],
        anchorBlockIds: anchors.map(anchor => anchor?.id ?? null),
        gridBay: { story: target.story, orientation: target.orientation,
          planeIndex: target.planeIndex, bayIndex: target.bayIndex, diagonal,
          assemblyId: frameData.assemblyId }
      }
    };
  });
  return creates.some(create => create.frame.anchorBlockIds.some(id => id == null) ||
    create.frame.anchorBlockIds[0] === create.frame.anchorBlockIds[1]) ? [] : creates;
}

function braceInfillFaceOffset(data, target) {
  const grid = target.orientation === 'x' ? data.gridX : data.gridZ;
  const planeGrid = target.orientation === 'x' ? data.gridZ : data.gridX;
  const normalAxis = target.orientation === 'x' ? 2 : 0;
  const spanAxis = target.orientation === 'x' ? 0 : 2;
  const planeIndex = target.planeIndex === 0 ? 0 : planeGrid.length - 1;
  const plane = planeGrid[planeIndex];
  const side = target.planeIndex === 0 ? -1 : 1;
  const minSpan = Math.min(grid[target.bayIndex], grid[target.bayIndex + 1]);
  const maxSpan = Math.max(grid[target.bayIndex], grid[target.bayIndex + 1]);
  const assemblyId = data.assemblyId || 'legacy-frame';
  const panel = blocks.find(block => {
    if (!block.alive || block.frame?.role !== 'infill' ||
      block.frame.story !== target.story ||
      block.frame.orientation !== target.orientation ||
      (block.frame.assemblyId || 'legacy-frame') !== assemblyId) return false;
    const span = block.pos[spanAxis], panelPlane = block.pos[normalAxis];
    return span > minSpan && span < maxSpan &&
      (panelPlane - plane) * side > 0.01;
  });
  if (!panel) return null;
  const normalKey = normalAxis === 0 ? 'x' : 'z';
  const face = shapeWorld(panel).map(point => point[normalKey]);
  const outerFace = side < 0 ? Math.min(...face) : Math.max(...face);
  return Math.max(0, Math.abs(outerFace - plane));
}

// Reconstruct the actual column grid of a placed RC frame so retrofits land on the
// real building instead of the local coordinates used when the frame was placed.
function frameRetrofitData(frameMembers) {
  const data = frameMembers[0].frame;
  const columns = frameMembers.filter(b => b.alive && b.frame.role === 'column');
  if (!columns.length) return null;
  const cluster = (values, tolerance = 0.08) => {
    const groups = [];
    for (const value of [...values].sort((a, b) => a - b)) {
      const group = groups[groups.length - 1];
      if (group && Math.abs(value - group.sum / group.count) <= tolerance) {
        group.sum += value;
        group.count++;
      } else groups.push({ sum: value, count: 1 });
    }
    return groups.map(group => group.sum / group.count);
  };
  const gridX = cluster(columns.map(b => b.pos[0]));
  const gridZ = cluster(columns.map(b => b.pos[2]));
  if (gridX.length < 2 || gridZ.length < 2 || gridX.length > 8 || gridZ.length > 8) return null;
  const spacings = [
    ...gridX.slice(1).map((v, i) => v - gridX[i]),
    ...gridZ.slice(1).map((v, i) => v - gridZ[i])
  ].filter(v => v > 0.1);
  const baseY = Math.min(...columns.map(b => b.pos[1] - b.size[1] / 2));
  return {
    ...data, model: 'rc-frame', gridX, gridZ, columns,
    frameMembers: [...new Set(frameMembers)],
    suggestMat: dominantMaterial(columns),
    bay: data.bay || (spacings.length ? Math.min(...spacings) : 4),
    baseY,
    columnHalf: Math.max(...columns.map(b => Math.max(b.size[0], b.size[2]))) / 2,
    gridOriginX: (gridX[0] + gridX[gridX.length - 1]) / 2,
    gridOriginZ: (gridZ[0] + gridZ[gridZ.length - 1]) / 2
  };
}

function frameBaseIsolationCreates(data, frameMembers) {
  if (frameMembers.some(member => member.frame?.role === 'isolator')) return [];
  const footings = frameMembers.filter(member => member.alive && member.frame?.role === 'footing');
  if (footings.length < 4) return [];
  const frameData = { ...data };
  delete frameData.columns;
  delete frameData.frameMembers;
  const padThickness = 0.15, raftDepth = 0.6;
  const material = data.suggestMat || 'concrete';
  const pads = footings.map(footing => {
    const padSide = Math.max(data.columnSide || 0.4,
      Math.min(footing.size[0], footing.size[2]) * 0.75);
    const bottom = Math.min(...shapeWorld(footing).map(point => point.y));
    return {
      mat: 'rubber', size: [padSide, padThickness, padSide],
      pos: [footing.pos[0], bottom - padThickness / 2, footing.pos[2]],
      rot: [...footing.rot], foundation: true,
      frame: { ...frameData, role: 'isolator', story: 0 }
    };
  });
  const padBottom = Math.min(...pads.map(pad => pad.pos[1] - pad.size[1] / 2));
  const footingPoints = footings.flatMap(footing => shapeWorld(footing));
  const minX = Math.min(...footingPoints.map(point => point.x));
  const maxX = Math.max(...footingPoints.map(point => point.x));
  const minZ = Math.min(...footingPoints.map(point => point.z));
  const maxZ = Math.max(...footingPoints.map(point => point.z));
  const margin = 0.5;
  pads.push({
    mat: material,
    size: [maxX - minX + margin * 2, raftDepth, maxZ - minZ + margin * 2],
    pos: [(minX + maxX) / 2, padBottom - raftDepth / 2, (minZ + maxZ) / 2],
    rot: [0, 0, 0], foundation: true,
    frame: { ...frameData, role: 'footing', story: 0, baseMass: true }
  });
  return pads;
}

function userFrameBaseIsolationCreates(data) {
  const groundColumns = data.columns.filter(column =>
    column.alive && column.pos[1] - column.size[1] / 2 <= (data.storyLevels[0] ?? 0) + 0.02);
  const alreadyIsolated = groundColumns.length > 0 && groundColumns.every(column =>
    blocks.some(member => member.alive && member.mat === 'rubber' &&
      Math.abs(member.pos[0] - column.pos[0]) < 0.1 &&
      Math.abs(member.pos[2] - column.pos[2]) < 0.1 &&
      member.pos[1] + member.size[1] / 2 <= column.pos[1] - column.size[1] / 2 + 0.02));
  if (groundColumns.length < 4 || alreadyIsolated) return null;
  const supportDepth = 0.3, padThickness = 0.15, raftDepth = 0.45;
  const stackHeight = supportDepth;
  const totalMass = data.frameMembers.reduce((sum, member) => sum + member.mass, 0);
  const padArea = totalMass * G / (MATS.rubber.strength / SF);
  const minPadSide = Math.max(0.3, Math.sqrt(padArea / groundColumns.length));
  const moves = data.frameMembers.filter(member => member.alive).map(b => ({
    b, delta: [0, stackHeight, 0]
  }));
  const creates = [];
  for (const column of groundColumns) {
    const padSide = Math.max(minPadSide, data.columnSide,
      column.size[0] * 1.25, column.size[2] * 1.25);
    creates.push({
      mat: column.mat,
      size: [Math.max(padSide + 0.1, column.size[0]), supportDepth,
        Math.max(padSide + 0.1, column.size[2])],
      pos: [column.pos[0], supportDepth / 2, column.pos[2]],
      rot: [0, 0, 0], suggestionConnection: true
    });
    creates.push({
      mat: 'rubber', size: [padSide, padThickness, padSide],
      pos: [column.pos[0], -padThickness / 2, column.pos[2]],
      rot: [0, 0, 0], suggestedBearing: true, suggestionConnection: true
    });
  }
  const padCenters = groundColumns.map(column => column.pos);
  const padSides = groundColumns.map(column => Math.max(minPadSide, data.columnSide,
    column.size[0] * 1.25, column.size[2] * 1.25));
  const bounds = groundColumns.flatMap(column => shapeWorld(column));
  const minX = Math.min(...bounds.map(point => point.x));
  const maxX = Math.max(...bounds.map(point => point.x));
  const minZ = Math.min(...bounds.map(point => point.z));
  const maxZ = Math.max(...bounds.map(point => point.z));
  const maxPadSide = Math.max(...padSides);
  creates.push({
    mat: data.suggestMat || 'concrete',
    size: [maxX - minX + maxPadSide + 0.4, raftDepth,
      maxZ - minZ + maxPadSide + 0.4],
    pos: [(minX + maxX) / 2, -padThickness - raftDepth / 2, (minZ + maxZ) / 2],
    rot: [0, 0, 0], foundation: true, suggestionConnection: true
  });
  return { moves, creates, supportDepth, padThickness, raftDepth, stackHeight, padCenters };
}

// Equivalent-static story drift screen. Story shear V = 1.5*PGA*W_above uses the
// same 1.5 overturning factor as the rigid-block screen; stiffness comes from the
// same element model the Newmark run uses, so the two stay consistent.
const FRAME_BRACE_DRIFT = 0.004;
function frameStoryAssessment(data, model) {
  const floors = data.floors || model?.floors || 0;
  if (!floors || !model?.mass?.length) return [];
  const h = data.storyHeight || 3;
  const PGA = S.quake !== 'none'
    ? groundPeaks(QUAKES[S.quake]).resultant * (model?.baseIsolationFactor ?? 1) : 0;
  const out = [];
  let weightAbove = 0;
  for (let i = floors - 1; i >= 0; i--) {
    weightAbove += (model.mass[i] || 0) * G;
    const kx = model.baseKX?.[i] || 0, kz = model.baseKZ?.[i] || 0;
    const kMin = Math.min(kx, kz);
    const V = 1.5 * PGA * weightAbove;
    const drift = kMin > 0 ? Math.min(MAX_SCREEN_RATIO, V / kMin / Math.max(h, 1e-6))
      : (V > 0 ? MAX_SCREEN_RATIO : 0);
    out.unshift({ story: i + 1, h, kx, kz, kMin, V, drift });
  }
  return out;
}

// Lateral stiffness one X-braced bay adds, projected exactly like the Newmark
// story model: each diagonal is an axial rod E*A/L and only the plan-direction
// cosine squared reaches the story shear.
function braceBayStiffness(data, target, thickness) {
  const [bl, tl, tr, br] = braceBayNodes(data, target);
  let kx = 0, kz = 0;
  const E = MATS.steel.E, A = thickness * thickness;
  const nodes = [bl, tl, tr, br];
  for (const diagonal of target.diagonals || [0, 1]) {
    const [p0, p1] = braceDiagonalEndpoints(nodes, diagonal);
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 0.1) continue;
    const axialK = E * A / L;
    kx += axialK * (dx / L) ** 2;
    kz += axialK * (dz / L) ** 2;
  }
  return { kx, kz };
}

// A brace bay is only valid when both of its column lines exist at that story;
// otherwise the diagonals would anchor to nothing and fall in the rigid-body path.
function frameBayCornersExist(data, target) {
  const cols = data.columns || [];
  const nodes = braceBayNodes(data, target);
  const y0 = Math.min(...nodes.map(p => p[1])), y1 = Math.max(...nodes.map(p => p[1]));
  const at = (x, z) => cols.some(c => {
    const cy0 = c.pos[1] - c.size[1] / 2, cy1 = c.pos[1] + c.size[1] / 2;
    const coversStory = c.frame?.story != null
      ? c.frame.story === target.story
      : cy0 <= y0 + 0.35 && cy1 >= y1 - 0.35;
    return coversStory && Math.abs(c.pos[0] - x) < 0.15 && Math.abs(c.pos[2] - z) < 0.15;
  });
  if (target.orientation === 'x') {
    const z = data.gridZ[target.planeIndex === 0 ? 0 : data.gridZ.length - 1];
    return at(data.gridX[target.bayIndex], z) && at(data.gridX[target.bayIndex + 1], z);
  }
  const x = data.gridX[target.planeIndex === 0 ? 0 : data.gridX.length - 1];
  return at(x, data.gridZ[target.bayIndex]) && at(x, data.gridZ[target.bayIndex + 1]);
}

// Every bracing bay of one story as mirror-symmetric pairs, so any subset stays
// balanced in plan and does not introduce torsional eccentricity.
function frameBracePairs(data, story) {
  const targets = [];
  for (const orientation of ['x', 'z']) {
    const bays = (orientation === 'x' ? data.gridX.length : data.gridZ.length) - 1;
    const planes = (orientation === 'x' ? data.gridZ.length : data.gridX.length) > 1 ? 2 : 1;
    for (let planeIndex = 0; planeIndex < planes; planeIndex++)
      for (let bayIndex = 0; bayIndex < bays; bayIndex++)
        targets.push({ story, orientation, planeIndex, bayIndex, assemblyId: data.assemblyId });
  }
  const valid = new Set(targets.filter(t => frameBayCornersExist(data, t))
    .filter(t => braceAngleWithinPreferredRange(data, t))
    .map(t => `${t.orientation}:${t.planeIndex}:${t.bayIndex}`));
  const seen = new Set(), pairs = [];
  for (const t of targets) {
    const key = `${t.orientation}:${t.planeIndex}:${t.bayIndex}`;
    if (seen.has(key) || !valid.has(key)) continue;
    const bayCount = (t.orientation === 'x' ? data.gridX.length : data.gridZ.length) - 1;
    const planeCount = (t.orientation === 'x' ? data.gridZ.length : data.gridX.length) > 1 ? 2 : 1;
    const mirror = { story, orientation: t.orientation,
      planeIndex: planeCount - 1 - t.planeIndex, bayIndex: bayCount - 1 - t.bayIndex,
      assemblyId: data.assemblyId };
    const mirrorKey = `${mirror.orientation}:${mirror.planeIndex}:${mirror.bayIndex}`;
    if (mirrorKey === key) { seen.add(key); pairs.push([t, null]); continue; }
    if (!valid.has(mirrorKey)) continue;
    seen.add(key);
    seen.add(mirrorKey);
    pairs.push([t, mirror]);
  }
  return pairs;
}

// Realistic X-brace retrofit (ASCE 41 / FEMA P-58 practice): every valid perimeter
// bay pair of a flagged story is braced so the retrofit stays symmetric in plan,
// and each diagonal is sized for its share of the story shear. Both tension yield
// and Euler buckling are checked, which is what governs real brace sections.
function frameBraceSelection(data, story, demand) {
  const pairs = frameBracePairs(data, story);
  if (!pairs.length) return null;
  const missingPairs = pairs.map(pair => pair.filter(target => target &&
    braceDiagonalsForBay(data, target).size < 2)).filter(pair => pair.length);
  const newTargets = missingPairs.flat().map(target => {
    const existing = braceDiagonalsForBay(data, target);
    return { ...target, diagonals: [0, 1].filter(diagonal => !existing.has(diagonal)) };
  });
  if (!newTargets.length) return null;
  const V = Math.max(0, demand?.V || 0);
  const bayCount = newTargets.length;
  const nDiag = newTargets.reduce((sum, target) => sum + target.diagonals.length, 0);
  const geometries = newTargets.flatMap(target => {
    const nodes = braceBayNodes(data, target);
    return target.diagonals.map(diagonal => {
      const [p0, p1] = braceDiagonalEndpoints(nodes, diagonal);
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
      const length = Math.hypot(dx, dy, dz);
      const planDelta = target.orientation === 'x' ? dx : dz;
      return { length, projection: Math.abs(planDelta) / Math.max(length, 1e-8) };
    });
  });
  const cosT = Math.max(0.2, Math.min(...geometries.map(item => item.projection)));
  const F = Math.max(20e3, 1.5 * V / Math.max(1, nDiag) / cosT); // N per diagonal, 1.5x margin for dynamic amplification
  const L = Math.max(...geometries.map(item => item.length));
  const bm = MATS.steel;
  const Fy = bm.strength, phi = 0.9, E = bm.E;
  const tTension = Math.sqrt(F / (phi * Fy));
  const Ireq = F * (0.9 * L) ** 2 / (Math.PI ** 2 * E);
  const tBuckling = Math.pow(12 * Ireq, 0.25);
  const requiredX = Math.max(0, demand?.kReqX || 0);
  const requiredZ = Math.max(0, demand?.kReqZ || 0);
  let tStiffness = 0;
  for (let step = 4; step <= 30; step++) {
    const t = step * 0.005;
    const added = newTargets.reduce((sum, target) => {
      const stiffness = braceBayStiffness(data, target, t);
      return { x: sum.x + stiffness.kx, z: sum.z + stiffness.kz };
    }, { x: 0, z: 0 });
    if (added.x >= requiredX && added.z >= requiredZ) {
      tStiffness = t;
      break;
    }
  }
  if (!tStiffness) return { needsWall: true };
  const requiredThickness = Math.max(0.02, tTension, tBuckling, tStiffness);
  if (requiredThickness > 0.15) return { needsWall: true };
  const thickness = Math.ceil(requiredThickness / 0.005) * 0.005;
  const creates = [];
  for (const t of newTargets) creates.push(...braceCreatesForBay(data, { ...t, thickness }));
  if (creates.length !== nDiag) return { needsWall: true };
  return creates.length ? { creates, thickness, bays: bayCount } : null;
}

function analyze() {
  const list = blocks.filter(b => b.alive);
  const structMat = dominantMaterial(list);
  const { supOf, boxes, contactAreas } = geometrySupports(list);
  const W = computeLoads(list, supOf, b => b.pos[1], contactAreas);
  for (const b of list) {
    b.minY = boxes.get(b).min.y;
    b.load = boundedLoad(W.get(b) ?? 0);
    b.stress = stressFromLoad(b.load, representativeSection(b, 1).area);
    b.flexStress = 0;
    b.fos = factorOfSafety(MATS[b.mat].strength, b.stress);
    b.seismic = null;
  }
  const quake = S.quake !== 'none';
  const inputPeaks = quake ? groundPeaks(QUAKES[S.quake]) : { x: 0, z: 0, resultant: 0 };
  const PGAx = inputPeaks.x, PGAz = inputPeaks.z, PGA = inputPeaks.resultant, aD = PGA * G;
  const pairs = touchingPairs(list, boxes);
  buildJoints(pairs, W, aD);
  const braced = new Map();
  for (const b of list) for (const t of b.ties) {
    if (!braced.has(t.to)) braced.set(t.to, new Set());
    braced.get(t.to).add(t.axis);
  }

  const items = [];
  const PI2 = Math.PI ** 2;
  // Generated frames use the story model; do not reinterpret them as disconnected rigid chunks.
  const rigidBlocks = list.filter(b => !b.frame?.model);
  const rigidGroups = groupBy(rigidBlocks, joints.filter(j => j.holds && !j.a.frame?.model && !j.b.frame?.model));
  const frameMembers = list.filter(b => b.frame?.model === 'rc-frame');
  const assemblies = new Map();
  for (const member of frameMembers) {
    const key = member.frame.assemblyId || 'legacy-frame';
    if (!assemblies.has(key)) assemblies.set(key, []);
    assemblies.get(key).push(member);
  }
  const frameAssemblies = [...assemblies.values()];
  rigidGroups.push(...frameAssemblies);
  const userFrame = frameMembers.length ? null : frameGridForBraceTool();
  const protectedUserFrameMembers = new Set();
  for (const frameMembers of frameAssemblies) try {
    const retrofit = frameRetrofitData(frameMembers);
    const hasDampers = frameMembers.some(b => b.frame.role === 'damper');
    const assemblyId = frameMembers[0].frame.assemblyId;
    const priorRun = quake ? (lastFrameReports.find(report => report.assemblyId === assemblyId &&
      report.quake === S.quake) || (frameAssemblies.length === 1 &&
    lastFrameReport?.quake === S.quake ? lastFrameReport : null)) : null;
    const isolationCreates = quake && retrofit
      ? frameBaseIsolationCreates(retrofit, frameMembers) : [];
    const isolationPlan = { creates: isolationCreates, ignoreBlocks: new Set(frameMembers) };
    if (isolationCreates.length && planFree(isolationPlan)) {
      const bearingVolume = isolationCreates.reduce((sum, item) =>
        sum + item.size[0] * item.size[1] * item.size[2], 0);
      const bearingMass = isolationCreates.reduce((sum, item) =>
        sum + item.size[0] * item.size[1] * item.size[2] * MATS[item.mat].rho, 0);
      items.push({
        p: 2, sev: 'warn',
        text: `This RC frame already has individual column footings, which serve as the normal substructure. The retrofit places rubber isolators directly below those footings and a continuous lower foundation below the isolators. The bearings reduce the modeled input by 50%; bearing travel, uplift, anchorage, soil interaction, utility clearances, and code-required design are not verified.`,
        action: `Add rubber isolators and a continuous lower foundation beneath ${isolationCreates.length - 1} existing substructures`,
        cost: { m3: bearingVolume, kg: bearingMass },
        apply: () => executePlan(isolationPlan),
        autoKey: 'frame-base-isolation'
      });
    }
    const screeningModel = frameModelForRun(frameMembers, true);
    const softStories = [...new Set([
      ...(screeningModel?.softStoryStories || []),
      ...(priorRun?.softStoryStories || [])
    ])];
    const torsionStories = priorRun?.torsionStories || [];
    const retrofitStories = [...new Set([...softStories, ...torsionStories])];
    const assessment = retrofit && screeningModel ? frameStoryAssessment(retrofit, screeningModel) : [];
    const lateralStories = new Set();
    if (screeningModel) for (let i = 0; i < screeningModel.storyElements.length; i++) {
      if (screeningModel.storyElements[i].some(e => e.kind !== 'column')) lateralStories.add(i + 1);
    }
    const storyDemand = new Map(assessment.map(a => [a.story, a]));
    const braceStories = new Set(), wallStories = new Set();
    for (const a of assessment) {
      const soft = softStories.includes(a.story), torsion = torsionStories.includes(a.story);
      const noLateral = !lateralStories.has(a.story);
      if (a.drift > FRAME_BRACE_DRIFT || soft || torsion ||
        (quake && noLateral && a.drift > FRAME_BRACE_DRIFT * 0.5)) braceStories.add(a.story);
    }
    if (!assessment.length) for (const s of retrofitStories) braceStories.add(s);
    if (quake && retrofit) {
      for (let story = 1; story <= retrofit.floors; story++) braceStories.add(story);
    }
    const demandFor = a => {
      let kReqX = Math.max(0, a.V / (FRAME_BRACE_DRIFT * a.h) - a.kx);
      let kReqZ = Math.max(0, a.V / (FRAME_BRACE_DRIFT * a.h) - a.kz);
      if (softStories.includes(a.story)) {
        const above = storyDemand.get(a.story + 1);
        if (above) {
          kReqX = Math.max(kReqX, 0.7 * above.kx - a.kx);
          kReqZ = Math.max(kReqZ, 0.7 * above.kz - a.kz);
        }
      }
      if (kReqX > 0 || kReqZ > 0) {
        kReqX = Math.max(kReqX, 0.1 * a.kMin);
        kReqZ = Math.max(kReqZ, 0.1 * a.kMin);
      }
      return { V: a.V, h: a.h, kx: a.kx, kz: a.kz, kReqX, kReqZ };
    };
    const braceCreates = [], braceMeta = [];
    const braceRetrofit = retrofit ? { ...retrofit, suggestMat: 'steel' } : null;
    if (retrofit) for (const story of [...braceStories].sort((x, y) => x - y)) {
      const sel = frameBraceSelection(braceRetrofit, story,
        storyDemand.has(story) ? demandFor(storyDemand.get(story)) : null);
      if (sel?.needsWall) { wallStories.add(story); braceStories.delete(story); continue; }
      if (sel?.creates?.length) { braceCreates.push(...sel.creates); braceMeta.push({ story, ...sel }); }
    }
    const wallStoriesSorted = [...wallStories].sort((x, y) => x - y);
    const wallCreates = retrofit && wallStoriesSorted.length
      ? frameRetrofitCreates(retrofit, 'shear-wall') : [];
    const bracePlan = { creates: braceCreates, ignoreBlocks: new Set(frameMembers) };
    if (braceCreates.length && planFree(bracePlan)) {
      const volume = braceCreates.reduce((sum, item) => sum + item.size[0] * item.size[1] * item.size[2], 0);
      const stories = [...new Set(braceMeta.map(m => m.story))].sort((x, y) => x - y);
      const bays = braceMeta.reduce((sum, m) => sum + m.bays, 0);
      const tMax = Math.max(...braceMeta.map(m => m.thickness));
      const braceMat = braceCreates[0]?.mat || 'steel';
      const braceRho = braceCreates.reduce((sum, item) =>
        sum + item.size[0] * item.size[1] * item.size[2] * MATS[item.mat].rho, 0);
      items.push({
        p: -1, sev: 'warn',
        text: `Story drift screen (equivalent-static shear V = 1.5*PGA*W_above against the same story stiffness the Newmark model uses): ${softStories.length ? `soft-story ratios below 0.70 at stories ${softStories.join(', ')}; ` : ''}${torsionStories.length ? `torsional edge-drift above 1.20 at stories ${torsionStories.join(', ')}; ` : ''}stories ${stories.join(', ')} need more lateral stiffness. Mirror-symmetric bay pairs are braced to keep the retrofit balanced in plan. Steel diagonals are sized for their share of story shear with tension-yield and Euler-buckling checks; where generated masonry infill occupies a bay, braces sit outside it and transfer force to the frame columns. The model cannot identify unmodeled doors or windows, so verify each proposed bay is unobstructed; connection, collector and foundation details still require project-specific engineering.`,
        action: `Add ${bays} ${MATS[braceMat].name} X-brace bays at stories ${stories.join(', ')} (section ${tMax.toFixed(3)} m)`,
        cost: { m3: volume, kg: braceRho },
        apply: () => executePlan(bracePlan), autoKey: 'frame-x-bracing'
      });
    }
    const wallPlan = { creates: wallCreates, ignoreBlocks: new Set(frameMembers) };
    if (wallCreates.length && planFree(wallPlan)) {
      const volume = wallCreates.reduce((sum, item) => sum + item.size[0] * item.size[1] * item.size[2], 0);
      const wallRho = wallCreates.reduce((sum, item) =>
        sum + item.size[0] * item.size[1] * item.size[2] * MATS[item.mat].rho, 0);
      items.push({
        p: -1, sev: 'warn',
        text: `Stories ${wallStoriesSorted.join(', ')} need more lateral stiffness than the available X-brace section and bay layout can provide within the model limits. A symmetric four-panel ${MATS[wallCreates[0]?.mat || 'concrete'].name} core is extended from the foundation through every story to provide a continuous, balanced load path; the screening model assumes diaphragm collectors and does not verify their design, foundation capacity, coupling beams, reinforcement, or wall boundary elements.`,
        action: `Add a continuous balanced four-wall ${MATS[wallCreates[0]?.mat || 'concrete'].name} core from the foundation through all stories`,
        cost: { m3: volume, kg: wallRho },
        apply: () => executePlan(wallPlan), autoKey: 'frame-shear-walls'
      });
    }
    const groundColumns = retrofit.columns.filter(c =>
      c.alive && c.pos[1] - c.size[1] / 2 <= (retrofit.baseY ?? 0) + 0.02);
    const existingFootings = frameMembers.filter(b => b.frame?.role === 'footing');
    if (groundColumns.length && existingFootings.length < groundColumns.length) {
      const missingColumns = groundColumns.filter(c => jointKind(c.mat, c.mat) &&
        !existingFootings.some(f => Math.abs(f.pos[0] - c.pos[0]) < 0.12 &&
          Math.abs(f.pos[2] - c.pos[2]) < 0.12));
      const footingFrame = { ...retrofit };
      delete footingFrame.columns;
      delete footingFrame.frameMembers;
      const footingCreates = missingColumns.map(c => {
        const axialLoad = Math.max(c.load || 0, c.mass * G);
        const columnSide = Math.max(c.size[0], c.size[2]);
        let footingSide = Math.max(columnSide * 2.0,
          Math.sqrt(axialLoad * SF / SOIL_BEARING));
        footingSide = Math.ceil(footingSide * 20) / 20;
        const depth = 0.45;
        const footingMat = c.mat;
        return {
          mat: footingMat, size: [footingSide, depth, footingSide],
          pos: [c.pos[0], -depth / 2, c.pos[2]], rot: [0, 0, 0],
          foundation: true,
          frame: { ...footingFrame, role: 'footing', story: 0 }
        };
      });
      const footingPlan = { creates: footingCreates, ignoreBlocks: new Set(frameMembers) };
      if (footingCreates.length && planFree(footingPlan)) {
        const volume = footingCreates.reduce((sum, f) => sum + f.size[0] * f.size[1] * f.size[2], 0);
        const kg = footingCreates.reduce((sum, f) =>
          sum + f.size[0] * f.size[1] * f.size[2] * MATS[f.mat].rho, 0);
        items.push({
          p: 1, sev: 'warn',
          text: `The RC frame has ${missingColumns.length} column base${missingColumns.length === 1 ? '' : 's'} without a matched footing. These same-material isolated spreads establish a direct load path below each base rather than concentrating the retrofit under one column; the assumed allowable soil pressure of ${SOIL_BEARING / 1000} kPa is only a preliminary screen.`,
          action: `Add ${missingColumns.length} ${MATS[footingCreates[0]?.mat || 'concrete'].name} spread footing${missingColumns.length === 1 ? '' : 's'} below the column bases`,
          cost: { m3: volume, kg },
          apply: () => executePlan(footingPlan), autoKey: 'frame-foundations'
        });
      }
    }
    if (!hasDampers && priorRun && (priorRun.maxDrift > 0.015 || priorRun.maxRatio > 0.8)) {
      const creates = retrofit
        ? frameRetrofitCreates(retrofit, 'damper', retrofitStories.length ? retrofitStories : null)
        : frameRetrofitCreates({ ...frameMembers[0].frame,
            suggestMat: dominantMaterial(frameMembers.filter(member => member.frame.role === 'column')) },
          'damper', retrofitStories.length ? retrofitStories : null);
      if (creates.length && planFree({ creates, ignoreBlocks: new Set(frameMembers) })) {
        const volume = creates.reduce((sum, item) => sum + item.size[0] * item.size[1] * item.size[2], 0);
        const damperRho = creates.reduce((sum, item) =>
          sum + item.size[0] * item.size[1] * item.size[2] * MATS[item.mat].rho, 0);
        items.push({
          p: 1, sev: 'warn',
          text: `The prior ${QUAKES[S.quake].name} screening run reached ${(priorRun.maxDrift * 100).toFixed(2)}% peak drift. Viscous dampers may reduce response when engineered and detailed as a complete system; they do not replace adequate strength, stiffness, or a continuous load path.`,
          action: `Add idealized viscous damping devices${retrofitStories.length ? ` at stories ${retrofitStories.join(', ')}` : ' at each story'} (assumed 150 kN*s/m per device)`,
          cost: { m3: volume, kg: damperRho },
          apply: () => executePlan({ creates }), autoKey: 'frame-dampers'
        });
      }
    }
  } catch (err) { console.warn('Frame retrofit analysis failed:', err); }

  if (quake && userFrame?.model === 'user-frame' && userFrame.frameMembers?.length) {
    const spacings = [...userFrame.gridX.slice(1).map((value, index) => value - userFrame.gridX[index]),
      ...userFrame.gridZ.slice(1).map((value, index) => value - userFrame.gridZ[index])]
      .filter(spacing => spacing > 0.1);
    const typicalSpacing = spacings.length ? spacings.reduce((sum, spacing) => sum + spacing, 0) / spacings.length : 0;
    const regularGrid = typicalSpacing > 0 &&
      spacings.every(spacing => Math.abs(spacing - typicalSpacing) <= typicalSpacing * 0.25);
    if (regularGrid) {
      const creates = [];
      let totalBays = 0, maxThickness = 0;
      const weight = userFrame.frameMembers.reduce((sum, member) => sum + member.mass * G, 0);
      const storyLevels = userFrame.storyLevels;
      const pga = groundPeaks(QUAKES[S.quake]).resultant;
      for (let story = 1; story <= userFrame.floors; story++) {
        const height = Math.max(0.5, (storyLevels[story] ?? storyLevels[story - 1] + 3) -
          storyLevels[story - 1]);
        const shear = 1.5 * pga * weight;
        const selection = frameBraceSelection(userFrame, story, {
          V: shear, kReqX: 0, kReqZ: 0, h: height
        });
        if (selection?.creates?.length) {
          creates.push(...selection.creates);
          totalBays += selection.bays;
          maxThickness = Math.max(maxThickness, selection.thickness);
        }
      }
      const ignoreBlocks = new Set(userFrame.frameMembers);
      if (creates.length && planFree({ creates, ignoreBlocks })) {
        for (const member of userFrame.frameMembers) protectedUserFrameMembers.add(member);
        const material = creates[0].mat;
        const volume = creates.reduce((sum, brace) =>
          sum + brace.size[0] * brace.size[1] * brace.size[2], 0);
        const mass = creates.reduce((sum, brace) =>
          sum + brace.size[0] * brace.size[1] * brace.size[2] * MATS[brace.mat].rho, 0);
        items.push({
          p: -1, sev: 'warn',
          text: `This regular user-built frame has a continuous column grid. Balanced steel X-bracing is proposed at its supported perimeter bays on each story, with diagonal angles screened to the typical 30-60 degree range. Braces connect to the frame columns, not masonry. The model cannot identify unmodeled doors or windows, so verify each proposed bay is unobstructed; gusset/anchor details, collectors, foundations, and code compliance still require project-specific engineering.`,
          action: `Add ${totalBays} steel X-brace bays across ${userFrame.floors} stories (up to ${maxThickness.toFixed(3)} m section)`,
          cost: { m3: volume, kg: mass },
          apply: () => executePlan({ creates, ignoreBlocks }),
          autoKey: 'user-frame-x-bracing'
        });
      }
      const baseIsolation = userFrameBaseIsolationCreates(userFrame);
      const baseIsolationPlan = baseIsolation ? {
        moves: baseIsolation.moves, creates: baseIsolation.creates,
        ignoreBlocks: new Set(userFrame.frameMembers)
      } : null;
      if (baseIsolation && baseIsolation.creates.length && planFree(baseIsolationPlan)) {
        for (const member of userFrame.frameMembers) protectedUserFrameMembers.add(member);
        const volume = baseIsolation.creates.reduce((sum, item) =>
          sum + item.size[0] * item.size[1] * item.size[2], 0);
        const mass = baseIsolation.creates.reduce((sum, item) =>
          sum + item.size[0] * item.size[1] * item.size[2] * MATS[item.mat].rho, 0);
        items.push({
          p: 2, sev: 'warn',
          text: `This regular user-built frame is raised ${baseIsolation.stackHeight.toFixed(2)} m onto same-material substructures above buried rubber isolators and an underground continuous foundation. This is a conceptual isolation retrofit; the model does not verify bearing travel, uplift, anchorage, soil interaction, utility clearances, or code-required design.`,
          action: `Raise the frame onto ${baseIsolation.padCenters.length} substructure / rubber isolator / lower foundation stacks`,
          cost: { m3: volume, kg: mass },
          apply: () => executePlan(baseIsolationPlan),
          autoKey: 'user-frame-base-isolation'
        });
      }
    }
  }

  const SOIL_BEARING = 200e3; // Pa - assumed allowable soil bearing pressure for screening suggestions
  for (const b of list) {
    if (b.frame?.model === 'rc-frame') continue;
    if (protectedUserFrameMembers.has(b)) continue;
    const m = MATS[b.mat], sup = supOf.get(b), load = b.load, minY = b.minY;
    const [w, h, d] = b.size;
    const box = boxes.get(b);
    const worldSize = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    const bw = Math.min(worldSize[0], worldSize[2]), longAx = worldSize[0] >= worldSize[2] ? 0 : 2;
    const Llong = worldSize[longAx], worldHeight = worldSize[1];
    const area = minimumSection(b, 1).area, tag = `${m.name} #${b.id}`;
    const issues = [], opts = [];
    let shearLinkNeed = false;
    let p = 9;
    const opt = (cost, action, plan, rho) => { if (plan && planFree(plan)) opts.push({ cost, action, plan, rho }); };
    const bearsOnBlock = (x, z, y) => list.some(o => {
      const bb = boxes.get(o);
      return Math.abs(bb.max.y - y) <= 0.02 && x > bb.min.x - 1e-6 && x < bb.max.x + 1e-6 &&
        z > bb.min.z - 1e-6 && z < bb.max.z + 1e-6;
    });
    const spreadFooting = (x, z, P, s) => {
      const fDepth = 0.45;
      let fSide = Math.max(s + 0.3, Math.sqrt(P * SF / SOIL_BEARING));
      for (let i = 0; i < 3; i++) fSide = Math.max(s + 0.3,
        Math.sqrt((P + m.rho * fSide * fSide * fDepth * G) * SF / SOIL_BEARING));
      return { mat: b.mat, size: [fSide, fDepth, fSide], pos: [x, -fDepth / 2, z],
        rot: [0, 0, 0], foundation: true, suggestionConnection: true };
    };
    const pillarPairOpt = (x, z, lo, hi, axis, top, P) => {
      if (!jointKind(b.mat, b.mat)) return;
      const creates = [];
      let totalVolume = 0;
      const locations = [lo + (hi - lo) / 3, lo + 2 * (hi - lo) / 3];
      for (const coordinate of locations) {
        const px = axis === 0 ? coordinate : x;
        const pz = axis === 2 ? coordinate : z;
        const base = supportTopBelow(px, pz, top, list, boxes);
        const height = top - base;
        if (height <= 0.02) return;
        const tributaryLoad = P / locations.length;
        const section = sturdyPillarSection(list, b.mat, tributaryLoad, height, PGA);
        if (!section.adequate) return;
        const side = Math.ceil(Math.max(section.width, section.depth) * 1.5 * 20) / 20;
        const onSoil = base <= 0.02 && !bearsOnBlock(px, pz, 0);
        if (onSoil) creates.push(spreadFooting(px, pz, tributaryLoad, side));
        creates.push({
          mat: b.mat, size: [side, height, side],
          pos: [px, (base + top) / 2, pz], rot: [0, 0, 0],
          suggestionConnection: true
        });
        totalVolume += side * side * height;
      }
      totalVolume += creates.filter(create => create.foundation)
        .reduce((sum, footing) => sum + footing.size[0] * footing.size[1] * footing.size[2], 0);
      opt(totalVolume,
        `add a pair of ${MATS[b.mat].name} support piers (${locations.length} beam connections)${creates.some(create => create.foundation) ? ' on spread footings' : ''}`,
        { creates }, m.rho);
    };

    // A. Beams: horizontal members spanning between real supports.
    const isBeam = Llong >= 2 * worldHeight && Llong >= 2 * bw && sup.length > 0 && !sup.includes(GROUND);
    if (isBeam) {
      const bmin = box.min.getComponent(longAx), bmax = box.max.getComponent(longAx);
      const iv = [];
      for (const s of sup) {
        if (s === GROUND) continue;
        const sb = boxes.get(s);
        const lo = Math.max(sb.min.getComponent(longAx), bmin), hi = Math.min(sb.max.getComponent(longAx), bmax);
        if (hi > lo) iv.push([lo, hi]);
      }
      iv.sort((x, y) => x[0] - y[0]);
      const mg = [];
      for (const [lo, hi] of iv) {
        if (mg.length && lo <= mg[mg.length - 1][1] + 1e-3) mg[mg.length - 1][1] = Math.max(mg[mg.length - 1][1], hi);
        else mg.push([lo, hi]);
      }
      const gaps = [];
      let cur = bmin;
      for (const [lo, hi] of mg) { if (lo - cur > 0.01) gaps.push({ a: cur, b: lo }); cur = Math.max(cur, hi); }
      if (bmax - cur > 0.01) gaps.push({ a: cur, b: bmax });
      const sectionCoordinate = (bmin + bmax) / 2;
      const section = blockSectionProperties(b, longAx, sectionCoordinate);
      const verticalDepth = Math.max(worldHeight, 1e-6);
      const q = boundedLoad(load / Math.max(Llong, 1e-6));
      const Sx = Math.max(section.Su, MIN_SECTION_AREA * verticalDepth);
      const Ix = Math.max(section.Iu, MIN_SECTION_AREA * verticalDepth ** 2);
      const fAllow = m.fb / SF;
      for (const g of gaps) {
        const Lg = g.b - g.a, cant = g.a === bmin || g.b === bmax;
        const M = cant ? q * Lg * Lg / 2 : q * Lg * Lg / 8;
        const shearDemand = q * Lg / 2;
        const shearCapacity = shearLinkEffects(b).shearCapacity;
        if (shearDemand > shearCapacity / SF) {
          issues.push(`has an estimated support shear of ${(shearDemand / 1000).toFixed(1)} kN against the ${SF}x screening limit`);
          shearLinkNeed = isEligibleShearLinkMember(b);
          p = Math.min(p, 1);
        }
        const sigma = stressFromLoad(M, Sx);
        b.flexStress = Math.max(b.flexStress, sigma);
        const delta = cant ? q * Lg ** 4 / (8 * m.E * Ix) : 5 * q * Lg ** 4 / (384 * m.E * Ix);
        if (sigma <= fAllow && delta <= Lg / 360) continue;
        issues.push(`spans ${Lg.toFixed(2)} m with bending ${(sigma / 1e6).toFixed(2)} MPa (allowable ${(fAllow / 1e6).toFixed(2)}) and deflection ${(delta * 1000).toFixed(1)} mm (limit ${(Lg / 360 * 1000).toFixed(1)})`);
        p = Math.min(p, 1);
        const depthScaleBending = Math.sqrt(Math.max(1, sigma * SF / Math.max(m.fb, 1)));
        const depthScaleDeflection = Math.cbrt(Math.max(1, delta / Math.max(Lg / 360, 1e-9)));
        const hNew = verticalDepth * Math.max(depthScaleBending, depthScaleDeflection);
        if (hNew > verticalDepth && b.rot.every(value => Math.abs(value % 180) < 1e-6)) {
          const localTarget = b.size.map((size, axis) => axis === 1
            ? size * hNew / Math.max(verticalDepth, 1e-6) : size);
          opt(Llong * bw * (hNew - verticalDepth), `deepen beam to ${hNew.toFixed(2)} m`,
            { resizes: [{ b, target: localTarget }] }, m.rho);
        }
        if (!cant) {
          const mid = (g.a + g.b) / 2;
          const x = longAx === 0 ? mid : b.pos[0], z = longAx === 2 ? mid : b.pos[2];
          pillarPairOpt(x, z, g.a, g.b, longAx, minY, q * Lg);
        }
        break;   // one span at a time; the next analysis checks the rest
      }
    }

    // B. Columns: Euler buckling.
    const vertical = worldHeight >= 2 * bw && !isBeam && sup.length > 0;
    if (vertical) {
      const br = braced.get(b.id) || new Set();
      const lenX = br.has('x') ? worldHeight / 2 : worldHeight;
      const lenZ = br.has('z') ? worldHeight / 2 : worldHeight;
      const columnSection = minimumSection(b, 1);
      b.stress = stressFromLoad(load, columnSection.area);
      b.fos = factorOfSafety(m.strength, b.stress);
      const NX = PI2 * m.E * columnSection.Iv / (lenX * lenX);   // sway in x
      const NZ = PI2 * m.E * columnSection.Iu / (lenZ * lenZ);   // sway in z
      const Ncr = Math.min(NX, NZ);
      if (load * SF > Ncr) {
        issues.push(`buckles under ${(load / 1000).toFixed(0)} kN (Euler load ${(Ncr / 1000).toFixed(0)} kN, needs ${SF}x)`);
        p = Math.min(p, 1);
        if (minY <= 0.02) for (const ax of [0, 2]) {
          const axl = ax === 0 ? 'x' : 'z';
          if (br.has(axl)) continue;
          const c = neighbourCol(b, ax, list, boxes);
          if (!c) continue;
          const cHeight = boxes.get(c).max.y - boxes.get(c).min.y;
          const cSection = minimumSection(c, 1);
          const lx = ax === 0 ? worldHeight / 2 : lenX, lz = ax === 2 ? worldHeight / 2 : lenZ;
          const cx = ax === 0 ? cHeight / 2 : cHeight, cz = ax === 2 ? cHeight / 2 : cHeight;
          const Nn = Math.min(
            PI2 * m.E * columnSection.Iv / (lx * lx),
            PI2 * m.E * columnSection.Iu / (lz * lz),
            PI2 * m.E * cSection.Iv / (cx * cx),
            PI2 * m.E * cSection.Iu / (cz * cz)
          );
          if (Nn < load * SF) continue;
          const bar = barCreate(b, c, ax);
          if (!bar) continue;
          opt(bar.size[0] * bar.size[1] * bar.size[2], `cross bar ${bar.size[ax].toFixed(2)} m to column #${c.id}`, { creates: [bar] }, MATS[bar.mat].rho);
        }
        const sReq = Math.pow(load * SF / Math.max(Ncr, 1e-9), 0.25);
        if (sReq > 1 + 1e-6) {
          const nw = w * sReq, nd = d * sReq;
          opt((nw * nd - w * d) * h, `thicken column to ${nw.toFixed(2)} x ${nd.toFixed(2)} m`, { resizes: [{ b, target: [nw, h, nd] }] }, m.rho);
        }
      }
    }

    // C. Crushing.
    if (vertical && b.fos < SF) {
      issues.push(`crushes: ${(b.stress / 1e6).toFixed(2)} MPa against ${(m.strength / 1e6).toFixed(0)} MPa (FoS ${b.fos.toFixed(2)})`);
      p = Math.min(p, 4);
      const s = Math.sqrt(load * SF / (m.strength * area));
      opt((s * s - 1) * area * h, `enlarge footprint by ${s.toFixed(2)}x`, { resizes: [{ b, target: [w * s, h, d * s] }] }, m.rho);
    }

    if (b.foundation) {
      const bearingArea = contactAreas.get(b)?.get(GROUND) ?? groundContactArea(b);
      const bearing = stressFromLoad(load, bearingArea);
      if (bearing > SOIL_BEARING) {
        issues.push(`soil bearing ${(bearing / 1e3).toFixed(0)} kPa exceeds the assumed allowable ${SOIL_BEARING / 1e3} kPa`);
        p = Math.min(p, 2);
        const s = Math.sqrt(bearing * SF / SOIL_BEARING);
        const tw = w * s, td = d * s;
        opt((tw * td - area) * h, `enlarge footing to ${tw.toFixed(2)} x ${td.toFixed(2)} m`,
          { resizes: [{ b, target: [tw, h, td] }] }, m.rho);
      }
    }

    if (issues.length) {
      const sev = p <= 1 ? 'bad' : 'warn';
      if (opts.length) {
        opts.sort((x, y) => x.cost - y.cost);
        const o = opts[0];
        items.push({ p, sev, text: `${tag}: ${issues.join('; ')}.`, action: o.action,
          cost: { m3: o.cost, kg: o.cost * o.rho }, apply: () => executePlan(o.plan) });
      } else {
        items.push({ p, sev, text: `${tag}: ${issues.join('; ')}. No safe automatic retrofit fits the current geometry and 12 m sandbox limits.`, action: 'No feasible automatic change found in this sandbox', cost: null, apply: null });
      }
      const needsConfinement = vertical && ['concrete', 'brick'].includes(m.fam) &&
        issues.some(issue => issue.startsWith('crushes:'));
      if (shearLinkNeed || needsConfinement) {
        const retrofit = shearLinkSuggestion(b,
          shearLinkNeed
            ? `Member #${b.id} exceeds the simplified support-shear screening limit. Closely spaced steel ties may contribute transverse shear resistance and confinement; anchorage and beam-column joint design are not checked.`
            : `Concrete column #${b.id} exceeds the simplified axial-crushing screen. Transverse steel ties can provide confinement in this model, but the result is only a heuristic and does not verify longitudinal reinforcement or detailing.`,
          0);
        if (retrofit && !items.some(item => item.autoKey === retrofit.autoKey)) items.push(retrofit);
      }
    }
  }

  // A fastened assembly is checked as one rigid body for gravity stability.
  for (const comp of rigidGroups) {
    if (comp.some(block => block.frame?.model === 'rc-frame')) continue;
    if ([...protectedUserFrameMembers].some(block => comp.includes(block))) continue;
    const members = new Set(comp);
    const externalSupport = comp.some(b => (supOf.get(b) || []).some(s => s === GROUND || !members.has(s)));

    let mass = 0, cx = 0, cy = 0, cz = 0;
    for (const b of comp) {
      const local = centroidOf(b.verts, orientFaces(b.verts));
      const world = local.applyQuaternion(quatOf(b.rot)).add(v3(b.pos));
      mass += b.mass;
      cx += b.mass * world.x;
      cy += b.mass * world.y;
      cz += b.mass * world.z;
    }
    if (mass <= 0) continue;
    cx /= mass; cy /= mass; cz /= mass;
    const grounded = comp.filter(b => b.foundation || (supOf.get(b) || []).includes(GROUND));
    const contacts = [];
    for (const b of grounded) {
      const points = shapeWorld(b);
      const baseY = Math.min(...points.map(point => point.y));
      for (const point of points) if (Math.abs(point.y - baseY) <= 1e-4) contacts.push([point.x, point.z]);
    }
    for (const b of comp) {
      const B = boxes.get(b);
      for (const s of supOf.get(b) || []) {
        if (s === GROUND || members.has(s)) continue;
        const A = boxes.get(s);
        const loX = Math.max(A.min.x, B.min.x), hiX = Math.min(A.max.x, B.max.x);
        const loZ = Math.max(A.min.z, B.min.z), hiZ = Math.min(A.max.z, B.max.z);
        if (hiX - loX <= 0.01 || hiZ - loZ <= 0.01) continue;
        contacts.push([loX, loZ], [hiX, loZ], [hiX, hiZ], [loX, hiZ]);
      }
    }
    const supportHull = hull2(contacts);
    const hasSupportPolygon = supportHull.length >= 3;
    const margin = hasSupportPolygon ? polygonMargin(supportHull, [cx, cz]) : null;
    const noGroundPath = grounded.length === 0 && !externalSupport;
    const hullSpan = supportHull.length >= 3
      ? Math.min(
        Math.max(...supportHull.map(p => p[0])) - Math.min(...supportHull.map(p => p[0])),
        Math.max(...supportHull.map(p => p[1])) - Math.min(...supportHull.map(p => p[1])))
      : 0;
    const requiredMargin = Math.min(0.5, Math.max(0.05, 0.1 * hullSpan));
    if (!noGroundPath && margin !== null && margin >= requiredMargin) continue;

    const label = comp.length > 1
      ? `Connected group of ${comp.length} blocks`
      : `${MATS[comp[0].mat].name} block`;
    const issue = noGroundPath
      ? `${label} is not connected by contact to the ground`
      : `${label} may tip because its center of mass is too close to or outside its base support area`;
    const supportOption = pierSupportOption(comp, mass, cx, cz, contacts, requiredMargin, PGA);
    if (supportOption) {
      const n = supportOption.plan.creates.filter(c => !c.foundation).length;
      const pierMat = supportOption.plan.creates[0]?.mat || structMat;
      supportOption.action = `Add ${n} idealized ${MATS[pierMat].name} pier${n === 1 ? '' : 's'} with spread footings to bring its center of mass inside the support polygon`;
    }
    items.push({
      p: noGroundPath ? 0 : 1,
      sev: 'bad',
      text: `${issue}. Total mass ${(mass / 1000).toFixed(1)} t; balance point (${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}) m${margin !== null && Number.isFinite(margin) ? `; base margin ${margin.toFixed(2)} m (target ${requiredMargin.toFixed(2)} m)` : ''}. A real load path needs continuous, touching supports down to the ground.`,
      action: supportOption ? supportOption.action : 'No automatic support layout fits without collisions; connect the load-bearing members to a continuous foundation',
      cost: supportOption ? { m3: supportOption.volume,
        kg: supportOption.plan.creates.reduce((sum, c) =>
          sum + c.size[0] * c.size[1] * c.size[2] * MATS[c.mat].rho, 0) } : null,
      apply: supportOption ? () => executePlan(supportOption.plan) : null
    });
  }

  // Revisit members with prior fractures or repeated near-capacity demand.
  const profile = learningProfile(S.quake, false);
  const memberHistory = { ...(profile?.members || {}) };
  for (const joint of joints) {
    const history = profile?.joints?.[jointLearningKey(joint)];
    const recentRatio = history?.recentRatio ?? history?.ratio;
    if (!history || recentRatio < 0.8) continue;
    for (const block of [joint.a, joint.b]) {
      const key = memberLearningKey(block);
      const member = memberHistory[key] || profile.members[key] || {
        id: block.id, material: MATS[block.mat].name, ratio: 0,
        samples: 0, fractures: 0
      };
      if (recentRatio >= (member.recentRatio ?? member.ratio ?? 0)) {
        member.mode = 'joint separation';
        member.recentMode = 'joint separation';
        member.recentRatio = recentRatio;
        member.jointRatio = history.ratio;
        member.jointFailures = history.recentFailures || 0;
        member.jointPosition = history.position;
      }
      memberHistory[key] = member;
    }
  }
  for (const [key, history] of Object.entries(memberHistory)) {
    const b = list.find(member => memberLearningKey(member) === key ||
      key.startsWith(`${member.id}:${member.mat}:`));
    // RC frames keep their dedicated drift-based X-bracing and base-isolation retrofit path.
    if (b?.frame?.model === 'rc-frame') continue;
    const riskRatio = history.recentRatio ?? history.ratio;
    const mode = history.recentMode || history.mode;
    if (b?.learnedRetrofitRiskRatio) continue;
    if (b && riskRatio >= 0.8 && ['member shear', 'column shear'].includes(mode) &&
      isEligibleShearLinkMember(b) && !b.shearLinks) {
      const retrofit = shearLinkSuggestion(b,
        `Prior ${QUAKES[S.quake]?.name || 'gravity'} runs recorded peak shear demand for concrete/brick member #${b.id} (${history.fractures || 0} fracture${history.fractures === 1 ? '' : 's'}, ${history.samples || 0} observation${history.samples === 1 ? '' : 's'}). Steel transverse ties are offered as a conceptual shear/confinement retrofit; anchorage, bar development, and joint capacity are not checked.`,
        0);
      if (retrofit && !items.some(item => item.autoKey === retrofit.autoKey)) {
        retrofit.sev = 'bad';
        items.push(retrofit);
      }
      continue;
    }
    if (!b || !Number.isFinite(riskRatio) || riskRatio < 0.8 ||
      !['Euler buckling', 'flexural strength', 'axial compression', 'member shear', 'column shear',
        'brace constraint buckling', 'brace constraint rupture', 'joint separation',
        'modeled demand'].includes(mode)) continue;
    const exponent = mode === 'Euler buckling' ? 0.25
      : mode === 'flexural strength' ? 1 / 3 : 0.5;
    const escalation = 1 + 0.2 * Math.max(0, (history.fractures || 0) - 1) +
      0.1 * (history.jointFailures || 0);
    const sectionScale = Math.min(2, Math.pow(Math.max(1.15, riskRatio * 1.1 * escalation), exponent));
    const target = [b.size[0] * sectionScale, b.size[1], b.size[2] * sectionScale];
    const isPillar = b.size[1] >= 1.5 * Math.max(b.size[0], b.size[2]);
    if (isPillar) {
      const peerPillars = list.filter(member => member !== b && member.mat === b.mat &&
        member.size[1] >= 1.5 * Math.max(member.size[0], member.size[2]));
      target[0] = Math.max(MIN_PILLAR_SECTION, b.size[0],
        ...peerPillars.map(member => member.size[0]), target[0]);
      target[2] = Math.max(MIN_PILLAR_SECTION, b.size[2],
        ...peerPillars.map(member => member.size[2]), target[2]);
    }
    const plan = { resizes: [{ b, target }] };
    const withinModelLimits = Math.max(target[0], target[1], target[2]) <= 12;
    const valid = withinModelLimits && planFree(plan);
    const sectionAction = `${isPillar ? 'Strengthen pillar' : 'Increase member'} #${b.id} cross-section to ${target[0].toFixed(2)} x ${target[2].toFixed(2)} m`;
    const volume = (target[0] * target[1] * target[2]) - (b.size[0] * b.size[1] * b.size[2]);
    items.push({
      p: -1 - Math.min(3, riskRatio + 0.25 * (history.fractures || 0) +
        0.25 * (history.jointFailures || 0)),
      sev: 'bad',
      text: `Run history identifies ${MATS[b.mat].name} ${isPillar ? 'pillar' : 'member'} #${b.id} as a ${history.fractures ? 'fractured' : 'high-demand'} zone: latest demand/capacity ${riskRatio.toFixed(2)}x (historical peak ${history.ratio.toFixed(2)}x), peak ${mode}, peak stress ${((history.peakStress || 0) / 1e6).toFixed(2)} MPa, ${history.fractures || 0} fracture${history.fractures === 1 ? '' : 's'} across ${history.samples || 0} run${history.samples === 1 ? '' : 's'}${history.jointFailures ? ` and ${history.jointFailures} joint separation${history.jointFailures === 1 ? '' : 's'}` : ''}. The section increase escalates with repeated failures; ${isPillar ? 'pillar dimensions remain at least 0.50 m and match or exceed existing columns' : 'the member section is increased'}; connections, reinforcement, and constructability are not checked.`,
      action: valid ? sectionAction : withinModelLimits
        ? 'The learned section increase collides with existing members; revise the layout or use a designed support'
        : 'No section increase offered: this member would exceed the 12 m sandbox model limit',
      cost: valid ? { m3: volume, kg: volume * MATS[b.mat].rho } : null,
      apply: valid ? () => {
        if (!executePlan(plan)) return false;
        b.learnedRetrofitRiskRatio = riskRatio;
        return true;
      } : null,
      autoKey: `learned-member:${b.id}`
    });
  }

  // F. Equivalent-static earthquake screen for each fastened, ground-supported assembly.
  if (quake) for (const comp of rigidGroups) {
    if (comp.some(block => block.frame?.model === 'rc-frame')) continue;
    if ([...protectedUserFrameMembers].some(block => comp.includes(block))) continue;
    const overturnFactor = 1.5;
    const slidingFactor = 1.2;
    let M = 0, cx = 0, cy = 0, cz = 0;
    for (const b of comp) {
      const local = centroidOf(b.verts, orientFaces(b.verts));
      const world = local.applyQuaternion(quatOf(b.rot)).add(v3(b.pos));
      M += b.mass;
      cx += b.mass * world.x; cy += b.mass * world.y; cz += b.mass * world.z;
    }
    if (M <= 0) continue;
    cx /= M; cy /= M; cz /= M;
    const baseMembers = comp.filter(b => b.foundation || b.minY <= 0.02);
    if (!baseMembers.length) continue;
    const foundationMembers = baseMembers.filter(b => b.foundation);
    const supports = foundationMembers.length ? foundationMembers : baseMembers;
    const supportLevel = Math.min(...supports.map(b => Math.min(...shapeWorld(b).map(p => p.y))));
    const supportPoints = [];
    for (const b of supports) for (const p of shapeWorld(b)) {
      if (Math.abs(p.y - supportLevel) < 1e-4) supportPoints.push([p.x, p.z]);
    }
    const hull = hull2(supportPoints);
    if (hull.length < 3) continue;
    const x0 = Math.min(...hull.map(p => p[0])), x1 = Math.max(...hull.map(p => p[0]));
    const z0 = Math.min(...hull.map(p => p[1])), z1 = Math.max(...hull.map(p => p[1]));
    const xCenter = (x0 + x1) / 2, zCenter = (z0 + z1) / 2;
    const hc = Math.max(0.05, cy - supportLevel);
    const designOffsetX = overturnFactor * PGAx * hc;
    const designOffsetZ = overturnFactor * PGAz * hc;
    const marginDesign = Math.min(
      polygonMargin(hull, [cx - designOffsetX, cz - designOffsetZ]),
      polygonMargin(hull, [cx - designOffsetX, cz + designOffsetZ]),
      polygonMargin(hull, [cx + designOffsetX, cz - designOffsetZ]),
      polygonMargin(hull, [cx + designOffsetX, cz + designOffsetZ])
    );
    const mu = Math.min(...supports.map(b => Math.sqrt(MATS[b.mat].mu * MU_GROUND)));
    const slideRatio = factorOfSafety(mu, slidingFactor * PGA);
    const overturn = marginDesign < 0.05;
    const slide = slideRatio < 1;
    const staticMargin = polygonMargin(hull, [cx, cz]);
    for (const b of comp) b.seismic = { aTip: G * Math.max(0, staticMargin) / hc, aSlide: mu * G, hc, PGA };
    if (!overturn && !slide) continue;
    if (overturn) {
      const pierOption = pierSupportOption(comp, M, cx, cz, supportPoints, 0.05, PGA);
      if (pierOption) {
        const n = pierOption.plan.creates.filter(c => !c.foundation).length;
        const pierMat = pierOption.plan.creates[0]?.mat || structMat;
        const pierRho = pierOption.plan.creates.reduce((sum, c) =>
            sum + c.size[0] * c.size[1] * c.size[2] * MATS[c.mat].rho, 0) /
          Math.max(pierOption.volume, 1e-9);
        items.push({
          p: -1,
          sev: 'warn',
          text: `Earthquake (design input envelope: ${PGAx.toFixed(2)} g X, ${PGAz.toFixed(2)} g Z): the group has only ${Math.max(0, marginDesign).toFixed(2)} m margin under ${overturnFactor.toFixed(2)}x equivalent-static overturning demand. ${MATS[pierMat].name} piers with spread footings under the overhanging members widen the support polygon so the center of mass stays inside it; pier sections come from crushing and Euler-buckling checks on the full group weight.`,
          action: `Add ${n} ${MATS[pierMat].name} pier${n === 1 ? '' : 's'} with spread footings under the overhanging members to resist overturning`,
          cost: { m3: pierOption.volume, kg: pierOption.volume * pierRho },
          apply: () => executePlan(pierOption.plan)
        });
      }
    }

    const text = `Earthquake (design input envelope: ${PGAx.toFixed(2)} g X, ${PGAz.toFixed(2)} g Z): this fastened group ${[
      overturn ? `has only ${Math.max(0, marginDesign).toFixed(2)} m margin under ${overturnFactor.toFixed(2)}x equivalent-static overturning demand (0.05 m target)` : '',
      slide ? `has sliding demand ${slideRatio.toFixed(2)}x (1.00x target)` : ''
    ].filter(Boolean).join(' and ')}.`;
    const depth = 0.75, keyThickness = 0.4;
    const raftMat = dominantMaterial(comp), raftRho = MATS[raftMat].rho;
    const originalWidth = Math.max(0.2, x1 - x0), originalDepth = Math.max(0.2, z1 - z0);
    const soilUnitWeight = 18e3, soilFrictionAngle = 30 * DEG;
    const passiveCoefficient = (1 + Math.sin(soilFrictionAngle)) / (1 - Math.sin(soilFrictionAngle));
    const passiveReduction = 0.5, passiveSafetyFactor = 1.5;
    const roundUp = x => Math.ceil((x - 1e-9) / 0.25) * 0.25;
    let width = roundUp(Math.max(0.25, originalWidth)), spanZ = roundUp(Math.max(0.25, originalDepth));
    let keyDepth = slide ? 0.25 : 0;
    for (let i = 0; i < 24; i++) {
      const keyWidth = Math.max(0.2, spanZ * 0.8);
      const footingMass = raftRho * width * depth * spanZ;
      const keyMass = raftRho * keyThickness * keyDepth * keyWidth;
      const totalMass = M + footingMass + keyMass;
      const totalWeight = totalMass * G;
      const friction = mu * totalWeight;
      const slidingDemand = slidingFactor * PGA * totalWeight;
      const netPassiveDemand = Math.max(0, slidingDemand - friction);
      const passiveCapacityPerDepthSquared = 0.5 * passiveReduction * soilUnitWeight *
        passiveCoefficient * keyWidth / passiveSafetyFactor;
      const nextKeyDepth = slide && netPassiveDemand > 0
        ? roundUp(Math.sqrt(netPassiveDemand / Math.max(passiveCapacityPerDepthSquared, 1)))
        : 0;
      keyDepth = Math.max(keyDepth, nextKeyDepth);

      const revisedKeyMass = raftRho * keyThickness * keyDepth * keyWidth;
      const total = M + footingMass + revisedKeyMass;
      const nextCx = (M * cx + (footingMass + revisedKeyMass) * xCenter) / total;
      const nextCy = (M * cy + footingMass * (supportLevel - depth / 2) +
        revisedKeyMass * (supportLevel - depth - keyDepth / 2)) / total;
      const baseY = supportLevel - depth;
      const demandHeight = Math.max(0.05, nextCy - baseY);
      const requiredWidth = 2 * (Math.abs(nextCx - xCenter) + overturnFactor * PGAx * demandHeight + 0.05);
      const requiredSpanZ = 2 * (Math.abs(cz - zCenter) + overturnFactor * PGAz * demandHeight + 0.05);
      width = roundUp(Math.max(width, requiredWidth));
      spanZ = roundUp(Math.max(spanZ, requiredSpanZ));
      if (width > spanZ * 3) spanZ = roundUp(width / 3);
      if (spanZ > width * 3) width = roundUp(spanZ / 3);
    }

    const keyWidth = Math.max(0.2, spanZ * 0.8);
    const footingMass = raftRho * width * depth * spanZ;
    const keyMass = raftRho * keyThickness * keyDepth * keyWidth;
    const totalMass = M + footingMass + keyMass;
    const totalWeight = totalMass * G;
    const friction = mu * totalWeight;
    const slidingDemand = slidingFactor * PGA * totalWeight;
    const passiveCapacity = 0.5 * passiveReduction * soilUnitWeight * passiveCoefficient *
      keyWidth * keyDepth ** 2 / passiveSafetyFactor;
    const slidingCapacityRatio = factorOfSafety(friction + passiveCapacity, slidingDemand);
    const centerX = (M * cx + (footingMass + keyMass) * xCenter) / totalMass;
    const centerY = (M * cy + footingMass * (supportLevel - depth / 2) +
      keyMass * (supportLevel - depth - keyDepth / 2)) / totalMass;
    const raftDemandHeight = Math.max(0.05, centerY - (supportLevel - depth));
    const raftMarginX = width / 2 - Math.abs(centerX - xCenter) - overturnFactor * PGAx * raftDemandHeight;
    const raftMarginZ = spanZ / 2 - Math.abs(cz - zCenter) - overturnFactor * PGAz * raftDemandHeight;
    const raftMargin = Math.min(raftMarginX, raftMarginZ);
    const footing = {
      mat: raftMat, size: [width, depth, spanZ],
      pos: [xCenter, supportLevel - depth / 2, zCenter],
      rot: [0, 0, 0], foundation: true
    };
    const creates = [footing];
    if (keyDepth > 0) creates.push({
      mat: raftMat, size: [keyThickness, keyDepth, keyWidth],
      pos: [xCenter, supportLevel - depth - keyDepth / 2, zCenter],
      rot: [0, 0, 0], foundation: true, shearKey: true
    });
    const plan = { creates };
    const bounded = Math.max(width, spanZ, keyDepth + depth) <= 12;
    const adequate = raftMargin >= 0.05 && slidingCapacityRatio >= 1;
    const valid = bounded && adequate && planFree(plan);
    // Base-isolation alternative: elastomeric pads decouple the group from the
    // ground. Sliding capacity uses the rubber friction coefficient; overturning
    // demand is reduced by the assumed isolation factor (period shift). Only
    // offered when the group sits directly on the ground with no separate
    // footings, so pads land between the soil and the base members.
    const isoFactor = 0.5;
    const isoSlideRatio = factorOfSafety(MATS.rubber.mu, slidingFactor * PGA * isoFactor);
    const isoOffsetX = overturnFactor * PGAx * isoFactor * hc;
    const isoOffsetZ = overturnFactor * PGAz * isoFactor * hc;
    const isoMargin = Math.min(
      polygonMargin(hull, [cx - isoOffsetX, cz - isoOffsetZ]),
      polygonMargin(hull, [cx - isoOffsetX, cz + isoOffsetZ]),
      polygonMargin(hull, [cx + isoOffsetX, cz - isoOffsetZ]),
      polygonMargin(hull, [cx + isoOffsetX, cz + isoOffsetZ])
    );
    const isoGrounded = !comp.some(block => block.suggestedBearing) &&
      foundationMembers.length === 0 &&
      baseMembers.every(b => Math.min(...shapeWorld(b).map(p => p.y)) <= 0.02);
    if (isoGrounded && isoSlideRatio >= 1) {
      const isoAllow = MATS.rubber.strength / SF;
      const totalPadArea = M * G / isoAllow;
      const padCount = Math.max(1, baseMembers.length);
      const padT = 0.45;
      const substructureDepth = 0.3;
      const lowerFoundationDepth = 0.45;
      const bearingBaseY = -padT;
      const lift = substructureDepth;
      const verticalSupports = baseMembers.filter(b => b.size[1] >=
        Math.max(b.size[0], b.size[2]) * 1.5);
      const supportSide = verticalSupports.length
        ? Math.max(MIN_PILLAR_SECTION, ...verticalSupports.map(b => Math.max(b.size[0], b.size[2])))
        : MIN_PILLAR_SECTION;
      const padSide = Math.max(MIN_PILLAR_SECTION, supportSide * 1.25,
        Math.sqrt(totalPadArea / padCount));
      const isoCreates = [], supportCenters = [];
      for (const b of baseMembers) {
        const bb = boxes.get(b);
        const x = (bb.min.x + bb.max.x) / 2, z = (bb.min.z + bb.max.z) / 2;
        supportCenters.push([x, z]);
        const upperX = Math.max(padSide, bb.max.x - bb.min.x);
        const upperZ = Math.max(padSide, bb.max.z - bb.min.z);
        isoCreates.push({
          mat: b.mat, size: [upperX, substructureDepth, upperZ],
          pos: [x, bearingBaseY + padT + substructureDepth / 2, z], rot: [0, 0, 0],
          suggestionConnection: true
        });
        isoCreates.push({
          mat: 'rubber', size: [padSide, padT, padSide],
          pos: [x, bearingBaseY + padT / 2, z], rot: [0, 0, 0],
          suggestedBearing: true, suggestionConnection: true
        });
      }
      const supportRange = axis => [
        Math.min(...supportPoints.map(point => point[axis])),
        Math.max(...supportPoints.map(point => point[axis]))
      ];
      const cantilever = comp.flatMap(b => {
        if (baseMembers.includes(b) || !jointKind(b.mat, b.mat)) return [];
        const bb = boxes.get(b);
        const spans = [bb.max.x - bb.min.x, bb.max.z - bb.min.z];
        const axis = spans[0] >= spans[1] ? 0 : 2;
        const other = axis === 0 ? 2 : 0;
        const longSpan = spans[axis], crossSpan = spans[other];
        if (longSpan < Math.max(0.8, crossSpan * 2, (bb.max.y - bb.min.y) * 1.5) ||
          bb.min.y <= 0.02) return [];
        const range = supportRange(axis === 0 ? 0 : 1);
        const center = (range[0] + range[1]) / 2;
        const sign = bb.max[axis === 0 ? 'x' : 'z'] > center ? 1 : -1;
        const root = sign > 0 ? bb.min[axis === 0 ? 'x' : 'z'] : bb.max[axis === 0 ? 'x' : 'z'];
        const tip = sign > 0 ? bb.max[axis === 0 ? 'x' : 'z'] : bb.min[axis === 0 ? 'x' : 'z'];
        const rootGap = Math.min(...supportCenters.map(point =>
          Math.abs(point[axis] - root)));
        const outsideSupport = sign > 0 ? tip - range[1] : range[0] - tip;
        if (rootGap > Math.max(0.75, crossSpan) || outsideSupport < Math.max(0.75, padSide)) return [];
        const x = axis === 0 ? tip - sign * (padSide / 2 + 0.01) : (bb.min.x + bb.max.x) / 2;
        const z = axis === 2 ? tip - sign * (padSide / 2 + 0.01) : (bb.min.z + bb.max.z) / 2;
        const height = bb.min.y + lift;
        if (height <= 0) return [];
        return [{ b, x, z, height, axis, outsideSupport }];
      }).sort((a, b) => b.outsideSupport - a.outsideSupport);
      const cantileverSupport = cantilever[0];
      if (cantileverSupport) {
        const { b, x, z, height } = cantileverSupport;
        const root = verticalSupports.reduce((nearest, column) => {
          const d = Math.hypot(column.pos[0] - x, column.pos[2] - z);
          return !nearest || d < nearest.distance ? { column, distance: d } : nearest;
        }, null)?.column;
        const section = sturdyPillarSection(comp, b.mat,
          M * G / Math.max(1, verticalSupports.length + 1), height, PGA);
        const pierSide = Math.ceil(Math.max(MIN_PILLAR_SECTION,
          section.width * 1.5, section.depth * 1.5,
          root ? root.size[0] * 1.5 : 0, root ? root.size[2] * 1.5 : 0) * 20) / 20;
        isoCreates.push({
          mat: b.mat, size: [pierSide, height, pierSide],
          pos: [x, height / 2, z], rot: [0, 0, 0], suggestionConnection: true
        });
        isoCreates.push({
          mat: 'rubber', size: [pierSide, padT, pierSide],
          pos: [x, bearingBaseY + padT / 2, z], rot: [0, 0, 0],
          suggestedBearing: true, suggestionConnection: true
        });
        supportCenters.push([x, z]);
      }
      const isoFoundationMat = dominantMaterial(comp);
      let footingSide = padSide + 0.4, bearingHull = [];
      const bearingMargin = side => {
        const points = supportCenters.flatMap(([x, z]) => [
          [x - side / 2, z - side / 2], [x + side / 2, z - side / 2],
          [x + side / 2, z + side / 2], [x - side / 2, z + side / 2]
        ]);
        const candidateHull = hull2(points);
        const margin = candidateHull.length >= 3 ? Math.min(
          polygonMargin(candidateHull, [cx - isoOffsetX, cz - isoOffsetZ]),
          polygonMargin(candidateHull, [cx - isoOffsetX, cz + isoOffsetZ]),
          polygonMargin(candidateHull, [cx + isoOffsetX, cz - isoOffsetZ]),
          polygonMargin(candidateHull, [cx + isoOffsetX, cz + isoOffsetZ])
        ) : -MAX_SCREEN_RATIO;
        return { hull: candidateHull, margin };
      };
      let bearing = bearingMargin(footingSide);
      while (bearing.margin < 0.05 && footingSide < 12) {
        footingSide = Math.min(12, footingSide + 0.25);
        bearing = bearingMargin(footingSide);
      }
      for (const [x, z] of supportCenters) isoCreates.push({
        mat: isoFoundationMat,
        size: [footingSide, lowerFoundationDepth, footingSide],
        pos: [x, bearingBaseY - lowerFoundationDepth / 2, z],
        rot: [0, 0, 0], foundation: true, suggestionConnection: true
      });
      const proposedIsoMargin = bearing.margin;
      const isoPlan = {
        moves: comp.map(b => ({ b, delta: [0, lift, 0] })),
        creates: isoCreates
      };
      const isoCost = isoCreates.reduce((cost, create) => {
        const volume = create.size[0] * create.size[1] * create.size[2];
        cost.m3 += volume;
        cost.kg += volume * MATS[create.mat].rho;
        return cost;
      }, { m3: 0, kg: 0 });
      if (proposedIsoMargin >= 0.05 && planFree(isoPlan)) {
        if (cantileverSupport) {
          for (let i = items.length - 1; i >= 0; i--) {
            const action = items[i].action || '';
            if (action.includes('idealized') && action.includes('pier') ||
              action.includes('piers with spread footings under the overhanging members')) {
              items.splice(i, 1);
            }
          }
        }
        items.push({
          p: cantileverSupport ? -2 : 2, sev: 'warn',
          text: `Earthquake (design input envelope: ${PGAx.toFixed(2)} g X, ${PGAz.toFixed(2)} g Z): ${cantileverSupport ? 'a same-material pier matching the existing column section, with its own thick rubber isolator and buried spread footing, is added directly beneath the cantilever free end; ' : ''}the raised group bears on same-material substructures, ${padT} m rubber isolators, and individual buried ${MATS[isoFoundationMat].name} lower spread footings. Each isolator is sandwiched between same-material upper and lower supports. Rubber bearing pressure is ${(M * G / (padCount * padSide * padSide) / 1e6).toFixed(2)} MPa (allowable ${(isoAllow / 1e6).toFixed(1)} MPa); the group moves up ${lift.toFixed(2)} m to preserve the direct load path. The screening assumes a ${isoFactor * 100}% reduction in transmitted seismic demand; sliding ratio ${isoSlideRatio.toFixed(2)}x and overturning margin ${proposedIsoMargin.toFixed(2)} m under reduced demand. Real bearing connections, travel, uplift, and soil interaction are not verified.`,
          action: `Raise the group onto ${cantileverSupport ? 'a free-end pier and ' : ''}substructure / rubber / individual spread-footing stacks`,
          cost: isoCost,
          apply: () => executePlan(isoPlan), autoKey: 'base-isolation'
        });
      }
    }
    const footingAction = bounded
      ? `Add a ${width.toFixed(2)} x ${spanZ.toFixed(2)} m ${MATS[raftMat].name} raft with ${keyDepth.toFixed(2)} m integral shear key`
      : 'No automatic retrofit within the 12 m sandbox model limits; a project-specific design is required';
    const retrofitDescription = bounded
      ? `Automatic retrofit screening estimates a ${width.toFixed(2)} x ${spanZ.toFixed(2)} m raft and ${keyDepth.toFixed(2)} m shear key; estimated sliding resistance/demand ratio ${slidingCapacityRatio.toFixed(2)}x.`
      : 'The estimated retrofit exceeds the 12 m sandbox model limits; no oversized dimensions are recommended.';
    items.push({
      p: 2,
      sev: 'bad',
      text: `${text} ${retrofitDescription}`,
      action: valid ? footingAction : bounded
        ? 'No automatic retrofit fits the available free space; check the layout and soil assumptions'
        : footingAction,
      cost: valid ? { m3: width * spanZ * depth + keyThickness * keyDepth * keyWidth,
        kg: (width * spanZ * depth + keyThickness * keyDepth * keyWidth) * raftRho } : null,
      apply: valid ? () => executePlan(plan) : null
    });
  }

  // G. Offer bounded section-growth candidates for weak modeled joints.
  for (const j of joints) if (!j.holds) {
    const ratio = demandCapacityRatio(JOINT_SF * j.V, j.cap);
    const scale = j.kind === 'weld' ? ratio : Math.sqrt(ratio);
    const candidates = [];
    for (const b of [j.a, j.b]) {
      const target = [...b.size];
      target[(j.n + 1) % 3] *= scale;
      target[(j.n + 2) % 3] *= scale;
      if (Math.max(...target) > 12) continue;
      const plan = { resizes: [{ b, target }] };
      if (!planFree(plan)) continue;
      const addedVolume = target[0] * target[1] * target[2] - b.size[0] * b.size[1] * b.size[2];
      candidates.push({ b, target, plan, addedVolume });
    }
    candidates.sort((a, b) => a.addedVolume - b.addedVolume);
    const option = candidates[0];
    items.push({
      p: 1,
      sev: 'bad',
      text: `${MATS[j.a.mat].name} #${j.a.id} and #${j.b.id} have an under-capacity ${j.kind} connection (${(j.cap / 1000).toFixed(1)} kN capacity vs ${(j.V / 1000).toFixed(1)} kN demand; ${JOINT_SF}x required).`,
      action: option
        ? `Increase the contact-face section of member #${option.b.id} to ${option.target.map(v => v.toFixed(2)).join(' x ')} m, then recalculate the connection`
        : 'No safe automatic connection retrofit fits the current geometry and 12 m sandbox limits',
      cost: option ? { m3: option.addedVolume, kg: option.addedVolume * MATS[option.b.mat].rho } : null,
      apply: option ? () => executePlan(option.plan) : null,
      autoKey: `joint:${Math.min(j.a.id, j.b.id)}:${Math.max(j.a.id, j.b.id)}`
    });
  }

  items.sort((a, b) => a.p - b.p);
  S.sugs = items;
  S.dirty = false;
  renderSugs();
}

function renderSugs() {
  const el = byId('suggestions');
  renderLearningStatus();
  renderFrameResponse();
  const failures = S.sim ? simulationFailures.current : simulationFailures.last;
  const failureReport = failures.length ? `
    <div class="sug bad"> 
      <div><b>${S.sim ? 'Damage in this run' : 'Damage in the last run'}</b> | ${failures.length} fracture / joint separation event${failures.length === 1 ? '' : 's'}. These are simplified estimates, not engineering design checks.</div> 
      ${failures.slice(-8).reverse().map(f => {
    const unit = f.unit || 'MPa';
    const scale = unit === 'MPa' ? 1e6 : unit === 'kN' ? 1000 : 1;
    const demand = f.demand / scale;
    const capacity = f.capacity / scale;
    const ratio = demandCapacityRatio(demand, capacity);
    const position = f.position ? ` | position (${f.position.map(value => value.toFixed(2)).join(', ')}) m` : '';
    const direction = f.accelerationG
      ? ` | shake (${f.accelerationG.x.toFixed(2)}, ${f.accelerationG.z.toFixed(2)}) g` : '';
    return `<div class="stat"><span>#${f.id}${f.relatedMemberId ? ` ↔ #${f.relatedMemberId}` : ''} | ${f.material} | ${f.mode}${position}${direction}</span><b>Demand ${demand.toFixed(2)} ${unit} / limit ${capacity.toFixed(2)} ${unit} (${ratio.toFixed(2)}x) | ${f.time.toFixed(1)} s</b></div>`;
  }).join('')}
      ${failures.length > 8 ? `<div class="muted">${failures.length - 8} earlier fractures not shown.</div>` : ''}
      <div class="muted">Demand is a simplified stress or impact-energy estimate; limit is the modeled material threshold. A ratio above 1.00x means this model estimated that the threshold was exceeded. ${S.sim ? '' : 'The model resets when you stop; this is the saved summary of the last run.'}</div> 
      <div class="muted">Fractured members split into falling pieces.</div> 
    </div>` : '';
  if (S.sim) { el.innerHTML = `${failureReport}<div class="sug">Suggestions pause while the simulation runs.</div>`; return; }
  if (!S.sugs.length && !failureReport) {
    el.innerHTML = '<div class="sug" style="border-color:var(--ok)">No failures found by the checks modeled here.</div>';
    return;
  }
  el.innerHTML = failureReport + S.sugs.slice(0, 8).map((s, i) => `
    <div class="sug ${s.sev}"> 
      <div>${s.text}</div> 
      <div class="row"> 
        <span class="grow" style="color:var(--accent)">${s.action}${s.cost ? `<br><span class="muted">+${s.cost.m3.toFixed(3)} m^3 | ${Math.round(s.cost.kg)} kg</span>` : ''}</span> 
        ${s.apply ? `<button data-sug="${i}">Apply</button>` : '<span class="muted">No safe automatic change found</span>'}
      </div> 
  </div>`).join('') + '<div class="muted" style="font-size:11px"> </div>';
}

function autoStabilize() {
  if (S.sim || S.edit) return flash('Stop the simulation and leave vertex-edit mode before auto-stabilizing.');
  if (S.dirty) analyze();
  const applied = new Set();
  let count = 0;
  autoStabilizing = true;
  autoUndoCaptured = false;
  try {
    for (let pass = 0; pass < 12; pass++) {
      if (S.dirty) analyze();
      const candidate = S.sugs.find(s => s.apply && !applied.has(s.autoKey || `${s.text}|${s.action}`));
      if (!candidate) break;
      applied.add(candidate.autoKey || `${candidate.text}|${candidate.action}`);
      if (candidate.apply() === false) continue;
      count++;
      changed();
      analyze();
    }
  } finally {
    autoStabilizing = false;
    autoUndoCaptured = false;
  }
  if (count) {
    renderProps();
    flash(`Auto-stabilize applied ${count} feasible change${count === 1 ? '' : 's'}. Recheck remaining issues and rerun the simulation.`);
  } else {
    flash('No safe automatic fix is feasible for the current model within sandbox limits.');
  }
}

function applySuggestion(s) {
  if (S.edit) return flash('Leave edit mode (Tab) before applying suggestions.');
  if (S.sim) return flash('Stop the simulation before applying suggestions.');
  if (S.dirty) analyze();
  if (!s || !S.sugs.includes(s)) return flash('The model changed; review the refreshed suggestions before applying one.');
  if (!s.apply) return flash('No safe automatic change is available for that issue within the sandbox model.');
  if (s.apply() === false) return flash('That suggestion is no longer valid for the current model.');
  changed();
  analyze();
  flash(`Applied: ${s.action}.`);
  renderProps();
}

/* ================= simulation ================= */
// Blocks linked by holding fasteners form one rigid body (compound convex shapes).
function buildGroupBody(members) {
  const M = members.reduce((s, b) => s + b.mass, 0);
  const com = new THREE.Vector3();
  for (const b of members) com.addScaledVector(v3(b.pos), b.mass);
  com.multiplyScalar(1 / M);
  const reinforcedMass = members.filter(member => member.shearLinks)
    .reduce((sum, member) => sum + member.mass, 0);
  const reinforcementShare = reinforcedMass / Math.max(M, 1e-9);
  const isBuriedFoundation = members.every(member => member.foundation &&
    shapeWorld(member).some(point => point.y <= 0.02));
  // Near-zero damping so free-falling objects don't tilt or drift unnaturally.
  // Air drag is applied separately in the physics loop, scaled by surface area / mass.
  const body = new RapierBody({
    mass: M, type: isBuriedFoundation ? bodyType.STATIC : bodyType.DYNAMIC,
    material: CM[members[0].mat],
    linearDamping: 0.02 + 0.08 * reinforcementShare,
    angularDamping: 0.001 + 0.18 * reinforcementShare
  });
  body.position.set(com.x, com.y, com.z);
  for (const b of members) {
    const off = v3(b.pos).sub(com), q = quatOf(b.rot);
    b.bodyShapeIndex = body.shapes.length;
    body.addShape(makeConvexShape(b.verts, MATS[b.mat].rho),
      off, { x: q.x, y: q.y, z: q.z, w: q.w }, b.mat);
    b.body = body;
    b.rel = { pos: off, quat: q };
  }
  bodyMembers.set(body, members);
  world.addBody(body);
  return body;
}
function groupsOf(alive) {
  const members = new Set(alive);
  const connections = joints.filter(j => {
    if (!j.holds || !members.has(j.a) || !members.has(j.b)) return false;
    if (j.kind === 'reinforced') return true;
    const buriedFoundation = [j.a, j.b].find(block => block.foundation &&
      Math.max(...shapeWorld(block).map(point => point.y)) <= 0.02);
    return !buriedFoundation || (j.a.foundation && j.b.foundation);
  }).map(j => ({ a: j.a, b: j.b }));
  return groupBy(alive, connections);
}

function removeFrameBraceRuntime(runtime) {
  for (const connection of runtime.connections) {
    if (connection.constraint && world.constraints.includes(connection.constraint)) {
      world.removeConstraint(connection.constraint);
    }
    if (connection.anchor && world.bodies.includes(connection.anchor)) world.removeBody(connection.anchor);
  }
  const index = frameBraceRuntime.indexOf(runtime);
  if (index >= 0) frameBraceRuntime.splice(index, 1);
}

function clearFrameBraceRuntime() {
  for (const runtime of [...frameBraceRuntime]) removeFrameBraceRuntime(runtime);
}

function removeFrameBraceConstraintsForBody(body) {
  for (const runtime of [...frameBraceRuntime]) {
    for (const connection of runtime.connections) {
      if (!connection.constraint ||
        (connection.constraint.bodyA !== body && connection.constraint.bodyB !== body)) continue;
      if (world.constraints.includes(connection.constraint)) world.removeConstraint(connection.constraint);
      connection.constraint = null;
      if (connection.anchor && world.bodies.includes(connection.anchor)) world.removeBody(connection.anchor);
      connection.anchor = null;
    }
    if (!runtime.block.alive || runtime.body === body) removeFrameBraceRuntime(runtime);
  }
}

function reconnectFrameBraceTargets() {
  for (const runtime of frameBraceRuntime) for (let i = 0; i < runtime.connections.length; i++) {
    if (!runtime.connections[i]?.constraint) {
      connectFrameBraceEndpoint(runtime, i, frameModelForBlock(runtime.block));
    }
  }
}

function frameModelForBlock(block) {
  return simulationFrameModels.find(model => model.members.includes(block)) || null;
}

function frameBraceAnchorPosition(model, block, endpointIndex) {
  const endpoint = block.frame.endpoints[endpointIndex];
  if (!model) return {
    x: endpoint[0] + plateBody.position.x, y: endpoint[1], z: endpoint[2] + plateBody.position.z
  };
  const motion = frameFloorMotion(model, block.frame.endpointLevels[endpointIndex], endpoint[0], endpoint[2]);
  return {
    x: endpoint[0] + motion.x + plateBody.position.x,
    y: endpoint[1],
    z: endpoint[2] + motion.z + plateBody.position.z
  };
}

function braceColumnAtNode(block, endpointIndex) {
  const anchorId = block.frame.anchorBlockIds?.[endpointIndex];
  if (anchorId != null) {
    const anchor = blocks.find(candidate => candidate.alive && candidate.id === anchorId);
    if (anchor?.body) return anchor;
  }
  const [x, y, z] = block.frame.endpoints[endpointIndex];
  const tolerance = Math.max(0.35, block.size[0] * 2 + 0.1);
  const candidates = blocks.filter(candidate => {
    if (!candidate.alive ||
      !((candidate.frame?.model === block.frame.model && candidate.frame.role === 'column' &&
          (candidate.frame.assemblyId || 'legacy-frame') === (block.frame.assemblyId || 'legacy-frame')) ||
        (!candidate.foundation && candidate.size[1] >= 1 &&
          candidate.size[1] >= Math.max(candidate.size[0], candidate.size[2])))) return false;
    const world = shapeWorld(candidate);
    const dx = Math.max(Math.min(...world.map(point => point.x)) - x, 0,
      x - Math.max(...world.map(point => point.x)));
    const dz = Math.max(Math.min(...world.map(point => point.z)) - z, 0,
      z - Math.max(...world.map(point => point.z)));
    return dx <= tolerance && dz <= tolerance &&
      y >= Math.min(...world.map(point => point.y)) - 0.35 &&
      y <= Math.max(...world.map(point => point.y)) + 0.35;
  });
  return candidates
    .sort((a, b) => {
      const contains = column => Math.abs(y - column.pos[1]) <= column.size[1] / 2 + 0.12;
      const score = column => (contains(column) ? 0 : 1) * 1000 +
        Math.max(0, Math.abs(y - column.pos[1]) - column.size[1] / 2);
      return score(a) - score(b);
    })[0];
}

function connectFrameBraceEndpoint(runtime, endpointIndex, model) {
  const { block, body } = runtime;
  let pivot = { x: 0, y: endpointIndex === 0 ? -block.size[1] / 2 : block.size[1] / 2, z: 0 };
  let connection;
  const column = braceColumnAtNode(block, endpointIndex);
  if (column?.body) {
    const point = { x: block.frame.endpoints[endpointIndex][0],
      y: block.frame.endpoints[endpointIndex][1], z: block.frame.endpoints[endpointIndex][2] };
    const targetPivot = column.body.pointToLocalFrame(point);
    pivot = body.pointToLocalFrame(point);
    const constraint = new RapierJoint(column.body, body, targetPivot, pivot, false);
    world.addConstraint(constraint);
    connection = { constraint, targetBlock: column, targetPivot };
  } else {
    runtime.connections[endpointIndex] = { constraint: null };
    return;
  }
  runtime.connections[endpointIndex] = connection;
}

function createFrameBraceBodies(alive, model) {
  const models = Array.isArray(model) ? model : model ? [model] : [];
  const braces = alive.filter(block => ['rc-frame', 'user-frame'].includes(block.frame?.model) &&
    block.frame.role === 'brace' && block.frame.endpoints?.length === 2);
  for (const block of braces) {
    const frameModel = block.frame.model === 'rc-frame'
      ? models.find(candidate => candidate.members.includes(block)) || null : null;
    const body = new RapierBody({
      type: frameModel ? bodyType.KINEMATIC : bodyType.DYNAMIC,
      material: CM.steel,
      linearDamping: 0.0,
      angularDamping: 0.001
    });
    body.addShape(makeBoxShape({ x: block.size[0] / 2, y: block.size[1] / 2,
      z: block.size[2] / 2 }, MATS[block.mat].rho), undefined, undefined, block.mat);
    body.position.set(...block.pos);
    const quaternion = quatOf(block.rot);
    body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    block.body = body;
    block.rel = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    bodyMembers.set(body, [block]);
    world.addBody(body);
    const runtime = { block, body, connections: [] };
    frameBraceRuntime.push(runtime);
    if (!frameModel) {
      connectFrameBraceEndpoint(runtime, 0, null);
      connectFrameBraceEndpoint(runtime, 1, null);
    }
  }
}

function updateFrameBraceAnchors(model, dt) {
  for (const runtime of frameBraceRuntime) {
    if (runtime.block.frame?.model !== 'rc-frame' ||
      !model.members.includes(runtime.block)) continue;
    if (runtime.body.type === bodyType.KINEMATIC) {
      const [p0, p1] = runtime.block.frame.endpoints;
      const lower = frameFloorMotion(model, runtime.block.frame.endpointLevels[0], p0[0], p0[2]);
      const upper = frameFloorMotion(model, runtime.block.frame.endpointLevels[1], p1[0], p1[2]);
      const start = new THREE.Vector3(p0[0] + lower.x + plateBody.position.x, p0[1],
        p0[2] + lower.z + plateBody.position.z);
      const end = new THREE.Vector3(p1[0] + upper.x + plateBody.position.x, p1[1],
        p1[2] + upper.z + plateBody.position.z);
      const direction = end.clone().sub(start);
      if (direction.lengthSq() > 1e-12) {
        const midpoint = start.add(end).multiplyScalar(0.5);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0), direction.normalize()
        );
        runtime.body.setNextKinematicTranslation({ x: midpoint.x, y: midpoint.y, z: midpoint.z });
        runtime.body.setNextKinematicRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
      }
      continue;
    }
    for (let i = 0; i < runtime.connections.length; i++) {
      const connection = runtime.connections[i];
      if (!connection?.anchor) continue;
      const target = frameBraceAnchorPosition(model, runtime.block, i);
      connection.anchor.setNextKinematicTranslation(target);
    }
  }
}

function updateBraceConstraintFailure() {
  for (const runtime of frameBraceRuntime) {
    const { block } = runtime;
    if (frameModelForBlock(block)) continue;
    if (!block.alive || block.broken || !runtime.connections.every(c => c?.constraint)) continue;
    const [p0, p1] = block.frame.endpoints;
    const endpointPosition = connection => {
      if (connection.anchor) {
        return new THREE.Vector3(connection.anchor.position.x, connection.anchor.position.y, connection.anchor.position.z);
      }
      const point = connection.targetBlock.body.pointToWorldFrame(connection.targetPivot);
      return new THREE.Vector3(point.x, point.y, point.z);
    };
    const currentLength = endpointPosition(runtime.connections[0]).distanceTo(
      endpointPosition(runtime.connections[1]));
    const initialLength = Math.max(new THREE.Vector3().fromArray(p1)
      .distanceTo(new THREE.Vector3().fromArray(p0)), 1e-8);
    const axialStrain = (currentLength - initialLength) / initialLength;
    const area = Math.max(block.size[0] * block.size[2], 1e-8);
    const inCompression = axialStrain < 0;
    const momentI = Math.min(block.size[0] * block.size[2] ** 3,
      block.size[2] * block.size[0] ** 3) / 12;
    const bm = MATS[block.mat];
    const euler = Math.PI ** 2 * (block.frame.E || bm.E) * momentI /
      initialLength ** 2;
    const yieldCapacity = inCompression
      ? Math.min(euler, bm.strength * area)
      : bm.strength * area;
    const trialForce = Math.abs(axialStrain * (block.frame.E || bm.E) * area);
    const capacity = inCompression ? yieldCapacity : bm.ultimate * area;
    // The Rapier strut constraint is rigid and unbounded, so the raw elastic estimate
    // grows without limit once the frame collapses. A real brace yields, buckles, or
    // ruptures near its capacity; cap the reported force at 1.5x capacity (small
    // dynamic allowance) so demands stay physically meaningful. The fracture trigger
    // is unchanged: ratio >= 1 exactly when the elastic estimate reaches capacity.
    const axialForce = Math.min(trialForce, 1.5 * capacity);
    block.frameAxialForce = axialForce;
    block.stress = stressFromLoad(axialForce, area);
    block.fos = factorOfSafety(bm.strength, block.stress);
    block.plasticStrain = Math.max(block.plasticStrain,
      Math.max(0, Math.abs(axialStrain) - bm.strength / bm.E));
    if (axialForce >= yieldCapacity) block.yielded = true;
    const ratio = demandCapacityRatio(axialForce, capacity);
    block.breakRatio = ratio;
    block.failureDemand = axialForce;
    block.failureCapacity = capacity;
    block.failureUnit = 'N';
    block.failureMode = inCompression ? 'brace constraint buckling' : 'brace constraint rupture';
    block.overstressSteps = ratio >= 1 ? block.overstressSteps + 1 : 0;
    // Braces are the sacrificial fuse of the frame: once overstressed they break on
    // the first step instead of yanking the columns with unbounded constraint forces.
    if (block.overstressSteps >= 1) return block;
  }
  return null;
}

function attachReleasedFrameBraces(model, releasedColumn) {
  if (releasedColumn.frame.role !== 'column') return;
  for (const runtime of frameBraceRuntime) {
    for (let i = 0; i < runtime.connections.length; i++) {
      const connection = runtime.connections[i];
      if (!connection?.anchor || braceColumnAtNode(runtime.block, i) !== releasedColumn) continue;
      const worldPoint = frameBraceAnchorPosition(model, runtime.block, i);
      if (world.constraints.includes(connection.constraint)) world.removeConstraint(connection.constraint);
      if (world.bodies.includes(connection.anchor)) world.removeBody(connection.anchor);
      const targetPivot = releasedColumn.body.pointToLocalFrame(worldPoint);
      const bracePivot = { x: 0, y: i === 0 ? -runtime.block.size[1] / 2
          : runtime.block.size[1] / 2, z: 0 };
      const constraint = new RapierJoint(releasedColumn.body, runtime.body, targetPivot, bracePivot, false);
      world.addConstraint(constraint);
      runtime.connections[i] = { constraint, targetBlock: releasedColumn };
    }
  }
}

function memberWorldTransform(b, body) {
  const bodyQ = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
  const localPos = new THREE.Vector3(b.rel.pos.x, b.rel.pos.y, b.rel.pos.z);
  const pos = localPos.applyQuaternion(bodyQ).add(new THREE.Vector3(body.position.x, body.position.y, body.position.z));
  const quat = bodyQ.multiply(b.rel.quat);
  return { pos, quat };
}

function vectorCross(out, a, b) {
  out.set(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x
  );
  return out;
}

function fracturePieceCount(ratio) {
  return Math.max(2, Math.min(6, Math.ceil(2 + Math.max(0, ratio - 1) * 2)));
}

function jaggedFragmentShape(b, pieceSize, axis, slabCenter, seed) {
  const jitter = Math.min(...pieceSize) * 0.018;
  const hash = value => {
    const n = Math.sin(value * 127.1 + seed * 311.7) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  };
  const lo = slabCenter - pieceSize[axis] / 2, hi = slabCenter + pieceSize[axis] / 2;
  const source = new ConvexGeometry(b.verts.map(point => new THREE.Vector3(...point)));
  const position = source.getAttribute('position');
  const unique = new Map();
  const clip = (polygon, bound, keepGreater) => {
    const clipped = [];
    for (let i = 0; i < polygon.length; i++) {
      const current = polygon[i], next = polygon[(i + 1) % polygon.length];
      const currentValue = current[axis], nextValue = next[axis];
      const currentInside = keepGreater ? currentValue >= bound - 1e-8 : currentValue <= bound + 1e-8;
      const nextInside = keepGreater ? nextValue >= bound - 1e-8 : nextValue <= bound + 1e-8;
      if (currentInside) clipped.push(current);
      if (currentInside !== nextInside) {
        const t = (bound - currentValue) / (nextValue - currentValue);
        const intersection = current.map((value, component) =>
          value + (next[component] - value) * t);
        intersection[axis] = bound;
        clipped.push(intersection);
      }
    }
    return clipped;
  };
  try {
    for (let i = 0; i < position.count; i += 3) {
      let polygon = [0, 1, 2].map(offset => [
        position.getX(i + offset), position.getY(i + offset), position.getZ(i + offset)
      ]);
      polygon = clip(clip(polygon, lo, true), hi, false);
      for (const point of polygon) {
        const key = point.map(value => Math.round(value * 1e7)).join(',');
        if (!unique.has(key)) unique.set(key, point);
      }
    }
  } finally {
    source.dispose();
  }
  if (unique.size < 4) throw new Error('Could not generate a valid fracture shard from this shape.');
  const vertices = [...unique.values()].map((point, index) => point.map((value, component) => {
    const onCut = component === axis &&
      (Math.abs(value - lo) < 1e-7 || Math.abs(value - hi) < 1e-7);
    const centered = component === axis ? value - slabCenter : value;
    return centered + (onCut ? 0 : hash(index * 3 + component + 1) * jitter);
  }));
  const geometry = new ConvexGeometry(vertices.map(point => new THREE.Vector3(...point)));
  return { geometry, vertices, faces: null };
}
function spawnBreakFragments(b, parent, pose) {
  const [w, h, d] = b.size;
  const axis = b.size.indexOf(Math.max(w, h, d));
  const dims = [w, h, d];
  const { pos: memberPos, quat: q } = pose;
  const fragmentCount = fracturePieceCount(b.breakRatio);
  const weights = Array.from({ length: fragmentCount }, (_, i) =>
    1 + 0.22 * Math.sin((b.id + 1) * 11.7 + i * 4.3));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const parts = [];
  const shardGap = Math.min(0.025, dims[axis] / (fragmentCount * 4));
  const usableLength = dims[axis] - shardGap * (fragmentCount - 1);
  let axisOffset = -dims[axis] / 2;
  for (let i = 0; i < fragmentCount; i++) {
    const pieceLength = usableLength * weights[i] / totalWeight;
    const pieceSize = [...dims];
    pieceSize[axis] = pieceLength;
    const localOffset = new THREE.Vector3();
    const slabCenter = axisOffset + pieceLength / 2;
    localOffset.setComponent(axis, slabCenter);
    axisOffset += pieceLength + shardGap;
    const direction = localOffset.clone();
    if (direction.lengthSq() < 1e-8) direction.set(Math.sin(b.id + i * 2), 0.35, Math.cos(b.id * 3 + i));
    direction.normalize().applyQuaternion(q);
    const position = memberPos.clone().add(localOffset.applyQuaternion(q));
    const mass = b.mass * pieceLength / dims[axis];
    parts.push({ i, pieceSize, position, direction, mass, slabCenter });
  }
  const meanDirection = parts.reduce((sum, part) => sum.addScaledVector(part.direction, part.mass), new THREE.Vector3()).multiplyScalar(1 / b.mass);
  // Small separation impulse so fragments don't overlap; keep it low so debris falls realistically.
  const pop = Math.min(0.3, 0.05 + 0.03 * Math.max(0, b.breakRatio - 1));
  // Clamp the maximum fragment speed so collapsed pieces don't fly off-screen.
  const maxFragmentSpeed = 4.0;
  for (const { i, pieceSize, position, direction, mass, slabCenter } of parts) {
    const shape = jaggedFragmentShape(b, pieceSize, axis, slabCenter, b.id * 31 + i);
    const pieceVolume = Math.max(shapeVolume(shape.vertices), 1e-9);
    const body = new RapierBody({ material: CM[b.mat], linearDamping: 0.15, angularDamping: 0.4 });
    body.addShape(makeConvexShape(shape.vertices, mass / pieceVolume), undefined, undefined, b.mat);
    body.position.set(position.x, position.y, position.z);
    body.quaternion.set(q.x, q.y, q.z, q.w);
    const r = mutableVector(position.x - parent.position.x,
      position.y - parent.position.y, position.z - parent.position.z);
    const rotational = vectorCross(mutableVector(), parent.angularVelocity, r);
    const kick = direction.clone().sub(meanDirection).multiplyScalar(pop);
    // Zero out horizontal velocity from earthquake shaking — fragments should only fall, not glide.
    let vx = kick.x * 0.3;
    let vy = Math.min(parent.velocity.y + rotational.y + kick.y, 0);
    let vz = kick.z * 0.3;
    const speed = Math.hypot(vx, vy, vz);
    if (speed > maxFragmentSpeed) {
      const scale = maxFragmentSpeed / speed;
      vx *= scale; vy *= scale; vz *= scale;
    }
    body.velocity.set(vx, vy, vz);
    // Dampen angular velocity so fragments don't spin wildly.
    const angVel = parent.angularVelocity;
    body.angularVelocity.set(angVel.x * 0.05, angVel.y * 0.05, angVel.z * 0.05);
    world.addBody(body);

    const material = MATS[b.mat];
    const mesh = new THREE.Mesh(shape.geometry, createMaterialVisual(b.mat, { flatShading: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(position);
    mesh.quaternion.copy(q);
    scene.add(mesh);
    debris.push({ body, mesh, mat: b.mat, settledTime: 0, lastSyncTime: S.t });
  }
}

function resetSceneExplosion() {
  if (!sceneExplosion) return;
  for (const { block, visible } of sceneExplosion.blocks) {
    if (block.alive) block.mesh.visible = visible;
  }
  for (const shard of sceneExplosion.shards) {
    scene.remove(shard.mesh);
    shard.mesh.geometry.dispose();
    shard.mesh.material.dispose();
  }
  for (const particle of sceneExplosion.particles) {
    scene.remove(particle.mesh);
    particle.mesh.material.dispose();
  }
  for (const smoke of sceneExplosion.smoke) {
    scene.remove(smoke.mesh);
    smoke.mesh.material.dispose();
  }
  for (const flame of sceneExplosion.flames) {
    scene.remove(flame.mesh);
    flame.mesh.material.dispose();
  }
  for (const wave of sceneExplosion.waves) {
    scene.remove(wave.mesh);
    wave.mesh.material.dispose();
  }
  sceneExplosion.waveGeometry.dispose();
  sceneExplosion.effectGeometry.dispose();
  sceneExplosion.particleGeometry.dispose();
  sceneExplosion = null;
  byId('blastFlash').style.opacity = '0';
  updateSimulationPreparationUi();
}

function explodeScene() {
  if (sceneExplosion) {
    resetSceneExplosion();
    flash('Explosion effect reset; the workspace is restored.');
    return;
  }
  if (S.sim || S.edit || framePlacement) {
    flash('Stop the simulation and finish the current edit or frame placement before exploding the scene.');
    return;
  }
  const targets = blocks.filter(block => block.alive);
  if (!targets.length) return flash('Add some objects before exploding the scene.');

  const bounds = new THREE.Box3();
  for (const block of targets) bounds.expandByObject(block.mesh);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(2, bounds.getSize(new THREE.Vector3()).length() * 0.65);
  const blocksBefore = targets.map(block => ({ block, visible: block.mesh.visible }));
  const shards = [];
  const particles = [];
  const smoke = [];
  const flames = [];
  const waves = [];

  for (const block of targets) {
    const axis = block.size.indexOf(Math.max(...block.size));
    const dims = [...block.size];
    const count = Math.max(3, Math.min(8, Math.ceil(dims[axis] / 0.8)));
    const q = block.mesh.quaternion.clone();
    const material = block.mesh.material;
    for (let index = 0; index < count; index++) {
      const pieceSize = [...dims];
      pieceSize[axis] = dims[axis] / count;
      const slabCenter = -dims[axis] / 2 + pieceSize[axis] * (index + 0.5);
      const shape = jaggedFragmentShape(block, pieceSize, axis, slabCenter,
        block.id * 31 + index + 1);
      const offset = new THREE.Vector3().setComponent(axis, slabCenter).applyQuaternion(q);
      const position = block.mesh.position.clone().add(offset);
      const direction = position.clone().sub(center);
      if (direction.lengthSq() < 1e-8) {
        direction.set(Math.sin(block.id * 4.1 + index), 0.4,
          Math.cos(block.id * 2.7 + index));
      }
      direction.normalize();
      direction.y = Math.max(0.18, direction.y + 0.65);
      direction.normalize();
      const shardMaterial = material.clone();
      if (shardMaterial.emissive) shardMaterial.emissive.setHex(0x321500);
      shape.geometry.computeBoundingBox();
      const box = shape.geometry.boundingBox;
      const mesh = new THREE.Mesh(shape.geometry, shardMaterial);
      mesh.position.copy(position);
      mesh.quaternion.copy(q);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      const kick = 7 + Math.random() * 8;
      shards.push({
        mesh,
        velocity: direction.multiplyScalar(kick),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 16
        ),
        grounded: false,
        settled: false,
        groundCorners: [
          [box.min.x, box.min.y, box.min.z], [box.min.x, box.min.y, box.max.z],
          [box.min.x, box.max.y, box.min.z], [box.min.x, box.max.y, box.max.z],
          [box.max.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.max.z],
          [box.max.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.max.z]
        ]
      });
    }
    block.mesh.visible = false;
  }

  const waveGeometry = new THREE.TorusGeometry(1, 0.055, 8, 64);
  for (let index = 0; index < 3; index++) {
    const mesh = new THREE.Mesh(waveGeometry, new THREE.MeshBasicMaterial({
      color: [0xfff0b0, 0xffa43d, 0xff5a27][index],
      transparent: true, opacity: 0.95, depthWrite: false
    }));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(center.x, 0.06 + index * 0.025, center.z);
    scene.add(mesh);
    waves.push({ mesh, delay: index * 0.12 });
  }

  const effectGeometry = new THREE.SphereGeometry(1, 16, 12);
  const blastSize = Math.max(1.5, bounds.getSize(new THREE.Vector3()).length() * 0.3);
  for (const [index, color] of [0xfff3a5, 0xff9434].entries()) {
    const mesh = new THREE.Mesh(effectGeometry, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false
    }));
    mesh.position.copy(center);
    scene.add(mesh);
    flames.push({ mesh, delay: index * 0.08 });
  }

  for (let index = 0; index < 22; index++) {
    const direction = new THREE.Vector3(
      Math.random() * 2 - 1, 0.25 + Math.random() * 1.5,
      Math.random() * 2 - 1
    ).normalize();
    const mesh = new THREE.Mesh(effectGeometry, new THREE.MeshBasicMaterial({
      color: [0x302a27, 0x4b4038, 0x696057][index % 3],
      transparent: true, opacity: 0, depthWrite: false
    }));
    mesh.position.copy(center).add(new THREE.Vector3(
      (Math.random() - 0.5) * blastSize * 0.4,
      Math.random() * blastSize * 0.25,
      (Math.random() - 0.5) * blastSize * 0.4
    ));
    mesh.scale.setScalar(0.15 + Math.random() * 0.22);
    scene.add(mesh);
    smoke.push({
      mesh,
      velocity: direction.multiplyScalar(0.7 + Math.random() * 1.4),
      delay: Math.random() * 0.45,
      grow: 1.8 + Math.random() * 1.8
    });
  }

  const particleGeometry = new THREE.SphereGeometry(0.055, 7, 5);
  const particleColors = [0xfff4bd, 0xffb33e, 0xff642d, 0xffffff];
  for (let index = 0; index < 120; index++) {
    const direction = new THREE.Vector3(
      Math.random() * 2 - 1, Math.random() * 1.8 - 0.1,
      Math.random() * 2 - 1
    ).normalize();
    const particle = new THREE.Mesh(particleGeometry,
      new THREE.MeshBasicMaterial({
        color: particleColors[index % particleColors.length],
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      }));
    particle.position.copy(center).add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.35, 0.3 + Math.random() * 0.4,
      (Math.random() - 0.5) * 0.35
    ));
    particle.scale.setScalar(0.45 + Math.random() * 1.5);
    scene.add(particle);
    particles.push({
      mesh: particle,
      velocity: direction.multiplyScalar(9 + Math.random() * 14)
    });
  }

  sceneExplosion = {
    blocks: blocksBefore, shards, particles, smoke, flames, waves,
    waveGeometry, effectGeometry, particleGeometry, elapsed: 0, radius, blastSize,
    flashReplayed: false, settled: false
  };
  const flashOverlay = byId('blastFlash');
  flashOverlay.style.transition = 'none';
  flashOverlay.style.opacity = '0.88';
  requestAnimationFrame(() => {
    flashOverlay.style.transition = 'opacity 280ms ease-out';
    flashOverlay.style.opacity = '0';
  });
  updateSimulationPreparationUi();
  flash('TNT-style explosion effect started. Click Reset Explosion to restore the workspace.');
}

function updateSceneExplosion(dt) {
  if (!sceneExplosion) return;
  const effect = sceneExplosion;
  const step = Math.max(0, Math.min(dt, 0.1));
  effect.elapsed += step;
  const blastFade = Math.max(0, 1 - effect.elapsed / 1.25);
  for (const wave of effect.waves) {
    const age = Math.max(0, effect.elapsed - wave.delay);
    wave.mesh.scale.setScalar(0.2 + effect.radius * age / 0.7);
    wave.mesh.material.opacity = age > 0 ? Math.max(0, 1 - age / 1.15) * 0.95 : 0;
  }
  for (const [index, flame] of effect.flames.entries()) {
    const age = Math.max(0, effect.elapsed - flame.delay);
    flame.mesh.scale.setScalar(effect.blastSize * (0.12 + age * (index ? 1.3 : 1.05)));
    flame.mesh.material.opacity = blastFade * (index ? 0.5 : 0.85);
  }
  for (const puff of effect.smoke) {
    const age = effect.elapsed - puff.delay;
    if (age <= 0) continue;
    puff.mesh.position.addScaledVector(puff.velocity, step);
    puff.mesh.scale.addScalar(puff.grow * step);
    puff.mesh.material.opacity = Math.min(0.48, age * 0.8) *
      Math.max(0, 1 - age / (SCENE_EXPLOSION_DURATION * 0.9));
  }
  for (const shard of effect.shards) {
    if (shard.settled) continue;
    shard.velocity.y -= G * step;
    shard.velocity.multiplyScalar(Math.max(0, 1 - step * 0.16));
    shard.mesh.position.addScaledVector(shard.velocity, step);
    shard.mesh.rotation.x += shard.spin.x * step;
    shard.mesh.rotation.y += shard.spin.y * step;
    shard.mesh.rotation.z += shard.spin.z * step;
    shard.spin.multiplyScalar(Math.max(0, 1 - step * (shard.grounded ? 2.8 : 0.12)));
    const bottom = explosionShardBottom(shard);
    if (bottom < 0) {
      shard.mesh.position.y -= bottom;
      shard.grounded = true;
      shard.velocity.y = Math.abs(shard.velocity.y) > 0.55
        ? -shard.velocity.y * 0.12
        : 0;
      const groundFriction = Math.exp(-3.2 * step);
      shard.velocity.x *= groundFriction;
      shard.velocity.z *= groundFriction;
      shard.spin.multiplyScalar(Math.exp(-4.5 * step));
      if (Math.abs(shard.velocity.y) < 0.18 &&
          Math.hypot(shard.velocity.x, shard.velocity.z) < 0.2 &&
          shard.spin.lengthSq() < 0.16) {
        shard.velocity.set(0, 0, 0);
        shard.spin.set(0, 0, 0);
        shard.settled = true;
      }
    }
  }
  for (const particle of effect.particles) {
    particle.velocity.y -= G * step;
    particle.mesh.position.addScaledVector(particle.velocity, step);
    particle.mesh.scale.multiplyScalar(Math.max(0, 1 - step * 0.85));
  }
  if (!effect.flashReplayed && effect.elapsed >= 0.18) {
    effect.flashReplayed = true;
    const flashOverlay = byId('blastFlash');
    flashOverlay.style.transition = 'none';
    flashOverlay.style.opacity = '0.5';
    requestAnimationFrame(() => {
      flashOverlay.style.transition = 'opacity 240ms ease-out';
      flashOverlay.style.opacity = '0';
    });
  }
  if (!effect.effectsFaded && effect.elapsed >= SCENE_EXPLOSION_DURATION) {
    effect.effectsFaded = true;
    for (const puff of effect.smoke) puff.mesh.material.opacity = 0;
    for (const flame of effect.flames) flame.mesh.material.opacity = 0;
    for (const wave of effect.waves) wave.mesh.material.opacity = 0;
    for (const particle of effect.particles) particle.mesh.visible = false;
    byId('blastFlash').style.opacity = '0';
    if (effect.shards.every(shard => shard.settled)) {
      effect.settled = true;
      flash('Explosion complete. Fragments have settled; click Reset Explosion to restore the workspace.');
    } else {
      flash('Explosion effects complete; fragments are still settling.');
    }
  }
  if (effect.effectsFaded && !effect.settled && effect.shards.every(shard => shard.settled)) {
    effect.settled = true;
    flash('Explosion complete. Fragments have settled; click Reset Explosion to restore the workspace.');
  }
}

function explosionShardBottom(shard) {
  const q = shard.mesh.quaternion;
  const rowX = 2 * (q.x * q.y + q.w * q.z);
  const rowY = 1 - 2 * (q.x * q.x + q.z * q.z);
  const rowZ = 2 * (q.y * q.z - q.w * q.x);
  let bottom = Infinity;
  for (const [x, y, z] of shard.groundCorners) {
    bottom = Math.min(bottom,
      rowX * x + rowY * y + rowZ * z + shard.mesh.position.y);
  }
  return bottom;
}

function breakBlock(b) {
  const parent = b.body;
  if (!parent || b.broken) return;
  recordSimulationPeaks();
  const m = MATS[b.mat];
  const demand = b.failureDemand ?? (b.failureMode === 'flexural strength' ? b.flexStress : b.stress);
  const capacity = b.failureCapacity ?? (b.failureMode === 'flexural strength' ? m.fb : m.strength);
  const unit = b.failureUnit || 'MPa';
  const isFrameScreen = Number.isFinite(b.frameFailureRatio);
  const { direction, accelerationG } = currentSimulationLoad();
  const location = memberWorldTransform(b, parent).pos.toArray();
  const fracture = {
    kind: 'fracture',
    id: b.id,
    material: m.name,
    mode: b.failureMode,
    demand: isFrameScreen ? b.frameFailureRatio : demand,
    capacity: isFrameScreen ? 1 : capacity,
    unit: isFrameScreen ? 'x' : unit,
    time: S.t,
    memberKey: memberLearningKey(b),
    position: location,
    region: { center: location, mode: b.failureMode },
    loadDirection: direction,
    accelerationG
  };
  simulationFailures.current.push(fracture);
  if (simulationRunTracking) simulationRunTracking.fractures.push(fracture);
  const members = blocks.filter(x => x.alive && x.body === parent);
  const velocity = parent.velocity.clone(), omega = parent.angularVelocity.clone(), origin = parent.position.clone();
  const originalPose = new Map(members.map(member => [member, { pos: [...member.pos], rot: [...member.rot] }]));
  const runtimePose = new Map(members.map(member => [member, memberWorldTransform(member, parent)]));
  removeFrameBraceConstraintsForBody(parent);
  world.removeBody(parent);
  for (const member of members) { member.body = null; member.rel = null; }

  b.alive = false;
  b.broken = true;
  b.mesh.visible = false;
  for (const j of joints) if (j.a === b || j.b === b) {
    if (j.holds) {
      const jointKey = jointLearningKey(j);
      const other = j.a === b ? j.b : j.a;
      const jointEvent = {
        kind: 'joint-separation', id: b.id, relatedMemberId: other.id,
        material: `${j.kind} joint`, mode: 'joint separation after member fracture',
        demand: j.V, capacity: j.cap, unit: 'N', time: S.t,
        memberKey: memberLearningKey(b), jointKey,
        position: j.pts?.length
          ? j.pts.reduce((sum, point) => sum.add(point), new THREE.Vector3())
            .multiplyScalar(1 / j.pts.length).toArray()
          : location,
        loadDirection: direction, accelerationG
      };
      simulationFailures.current.push(jointEvent);
      if (simulationRunTracking) simulationRunTracking.fractures.push(jointEvent);
      const peak = simulationRunTracking?.joints.get(jointKey);
      if (peak) peak.failures++;
    }
    j.holds = false;
    if (j.vis) j.vis.visible = false;
  }
  spawnBreakFragments(b, { position: origin, velocity, angularVelocity: omega }, runtimePose.get(b));

  const remaining = members.filter(member => member !== b);
  for (const member of remaining) {
    const pose = runtimePose.get(member);
    member.pos = pose.pos.toArray();
    const euler = new THREE.Euler().setFromQuaternion(pose.quat, 'XYZ');
    member.rot = [euler.x / DEG, euler.y / DEG, euler.z / DEG];
  }
  // Dampen the velocity of remaining members so they don't fly off when a piece breaks.
  const velDamp = 0.4;
  const omegaDamp = 0.3;
  for (const group of groupsOf(remaining)) {
    const body = buildGroupBody(group);
    const offset = mutableVector(
      body.position.x - origin.x,
      body.position.y - origin.y,
      body.position.z - origin.z
    );
    const rotational = vectorCross(mutableVector(), omega, offset);
    // Zero out horizontal velocity from earthquake shaking — remaining structure should settle, not glide.
    let vx = (velocity.x + rotational.x) * 0.05;
    let vy = Math.min(velocity.y + rotational.y, 0) * velDamp; // only keep downward
    let vz = (velocity.z + rotational.z) * 0.05;
    // Clamp remaining member speed
    const maxRemSpeed = 5.0;
    const speed = Math.hypot(vx, vy, vz);
    if (speed > maxRemSpeed) {
      const scale = maxRemSpeed / speed;
      vx *= scale; vy *= scale; vz *= scale;
    }
    body.velocity.set(vx, vy, vz);
    body.angularVelocity.set(omega.x * omegaDamp, omega.y * omegaDamp, omega.z * omegaDamp);
  }
  reconnectFrameBraceTargets();
  for (const [member, pose] of originalPose) { member.pos = pose.pos; member.rot = pose.rot; }
  const demandScale = unit === 'MPa' ? 1e6 : unit === 'kN' ? 1000 : 1;
  flash(isFrameScreen
    ? `RC member #${b.id} reached ${b.frameFailureRatio.toFixed(2)}x the simplified damage limit; it fractured into ${fracturePieceCount(b.breakRatio)} pieces.`
    : `${m.name} #${b.id} fractured under ${b.failureMode} demand (${(demand / demandScale).toFixed(2)} / ${(capacity / demandScale).toFixed(2)} ${unit} estimate); fragments released.`);
  changed();
}

function shearLinkCapacityFactor(block) {
  return shearLinkEffects(block).confinedStrengthFactor;
}

function shearLinkEffects(block, spacing = block.shearLinks?.spacing) {
  const material = MATS[block.mat];
  const links = block.shearLinks;
  const { section, core } = shearLinkCoreSection(block);
  const effectiveSection = links ? core : section;
  const coreWidth = Math.max(...effectiveSection.map(point => point[0])) -
    Math.min(...effectiveSection.map(point => point[0]));
  const coreDepth = Math.max(...effectiveSection.map(point => point[1])) -
    Math.min(...effectiveSection.map(point => point[1]));
  const webWidth = Math.max(Math.min(coreWidth, coreDepth), 0.05);
  const effectiveDepth = Math.max(Math.max(coreWidth, coreDepth) * 0.8, 0.05);
  const concreteStrength = Math.max(block.frame?.fck || material.strength, 1e6);
  const concreteStrengthMpa = concreteStrength / 1e6;
  const concreteCoefficient = material.fam === 'concrete' ? 0.17 : 0.08;
  const concreteCapacity = concreteCoefficient * Math.sqrt(concreteStrengthMpa) *
    webWidth * 1000 * effectiveDepth * 1000;
  if (!links) return {
    shearCapacity: concreteCapacity, confinedStrengthFactor: 1, ductilityFactor: 1,
    reinforcementCapacity: 0, transverseRatio: 0, effectiveConfinementPressure: 0
  };
  const barArea = Math.PI * links.diameter ** 2 / 4;
  const linkMaterial = MATS[links.material || 'steel'];
  const selectedSpacing = Math.max(spacing || links.spacing, 0.05);
  const coreArea = Math.max(polygonArea(core), 1e-6);
  const perimeter = core.reduce((sum, point, index) => {
    const next = core[(index + 1) % core.length];
    return sum + Math.hypot(next[0] - point[0], next[1] - point[1]);
  }, 0);
  const transverseRatio = barArea * perimeter / (coreArea * selectedSpacing);
  const effectiveness = Math.max(0.2, Math.min(1,
    1 - selectedSpacing ** 2 / Math.max(6 * coreWidth * coreDepth, 1e-6)));
  const effectiveConfinementPressure = 0.5 * effectiveness * transverseRatio * linkMaterial.strength;
  const pressureRatio = effectiveConfinementPressure / concreteStrength;
  const confinedStrengthFactor = material.fam === 'concrete'
    ? Math.max(1, -1.254 + 2.254 * Math.sqrt(1 + 7.94 * pressureRatio) - 2 * pressureRatio)
    : 1 + pressureRatio;
  const ductilityFactor = 1 + 5 * pressureRatio;
  const reinforcementCapacity = 2 * barArea * linkMaterial.strength *
    effectiveDepth / selectedSpacing;
  return {
    shearCapacity: concreteCapacity + reinforcementCapacity,
    confinedStrengthFactor, ductilityFactor, reinforcementCapacity,
    transverseRatio, effectiveConfinementPressure
  };
}

function shearLinkJointFactor(block) {
  if (!block?.shearLinks) return 1;
  const effects = shearLinkEffects(block, block.shearLinks.endSpacing);
  return Math.max(1, effects.confinedStrengthFactor);
}

function isEligibleShearLinkMember(block) {
  if (!block?.alive || !['concrete', 'brick'].includes(MATS[block.mat]?.fam)) return false;
  const dimensions = [...block.size].sort((a, b) => b - a);
  return dimensions[0] >= 2 * dimensions[1] && dimensions[1] > 0.04 && dimensions[2] > 0.04;
}

function installShearLinks(block, diameter = S.shearLinkThickness,
                           spacing = S.shearLinkSpacing) {
  if (!isEligibleShearLinkMember(block) || block.shearLinks) return false;
  block.shearLinks = {
    diameter,
    spacing,
    endSpacing: Math.max(0.05, spacing * 0.5),
    cover: 0.025,
    material: 'steel'
  };
  try {
    addShearLinkHardware(block);
  } catch (error) {
    block.shearLinks = null;
    throw error;
  }
  return true;
}

function estimatedShearLinkSteelVolume(block, diameter = S.shearLinkThickness,
                                       spacing = S.shearLinkSpacing) {
  const { core, axis } = shearLinkCoreSection(block);
  const perimeter = core.reduce((sum, point, index) => {
    const next = core[(index + 1) % core.length];
    return sum + Math.hypot(next[0] - point[0], next[1] - point[1]);
  }, 0);
  const length = Math.max(...block.verts.map(point => point[axis])) -
    Math.min(...block.verts.map(point => point[axis]));
  const sectionSize = Math.max(
    Math.max(...core.map(point => point[0])) - Math.min(...core.map(point => point[0])),
    Math.max(...core.map(point => point[1])) - Math.min(...core.map(point => point[1]))
  );
  const endZone = Math.min(length * 0.25, Math.max(0.15, 0.75 * sectionSize));
  const endSpacing = Math.max(0.05, spacing * 0.5);
  const tieCount = Math.ceil(2 * endZone / endSpacing) +
    Math.ceil(Math.max(0, length - 2 * endZone) / spacing) + 1;
  const tieLength = perimeter + Math.max(10 * diameter, 0.06);
  return Math.PI * diameter ** 2 / 4 * tieLength * tieCount;
}

function shearLinkSuggestion(block, text, priority = 1) {
  if (!isEligibleShearLinkMember(block) || block.shearLinks) return null;
  const diameter = S.shearLinkThickness, spacing = S.shearLinkSpacing;
  const volume = estimatedShearLinkSteelVolume(block, diameter, spacing);
  return {
    p: priority,
    sev: 'warn',
    text,
    action: `Add ${Math.round(diameter * 1000)} mm steel shear links to member #${block.id}, at ${Math.round(spacing * 1000)} mm spacing`,
    cost: { m3: volume, kg: volume * MATS.steel.rho },
    apply: () => {
      if (!block.alive || block.shearLinks || !isEligibleShearLinkMember(block)) return false;
      pushUndo();
      return installShearLinks(block, diameter, spacing);
    },
    autoKey: `member-shear-links:${block.id}`
  };
}

function addShearLinksToSelection() {
  if (S.sim || S.edit) return flash('Stop the simulation and leave vertex-edit mode before adding shear links.');
  const members = [...S.selected].filter(block => block.alive);
  if (!members.length && S.sel?.alive) members.push(S.sel);
  if (!members.length) return flash('Select a slender concrete or brick column, pillar, or beam first.');
  const targets = members.filter(isEligibleShearLinkMember);
  if (targets.length !== members.length) {
    return flash('Shear links require slender concrete or brick members with enough cross-section for clear cover.');
  }
  const missing = targets.filter(block => !block.shearLinks);
  if (!missing.length) return flash('The selected member(s) already have shear links.');
  pushUndo();
  for (const block of missing) installShearLinks(block);
  changed();
  renderProps();
  const factor = shearLinkCapacityFactor(missing[0]);
  flash(`Added ${Math.round(S.shearLinkThickness * 1000)} mm steel ties to ${missing.length} member(s), at ${Math.round(missing[0].shearLinks.spacing * 1000)} mm midspan spacing and closer end-zone spacing. Estimated confinement modifier: ${factor.toFixed(2)}x. Conceptual simulation heuristic only—not a design check.`);
}

function updateShearLinkControl() {
  const button = byId('addShearLinksBtn');
  const help = byId('shearLinkHelp');
  if (!button || !help) return;
  const members = [...S.selected].filter(block => block.alive);
  if (!members.length && S.sel?.alive) members.push(S.sel);
  const targets = members.filter(isEligibleShearLinkMember);
  const allInstalled = targets.length > 0 && targets.every(block => block.shearLinks);
  button.disabled = S.sim || S.edit || !targets.length || allInstalled;
  if (S.sim) help.textContent = 'Stop the simulation before changing reinforcement.';
  else if (S.edit) help.textContent = 'Finish vertex editing before adding reinforcement.';
  else if (!members.length) help.textContent = 'Select a slender concrete or brick column, pillar, or beam.';
  else if (targets.length !== members.length) help.textContent = 'Select only slender concrete or brick members with adequate cross-section.';
  else if (allInstalled) help.textContent = 'Shear links are already installed on the selected member(s).';
  else help.textContent = `${members.length} eligible member${members.length === 1 ? '' : 's'} selected. Ties follow each member length, with closer end-zone spacing.`;
}

function removeShearLinksFromSelection() {
  const block = S.sel;
  if (S.sim) return flash('Stop the simulation before removing shear links.');
  if (!block?.alive || !block.shearLinks) return;
  pushUndo();
  removeShearLinkHardware(block);
  block.shearLinks = null;
  block.shearRatio = 0;
  block.shearStress = 0;
  changed();
  renderProps();
  flash(`Removed steel shear links from pillar #${block.id}. Ctrl+Z restores them.`);
}

function updateMaterialFailure() {
  let aH = 0;
  if (S.quake !== 'none' && QUAKES[S.quake]) {
    aH = Math.hypot(
      groundA(S.t, QUAKES[S.quake], 'x'),
      groundA(S.t, QUAKES[S.quake], 'z')
    );
  }
  for (const b of blocks) {
    if (!b.alive || !b.body || b.foundation || b.body.type === bodyType.STATIC ||
      b.frame?.role === 'brace') continue;
    const m = MATS[b.mat];
    const compression = Math.max(0, b.load);
    const bounds = new THREE.Box3().setFromObject(b.mesh);
    const worldSize = [bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z];
    const sortedDimensions = [...b.size].sort((a, c) => c - a);
    const slender = sortedDimensions[0] >= 2 * sortedDimensions[1];
    const localLongAxis = b.size.indexOf(Math.max(...b.size));
    const direction = new THREE.Vector3().setComponent(localLongAxis, 1)
      .applyQuaternion(quatOf(b.rot));
    let longAxis = [0, 1, 2].reduce((best, axis) =>
      Math.abs(direction.getComponent(axis)) > Math.abs(direction.getComponent(best)) ? axis : best, 0);
    if (Math.abs(direction.getComponent(longAxis)) < 0.9) {
      longAxis = worldSize.indexOf(Math.max(...worldSize));
    }
    const memberLength = worldSize[longAxis];
    const section = slender ? minimumSection(b, longAxis) : representativeSection(b, longAxis);
    const axialStress = stressFromLoad(compression, section.area);
    const lateralForce = boundedLoad(b.load / G * aH);
    const moment = lateralForce * memberLength / 2;
    const flexX = stressFromLoad(moment, Math.max(section.Sv, MIN_SECTION_AREA));
    const flexZ = stressFromLoad(moment, Math.max(section.Su, MIN_SECTION_AREA));
    const flexStress = Math.max(flexX, flexZ);
    const Imin = Math.min(section.Iu, section.Iv);
    const euler = slender
      ? Math.PI ** 2 * m.E * Imin / Math.max(memberLength * memberLength, 1e-12)
      : Number.MAX_VALUE;
    const bucklingRatio = demandCapacityRatio(compression, euler);
    const linkEffects = m.fam === 'concrete' || m.fam === 'brick'
      ? shearLinkEffects(b) : {
        confinedStrengthFactor: 1, ductilityFactor: 1, shearCapacity: Number.MAX_VALUE
      };
    const linkFactor = linkEffects.confinedStrengthFactor;
    const suggestedRetrofitFactor = b.suggestionConnection ? 4 : 1;
    const axialRatio = demandCapacityRatio(axialStress, m.strength * linkFactor * suggestedRetrofitFactor);
    const flexRatio = demandCapacityRatio(flexStress, m.fb * suggestedRetrofitFactor);
    const ultimateRatio = Math.max(
      demandCapacityRatio(axialStress, m.ultimate * linkFactor * suggestedRetrofitFactor),
      demandCapacityRatio(flexStress, m.ultimate * suggestedRetrofitFactor), bucklingRatio);
    const shearCapacity = slender ? linkEffects.shearCapacity : Number.MAX_VALUE;
    const shearRatio = demandCapacityRatio(lateralForce, shearCapacity);
    b.shearRatio = shearRatio;
    b.shearStress = stressFromLoad(lateralForce, Math.max(section.area, MIN_SECTION_AREA));
    b.breakRatio = Math.max(axialRatio, flexRatio, bucklingRatio, ultimateRatio, shearRatio);
    const mode = shearRatio >= Math.max(axialRatio, flexRatio, bucklingRatio)
      ? 'member shear' : bucklingRatio >= axialRatio && bucklingRatio >= flexRatio
        ? 'Euler buckling' : flexRatio >= axialRatio ? 'flexural strength' : 'axial compression';
    const ultimateCapacity = (m.type === 'ductile' ? m.ultimate : m.strength) *
      linkFactor * suggestedRetrofitFactor;
    b.failureDemand = mode === 'member shear' ? lateralForce : mode === 'Euler buckling' ? compression
      : mode === 'flexural strength' ? flexStress : axialStress;
    b.failureCapacity = mode === 'member shear' ? shearCapacity : mode === 'Euler buckling' ? euler
      : mode === 'flexural strength' ? (m.type === 'ductile' ? m.ultimate : m.fb) *
        suggestedRetrofitFactor : ultimateCapacity;
    b.failureUnit = mode === 'member shear' || mode === 'Euler buckling' ? 'kN' : 'MPa';
    b.stress = axialStress;
    b.flexStress = flexStress;
    b.fos = Math.min(
      factorOfSafety(m.strength * linkFactor, axialStress),
      factorOfSafety(shearCapacity, lateralForce)
    );
    b.failureMode = mode;

    const yieldRatio = Math.max(axialRatio, flexRatio, bucklingRatio, shearRatio);
    const brittleFailure = m.type === 'brittle' && yieldRatio >= 1;
    const ductileFailure = m.type === 'ductile' && (ultimateRatio >= 1 || shearRatio >= 1);
    if (m.type === 'ductile' && yieldRatio >= 1 && !b.yielded) {
      b.yielded = true;
      flash(`${m.name} #${b.id} exceeded its yield threshold in ${mode}; the rigid member is marked yielded.`);
    }
    if (m.type === 'ductile') {
      b.plasticStrain = Math.max(b.plasticStrain,
        Math.max(0, Math.max(axialStress, flexStress) - m.strength) / m.E);
    }
    if (b.shearLinks && brittleFailure) {
      b.yielded = true;
      b.plasticStrain += Math.max(0, yieldRatio - 1) * SOLVER_DT /
        Math.max(linkEffects.ductilityFactor, 1);
    }
    // Confined brittle members accumulate cyclic damage over a longer interval
    // instead of fracturing on their first over-capacity substep.
    const failureSteps = b.shearLinks
      ? Math.max(4, Math.ceil(4 + 8 * (linkEffects.ductilityFactor - 1)))
      : m.type === 'brittle' ? 1 : 3;
    if (brittleFailure || ductileFailure) b.overstressSteps++;
    else b.overstressSteps = 0;
    if (b.overstressSteps >= failureSteps) return b;
  }
  return null;
}

function impactMember(body, shape, contactOffset) {
  const members = bodyMembers.get(body);
  if (!members) return null;
  const shapeIndex = shape ? body.shapes.indexOf(shape) : -1;
  if (shapeIndex >= 0) return members.find(member => member.bodyShapeIndex === shapeIndex) || null;
  const point = new THREE.Vector3(body.position.x + contactOffset.x, body.position.y + contactOffset.y, body.position.z + contactOffset.z);
  return members.reduce((closest, member) => {
    const distance = point.distanceToSquared(v3(member.pos));
    return !closest || distance < closest.distance ? { member, distance } : closest;
  }, null)?.member || null;
}

function updateImpactFailure(preStepVelocities) {
  let worst = null;
  for (const contact of world.contacts) {
    const stateA = preStepVelocities.get(contact.bi), stateB = preStepVelocities.get(contact.bj);
    if (!stateA || !stateB || !contact.ni || !contact.ri || !contact.rj) continue;
    const memberA = impactMember(contact.bi, contact.si, contact.ri);
    const memberB = impactMember(contact.bj, contact.sj, contact.rj);
    if (!memberA && !memberB) continue;
    const pointVelocity = (state, offset) => ({
      x: state[0] + state[4] * offset.z - state[5] * offset.y,
      y: state[1] + state[5] * offset.x - state[3] * offset.z,
      z: state[2] + state[3] * offset.y - state[4] * offset.x
    });
    const velocityA = pointVelocity(stateA, contact.ri);
    const velocityB = pointVelocity(stateB, contact.rj);
    const normalSpeed = Math.abs(
      (velocityA.x - velocityB.x) * contact.ni.x +
      (velocityA.y - velocityB.y) * contact.ni.y +
      (velocityA.z - velocityB.z) * contact.ni.z
    );
    if (normalSpeed < 0.5) continue;
    // Cap at the fastest speed gravity alone can produce in this sandbox
    // (sqrt(2*g*12 m) ~ 15.3 m/s). Anything faster is a solver spike from an
    // overstressed constraint, not a physical impact.
    const impactSpeed = Math.min(normalSpeed, Math.sqrt(2 * G * 12));
    const massA = contact.bi.mass, massB = contact.bj.mass;
    const reducedMass = massA > 0 && massB > 0 ? massA * massB / (massA + massB) : Math.max(massA, massB);
    if (!Number.isFinite(reducedMass) || reducedMass <= 0) continue;
    const impactEnergy = 0.5 * reducedMass * impactSpeed ** 2;
    for (const member of [memberA, memberB]) {
      if (!member?.alive || !member.body || member.broken) continue;
      const material = MATS[member.mat];
      const demand = impactEnergy / Math.max(member.mass, 1e-9);
      // Brittle materials have lower impact resistance; ductile materials absorb more energy
      const impactThreshold = material.impactEnergy * (material.type === 'brittle' ? 0.6 : 1.0);
      const ratio = demand / impactThreshold;
      if (ratio > 1 && (!worst || ratio > worst.ratio)) worst = { member, demand, ratio };
    }
  }
  if (!worst) return null;
  const { member, demand, ratio } = worst;
  member.failureMode = 'impact energy';
  member.failureDemand = demand;
  member.failureCapacity = MATS[member.mat].impactEnergy;
  member.failureUnit = 'J/kg';
  member.breakRatio = Math.max(member.breakRatio || 1, ratio);
  return member;
}

const preStepImpactVelocities = new WeakMap();
function captureImpactVelocities() {
  for (const body of world.bodies) {
    let velocity = preStepImpactVelocities.get(body);
    if (!velocity) {
      velocity = new Float64Array(6);
      preStepImpactVelocities.set(body, velocity);
    }
    velocity[0] = body.velocity.x;
    velocity[1] = body.velocity.y;
    velocity[2] = body.velocity.z;
    velocity[3] = body.angularVelocity.x;
    velocity[4] = body.angularVelocity.y;
    velocity[5] = body.angularVelocity.z;
  }
  return preStepImpactVelocities;
}

// Apply air drag to all dynamic bodies. Drag force is proportional to velocity
// and surface area, but NOT to mass — so lighter objects are slowed more relative
// to their weight, making heavy objects fall faster than light ones.
function applyAirDrag() {
  // Drag coefficient: tuned so the effect is noticeable but doesn't overwhelm gravity.
  // F_drag = -k * A/m * v  (linear drag, proportional to velocity)
  const k = 0.02;
  for (const body of world.bodies) {
    if (body.type !== bodyType.DYNAMIC || body.mass <= 0) continue;
    const vx = body.velocity.x, vy = body.velocity.y, vz = body.velocity.z;
    const speed = Math.hypot(vx, vy, vz);
    if (speed < 0.01) continue;
    // Estimate surface area from the member blocks associated with this body
    const members = bodyMembers.get(body);
    let area = 0;
    if (members) {
      for (const b of members) {
        const s = b.size;
        area += 2 * (s[0] * s[1] + s[0] * s[2] + s[1] * s[2]);
      }
    } else {
      // Debris or other bodies without member mapping — estimate from mass and density
      // Assume a cube: volume = mass/density, side = volume^(1/3), area = 6 * side^2
      const vol = body.mass / 2000; // assume average density 2000 kg/m^3
      const side = Math.pow(vol, 1 / 3);
      area = 6 * side * side;
    }
    if (area < 1e-6) continue;
    // Drag deceleration = k * (A/m) * speed
    const dragAccel = k * (area / body.mass) * speed;
    // Apply drag force opposite to velocity
    const fx = -dragAccel * vx;
    const fy = -dragAccel * vy;
    const fz = -dragAccel * vz;
    body.raw.addForce({ x: fx, y: fy, z: fz }, true);
  }
}

// Ground-based earthquake excitation: the ground plate moves according to the
// recorded acceleration, and objects feel shaking only through contact with the ground.
// Objects in mid-air are unaffected — they only feel gravity.
let groundDispX = 0, groundDispZ = 0, groundVelX = 0, groundVelZ = 0;
function applyEarthquake() {
  if (S.quake === 'none' || !QUAKES[S.quake]) return;
  const q = QUAKES[S.quake];
  const dt = SOLVER_DT;
  const ax0 = groundA(S.t, q, 'x'), ax1 = groundA(S.t + dt, q, 'x');
  const az0 = groundA(S.t, q, 'z'), az1 = groundA(S.t + dt, q, 'z');
  const nextVelX = groundVelX + (ax0 + ax1) * 0.5 * dt;
  const nextVelZ = groundVelZ + (az0 + az1) * 0.5 * dt;
  groundDispX += (groundVelX + nextVelX) * 0.5 * dt;
  groundDispZ += (groundVelZ + nextVelZ) * 0.5 * dt;
  groundVelX = nextVelX;
  groundVelZ = nextVelZ;
  // Move the ground plate (kinematic body) to the new position
  plateBody.type = bodyType.KINEMATIC;
  plateBody.setNextKinematicTranslation({ x: groundDispX, y: -0.05, z: groundDispZ });
  // Move the visual ground group to match
  groundGroup.position.set(groundDispX, 0, groundDispZ);
}

function syncDebris() {
  for (const piece of debris) {
    const timeStep = Math.max(0, S.t - piece.lastSyncTime);
    piece.lastSyncTime = S.t;
    const body = piece.body;
    if (!body.raw.isSleeping()) {
      const supportedByGround = world.contacts.some(contact =>
        (contact.bi === body && contact.bj === plateBody) ||
        (contact.bj === body && contact.bi === plateBody));
      const slow = Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z) < 0.12 &&
        Math.hypot(body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z) < 0.12;
      piece.settledTime = supportedByGround && slow ? piece.settledTime + timeStep : 0;
      if (piece.settledTime >= 0.6) {
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);
        body.raw.sleep();
      }
    }
    piece.mesh.position.set(piece.body.position.x, piece.body.position.y, piece.body.position.z);
    piece.mesh.quaternion.set(piece.body.quaternion.x, piece.body.quaternion.y, piece.body.quaternion.z, piece.body.quaternion.w);
  }
}

function simulationSceneSignature() {
  const members = blocks.filter(block => block.alive).map(block => ({
    id: block.id, mat: block.mat, pos: block.pos, rot: block.rot, size: block.size,
    foundation: block.foundation, shearLinks: block.shearLinks,
    ties: block.ties, frame: block.frame, suggestedBearing: block.suggestedBearing,
    suggestionConnection: block.suggestionConnection,
    learnedRetrofitRiskRatio: block.learnedRetrofitRiskRatio
  }));
  // Runtime fractures toggle `holds`; topology remains part of the authored scene.
  const connections = joints.map(joint => [joint.a.id, joint.b.id, joint.kind]);
  return JSON.stringify([S.quake, members, connections]);
}

function updateSimulationPreparationUi() {
  const prepareButton = byId('prepareBtn');
  if (prepareButton) {
    prepareButton.textContent = simulationBakeState ? 'Stop Building' : 'Build Sim';
    prepareButton.disabled = (!!S.sim && !simulationBakeState) || !!sceneExplosion;
    prepareButton.classList.toggle('on', !!bakedSimulation);
    prepareButton.title = bakedSimulation
      ? 'Build or rebuild the cached simulation; stop to keep the frames baked so far'
      : 'Precompute simulation motion for smooth playback';
  }
  const runButton = byId('runBtn');
  if (runButton) {
    runButton.textContent = S.sim && !simulationPlayback && !simulationBakeState ? 'Stop Live' : 'Run Live';
    runButton.disabled = !!simulationPlayback || !!simulationBakeState || !!sceneExplosion;
  }
  const playButton = byId('playBakedBtn');
  if (playButton) {
    playButton.textContent = bakedPlaybackShown ? 'Reset' : 'Play Baked';
    playButton.disabled = (!bakedPlaybackShown && (!bakedSimulation || S.sim)) || !!sceneExplosion;
    playButton.title = bakedPlaybackShown
      ? 'Stop playback and return to the built workspace state'
      : 'Play the cached simulation';
  }
  const explodeButton = byId('explodeBtn');
  if (explodeButton) {
    explodeButton.querySelector('span').textContent = sceneExplosion ? 'RESET' : 'EXPLODE';
    explodeButton.setAttribute('aria-label', sceneExplosion ? 'Reset explosion' : 'Explode scene');
    explodeButton.disabled = !sceneExplosion && (S.sim || S.edit || !!framePlacement);
  }
}

function applyBakedFrame(cache, frame) {
  for (let index = 0; index < cache.blocks.length; index++) {
    const block = cache.blocks[index], offset = index * 8;
    block.mesh.position.fromArray(frame.blocks, offset);
    block.mesh.quaternion.set(
      frame.blocks[offset + 3], frame.blocks[offset + 4],
      frame.blocks[offset + 5], frame.blocks[offset + 6]
    ).normalize();
    block.mesh.visible = frame.blocks[offset + 7] > 0.5;
  }
  for (let index = 0; index < cache.debris.length; index++) {
    const piece = cache.debris[index], offset = index * 8;
    const visible = offset + 7 < frame.debris.length && frame.debris[offset + 7] > 0.5;
    piece.mesh.visible = visible;
    if (!visible) continue;
    piece.mesh.position.fromArray(frame.debris, offset);
    piece.mesh.quaternion.set(
      frame.debris[offset + 3], frame.debris[offset + 4],
      frame.debris[offset + 5], frame.debris[offset + 6]
    ).normalize();
  }
  cache.joints.forEach((joint, index) => {
    if (joint.vis) joint.vis.visible = !!frame.joints[index];
  });
  if (frame.ground) {
    plateBody.position.set(frame.ground[0], -0.05, frame.ground[1]);
    groundGroup.position.set(frame.ground[0], 0, frame.ground[1]);
  }
  S.t = frame.time;
}

function discardBakedSimulation() {
  if (!bakedSimulation) return;
  applyBakedFrame(bakedSimulation, bakedSimulation.frames[0]);
  for (const piece of bakedSimulation.debris) {
    scene.remove(piece.mesh);
    piece.mesh.geometry.dispose();
    disposeMaterialMaps(piece.mesh.material);
    piece.mesh.material.dispose();
  }
  debris.length = 0;
  bakedSimulation = null;
  bakedPlaybackShown = false;
  byId('playBakedBtn').classList.remove('running');
  updateSimulationPreparationUi();
}

function buildSimulationWorld() {
  refreshExcavation();
  const alive = blocks.filter(b => b.alive);
  simulationPoseSnapshot = new Map(alive.map(block => [block, {
    pos: [...block.pos], rot: [...block.rot]
  }]));
  const halfX = alive.reduce((extent, block) =>
    Math.max(extent, Math.abs(block.pos[0]) + block.size[0] * 0.5), 1);
  const halfZ = alive.reduce((extent, block) =>
    Math.max(extent, Math.abs(block.pos[2]) + block.size[2] * 0.5), 1);
  quakeWaveHalfDiag = Math.hypot(halfX, halfZ);
  simulationFrameModels = [];
  if (S.quake !== 'none') {
    const assemblies = new Map();
    for (const member of alive.filter(block => block.frame?.model === 'rc-frame')) {
      const key = member.frame.assemblyId || 'legacy-frame';
      if (!assemblies.has(key)) assemblies.set(key, []);
      assemblies.get(key).push(member);
    }
    for (const members of assemblies.values()) {
      const model = frameModelForRun(members);
      if (model && frameBearsOnGround(members)) simulationFrameModels.push(model);
    }
  }
  lastFrameReport = null;
  lastFrameReports = [];
  clearFrameBraceRuntime();
  for (const b of alive) { b.body = null; b.rel = null; b.frameBody = null; }
  for (const model of simulationFrameModels) createFrameCollisionBodies(model);
  const userFrame = frameGridForBraceTool();
  const bracedUserFrame = userFrame?.model === 'user-frame' &&
  alive.some(block => block.frame?.model === 'user-frame' && block.frame.role === 'brace')
    ? userFrame : null;
  const userFrameMembers = new Set(bracedUserFrame?.frameMembers || []);
  const rigidMembers = alive.filter(b => b.frame?.model !== 'rc-frame' &&
    b.frame?.role !== 'brace' && !userFrameMembers.has(b));
  const rigidGroups = groupsOf(rigidMembers);
  if (userFrameMembers.size) rigidGroups.push([...userFrameMembers].filter(block => block.alive));
  const modeledMembers = new Set(simulationFrameModels.flatMap(model => model.members));
  const rigidFrameAssemblies = new Map();
  for (const member of alive.filter(block => block.frame?.model === 'rc-frame' &&
    block.frame.role !== 'brace' && !modeledMembers.has(block))) {
    const key = member.frame.assemblyId || 'legacy-frame';
    if (!rigidFrameAssemblies.has(key)) rigidFrameAssemblies.set(key, []);
    rigidFrameAssemblies.get(key).push(member);
  }
  rigidGroups.push(...rigidFrameAssemblies.values());
  for (const group of rigidGroups) buildGroupBody(group);
  createFrameBraceBodies(alive, simulationFrameModels);
  return {
    alive,
    bodies: new Set(world.bodies.filter(body => body !== plateBody && !debris.some(piece => piece.body === body)))
  };
}

function prepareSim() {
  if (S.sim) return flash('Stop the simulation before preparing it.');
  if (S.edit) exitEdit();
  if (T) cancelT();
  if (S.braceMode) setBraceMode(false);
  if (S.infillMode) setInfillMode(false);
  if (blocks.length === 0) return flash('Add some blocks before building the simulation.');
  if (S.dirty) analyze();
  discardBakedSimulation();
  startSim();
  if (!S.sim) return;
  const cache = {
    signature: simulationSceneSignature(),
    blocks: [...blocks],
    joints: [...joints],
    frames: [],
    debris: [],
    bytes: 0,
    steps: 0
  };
  simulationBakeState = cache;
  captureBakedFrame(cache);
  updateSimulationPreparationUi();
  flash('Building simulation cache. Stop Build at any time to keep and play the frames baked so far.');
  requestAnimationFrame(() => bakeSimulationChunk(cache));
}

function captureBakedFrame(cache) {
  const blockFrames = new Float32Array(cache.blocks.length * 8);
  cache.blocks.forEach((block, index) => {
    const offset = index * 8, position = block.mesh.position, rotation = block.mesh.quaternion;
    blockFrames.set([position.x, position.y, position.z, rotation.x, rotation.y,
      rotation.z, rotation.w, block.mesh.visible ? 1 : 0], offset);
  });
  for (const piece of debris) {
    if (cache.debris.includes(piece)) continue;
    cache.debris.push(piece);
    for (const frame of cache.frames) {
      const padded = new Float32Array(frame.debris.length + 8);
      padded.set(frame.debris);
      const offset = frame.debris.length;
      padded.set([piece.mesh.position.x, piece.mesh.position.y, piece.mesh.position.z,
        piece.mesh.quaternion.x, piece.mesh.quaternion.y, piece.mesh.quaternion.z,
        piece.mesh.quaternion.w, 0], offset);
      frame.debris = padded;
      cache.bytes += 8 * Float32Array.BYTES_PER_ELEMENT;
    }
  }
  const debrisFrames = new Float32Array(cache.debris.length * 8);
  debris.forEach(piece => {
    const index = cache.debris.indexOf(piece);
    const offset = index * 8, position = piece.mesh.position, rotation = piece.mesh.quaternion;
    debrisFrames.set([position.x, position.y, position.z, rotation.x, rotation.y,
      rotation.z, rotation.w, 1], offset);
  });
  cache.bytes += blockFrames.byteLength + debrisFrames.byteLength;
  const jointFrames = Uint8Array.from(cache.joints, joint => joint.vis?.visible ? 1 : 0);
  cache.bytes += jointFrames.byteLength;
  if (cache.bytes > MAX_BAKED_CACHE_BYTES) {
    throw new RangeError(`Baked simulation exceeded the ${Math.round(MAX_BAKED_CACHE_BYTES / 1024 / 1024)} MB cache limit.`);
  }
  cache.frames.push({
    time: S.t, blocks: blockFrames, debris: debrisFrames,
    joints: jointFrames,
    ground: new Float32Array([plateBody.position.x, plateBody.position.z])
  });
}

function bakeSimulationChunk(cache) {
  if (simulationBakeState !== cache || !S.sim) return;
  try {
    const duration = S.quake === 'none' ? BAKED_GRAVITY_DURATION : QUAKES[S.quake].dur;
    for (let step = 0; step < BAKED_STEPS_PER_CHUNK && S.t < duration && S.sim; step++) {
      physics(FIX);
      if (!S.sim || simulationBakeState !== cache) return;
      syncFromBodies();
      updateFrameModelVisuals();
      cache.steps++;
      if (cache.steps % BAKED_CAPTURE_STRIDE === 0 || S.t >= duration) captureBakedFrame(cache);
      if (S.t >= duration) break;
    }
    if (!S.sim) return;
    if (S.t < duration) {
      flash(`Building simulation cache… ${S.t.toFixed(1)} / ${duration.toFixed(1)} s`);
      requestAnimationFrame(() => bakeSimulationChunk(cache));
      return;
    }
    finishBakedSimulation(cache);
  } catch (error) {
    simulationBakeState = null;
    stopSim();
    updateSimulationPreparationUi();
    flash(`Could not build simulation cache: ${error.message}`);
  }
}

function finishBakedSimulation(cache = simulationBakeState) {
  if (!cache || simulationBakeState !== cache) return;
  try {
    if (cache.frames.at(-1)?.time !== S.t) captureBakedFrame(cache);
    simulationBakeState = null;
    stopSim({ preserveDebris: true });
    for (const piece of cache.debris) piece.mesh.visible = false;
    bakedSimulation = cache;
    applyBakedFrame(cache, cache.frames[0]);
    updateSimulationPreparationUi();
    flash(`Simulation built: ${cache.frames.length} cached frames through ${cache.frames.at(-1).time.toFixed(2)} s (${(cache.bytes / 1024 / 1024).toFixed(1)} MB). Press Play Baked to review.`);
  } catch (error) {
    simulationBakeState = null;
    stopSim();
    updateSimulationPreparationUi();
    flash(`Could not finish simulation cache: ${error.message}`);
  }
}

function playBakedSimulation() {
  if (!bakedSimulation) return startSim();
  if (bakedSimulation.signature !== simulationSceneSignature()) {
    discardBakedSimulation();
    return startSim();
  }
  applyBakedFrame(bakedSimulation, bakedSimulation.frames[0]);
  simulationPlayback = {
    cache: bakedSimulation,
    time: 0,
    lowerIndex: 0,
    frame: {
      time: 0,
      blocks: new Float32Array(bakedSimulation.frames[0].blocks.length),
      debris: new Float32Array(bakedSimulation.frames[0].debris.length),
      joints: new Uint8Array(bakedSimulation.frames[0].joints.length),
      ground: new Float32Array(2)
    }
  };
  S.sim = true;
  S.t = 0;
  bakedPlaybackShown = true;
  updateShearLinkControl();
  updateSimulationPreparationUi();
  byId('playBakedBtn').classList.add('running');
  byId('quakeSel').disabled = true;
  renderSugs();
}

function updateBakedPlayback(dt) {
  if (!simulationPlayback) return;
  const { cache } = simulationPlayback;
  simulationPlayback.time = Math.min(cache.frames.at(-1).time,
    simulationPlayback.time + Math.min(dt, 0.05));
  const frames = cache.frames;
  while (simulationPlayback.lowerIndex + 1 < frames.length - 1 &&
    frames[simulationPlayback.lowerIndex + 1].time < simulationPlayback.time) {
    simulationPlayback.lowerIndex++;
  }
  const lower = frames[simulationPlayback.lowerIndex];
  const upper = frames[Math.min(simulationPlayback.lowerIndex + 1, frames.length - 1)];
  const mix = upper.time > lower.time
    ? Math.max(0, Math.min(1, (simulationPlayback.time - lower.time) / (upper.time - lower.time))) : 0;
  const frame = simulationPlayback.frame;
  frame.time = simulationPlayback.time;
  frame.joints = mix < 0.5 ? lower.joints : upper.joints;
  for (let index = 0; index < lower.blocks.length; index++) {
    frame.blocks[index] = lower.blocks[index] + (upper.blocks[index] - lower.blocks[index]) * mix;
  }
  for (let index = 0; index < frame.debris.length; index++) {
    frame.debris[index] = lower.debris[index] +
      (upper.debris[index] - lower.debris[index]) * mix;
  }
  for (let index = 0; index < frame.ground.length; index++) {
    frame.ground[index] = lower.ground[index] + (upper.ground[index] - lower.ground[index]) * mix;
  }
  applyBakedFrame(cache, frame);
  if (simulationPlayback.time >= frames.at(-1).time) {
    simulationPlayback = null;
    S.sim = false;
    byId('playBakedBtn').classList.remove('running');
    byId('quakeSel').disabled = false;
    updateShearLinkControl();
    updateSimulationPreparationUi();
  }
}

function resetBakedPlayback() {
  if (!bakedSimulation) return;
  simulationPlayback = null;
  S.sim = false;
  applyBakedFrame(bakedSimulation, bakedSimulation.frames[0]);
  bakedPlaybackShown = false;
  byId('playBakedBtn').classList.remove('running');
  byId('quakeSel').disabled = false;
  updateShearLinkControl();
  updateSimulationPreparationUi();
  renderProps();
  renderSugs();
}

function startSim() {
  if (blockPlacement) cancelBlockPlacement();
  if (bakedSimulation) discardBakedSimulation();
  if (S.edit) exitEdit();
  if (T) cancelT();
  if (S.braceMode) setBraceMode(false);
  if (S.infillMode) setInfillMode(false);
  if (blocks.length === 0) return flash('Add some blocks first.');
  if (S.dirty) analyze();
  const { alive } = buildSimulationWorld();
  updateSimulationPreparationUi();
  acc = 0;
  simulationFailures.current = [];
  simulationLearningContext = { quake: S.quake };
  simulationRunTracking = {
    startedAt: Date.now(), blocks: new Map(), joints: new Map(), fractures: []
  };
  S.sim = true; S.t = 0;
  updateShearLinkControl();
  groundDispX = 0; groundDispZ = 0; groundVelX = 0; groundVelZ = 0;
  plateBody.position.set(0, -0.05, 0);
  plateBody.velocity.set(0, 0, 0);
  plateBody.type = bodyType.STATIC;
  for (const j of joints) if (j.vis) j.vis.visible = j.holds;
  byId('runBtn').textContent = 'Stop';
  byId('runBtn').classList.add('running');
  byId('quakeSel').disabled = true;
  const bodies = new Set(alive.filter(b => b.body).map(b => b.body)).size;
  const frameText = simulationFrameModels.length
    ? ` and Newmark response for ${simulationFrameModels.length} RC frame${simulationFrameModels.length === 1 ? '' : 's'}` : '';
  const quakeText = S.quake !== 'none' ? `. ${QUAKES[S.quake].name} starts` : ' under gravity';
  flash(`Simulating ${alive.length} blocks as ${bodies} rigid bodies${frameText}${quakeText}.`);
  updateSimulationPreparationUi();
  renderSugs();
}

function stopSim(options = {}) {
  simulationBakeState = null;
  simulationPlayback = null;
  S.sim = false;
  acc = 0;
  clearFrameBraceRuntime();
  lastFrameReports = simulationFrameModels.map(model => ({
    assemblyId: model.assemblyId,
    floors: model.floors,
    maxDrift: model.maxDrift,
    maxRatio: model.maxRatio,
    maxBaseShear: model.maxBaseShear,
    failedCount: model.failedCount,
    peakTime: model.peakTime,
    ariasIntensity: model.ariasIntensity,
    collapseStory: model.collapseStory,
    quake: S.quake,
    rebarRatio: model.rebarRatio,
    maxTorsionRatio: model.maxTorsionRatio,
    softStoryRatios: Array.from(model.softStoryRatios),
    softStoryStories: [...model.softStoryStories],
    torsionStories: [...model.torsionStories],
    storyPeakDrift: Array.from(model.storyPeakDrift)
  }));
  lastFrameReport = lastFrameReports[0] || null;
  simulationFrameModels = [];
  recordSimulationPeaks();
  simulationFailures.last = [...simulationFailures.current];
  recordSimulationOutcome(simulationFailures.current, simulationLearningContext, S.t, simulationRunTracking);
  simulationLearningContext = null;
  simulationRunTracking = null;
  simulationFailures.current = [];
  for (const piece of debris) {
    if (world.bodies.includes(piece.body)) world.removeBody(piece.body);
    if (!options.preserveDebris) {
      scene.remove(piece.mesh);
      piece.mesh.geometry.dispose();
      disposeMaterialMaps(piece.mesh.material);
      piece.mesh.material.dispose();
    }
  }
  debris.length = 0;
  for (const b of blocks) {
    if (b.body && world.bodies.includes(b.body)) world.removeBody(b.body);
    if (b.frameBody && world.bodies.includes(b.frameBody)) world.removeBody(b.frameBody);
    b.body = null; b.rel = null; b.frameBody = null;
    const builtPose = simulationPoseSnapshot?.get(b);
    if (builtPose) {
      b.pos = [...builtPose.pos];
      b.rot = [...builtPose.rot];
    }
    b.alive = true;
    b.broken = false;
    b.yielded = false;
    b.plasticOffset = 0;
    b.plasticStrain = 0;
    b.frameAxialForce = 0;
    b.overstressSteps = 0;
    b.breakRatio = 1;
    b.shearRatio = 0;
    b.shearStress = 0;
    b.frameFailureRatio = null;
    b.failureMode = '';
    b.frameDamage = 0;
    b.frameFailed = false;
    b.frameReleased = false;
    b.mesh.visible = true;
    sync(b);
  }
  simulationPoseSnapshot = null;
  plateBody.type = bodyType.STATIC;
  plateBody.position.set(0, -0.05, 0);
  plateBody.velocity.set(0, 0, 0);
  groundGroup.position.set(0, 0, 0);
  groundDispX = 0; groundDispZ = 0; groundVelX = 0; groundVelZ = 0;
  for (const j of joints) if (j.vis) j.vis.visible = true;
  S.t = 0;
  byId('runBtn').textContent = 'Run';
  byId('runBtn').classList.remove('running');
  byId('quakeSel').disabled = false;
  flash(`Stopped. Structure reset to its built state.${simulationFailures.last.length ? ` ${simulationFailures.last.length} fracture${simulationFailures.last.length === 1 ? '' : 's'} recorded in the last simulation.` : ''}`);
  if (!options.preserveDebris) changed();
  renderProps();
  updateSimulationPreparationUi();
}

// Parse the corrected, recorded acceleration series. The source files store
// time in seconds and acceleration in g at 0.02 s intervals. Both horizontal
// components are trimmed to their common duration before interpolation.
function parseAccelerogram(text) {
  return text.trim().split(/\r?\n/).map(line => {
    const [time, acceleration] = line.trim().split(/\s+/).map(Number);
    if (!Number.isFinite(time) || !Number.isFinite(acceleration)) throw new Error('Invalid accelerogram sample.');
    return { time, acceleration };
  });
}
const EL_CENTRO_DT = 0.02;
const EL_CENTRO_NS = parseAccelerogram(elCentroNSData);
const EL_CENTRO_EW = parseAccelerogram(elCentroEWData);
const EL_CENTRO_COUNT = Math.min(EL_CENTRO_NS.length, EL_CENTRO_EW.length);
const EL_CENTRO_DURATION = (EL_CENTRO_COUNT - 1) * EL_CENTRO_DT;
// Peak resultant acceleration of the unscaled record, in g. Each preset's scale is
// derived from its stated moment magnitude so the motion matches that intensity.
let EL_CENTRO_PEAK_G = 0;
for (let i = 0; i < EL_CENTRO_COUNT; i++) {
  EL_CENTRO_PEAK_G = Math.max(EL_CENTRO_PEAK_G, Math.hypot(EL_CENTRO_NS[i].acceleration, EL_CENTRO_EW[i].acceleration));
}
for (const q of Object.values(QUAKES)) {
  if (!q) continue;
  q.dur = EL_CENTRO_DURATION;
  q.scale = EL_CENTRO_PEAK_G > 0 ? magnitudeToPGA(q.mag) / EL_CENTRO_PEAK_G : 1;
}
const Q_MOTION = new Map();
function quakeMotion(q) {
  if (Q_MOTION.has(q)) return Q_MOTION.get(q);
  const count = EL_CENTRO_COUNT - 1, dt = EL_CENTRO_DT;
  const ax = new Float64Array(count + 1), az = new Float64Array(count + 1);
  let peakX = 0, peakZ = 0;
  for (let i = 0; i <= count; i++) {
    ax[i] = EL_CENTRO_NS[i].acceleration * G * q.scale;
    az[i] = EL_CENTRO_EW[i].acceleration * G * q.scale;
    peakX = Math.max(peakX, Math.abs(ax[i]));
    peakZ = Math.max(peakZ, Math.abs(az[i]));
  }
  const motion = { dt, count, ax, az, peakX, peakZ };
  Q_MOTION.set(q, motion);
  return motion;
}
function motionSample(values, motion, t) {
  if (t <= 0) return values[0];
  if (t >= motion.count * motion.dt) return values[motion.count];
  const index = t / motion.dt, i = Math.floor(index), part = index - i;
  return values[i] * (1 - part) + values[i + 1] * part;
}
function groundAxis(t, q, axis, kind) {
  const motion = quakeMotion(q);
  if (kind !== 'a') throw new Error(`Unsupported ground motion quantity: ${kind}`);
  return motionSample(motion['a' + axis], motion, t);
}
function rotatedGround(t, q, kind, axis) {
  return groundAxis(t, q, axis, kind);
}
function groundA(t, q, axis = 'x') { return rotatedGround(t, q, 'a', axis); }
function groundPeaks(q) {
  const motion = quakeMotion(q);
  let x = 0, z = 0, resultant = 0;
  for (let i = 0; i <= motion.count; i++) {
    const ax = motion.ax[i], az = motion.az[i];
    x = Math.max(x, Math.abs(ax));
    z = Math.max(z, Math.abs(az));
    resultant = Math.max(resultant, Math.hypot(ax, az));
  }
  return { x: x / G, z: z / G, resultant: resultant / G };
}

function frameBearsOnGround(alive) {
  return alive.some(b => b.frame?.role === 'footing' && b.pos[1] - b.size[1] / 2 <= 0.02);
}
function frameModelForRun(alive, preserveDamage = false) {
  const members = alive.filter(b => b.frame?.model === 'rc-frame');
  // The frame model analyzes the RC frame members even when other (non-frame)
  // blocks share the workspace; those blocks become ordinary rigid bodies.
  if (!members.length) return null;
  const data = members[0].frame;
  if (members.some(b => b.frame.storyHeight !== data.storyHeight || b.frame.floors !== data.floors ||
    b.frame.profile !== data.profile)) return null;
  const floors = data.floors;
  const columns = Array.from({ length: floors }, () => []);
  const beams = Array.from({ length: floors }, () => []);
  const storyElements = Array.from({ length: floors }, () => []);
  const dampers = Array.from({ length: floors }, () => []);
  for (const b of members) {
    if (b.frame.role === 'column') columns[b.frame.story - 1]?.push(b);
    if (b.frame.role === 'beam') beams[b.frame.story - 1]?.push(b);
    if (b.frame.role === 'damper') dampers[b.frame.story - 1]?.push(b);
    if (!preserveDamage) {
      b.frameDamage = 0;
      b.frameFailed = false;
      b.frameReleased = false;
      b.plasticOffset = 0;
      b.plasticStrain = 0;
      b.frameAxialForce = 0;
      b.yielded = false;
    }
  }

  const baseKX = [], baseKZ = [];
  for (let i = 0; i < floors; i++) {
    const storyColumns = columns[i];
    if (!storyColumns.length) return null;
    const columnKX = storyColumns.map(b => {
      const len = Math.max(b.size[1], 0.1);
      const inertia = b.size[2] * b.size[0] ** 3 / 12;
      b.frameKX = 12 * (b.frame.E || MATS[b.mat].E) * inertia * 0.7 / len ** 3;
      return b.frameKX;
    });
    const columnKZ = storyColumns.map(b => {
      const len = Math.max(b.size[1], 0.1);
      const inertia = b.size[0] * b.size[2] ** 3 / 12;
      b.frameKZ = 12 * (b.frame.E || MATS[b.mat].E) * inertia * 0.7 / len ** 3;
      return b.frameKZ;
    });
    const beam = beams[i][0]?.frame;
    const avgSpan = Math.max(beam?.bay || 4, 0.5);
    const beamWidth = beam?.beamWidth || 0.3;
    const beamDepth = beam?.beamDepth || 0.55;
    const columnSide = beam?.columnSide || 0.4;
    const ib = beamWidth * beamDepth ** 3 / 12 * 0.35;
    const ic = columnSide ** 4 / 12 * 0.7;
    const rho = (ib / avgSpan) / Math.max(ic / data.storyHeight, 1e-12);
    const alpha = Math.max(0.25, Math.min(1, 6 * rho / (6 + rho)));
    const beamPresence = Math.max(0, Math.min(1, beams[i].length / Math.max(data.expectedBeamCount, 1)));
    const restraint = beamPresence * alpha + (1 - beamPresence) * 0.25;
    for (let j = 0; j < storyColumns.length; j++) {
      const b = storyColumns[j];
      const linkEffects = shearLinkEffects(b);
      const cyclicDampingRatio = b.shearLinks
        ? Math.min(0.15, 0.02 + 0.04 * (linkEffects.ductilityFactor - 1)) : 0;
      const kx = columnKX[j] * restraint, kz = columnKZ[j] * restraint;
      storyElements[i].push({
        member: b, x: b.pos[0], z: b.pos[2],
        kx, kz,
        cx: 2 * cyclicDampingRatio * Math.sqrt(Math.max(b.mass * kx, 0)),
        cz: 2 * cyclicDampingRatio * Math.sqrt(Math.max(b.mass * kz, 0)),
        cyclicDampingRatio,
        kind: 'column'
      });
    }
    for (const b of members) {
      if (b.frame.story === i + 1 && b.frame.role === 'infill') {
        // Infill walls act like shear panels: compute axial stiffness projected to global axes.
        const orientation = b.frame.orientation;
        const wallLength = orientation === 'x' ? b.size[0] : b.size[2];
        const wallThickness = orientation === 'x' ? b.size[2] : b.size[0];
        const wallHeight = Math.max(b.size[1], 0.1);
        const wallArea = wallLength * wallThickness;
        const wallE = MATS[b.mat].E;
        const wallShearModulus = wallE / 2.4;
        const wallInertia = wallThickness * wallLength ** 3 / 12;
        const flexuralK = 3 * wallE * wallInertia / wallHeight ** 3;
        const shearK = (5 / 6) * wallShearModulus * wallArea / wallHeight;
        const wallK = 1 / (1 / Math.max(flexuralK, 1) + 1 / Math.max(shearK, 1));
        storyElements[i].push({
          member: b, x: b.pos[0], z: b.pos[2],
          kx: orientation === 'x' ? wallK : wallK * 0.01,
          kz: orientation === 'z' ? wallK : wallK * 0.01,
          kind: 'infill'
        });
      }
    }

    for (const b of members) {
      if (b.frame.story !== i + 1) continue;
      const role = b.frame.role, E = b.frame.E || MATS[b.mat].E;
      if (role === 'brace' && b.frame.endpoints?.length === 2) {
        const [p0, p1] = b.frame.endpoints;
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
        const length = Math.hypot(dx, dy, dz);
        const area = Math.max(b.size[0] * b.size[2], 1e-6);
        const axialK = E * area / Math.max(length, 0.1);
        const axialC = 2 * 0.02 * Math.sqrt(axialK * Math.max(b.mass / 4, 1));
        storyElements[i].push({
          member: b, x: (p0[0] + p1[0]) / 2, z: (p0[2] + p1[2]) / 2,
          kx: axialK * (dx / length) ** 2,
          kz: axialK * (dz / length) ** 2,
          kxz: axialK * dx * dz / length ** 2, kind: 'brace',
          cx: axialC * (dx / length) ** 2,
          cz: axialC * (dz / length) ** 2,
          cxz: axialC * dx * dz / length ** 2,
          axialK, length, direction: [dx / length, dy / length, dz / length]
        });
      } else if (role === 'shear-wall') {
        const orientation = b.frame.orientation;
        const length = orientation === 'x' ? b.size[0] : b.size[2];
        const thickness = orientation === 'x' ? b.size[2] : b.size[0];
        const height = Math.max(b.size[1], 0.1);
        const area = length * thickness;
        const inertia = thickness * length ** 3 / 12;
        const shearModulus = E / 2.4;
        const flexuralK = 3 * E * inertia / height ** 3;
        const shearK = (5 / 6) * shearModulus * area / height;
        const wallK = 1 / (1 / Math.max(flexuralK, 1) + 1 / Math.max(shearK, 1));
        storyElements[i].push({
          member: b, x: b.pos[0], z: b.pos[2],
          kx: orientation === 'x' ? wallK : wallK * 0.01,
          kz: orientation === 'z' ? wallK : wallK * 0.01,
          kind: 'shear-wall'
        });
      }
    }

    for (const b of dampers[i]) {
      const [p0, p1] = b.frame.endpoints || [];
      if (!p0 || !p1) continue;
      const dx = p1[0] - p0[0], dz = p1[2] - p0[2];
      const length = Math.hypot(dx, p1[1] - p0[1], dz);
      const coefficient = b.frame.dampingCoefficient || 0;
      storyElements[i].push({
        member: b, x: (p0[0] + p1[0]) / 2, z: (p0[2] + p1[2]) / 2,
        kx: 0, kz: 0,
        cx: coefficient * (dx / length) ** 2,
        cz: coefficient * (dz / length) ** 2,
        cxz: coefficient * dx * dz / length ** 2,
        kind: 'damper'
      });
    }
    const horizontal = storyElements[i].reduce((sum, element) => ({
      x: sum.x + element.kx, z: sum.z + element.kz
    }), { x: 0, z: 0 });
    baseKX.push(Math.max(horizontal.x, 1e4));
    baseKZ.push(Math.max(horizontal.z, 1e4));
  }
  const softStoryRatios = new Float64Array(Math.max(0, floors - 1));
  const softStoryStories = [];
  for (let i = 0; i < floors - 1; i++) {
    const ratio = Math.min(baseKX[i] / baseKX[i + 1], baseKZ[i] / baseKZ[i + 1]);
    softStoryRatios[i] = ratio;
    if (ratio < 0.7) softStoryStories.push(i + 1);
  }

  const baseFloorMass = (data.deadLoad + data.liveLoad * 0.3) * 1000 * data.footprintArea / G;
  const mass = new Float64Array(floors);
  const massCenterX = new Float64Array(floors), massCenterZ = new Float64Array(floors);
  const rotationalMass = new Float64Array(floors);
  const halfPlan = Math.sqrt(data.footprintArea) / 2;
  for (let i = 0; i < floors; i++) {
    let addedMass = 0, momentX = 0, momentZ = 0;
    let polarMassAboutOrigin = baseFloorMass * data.footprintArea / 6;
    for (const element of storyElements[i]) {
      if (!element.member || element.kind === 'column') continue;
      const memberMass = element.member.mass;
      addedMass += memberMass;
      momentX += memberMass * element.x;
      momentZ += memberMass * element.z;
      polarMassAboutOrigin += memberMass * (element.x ** 2 + element.z ** 2 +
        (element.member.size[0] ** 2 + element.member.size[2] ** 2) / 12);
    }
    mass[i] = baseFloorMass + addedMass;
    massCenterX[i] = momentX / mass[i];
    massCenterZ[i] = momentZ / mass[i];
    rotationalMass[i] = Math.max(1, polarMassAboutOrigin -
      mass[i] * (massCenterX[i] ** 2 + massCenterZ[i] ** 2));
  }
  const massMatrix = Array.from({ length: floors * 3 }, () => new Float64Array(floors * 3));
  for (let i = 0; i < floors; i++) {
    const index = i * 3, m = mass[i], cx = massCenterX[i], cz = massCenterZ[i];
    massMatrix[index][index] = m;
    massMatrix[index][index + 2] = massMatrix[index + 2][index] = m * cz;
    massMatrix[index + 1][index + 1] = m;
    massMatrix[index + 1][index + 2] = massMatrix[index + 2][index + 1] = -m * cx;
    massMatrix[index + 2][index + 2] = rotationalMass[i];
  }
  const dofCount = floors * 3;
  return {
    members, assemblyId: data.assemblyId, columns, beams, storyElements, dampers,
    baseIsolationFactor: members.some(member => member.frame?.role === 'isolator') ? 0.5 : 1,
    floors, storyHeight: data.storyHeight, baseKX, baseKZ,
    profile: data.profile, rebarRatio: data.rebarRatio,
    mass, massCenterX, massCenterZ, rotationalMass, massMatrix, halfPlan,
    state: { u: new Float64Array(dofCount), v: new Float64Array(dofCount), a: new Float64Array(dofCount) },
    maxDrift: 0, maxRatio: 0, maxBaseShear: 0, failedCount: 0, peakTime: 0, ariasIntensity: 0,
    maxTorsionRatio: 1, softStoryRatios, softStoryStories,
    torsionStories: [], storyPeakDrift: new Float64Array(floors), pendingFractures: [], collapseStory: null,
    releasedMembers: new Set()
  };
}

function addSpringMatrix(matrix, floor, x, z, kx, kz, floors, kxz = 0) {
  const add = (terms, stiffness) => {
    if (stiffness <= 0) return;
    for (const [row, a] of terms) for (const [column, b] of terms) {
      matrix[row][column] += stiffness * a * b;
    }
  };
  const current = floor * 3, termsX = [[current, 1], [current + 2, z]];
  const termsZ = [[current + 1, 1], [current + 2, -x]];
  if (floor > 0) {
    const below = (floor - 1) * 3;
    termsX.push([below, -1], [below + 2, -z]);
    termsZ.push([below + 1, -1], [below + 2, x]);
  }
  add(termsX, kx);
  add(termsZ, kz);
  if (kxz !== 0) for (const [row, a] of termsX) for (const [column, b] of termsZ) {
    matrix[row][column] += kxz * a * b;
    matrix[column][row] += kxz * a * b;
  }
}

function addSpringForce(vector, floor, x, z, fx, fz, floors) {
  const index = floor * 3;
  vector[index] += fx;
  vector[index + 1] += fz;
  vector[index + 2] += z * fx - x * fz;
  if (floor > 0) {
    const below = (floor - 1) * 3;
    vector[below] -= fx;
    vector[below + 1] -= fz;
    vector[below + 2] -= z * fx - x * fz;
  }
}

function frameBraceExtension(model, element, story) {
  const [p0, p1] = element.member.frame.endpoints;
  const lower = frameFloorMotion(model, story, p0[0], p0[2]);
  const upper = frameFloorMotion(model, story + 1, p1[0], p1[2]);
  const [ux, , uz] = element.direction;
  return (upper.x - lower.x) * ux + (upper.z - lower.z) * uz;
}

function bracePlasticResponse(block, element, extension, commit) {
  const elastic = element.axialK;
  const area = Math.max(block.size[0] * block.size[2], 1e-8);
  const sectionI = Math.min(block.size[0] * block.size[2] ** 3,
    block.size[2] * block.size[0] ** 3) / 12;
  const bm = MATS[block.mat];
  const buckling = Math.PI ** 2 * (block.frame.E || bm.E) *
    sectionI / Math.max(element.length ** 2, 1e-8);
  const tensionYield = bm.strength * area;
  const compressionYield = Math.min(tensionYield, buckling);
  const hardening = elastic * 0.01;
  const offset = block.plasticOffset || 0;
  const accumulated = block.plasticStrain || 0;
  const trial = elastic * (extension - offset);
  const direction = trial < 0 ? -1 : 1;
  const yieldForce = direction < 0 ? compressionYield : tensionYield;
  const excess = Math.abs(trial) - (yieldForce + hardening * accumulated * element.length);
  let force = trial, tangent = elastic, nextOffset = offset, nextAccumulated = accumulated;
  let yielded = false;
  if (excess > 0) {
    const increment = excess / (elastic + hardening);
    nextOffset += direction * increment;
    nextAccumulated += increment / Math.max(element.length, 1e-8);
    force = elastic * (extension - nextOffset);
    tangent = elastic * hardening / (elastic + hardening);
    yielded = true;
  }
  if (commit) {
    block.plasticOffset = nextOffset;
    block.plasticStrain = nextAccumulated;
    block.frameAxialForce = force;
    if (yielded) block.yielded = true;
  }
  return { force, tangent, yielded, yieldForce, tensionYield, compressionYield, buckling };
}

function frameSystemMatrices(model) {
  const size = model.state.u.length;
  const stiffness = Array.from({ length: size }, () => new Float64Array(size));
  const damping = Array.from({ length: size }, () => new Float64Array(size));
  const forceOffset = new Float64Array(size);
  for (let i = 0; i < model.floors; i++) {
    for (const element of model.storyElements[i]) {
      const member = element.member;
      const intact = !member || (!member.frameFailed && !member.frameReleased && !member.body && member.alive);
      const dampingRetention = !member || (member.alive && !member.frameFailed && !member.frameReleased && !member.body) ? 1 : 0;
      const degradation = !intact ? 0 : member?.frameDamage
        ? Math.max(0.05, 1 - 0.7 * (member.frameDamage / 3) ** 2) : 1;
      const confinementDampingRetention = member?.shearLinks
        ? Math.max(0.2, 1 - 0.25 * (member.frameDamage / 3)) : 1;
      if (element.kind === 'brace' && member && intact) {
        const extension = frameBraceExtension(model, element, i);
        const response = bracePlasticResponse(member, element, extension, true);
        const ratio = response.tangent / element.axialK;
        const offsetForce = response.force - response.tangent * extension;
        addSpringForce(forceOffset, i, element.x, element.z,
          offsetForce * element.direction[0], offsetForce * element.direction[2], model.floors);
        addSpringMatrix(stiffness, i, element.x, element.z,
          element.kx * ratio, element.kz * ratio, model.floors, (element.kxz || 0) * ratio);
        addSpringMatrix(damping, i, element.x, element.z,
          (element.cx || 0) * dampingRetention * confinementDampingRetention,
          (element.cz || 0) * dampingRetention * confinementDampingRetention,
          model.floors, (element.cxz || 0) * dampingRetention);
        continue;
      }
      addSpringMatrix(stiffness, i, element.x, element.z,
        element.kx * degradation, element.kz * degradation, model.floors, (element.kxz || 0) * degradation);
      addSpringMatrix(damping, i, element.x, element.z,
        (element.cx || 0) * dampingRetention, (element.cz || 0) * dampingRetention,
        model.floors, (element.cxz || 0) * dampingRetention);
    }
  }
  for (let i = 0; i < model.floors; i++) {
    const index = i * 3;
    damping[index][index] += 2 * 0.05 * Math.sqrt(model.mass[i] * Math.max(stiffness[index][index], 1));
    damping[index + 1][index + 1] += 2 * 0.05 * Math.sqrt(model.mass[i] * Math.max(stiffness[index + 1][index + 1], 1));
    damping[index + 2][index + 2] += 2 * 0.05 * Math.sqrt(model.rotationalMass[i] * Math.max(stiffness[index + 2][index + 2], 1));
  }
  return { stiffness, damping, forceOffset };
}

function solveDenseSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => Float64Array.from([...row, vector[i]]));
  for (let column = 0; column < n; column++) {
    let pivotRow = column;
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivotRow][column])) pivotRow = row;
    }
    if (Math.abs(a[pivotRow][column]) < 1e-12) return null;
    [a[column], a[pivotRow]] = [a[pivotRow], a[column]];
    const pivot = a[column][column];
    for (let j = column; j <= n; j++) a[column][j] /= pivot;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = a[row][column];
      for (let j = column; j <= n; j++) a[row][j] -= factor * a[column][j];
    }
  }
  return Float64Array.from(a, row => row[n]);
}

function integrateNewmarkSystem(state, mass, damping, stiffness, force, dt) {
  const n = state.u.length, beta = 0.25, gamma = 0.5;
  const a0 = 1 / (beta * dt * dt), a1 = gamma / (beta * dt);
  const a2 = 1 / (beta * dt), a3 = 1 / (2 * beta) - 1;
  const a4 = gamma / beta - 1, a5 = dt * (gamma / beta - 2) / 2;
  const effective = Array.from({ length: n }, (_, row) => Float64Array.from({ length: n }, (_, column) =>
    stiffness[row][column] + a0 * mass[row][column] + a1 * damping[row][column]));
  const rhs = new Float64Array(n);
  for (let row = 0; row < n; row++) {
    rhs[row] = force[row];
    for (let column = 0; column < n; column++) {
      rhs[row] += mass[row][column] * (a0 * state.u[column] + a2 * state.v[column] + a3 * state.a[column]) +
        damping[row][column] * (a1 * state.u[column] + a4 * state.v[column] + a5 * state.a[column]);
    }
  }
  const nextU = solveDenseSystem(effective, rhs);
  if (!nextU) return false;
  const nextA = new Float64Array(n), nextV = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    nextA[i] = a0 * (nextU[i] - state.u[i]) - a2 * state.v[i] - a3 * state.a[i];
    nextV[i] = state.v[i] + dt * ((1 - gamma) * state.a[i] + gamma * nextA[i]);
    if (![nextU[i], nextV[i], nextA[i]].every(Number.isFinite)) return false;
  }
  for (let i = 0; i < n; i++) {
    state.u[i] = nextU[i];
    state.v[i] = nextV[i];
    state.a[i] = nextA[i];
  }
  return true;
}

function advanceFrameModel(dt) {
  for (const model of simulationFrameModels) {
    if (!advanceOneFrameModel(model, dt)) return false;
  }
  return true;
}

function advanceOneFrameModel(model, dt) {
  if (S.quake === 'none') return true;
  const q = QUAKES[S.quake];
  const { stiffness, damping, forceOffset } = frameSystemMatrices(model);
  const isolationFactor = model.baseIsolationFactor ?? 1;
  const agX = groundA(S.t, q, 'x') * isolationFactor;
  const agZ = groundA(S.t, q, 'z') * isolationFactor;
  model.ariasIntensity += Math.PI / (2 * G) * (agX * agX + agZ * agZ) * dt;
  const force = new Float64Array(model.state.u.length);
  for (let row = 0; row < force.length; row++) {
    const floorIndex = Math.floor(row / 3) * 3;
    force[row] = -(model.massMatrix[row][floorIndex] * agX +
      model.massMatrix[row][floorIndex + 1] * agZ + forceOffset[row]);
  }
  if (!integrateNewmarkSystem(model.state, model.massMatrix, damping, stiffness, force, dt)) return false;
  for (let i = 0; i < model.floors; i++) for (const element of model.storyElements[i]) {
    if (element.kind !== 'brace' || !element.member?.alive || element.member.frameFailed) continue;
    bracePlasticResponse(element.member, element,
      frameBraceExtension(model, element, i), true);
  }

  for (let i = 0; i < model.floors; i++) {
    const index = i * 3, below = (i - 1) * 3;
    const dx = model.state.u[index] - (i ? model.state.u[below] : 0);
    const dz = model.state.u[index + 1] - (i ? model.state.u[below + 1] : 0);
    const dTheta = model.state.u[index + 2] - (i ? model.state.u[below + 2] : 0);
    const edgeDrifts = [-1, 1].flatMap(xSign => [-1, 1].map(zSign =>
      Math.hypot(dx + dTheta * zSign * model.halfPlan, dz - dTheta * xSign * model.halfPlan)));
    const edgeDrift = Math.max(...edgeDrifts);
    const edgeDriftX = [Math.abs(dx - dTheta * model.halfPlan), Math.abs(dx + dTheta * model.halfPlan)];
    const edgeDriftZ = [Math.abs(dz - dTheta * model.halfPlan), Math.abs(dz + dTheta * model.halfPlan)];
    const ratioX = Math.max(...edgeDriftX) / Math.max(1e-8, (edgeDriftX[0] + edgeDriftX[1]) / 2);
    const ratioZ = Math.max(...edgeDriftZ) / Math.max(1e-8, (edgeDriftZ[0] + edgeDriftZ[1]) / 2);
    const torsionRatio = Math.max(ratioX, ratioZ);
    if (torsionRatio > 1.2 && !model.torsionStories.includes(i + 1)) model.torsionStories.push(i + 1);
    const drift = edgeDrift / model.storyHeight;
    const previousPeakDrift = model.maxDrift;
    model.storyPeakDrift[i] = Math.max(model.storyPeakDrift[i], drift);
    model.maxDrift = Math.max(model.maxDrift, drift);
    model.maxTorsionRatio = Math.max(model.maxTorsionRatio, torsionRatio);
    const storyForces = model.storyElements[i].reduce((sum, element) => {
      if (element.kind === 'brace' && element.member) {
        return [
          sum[0] + element.member.frameAxialForce * element.direction[0],
          sum[1] + element.member.frameAxialForce * element.direction[2]
        ];
      }
      const localX = dx + dTheta * element.z, localZ = dz - dTheta * element.x;
      return [sum[0] + element.kx * localX, sum[1] + element.kz * localZ];
    }, [0, 0]);
    const storyShear = Math.hypot(storyForces[0], storyForces[1]);
    model.maxBaseShear = Math.max(model.maxBaseShear, storyShear);
    // Distribute story shear to the lateral system so columns are not charged for
    // forces already carried by braces, structural walls, or infill.
    let braceShearX = 0, braceShearZ = 0, wallShearX = 0, wallShearZ = 0;
    for (const element of model.storyElements[i]) {
      if (!element.member?.alive || element.member.frameFailed) continue;
      if (element.kind === 'brace') {
        const axialForce = element.member.frameAxialForce || 0;
        braceShearX += axialForce * element.direction[0];
        braceShearZ += axialForce * element.direction[2];
      } else if (element.kind === 'shear-wall') {
        wallShearX += element.kx * (dx + dTheta * element.z);
        wallShearZ += element.kz * (dz - dTheta * element.x);
      }
    }
    // Infill walls also carry story shear through their lateral stiffness.
    let infillShearX = 0, infillShearZ = 0;
    for (const element of model.storyElements[i]) {
      if (element.kind !== 'infill' || !element.member?.alive || element.member.frameFailed) continue;
      infillShearX += element.kx * (dx + dTheta * element.z);
      infillShearZ += element.kz * (dz - dTheta * element.x);
    }
    // Total story shear demand (inertial force at this and above floors)
    const storyInertialX = -model.mass[i] * (groundA(S.t, QUAKES[S.quake], 'x') + model.state.a[index]);
    const storyInertialZ = -model.mass[i] * (groundA(S.t, QUAKES[S.quake], 'z') + model.state.a[index + 1]);
    const totalStoryShear = Math.hypot(storyInertialX, storyInertialZ);
    const totalBraceShear = Math.hypot(braceShearX, braceShearZ);
    const totalWallShear = Math.hypot(wallShearX, wallShearZ);
    const totalInfillShear = Math.hypot(infillShearX, infillShearZ);
    // Fraction of story shear carried by columns (1.0 when no braces/infill, less when they help)
    const columnShearFraction = totalStoryShear > 0
      ? Math.max(0.15, 1 - (totalBraceShear + totalWallShear + totalInfillShear) / totalStoryShear)
      : 1.0;
    const axialLoad = model.mass.slice(i).reduce((sum, value) => sum + value, 0) * G /
      Math.max(model.columns[i].length, 1);
    let storyFailed = 0;
    for (const b of model.columns[i]) {
      const memberDx = dx + dTheta * b.pos[2], memberDz = dz - dTheta * b.pos[0];
      const lateralShear = Math.hypot(b.frameKX * memberDx, b.frameKZ * memberDz) * columnShearFraction;
      const momentDemand = lateralShear * b.size[1] / 2;
      const area = b.size[0] * b.size[2];
      const sectionDepth = Math.min(b.size[0], b.size[2]);
      const steelAreaTension = 0.5 * (b.frame?.rebarRatio || 0.012) * area;
      const linkEffects = shearLinkEffects(b);
      const linkFactor = linkEffects.confinedStrengthFactor;
      const momentCapacity = Math.max(steelAreaTension * (b.frame?.rebarYield || 420e6) *
        0.8 * sectionDepth, 1);
      const axialCapacity = Math.max(0.85 * (b.frame?.fck || MATS[b.mat].strength) *
        area * linkFactor, 1);
      const interaction = momentDemand / momentCapacity + axialLoad / axialCapacity;
      const shearCapacity = linkEffects.shearCapacity;
      const shearRatio = demandCapacityRatio(lateralShear, shearCapacity);
      b.shearRatio = shearRatio;
      b.shearStress = stressFromLoad(lateralShear,
        Math.max(Math.min(b.size[0], b.size[2]) * Math.max(b.size[0], b.size[2]) * 0.8, MIN_SECTION_AREA));
      const driftRatio = Math.hypot(memberDx, memberDz) / model.storyHeight / 0.02;
      const ratio = Math.min(MAX_SCREEN_RATIO, Math.max(interaction, driftRatio, shearRatio));
      model.maxRatio = Math.max(model.maxRatio, ratio);
      b.stress = stressFromLoad(ratio * MATS[b.mat].strength * linkFactor, 1);
      b.fos = factorOfSafety(1, Math.max(interaction, driftRatio, shearRatio));
      b.breakRatio = ratio;
      const damageResistance = b.shearLinks ? Math.max(1, linkEffects.ductilityFactor) : 1;
      if (ratio > 1) b.frameDamage = Math.min(3,
        b.frameDamage + (ratio - 1) * dt * 0.18 / damageResistance);
      if (b.shearLinks && ratio > 1) {
        b.yielded = true;
        b.plasticStrain += (ratio - 1) * dt * 0.001 / damageResistance;
      }
      if (!b.frameFailed && b.frameDamage >= 3) {
        b.frameFailed = true;
        b.frameFailureRatio = ratio;
        b.failureMode = shearRatio >= Math.max(interaction, driftRatio) ? 'column shear'
          : interaction >= driftRatio ? 'frame member interaction' : 'story drift limit';
        model.pendingFractures.push(b);
        storyFailed++;
      }
    }
    for (const element of model.storyElements[i]) {
      const b = element.member;
      if (!b || b.frameFailed || (element.kind !== 'brace' && element.kind !== 'shear-wall' && element.kind !== 'infill')) continue;
      let ratio = 0, mode = '';
      if (element.kind === 'brace') {
        const axialForce = b.frameAxialForce;
        const axialDemand = Math.abs(axialForce);
        const area = b.size[0] * b.size[2];
        const inCompression = axialForce < 0;
        const inertia = Math.min(b.size[0] * b.size[2] ** 3,
          b.size[2] * b.size[0] ** 3) / 12;
        const bm = MATS[b.mat];
        const buckling = Math.PI ** 2 * (b.frame.E || bm.E) *
          inertia / Math.max(element.length ** 2, 1e-8);
        const capacity = inCompression ? buckling
          : bm.ultimate * area;
        ratio = demandCapacityRatio(axialDemand, capacity);
        mode = inCompression ? 'brace buckling' : 'brace tensile rupture';
        b.stress = stressFromLoad(axialDemand, area);
        b.fos = factorOfSafety(bm.strength, b.stress);
        b.failureDemand = axialDemand;
        b.failureCapacity = capacity;
        b.failureUnit = 'N';
        b.failureMode = b.yielded ? 'brace post-yield response' : mode;
        b.breakRatio = ratio;
      } else if (element.kind === 'shear-wall') {
        const localX = dx + dTheta * element.z, localZ = dz - dTheta * element.x;
        const shearDemand = Math.hypot(element.kx * localX, element.kz * localZ);
        const orientation = b.frame.orientation;
        const wallLength = orientation === 'x' ? b.size[0] : b.size[2];
        const wallThickness = orientation === 'x' ? b.size[2] : b.size[0];
        const shearCapacity = 0.17 * Math.sqrt((b.frame.fck || MATS.concrete.strength) / 1e6) *
          1e6 * wallLength * wallThickness;
        ratio = demandCapacityRatio(shearDemand, shearCapacity);
        mode = 'wall shear screen';
      } else if (element.kind === 'infill') {
        // Infill walls fail in shear when story drift exceeds their capacity.
        const localX = dx + dTheta * element.z, localZ = dz - dTheta * element.x;
        const shearDemand = Math.hypot(element.kx * localX, element.kz * localZ);
        const orientation = b.frame.orientation;
        const wallLength = orientation === 'x' ? b.size[0] : b.size[2];
        const wallThickness = orientation === 'x' ? b.size[2] : b.size[0];
        // Infill (brick/glass) has lower shear capacity than structural shear walls.
        const matStrength = MATS[b.mat].strength;
        const shearCapacity = 0.08 * Math.sqrt(matStrength) * 1e3 * wallLength * wallThickness;
        ratio = demandCapacityRatio(shearDemand, shearCapacity);
        mode = 'infill shear screen';
      }
      model.maxRatio = Math.max(model.maxRatio, ratio);
      if (element.kind !== 'brace') {
        b.stress = stressFromLoad(ratio * MATS[b.mat].strength, 1);
        b.fos = factorOfSafety(1, ratio);
      }
      b.breakRatio = ratio;
      if (ratio > 1) b.frameDamage = Math.min(3, b.frameDamage + (ratio - 1) * dt * 0.18);
      if (!b.frameFailed && b.frameDamage >= 3) {
        b.frameFailed = true;
        b.frameFailureRatio = ratio;
        b.failureMode = mode;
        model.pendingFractures.push(b);
        model.failedCount++;
      }
    }
    if (storyFailed) model.failedCount += storyFailed;
    if (model.maxDrift > previousPeakDrift) model.peakTime = S.t;
  }

  if (model.collapseStory === null) {
    const failedStory = model.columns.findIndex(columns => columns.filter(b => b.frameFailed).length >= Math.max(1, Math.ceil(columns.length / 3)));
    if (failedStory >= 0) {
      model.collapseStory = failedStory + 1;
      flash(`Progressive collapse triggered at story ${model.collapseStory}: multiple columns exceeded the damage screen. Upper frame members are being released to rigid-body physics.`);
    }
  }
  if (model.collapseStory !== null) {
    for (const b of model.members) {
      if (b.frame.role !== 'footing' && b.frame.story >= model.collapseStory && !b.body && b.alive) {
        releaseFrameMember(b, model);
      }
    }
    return true;
  } else {
    for (const b of model.pendingFractures) {
      if (!b.body && b.alive) releaseFrameMember(b, model);
    }
    return true;
  }
}

function releaseFrameMember(b, model) {
  const story = Math.max(1, b.frame.story);
  const index = (story - 1) * 3;
  const lowerIndex = (story - 2) * 3;
  const lowerVx = story > 1 ? model.state.v[lowerIndex] : 0;
  const lowerVz = story > 1 ? model.state.v[lowerIndex + 1] : 0;
  const upperVx = model.state.v[index], upperVz = model.state.v[index + 1];
  const savedPos = [...b.pos], savedRot = [...b.rot];
  b.pos = b.mesh.position.toArray();
  const euler = new THREE.Euler().setFromQuaternion(b.mesh.quaternion, 'XYZ');
  b.rot = [euler.x / DEG, euler.y / DEG, euler.z / DEG];
  if (b.frameBody && world.bodies.includes(b.frameBody)) world.removeBody(b.frameBody);
  b.frameBody = null;
  const body = buildGroupBody([b]);
  b.pos = savedPos;
  b.rot = savedRot;
  const thetaVelocity = model.state.v[index + 2];
  const velocityX = upperVx + thetaVelocity * b.pos[2];
  const velocityZ = upperVz - thetaVelocity * b.pos[0];
  // Dampen horizontal velocity so released members don't glide across the ground.
  const hDamp = 0.1;
  body.velocity.set(
    (plateBody.velocity.x + velocityX) * hDamp,
    plateBody.velocity.y,
    (plateBody.velocity.z + velocityZ) * hDamp
  );
  // Dampen angular velocity too — released members should fall, not spin wildly.
  body.angularVelocity.set(
    (-(upperVz - lowerVz) / model.storyHeight) * hDamp,
    thetaVelocity * hDamp,
    (-(upperVx - lowerVx) / model.storyHeight) * hDamp
  );
  b.frameReleased = true;
  model.releasedMembers.add(b);
  attachReleasedFrameBraces(model, b);
}

function frameFloorMotion(model, level, x, z, values = model.state.u) {
  if (level <= 0) return { x: 0, z: 0, theta: 0 };
  const index = (Math.min(level, model.floors) - 1) * 3;
  const ux = values[index], uz = values[index + 1], theta = values[index + 2];
  return { x: ux + theta * z, z: uz - theta * x, theta };
}

// Kinematic collision bodies for RC frame members. The Newmark model drives the
// members visually; these bodies let ordinary blocks (and released debris) rest
// on and collide with the building while it sways.
function createFrameCollisionBodies(model) {
  for (const b of model.members) {
    if (!b.alive || b.body || b.frameBody) continue;
    const role = b.frame.role;
    if (role === 'brace' || role === 'damper') continue;
    const body = new RapierBody({ type: bodyType.KINEMATIC, material: CM[b.mat] });
    body.addShape(makeBoxShape({ x: b.size[0] / 2, y: b.size[1] / 2, z: b.size[2] / 2 },
      MATS[b.mat].rho), undefined, undefined, b.mat);
    body.position.set(b.pos[0], b.pos[1], b.pos[2]);
    const q = quatOf(b.rot);
    body.quaternion.set(q.x, q.y, q.z, q.w);
    world.addBody(body);
    b.frameBody = body;
  }
}
function syncFrameCollisionBody(b) {
  const body = b.frameBody;
  if (!body) return;
  body.setNextKinematicTranslation({ x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z });
  body.setNextKinematicRotation({ x: b.mesh.quaternion.x, y: b.mesh.quaternion.y,
    z: b.mesh.quaternion.z, w: b.mesh.quaternion.w });
}
function updateFrameModelVisuals() {
  for (const model of simulationFrameModels) updateOneFrameModelVisuals(model);
}

function updateOneFrameModelVisuals(model) {
  const up = new THREE.Vector3(0, 1, 0);
  for (const b of model.members) {
    if (!b.alive || b.body) continue;
    const role = b.frame.role, story = b.frame.story;
    if (role === 'footing') {
      b.mesh.position.set(b.pos[0] + plateBody.position.x, b.pos[1], b.pos[2] + plateBody.position.z);
      b.mesh.quaternion.copy(quatOf(b.rot));
      syncFrameCollisionBody(b);
      continue;
    }
    if (role === 'brace' || role === 'damper') {
      const [p0, p1] = b.frame.endpoints;
      const lower = frameFloorMotion(model, b.frame.endpointLevels[0], p0[0], p0[2]);
      const upper = frameFloorMotion(model, b.frame.endpointLevels[1], p1[0], p1[2]);
      const start = new THREE.Vector3(p0[0] + lower.x, p0[1], p0[2] + lower.z);
      const end = new THREE.Vector3(p1[0] + upper.x, p1[1], p1[2] + upper.z);
      const direction = end.sub(start);
      b.mesh.position.copy(start.addScaledVector(direction, 0.5));
      b.mesh.position.x += plateBody.position.x;
      b.mesh.position.z += plateBody.position.z;
      b.mesh.quaternion.setFromUnitVectors(up, direction.normalize());
      continue;
    }

    const lower = frameFloorMotion(model, story - 1, b.pos[0], b.pos[2]);
    const upper = frameFloorMotion(model, story, b.pos[0], b.pos[2]);
    b.mesh.position.set(
      b.pos[0] + plateBody.position.x + (lower.x + upper.x) / 2,
      b.pos[1],
      b.pos[2] + plateBody.position.z + (lower.z + upper.z) / 2
    );
    if (role === 'column' || role === 'shear-wall') {
      const direction = new THREE.Vector3(upper.x - lower.x, b.size[1], upper.z - lower.z).normalize();
      b.mesh.quaternion.setFromUnitVectors(up, direction);
    } else {
      const yaw = new THREE.Quaternion().setFromAxisAngle(up, upper.theta);
      b.mesh.quaternion.copy(yaw.multiply(quatOf(b.rot)));
    }
    syncFrameCollisionBody(b);
  }
}

function frameReportHtml(model, historical = false) {
  if (!model) return '';
  const peakStory = model.storyPeakDrift.reduce((best, value, i, all) => value > all[best] ? i : best, 0) + 1;
  const title = historical ? 'Last building-model run' : 'Newmark story-response screen';
  const weakStoryText = model.softStoryStories?.length
    ? `Potential stiffness irregularity at stories ${model.softStoryStories.join(', ')} (minimum adjacent-story ratio ${(Math.min(...model.softStoryStories.map(story => model.softStoryRatios[story - 1])) * 100).toFixed(0)}%).`
    : 'No adjacent-story stiffness ratio below the 0.70 screening trigger.';
  const torsionText = model.torsionStories?.length
    ? `Potential torsional irregularity at stories ${model.torsionStories.join(', ')} (edge-drift ratio > 1.20).`
    : 'No edge-drift ratio above the 1.20 screening trigger.';
  return `<div class="sug ${model.maxDrift >= 0.02 || model.maxRatio >= 1 ? 'warn' : ''}"> 
    <b>${title}</b> 
    <div class="stat"><span>Peak interstory drift</span><b>${(model.maxDrift * 100).toFixed(2)}% | story ${peakStory}</b></div> 
    <div class="stat"><span>Peak member interaction</span><b>${model.maxRatio.toFixed(2)}x</b></div> 
    <div class="stat"><span>Peak torsional edge-drift ratio</span><b>${model.maxTorsionRatio.toFixed(2)}</b></div> 
    <div class="stat"><span>Potential soft-story screen</span><b>${weakStoryText}</b></div> 
    <div class="stat"><span>Torsional screen</span><b>${torsionText}</b></div> 
    <div class="stat"><span>Peak story shear</span><b>${(model.maxBaseShear / 1000).toFixed(0)} kN</b></div> 
    <div class="stat"><span>Arias intensity</span><b>${model.ariasIntensity.toFixed(2)} m/s</b></div> 
    <div class="muted">${model.failedCount} modeled member${model.failedCount === 1 ? '' : 's'} exceeded the accumulated damage screen${model.peakTime ? ` near ${model.peakTime.toFixed(2)} s` : ''}${model.collapseStory ? `; progressive-collapse release began at story ${model.collapseStory}` : ''}. Newmark-beta story model with heuristic stiffness degradation, assumed 5% damping and ${(model.rebarRatio * 100).toFixed(1)}% longitudinal reinforcement; infill and connection behavior are not modeled, and collapse is a simplified screening estimate rather than a code-compliant building or site-response analysis.</div> 
  </div>`;
}

function renderFrameResponse() {
  const el = byId('quakeResponse');
  if (!el) return;
  const models = S.sim ? simulationFrameModels :
    (blocks.some(b => b.alive && b.frame) ? lastFrameReports : []);
  el.innerHTML = models.map((model, index) => {
    const report = frameReportHtml(model, !S.sim);
    return models.length > 1 ? report.replace('<b>', `<b>RC frame ${index + 1}: `) : report;
  }).join('');
}
function applyBuriedSoilResistance() {
  if (S.quake === 'none') return;
  const soilUnitWeight = 18e3, soilFrictionAngle = 30 * DEG;
  const kp = (1 + Math.sin(soilFrictionAngle)) / (1 - Math.sin(soilFrictionAngle));
  const mobilizedFraction = 0.5;
  const tmpOffset = mutableVector(), rotational = mutableVector();
  for (const b of blocks) {
    if (!b.alive || !b.shearKey || !b.body || !b.rel) continue;
    const body = b.body, local = b.rel.pos;
    body.quaternion.vmult(local, tmpOffset);
    const displacementX = body.position.x + tmpOffset.x - b.pos[0] - plateBody.position.x;
    const displacementZ = body.position.z + tmpOffset.z - b.pos[2] - plateBody.position.z;
    vectorCross(rotational, body.angularVelocity, tmpOffset);
    const velocityX = body.velocity.x + rotational.x - plateBody.velocity.x;
    const velocityZ = body.velocity.z + rotational.z - plateBody.velocity.z;
    const embedment = b.size[1];
    for (const axis of ['x', 'z']) {
      const width = axis === 'x' ? b.size[2] : b.size[0];
      const capacity = 0.5 * mobilizedFraction * soilUnitWeight * kp * width * embedment ** 2;
      const stiffness = capacity / 0.05;
      const damping = 0.7 * 2 * Math.sqrt(stiffness * body.mass);
      const displacement = axis === 'x' ? displacementX : displacementZ;
      const velocity = axis === 'x' ? velocityX : velocityZ;
      const reaction = Math.max(-capacity, Math.min(capacity, -stiffness * displacement - damping * velocity));
      if (reaction !== 0) body.wakeUp();
      if (axis === 'x') {
        body.force.x += reaction;
        body.torque.y += tmpOffset.z * reaction;
        body.torque.z -= tmpOffset.y * reaction;
      } else {
        body.force.z += reaction;
        body.torque.x += tmpOffset.y * reaction;
        body.torque.y -= tmpOffset.x * reaction;
      }
    }
  }
}
const FIX = 1 / 120;
const SOLVER_SUBSTEPS = 2;
const SOLVER_DT = FIX / SOLVER_SUBSTEPS;
let acc = 0;
let physicsStage = 'idle';
function physics(dt) {
  const maxStepsPerFrame = 8;
  acc = Math.min(acc + Math.min(dt, 0.05), FIX * maxStepsPerFrame);
  let fracture = null;
  while (acc >= FIX && S.sim) {
    // Check earthquake duration
    if (S.quake !== 'none' && S.t >= QUAKES[S.quake].dur) {
      if (simulationBakeState) { acc = 0; break; }
      stopSim();
      break;
    }
    let completed = true;
    for (let substep = 0; substep < SOLVER_SUBSTEPS && S.sim; substep++) {
      if (S.quake !== 'none' && S.t >= QUAKES[S.quake].dur) {
        if (simulationBakeState) { acc = 0; completed = false; break; }
        stopSim();
        completed = false;
        break;
      }
      if (S.quake !== 'none') {
        physicsStage = 'earthquake input';
        applyEarthquake();
        physicsStage = 'buried soil resistance';
        applyBuriedSoilResistance();
      }
      physicsStage = 'air drag';
      applyAirDrag();
      try {
        physicsStage = 'building response';
        if (!advanceFrameModel(SOLVER_DT)) {
          flash('The building-response solver became unstable or singular; simulation stopped without a valid frame result.');
          stopSim();
          completed = false;
          break;
        }
        for (const model of simulationFrameModels) {
          updateFrameBraceAnchors(model, SOLVER_DT);
          if (model.pendingFractures.length) {
            const failedMembers = [...new Set(model.pendingFractures)];
            model.pendingFractures.length = 0;
            for (const member of failedMembers) {
              if (member.alive && !member.body) releaseFrameMember(member, model);
              if (member.alive && member.body) breakBlock(member);
            }
          }
        }
      } catch (error) {
        flash(`Physics/fracture update stopped: ${error.message}`);
        stopSim();
        completed = false;
        break;
      }
      physicsStage = 'impact velocity capture';
      const preStepVelocities = captureImpactVelocities();
      physicsStage = 'physics world step';
      world.step(SOLVER_DT);
      physicsStage = 'failure checks';
      if (!fracture) fracture = updateBraceConstraintFailure();
      if (!fracture) fracture = updateImpactFailure(preStepVelocities);
      if (!fracture) fracture = updateMaterialFailure();
      recordSimulationPeaks();
      S.t += SOLVER_DT;
    }
    if (!completed) break;
    acc -= FIX;
  }
  syncDebris();
  if (fracture && fracture.alive) breakBlock(fracture);
}
// Move each block's mesh with its body: world = body.position + body.quaternion * relative offset.
function syncFromBodies() {
  const bodyPosition = new THREE.Vector3();
  const memberOffset = new THREE.Vector3();
  const bodyQuaternion = new THREE.Quaternion();
  for (const b of blocks) {
    if (!b.alive || !b.body) continue;
    const bd = b.body;
    bodyQuaternion.set(bd.quaternion.x, bd.quaternion.y, bd.quaternion.z, bd.quaternion.w);
    bodyPosition.set(bd.position.x, bd.position.y, bd.position.z);
    memberOffset.copy(b.rel.pos).applyQuaternion(bodyQuaternion);
    bodyPosition.add(memberOffset);
    b.mesh.position.copy(bodyPosition);
    b.mesh.quaternion.copy(bodyQuaternion.multiply(b.rel.quat));
    updateFoundationStyle(b);
  }
}

/* ================= gizmos (outside the block) ================= */
//  arrows startMove just outside each face. Scale cubes sit at the same face points. Rotation rings
// enclose the block, with a radius larger than its half-diagonal, so they never pass through it.
const gizmoRoot = new THREE.Group();
scene.add(gizmoRoot);
const GZ = { move: new THREE.Group(), rotate: new THREE.Group(), scale: new THREE.Group() };
const handles = [];
const lastCenter = new THREE.Vector3();
const gizmoCenter = new THREE.Vector3();
let gizmoScale = 1;
function addHandle(kind, axis, sign, obj, meshes) {
  const hid = handles.length;
  meshes.forEach(m => { m.userData = { kind, axis, sign, hid }; });
  handles.push({ kind, axis, sign, obj, mats: meshes.map(m => m.material) });
}
function paintGizmoHandles() {
  for (const h of handles) for (const mat of h.mats) {
    mat.color.setHex(h.hover ? 0xffffff : AXCOL[h.axis]);
    mat.emissive.setHex(h.hover ? AXCOL[h.axis] : 0x000000);
    mat.opacity = h.hover ? 1 : 0.95;
  }
}
(function buildGizmo() {
  for (let i = 0; i < 3; i++) for (const s of [1, -1]) {
    const mk = () => new THREE.MeshStandardMaterial({ color: AXCOL[i], roughness: 0.4, depthTest: false, transparent: true, opacity: 0.95 });
    const ar = new THREE.Group();
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.85, 10), mk()); sh.position.y = 0.425;
    const hd = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.18, 14), mk()); hd.position.y = 0.94;
    ar.add(sh, hd);
    GZ.move.add(ar);
    addHandle('move', i, s, ar, [sh, hd]);
    const cb = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mk());
    GZ.scale.add(cb);
    addHandle('scale', i, s, cb, [cb]);
  }
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 96),
      new THREE.MeshStandardMaterial({ color: AXCOL[i], depthTest: false, transparent: true, opacity: 0.9 }));
    GZ.rotate.add(r);
    addHandle('rotate', i, 0, r, [r]);
  }
})();

function updateGizmo() {
  if (blockPlacement) {
    gizmoRoot.visible = false;
    return;
  }
  let c = null, hw = [0, 0, 0], offOn = true;
  const ghostGizmo = !!(framePlacement && framePlacement.gizmoMode);
  if (ghostGizmo) {
    const fp = framePlacement.frameData.footprint / 2;
    const h = framePlacement.floors * framePlacement.frameData.storyHeight / 2;
    c = new THREE.Vector3(0, h, 0).applyQuaternion(framePlacement.rot)
      .add(new THREE.Vector3(framePlacement.pos.x, framePlacement.pos.y, framePlacement.pos.z));
    hw = [fp, h, fp];
  } else if (S.edit) {
    if (S.vsel.size) {
      c = new THREE.Vector3();
      const R = quatOf(S.edit.rot), P = v3(S.edit.pos);
      for (const i of S.vsel) c.add(v3(S.edit.verts[i]).applyQuaternion(R).add(P));
      c.multiplyScalar(1 / S.vsel.size);
      offOn = false;
    }
  } else if (S.sel && S.sel.alive && !S.sim) {
    const selected = [...S.selected].filter(block => block.alive);
    const bb = new THREE.Box3();
    for (const block of selected.length ? selected : [S.sel]) {
      bb.expandByObject(block.mesh);
    }
    c = bb.getCenter(new THREE.Vector3());
    const sz = bb.getSize(new THREE.Vector3());
    hw = [sz.x / 2, sz.y / 2, sz.z / 2];
  }
  gizmoRoot.visible = !!c;
  if (!c) { gizmoCenter.set(0, 0, 0); gizmoScale = 1; return; }
  lastCenter.copy(c);
  if (ghostGizmo) {
    const tool = framePlacement.gizmoTool === 'rotate' ? 'rotate' : 'move';
    if (gizmoRoot.children[0] !== GZ[tool]) { gizmoRoot.clear(); gizmoRoot.add(GZ[tool]); }
  } else {
    const mode = S.edit ? 'move' : S.gizmoMode;
    if (gizmoRoot.children[0] !== GZ[mode]) { gizmoRoot.clear(); gizmoRoot.add(GZ[mode]); }
  }
  const distance = camera.position.distanceTo(c);
  const farBoost = 1 + 0.2 * Math.max(0, Math.min(1, (distance - 20) / 80));
  const targetL = Math.max(0.5, Math.min(9, distance * 0.06 * farBoost));
  // Lerp only the gizmo size so it eases in/out smoothly while staying glued to the object.
  gizmoScale += (targetL - gizmoScale) * 0.2;
  const L = gizmoScale;
  const gap = offOn ? 0.12 + 0.25 * L : 0;
  const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const R = Math.hypot(...hw) + gap + 0.3 * L;
  for (const h of handles) {
    const e = AXV[h.axis];
    if (h.kind === 'move') {
      const face = c.clone().addScaledVector(e, h.sign * (hw[h.axis] + gap));
      h.obj.position.copy(face);
      h.obj.quaternion.setFromUnitVectors(Y, e.clone().multiplyScalar(h.sign));
      h.obj.scale.setScalar(L);
    } else if (h.kind === 'scale') {
      h.obj.position.copy(c.clone().addScaledVector(e, h.sign * (hw[h.axis] + gap)));
      h.obj.scale.setScalar(0.22 * L);
    } else {
      h.obj.position.copy(c);
      h.obj.quaternion.setFromUnitVectors(Z, e);
      h.obj.scale.setScalar(R);
    }
  }
}
function toPx(v) {
  const p = v.clone().project(camera);
  const r = dom.getBoundingClientRect();
  return [r.left + (p.x + 1) / 2 * r.width, r.top + (1 - p.y) / 2 * r.height];
}

/* ================= picking ================= */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function rayFrom(e) {
  const r = dom.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray;
}
function pickBlock(e) {
  const targets = blocks.filter(b => b.alive).map(b => b.mesh);
  const hit = rayFrom(e).intersectObjects(targets, false)[0];
  const block = hit?.object.userData.block;
  return block?.alive ? block : null;
}
function pickGizmo(e) {
  if (!gizmoRoot.visible) return null;
  const hit = rayFrom(e).intersectObjects(gizmoRoot.children, true)[0];
  return hit ? hit.object : null;
}

function frameGridForBraceTool() {
  const cluster = (values, tolerance = 0.08) => {
    const groups = [];
    for (const value of [...values].sort((a, b) => a - b)) {
      const group = groups[groups.length - 1];
      if (group && Math.abs(value - group.sum / group.count) <= tolerance) {
        group.sum += value;
        group.count++;
      } else groups.push({ sum: value, count: 1 });
    }
    return groups.map(group => group.sum / group.count);
  };
  const columns = blocks.filter(block => block.alive &&
    block.frame?.model === 'rc-frame' && block.frame.role === 'column');
  if (columns.length) {
    const selected = [...S.selected, S.sel].find(block =>
      block?.alive && block.frame?.model === 'rc-frame');
    const assemblyId = selected?.frame.assemblyId ?? columns[0].frame.assemblyId;
    const frameColumns = columns.filter(block => (block.frame.assemblyId || 'legacy-frame') ===
      (assemblyId || 'legacy-frame'));
    const data = frameColumns[0].frame;
    const xs = cluster(frameColumns.map(block => block.pos[0]));
    const zs = cluster(frameColumns.map(block => block.pos[2]));
    if (xs.length >= 2 && zs.length >= 2 && xs.length <= 8 && zs.length <= 8 && data.storyHeight) {
      const frameMembers = blocks.filter(block => block.alive &&
        block.frame?.model === 'rc-frame' &&
        (block.frame.assemblyId || 'legacy-frame') === (assemblyId || 'legacy-frame'));
      return { ...data, model: 'rc-frame', gridX: xs, gridZ: zs, columns: frameColumns,
        frameMembers, suggestMat: dominantMaterial(frameColumns),
        frameRot: frameColumns[0].rot ? [...frameColumns[0].rot] : [0, 0, 0] };
    }
  }

  // Columns are upright blocks: at least as tall as their footprint and at least 1 m
  // tall. This accepts ordinary blocks (e.g. 2x2x2 or 1x1x2) as frame columns.
  const upright = blocks.filter(block => block.alive && !block.foundation &&
    block.frame?.role !== 'brace' && block.size[1] >= 1 &&
    block.size[1] >= Math.max(block.size[0], block.size[2]) &&
    Math.abs(block.rot[0] % 180) < 2 && Math.abs(block.rot[2] % 180) < 2);
  if (upright.length < 2) return null;
  const gridX = cluster(upright.map(block => block.pos[0]));
  const gridZ = cluster(upright.map(block => block.pos[2]));
  // A planar frame (e.g. 2 columns + 2 beams) has a single grid line in one
  // direction; that is valid as long as the other direction has at least 2 lines.
  if ((gridX.length < 2 && gridZ.length < 2) || gridX.length > 8 || gridZ.length > 8) return null;
  const spansBay = (coordinates, center, length) => coordinates.some((start, index) => {
    const end = coordinates[index + 1];
    return end !== undefined && length >= (end - start) * 0.75 &&
      Math.abs(center - (start + end) / 2) <= 0.2;
  });
  const horizontalMembers = blocks.filter(block => {
    if (!block.alive || block.foundation || block.frame?.role === 'brace') return false;
    const xSpan = block.size[0] >= 1.5 * Math.max(0.1, block.size[1], block.size[2]);
    const zSpan = block.size[2] >= 1.5 * Math.max(0.1, block.size[1], block.size[0]);
    return xSpan
      ? spansBay(gridX, block.pos[0], block.size[0]) &&
      gridZ.some(z => Math.abs(block.pos[2] - z) <= 0.2)
      : zSpan && spansBay(gridZ, block.pos[2], block.size[2]) &&
      gridX.some(x => Math.abs(block.pos[0] - x) <= 0.2);
  });
  const baseY = Math.min(...upright.map(block => block.pos[1] - block.size[1] / 2));
  const topY = Math.max(...upright.map(block => block.pos[1] + block.size[1] / 2));
  const storyLevels = cluster(horizontalMembers.map(block => block.pos[1])
    .filter(y => y > baseY + 0.75 && y < topY + 0.1), 0.2)
    .filter(y => y > baseY + 0.75 && y < topY + 0.1);
  if (storyLevels.length < 1) {
    // Fallback: infer story levels from column height when no beams are detected.
    const totalHeight = topY - baseY;
    const typicalStory = 3.0;
    const inferredFloors = Math.max(1, Math.round(totalHeight / typicalStory));
    for (let s = 1; s <= inferredFloors; s++) {
      storyLevels.push(baseY + (totalHeight * s) / inferredFloors);
    }
    if (storyLevels.length < 1) return null;
  }
  const columnSide = Math.max(0.1, Math.min(...upright.map(block =>
    Math.min(block.size[0], block.size[2]))));
  // Compute frame rotation from the first upright column
  const frameRot = upright[0].rot ? [...upright[0].rot] : [0, 0, 0];
  return {
    model: 'user-frame', assemblyId: `user-frame:${gridX.map(value => value.toFixed(2)).join(',')}:` +
      `${gridZ.map(value => value.toFixed(2)).join(',')}:${baseY.toFixed(2)}`,
    floors: storyLevels.length, gridX, gridZ,
    storyLevels: [baseY, ...storyLevels], columnSide, columns: upright,
    frameMembers: [...new Set([...upright, ...horizontalMembers])],
    suggestMat: dominantMaterial(upright),
    beamDepth: horizontalMembers.length ? Math.max(0.1, Math.min(...horizontalMembers.map(block => block.size[1]))) : 0.3,
    frameRot
  };
}

function fillFrameBays() {
  if (S.sim || S.edit) return flash('Stop the simulation and leave vertex-edit mode before filling frame bays.');
  const data = frameGridForBraceTool();
  if (!data) return flash('No regular frame grid found. Add at least two aligned rows of columns and beams.');
  const panels = [];
  const fillMaterial = data.suggestMat || S.mat;
  const thickness = S.braceThickness;
  const halfCol = data.columnSide / 2, halfThick = thickness / 2;
  for (let story = 1; story <= data.floors; story++) {
    let bottom, top;
    if (data.model === 'rc-frame') {
      bottom = story === 1 ? 0 : (story - 1) * data.storyHeight;
      top = story * data.storyHeight - data.beamDepth;
    } else {
      bottom = data.storyLevels[story - 1] + (story > 1 ? data.beamDepth / 2 : 0);
      top = data.storyLevels[story] - data.beamDepth / 2;
    }
    const height = top - bottom;
    if (height <= 0.4) continue;
    const centerY = (bottom + top) / 2;
    const frameData = { ...data };
    delete frameData.columns;
    delete frameData.frameMembers;
    delete frameData.storyLevels;
    delete frameData.gridX;
    delete frameData.gridZ;
    const frameRot = data.frameRot || [0, 0, 0];
    // Place infill panels on ALL grid lines — exterior and interior.
    // Exterior grid lines place one panel per bay wall. Interior grid lines place
    // panels on both sides, filling the adjacent bays on each side.
    for (let pi = 0; pi < data.gridZ.length; pi++) {
      const gridLine = data.gridZ[pi];
      const isExterior = data.gridZ.length > 1 && (pi === 0 || pi === data.gridZ.length - 1);
      const sides = isExterior ? [pi === 0 ? -1 : 1] : [-1, 1];
      for (const side of sides) {
        const z = gridLine + side * (halfCol + halfThick);
        for (let i = 0; i < data.gridX.length - 1; i++) {
          const x0 = data.gridX[i], x1 = data.gridX[i + 1], span = x1 - x0 - data.columnSide;
          if (span <= 0.2) continue;
          panels.push({
            mat: fillMaterial, size: [span, height, thickness],
            pos: [(x0 + x1) / 2, centerY, z], rot: frameRot,
            frame: { ...frameData, role: 'infill', story, orientation: 'x' }
          });
        }
      }
    }
    for (let pi = 0; pi < data.gridX.length; pi++) {
      const gridLine = data.gridX[pi];
      const isExterior = data.gridX.length > 1 && (pi === 0 || pi === data.gridX.length - 1);
      const sides = isExterior ? [pi === 0 ? -1 : 1] : [-1, 1];
      for (const side of sides) {
        const x = gridLine + side * (halfCol + halfThick);
        for (let i = 0; i < data.gridZ.length - 1; i++) {
          const z0 = data.gridZ[i], z1 = data.gridZ[i + 1], span = z1 - z0 - data.columnSide;
          if (span <= 0.2) continue;
          panels.push({
            mat: fillMaterial, size: [thickness, height, span],
            pos: [x, centerY, (z0 + z1) / 2], rot: frameRot,
            frame: { ...frameData, role: 'infill', story, orientation: 'z' }
          });
        }
      }
    }
  }
  if (!panels.length) return flash('No frame bays have enough clear space for infill panels.');
  const duplicate = panels.some(panel => blocks.some(block => block.alive &&
    block.frame?.role === 'infill' && block.frame.story === panel.frame.story &&
    block.frame.orientation === panel.frame.orientation &&
    Math.hypot(block.pos[0] - panel.pos[0], block.pos[2] - panel.pos[2]) < 0.1));
  if (duplicate) return flash('Some frame bays already contain generated infill; remove it before refilling.');
  // Include ALL frame members (columns, beams, slabs, footings) in the ignore set so infill can coexist with them.
  const supportMembers = new Set();
  if (data.frameMembers) {
    for (const m of data.frameMembers) supportMembers.add(m);
  }
  if (data.columns) {
    for (const m of data.columns) supportMembers.add(m);
  }
  // For RC frames, also ignore slabs and footings which are inside the bays.
  if (data.model === 'rc-frame') {
    for (const b of blocks) {
      if (b.alive && b.frame?.model === 'rc-frame' && (b.frame.role === 'slab' || b.frame.role === 'footing')) {
        supportMembers.add(b);
      }
    }
  }
  const panelShapes = panels.map(panel => ({
    verts: boxVerts(panel.size), pos: panel.pos, rot: panel.rot
  }));
  for (let i = 0; i < panelShapes.length; i++) {
    if (shapeBlocked(panelShapes[i], null, supportMembers) ||
      panelShapes.slice(0, i).some(shape => overlapShapes(panelShapes[i], shape))) {
      return flash('Infill placement would overlap an existing non-frame object or another infill panel. Clear the affected bay before filling it.');
    }
  }
  pushUndo();
  for (const panel of panels) makeBlock(panel, true);
  S.sel = null;
  S.selected.clear();
  changed();
  analyze();
  renderProps();
  flash(`Added ${panels.length} ${fillMaterial} infill panels to all frame bays. They add mass but are not modeled as a lateral-force-resisting system.`);
}

/* ================= infill bay placement mode ================= */

function infillBayKey(target) {
  return `${target.story}:${target.orientation}:${target.bayIndex}`;
}

function refreshInfillBayTargets() {
  if (!infillBayGroup) {
    infillBayGroup = new THREE.Group();
    scene.add(infillBayGroup);
  }
  for (const target of infillBayTargets) {
    target.mesh.geometry.dispose();
    target.mesh.material.dispose();
    target.edges.geometry.dispose();
    target.edges.material.dispose();
  }
  infillBayGroup.clear();
  infillBayTargets = [];
  activeInfillBay = null;
  const data = frameGridForBraceTool();
  if (!data) return false;
  const thickness = S.braceThickness;
  const halfCol = data.columnSide / 2, halfThick = thickness / 2;
  const existing = new Set(blocks.filter(block => block.alive && block.frame?.role === 'infill')
    .map(block => {
      // Find which grid line and side this infill belongs to
      const story = block.frame.story;
      const orientation = block.frame.orientation;
      if (orientation === 'x') {
        const z = block.pos[2];
        const bayIdx = findBayIndex(data.gridX, block.pos[0]);
        // Find closest gridZ line
        let closestPi = 0, closestDist = Infinity;
        for (let pi = 0; pi < data.gridZ.length; pi++) {
          const d = Math.abs(z - data.gridZ[pi]);
          if (d < closestDist) { closestDist = d; closestPi = pi; }
        }
        const side = z > data.gridZ[closestPi] ? 1 : -1;
        return `${story}:x:${bayIdx}:${closestPi}:${side}`;
      } else {
        const x = block.pos[0];
        const bayIdx = findBayIndex(data.gridZ, block.pos[2]);
        let closestPi = 0, closestDist = Infinity;
        for (let pi = 0; pi < data.gridX.length; pi++) {
          const d = Math.abs(x - data.gridX[pi]);
          if (d < closestDist) { closestDist = d; closestPi = pi; }
        }
        const side = x > data.gridX[closestPi] ? 1 : -1;
        return `${story}:z:${bayIdx}:${closestPi}:${side}`;
      }
    }));
  for (let story = 1; story <= data.floors; story++) {
    let bottom, top;
    if (data.model === 'rc-frame') {
      bottom = story === 1 ? 0 : (story - 1) * data.storyHeight;
      top = story * data.storyHeight - data.beamDepth;
    } else {
      bottom = data.storyLevels[story - 1] + (story > 1 ? data.beamDepth / 2 : 0);
      top = data.storyLevels[story] - data.beamDepth / 2;
    }
    const height = top - bottom;
    if (height <= 0.4) continue;
    const centerY = (bottom + top) / 2;
    // X-orientation panels — iterate ALL gridZ lines; exterior gets one side, interior gets both
    for (let pi = 0; pi < data.gridZ.length; pi++) {
      const gridLine = data.gridZ[pi];
      const isExterior = data.gridZ.length > 1 && (pi === 0 || pi === data.gridZ.length - 1);
      const sides = isExterior ? [pi === 0 ? -1 : 1] : [-1, 1];
      for (const side of sides) {
        const z = gridLine + side * (halfCol + halfThick);
        for (let i = 0; i < data.gridX.length - 1; i++) {
          const x0 = data.gridX[i], x1 = data.gridX[i + 1], span = x1 - x0 - data.columnSide;
          if (span <= 0.2) continue;
          const key = `${story}:x:${i}:${pi}:${side}`;
          const target = { story, orientation: 'x', bayIndex: i, gridLineIndex: pi, side, key, data };
          const width = span;
          const geometry = new THREE.PlaneGeometry(width, height);
          const occupied = existing.has(key);
          const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            color: 0xff9d2e, side: THREE.DoubleSide, transparent: true,
            opacity: occupied ? 0.01 : 0.001, depthWrite: false
          }));
          mesh.rotation.y = 0;
          mesh.position.set((x0 + x1) / 2, centerY, z);
          mesh.userData.infillBay = target;
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: 0xff9d2e, transparent: true, opacity: 0.9 })
          );
          edges.visible = false;
          mesh.add(edges);
          infillBayGroup.add(mesh);
          target.mesh = mesh;
          target.edges = edges;
          target.occupied = occupied;
          infillBayTargets.push(target);
        }
      }
    }
    // Z-orientation panels — iterate ALL gridX lines; exterior gets one side, interior gets both
    for (let pi = 0; pi < data.gridX.length; pi++) {
      const gridLine = data.gridX[pi];
      const isExterior = data.gridX.length > 1 && (pi === 0 || pi === data.gridX.length - 1);
      const sides = isExterior ? [pi === 0 ? -1 : 1] : [-1, 1];
      for (const side of sides) {
        const x = gridLine + side * (halfCol + halfThick);
        for (let i = 0; i < data.gridZ.length - 1; i++) {
          const z0 = data.gridZ[i], z1 = data.gridZ[i + 1], span = z1 - z0 - data.columnSide;
          if (span <= 0.2) continue;
          const key = `${story}:z:${i}:${pi}:${side}`;
          const target = { story, orientation: 'z', bayIndex: i, gridLineIndex: pi, side, key, data };
          const width = span;
          const geometry = new THREE.PlaneGeometry(width, height);
          const occupied = existing.has(key);
          const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            color: 0xff9d2e, side: THREE.DoubleSide, transparent: true,
            opacity: occupied ? 0.01 : 0.001, depthWrite: false
          }));
          mesh.rotation.y = Math.PI / 2;
          mesh.position.set(x, centerY, (z0 + z1) / 2);
          mesh.userData.infillBay = target;
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: 0xff9d2e, transparent: true, opacity: 0.9 })
          );
          edges.visible = false;
          mesh.add(edges);
          infillBayGroup.add(mesh);
          target.mesh = mesh;
          target.edges = edges;
          target.occupied = occupied;
          infillBayTargets.push(target);
        }
      }
    }
  }
  return infillBayTargets.length > 0;
}

function findBayIndex(grid, pos) {
  for (let i = 0; i < grid.length - 1; i++) {
    if (pos >= grid[i] && pos < grid[i + 1]) return i;
  }
  return grid.length - 2;
}

function setInfillMode(enabled) {
  if (enabled && blockPlacement) return flash('Finish or cancel the current block placement first.');
  if (enabled && (S.sim || S.edit)) return flash('Stop the simulation and leave vertex-edit mode before placing infill.');
  if (enabled && S.braceMode) setBraceMode(false);
  if (enabled && !refreshInfillBayTargets()) return flash('Build a frame with columns and beams before using the infill placement tool.');
  S.infillMode = enabled;
  if (!enabled) {
    activeInfillBay = null;
    for (const target of infillBayTargets) {
      target.mesh.material.opacity = target.occupied ? 0.01 : 0.001;
      target.edges.visible = false;
    }
  }
  const button = byId('infillModeBtn');
  if (button) {
    button.classList.toggle('on', S.infillMode);
    button.textContent = S.infillMode ? 'Finish infill placement' : 'Place infill';
  }
  dom.style.cursor = S.infillMode ? 'crosshair' : 'default';
  flash(S.infillMode
    ? 'Hover over a frame bay and click to add an infill panel.'
    : 'Infill placement finished.');
}

function hoverInfillBay(event) {
  const hit = rayFrom(event).intersectObjects(infillBayGroup.children, false)[0];
  const target = hit?.object.userData.infillBay || null;
  if (target === activeInfillBay) return;
  activeInfillBay = target;
  for (const item of infillBayTargets) {
    const hovered = item === target;
    item.mesh.material.opacity = hovered ? 0.2 : item.occupied ? 0.01 : 0.001;
    item.edges.visible = hovered;
    item.edges.material.color.setHex(item.occupied ? 0x61d98b : 0xff9d2e);
  }
}

function placeInfillInBay(target) {
  if (!target || target.occupied) {
    if (target?.occupied) flash('That bay already has an infill panel.');
    return;
  }
  const data = target.data;
  const thickness = S.braceThickness;
  const halfCol = data.columnSide / 2, halfThick = thickness / 2;
  const frameRot = data.frameRot || [0, 0, 0];
  let panel;
  if (target.orientation === 'x') {
    const gridLine = data.gridZ[target.gridLineIndex];
    const z = gridLine + target.side * (halfCol + halfThick);
    const x0 = data.gridX[target.bayIndex], x1 = data.gridX[target.bayIndex + 1];
    const span = x1 - x0 - data.columnSide;
    let bottom, top;
    if (data.model === 'rc-frame') {
      bottom = target.story === 1 ? 0 : (target.story - 1) * data.storyHeight;
      top = target.story * data.storyHeight - data.beamDepth;
    } else {
      bottom = data.storyLevels[target.story - 1] + (target.story > 1 ? data.beamDepth / 2 : 0);
      top = data.storyLevels[target.story] - data.beamDepth / 2;
    }
    const height = top - bottom;
    const centerY = (bottom + top) / 2;
    const frameData = { ...data };
    delete frameData.columns; delete frameData.frameMembers;
    delete frameData.storyLevels; delete frameData.gridX; delete frameData.gridZ;
    panel = {
      mat: target.data?.suggestMat || S.mat, size: [span, height, thickness],
      pos: [(x0 + x1) / 2, centerY, z], rot: frameRot,
      frame: { ...frameData, role: 'infill', story: target.story, orientation: 'x' }
    };
  } else {
    const gridLine = data.gridX[target.gridLineIndex];
    const x = gridLine + target.side * (halfCol + halfThick);
    const z0 = data.gridZ[target.bayIndex], z1 = data.gridZ[target.bayIndex + 1];
    const span = z1 - z0 - data.columnSide;
    let bottom, top;
    if (data.model === 'rc-frame') {
      bottom = target.story === 1 ? 0 : (target.story - 1) * data.storyHeight;
      top = target.story * data.storyHeight - data.beamDepth;
    } else {
      bottom = data.storyLevels[target.story - 1] + (target.story > 1 ? data.beamDepth / 2 : 0);
      top = data.storyLevels[target.story] - data.beamDepth / 2;
    }
    const height = top - bottom;
    const centerY = (bottom + top) / 2;
    const frameData = { ...data };
    delete frameData.columns; delete frameData.frameMembers;
    delete frameData.storyLevels; delete frameData.gridX; delete frameData.gridZ;
    panel = {
      mat: target.data?.suggestMat || S.mat, size: [thickness, height, span],
      pos: [x, centerY, (z0 + z1) / 2], rot: frameRot,
      frame: { ...frameData, role: 'infill', story: target.story, orientation: 'z' }
    };
  }
  // Check overlap
  const shape = { verts: boxVerts(panel.size), pos: panel.pos, rot: panel.rot };
  const supportMembers = new Set();
  if (data.frameMembers) for (const m of data.frameMembers) supportMembers.add(m);
  if (data.columns) for (const m of data.columns) supportMembers.add(m);
  if (data.model === 'rc-frame') {
    for (const b of blocks) {
      if (b.alive && b.frame?.model === 'rc-frame' && (b.frame.role === 'slab' || b.frame.role === 'footing')) {
        supportMembers.add(b);
      }
    }
  }
  if (shapeBlocked(shape, null, supportMembers)) {
    return flash('Infill placement would overlap an existing object. Clear the affected bay first.');
  }
  pushUndo();
  makeBlock(panel, true);
  changed();
  analyze();
  refreshInfillBayTargets();
  renderProps();
  const face = target.orientation === 'x' ? 'front/back' : 'left/right';
  flash(`Added ${MATS[panel.mat].name} infill panel to story ${target.story}, ${face} bay ${target.bayIndex + 1}.`);
}

function refreshBraceBayTargets() {
  if (!braceBayGroup) {
    braceBayGroup = new THREE.Group();
    scene.add(braceBayGroup);
  }
  for (const target of braceBayTargets) {
    target.mesh.geometry.dispose();
    target.mesh.material.dispose();
    target.edges.geometry.dispose();
    target.edges.material.dispose();
  }
  braceBayGroup.clear();
  braceBayTargets = [];
  activeBraceBay = null;
  const data = frameGridForBraceTool();
  if (!data) return false;
  for (let story = 1; story <= data.floors; story++) {
    const levelNodes = braceBayNodes(data, { story, orientation: 'x', planeIndex: 0, bayIndex: 0 });
    const y0 = levelNodes[0][1], y1 = levelNodes[1][1];
    if (y1 <= y0) continue;
    for (const orientation of ['x', 'z']) {
      const planes = (orientation === 'x' ? data.gridZ.length : data.gridX.length) > 1 ? [0, 1] : [0];
      const bayCount = orientation === 'x' ? data.gridX.length - 1 : data.gridZ.length - 1;
      for (const planeIndex of planes) {
        for (let bayIndex = 0; bayIndex < bayCount; bayIndex++) {
          const target = { story, orientation, planeIndex, bayIndex };
          if (!braceAngleWithinPreferredRange(data, target)) continue;
          target.key = braceBayKey(target);
          target.data = data;
          const nodes = braceBayNodes(data, target);
          if (nodes.some(node => !braceAnchorColumn(data, node))) continue;
          if (Math.min(...nodes.map(node => node[1])) < -0.001 ||
            Math.max(...nodes.map(node => node[1])) <= 0.08) continue;
          const existingDiagonals = braceDiagonalsForBay(data, target);
          target.missingDiagonals = [0, 1].filter(diagonal => !existingDiagonals.has(diagonal));
          target.occupied = target.missingDiagonals.length === 0;
          const width = Math.max(0.1, Math.hypot(
            nodes[2][0] - nodes[1][0], nodes[2][2] - nodes[1][2]
          ) - data.columnSide);
          const geometry = new THREE.PlaneGeometry(width, y1 - y0);
          const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            color: 0x35d5ff, side: THREE.DoubleSide, transparent: true,
            opacity: target.occupied ? 0.01 : 0.001, depthWrite: false
          }));
          const midpointX = (nodes[0][0] + nodes[2][0]) / 2;
          const midpointZ = (nodes[0][2] + nodes[2][2]) / 2;
          const outerCoordinate = orientation === 'x'
            ? data.gridZ[planeIndex === 0 ? 0 : data.gridZ.length - 1]
            : data.gridX[planeIndex === 0 ? 0 : data.gridX.length - 1];
          const outward = (planeIndex === 0 ? -1 : 1) * (data.columnSide / 2 + 0.035);
          if (orientation === 'x') {
            mesh.position.set(midpointX, (y0 + y1) / 2, outerCoordinate + outward);
          } else {
            mesh.rotation.y = Math.PI / 2;
            mesh.position.set(outerCoordinate + outward, (y0 + y1) / 2, midpointZ);
          }
          mesh.userData.braceBay = target;
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: 0x35d5ff, transparent: true, opacity: 0.9 })
          );
          edges.visible = false;
          mesh.add(edges);
          braceBayGroup.add(mesh);
          target.mesh = mesh;
          target.edges = edges;
          braceBayTargets.push(target);
        }
      }
    }
  }
  return braceBayTargets.length > 0;
}

function braceBayKey(target) {
  const assemblyId = target.assemblyId || target.data?.assemblyId || 'legacy-frame';
  return `${assemblyId}:${target.story}:${target.orientation}:${target.planeIndex}:${target.bayIndex}`;
}

function braceAngleWithinPreferredRange(data, target) {
  const [bottomLeft, topLeft, topRight] = braceBayNodes(data, target);
  const section = target.thickness ?? S.braceThickness;
  const span = Math.hypot(topRight[0] - bottomLeft[0], topRight[2] - bottomLeft[2]) -
    (data.columnSide || 0.4) - section;
  const height = topLeft[1] - bottomLeft[1] - 2 * Math.min(0.06, section);
  if (span <= 0 || height <= 0) return false;
  const angle = Math.atan2(height, span) / DEG;
  return angle >= 30 && angle <= 60;
}

function braceDiagonalsForBay(data, target) {
  const covered = new Set();
  const nodes = braceBayNodes(data, target);
  const axis = target.orientation === 'x' ? 0 : 2;
  for (const block of blocks) {
    const brace = block.frame;
    const bay = brace?.gridBay;
    if (!block.alive || brace?.role !== 'brace' || !bay ||
      braceBayKey(bay) !== braceBayKey(target)) continue;
    let diagonal = bay.diagonal;
    if (diagonal !== 0 && diagonal !== 1 && Array.isArray(brace.endpoints) &&
      brace.endpoints.length === 2) {
      const distance = (a, b) => Math.hypot(a[axis] - b[axis], a[1] - b[1]);
      const fit = endpoints => Math.min(
        distance(brace.endpoints[0], endpoints[0]) + distance(brace.endpoints[1], endpoints[1]),
        distance(brace.endpoints[0], endpoints[1]) + distance(brace.endpoints[1], endpoints[0])
      );
      const fits = [fit(braceDiagonalEndpoints(nodes, 0)), fit(braceDiagonalEndpoints(nodes, 1))];
      if (Math.abs(fits[0] - fits[1]) > 1e-4) diagonal = fits[0] < fits[1] ? 0 : 1;
    }
    if (diagonal === 0 || diagonal === 1) covered.add(diagonal);
  }
  return covered;
}

function setBraceMode(enabled) {
  if (enabled && blockPlacement) return flash('Finish or cancel the current block placement first.');
  if (enabled && framePlacement) return flash('Finish or cancel the frame placement first.');
  if (enabled && (S.sim || S.edit)) return flash('Stop the simulation and leave vertex-edit mode before placing braces.');
  if (enabled && S.infillMode) setInfillMode(false);
  if (enabled && !refreshBraceBayTargets()) return flash('Build a frame with columns and beams before using the brace placement tool.');
  S.braceMode = enabled;
  if (!enabled) {
    activeBraceBay = null;
    for (const target of braceBayTargets) {
      target.mesh.material.opacity = target.occupied ? 0.01 : 0.001;
      target.edges.visible = false;
    }
  }
  const button = byId('braceModeBtn');
  if (button) {
    button.classList.toggle('on', S.braceMode);
    button.textContent = S.braceMode ? 'Finish brace placement' : 'Place X-bracing';
  }
  dom.style.cursor = S.braceMode ? 'crosshair' : 'default';
  flash(S.braceMode
    ? 'Choose an unobstructed exterior bay; click to add pinned steel X-bracing connected to frame columns, outside generated masonry infill.'
    : 'Brace placement finished.');
}
function hoverBraceBay(event) {
  const hit = rayFrom(event).intersectObjects(braceBayGroup.children, false)[0];
  const target = hit?.object.userData.braceBay || null;
  if (target === activeBraceBay) return;
  activeBraceBay = target;
  for (const item of braceBayTargets) {
    const hovered = item === target;
    item.mesh.material.opacity = hovered ? 0.2 : item.occupied ? 0.01 : 0.001;
    item.edges.visible = hovered;
    item.edges.material.color.setHex(item.occupied ? 0x61d98b : 0x35d5ff);
  }
}

function placeBraceInBay(target) {
  if (!target || target.occupied) {
    if (target?.occupied) flash('That bay already has a cross-brace.');
    return;
  }
  const creates = braceCreatesForBay(target.data, {
    ...target, diagonals: target.missingDiagonals
  });
  if (creates.length !== target.missingDiagonals.length) {
    flash('This bay does not have distinct, supported column nodes for its remaining brace diagonals.');
    return;
  }
  const ignore = new Set(target.data.frameMembers || target.data.columns || []);
  if (!planFree({ creates, ignoreBlocks: ignore })) {
    flash('X-bracing would overlap another object or pass outside the frame bay. Move/resize the frame and try again.');
    return;
  }
  pushUndo();
  for (const create of creates) makeBlock(create, true);
  changed();
  analyze();
  refreshBraceBayTargets();
  const face = target.orientation === 'x' ? 'front/back' : 'left/right';
  flash(`Added pinned ${MATS[creates[0]?.mat || 'steel'].name} X-bracing to story ${target.story}, ${face} bay ${target.bayIndex + 1}.`);
  renderProps();
}

/* ================= edit mode (Tab) ================= */
const handleGroup = new THREE.Group();
scene.add(handleGroup);
const vHandles = [];
function buildHandles() {
  handleGroup.clear();
  vHandles.length = 0;
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
    m.renderOrder = 998;
    m.userData.vi = i;
    handleGroup.add(m);
    vHandles.push(m);
  }
  updateHandles();
}
function updateHandles() {
  if (!S.edit) return;
  const b = S.edit, R = quatOf(b.rot), P = v3(b.pos);
  vHandles.forEach((m, i) => {
    m.position.copy(v3(b.verts[i]).applyQuaternion(R).add(P));
    const base = S.vsel.has(i) ? 0xffd23f : 0xffffff;
    m.material.color.setHex(i === S.hoverV ? 0x7fd1ff : base);
  });
}
function enterEdit() {
  const b = S.sel;
  if (!b || S.sim) return flash('Select a block, then press Tab to edit its vertices.');
  if (blockPlacement) cancelBlockPlacement();
  if (b.verts.length !== 8) return flash('Vertex editing is only available for box blocks.');
  S.edit = b;
  S.vsel = new Set();
  b.mesh.material.transparent = true;
  b.mesh.material.opacity = 0.55;
  buildHandles();
  renderProps();
  flash('Edit mode: click vertices, Shift+click adds, A selects all, G moves them, Tab exits.');
}
function exitEdit() {
  const b = S.edit;
  if (!b) return;
  if (T) cancelT();
  recenter(b);
  sync(b);
  if (b.shearLinks) refreshShearLinkHardware(b);
  b.mesh.material.transparent = false;
  b.mesh.material.opacity = 1;
  handleGroup.clear();
  vHandles.length = 0;
  S.edit = null;
  S.vsel = new Set();
  changed();
  renderProps();
  flash('Left edit mode.');
}
function editClick(e) {
  const hit = rayFrom(e).intersectObjects(vHandles, false)[0];
  if (hit) {
    const vi = hit.object.userData.vi;
    if (e.shiftKey) { S.vsel.has(vi) ? S.vsel.delete(vi) : S.vsel.add(vi); }
    else S.vsel = new Set([vi]);
  } else if (!e.shiftKey) S.vsel = new Set();
  updateHandles();
  renderProps();
}

/* ================= transforms ================= */
// Keyboard: G (move) or R (rotate), then X/Y/Z to constrain, then type a number and press Enter.
// Without a number the mouse drives it. Gizmos: drag an arrow, ring, or cube. Scale is gizmo-only, so S flies backward.
// Moves snap to the grid, and rotation snaps to 15 degrees. Overlapping moves are refused.
function startT(kind, opts = {}) {
  const b = S.edit || S.sel;
  if (!b || S.sim) return flash('Select a block first (click it).');
  if (kind === 'GV' && S.vsel.size === 0) return flash('Select vertices first (click a handle, Shift+click to add).');
  const members = ['G', 'R', 'S'].includes(kind) && !S.edit && S.selected.size > 1
    ? [...S.selected].filter(member => member.alive) : [b];
  pushUndo();
  const bounds = new THREE.Box3();
  for (const member of members) bounds.expandByObject(member.mesh);
  const R = quatOf(b.rot), P = v3(b.pos);
  T = { kind, b, axis: opts.axis || null, num: '', acc: { x: 0, y: 0 }, gizmo: !!opts.gizmo, sign: opts.sign || 1,
    members,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    originals: new Map(members.map(member => [member, {
      pos: [...member.pos], rot: [...member.rot], verts: member.verts.map(p => [...p]), size: [...member.size]
    }])),
    sel: [...S.vsel],
    o: { pos: [...b.pos], rot: [...b.rot], size: [...b.size], verts: b.verts.map(p => [...p]),
      vw: b.verts.map(p => v3(p).applyQuaternion(R).add(P)) } };
  updateMode();
}
function tValue() {
  if (T.num === '' || T.num === '-' || T.num === '.') return null;
  const n = parseFloat(T.num);
  return isNaN(n) ? null : n;
}
function applyT(live = false) {
  const b = T.b, o = T.o, v = tValue();
  if (T.kind === 'G' && T.members.length > 1) {
    applyMultiTranslate(v);
    changed();
    if (!live) {
      updateMode();
      renderProps();
      updateHandles();
    }
    return;
  }
  if (T.kind === 'R' && T.members.length > 1) {
    applyMultiRotate(v);
    changed();
    if (!live) {
      updateMode();
      renderProps();
      updateHandles();
    }
    return;
  }
  if (T.kind === 'S' && T.members.length > 1) {
    applyMultiScale(v);
    changed();
    if (!live) {
      updateMode();
      renderProps();
      updateHandles();
    }
    return;
  }
  const prev = { pos: [...b.pos], rot: [...b.rot], verts: b.verts };
  const snapOn = S.snap && v === null;
  const sn = x => snapOn ? Math.round(x / S.grid) * S.grid : x;

  if (T.kind === 'GV') {
    applyVertMove(v, snapOn);
  } else {
    if (T.kind === 'G') {
      if (T.axis) { const i = AX[T.axis]; b.pos[i] = sn(o.pos[i] + (v ?? T.acc.x)); }
      else if (v !== null) b.pos[0] = o.pos[0] + v;
      else { b.pos[0] = sn(o.pos[0] + T.acc.x); b.pos[2] = sn(o.pos[2] + T.acc.y); }
      sync(b, false);
    } else if (T.kind === 'R') {
      if (T.gizmo) {
        let deg = T.acc.x;
        if (S.snap) deg = Math.round(deg / 15) * 15;
        const q = new THREE.Quaternion().setFromAxisAngle(AXV[AX[T.axis]], deg * DEG).multiply(quatOf(o.rot));
        const eu = new THREE.Euler().setFromQuaternion(q, 'XYZ');
        b.rot = [eu.x / DEG, eu.y / DEG, eu.z / DEG];
      } else {
        const i = AX[T.axis || 'y'];
        let deg = o.rot[i] + (v ?? T.acc.x);
        if (snapOn) deg = Math.round(deg / 15) * 15;
        b.rot = [...o.rot];
        b.rot[i] = deg;
      }
      sync(b, false);
    } else if (T.kind === 'S') {
      // Scaling holds the face opposite the handle still, so the block grows toward the handle.
      // Shift-drag scales symmetrically about the center instead.
      const i = AX[T.axis];
      if (T.symScale) {
        const want = o.size[i] + 2 * T.acc.x;
        const target = [...o.size];
        target[i] = Math.max(0.05, S.snap ? Math.round(want / S.grid) * S.grid : want);
        const r = target.map((t, k) => o.size[k] > 1e-9 ? t / o.size[k] : 1);
        const c0 = [0, 0, 0];
        o.verts.forEach(p => { c0[0] += p[0]; c0[1] += p[1]; c0[2] += p[2]; });
        c0.forEach((_, k) => c0[k] /= o.verts.length);
        b.verts = o.verts.map(p => [p[0] * r[0], p[1] * r[1], p[2] * r[2]]);
        const c1 = [0, 0, 0];
        b.verts.forEach(p => { c1[0] += p[0]; c1[1] += p[1]; c1[2] += p[2]; });
        c1.forEach((_, k) => c1[k] /= b.verts.length);
        const w = v3([c0[0] - c1[0], c0[1] - c1[1], c0[2] - c1[2]]).applyQuaternion(quatOf(o.rot));
        b.pos = [o.pos[0] + w.x, o.pos[1] + w.y, o.pos[2] + w.z];
        sync(b);
      } else {
        const want = o.size[i] + T.acc.x;
        const target = [...o.size];
        target[i] = Math.max(0.05, S.snap ? Math.round(want / S.grid) * S.grid : want);
        const s = anchoredShape(o, target, i, T.sign > 0);
        b.verts = s.verts;
        b.pos = s.pos;
        sync(b);
      }
    }
    const hit = blockedBy(b);
    if (hit) {
      b.verts = prev.verts; b.pos = prev.pos; b.rot = prev.rot;
      sync(b, T.kind === 'S' || T.kind === 'GV');
      flash(hit === 'ground' ? 'Blocked: that would pass through the ground.' : 'Blocked: that would overlap another block.');
    } else if (T.kind === 'S' && b.shearLinks) {
      refreshShearLinkHardware(b);
    }
  }
  changed();
  if (!live) {
    updateMode();
    renderProps();
    updateHandles();
  }
}
function applyMultiTranslate(value) {
  const delta = [0, 0, 0];
  if (T.axis) delta[AX[T.axis]] = value ?? T.acc.x;
  else if (value !== null) delta[0] = value;
  else {
    delta[0] = T.acc.x;
    delta[2] = T.acc.y;
  }
  if (S.snap && value === null) {
    for (const axis of (T.axis ? [AX[T.axis]] : [0, 2])) {
      const start = T.originals.get(T.b).pos[axis];
      delta[axis] = Math.round((start + delta[axis]) / S.grid) * S.grid - start;
    }
  }
  const selected = new Set(T.members);
  const candidates = T.members.map(member => {
    const original = T.originals.get(member);
    return {
      member,
      pos: original.pos.map((coordinate, axis) => coordinate + delta[axis]),
      shape: { verts: original.verts, pos: original.pos.map((coordinate, axis) => coordinate + delta[axis]),
        rot: original.rot, foundation: member.foundation }
    };
  });
  const blocked = candidates.some(candidate =>
    shapeBlocked(candidate.shape, candidate.member, selected));
  if (blocked) {
    flash('Blocked: moving the selection would overlap another block or pass through the ground.');
    return;
  }
  for (const candidate of candidates) {
    candidate.member.pos = candidate.pos;
    sync(candidate.member, false);
  }
}
function applyMultiRotate(value) {
  const axis = T.axis || 'y';
  let degrees = value ?? T.acc.x;
  if (S.snap && value === null) degrees = Math.round(degrees / 15) * 15;
  const delta = new THREE.Quaternion().setFromAxisAngle(AXV[AX[axis]], degrees * DEG);
  const center = new THREE.Vector3(
    (T.bounds.min[0] + T.bounds.max[0]) / 2,
    (T.bounds.min[1] + T.bounds.max[1]) / 2,
    (T.bounds.min[2] + T.bounds.max[2]) / 2
  );
  const selected = new Set(T.members);
  const candidates = T.members.map(member => {
    const original = T.originals.get(member);
    const position = new THREE.Vector3(...original.pos).sub(center).applyQuaternion(delta).add(center);
    const rotation = delta.clone().multiply(quatOf(original.rot));
    const euler = new THREE.Euler().setFromQuaternion(rotation, 'XYZ');
    const rot = [euler.x / DEG, euler.y / DEG, euler.z / DEG];
    const pos = position.toArray();
    return {
      member, pos, rot,
      shape: { verts: original.verts, pos, rot, foundation: member.foundation }
    };
  });
  if (candidates.some(candidate =>
    shapeBlocked(candidate.shape, candidate.member, selected))) {
    flash('Blocked: rotating the selection would overlap another block or pass through the ground.');
    return;
  }
  for (const candidate of candidates) {
    candidate.member.pos = candidate.pos;
    candidate.member.rot = candidate.rot;
    sync(candidate.member, false);
  }
}
function applyMultiScale(value) {
  const axis = AX[T.axis];
  if (axis === undefined) return;
  const min = T.bounds.min[axis], max = T.bounds.max[axis];
  const extent = max - min;
  if (extent <= 1e-8) return;
  const delta = (value ?? T.acc.x) * (T.symScale ? 2 : 1);
  let factor = Math.max(0.05, (extent + delta) / extent);
  if (S.snap) factor = Math.max(0.05, Math.round((extent * factor) / S.grid) * S.grid / extent);
  const anchor = T.symScale ? (min + max) / 2 : (T.sign > 0 ? min : max);
  const selected = new Set(T.members);
  for (const member of T.members) {
    const original = T.originals.get(member);
    const rotation = quatOf(original.rot), inverseRotation = rotation.clone().invert();
    const originalPosition = v3(original.pos);
    const scaledPosition = originalPosition.clone();
    scaledPosition.setComponent(axis,
      anchor + (originalPosition.getComponent(axis) - anchor) * factor);
    member.pos = scaledPosition.toArray();
    member.verts = original.verts.map(vertex => {
      const worldVertex = v3(vertex).applyQuaternion(rotation).add(originalPosition);
      worldVertex.setComponent(axis,
        anchor + (worldVertex.getComponent(axis) - anchor) * factor);
      return worldVertex.sub(scaledPosition).applyQuaternion(inverseRotation).toArray();
    });
    sync(member);
  }
  const blocked = T.members.some(member => {
    const mass = MATS[member.mat].rho * geometryVolume(member.verts);
    return !validGeometry(member.verts) || !Number.isFinite(mass) ||
      mass <= 0 || mass > MAX_BLOCK_MASS ||
      shapeBlocked({ verts: member.verts, pos: member.pos, rot: member.rot,
        foundation: member.foundation }, member, selected);
  });
  if (!blocked) {
    for (const member of T.members) if (member.shearLinks) refreshShearLinkHardware(member);
    return;
  }
  for (const member of T.members) {
    const original = T.originals.get(member);
    member.verts = original.verts.map(vertex => [...vertex]);
    member.pos = [...original.pos];
    member.rot = [...original.rot];
    sync(member);
  }
  for (const member of T.members) if (member.shearLinks) refreshShearLinkHardware(member);
  flash('Blocked: scaling would overlap another block or pass through the ground.');
}
function applyVertMove(v, snapOn) {
  const b = T.b, o = T.o;
  const Ri = quatOf(b.rot).invert();
  const P = v3(o.pos);
  const D = new THREE.Vector3();
  if (T.axis) D.setComponent(AX[T.axis], v ?? T.acc.x);
  else if (v !== null) D.x = v;
  else { D.x = T.acc.x; D.z = T.acc.y; }
  const c = new THREE.Vector3();
  T.sel.forEach(i => c.add(o.vw[i]));
  c.multiplyScalar(1 / T.sel.length);
  if (snapOn) {
    const axes = T.axis ? [AX[T.axis]] : (v !== null ? [] : [0, 2]);
    for (const a of axes) {
      const target = Math.round((c.getComponent(a) + D.getComponent(a)) / S.grid) * S.grid;
      D.setComponent(a, target - c.getComponent(a));
    }
  }
  const cand = o.verts.map(p => [...p]);
  for (const i of T.sel) {
    const local = o.vw[i].clone().add(D).sub(P).applyQuaternion(Ri);
    cand[i] = [local.x, local.y, local.z];
  }
  if (!convexOK(cand)) { flash('That move would make the shape non-convex. Solver blocks must be convex.'); return; }
  const hit = shapeBlocked({ verts: cand, pos: b.pos, rot: b.rot }, b);
  if (hit) { flash(hit === 'ground' ? 'Blocked: that would pass through the ground.' : 'Blocked: that would overlap another block.'); return; }
  b.verts = cand;
  sync(b);
}
function confirmT() {
  const labels = { G: 'Moved', GV: 'Moved vertices', R: 'Rotated', S: 'Scaled' };
  const lbl = labels[T.kind];
  const reshaped = T.kind === 'GV'
    ? T.members.filter(member => member.shearLinks) : [];
  const movedFrameMembers = T.members.filter(member => member.frame);
  if (movedFrameMembers.length) invalidateFrameModel(movedFrameMembers);
  T = null;
  for (const member of reshaped) refreshShearLinkHardware(member);
  changed();
  updateMode();
  renderProps();
  updateHandles();
  flash(`${lbl}.`);
}
function cancelT() {
  const reshaped = ['GV', 'S'].includes(T.kind)
    ? T.members.filter(member => member.shearLinks) : [];
  for (const member of T.members) {
    const original = T.originals.get(member);
    member.verts = original.verts.map(p => [...p]);
    member.pos = [...original.pos];
    member.rot = [...original.rot];
    sync(member);
  }
  S.undo.pop();
  T = null;
  for (const member of reshaped) refreshShearLinkHardware(member);
  changed();
  updateMode();
  renderProps();
  updateHandles();
  flash('Cancelled.');
}
function startGizmoDrag(mesh, e) {
  const u = mesh.userData;
  const kind = S.edit ? 'GV' : (u.kind === 'move' ? 'G' : u.kind === 'rotate' ? 'R' : 'S');
  if (S.edit && u.kind !== 'move') return;
  const center = lastCenter.clone();
  startT(kind, { gizmo: true, axis: AXV.length && ['x', 'y', 'z'][u.axis], sign: u.sign || 1 });
  if (!T) return;
  T.start = { x: e.clientX, y: e.clientY };
  const i = u.axis;
  const axisVec = AXV[i];
  const c = toPx(center), p1 = toPx(center.clone().add(axisVec));
  T.centerPx = { x: c[0], y: c[1] };
  const dv = new THREE.Vector2(p1[0] - c[0], p1[1] - c[1]);
  const len = dv.length() || 1;
  T.screenDir = dv.divideScalar(len);
  T.pxPerUnit = len;
  T.viewDir = center.clone().sub(camera.position).normalize();
}
function updateGizmoDrag(e) {
  if (T.kind === 'R') {
    const c = T.centerPx;
    const v0 = [T.start.x - c.x, T.start.y - c.y], v1 = [e.clientX - c.x, e.clientY - c.y];
    const ang = Math.atan2(v0[0] * v1[1] - v0[1] * v1[0], v0[0] * v1[0] + v0[1] * v1[1]) / DEG;
    const axisVec = AXV[AX[T.axis]];
    const facing = axisVec.dot(T.viewDir);
    T.acc.x = ang * (Math.abs(facing) > 1e-4 ? Math.sign(facing) : 1);
  } else {
    const dm = [e.clientX - T.start.x, e.clientY - T.start.y];
    const direction = (dm[0] * T.screenDir.x + dm[1] * T.screenDir.y) / T.pxPerUnit;
    T.acc.x = T.kind === 'S' ? direction * T.sign : direction;
  }
  T.symScale = T.kind === 'S' && e.shiftKey;
  scheduleLiveTransform();
}
let liveTransformPending = false;
function scheduleLiveTransform() {
  if (liveTransformPending) return;
  liveTransformPending = true;
  requestAnimationFrame(() => {
    liveTransformPending = false;
    if (T) applyT(true);
  });
}
let placementPointerPending = false;
let latestPlacementPointer = null;
function scheduleBlockPlacementUpdate(event) {
  latestPlacementPointer = { clientX: event.clientX, clientY: event.clientY };
  if (placementPointerPending) return;
  placementPointerPending = true;
  requestAnimationFrame(() => {
    placementPointerPending = false;
    if (blockPlacement && latestPlacementPointer) updateBlockPlacement(latestPlacementPointer);
  });
}
function updateMode() {
  const el = byId('mode');
  if (T) {
    const names = { G: 'GRAB', GV: 'GRAB VERTICES', R: 'ROTATE', S: 'SCALE' };
    const ax = T.axis ? T.axis.toUpperCase() : (T.kind === 'R' ? 'Y (default)' : 'free');
    const val = T.num !== '' ? T.num : (T.gizmo ? 'gizmo' : 'mouse');
    el.textContent = `${names[T.kind]} | axis ${ax} | ${val}`;
    el.style.color = 'var(--warn)';
  } else if (S.edit) {
    el.textContent = `EDIT VERTICES | ${S.vsel.size} selected`;
    el.style.color = 'var(--ok)';
  } else {
    el.textContent = S.sim ? 'SIMULATING' : `BUILD | ${S.gizmoMode.toUpperCase()}`;
    el.style.color = S.sim ? 'var(--bad)' : 'var(--accent)';
  }
  const kbd = k => `<span class="kbd">${k}</span>`;
  byId('hint').innerHTML = T
    ? `Type a number | ${kbd('X')}${kbd('Y')}${kbd('Z')} constrain | ${kbd('Enter')} confirm | ${kbd('Esc')} cancel`
    : blockPlacement
      ? `Move the mouse to position the ${MATS[blockPlacement.mat].name} preview | Click to place multiple blocks | Click material again or ${kbd('Esc')} finish | ${kbd('1')}${kbd('2')}${kbd('3')} switch tool`
      : framePlacement
      ? framePlacement.gizmoMode
        ? `Drag arrows (${kbd('1')}) to move | rings (${kbd('2')}) to rotate | ${kbd('G')} cursor follow | ${kbd('Enter')} place | ${kbd('Esc')} cancel`
        : `Move the mouse to position the frame | ${kbd('Enter')} place | ${kbd('G')} gizmos | ${kbd('Esc')} cancel`
      : S.edit
        ? `Click a vertex | ${kbd('Shift')}+click adds | ${kbd('A')} select all | ${kbd('G')} move | ${kbd('Tab')} exit edit<br>WASD fly | ${kbd('Q')}/${kbd('E')} down/up | Right-drag look`
        : `WASD fly | ${kbd('Q')}/${kbd('E')} down/up | Right-drag look | Wheel speed<br>Click select | ${kbd('Ctrl')}+click multi-select | ${kbd('Alt')}+click connected | ${kbd('.')} orbit selection | ${kbd('1')}${kbd('2')}${kbd('3')} gizmo | ${kbd('Numpad .')} focus selection | ${kbd('Tab')} edit vertices | ${kbd('Ctrl+Z')} undo | ${kbd('Ctrl+Shift+Z')} redo`;
  document.querySelectorAll('#gizmoButtons button').forEach(b => b.classList.toggle('on', b.dataset.g === S.gizmoMode));
}

const tutorialSteps = [
  { target: '#tutorialStartBtn', title: 'Welcome to the workshop',
    text: 'You can explore the workspace at your own pace. This guided tour highlights one control at a time; the rest of the interface dims so it is easy to focus.' },
  { target: '#hint', title: 'Move around the scene',
    text: 'Use the mouse to orbit and zoom in the 3D view. The keyboard guide at the top of the scene shows movement keys and shortcuts.' },
  { target: '#mats .mat', title: 'Choose a material',
    text: 'Pick a material for new objects here. Each material has different density and strength in the simulation.' },
  { target: '#shapeSel', title: 'Choose a shape',
    text: 'Choose a box, cylinder, sphere, cone, or wedge. The selected shape is used when you add a new object.' },
  { target: '.v3', title: 'Set the dimensions',
    text: 'Set width, height, and depth before adding an object. You can also edit a selected object later in the Selection panel.' },
  { target: '#addBtn', title: 'Add your first object',
    text: 'Press Add block to place the chosen material and shape at the center of the view. Select an object by clicking it in the scene.' },
  { target: '#buildFrameBtn', title: 'Build a complete frame',
    text: 'For a quick start, choose a frame preset and number of stories, then build a reinforced-concrete frame. You can also add braces and infill from this panel.' },
  { target: '#gizmoButtons', title: 'Move, rotate, and scale',
    text: 'Choose Move, Rotate, or Scale, then drag the colored handles on the selected object. Use the number keys 1, 2, and 3 to switch tools.' },
  { target: '#quakeSel', title: 'Try an earthquake',
    text: 'Choose an earthquake preset to apply ground motion. Start with a lower magnitude while learning; the earthquake selector is locked during a run.' },
  { target: '#runBtn', title: 'Run it live or bake it',
    text: 'Run Live calculates as it plays. Build Sim precomputes the motion; when it finishes, Play Baked replays the saved frames without recalculating.' },
  { target: '#prepareBtn', title: 'Play a baked simulation',
    text: 'Build Sim can be stopped early to keep the frames calculated so far. Once building finishes, use Play Baked in the top bar to review them; Reset restores the workspace.' },
  { target: '#saveProjectBtn', title: 'Save and export',
    text: 'Save Project keeps an editable copy you can load later. Export 3D downloads the visible structure as a GLB model for other 3D apps.' },
  { target: '#autoStabilizeBtn', title: 'Review the results',
    text: 'After a run, inspect damage and structural suggestions here. These are simplified simulation estimates.' }
];
let activeTutorialStep = -1;
let tutorialPositionFrame = 0;
const tutorialOverlay = byId('tutorialOverlay');

function positionTutorial() {
  if (!tutorialOverlay || tutorialOverlay.hidden || activeTutorialStep < 0) return;
  const step = tutorialSteps[activeTutorialStep];
  const target = document.querySelector(step.target) || byId('view');
  const rect = target.getBoundingClientRect();
  const pad = 7, left = Math.max(0, rect.left - pad), top = Math.max(0, rect.top - pad);
  const right = Math.min(innerWidth, rect.right + pad), bottom = Math.min(innerHeight, rect.bottom + pad);
  const x = Math.max(0, left), y = Math.max(0, top);
  const width = Math.max(1, right - x), height = Math.max(1, bottom - y);
  const setRect = (selector, style) => Object.assign(tutorialOverlay.querySelector(selector).style, style);
  setRect('[data-shade="top"]', { left: '0px', top: '0px', width: `${innerWidth}px`, height: `${y}px` });
  setRect('[data-shade="left"]', { left: '0px', top: `${y}px`, width: `${x}px`, height: `${height}px` });
  setRect('[data-shade="right"]', { left: `${right}px`, top: `${y}px`, width: `${Math.max(0, innerWidth - right)}px`, height: `${height}px` });
  setRect('[data-shade="bottom"]', { left: '0px', top: `${bottom}px`, width: `${innerWidth}px`, height: `${Math.max(0, innerHeight - bottom)}px` });
  setRect('#tutorialSpotlight', { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  const card = byId('tutorialCard');
  const cardRect = card.getBoundingClientRect();
  const cardWidth = cardRect.width || Math.min(360, innerWidth - 32);
  const cardHeight = cardRect.height || 200;
  const cardLeft = Math.max(16, Math.min(innerWidth - cardWidth - 16, left + width / 2 - cardWidth / 2));
  const belowTop = bottom + 16;
  const cardTop = belowTop + cardHeight <= innerHeight - 16
    ? belowTop : Math.max(16, top - cardHeight - 16);
  card.style.left = `${cardLeft}px`;
  card.style.top = `${cardTop}px`;
}

function renderTutorialStep() {
  if (activeTutorialStep < 0) return;
  const language = getLanguage();
  const step = tutorialSteps[activeTutorialStep];
  byId('tutorialProgress').textContent =
    `${translateText('Step', language)} ${activeTutorialStep + 1} ${translateText('of', language)} ${tutorialSteps.length}`;
  byId('tutorialTitle').textContent = translateText(step.title, language);
  byId('tutorialDescription').textContent = translateText(step.text, language);
  byId('tutorialBackBtn').textContent = translateText('Back', language);
  byId('tutorialBackBtn').disabled = activeTutorialStep === 0;
  byId('tutorialNextBtn').textContent = translateText(
    activeTutorialStep === tutorialSteps.length - 1 ? 'Finish' : 'Next', language);
  byId('tutorialCloseBtn').textContent = translateText('Exit', language);
  const target = document.querySelector(step.target);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  positionTutorial();
}

function closeTutorial() {
  if (!tutorialOverlay || tutorialOverlay.hidden) return;
  tutorialOverlay.hidden = true;
  activeTutorialStep = -1;
  cancelAnimationFrame(tutorialPositionFrame);
  byId('tutorialStartBtn').focus();
}

function tutorialPositionLoop() {
  if (tutorialOverlay.hidden) return;
  positionTutorial();
  tutorialPositionFrame = requestAnimationFrame(tutorialPositionLoop);
}

function startTutorial() {
  activeTutorialStep = 0;
  tutorialOverlay.hidden = false;
  renderTutorialStep();
  byId('tutorialCloseBtn').focus();
  tutorialPositionLoop();
}

byId('tutorialStartBtn').addEventListener('click', startTutorial);
byId('tutorialCloseBtn').addEventListener('click', closeTutorial);
byId('tutorialBackBtn').addEventListener('click', () => {
  if (activeTutorialStep <= 0) return;
  activeTutorialStep--;
  renderTutorialStep();
});
byId('tutorialNextBtn').addEventListener('click', () => {
  if (activeTutorialStep >= tutorialSteps.length - 1) return closeTutorial();
  activeTutorialStep++;
  renderTutorialStep();
});
addEventListener('keydown', event => {
  if (tutorialOverlay.hidden) return;
  event.stopImmediatePropagation();
  if (event.key === 'Tab') {
    const buttons = [byId('tutorialCloseBtn'), byId('tutorialBackBtn'), byId('tutorialNextBtn')]
      .filter(button => !button.disabled);
    const current = buttons.indexOf(document.activeElement);
    const next = event.shiftKey
      ? (current <= 0 ? buttons.length - 1 : current - 1)
      : (current === buttons.length - 1 ? 0 : current + 1);
    if (current < 0 || (event.shiftKey && current === 0) || (!event.shiftKey && current === buttons.length - 1)) {
      event.preventDefault();
      buttons[next].focus();
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeTutorial();
  } else if (event.key === 'ArrowRight' && getLanguage() !== 'ar') {
    activeTutorialStep = Math.min(tutorialSteps.length - 1, activeTutorialStep + 1);
    renderTutorialStep();
  } else if (event.key === 'ArrowLeft' && getLanguage() !== 'ar') {
    activeTutorialStep = Math.max(0, activeTutorialStep - 1);
    renderTutorialStep();
  }
});

function setGizmoMode(m) {
  S.gizmoMode = m;
  updateMode();
  flash(`Gizmo: ${m}.`);
}

/* ================= placement ================= */
let blockPlacement = null;
function placementTarget() {
  const f = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
  if (f.y < -0.01) {
    const t = -camera.position.y / f.y;
    if (t > 0 && t < 200) return camera.position.clone().addScaledVector(f, t);
  }
  return new THREE.Vector3(0, 0, 0);
}
function makeBlockGhost(verts) {
  const geometry = smoothConvexGeometry(verts);
  const fill = new THREE.MeshBasicMaterial({
    color: 0x35d5ff, transparent: true, opacity: 0.3, depthWrite: false
  });
  const edge = new THREE.LineBasicMaterial({
    color: 0x9be8ff, transparent: true, opacity: 0.9, depthWrite: false
  });
  const ghost = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, fill);
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edge));
  ghost.add(mesh);
  ghost.userData.fillMat = fill;
  ghost.userData.edgeMat = edge;
  ghost.traverse(object => { object.raycast = () => {}; });
  return ghost;
}
function snapBlockCenter(value, extent) {
  if (!S.snap) return value;
  const halfExtent = extent / 2;
  return Math.round((value - halfExtent) / S.grid) * S.grid + halfExtent;
}
function startBlockPlacement() {
  if (S.edit) return flash('Leave edit mode (Tab) to add blocks.');
  if (S.sim) return flash('Stop the simulation to edit the structure.');
  if (blockPlacement || framePlacement) return flash('Finish or cancel the current placement first.');
  const dims = [byId('nW').value, byId('nH').value, byId('nD').value].map(v => Math.max(0.05, parseFloat(v) || 1));
  const foundation = byId('foundationMode').checked;
  const shape = foundation ? 'box' : (byId('shapeSel') ? byId('shapeSel').value : 'box');
  const mat = foundation ? 'concrete' : S.mat;
  const verts = shapeVerts(shape, dims);
  if (foundation && dims[1] > 10) return flash('Buried pier depth is limited to 10 m in this screening model.');
  const ghost = makeBlockGhost(verts);
  scene.add(ghost);
  blockPlacement = {
    ghost, verts, size: dims, mat, foundation,
    materialKey: S.mat,
    minY: Math.min(...verts.map(point => point[1])),
    pos: [0, 0, 0], valid: false
  };
  buildMaterialList();
  dom.style.cursor = 'crosshair';
  const target = placementTarget();
  positionBlockGhost(target.x, target.z);
  updateMode();
  flash(`Move the ${MATS[mat].name} preview and click to place it. Press Escape to cancel.`);
}
function refreshBlockPlacementPreview() {
  if (!blockPlacement) return;
  const preview = blockPlacement;
  const size = [byId('nW').value, byId('nH').value, byId('nD').value]
    .map(value => Math.max(0.05, parseFloat(value) || 1));
  const foundation = byId('foundationMode').checked;
  const shape = foundation ? 'box' : (byId('shapeSel')?.value || 'box');
  const verts = shapeVerts(shape, size);
  const geometry = smoothConvexGeometry(verts);
  const mesh = preview.ghost.children[0];
  mesh.geometry.dispose();
  mesh.children[0].geometry.dispose();
  mesh.geometry = geometry;
  mesh.children[0].geometry = new THREE.EdgesGeometry(geometry);
  preview.verts = verts;
  preview.size = size;
  preview.foundation = foundation;
  preview.mat = foundation ? 'concrete' : S.mat;
  preview.minY = Math.min(...verts.map(point => point[1]));
  preview.valid = !(foundation && size[1] > 10);
  updateBlockPlacement({ clientX: lastX, clientY: lastY });
}
function positionBlockGhost(x, z, surfaceHit = null) {
  if (!blockPlacement) return;
  const preview = blockPlacement;
  const extentX = Math.max(...preview.verts.map(point => Math.abs(point[0]))) * 2;
  const extentZ = Math.max(...preview.verts.map(point => Math.abs(point[2]))) * 2;
  const snappedX = snapBlockCenter(x, extentX), snappedZ = snapBlockCenter(z, extentZ);
  let pos = preview.foundation
    ? [snappedX, -preview.size[1] / 2, snappedZ]
    : [snappedX, -preview.minY, snappedZ];
  const shape = { verts: preview.verts, pos, rot: [0, 0, 0], foundation: preview.foundation };
  let attachedToSide = false;
  const targetBlock = surfaceHit?.object?.userData?.block;
  if (!preview.foundation && targetBlock?.alive && surfaceHit.face) {
    const normal = surfaceHit.face.normal.clone()
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(surfaceHit.object.matrixWorld)).normalize();
    const axis = Math.abs(normal.x) > Math.abs(normal.z) ? 0 : 2;
    const sideNormal = normal.getComponent(axis);
    if (Math.abs(sideNormal) > 0.85 && Math.abs(normal.y) < 0.2) {
      const targetWorld = shapeWorld(targetBlock);
      const axisMin = Math.min(...targetWorld.map(point => point.getComponent(axis)));
      const axisMax = Math.max(...targetWorld.map(point => point.getComponent(axis)));
      const minY = Math.min(...targetWorld.map(point => point.y));
      const maxY = Math.max(...targetWorld.map(point => point.y));
      const minTangent = Math.min(...targetWorld.map(point => point.getComponent(axis === 0 ? 2 : 0)));
      const maxTangent = Math.max(...targetWorld.map(point => point.getComponent(axis === 0 ? 2 : 0)));
      const sideExtent = Math.max(...preview.verts.map(point => Math.abs(point[axis])));
      const otherAxis = axis === 0 ? 2 : 0;
      const tangentExtent = Math.max(...preview.verts.map(point => Math.abs(point[otherAxis])));
      const minCenterY = Math.max(-preview.minY, minY - preview.minY);
      const maxCenterY = maxY - Math.max(...preview.verts.map(point => point[1]));
      pos[axis] = (sideNormal > 0 ? axisMax : axisMin) +
        Math.sign(sideNormal) * (sideExtent + 0.003);
      const tangent = surfaceHit.point.getComponent(otherAxis);
      const tangentLow = minTangent + tangentExtent;
      const tangentHigh = maxTangent - tangentExtent;
      pos[otherAxis] = tangentLow <= tangentHigh
        ? Math.max(tangentLow, Math.min(tangentHigh,
          snapBlockCenter(tangent, tangentExtent * 2)))
        : (minTangent + maxTangent) / 2;
      const clickedY = surfaceHit.point.y;
      pos[1] = minCenterY <= maxCenterY
        ? Math.max(minCenterY, Math.min(maxCenterY, clickedY))
        : Math.max(-preview.minY, clickedY);
      shape.pos = pos;
      attachedToSide = true;
    }
  }
  let obstruction = shapeBlocked(shape, null);
  if (obstruction && !preview.foundation && !attachedToSide) {
    const world = shapeWorld(shape);
    const minX = Math.min(...world.map(point => point.x));
    const maxX = Math.max(...world.map(point => point.x));
    const minZ = Math.min(...world.map(point => point.z));
    const maxZ = Math.max(...world.map(point => point.z));
    let top = -Infinity;
    for (const block of blocks) {
      if (!block.alive) continue;
      const bounds = new THREE.Box3().setFromObject(block.mesh);
      if (bounds.max.x > minX && bounds.min.x < maxX &&
        bounds.max.z > minZ && bounds.min.z < maxZ) top = Math.max(top, bounds.max.y);
    }
    if (Number.isFinite(top)) {
      pos[1] = top - preview.minY;
      shape.pos = pos;
      obstruction = shapeBlocked(shape, null);
    }
  }
  preview.pos = pos;
  preview.valid = !obstruction;
  preview.ghost.position.set(...pos);
  preview.ghost.userData.fillMat.color.setHex(obstruction ? 0xff5544 : 0x35d5ff);
  preview.ghost.userData.edgeMat.color.setHex(obstruction ? 0xff8877 : 0x9be8ff);
}
function updateBlockPlacement(event) {
  if (!blockPlacement) return;
  const placementRay = rayFrom(event);
  const targets = blocks.filter(block => block.alive).map(block => block.mesh);
  targets.push(plateMesh);
  const hit = placementRay.intersectObjects(targets, false)[0];
  let point = hit?.point;
  if (!point) {
    point = placementRay.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()
    );
    if (point && (Math.abs(point.x) > GROUND_HALF || Math.abs(point.z) > GROUND_HALF)) point = null;
  }
  if (point) {
    positionBlockGhost(point.x, point.z, hit);
  } else {
    blockPlacement.valid = false;
    blockPlacement.ghost.userData.fillMat.color.setHex(0xff5544);
    blockPlacement.ghost.userData.edgeMat.color.setHex(0xff8877);
  }
  if (blockPlacement.foundation && blockPlacement.size[1] > 10) {
    blockPlacement.valid = false;
    blockPlacement.ghost.userData.fillMat.color.setHex(0xff5544);
    blockPlacement.ghost.userData.edgeMat.color.setHex(0xff8877);
  }
}
function placeBlockPreview() {
  if (!blockPlacement) return;
  const preview = blockPlacement;
  if (!preview.valid) return flash('No room there. Move the preview to a clear spot.');
  pushUndo();
  S.sel = makeBlock({
    mat: preview.mat, size: preview.size, pos: preview.pos, rot: [0, 0, 0],
    verts: preview.verts, foundation: preview.foundation
  }, true);
  S.selected = new Set([S.sel]);
  changed();
  renderProps();
  updateMode();
  flash(`${preview.foundation
    ? `Added buried concrete pier, ${preview.size[0].toFixed(2)} x ${preview.size[2].toFixed(2)} m, embedded ${preview.size[1].toFixed(2)} m.`
    : `Added ${MATS[preview.mat].name} block ${preview.size.map(v => v.toFixed(2)).join(' x ')} m.`} Click to place another, or click the selected material again to finish.`);
}
function cancelBlockPlacement(finished = false) {
  if (!blockPlacement) return;
  const ghost = blockPlacement.ghost;
  blockPlacement = null;
  buildMaterialList();
  animateFrameGhostOut(ghost);
  dom.style.cursor = 'default';
  updateMode();
  flash(finished ? 'Block placement finished.' : 'Block placement cancelled.');
}
function frameCreates() {
  const floors = Math.max(2, Math.min(5, parseInt(byId('frameFloors').value, 10) || 3));
  const presets = {
    standard: { columnSide: 0.5, beamWidth: 0.3, beamDepth: 0.55, fck: 30e6, E: 30e9, rho: 0.012, deadLoad: 8 },
    older: { columnSide: 0.4, beamWidth: 0.25, beamDepth: 0.45, fck: 20e6, E: 25e9, rho: 0.008, deadLoad: 8.5 },
    stiff: { columnSide: 0.6, beamWidth: 0.35, beamDepth: 0.65, fck: 45e6, E: 34e9, rho: 0.018, deadLoad: 8 }
  };
  const profile = presets[byId('framePreset').value] || presets.standard;
  const storyHeight = 3, { columnSide, beamWidth, beamDepth } = profile, slabDepth = 0.15;
  const bay = 4, coords = [-bay, 0, bay], footprint = bay * 2 + columnSide;
  const frameData = { model: 'rc-frame', assemblyId: `rc-frame-${nextFrameId++}`,
    storyHeight, floors, footprint, footprintArea: footprint * footprint, liveLoad: 2,
    deadLoad: profile.deadLoad, rebarRatio: profile.rho, rebarYield: 420e6, fck: profile.fck, E: profile.E,
    profile: byId('framePreset').value, bay, expectedBeamCount: 12, columnSide, beamWidth, beamDepth };
  // Use the currently selected material for the generated RC frame members.
  const frameMat = S.mat;
  const creates = [];
  const add = (role, story, size, pos, foundation = false) => creates.push({
    mat: frameMat, size, pos, rot: [0, 0, 0], foundation,
    frame: { ...frameData, role, story }
  });

  const footingSide = Math.max(0.9, columnSide + 0.5);
  for (const x of coords) for (const z of coords) {
    add('footing', 0, [footingSide, 0.45, footingSide], [x, -0.225, z], true);
  }
  for (let story = 1; story <= floors; story++) {
    const floorY = story * storyHeight;
    const columnBase = story === 1 ? 0 : (story - 1) * storyHeight;
    const columnTop = floorY - beamDepth;
    const columnHeight = columnTop - columnBase;
    if (columnHeight <= 0.5) return null;
    for (const x of coords) for (const z of coords) {
      add('column', story, [columnSide, columnHeight, columnSide], [x, (columnBase + columnTop) / 2, z]);
    }
    for (const z of coords) for (let bayIndex = 0; bayIndex < coords.length - 1; bayIndex++) {
      const x0 = coords[bayIndex], x1 = coords[bayIndex + 1];
      add('beam', story, [bay - columnSide, beamDepth, Math.max(columnSide, beamWidth)],
        [(x0 + x1) / 2, floorY - beamDepth / 2, z]);
    }
    for (const x of coords) for (let bayIndex = 0; bayIndex < coords.length - 1; bayIndex++) {
      const z0 = coords[bayIndex], z1 = coords[bayIndex + 1];
      add('beam', story, [Math.max(columnSide, beamWidth), beamDepth, bay - columnSide],
        [x, floorY - beamDepth / 2, (z0 + z1) / 2]);
    }
    const panelSize = bay - columnSide;
    for (let xBay = 0; xBay < coords.length - 1; xBay++) {
      for (let zBay = 0; zBay < coords.length - 1; zBay++) {
        add('slab', story, [panelSize, slabDepth, panelSize], [
          (coords[xBay] + coords[xBay + 1]) / 2,
          floorY + slabDepth / 2,
          (coords[zBay] + coords[zBay + 1]) / 2
        ]);
      }
    }
  }
  const profileName = { standard: 'standard', older: 'older weak', stiff: 'stiffer' }[frameData.profile];
  return { creates, frameData, floors, profileName };
}

let framePlacement = null;
let ghostDrag = null;
function frameGhostCenter() {
  const fp = framePlacement.frameData.footprint / 2;
  const h = framePlacement.floors * framePlacement.frameData.storyHeight / 2;
  return new THREE.Vector3(0, h, 0).applyQuaternion(framePlacement.rot)
    .add(new THREE.Vector3(framePlacement.pos.x, framePlacement.pos.y, framePlacement.pos.z));
}
function buildFrameGhost(creates) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x35d5ff, transparent: true, opacity: 0.2, depthWrite: false });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x9be8ff, transparent: true, opacity: 0.85 });
  group.userData.fillMat = mat;
  group.userData.edgeMat = edgeMat;
  for (const c of creates) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(c.size[0], c.size[1], c.size[2]), mat);
    mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat));
    group.add(mesh);
  }
  return group;
}
function startFramePlacement() {
  if (blockPlacement) return flash('Finish or cancel the current block placement first.');
  if (framePlacement) return flash('Finish or cancel the current frame placement first.');
  if (S.sim || S.edit) return flash('Stop the simulation and leave vertex-edit mode before building a frame.');
  if (S.braceMode) setBraceMode(false);
  if (S.infillMode) setInfillMode(false);
  const spec = frameCreates();
  if (!spec) return flash('The selected frame dimensions do not leave enough clear column height.');
  const ghost = buildFrameGhost(spec.creates);
  scene.add(ghost);
  framePlacement = { ...spec, ghost, pos: new THREE.Vector3(),
    rot: new THREE.Quaternion(), gizmoMode: false, gizmoTool: 'move' };
  dom.style.cursor = 'crosshair';
  updateMode();
  flash('Move the mouse to position the frame preview, then press Enter to build it. Press G to move it with the gizmos instead.');
}
function updateFramePlacement(e) {
  if (framePlacement.gizmoMode) return;
  const r = rayFrom(e);
  const o = r.ray.origin, d = r.ray.direction;
  if (d.y >= -1e-6) return;
  const t = -o.y / d.y;
  if (t <= 0 || t > 500) return;
  const p = o.clone().addScaledVector(d, t);
  framePlacement.pos.set(snapV(p.x), 0, snapV(p.z));
  framePlacement.ghost.position.copy(framePlacement.pos);
  updateFrameObstruction();
}
function clearPropsNear(cx, cz, half) {
  if (!envProps) return 0;
  const doomed = envProps.children.filter(child =>
    Math.abs(child.position.x - cx) <= half && Math.abs(child.position.z - cz) <= half);
  for (const child of doomed) envProps.remove(child);
  return doomed.length;
}
function toggleGhostGizmo() {
  framePlacement.gizmoMode = !framePlacement.gizmoMode;
  dom.style.cursor = framePlacement.gizmoMode ? 'default' : 'crosshair';
  updateMode();
  flash(framePlacement.gizmoMode
    ? 'Gizmo mode: drag the arrows to move the frame and the rings to rotate it. Press G to follow the cursor again.'
    : 'Cursor mode: the frame preview follows the mouse again.');
}
function startGhostDrag(mesh, e) {
  const u = mesh.userData;
  const center = frameGhostCenter();
  ghostDrag = { kind: u.kind, axis: u.axis, sign: u.sign || 1,
    start: { x: e.clientX, y: e.clientY },
    startPos: framePlacement.pos.clone(), startRot: framePlacement.rot.clone(),
    centerLocal: new THREE.Vector3(0, framePlacement.floors * framePlacement.frameData.storyHeight / 2, 0) };
  const c = toPx(center);
  const axisVec = AXV[u.axis].clone().multiplyScalar(u.sign || 1);
  const p1 = toPx(center.clone().add(axisVec));
  const dv = new THREE.Vector2(p1[0] - c[0], p1[1] - c[1]);
  const len = dv.length() || 1;
  ghostDrag.screenDir = dv.divideScalar(len);
  ghostDrag.pxPerUnit = len;
  ghostDrag.centerPx = { x: c[0], y: c[1] };
  ghostDrag.viewDir = center.clone().sub(camera.position).normalize();
}
function updateGhostDrag(e) {
  if (ghostDrag.kind === 'rotate') {
    const c = ghostDrag.centerPx;
    const v0 = [ghostDrag.start.x - c.x, ghostDrag.start.y - c.y];
    const v1 = [e.clientX - c.x, e.clientY - c.y];
    const ang = Math.atan2(v0[0] * v1[1] - v0[1] * v1[0], v0[0] * v1[0] + v0[1] * v1[1]) / DEG;
    const axisVec = AXV[ghostDrag.axis];
    const facing = axisVec.dot(ghostDrag.viewDir);
    const deg = ang * (Math.abs(facing) > 1e-4 ? Math.sign(facing) : 1);
    const q = new THREE.Quaternion().setFromAxisAngle(axisVec, deg * DEG);
    const newRot = q.clone().multiply(ghostDrag.startRot);
    // Rotate about the building's center, not its base origin, so the preview
    // spins in place instead of swinging around the ground.
    const centerWorld = ghostDrag.startPos.clone()
      .add(ghostDrag.centerLocal.clone().applyQuaternion(ghostDrag.startRot));
    framePlacement.rot.copy(newRot);
    framePlacement.pos.copy(centerWorld).sub(ghostDrag.centerLocal.clone().applyQuaternion(newRot));
    framePlacement.ghost.position.copy(framePlacement.pos);
    framePlacement.ghost.quaternion.copy(framePlacement.rot);
  } else {
    const dm = [e.clientX - ghostDrag.start.x, e.clientY - ghostDrag.start.y];
    const amount = (dm[0] * ghostDrag.screenDir.x + dm[1] * ghostDrag.screenDir.y) / ghostDrag.pxPerUnit;
    const axisVec = AXV[ghostDrag.axis].clone().multiplyScalar(ghostDrag.sign);
    framePlacement.pos.copy(ghostDrag.startPos).addScaledVector(axisVec, amount);
    framePlacement.pos.x = snapV(framePlacement.pos.x);
    framePlacement.pos.z = snapV(framePlacement.pos.z);
    framePlacement.ghost.position.copy(framePlacement.pos);
  }
  updateFrameObstruction();
}
function frameObstruction() {
  const fp = framePlacement.frameData.footprint / 2;
  const h = framePlacement.floors * framePlacement.frameData.storyHeight;
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) {
    corners.push(new THREE.Vector3(sx * fp, sy * h, sz * fp)
      .applyQuaternion(framePlacement.rot).add(framePlacement.pos));
  }
  if (framePlacement.pos.y < -0.01) return 'the ground';
  for (const c of corners) {
    if (Math.abs(c.x) > GROUND_HALF || Math.abs(c.z) > GROUND_HALF) return 'the edge of the ground';
  }
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const c of corners) { min.min(c); max.max(c); }
  const frameBB = new THREE.Box3(min, max);
  // Footings are designed to sit 0.45 m below grade; anything deeper means the frame is buried.
  if (frameBB.min.y < -0.46 || frameBB.max.y <= 0) return 'the ground';
  for (const b of blocks) {
    if (b.alive && frameBB.intersectsBox(new THREE.Box3().setFromObject(b.mesh))) return 'an existing object';
  }
  return null;
}
function updateFrameObstruction() {
  if (!framePlacement) return;
  const reason = frameObstruction();
  framePlacement.obstructed = reason;
  const fill = framePlacement.ghost.userData.fillMat;
  const edge = framePlacement.ghost.userData.edgeMat;
  if (fill) fill.color.setHex(reason ? 0xff5544 : 0x35d5ff);
  if (edge) edge.color.setHex(reason ? 0xff8877 : 0x9be8ff);
}

function animateFrameGhostOut(ghost) {
  const fill = ghost.userData.fillMat;
  const edge = ghost.userData.edgeMat;
  const fillOpacity = fill?.opacity ?? 0.2;
  const edgeOpacity = edge?.opacity ?? 0.85;
  const start = performance.now();
  const duration = 320;
  const tick = now => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - progress) ** 3;
    ghost.scale.setScalar(1 - eased * 0.06);
    if (fill) fill.opacity = fillOpacity * (1 - eased);
    if (edge) edge.opacity = edgeOpacity * (1 - eased);
    if (progress < 1) requestAnimationFrame(tick);
    else {
      scene.remove(ghost);
      disposeGroup(ghost);
    }
  };
  requestAnimationFrame(tick);
}

function confirmFramePlacement() {
  if (!framePlacement) return;
  const { creates, ghost, pos, rot, frameData, floors, profileName } = framePlacement;
  updateFrameObstruction();
  if (framePlacement.obstructed) return flash(`Cannot place the frame: it is obstructed by ${framePlacement.obstructed}.`);
  pushUndo();
  for (const c of creates) {
    const local = new THREE.Vector3(c.pos[0], c.pos[1], c.pos[2]).applyQuaternion(rot);
    const memberQ = rot.clone().multiply(quatOf(c.rot));
    const eu = new THREE.Euler().setFromQuaternion(memberQ, 'XYZ');
    makeBlock({ mat: c.mat, size: c.size,
      pos: [local.x + pos.x, local.y + pos.y, local.z + pos.z],
      rot: [eu.x / DEG, eu.y / DEG, eu.z / DEG],
      foundation: c.foundation, frame: c.frame }, true);
  }
  const cleared = clearPropsNear(pos.x, pos.z, frameData.footprint / 2 + 1.5);
  scene.remove(ghost);
  disposeGroup(ghost);
  framePlacement = null;
  ghostDrag = null;
  dom.style.cursor = 'default';
  S.sel = null;
  S.selected.clear();
  lastFrameReport = null;
  lastFrameReports = [];
  changed();
  analyze();
  renderProps();
  updateMode();
  flash(`Placed a ${floors}-story ${profileName} reinforced-concrete frame.${cleared ? ` Cleared ${cleared} scenery item${cleared === 1 ? '' : 's'} from the footprint.` : ''}`);
}
function cancelFramePlacement() {
  if (!framePlacement) return;
  const ghost = framePlacement.ghost;
  framePlacement = null;
  ghostDrag = null;
  animateFrameGhostOut(ghost);
  dom.style.cursor = 'default';
  updateMode();
  flash('Frame placement cancelled.');
}

function invalidateFrameModel(affected = blocks.filter(block => block.frame)) {
  const affectedAssemblies = new Set(affected.filter(block => block.frame).map(block =>
    block.frame.model === 'rc-frame'
      ? `rc-frame:${block.frame.assemblyId || 'legacy-frame'}`
      : block.frame.model));
  for (const block of blocks) {
    if (!block.frame) continue;
    const key = block.frame.model === 'rc-frame'
      ? `rc-frame:${block.frame.assemblyId || 'legacy-frame'}`
      : block.frame.model;
    if (affectedAssemblies.has(key)) block.frame = null;
  }
  lastFrameReport = null;
  lastFrameReports = [];
}

function deleteSel() {
  if (S.edit) return flash('Delete is for blocks. Leave edit mode (Tab) first.');
  if (S.sim || !S.sel) return;
  pushUndo();
  const targets = [...S.selected].filter(block => block.alive);
  if (targets.some(block => block.frame)) invalidateFrameModel(targets);
  for (const block of targets.length ? targets : [S.sel]) removeBlock(block, true);
  changed();
  renderProps();
}
function duplicateSel() {
  if (S.edit || S.sim || !S.sel) return;
  const originals = [...S.selected].filter(block => block.alive);
  if (!originals.includes(S.sel)) originals.push(S.sel);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  right.y = 0;
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  const rightAxis = Math.abs(right.x) >= Math.abs(right.z) ? 0 : 2;
  const rightSign = Math.sign(rightAxis === 0 ? right.x : right.z) || 1;
  const sideAxis = rightAxis === 0 ? 2 : 0;
  const world = originals.flatMap(block => shapeWorld(block));
  const ranges = [0, 1, 2].map(axis => {
    const values = world.map(point => point.getComponent(axis));
    return [Math.min(...values), Math.max(...values)];
  });
  const directionOrder = [
    [rightAxis, rightSign], [sideAxis, -rightSign],
    [sideAxis, rightSign], [rightAxis, -rightSign]
  ];
  const maxSpacingSteps = originals.length > 1 ? 24 : 0;
  for (let spacingStep = 0; spacingStep <= maxSpacingSteps; spacingStep++) {
    for (const [axis, sign] of directionOrder) {
      const extent = ranges[axis][1] - ranges[axis][0];
      const grid = Number.isFinite(S.grid) && S.grid > 0 ? S.grid : 1;
      const delta = [0, 0, 0];
      delta[axis] = sign * (extent + spacingStep * grid);
      const creates = originals.map(block => ({
        mat: block.mat,
        verts: block.verts.map(point => [...point]),
        pos: block.pos.map((value, coordinateAxis) => value + delta[coordinateAxis]),
        rot: [...block.rot],
        foundation: block.foundation,
        shearKey: block.shearKey,
        suggestedBearing: block.suggestedBearing,
        suggestionConnection: block.suggestionConnection,
        learnedRetrofitRiskRatio: 0,
        shearLinks: block.shearLinks ? { ...block.shearLinks } : null,
        frame: copyFrameMetadata(block.frame),
        ties: []
      }));
      if (!planFree({ creates })) continue;

      const ids = new Map(originals.map((block, index) => [block.id, nextId + index]));
      const assemblies = new Map();
      for (const create of creates) {
        if (create.frame?.model === 'rc-frame') {
          const sourceAssembly = create.frame.assemblyId || 'legacy-frame';
          if (!assemblies.has(sourceAssembly)) {
            assemblies.set(sourceAssembly, `rc-frame-${nextFrameId++}`);
          }
          create.frame.assemblyId = assemblies.get(sourceAssembly);
        }
        if (Array.isArray(create.frame?.anchorBlockIds)) {
          create.frame.anchorBlockIds = create.frame.anchorBlockIds
            .map(id => ids.get(id) ?? null);
        }
      }
      originals.forEach((block, index) => {
        creates[index].id = ids.get(block.id);
        creates[index].ties = block.ties
          .filter(tie => ids.has(tie.to))
          .map(tie => ({ ...tie, to: ids.get(tie.to) }));
      });
      pushUndo();
      const copies = creates.map(create => makeBlock(create, true));
      S.selected = new Set(copies);
      S.sel = copies.at(-1);
      changed();
      renderProps();
      flash(`Duplicated ${copies.length} selected object${copies.length === 1 ? '' : 's'}.`);
      return;
    }
  }
  flash(`No room to duplicate all ${originals.length} selected object${originals.length === 1 ? '' : 's'} nearby, even after spacing the copy outward.`);
}

/* ================= panels ================= */
function buildMaterialList() {
  byId('mats').innerHTML = Object.entries(MATS).map(([k, m]) => `
    <button class="mat ${blockPlacement?.materialKey === k ? 'placing' : ''}" data-mat="${k}"> 
      <span><span class="sw" style="background:#${m.color.toString(16).padStart(6, '0')}"></span>${m.name}</span> 
      <small>Density ${m.rho} kg/m^3 | E ${(m.E / 1e9).toFixed(0)} GPa | strength ${(m.strength / 1e6).toFixed(0)} MPa</small> 
    </button>`).join('');
}
function magnitudeToPGA(magnitude) {
  // Approximate relationship: log10(PGA) = -2.5 + 0.3*M for Mw 4-9
  // This gives PGA ~0.003g at M4, ~0.03g at M6, ~0.3g at M8, ~1g at M9
  // Returns PGA in g units
  if (magnitude <= 0) return 0;
  return Math.pow(10, -2.5 + 0.3 * magnitude);
}
function updateQuakeInfo() {
  const q = QUAKES[S.quake];
  if (!q) {
    byId('quakeInfo').textContent = 'Gravity only. The ground stays still.';
    return;
  }
  const peaks = groundPeaks(q);
  byId('quakeInfo').innerHTML = `
    <div>M${q.mag.toFixed(1)} preset; estimated PGA ${magnitudeToPGA(q.mag).toFixed(3)} g. Recorded El Centro motion scaled ${q.scale.toFixed(2)}x; peaks ${peaks.x.toFixed(2)} g X and ${peaks.z.toFixed(2)} g Z (${peaks.resultant.toFixed(2)} g resultant), ${q.dur.toFixed(1)} s.</div>
    <canvas id="quakeMotionPlot" class="quake-motion" role="img"
      aria-label="Recorded north-south and east-west ground acceleration over time. The vertical cursor follows simulation time."></canvas>
    <div id="quakeMotionReadout" class="quake-motion-readout muted" aria-live="polite"></div>
    <div class="muted" style="font-size:10px">Recorded horizontal acceleration; the cursor follows the simulation. This is uniform base input, not a traveling-wave or site-response model. The optional 3D wave animation is illustrative only and does not affect the simulation. Adapted wave-display code: <a href="/LICENSE.QuakeLab" target="_blank" rel="noreferrer">QuakeLab MIT attribution</a>.</div>`;
  renderQuakeMotion();
}
function renderQuakeMotion() {
  const canvas = byId('quakeMotionPlot');
  const q = QUAKES[S.quake];
  if (!canvas || !q) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height;
  const motion = quakeMotion(q);
  const duration = motion.count * motion.dt;
  const left = 28, right = 42, top = 14, bottom = 17;
  const plotRight = w - right, plotBottom = h - bottom;
  const plotWidth = plotRight - left, plotHeight = plotBottom - top;
  if (plotWidth <= 0 || plotHeight <= 0) return;
  const peak = Math.max(motion.peakX, motion.peakZ) / G || 1;
  const halfHeight = plotHeight * 0.43;

  ctx.clearRect(0, 0, w, h);
  ctx.font = '9px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(148,163,184,0.22)';
  ctx.fillStyle = '#97a4b6';
  for (let i = 0; i <= 4; i++) {
    const x = left + plotWidth * i / 4;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    ctx.fillText(`${(duration * i / 4).toFixed(0)}${uiLanguage === 'ar' ? ' ث' : 's'}`, x, h - 7);
  }
  for (const fraction of [-1, 0, 1]) {
    const y = top + plotHeight / 2 - fraction * halfHeight;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(plotRight, y);
    ctx.strokeStyle = fraction === 0 ? 'rgba(148,163,184,0.38)' : 'rgba(148,163,184,0.16)';
    ctx.stroke();
    if (fraction) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#97a4b6';
      ctx.fillText(`${fraction > 0 ? '+' : '-'}${peak.toFixed(1)}`, left - 4, y);
    }
  }
  const traces = [
    { values: motion.ax, color: '#5aa4ff', label: uiLanguage === 'ar' ? 'ش-ج / X' : 'N-S / X' },
    { values: motion.az, color: '#e0a747', label: uiLanguage === 'ar' ? 'غ-ش / Z' : 'E-W / Z' }
  ];
  traces.forEach((trace, traceIndex) => {
    ctx.beginPath();
    for (let i = 0; i <= motion.count; i++) {
      const x = left + plotWidth * i / motion.count;
      const y = top + plotHeight / 2 - (trace.values[i] / G / peak) * halfHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = trace.color;
    ctx.lineWidth = 1.15;
    ctx.stroke();
    ctx.fillStyle = trace.color;
    ctx.textAlign = 'left';
    ctx.fillText(trace.label, plotRight + 5, top + 8 + traceIndex * 13);
  });

  const time = Math.max(0, Math.min(duration, S.sim ? S.t : 0));
  const cursorX = left + plotWidth * time / duration;
  ctx.beginPath();
  ctx.moveTo(cursorX, top);
  ctx.lineTo(cursorX, plotBottom);
  ctx.strokeStyle = '#f25f67';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const ax = groundA(time, q, 'x') / G, az = groundA(time, q, 'z') / G;
  const readout = byId('quakeMotionReadout');
  if (readout) readout.textContent =
    `t ${time.toFixed(2)} s | aX ${ax.toFixed(3)} g, aZ ${az.toFixed(3)} g | ground offset X ${groundDispX.toFixed(3)} m, Z ${groundDispZ.toFixed(3)} m`;
}
function updateEarthquakeWaveVisualization() {
  const caption = byId('quakeWaveCaption');
  const q = QUAKES[S.quake];
  const active = S.sim && S.waveView && !!q;
  quakeWaveGroup.visible = active;
  if (caption) caption.hidden = !active;
  if (!active) {
    for (const band of quakeWaveBands) band.line.visible = false;
    for (const label of quakeWaveLabels) {
      label.sprite.visible = false;
      label.sprite.material.opacity = 0;
    }
    return;
  }

  const sourceOffset = quakeWaveHalfDiag + 42;
  const clearDist = quakeWaveHalfDiag + 3.2;
  const mainY = 2.2;
  const groundY = 0.04;
  const magnitude = Math.hypot(groundA(S.t, q, 'x'), groundA(S.t, q, 'z')) / G;
  const activity = Math.min(1.4, Math.max(0.22, magnitude / Math.max(groundPeaks(q).resultant, 0.08)));
  const phase = S.t * 7.8;
  const origin = quakeWaveDirection.clone().multiplyScalar(-sourceOffset);
  origin.y = mainY;
  const arrowLength = Math.max(9.5, sourceOffset - clearDist);
  quakeWaveArrow.position.copy(origin);
  quakeWaveArrow.setLength(
    arrowLength,
    Math.min(2.5, arrowLength * 0.22),
    Math.min(1.3, arrowLength * 0.11)
  );

  const mainLength = sourceOffset - clearDist;
  for (let i = 0; i < quakeWaveMainSamples; i++) {
    const fraction = i / (quakeWaveMainSamples - 1);
    const along = -sourceOffset + mainLength * fraction;
    const base = quakeWaveDirection.clone().multiplyScalar(along);
    const envelope = 1 - 0.16 * fraction;
    const amplitude = (0.24 + 0.50 * activity) * envelope;
    const oscillation = Math.sin(fraction * Math.PI * 10 - phase);
    const sway = Math.sin(fraction * Math.PI * 4.8 - phase * 0.66);
    const point = base
      .addScaledVector(quakeWaveSide, amplitude * oscillation)
      .addScaledVector(quakeWaveDirection, 0.12 * amplitude * sway);
    point.y = mainY + 0.20 * amplitude * sway;
    quakeWaveMainPositions[i * 3] = point.x;
    quakeWaveMainPositions[i * 3 + 1] = point.y;
    quakeWaveMainPositions[i * 3 + 2] = point.z;
  }
  quakeWaveMainGeometry.attributes.position.needsUpdate = true;

  const bandSpan = GROUND_HALF * 1.5;
  const gridExtent = GROUND_HALF;
  const travelLength = sourceOffset + gridExtent;
  const labelTargets = new Map();
  for (const band of quakeWaveBands) {
    const speed = band.waveName === 'P' ? 10.4 : band.waveName === 'S' ? 7.0
      : band.waveName === 'Rayleigh' ? 5.4 : 4.8;
    const frequency = band.waveName === 'P' ? 10.6 : band.waveName === 'S' ? 7.2
      : band.waveName === 'Rayleigh' ? 5.8 : 5.0;
    const baseAmplitude = (band.waveName === 'P' ? 0.10 : band.waveName === 'S' ? 0.16 : 0.13) *
      (0.55 + 0.95 * activity);
    const offset = band.index * 3.2 + (band.isP ? 0 : 1.4);
    const distance = (S.t * speed + offset) % travelLength;
    const along = -sourceOffset + distance;
    band.line.visible = along < gridExtent;
    if (!band.line.visible) continue;

    const fadeIn = Math.min(1, Math.max(0, (along + sourceOffset) / 6));
    const fadeOut = Math.min(1, Math.max(0, (gridExtent - along) / 12));
    const distanceToBuilding = Math.abs(along + clearDist);
    const buildingDip = distanceToBuilding < 4
      ? 0.5 + 0.5 * distanceToBuilding / 4
      : 1;
    band.line.material.opacity = (band.isP ? 0.86 : 0.72) * fadeIn * fadeOut * buildingDip;

    const arrival = Math.abs(along + clearDist);
    const labelAlong = Math.min(along, -clearDist + 2);
    const labelCenter = quakeWaveDirection.clone().multiplyScalar(labelAlong);
    const previous = labelTargets.get(band.waveName);
    const score = arrival + band.index * 0.04;
    if (!previous || score < previous.score) {
      labelTargets.set(band.waveName, {
        score,
        opacity: band.line.material.opacity,
        x: labelCenter.x,
        z: labelCenter.z,
        bob: 0.04 * Math.sin(phase * 1.1 + band.index * 0.75)
      });
    }

    const pastBuilding = along > -clearDist + 1;
    const attenuation = pastBuilding
      ? Math.min(1, Math.max(0.20, 1 - (along + clearDist) / 50))
      : 1;
    const amplitude = baseAmplitude * attenuation;
    const center = quakeWaveDirection.clone().multiplyScalar(along);
    for (let i = 0; i < band.samples; i++) {
      const fraction = i / (band.samples - 1);
      const across = fraction * 2 - 1;
      const base = center.clone().addScaledVector(quakeWaveSide, across * bandSpan);
      const wavePhase = phase * (band.isP ? 2.25 : 1.55) - band.index * 0.82;
      const ripple = Math.sin(across * Math.PI * frequency - wavePhase);
      const ripple2 = Math.sin(across * Math.PI * 3.1 - wavePhase * 0.62);
      const point = base.addScaledVector(quakeWaveDirection, 0.12 * amplitude * ripple2);
      point.y = groundY + amplitude * ripple;
      band.positions[i * 3] = point.x;
      band.positions[i * 3 + 1] = point.y;
      band.positions[i * 3 + 2] = point.z;
    }
    band.line.geometry.attributes.position.needsUpdate = true;
  }

  for (const label of quakeWaveLabels) {
    const target = labelTargets.get(label.waveName);
    label.sprite.visible = !!target;
    if (!target) {
      label.sprite.material.opacity = 0;
      continue;
    }
    const lateral = (label.index - (quakeWaveLabels.length - 1) * 0.5) * 0.32;
    label.sprite.position.set(
      target.x + quakeWaveSide.x * lateral,
      groundY + 0.26 + target.bob,
      target.z + quakeWaveSide.z * lateral
    );
    label.sprite.material.opacity = Math.min(
      0.92,
      Math.max(0.25, target.opacity * (0.90 + 0.10 * Math.sin(phase + label.index)))
    );
  }
}
function renderProps() {
  const el = byId('props');
  updateShearLinkControl();
  if (S.edit) {
    const b = S.edit;
    el.innerHTML = `
      <div class="stat"><span>Editing</span><b>Block #${b.id}</b></div> 
      <div class="stat"><span>Vertices selected</span><b>${S.vsel.size} / 8</b></div> 
      <div class="muted" style="font-size:12px;margin-top:4px">Vertices can move anywhere that keeps the block convex and clear of other blocks. Press Tab to finish.</div> 
      <div id="readout" style="margin-top:8px"></div>`;
    readout();
    return;
  }
  const b = S.sel;
  if (!b || !b.alive) { el.innerHTML = '<div class="muted">Click a block to inspect it. Press Tab to edit its vertices.</div>'; return; }
  const selectedCount = [...S.selected].filter(block => block.alive).length;
  if (selectedCount > 1) {
    el.innerHTML = `<div class="stat"><span>Selected blocks</span><b>${selectedCount}</b></div> 
      <div class="muted" style="font-size:12px">Ctrl+click toggles blocks. Alt+click selects the connected structure. Move and scale gizmos act on the whole selection along the chosen world axis. Delete removes all selected blocks.</div>`;
    return;
  }
  const row = (lbl, k, arr, step) => `
    <div class="lbl">${lbl}</div> 
    <div class="v3">${arr.map((x, i) => `<input type="number" step="${step}" data-k="${k}" data-i="${i}" value="${round(x)}">`).join('')}</div>`;
  el.innerHTML = `
    <div class="lbl">Material</div> 
    <select data-k="mat" style="width:100%">${Object.entries(MATS).map(([k, m]) => `<option value="${k}" ${k === b.mat ? 'selected' : ''}>${m.name}</option>`).join('')}</select> 
    ${b.shearLinks ? `<div class="stat"><span>Steel shear links</span><b>${Math.round(b.shearLinks.diameter * 1000)} mm</b></div>
    <div class="stat"><span>Midspan / end-zone spacing</span><b>${Math.round(b.shearLinks.spacing * 1000)} / ${Math.round(b.shearLinks.endSpacing * 1000)} mm</b></div>
    <div class="row"><button data-act="remove-shear-links" class="grow">Remove shear links</button></div>` : ''}
    ${row('Location X Y Z (m)', 'pos', b.pos, 0.05)}
    ${row('Rotation X Y Z (degrees)', 'rot', b.rot, 1)}
    ${row('Size W H D (m)', 'size', b.size, 0.05)}
    <div class="row" style="margin-top:8px"><button data-act="edit" class="grow">Edit vertices (Tab)</button></div> 
    <div class="row" style="margin-top:6px"><button data-act="dup" class="grow">Duplicate</button><button data-act="del" class="danger grow">Delete</button></div> 
    <div id="readout" style="margin-top:8px"></div>`;
  readout();
}
function readout() {
  const r = byId('readout'), b = S.edit || S.sel;
  if (!r || !b || (!S.edit && !b.alive)) return;
  if (S.edit) { r.innerHTML = `<div class="stat"><span>Mass</span><b>${b.mass.toFixed(1)} kg</b></div>`; return; }
  const m = MATS[b.mat];
  const names = {
    nail: 'nails', weld: 'welds', mortar: 'mortar', cast: 'cast bond',
    reinforced: 'reinforced connection'
  };
  const partners = joints.filter(j => j.a === b || j.b === b).map(j => {
    const other = j.a === b ? j.b : j.a;
    return `<div class="stat"><span>#${other.id} | ${names[j.kind]}</span> 
      <b style="color:${j.holds ? 'var(--ok)' : 'var(--bad)'}">${j.holds ? 'holds' : 'too weak'} | ${(j.cap / 1000).toFixed(0)} kN${j.hingeReinforcementFactor > 1 ? ` (${j.hingeReinforcementFactor.toFixed(2)}x confined-end modifier)` : ''}</b></div>`;
  }).join('');
  const seis = b.seismic ? `<h3>Earthquake (ground-connected group)</h3> 
    <div class="stat"><span>Overturn limit</span><b>${(b.seismic.aTip / G).toFixed(2)} g</b></div> 
    <div class="stat"><span>Slide limit</span><b>${(b.seismic.aSlide / G).toFixed(2)} g</b></div> 
    <div class="stat"><span>Quake</span><b>${b.seismic.PGA.toFixed(2)} g</b></div>` : '';
  const shearReinforcement = b.shearLinks ? (() => {
    const effects = shearLinkEffects(b);
    return `<div class="stat"><span>Shear-link capacity (estimate)</span><b>${(effects.shearCapacity / 1000).toFixed(1)} kN</b></div>
    <div class="stat"><span>Confined strength / ductility modifier</span><b>${effects.confinedStrengthFactor.toFixed(2)}x / ${effects.ductilityFactor.toFixed(2)}x</b></div>
    ${S.sim ? `<div class="stat"><span>Shear utilization</span><b>${(b.shearRatio || 0).toFixed(2)}x</b></div>` : ''}`;
  })() : '';
  const memberState = b.broken ? 'Fractured' : b.yielded ? 'Yielded - hardening response' : S.sim ? 'Elastic (screening)' : 'Not simulated';
  r.innerHTML = `
    <div class="stat"><span>Mass</span><b>${b.mass.toFixed(1)} kg</b></div> 
    <div class="stat"><span>Load through section</span><b>${(b.load / 1000).toFixed(2)} kN</b></div> 
    <div class="stat"><span>Stress</span><b>${(b.stress / 1e6).toFixed(3)} MPa</b></div> 
    ${S.sim ? `<div class="stat"><span>Flexural stress (estimate)</span><b>${(b.flexStress / 1e6).toFixed(3)} MPa</b></div>
    <div class="stat"><span>Failure mode</span><b>${b.failureMode || '-'}</b></div>` : ''}
    ${shearReinforcement}
    <div class="stat"><span>Simulation state</span><b>${memberState}</b></div> 
    ${S.sim && b.plasticStrain > 0 ? `<div class="stat"><span>Plastic strain (approx.)</span><b>${(b.plasticStrain * 100).toFixed(3)}%</b></div>` : ''}
    ${S.sim && b.frameAxialForce > 0 ? `<div class="stat"><span>Brace axial force (estimate)</span><b>${(b.frameAxialForce / 1000).toFixed(2)} kN</b></div>` : ''}
    <div class="stat"><span>Strength</span><b>${(m.strength / 1e6).toFixed(0)} MPa</b></div> 
    <div class="stat"><span>Factor of safety</span><b style="color:${fosColor(b.fos)}">${isFinite(b.fos) ? b.fos.toFixed(2) : 'infinite'}</b></div> 
    <h3>Fastened to</h3> 
    ${partners || '<div class="muted" style="font-size:12px">Nothing. Touch a block of a joinable material to fasten it.</div>'}
    ${seis}`;
}
function hud() {
  const alive = blocks.filter(b => b.alive);
  const mass = alive.reduce((s, b) => s + b.mass, 0);
  const low = Math.min(...alive.map(b => b.fos));
  const nHold = joints.filter(j => j.holds).length;
  byId('stats').innerHTML = `
    <div class="stat"><span>Blocks</span><b>${alive.length}</b></div> 
    <div class="stat"><span>Total mass</span><b>${(mass / 1000).toFixed(2)} t</b></div> 
    <div class="stat"><span>Joints holding / total</span><b>${nHold} / ${joints.length}</b></div> 
    <div class="stat"><span>Lowest FoS</span><b style="color:${fosColor(low)}">${isFinite(low) ? low.toFixed(2) : '-'}</b></div> 
    <div class="stat"><span>Mode</span><b>${S.sim ? 'Simulating' : S.edit ? 'Edit vertices' : 'Build'}</b></div> 
    ${S.sim ? `<div class="stat"><span>Sim time</span><b>${S.t.toFixed(2)} s</b></div>` : ''}`;
  readout();
}
function flash(msg) {
  lastUiMessage = msg;
  byId('msg').textContent = translateText(msg, uiLanguage);
}

/* ================= paint ================= */
function paint(b) {
  const mat = b.mesh.material;
  const m = MATS[b.mat];
  const confinementFactor = b.shearLinks ? shearLinkCapacityFactor(b) : 1;
  const util = Math.max(
    b.stress / (m.strength * confinementFactor),
    m.fb > 0 ? b.flexStress / m.fb : 0,
    b.shearRatio || 0,
    S.sim ? (b.breakRatio || 0) : 0
  );
  const stressColor = S.stressView
    ? Math.round(Math.min(1, Math.max(0, util)) * 100)
    : -1;
  const color = b.yielded && !S.stressView ? 0xff8c1a : stressColor >= 0
    ? `stress-${stressColor}` : MATS[b.mat].color;
  const emissive = S.selected.has(b) && !S.edit ? 0x2a4a78
    : b === S.hoverB ? 0x1d3a5c : 0x000000;
  const key = `${color}:${stressColor}:${emissive}`;
  if (b.paintKey === key) return;
  b.paintKey = key;
  if (b.yielded && !S.stressView) mat.color.setHex(0xff8c1a);
  else if (S.stressView) {
    mat.color.setHSL(0.33 * (1 - stressColor / 100), 0.85, 0.5);
  } else mat.color.setHex(materialPbrMaps.get(b.mat)?.map ? 0xffffff : MATS[b.mat].color);
  mat.emissive.setHex(emissive);
}

/* ================= input ================= */
const keys = /** @type {Record<string, boolean>} */ ({});
const isTyping = e => ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);

addEventListener('keydown', e => {
  if (isTyping(e) || !S.name) return;
  const k = e.key;

  if (blockPlacement) {
    if (k === '1' || k === '2' || k === '3') {
      e.preventDefault();
      cancelBlockPlacement();
      setGizmoMode({ '1': 'move', '2': 'rotate', '3': 'scale' }[k]);
      return;
    }
    if (k === 'Escape') { e.preventDefault(); cancelBlockPlacement(); return; }
    if (e.ctrlKey && e.code === 'KeyZ') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
      keys[e.code] = true;
    }
    e.preventDefault();
    return;
  }
  if (framePlacement) {
    if (k === 'Enter') { e.preventDefault(); confirmFramePlacement(); return; }
    if (k === 'g' || k === 'G') { e.preventDefault(); toggleGhostGizmo(); return; }
    if (k === 'Escape') { e.preventDefault(); cancelFramePlacement(); return; }
    if (k === '1' || k === '2' || k === '3') {
      e.preventDefault();
      if (framePlacement.gizmoMode) {
        if (k === '3') flash('Scale is not available for the frame preview.');
        else {
          framePlacement.gizmoTool = k === '1' ? 'move' : 'rotate';
          updateMode();
        }
      }
      return;
    }
    keys[e.code] = !(e.shiftKey && e.code === 'KeyD');
    e.preventDefault();
    return;
  }
  if (T) {
    if (T.gizmo) { if (k === 'Escape') cancelT(); return; }
    if (/^[0-9.]$/.test(k)) T.num += k;
    else if (k === '-') T.num = T.num.startsWith('-') ? T.num.slice(1) : '-' + T.num;
    else if (k === 'Backspace') T.num = T.num.slice(0, -1);
    else if (k === 'Enter') { e.preventDefault(); confirmT(); return; }
    else if (k === 'Escape') { e.preventDefault(); cancelT(); return; }
    else if (/^[xyzXYZ]$/.test(k)) { const a = k.toLowerCase(); T.axis = T.axis === a ? null : a; }
    else return;
    e.preventDefault();
    if (T) applyT();
    return;
  }

  if (e.code === 'NumpadDecimal' || (k === '.' && !e.shiftKey && !T)) {
    e.preventDefault();
    if (e.code === 'NumpadDecimal') {
      focusCameraOnSelection();
    } else {
      // Period key toggles orbit target between scene center and selected object
      toggleOrbitTarget();
    }
    return;
  }
  keys[e.code] = !(e.shiftKey && e.code === 'KeyD');
  if (e.code === 'Tab') { e.preventDefault(); S.edit ? exitEdit() : enterEdit(); return; }
  if (k === ' ') { e.preventDefault(); if (!S.sim) autoStabilize(); return; }
  if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (e.shiftKey && e.code === 'KeyD') { e.preventDefault(); duplicateSel(); return; }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSel(); return; }
  if (k === 'Escape') {
    if (S.edit && S.vsel.size) { S.vsel = new Set(); updateHandles(); renderProps(); }
    else { S.sel = null; S.selected.clear(); renderProps(); }
    return;
  }
  if (e.code === 'KeyA' && S.edit) { S.vsel = new Set([0, 1, 2, 3, 4, 5, 6, 7]); updateHandles(); renderProps(); return; }
  if (!S.edit && (k === '1' || k === '2' || k === '3')) { setGizmoMode({ '1': 'move', '2': 'rotate', '3': 'scale' }[k]); return; }
  if (e.code === 'KeyG' && S.edit) {
    e.preventDefault();
    startT('GV');
    return;
  }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
document.addEventListener('click', e => { const b = e.target.closest('button'); if (b) b.blur(); });

let look = false, lastX = 0, lastY = 0, downX = 0, downY = 0, moved = false;
dom.addEventListener('contextmenu', e => e.preventDefault());
dom.addEventListener('pointerdown', e => {
  downX = lastX = e.clientX;
  downY = lastY = e.clientY;
  moved = false;
  if (e.button === 2 || e.button === 1) look = true;
  dom.setPointerCapture(e.pointerId);
  if (e.button === 0 && !blockPlacement && !T && !S.sim && !S.braceMode && !S.infillMode && (!framePlacement || framePlacement.gizmoMode)) {
    const g = pickGizmo(e);
    if (g && g.userData.kind) {
      if (framePlacement) startGhostDrag(g, e);
      else startGizmoDrag(g, e);
    }
  }
});
dom.addEventListener('pointermove', e => {
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) moved = true;
  if (look) {
    const orbitCenter = getOrbitCenter();
    if (S.orbitTarget && !orbitCenter.equals(new THREE.Vector3(0, 0, 0))) {
      // Orbit around the selection center
      const dist = camera.position.distanceTo(orbitCenter);
      const forward = new THREE.Vector3().subVectors(orbitCenter, camera.position).normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      // Apply rotation around orbit center
      const angleY = -dx * 0.003;
      const angleX = -dy * 0.003;
      // Yaw rotation (around world up)
      const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
      const newRight = new THREE.Vector3(
        right.x * cosY + forward.x * sinY,
        right.y * cosY + forward.y * sinY,
        right.z * cosY + forward.z * sinY
      ).normalize();
      const newForward = new THREE.Vector3(
        forward.x * cosY - right.x * sinY,
        forward.y * cosY - right.y * sinY,
        forward.z * cosY - right.z * sinY
      ).normalize();
      // Pitch rotation (around right axis)
      const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
      const clampedForward = new THREE.Vector3(
        newForward.x * cosX + up.x * sinX,
        newForward.y * cosX + up.y * sinX,
        newForward.z * cosX + up.z * sinX
      ).normalize();
      camera.position.copy(orbitCenter).addScaledVector(clampedForward, -dist);
      camera.position.y += Math.max(-1.55, Math.min(1.55, camera.position.y - orbitCenter.y + orbitCenter.y));
      camera.lookAt(orbitCenter);
    } else {
      camera.rotation.y -= dx * 0.003;
      camera.rotation.x = Math.max(-1.55, Math.min(1.55, camera.rotation.x - dy * 0.003));
    }
    if (blockPlacement) updateBlockPlacement(e);
    return;
  }
  if (ghostDrag) { updateGhostDrag(e); return; }
  if (blockPlacement) { scheduleBlockPlacementUpdate(e); return; }
  if (framePlacement) {
    if (framePlacement.gizmoMode) {
      if (e.buttons === 0) {
        const g = pickGizmo(e);
        S.hoverH = g && g.userData.hid !== undefined ? g.userData.hid : -1;
        handles.forEach((h, i) => { h.hover = i === S.hoverH; });
        paintGizmoHandles();
        dom.style.cursor = S.hoverH >= 0 ? 'pointer' : 'default';
      }
      return;
    }
    updateFramePlacement(e);
    return;
  }
  if (T) {
    if (T.gizmo) { updateGizmoDrag(e); return; }
    if (T.kind === 'G' || T.kind === 'GV') { T.acc.x += dx * 0.02; T.acc.y += dy * 0.02; }
    else if (T.kind === 'R') T.acc.x += dx * 0.5;
    else T.acc.x += dx;
    scheduleLiveTransform();
    return;
  }
  // Hover highlights: gizmo handles, vertices, and blocks.
  if (e.buttons === 0 && !S.sim) {
    if (S.braceMode) {
      hoverBraceBay(e);
      S.hoverB = null;
      dom.style.cursor = activeBraceBay?.occupied ? 'not-allowed' : 'crosshair';
    } else if (S.infillMode) {
      hoverInfillBay(e);
      S.hoverB = null;
      dom.style.cursor = activeInfillBay?.occupied ? 'not-allowed' : 'crosshair';
      return;
    }
    const g = pickGizmo(e);
    S.hoverH = g && g.userData.hid !== undefined ? g.userData.hid : -1;
    if (S.edit) {
      const hv = rayFrom(e).intersectObjects(vHandles, false)[0];
      const nv = hv ? hv.object.userData.vi : -1;
      if (nv !== S.hoverV) { S.hoverV = nv; updateHandles(); }
      S.hoverB = null;
    } else {
      S.hoverB = S.hoverH < 0 ? pickBlock(e) : null;
    }
    handles.forEach((h, i) => { h.hover = i === S.hoverH; });
    paintGizmoHandles();
    dom.style.cursor = S.hoverH >= 0 || S.hoverV >= 0 ? 'pointer' : (S.hoverB ? 'pointer' : 'default');
  }
});
dom.addEventListener('pointerleave', () => {
  if (T) return;
  if (S.braceMode) hoverBraceBay({ clientX: -1e6, clientY: -1e6 });
  if (S.infillMode) hoverInfillBay({ clientX: -1e6, clientY: -1e6 });
  S.hoverH = S.hoverV = -1;
  S.hoverB = null;
  handles.forEach(h => { h.hover = false; });
  paintGizmoHandles();
  if (S.edit) updateHandles();
  dom.style.cursor = blockPlacement ? 'crosshair' : 'default';
});
dom.addEventListener('pointerup', e => {
  if (look) { look = false; return; }
  if (ghostDrag) { ghostDrag = null; return; }
  if (blockPlacement && e.button === 0 && !moved) {
    updateBlockPlacement(e);
    return placeBlockPreview();
  }
  if (framePlacement && e.button === 2 && !moved) return cancelFramePlacement();
  if (S.braceMode && e.button === 0 && !moved && !T) return placeBraceInBay(activeBraceBay);
  if (S.infillMode && e.button === 0 && !moved && !T) return placeInfillInBay(activeInfillBay);
  if (T && T.gizmo && e.button === 0) { applyT(true); return confirmT(); }
  if (T && e.button === 2 && !moved) return cancelT();
  if (T && e.button === 0 && !moved) { applyT(true); return confirmT(); }
  if (e.button === 0 && !moved && !T && !framePlacement && !blockPlacement) {
    if (S.edit) editClick(e);
    else select(pickBlock(e), e);
  }
});
dom.addEventListener('wheel', e => {
  e.preventDefault();
  S.speed = Math.max(0.5, Math.min(60, S.speed * (e.deltaY < 0 ? 1.15 : 0.87)));
  byId('speedTxt').textContent = S.speed.toFixed(1) + ' m/s';
}, { passive: false });
function blocksTouch(a, b) {
  // Check if two blocks' AABBs touch or overlap
  const halfA = [a.size[0] / 2, a.size[1] / 2, a.size[2] / 2];
  const halfB = [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2];
  for (let i = 0; i < 3; i++) {
    const dist = Math.abs(a.pos[i] - b.pos[i]);
    if (dist > halfA[i] + halfB[i] + 0.01) return false;
  }
  return true;
}
function connectedSelection(start) {
  const found = new Set([start]), queue = [start];
  const alive = blocks.filter(b => b.alive);
  while (queue.length) {
    const current = queue.pop();
    // Follow fastener joints
    for (const joint of joints) {
      if (!joint.holds) continue;
      const neighbor = joint.a === current ? joint.b : joint.b === current ? joint.a : null;
      if (neighbor?.alive && !found.has(neighbor)) {
        found.add(neighbor);
        queue.push(neighbor);
      }
    }
    // Also include blocks that physically touch
    for (const b of alive) {
      if (!found.has(b) && blocksTouch(current, b)) {
        found.add(b);
        queue.push(b);
      }
    }
  }
  return found;
}
function select(b, event = {}) {
  if (S.edit && b !== S.edit) return;
  if (!b) {
    if (!event.ctrlKey && !event.altKey) {
      S.sel = null;
      S.selected.clear();
    }
  } else if (event.altKey) {
    S.selected = connectedSelection(b);
    S.sel = b;
  } else if (event.ctrlKey) {
    if (S.selected.has(b)) S.selected.delete(b);
    else S.selected.add(b);
    S.sel = S.selected.has(b) ? b : [...S.selected].pop() || null;
  } else {
    S.sel = b;
    S.selected = new Set([b]);
  }
  updateShearLinkControl();
  renderProps();
}
function flyUpdate(dt) {
  const shift = keys.ShiftLeft || keys.ShiftRight;
  const sp = S.speed * (shift ? 3 : 1);
  const f = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
  const r = new THREE.Vector3(1, 0, 0).applyEuler(camera.rotation);
  const up = new THREE.Vector3(0, 1, 0);
  const mv = new THREE.Vector3();
  if (keys.KeyW) mv.add(f);
  if (keys.KeyS) mv.sub(f);
  if (keys.KeyD && !shift) mv.add(r);
  if (keys.KeyA) mv.sub(r);
  if (keys.KeyE) mv.add(up);
  if (keys.KeyQ) mv.sub(up);
  const moving = mv.lengthSq() > 0;
  if (moving) camera.position.addScaledVector(mv.normalize(), sp * dt);
  return moving;
}
function focusCameraOnSelection() {
  const members = [...S.selected].filter(member => member.alive);
  if (!members.length && S.sel?.alive) members.push(S.sel);
  if (!members.length) return flash('Select one or more blocks to focus the camera.');
  const bounds = new THREE.Box3();
  for (const member of members) bounds.expandByObject(member.mesh);
  const center = bounds.getCenter(new THREE.Vector3());
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const direction = camera.position.clone().sub(center);
  const distance = Math.max(direction.length(), sphere.radius * 2.2, 5);
  if (direction.lengthSq() < 1e-8) direction.set(0, 0, 1);
  camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
  camera.lookAt(center);
}

function getOrbitCenter() {
  if (S.orbitTarget) {
    const members = [...S.selected].filter(member => member.alive);
    if (members.length) {
      const bounds = new THREE.Box3();
      for (const member of members) bounds.expandByObject(member.mesh);
      return bounds.getCenter(new THREE.Vector3());
    }
  }
  return new THREE.Vector3(0, 0, 0);
}

function toggleOrbitTarget() {
  if (S.sel || S.selected.size > 0) {
    S.orbitTarget = S.orbitTarget ? null : 'selection';
    const center = getOrbitCenter();
    if (S.orbitTarget) {
      flash('Orbiting around selection. Press "." again to orbit around scene center.');
    } else {
      flash('Orbiting around scene center.');
    }
  } else {
    flash('Select a block first to orbit around it.');
  }
}

/* ================= toolbar, start, file I/O ================= */
byId('wsGo').onclick = startWorkspace;
byId('wsName').addEventListener('keydown', e => { if (e.key === 'Enter') startWorkspace(); });
function startWorkspace() {
  const startScreen = byId('start');
  if (startScreen.dataset.transitioning === 'true') return;
  const n = byId('wsName').value.trim() || 'Untitled workspace';
  S.name = n;
  byId('wsTitle').textContent = n;
  document.title = `${n} - ${translateText('Structural Sandbox', uiLanguage)}`;
  const app = byId('app');
  app.style.display = 'grid';
  setEnvironment(byId('envSel').value);
  resize();
  buildMaterialList();
  updateQuakeInfo();
  renderLearningStatus();
  updateMode();
  renderProps();
  flash(`Workspace "${n}" ready. Add a block to begin.`);
  startScreen.dataset.transitioning = 'true';
  startScreen.style.pointerEvents = 'none';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const playTransition = () => {
    const cardAnimation = startScreen.querySelector('.card').animate([
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0.92, transform: 'scale(0.82)', offset: 0.42 },
      { opacity: 0, transform: 'scale(0.58)' }
    ], {
      duration: reducedMotion ? 180 : 880,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'forwards'
    });
    cardAnimation.finished.then(() => {
      startScreen.style.display = 'none';
      startScreen.style.pointerEvents = '';
      delete startScreen.dataset.transitioning;
      app.animate([
        { opacity: 0, transform: reducedMotion ? 'none' : 'scale(0.985)' },
        { opacity: 1, transform: 'scale(1)' }
      ], {
        duration: reducedMotion ? 1 : 420,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
      });
    });
  };
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(playTransition, reducedMotion ? 0 : 280)));
}
byId('mats').addEventListener('click', e => {
  const b = e.target.closest('[data-mat]');
  if (!b) return;
  if (blockPlacement && blockPlacement.materialKey === b.dataset.mat) {
    cancelBlockPlacement(true);
    return;
  }
  S.mat = b.dataset.mat;
  buildMaterialList();
  if (blockPlacement) {
    blockPlacement.materialKey = S.mat;
    buildMaterialList();
    refreshBlockPlacementPreview();
    updateMode();
    flash(`Placing ${MATS[blockPlacement.mat].name}. Click to place blocks; click this material again to finish.`);
  } else {
    startBlockPlacement();
  }
});
document.querySelectorAll('#gizmoButtons button').forEach(b => b.addEventListener('click', () => {
  if (blockPlacement) cancelBlockPlacement();
  setGizmoMode(b.dataset.g);
}));
byId('foundationMode').onchange = e => {
  byId('addBtn').textContent = e.target.checked ? 'Add buried pier' : 'Add block';
  byId('foundationHelp').textContent = e.target.checked
    ? 'Width X, embedment depth, width Z (m). Pier top is at grade; buried concrete is visible through the solid ground.'
    : 'Enable to use width, embedment depth, and width above. Top of the pier is set at grade.';
  refreshBlockPlacementPreview();
};
byId('addBtn').onclick = startBlockPlacement;
for (const id of ['nW', 'nH', 'nD']) {
  byId(id).addEventListener('input', refreshBlockPlacementPreview);
}
byId('shapeSel').addEventListener('change', refreshBlockPlacementPreview);
byId('buildFrameBtn').onclick = startFramePlacement;
byId('braceModeBtn').onclick = () => setBraceMode(!S.braceMode);
byId('infillModeBtn').onclick = () => setInfillMode(!S.infillMode);
byId('braceThick').oninput = e => {
  const value = parseFloat(e.target.value);
  S.braceThickness = Number.isFinite(value) ? Math.max(0.02, Math.min(0.2, value)) : 0.05;
  e.target.value = S.braceThickness.toFixed(2);
  byId('braceThickTxt').textContent = `${S.braceThickness.toFixed(2)} m`;
};
byId('prepareBtn').onclick = () => {
  if (simulationBakeState) finishBakedSimulation();
  else prepareSim();
};
byId('runBtn').onclick = () => (S.sim ? stopSim() : startSim());
byId('playBakedBtn').onclick = () => {
  if (bakedPlaybackShown) resetBakedPlayback();
  else playBakedSimulation();
};
byId('undoBtn').onclick = undo;
byId('redoBtn').onclick = redo;
byId('clearBtn').onclick = () => {
  if (S.sim) return flash('Stop the simulation first.');
  if (S.edit) exitEdit();
  pushUndo(); clearAll(); S.sel = null; changed(); renderProps();
  flash('Workspace cleared. Ctrl+Z restores it; Ctrl+Shift+Z redoes it.');
};
byId('snap').onchange = e => { S.snap = e.target.checked; };
byId('gridSel').onchange = e => { S.grid = parseFloat(e.target.value); };
byId('stressView').onchange = e => { S.stressView = e.target.checked; };
byId('waveView').onchange = e => { S.waveView = e.target.checked; };
byId('waveDirection').oninput = e => setEarthquakeWaveDirection(e.target.value);
byId('envSel').onchange = e => setEnvironment(e.target.value);
byId('skyStyle').onchange = e => {
  activeSkyStyle = SKY_STYLES[e.target.value] ? e.target.value : 'natural';
  applyTimeOfDay(timeOfDayHours);
};
byId('loadHdriBtn').onclick = () => byId('hdriFile').click();
byId('hdriFile').onchange = e => {
  const file = e.target.files?.[0];
  if (file) loadHdriFile(file);
};
byId('clearHdriBtn').onclick = clearHdri;
byId('timeOfDay').oninput = e => applyTimeOfDay(parseFloat(e.target.value));
byId('autoFasten').onchange = e => { S.autoFasten = e.target.checked; changed(); };
byId('quakeSel').onchange = e => {
  S.quake = e.target.value;
  updateQuakeInfo();
  renderLearningStatus();
  changed();
  flash(S.quake === 'none' ? 'Earthquake off.' : `${QUAKES[S.quake].name} selected. Press Run to shake the ground.`);
};
byId('resetLearningBtn').onclick = () => {
  learner = newLearner();
  saveLearner();
  flash('Adaptive suggestion learning history reset.');
};
byId('autoStabilizeBtn').onclick = autoStabilize;
byId('explodeBtn').onclick = explodeScene;
byId('suggestions').addEventListener('click', e => {
  const b = e.target.closest('[data-sug]');
  if (b) applySuggestion(S.sugs[+b.dataset.sug]);
});
byId('props').addEventListener('change', e => {
  const t = e.target, b = S.sel;
  if (!b || !b.alive || S.sim || S.edit) return;
  let v = parseFloat(t.value);
  if (t.dataset.k !== 'mat' && !isFinite(v)) return;
  const key = t.dataset.k, axis = +t.dataset.i;
  if ((key === 'rot' && Math.abs(v) > 360000) ||
    (key !== 'mat' && key !== 'size' && key !== 'rot' && Math.abs(v) > 1e6)) {
    return flash('That value is outside the model limits.');
  }
  if (key === 'size') {
    const target = [...b.size];
    target[axis] = Math.max(0.05, v);
    if (!canResize(b, target)) return flash('That size would exceed the finite geometry or mass limits.');
  }
  pushUndo();
  if (b.frame) invalidateFrameModel([b]);
  if (t.dataset.k === 'mat') { replaceBlockMaterial(b, t.value); sync(b); }
  else {
    const k = key, i = axis;
    if (k === 'size') { v = Math.max(0.05, v); const target = [...b.size]; target[i] = v; setSizes(b, target); }
    else if (k === 'rot') { b.rot[i] = v; sync(b); }
    else {
      const old = b.pos[i];
      b.pos[i] = v;
      if (blockedBy(b)) { b.pos[i] = old; sync(b); flash('Blocked: that would overlap another block.'); }
      else sync(b);
    }
  }
  changed();
  renderProps();
});
byId('props').addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  if (!act) return;
  if (act.dataset.act === 'del') deleteSel();
  if (act.dataset.act === 'dup') duplicateSel();
  if (act.dataset.act === 'edit') enterEdit();
  if (act.dataset.act === 'remove-shear-links') removeShearLinksFromSelection();
});
function safeWorkspaceFilename(extension) {
  const name = (S.name || 'workspace').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'workspace';
  return `${name}.${extension}`;
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function projectSettingsSnapshot() {
  return {
    earthquake: S.quake, environment: activeEnvironment, skyStyle: activeSkyStyle,
    timeOfDay: timeOfDayHours, snap: S.snap, grid: S.grid,
    material: S.mat, shape: byId('shapeSel').value
  };
}

function cloneForModelExport(source) {
  let clone;
  if (source.isInstancedMesh) {
    clone = new THREE.InstancedMesh(source.geometry, source.material, source.count);
    clone.instanceMatrix.copy(source.instanceMatrix);
    if (source.instanceColor) clone.instanceColor = source.instanceColor.clone();
  } else if (source.isLineSegments) {
    clone = new THREE.LineSegments(source.geometry, source.material);
  } else if (source.isLine) {
    clone = new THREE.Line(source.geometry, source.material);
  } else if (source.isPoints) {
    clone = new THREE.Points(source.geometry, source.material);
  } else if (source.isMesh) {
    clone = new THREE.Mesh(source.geometry, source.material);
  } else if (source.isGroup) {
    clone = new THREE.Group();
  } else {
    clone = new THREE.Object3D();
  }
  clone.name = source.name;
  clone.position.copy(source.position);
  clone.quaternion.copy(source.quaternion);
  clone.scale.copy(source.scale);
  clone.up.copy(source.up);
  clone.visible = source.visible;
  clone.castShadow = source.castShadow;
  clone.receiveShadow = source.receiveShadow;
  clone.frustumCulled = source.frustumCulled;
  clone.renderOrder = source.renderOrder;
  clone.matrixAutoUpdate = source.matrixAutoUpdate;
  clone.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
  if (!clone.matrixAutoUpdate) clone.matrix.copy(source.matrix);
  for (const child of source.children) clone.add(cloneForModelExport(child));
  return clone;
}

byId('saveProjectBtn').onclick = () => {
  if (S.sim || simulationBakeState || bakedPlaybackShown || sceneExplosion) {
    return flash('Stop the simulation before saving a project.');
  }
  if (S.edit || framePlacement) return flash('Finish the current edit or frame placement before saving.');
  const project = {
    workspace: S.name, version: 5, units: 'SI (m, kg, s, Pa)',
    settings: projectSettingsSnapshot(), blocks: snapshot()
  };
  downloadFile(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }),
    safeWorkspaceFilename('json'));
  flash('Project saved to your computer.');
};

byId('exportBtn').onclick = () => {
  if (S.sim || simulationBakeState || bakedPlaybackShown || sceneExplosion) {
    return flash('Stop or reset the simulation before exporting the scene.');
  }
  if (S.edit || framePlacement) return flash('Finish the current edit or frame placement before exporting.');
  const alive = blocks.filter(block => block.alive);
  if (!alive.length) return flash('Add objects before exporting a 3D model.');
  const model = new THREE.Group();
  model.name = S.name || 'Structural Sandbox';
  for (const block of alive) {
    const clone = cloneForModelExport(block.mesh);
    clone.name = `Block ${block.id} - ${MATS[block.mat].name}`;
    model.add(clone);
  }
  model.updateMatrixWorld(true);
  try {
    new GLTFExporter().parse(model, result => {
      if (!(result instanceof ArrayBuffer)) {
        return flash('3D model export failed: The exporter did not produce a binary model.');
      }
      const filename = safeWorkspaceFilename('glb');
      downloadFile(new Blob([result], { type: 'model/gltf-binary' }), filename);
      flash(`3D model exported as ${filename}.`);
    }, error => {
      flash(`3D model export failed: ${error instanceof Error ? error.message : String(error)}`);
    }, { binary: true });
  } catch (error) {
    flash(`3D model export failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};
byId('importBtn').onclick = () => byId('importFile').click();
byId('importFile').onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  if (S.sim || simulationBakeState || bakedPlaybackShown || sceneExplosion) {
    e.target.value = '';
    return flash('Stop the simulation before importing a workspace.');
  }
  if (S.edit || framePlacement) {
    e.target.value = '';
    return flash('Finish the current edit or frame placement before importing.');
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result !== 'string') {
      flash('Import failed: the selected file could not be read as text.');
      return;
    }
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.blocks)) {
        flash('Project file is invalid.');
        return;
      }
      restore(data.blocks, true);
      const workspace = typeof data.workspace === 'string' ? data.workspace.trim().slice(0, 60) : '';
      if (workspace) {
        S.name = workspace;
        byId('wsTitle').textContent = workspace;
        document.title = `${workspace} - ${translateText('Structural Sandbox', uiLanguage)}`;
      }
      const settings = data.settings;
      if (settings && typeof settings === 'object') {
        if (typeof settings.earthquake === 'string' && Object.hasOwn(QUAKES, settings.earthquake)) {
          S.quake = settings.earthquake;
          byId('quakeSel').value = S.quake;
        }
        if (typeof settings.environment === 'string' && Object.hasOwn(ENVIRONMENTS, settings.environment)) {
          byId('envSel').value = settings.environment;
          setEnvironment(settings.environment);
        }
        if (typeof settings.skyStyle === 'string' && Object.hasOwn(SKY_STYLES, settings.skyStyle)) {
          activeSkyStyle = settings.skyStyle;
          byId('skyStyle').value = activeSkyStyle;
        }
        if (Number.isFinite(settings.timeOfDay) && settings.timeOfDay >= 0 && settings.timeOfDay <= 24) {
          applyTimeOfDay(settings.timeOfDay);
        }
        if (typeof settings.snap === 'boolean') {
          S.snap = settings.snap;
          byId('snap').checked = S.snap;
        }
        if (Number.isFinite(settings.grid) && [...byId('gridSel').options].some(option => Number(option.value) === settings.grid)) {
          S.grid = settings.grid;
          byId('gridSel').value = String(S.grid);
        }
        if (typeof settings.material === 'string' && Object.hasOwn(MATS, settings.material)) {
          S.mat = settings.material;
          buildMaterialList();
        }
        if (typeof settings.shape === 'string' && [...byId('shapeSel').options].some(option => option.value === settings.shape)) {
          byId('shapeSel').value = settings.shape;
        }
      }
      S.sel = null;
      changed();
      renderProps();
      updateQuakeInfo();
      flash(workspace ? `Project loaded: ${workspace}.` : `Imported ${data.blocks.length} blocks.`);
    } catch (err) { flash('Import failed: ' + err.message); }
  };
  reader.onerror = () => flash('Project file could not be read.');
  reader.readAsText(f);
  e.target.value = '';
};
function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

/* ================= main loop ================= */
let last = performance.now(), hudTimer = 0, nextAnalyzeAt = 0;
function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  try {
    if (!T) {
      const cameraMoved = flyUpdate(dt);
      if (cameraMoved && blockPlacement) {
        updateBlockPlacement({ clientX: lastX, clientY: lastY });
      }
    }
    updateSceneExplosion(dt);
    refreshExcavation();
    if (S.sim && !simulationBakeState) {
      if (simulationPlayback) {
        updateBakedPlayback(dt);
      } else {
        physics(dt);
        physicsStage = 'body synchronization';
        syncFromBodies();
        physicsStage = 'frame visuals';
        updateFrameModelVisuals();
      }
    }
    physicsStage = 'member rendering';
    for (const b of blocks) if (b.alive) paint(b);
    if (!S.sim && !T && S.dirty && now >= nextAnalyzeAt) {
      analyze();
      nextAnalyzeAt = now + 100;
    }
    if (S.edit) updateHandles();
    if (framePlacement) updateFrameObstruction();
    updateGizmo();
    updateEarthquakeWaveVisualization();
    hudTimer += dt;
    if (hudTimer > 0.2) {
      hudTimer = 0;
      if (S.name) hud();
      if (S.sim) renderSugs();
      if (S.name && S.quake !== 'none') renderQuakeMotion();
    }
    if (S.name) renderer.render(scene, camera);
  } catch (error) {
    console.error(`Animation frame failed during ${physicsStage}:`, error);
    if (S.sim) stopSim();
    flash(`Simulation paused after an error: ${error.message}`);
  } finally {
    requestAnimationFrame(frame);
  }
}
requestAnimationFrame(frame);





window.__dbg = { analyze, S, blocks, makeBlock, changed, startSim, stopSim, QUAKES, MATS, quakeWaveGroup, quakeWaveArrow, quakeWaveDirection, quakeWaveBands, quakeWaveLabels, updateEarthquakeWaveVisualization, frameGridForBraceTool, refreshBraceBayTargets, placeBraceInBay, getBraceBayTargets: () => braceBayTargets, refreshInfillBayTargets, placeInfillInBay, getInfillBayTargets: () => infillBayTargets, startFramePlacement, confirmFramePlacement, cancelFramePlacement, getFramePlacement: () => framePlacement, setBraceMode, setInfillMode, getSimulationFrameModels: () => simulationFrameModels, simulationFailures };

initializeLocalization(language => {
  uiLanguage = language;
  if (activeTutorialStep >= 0) renderTutorialStep();
  document.title = S.name
    ? `${S.name} - ${translateText('Structural Sandbox', language)}`
    : translateText('Structural Sandbox', language);
  buildMaterialList();
  updateQuakeInfo();
  renderLearningStatus();
  renderProps();
  renderSugs();
  updateMode();
  updateSimulationPreparationUi();
  if (S.name) hud();
  flash(lastUiMessage);
});
