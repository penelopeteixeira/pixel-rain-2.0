(() => {
  const background = document.getElementById('interactive-bg');
  if (!background) return;

  const rainCanvas = background.querySelector('[data-rain]');
  const meshCanvas = background.querySelector('[data-mesh]');
  const rain = rainCanvas?.getContext('2d');
  const mesh = meshCanvas?.getContext('2d');
  if (!rain || !mesh) return;

  const panel = document.getElementById('rain-bg-controls');
  const toggle = document.getElementById('theme-toggle');
  const toggleIcon = toggle?.querySelector('.theme-toggle__icon');
  const THEME_KEY = 'pixel-rain-theme';
  const DARK = 'dark';
  const LIGHT = 'light';

  const preset = {
    speed: 80,
    intensity: 240,
    size: 2.4,
    density: 150,
    trail: 4,
    color: '#87AFEA',
    accentColor: '#9D93EE',
  };
  const settings = { ...preset };
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0, strength: 0, active: false };
  const baseRadius = 0.82;
  const maxDisplacement = 5;
  let bounds;
  let width;
  let height;
  let radius;
  let columns;
  let points = [];
  const drops = [];
  let dropCount = 0;
  let frame = null;
  let previousTime = null;

  const random = (min, max) => min + Math.random() * (max - min);

  function getThemeColors() {
    const style = getComputedStyle(document.documentElement);
    return {
      meshFill: style.getPropertyValue('--mesh-fill').trim(),
      meshAccent: style.getPropertyValue('--mesh-accent').trim(),
      meshPointOpacity: Number(style.getPropertyValue('--mesh-point-opacity')),
      meshGlow0: style.getPropertyValue('--mesh-glow-0').trim(),
      meshGlow1: style.getPropertyValue('--mesh-glow-1').trim(),
      meshStroke: style.getPropertyValue('--mesh-stroke').trim(),
      rainColor: style.getPropertyValue('--rain-color').trim(),
      rainAccent: style.getPropertyValue('--rain-accent').trim(),
    };
  }

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Ignore storage errors (private mode, etc.)
    }
    if (toggleIcon) {
      toggleIcon.textContent = theme === LIGHT ? '☀️' : '🌙';
    }
    toggle?.setAttribute('aria-pressed', theme === LIGHT);
  }

  function initTheme() {
    const stored = getStoredTheme();
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = stored || (prefersDark ? DARK : LIGHT);
    setTheme(theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || DARK;
    const next = current === DARK ? LIGHT : DARK;
    setTheme(next);
    drawMesh();
  }

  function setupControls() {
    const form = panel.querySelector('form');
    const formatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
    const fields = Array.from(form.querySelectorAll('input[type="range"]'), input => ({
      input,
      output: form.querySelector('output[for="' + input.id + '"]'),
    }));

    function updateLabel({ input, output }) {
      const unit = input.dataset.unit;
      const spacing = unit === '%' ? '' : ' ';
      output.textContent = formatter.format(input.valueAsNumber) + spacing + unit;
      input.setAttribute('aria-valuetext', output.textContent);
    }

    for (const field of fields) {
      const { input } = field;
      input.value = String(preset[input.name]);
      updateLabel(field);
      input.addEventListener('input', () => {
        settings[input.name] = input.valueAsNumber;
        updateLabel(field);
        if (input.name === 'density') layoutDrops();
        if (!motion.matches) drawRain(0);
      });
    }

    form.addEventListener('reset', event => {
      event.preventDefault();
      Object.assign(settings, preset);
      for (const field of fields) {
        field.input.value = String(preset[field.input.name]);
        updateLabel(field);
      }
      layoutDrops();
      if (!motion.matches) drawRain(0);
    });
  }

  function resize() {
    bounds = background.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    const scale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (width * height)));
    for (const [canvas, context] of [[rainCanvas, rain], [meshCanvas, mesh]]) {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    }

    radius = Math.min(150, Math.max(96, Math.min(width, height) * 0.17));
    const spacing = Math.max(22, Math.ceil(Math.sqrt(width * height / 4800)));
    columns = Math.ceil(width / spacing) + 1;
    const rows = Math.ceil(height / spacing) + 1;
    points = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        points.push({ x: (column - 0.5) * spacing, y: (row - 0.5) * spacing });
      }
    }

    layoutDrops();
    drawMesh();
    if (!motion.matches) drawRain(0);
  }

  function layoutDrops() {
    const step = Math.max(width < 600 ? 2 : 1, Math.ceil(columns / 68));
    const baseCount = Math.ceil((columns - 1) / step);
    dropCount = Math.max(1, Math.min(176, Math.round(baseCount * settings.density / 100)));
    for (let index = 0; index < dropCount; index++) {
      const drop = drops[index] ?? {
        depth: random(0, 1),
        speedRatio: random(24 / 44, 64 / 44),
        sizeRatio: random(0.72, 1.31),
        gap: random(7, 12),
        opacity: random(0.22, 0.52),
        drift: random(-2, 2),
      };
      drop.x = (index + 0.5) * width / dropCount + drop.drift;
      drops[index] = drop;
    }
  }

  function drawRain(elapsed) {
    const colors = getThemeColors();
    rain.clearRect(0, 0, width, height);
    const travel = height + 130;
    const intensity = settings.intensity / 100;
    for (let index = 0; index < dropCount; index++) {
      const drop = drops[index];
      drop.depth = (drop.depth + settings.speed * drop.speedRatio * elapsed / (1000 * travel)) % 1;
      const head = drop.depth * travel - 72;
      const centralDimming = 0.68 + 0.32 * Math.min(1, Math.abs(drop.x / width - 0.5) * 2);
      const distance = Math.hypot(drop.x - pointer.x, head - pointer.y);
      const highlight = 1 + 0.28 * pointer.strength * Math.max(0, 1 - distance / radius);
      rain.fillStyle = index % 4 === 0 ? colors.rainAccent : colors.rainColor;

      for (let tail = 0; tail <= settings.trail; tail++) {
        const y = head - tail * drop.gap;
        if (y < 0 || y >= height) continue;
        const edgeFade = Math.min(1, y / 55, (height - y) / 70);
        const size = Math.max(0.75, settings.size * drop.sizeRatio - 0.25 * tail);
        rain.globalAlpha = Math.min(1, intensity * drop.opacity * centralDimming * edgeFade * highlight * 0.65 ** tail);
        rain.fillRect(drop.x - size / 2, y - size / 2, size, size);
      }
    }
    rain.globalAlpha = 1;
  }

  function project(point) {
    point.drawX = point.x;
    point.drawY = point.y;
    point.power = 0;
    if (!pointer.strength) return;

    const dx = point.x - pointer.x;
    const dy = point.y - pointer.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= radius * radius) return;

    const distance = Math.sqrt(distanceSquared);
    const proximity = distance / radius;
    point.power = (1 - proximity ** 2) ** 2 * pointer.strength;
    if (distance === 0) return;

    // O deslocamento zera nas duas pontas para evitar abrir um vão no centro.
    const offset = maxDisplacement * Math.sin(Math.PI * proximity) ** 2 * pointer.strength;
    point.drawX += dx / distance * offset;
    point.drawY += dy / distance * offset;
  }

  function drawLink(point, neighbor) {
    const power = Math.min(point.power, neighbor.power);
    if (power < 0.09) return;

    mesh.globalAlpha = power * 0.13;
    mesh.beginPath();
    mesh.moveTo(point.drawX, point.drawY);
    mesh.lineTo(neighbor.drawX, neighbor.drawY);
    mesh.stroke();
  }

  function drawMesh() {
    const colors = getThemeColors();
    mesh.clearRect(0, 0, width, height);
    mesh.fillStyle = `rgb(${colors.meshFill})`;
    mesh.globalAlpha = colors.meshPointOpacity;
    mesh.beginPath();
    for (const point of points) {
      project(point);
      if (point.power > 0) continue;
      mesh.moveTo(point.x + baseRadius, point.y);
      mesh.arc(point.x, point.y, baseRadius, 0, Math.PI * 2);
    }
    mesh.fill();
    if (!pointer.strength) return;

    const glow = mesh.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, radius * 1.5);
    glow.addColorStop(0, colors.meshGlow0);
    glow.addColorStop(1, colors.meshGlow1);
    mesh.fillStyle = glow;
    mesh.globalAlpha = 0.13 * pointer.strength;
    mesh.fillRect(pointer.x - radius * 1.5, pointer.y - radius * 1.5, radius * 3, radius * 3);

    mesh.strokeStyle = colors.meshStroke;
    mesh.lineWidth = 0.65;
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      if (point.power < 0.09) continue;
      if ((index + 1) % columns !== 0) drawLink(point, points[index + 1]);
      if (index + columns < points.length) drawLink(point, points[index + columns]);
    }

    const [baseRed, baseGreen, baseBlue] = colors.meshFill.split(/\s+/).map(Number);
    const [accentRed, accentGreen, accentBlue] = colors.meshAccent.split(/\s+/).map(Number);
    for (const point of points) {
      const { power } = point;
      if (power === 0) continue;
      const red = baseRed + (accentRed - baseRed) * power;
      const green = baseGreen + (accentGreen - baseGreen) * power;
      const blue = baseBlue + (accentBlue - baseBlue) * power;
      mesh.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      mesh.globalAlpha = colors.meshPointOpacity + 0.48 * power;
      mesh.beginPath();
      mesh.arc(point.drawX, point.drawY, baseRadius + 0.5 * power, 0, Math.PI * 2);
      mesh.fill();
    }
  }

  function updateHover(elapsed) {
    const targetStrength = pointer.active ? 1 : 0;
    if (pointer.strength === targetStrength &&
        (!pointer.active || (pointer.x === pointer.targetX && pointer.y === pointer.targetY))) return;

    const blend = 1 - Math.exp(-elapsed / 55);
    pointer.x += (pointer.targetX - pointer.x) * blend;
    pointer.y += (pointer.targetY - pointer.y) * blend;
    pointer.strength += (targetStrength - pointer.strength) * blend;
    if (Math.hypot(pointer.targetX - pointer.x, pointer.targetY - pointer.y) < 0.1) {
      pointer.x = pointer.targetX;
      pointer.y = pointer.targetY;
    }
    if (Math.abs(targetStrength - pointer.strength) < 0.002) pointer.strength = targetStrength;
    drawMesh();
  }

  function tick(time) {
    const elapsed = previousTime === null ? 0 : Math.min(50, time - previousTime);
    previousTime = time;
    updateHover(elapsed);
    drawRain(elapsed);
    frame = requestAnimationFrame(tick);
  }

  function syncAnimation() {
    if (document.hidden || motion.matches) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      previousTime = null;
      pointer.active = false;
      pointer.strength = 0;
      drawMesh();
      if (motion.matches) rain.clearRect(0, 0, width, height);
      return;
    }
    if (frame === null) frame = requestAnimationFrame(tick);
  }

  function followPointer(event) {
    if (!event.isPrimary || event.pointerType === 'touch' || motion.matches) return;
    if (panel && event.target instanceof Node && panel.contains(event.target)) {
      leave();
      return;
    }
    pointer.targetX = event.clientX - bounds.left;
    pointer.targetY = event.clientY - bounds.top;
    if (pointer.strength === 0) {
      pointer.x = pointer.targetX;
      pointer.y = pointer.targetY;
    }
    pointer.active = true;
  }

  function leave() {
    pointer.active = false;
  }

  if (panel) setupControls();
  if (toggle) toggle.addEventListener('click', toggleTheme);
  window.addEventListener('pointermove', followPointer, { passive: true });
  document.documentElement.addEventListener('pointerleave', leave);
  window.addEventListener('blur', leave);
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', syncAnimation);
  motion.addEventListener('change', syncAnimation);
  initTheme();
  resize();
  syncAnimation();
})();
