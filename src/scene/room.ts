import * as THREE from "three";

export const ROOM = { width: 12, depth: 12, height: 4 };

function carpetTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#4a0f14";
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "#a8862a";
  ctx.lineWidth = 3;
  for (const [x, y] of [
    [128, 0],
    [0, 128],
    [256, 128],
    [128, 256],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x!, y! - 40);
    ctx.lineTo(x! + 40, y!);
    ctx.lineTo(x!, y! + 40);
    ctx.lineTo(x! - 40, y!);
    ctx.closePath();
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(ROOM.width / 1.5, ROOM.depth / 1.5);
  return t;
}

export function createRoom(): THREE.Group {
  const g = new THREE.Group();
  const { width: w, depth: d, height: h } = ROOM;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 1 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = h;
  g.add(ceiling);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x123f3a, roughness: 0.9, side: THREE.BackSide });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
  walls.position.y = h / 2;
  g.add(walls);

  // Wood wainscot band around the walls.
  const wainscot = new THREE.Mesh(
    new THREE.BoxGeometry(w - 0.02, 1.0, d - 0.02),
    new THREE.MeshStandardMaterial({ color: 0x3a1f0f, roughness: 0.5, side: THREE.BackSide }),
  );
  wainscot.position.y = 0.5;
  g.add(wainscot);

  // Chandelier over the table: brass ring, bulbs, one warm light.
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 0.9, roughness: 0.25 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.03, 12, 48), brass);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2.7;
  g.add(ring);
  const bulb = new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffc060, emissiveIntensity: 2 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), bulb);
    b.position.set(Math.cos(a) * 0.6, 2.62, Math.sin(a) * 0.6);
    g.add(b);
  }
  const chandelier = new THREE.PointLight(0xffc880, 120, 14, 2);
  chandelier.position.y = 2.6;
  g.add(chandelier);

  // Sconces on the side walls, dim and warm.
  for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) {
    for (const z of [-3, 3]) {
      const s = new THREE.PointLight(0xffb070, 30, 9, 2);
      s.position.set(x, 2.2, z);
      g.add(s);
    }
  }

  g.add(new THREE.AmbientLight(0x503020, 1.0));
  return g;
}
