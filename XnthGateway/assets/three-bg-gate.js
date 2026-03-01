/* ================================================================
   kAIxU SuperIDE Gateway -- Electric Data Grid Background
   Cyan + matrix-green morphing grid with energy pulses
   Feels like live data throughput, not a neural net
   ================================================================ */
(function () {
  const canvas = document.getElementById("three-bg");
  if (!canvas || typeof THREE === "undefined") return;

  /* -- Renderer -------------------------------------------------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x020c12, 1); // deep ocean blue-black

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(0, 14, 28);
  camera.lookAt(0, -2, 0);

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

  /* -- Palette ---------------------------------------------------- */
  const CYAN  = new THREE.Color(0x00d4ff); // electric cyan
  const GREEN = new THREE.Color(0x00ff88); // matrix green

  /* -- Grid mesh (morphing plane) --------------------------------- */
  const GRID_W   = 36;
  const GRID_H   = 36;
  const SEGMENTS = 36;

  const gridGeo = new THREE.PlaneGeometry(GRID_W, GRID_H, SEGMENTS, SEGMENTS);
  gridGeo.rotateX(-Math.PI / 2);
  const basePos   = new Float32Array(gridGeo.attributes.position.array);
  const vertCount = gridGeo.attributes.position.count;

  const gridMat = new THREE.MeshBasicMaterial({
    color: CYAN,
    wireframe: true,
    transparent: true,
    opacity: 0.13,
  });
  const gridMesh = new THREE.Mesh(gridGeo, gridMat);
  gridMesh.position.set(0, -3, 0);
  scene.add(gridMesh);

  /* -- Second grid layer (offset, green) ------------------------- */
  const segs2    = Math.floor(SEGMENTS * 0.6);
  const gridGeo2 = new THREE.PlaneGeometry(GRID_W * 1.4, GRID_H * 1.4, segs2, segs2);
  gridGeo2.rotateX(-Math.PI / 2);
  const basePos2 = new Float32Array(gridGeo2.attributes.position.array);

  const gridMesh2 = new THREE.Mesh(gridGeo2, new THREE.MeshBasicMaterial({
    color: GREEN, wireframe: true, transparent: true, opacity: 0.06,
  }));
  gridMesh2.position.set(0, -3.5, 0);
  gridMesh2.rotation.y = Math.PI / (segs2 * 0.5);
  scene.add(gridMesh2);

  /* -- Intersection spark nodes ---------------------------------- */
  const SPARK_COUNT = 90;
  const sparkPos   = new Float32Array(SPARK_COUNT * 3);
  const sparkColor = new Float32Array(SPARK_COUNT * 3);
  const sparkSize  = new Float32Array(SPARK_COUNT);
  const sparkMeta  = [];
  const step = GRID_W / SEGMENTS;

  for (let i = 0; i < SPARK_COUNT; i++) {
    const gx = Math.round((Math.random() - 0.5) * SEGMENTS) * step;
    const gz = Math.round((Math.random() - 0.5) * SEGMENTS) * step;
    sparkPos[i * 3]     = gx;
    sparkPos[i * 3 + 1] = -3;
    sparkPos[i * 3 + 2] = gz;
    const col = Math.random() < 0.65 ? CYAN : GREEN;
    sparkColor[i * 3]     = col.r;
    sparkColor[i * 3 + 1] = col.g;
    sparkColor[i * 3 + 2] = col.b;
    sparkSize[i] = Math.random() * 0.28 + 0.08;
    sparkMeta.push({ phase: Math.random() * Math.PI * 2, speed: Math.random() * 0.6 + 0.4, baseSize: sparkSize[i] });
  }

  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute("color",    new THREE.BufferAttribute(sparkColor, 3));
  sparkGeo.setAttribute("size",     new THREE.BufferAttribute(sparkSize, 1));

  const sparkMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:       { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() }
    },
    vertexShader: `
      attribute float size;
      attribute vec3  color;
      uniform   float uTime;
      uniform   float uPixelRatio;
      varying   vec3  vColor;
      varying   float vAlpha;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dist = -mv.z;
        vAlpha = smoothstep(60.0, 8.0, dist);
        gl_PointSize = (size * 80.0 * uPixelRatio) / dist;
        gl_Position  = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3  vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.02, d);
        float glow = smoothstep(0.5, 0.0,  d) * 0.6;
        gl_FragColor = vec4(vColor * 1.6 + 0.4, (core + glow) * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  scene.add(new THREE.Points(sparkGeo, sparkMat));

  /* -- Energy pulse lines (streaks racing across the grid) ------- */
  const PULSE_COUNT = 18;
  const pulses = [];

  function makePulse(progress) {
    const axis  = Math.random() < 0.5 ? 'x' : 'z';
    const cross = (Math.random() - 0.5) * GRID_H;
    const col   = Math.random() < 0.6 ? CYAN : GREEN;
    const mkVec = (v, ax, cr) =>
      ax === 'x' ? new THREE.Vector3(v, -3, cr) : new THREE.Vector3(cr, -3, v);

    const geo = new THREE.BufferGeometry().setFromPoints([mkVec(-GRID_W * 0.5, axis, cross), mkVec(-GRID_W * 0.5, axis, cross)]);
    const mat = new THREE.LineBasicMaterial({
      color: col, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    return {
      line, geo, mat, axis, cross, col,
      progress: progress !== undefined ? progress : -Math.random() * 0.5,
      speed:  Math.random() * 0.012 + 0.005,
      length: Math.random() * 0.18 + 0.06,
    };
  }

  for (let i = 0; i < PULSE_COUNT; i++) pulses.push(makePulse(Math.random()));

  function updatePulse(p) {
    p.progress += p.speed;
    if (p.progress > 1 + p.length) {
      const old = p; scene.remove(old.line);
      const fresh = makePulse(-p.length);
      Object.assign(p, fresh);
      return;
    }
    const start = -GRID_W * 0.5, end = GRID_W * 0.5, total = end - start;
    const headT = Math.min(Math.max(p.progress, 0), 1);
    const tailT = Math.min(Math.max(p.progress - p.length, 0), 1);
    const mkVec = (v) =>
      p.axis === 'x' ? new THREE.Vector3(v, -3, p.cross) : new THREE.Vector3(p.cross, -3, v);
    p.geo.setFromPoints([mkVec(start + tailT * total), mkVec(start + headT * total)]);
    p.geo.attributes.position.needsUpdate = true;
    const vis = headT - tailT;
    p.mat.opacity = vis > 0.005 ? Math.min(vis / p.length, 1) * 0.85 : 0;
  }

  /* -- Floating cyan dust particles ------------------------------ */
  const DUST = 300;
  const dPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dPos[i * 3]     = (Math.random() - 0.5) * 50;
    dPos[i * 3 + 1] = Math.random() * 20 - 2;
    dPos[i * 3 + 2] = (Math.random() - 0.5) * 50;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));

  const dustMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() } },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vec3 pos = position;
        pos.y += sin(uTime * 0.2 + position.x * 0.25 + position.z * 0.15) * 1.2;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        float dist = -mv.z;
        vAlpha = smoothstep(60.0, 12.0, dist) * 0.18;
        gl_PointSize = (0.08 * 50.0 * uPixelRatio) / dist;
        gl_Position  = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(0.0, 0.83, 1.0, smoothstep(0.5, 0.0, d) * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(dustGeo, dustMat));

  /* -- Horizon glow (rising light from the grid plane) ----------- */
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime;
      varying vec2  vUv;
      void main() {
        float fade  = vUv.y * (1.0 - vUv.y) * 4.0;
        float pulse = 0.8 + sin(uTime * 0.4) * 0.2;
        float edge  = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
        gl_FragColor = vec4(0.0, 0.82, 1.0, fade * edge * 0.06 * pulse);
      }
    `,
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(60, 8), glowMat);
  glowPlane.position.set(0, -0.5, -10);
  scene.add(glowPlane);

  /* -- Events ---------------------------------------------------- */
  window.addEventListener("mousemove", (e) => {
    mouse.tx =  (e.clientX / window.innerWidth  - 0.5) * 2;
    mouse.ty = -(e.clientY / window.innerHeight - 0.5) * 2;
  });
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* -- Animate --------------------------------------------------- */
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    // Camera parallax
    mouse.x += (mouse.tx - mouse.x) * 0.025;
    mouse.y += (mouse.ty - mouse.y) * 0.025;
    camera.position.x = mouse.x * 2.5;
    camera.position.y = 14 + mouse.y * 1.2;
    camera.lookAt(0, -2, 0);

    // Morph primary grid
    const pos = gridGeo.attributes.position.array;
    for (let i = 0; i < vertCount; i++) {
      const bx = basePos[i * 3], bz = basePos[i * 3 + 2];
      pos[i * 3 + 1] = Math.sin(t * 0.35 + bx * 0.22 + bz * 0.18) * 0.55
                     + Math.sin(t * 0.55 + bx * 0.12 - bz * 0.28) * 0.28;
    }
    gridGeo.attributes.position.needsUpdate = true;

    // Morph secondary grid (slower)
    const pos2 = gridGeo2.attributes.position.array;
    const vc2  = gridGeo2.attributes.position.count;
    for (let i = 0; i < vc2; i++) {
      const bx = basePos2[i * 3], bz = basePos2[i * 3 + 2];
      pos2[i * 3 + 1] = Math.sin(t * 0.22 - bx * 0.15 + bz * 0.20) * 0.4;
    }
    gridGeo2.attributes.position.needsUpdate = true;

    // Pulse sparks
    for (let i = 0; i < SPARK_COUNT; i++) {
      const m = sparkMeta[i];
      sparkSize[i] = m.baseSize * (0.85 + Math.sin(t * m.speed + m.phase) * 0.15);
    }
    sparkGeo.attributes.size.needsUpdate = true;

    // Advance energy pulses
    for (const p of pulses) updatePulse(p);

    // Update uniforms
    sparkMat.uniforms.uTime.value = t;
    dustMat.uniforms.uTime.value  = t;
    glowMat.uniforms.uTime.value  = t;

    renderer.render(scene, camera);
  }
  animate();
})();
