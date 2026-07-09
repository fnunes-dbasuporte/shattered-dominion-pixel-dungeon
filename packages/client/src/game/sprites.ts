import Phaser from "phaser";

/** Meta gerado por tools/assets/compose.ts para cada spritesheet. */
export interface SheetMeta {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: Record<string, { row: number; count: number }>;
}

/** Canvas padrão dos personagens 16px do Pixellab (v3 usa 28; menores são centralizados). */
export const CHAR_CANVAS = 28;

/** hero-0..7 compartilham o meta de "hero"; mobs têm sheet própria. */
const HERO_VARIANTS = Array.from({ length: 8 }, (_, i) => `hero-${i}`);
export const CHARACTER_TEXTURES = [...HERO_VARIANTS, "rat", "gnoll", "crab"];

const metaSource = (texture: string) => (texture.startsWith("hero-") ? "hero" : texture);

export function preloadCharacters(scene: Phaser.Scene): void {
  const metasLoaded = new Set<string>();
  for (const texture of CHARACTER_TEXTURES) {
    const meta = metaSource(texture);
    if (!metasLoaded.has(meta)) {
      metasLoaded.add(meta);
      scene.load.json(`${meta}-meta`, `assets/sprites/${meta}.json`);
    }
    scene.load.spritesheet(texture, `assets/sprites/${texture}.png`, {
      frameWidth: CHAR_CANVAS,
      frameHeight: CHAR_CANVAS,
    });
  }
}

const ANIM_CONFIG: Record<string, { frameRate: number; repeat: number }> = {
  walk: { frameRate: 8, repeat: -1 },
  idle: { frameRate: 4, repeat: -1 },
  attack: { frameRate: 12, repeat: 0 },
  death: { frameRate: 8, repeat: 0 },
};

/** Cria as animações "textura:anim-dir" a partir dos metas carregados. */
export function createCharacterAnims(scene: Phaser.Scene): void {
  for (const texture of CHARACTER_TEXTURES) {
    const meta = scene.cache.json.get(`${metaSource(texture)}-meta`) as SheetMeta | undefined;
    if (!meta || !scene.textures.exists(texture)) continue;

    for (const [rowName, info] of Object.entries(meta.rows)) {
      const animName = rowName.split("-")[0]; // "walk-south" → "walk"
      const config = ANIM_CONFIG[animName] ?? { frameRate: 6, repeat: 0 };
      const start = info.row * meta.columns;
      scene.anims.create({
        key: `${texture}:${rowName}`,
        frames: scene.anims.generateFrameNumbers(texture, {
          start,
          end: start + info.count - 1,
        }),
        frameRate: config.frameRate,
        repeat: config.repeat,
      });
    }
  }
}

export type Facing = "south" | "north" | "east" | "west";

export function facingFromDelta(dx: number, dy: number, fallback: Facing = "south"): Facing {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "east" : "west";
  return dy > 0 ? "south" : "north";
}

/** Toca a animação se ela existir; senão cai no frame parado da direção. */
export function playAnim(
  sprite: Phaser.GameObjects.Sprite,
  texture: string,
  anim: string,
  facing: Facing,
  onDone?: () => void,
): void {
  const key = `${texture}:${anim}-${facing}`;
  if (sprite.anims.animationManager.exists(key)) {
    sprite.play(key, true);
    if (onDone) sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE_KEY + key, onDone);
    return;
  }
  const stillKey = `${texture}:still-${facing}`;
  if (sprite.anims.animationManager.exists(stillKey)) sprite.play(stillKey, true);
  onDone?.();
}
