// RactrGame: simple prototype so ractr.com is instantly playable.

class RactrGame {
  constructor(engine) {
    this.engine = engine;

    // Player state
    this.player = {
      x: 200,
      y: 200,
      vx: 0,
      vy: 0,
      radius: 16,
      baseSpeed: 180,
      dashSpeed: 360,
      dashCooldown: 0,
    };

    // Floating “orbiters” just for visual interest
    this.orbiters = [];
    for (let i = 0; i < 24; i++) {
      this.orbiters.push({
        angle: (i / 24) * Math.PI * 2,
        radius: 40 + (i % 5) * 12,
        speed: 0.6 + (i % 3) * 0.2,
      });
    }

    this.time = 0;
  }

  update(dt, input) {
    this.time += dt;

    const p = this.player;

    // Movement
    let speed = p.baseSpeed;
    if (input.dash && p.dashCooldown <= 0) {
      speed = p.dashSpeed;
      p.dashCooldown = 0.6; // seconds
    }
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);

    let moveX = 0;
    let moveY = 0;
    if (input.left) moveX -= 1;
    if (input.right) moveX += 1;
    if (input.up) moveY -= 1;
    if (input.down) moveY += 1;

    const mag = Math.hypot(moveX, moveY) || 1;
    moveX /= mag;
    moveY /= mag;

    p.vx = moveX * speed;
    p.vy = moveY * speed;

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Clamp to canvas bounds
    const canvas = this.engine.canvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    p.x = Math.min(Math.max(p.radius + 8, p.x), w - p.radius - 8);
    p.y = Math.min(Math.max(p.radius + 8, p.y), h - p.radius - 8);
  }

  render(ctx, width, height) {
    // Background
    const grd = ctx.createLinearGradient(0, 0, width, height);
    grd.addColorStop(0, "#05060a");
    grd.addColorStop(1, "#101426");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, width, height);

    // Subtle grid
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = (width % gridSize); x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = (height % gridSize); y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Orbiters around the player
    const p = this.player;
    for (const orb of this.orbiters) {
      const angle = orb.angle + this.time * orb.speed;
      const ox = p.x + Math.cos(angle) * orb.radius;
      const oy = p.y + Math.sin(angle) * orb.radius;

      const r = 3 + (orb.radius % 5);
      ctx.beginPath();
      ctx.fillStyle = "rgba(156, 200, 255, 0.55)";
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player core
    ctx.beginPath();
    ctx.fillStyle = "#5f9cff";
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();

    // Player inner pulse
    const pulse = 0.7 + 0.3 * Math.sin(this.time * 8);
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.25 * pulse})`;
    ctx.arc(p.x, p.y, p.radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Player outline
    ctx.beginPath();
    ctx.strokeStyle = "#c2dcff";
    ctx.lineWidth = 2;
    ctx.arc(p.x, p.y, p.radius + 1, 0, Math.PI * 2);
    ctx.stroke();
  }
}
