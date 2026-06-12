/* @ds-bundle: {"format":3,"namespace":"ColonySimDesignSystem_8e1539","components":[{"name":"Panel","sourcePath":"components/containers/Panel.jsx"},{"name":"Button","sourcePath":"components/controls/Button.jsx"},{"name":"Badge","sourcePath":"components/feedback/Badge.jsx"},{"name":"Bar","sourcePath":"components/feedback/Bar.jsx"},{"name":"Icon","sourcePath":"components/feedback/Icon.jsx"},{"name":"Label","sourcePath":"components/forms/Label.jsx"},{"name":"MenuItem","sourcePath":"components/navigation/MenuItem.jsx"}],"sourceHashes":{"assets/sprite-animator.js":"a4025924061c","assets/sprite-exporter.js":"a99de65a7f84","assets/sprite-generator.js":"7d3ff89276de","components/containers/Panel.jsx":"dc498da36656","components/controls/Button.jsx":"595fdc429dfe","components/feedback/Badge.jsx":"2349a3069e65","components/feedback/Bar.jsx":"1ba2bca00595","components/feedback/Icon.jsx":"cc6caee0d2ef","components/forms/Label.jsx":"7113b3059051","components/navigation/MenuItem.jsx":"32cf35f00645"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ColonySimDesignSystem_8e1539 = window.ColonySimDesignSystem_8e1539 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// assets/sprite-animator.js
try { (() => {
/**
 * Sprite Animation System
 * Handles idle loops, work cycles, and movement animations
 */

class SpriteAnimator {
  constructor(spriteGenerator) {
    this.gen = spriteGenerator;
    this.animations = {};
    this.frameIndex = 0;
    this.frameTime = 0;
  }

  /**
   * Create an idle animation (breathing, slight sway)
   */
  idleAnimation(spriteType, params = {}) {
    const key = `idle-${spriteType}`;
    if (spriteType === 'settler') {
      // Breathing/standing idle
      const frames = [];
      for (let i = 0; i < 4; i++) {
        const canvas = this.gen.settler(params.gender || 'male', params.skin || 0, params.hair || 0);
        frames.push(canvas);
      }
      return {
        frames,
        frameRate: 8,
        // 8 frames per second = 0.5s cycle
        loop: true,
        type: 'idle'
      };
    }
    if (spriteType === 'livestock') {
      const frames = [];
      for (let i = 0; i < 3; i++) {
        const canvas = this.gen.livestock(params.type || 'cow', i);
        frames.push(canvas);
      }
      return {
        frames,
        frameRate: 6,
        loop: true,
        type: 'idle'
      };
    }
    if (spriteType === 'wildAnimal') {
      const frames = [];
      for (let i = 0; i < 3; i++) {
        const canvas = this.gen.wildAnimal(params.type || 'deer', i);
        frames.push(canvas);
      }
      return {
        frames,
        frameRate: 8,
        loop: true,
        type: 'idle'
      };
    }
    if (spriteType === 'grainPlant') {
      const frames = [];
      for (let stage = 1; stage <= 3; stage++) {
        const canvas = this.gen.grainPlant(stage);
        frames.push(canvas);
      }
      return {
        frames,
        frameRate: 2,
        // Slow growth cycle
        loop: true,
        type: 'growth'
      };
    }
    if (spriteType === 'tree') {
      const frames = [];
      for (let stage = 1; stage <= 3; stage++) {
        const canvas = this.gen.tree(stage, params.variant || 0);
        frames.push(canvas);
      }
      return {
        frames,
        frameRate: 1,
        // Very slow growth
        loop: true,
        type: 'growth'
      };
    }
    return {
      frames: [],
      frameRate: 10,
      loop: true
    };
  }

  /**
   * Work animation (farming, mining, crafting)
   */
  workAnimation(workType, params = {}) {
    const frames = [];
    if (workType === 'farming') {
      // Settler swinging tool
      for (let i = 0; i < 6; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 48;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#7a8c54';
        ctx.fillRect(0, 0, 32, 48);

        // Body
        ctx.fillStyle = '#d4a574';
        ctx.beginPath();
        ctx.ellipse(16, 12, 6, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4a3a2c';
        ctx.beginPath();
        ctx.ellipse(16, 9, 7, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6b5138';
        ctx.fillRect(10, 20, 12, 16);

        // Swinging arm with tool
        const angle = i / 6 * Math.PI;
        const armX = 22 + Math.cos(angle) * 8;
        const armY = 22 + Math.sin(angle) * 8;
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#d4a574';
        ctx.beginPath();
        ctx.moveTo(22, 22);
        ctx.lineTo(armX, armY);
        ctx.stroke();

        // Tool head
        ctx.fillStyle = '#7a7a7a';
        ctx.fillRect(armX - 2, armY - 2, 4, 4);
        frames.push(canvas);
      }
      return {
        frames,
        frameRate: 8,
        loop: true,
        type: 'work'
      };
    }
    if (workType === 'mining') {
      // Swinging pickaxe
      for (let i = 0; i < 4; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 48;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#787469';
        ctx.fillRect(0, 0, 32, 48);

        // Body in mining stance
        ctx.fillStyle = '#d4a574';
        ctx.beginPath();
        ctx.ellipse(16, 14, 6, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6b5138';
        ctx.fillRect(8, 22, 14, 14);

        // Pickaxe swing
        const swingAngle = i / 4 * Math.PI * 1.5 - Math.PI / 4;
        const pickX = 16 + Math.cos(swingAngle + Math.PI / 4) * 12;
        const pickY = 16 + Math.sin(swingAngle + Math.PI / 4) * 12;
        ctx.strokeStyle = '#6b5138';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(16, 16);
        ctx.lineTo(pickX, pickY);
        ctx.stroke();
        ctx.fillStyle = '#7a7a7a';
        ctx.fillRect(pickX - 2, pickY - 2, 4, 4);
        frames.push(canvas);
      }
      return {
        frames,
        frameRate: 6,
        loop: true,
        type: 'work'
      };
    }
    return {
      frames: [],
      frameRate: 10,
      loop: true
    };
  }

  /**
   * Movement animation (walking, running)
   */
  movementAnimation(movementType, params = {}) {
    const frames = [];
    if (movementType === 'walk') {
      // Walking settler
      for (let i = 0; i < 4; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 48;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#7a8c54';
        ctx.fillRect(0, 0, 32, 48);

        // Head
        ctx.fillStyle = '#d4a574';
        ctx.beginPath();
        ctx.ellipse(16, 12, 6, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4a3a2c';
        ctx.beginPath();
        ctx.ellipse(16, 9, 7, 5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Body
        ctx.fillStyle = '#6b5138';
        ctx.fillRect(10, 20, 12, 16);

        // Walking legs
        const legPhase = i % 4 / 4;

        // Left leg
        const leftLegX = 12 + Math.sin(legPhase * Math.PI * 2) * 2;
        const leftLegY = 20 + Math.abs(Math.cos(legPhase * Math.PI * 2)) * 6;
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#3d586b';
        ctx.beginPath();
        ctx.moveTo(12, 36);
        ctx.lineTo(leftLegX, 46);
        ctx.stroke();

        // Right leg
        const rightLegX = 20 - Math.sin(legPhase * Math.PI * 2) * 2;
        const rightLegY = 20 + Math.abs(Math.cos((legPhase + 0.5) * Math.PI * 2)) * 6;
        ctx.beginPath();
        ctx.moveTo(20, 36);
        ctx.lineTo(rightLegX, 46);
        ctx.stroke();
        frames.push(canvas);
      }
      return {
        frames,
        frameRate: 8,
        loop: true,
        type: 'movement'
      };
    }
    return {
      frames: [],
      frameRate: 10,
      loop: true
    };
  }

  /**
   * Render animation frame at a given time
   */
  render(animation, timeMs = 0) {
    if (!animation.frames || animation.frames.length === 0) {
      return null;
    }
    const frameDuration = 1000 / animation.frameRate;
    let frameIndex = Math.floor(timeMs / frameDuration) % animation.frames.length;
    return animation.frames[frameIndex];
  }
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpriteAnimator;
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "assets/sprite-animator.js", error: String((e && e.message) || e) }); }

// assets/sprite-exporter.js
try { (() => {
/**
 * Sprite Export Utilities
 * Convert canvas sprites to PNG or other formats for game engines
 */

class SpriteExporter {
  /**
   * Export canvas to PNG blob
   */
  static canvasToPNG(canvas) {
    return new Promise(resolve => {
      canvas.toBlob(resolve, 'image/png');
    });
  }

  /**
   * Export canvas to data URL
   */
  static canvasToDataURL(canvas) {
    return canvas.toDataURL('image/png');
  }

  /**
   * Create a spritesheet from multiple sprites
   */
  static createSpritesheet(sprites, cols = 4) {
    if (!sprites || sprites.length === 0) return null;
    const spriteWidth = sprites[0].width;
    const spriteHeight = sprites[0].height;
    const rows = Math.ceil(sprites.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = spriteWidth * cols;
    sheet.height = spriteHeight * rows;
    const ctx = sheet.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    sprites.forEach((sprite, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      ctx.drawImage(sprite, col * spriteWidth, row * spriteHeight);
    });
    return sheet;
  }

  /**
   * Create an animation spritesheet (horizontal strip)
   */
  static createAnimationStrip(frames) {
    if (!frames || frames.length === 0) return null;
    const frameWidth = frames[0].width;
    const frameHeight = frames[0].height;
    const strip = document.createElement('canvas');
    strip.width = frameWidth * frames.length;
    strip.height = frameHeight;
    const ctx = strip.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    frames.forEach((frame, i) => {
      ctx.drawImage(frame, i * frameWidth, 0);
    });
    return strip;
  }

  /**
   * Generate sprite metadata (for game engine import)
   */
  static generateMetadata(sprites, config = {}) {
    return {
      version: '1.0',
      generated: new Date().toISOString(),
      spriteCount: sprites.length,
      config: {
        scale: config.scale || 1,
        pixelSize: config.pixelSize || 1,
        renderingHint: 'pixelated',
        ...config
      }
    };
  }

  /**
   * Export as JSON + PNG (for game dev)
   */
  static async exportForGameEngine(name, sprites, metadata = {}) {
    const spritesheet = this.createSpritesheet(sprites);
    const png = await this.canvasToPNG(spritesheet);
    const json = {
      name,
      spritesheet: `${name}.png`,
      spriteCount: sprites.length,
      spriteWidth: sprites[0].width,
      spriteHeight: sprites[0].height,
      metadata: this.generateMetadata(sprites, metadata),
      sprites: sprites.map((sprite, i) => ({
        id: i,
        name: `${name}_${i}`
      }))
    };
    return {
      json,
      png,
      jsonString: JSON.stringify(json, null, 2)
    };
  }
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpriteExporter;
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "assets/sprite-exporter.js", error: String((e && e.message) || e) }); }

// assets/sprite-generator.js
try { (() => {
/**
 * Colony Sim Sprite Generator
 * Procedural pixel-art sprites inspired by RimWorld
 * 
 * Generates:
 * - Terrain tiles (grass, dirt, sand, water, stone)
 * - Plants (grains, trees, shrubs, wild plants)
 * - Animals (livestock, wild creatures, insects)
 * - NPCs (settlers with varied features)
 * - Structures (buildings, walls, fences)
 * - Items (resources, tools, food, weapons)
 * - Weather effects (rain, snow, dust, smoke)
 */

class SpriteGenerator {
  constructor() {
    this.palette = {
      // Terrain
      grass_light: '#7a8c54',
      grass_dark: '#566445',
      soil: '#6b5138',
      sand: '#c9b584',
      stone: '#787469',
      water_light: '#4a7a9b',
      water_dark: '#2d4a6b',
      // Vegetation
      leaf_dark: '#3d5a2f',
      leaf_light: '#5a7d47',
      bark: '#6b5138',
      grain: '#c2a14d',
      // Animals
      fur_brown: '#8b6f47',
      fur_gray: '#7a7a7a',
      fur_light: '#a89968',
      flesh: '#c9956a',
      // NPCs
      skin: '#d4a574',
      hair_dark: '#4a3a2c',
      hair_light: '#8b7355',
      clothing_brown: '#6b5138',
      clothing_blue: '#3d586b',
      clothing_red: '#8b4a3a',
      // Structure
      wood: '#9c7544',
      stone_dark: '#6b5f52',
      // Effects
      white: '#ffffff',
      black: '#26201a'
    };
  }

  /**
   * Create a canvas and get 2D context
   */
  createCanvas(width, height) {
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!canvas) {
      throw new Error('Canvas not available in this environment');
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return {
      canvas,
      ctx
    };
  }

  /**
   * Terrain: Grass tile with variation
   */
  grassTile(variant = 0) {
    const {
      canvas,
      ctx
    } = this.createCanvas(32, 32);
    const seed = variant % 3;

    // Base
    ctx.fillStyle = this.palette.grass_light;
    ctx.fillRect(0, 0, 32, 32);

    // Darker patches (noise)
    ctx.fillStyle = this.palette.grass_dark;
    if (seed === 0) {
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillRect(16, 16, 16, 16);
    } else if (seed === 1) {
      ctx.fillRect(8, 8, 16, 16);
    } else {
      ctx.fillRect(0, 16, 32, 8);
    }

    // Grass tufts
    ctx.fillStyle = '#5a7d47';
    ctx.fillRect(4, 28, 2, 4);
    ctx.fillRect(12, 26, 3, 6);
    ctx.fillRect(20, 27, 2, 5);
    ctx.fillRect(28, 25, 2, 7);
    return canvas;
  }

  /**
   * Terrain: Tilled soil/farmland
   */
  soilTile(variant = 0) {
    const {
      canvas,
      ctx
    } = this.createCanvas(32, 32);

    // Base soil color
    ctx.fillStyle = this.palette.soil;
    ctx.fillRect(0, 0, 32, 32);

    // Tilled rows (depending on variant)
    ctx.strokeStyle = '#5a4a32';
    ctx.lineWidth = 2;
    if (variant % 2 === 0) {
      // Horizontal rows
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.lineTo(32, 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 16);
      ctx.lineTo(32, 16);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 24);
      ctx.lineTo(32, 24);
      ctx.stroke();
    } else {
      // Diagonal rows
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.lineTo(28, 32);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(32, 28);
      ctx.stroke();
    }
    return canvas;
  }

  /**
   * Terrain: Water tile
   */
  waterTile(variant = 0) {
    const {
      canvas,
      ctx
    } = this.createCanvas(32, 32);
    ctx.fillStyle = this.palette.water_light;
    ctx.fillRect(0, 0, 32, 32);

    // Wave pattern
    ctx.fillStyle = this.palette.water_dark;
    const phase = variant % 4;
    const positions = [[0, 8, 32, 6], [0, 4, 32, 6], [0, 12, 32, 6], [0, 16, 32, 6]];
    const [x, y, w, h] = positions[phase];
    ctx.fillRect(x, y, w, h);

    // Highlights
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(4, 6, 8, 3);
    ctx.fillRect(16, 14, 12, 2);
    return canvas;
  }

  /**
   * Terrain: Stone tile
   */
  stoneTile(variant = 0) {
    const {
      canvas,
      ctx
    } = this.createCanvas(32, 32);
    ctx.fillStyle = this.palette.stone;
    ctx.fillRect(0, 0, 32, 32);

    // Cracks and shadows
    ctx.strokeStyle = '#5a504a';
    ctx.lineWidth = 1;
    const patterns = [[[4, 0, 4, 16], [16, 8, 16, 24]], [[0, 12, 20, 12], [8, 20, 24, 20]], [[2, 2, 2, 30], [10, 4, 10, 28], [20, 0, 20, 32]]];
    for (const [x1, y1, x2, y2] of patterns[variant % 3]) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    return canvas;
  }

  /**
   * Plant: Grain/wheat crop
   */
  grainPlant(stage = 1) {
    const {
      canvas,
      ctx
    } = this.createCanvas(32, 32);
    ctx.fillStyle = this.palette.grass_light;
    ctx.fillRect(0, 0, 32, 32);

    // Stem
    ctx.fillStyle = this.palette.bark;
    ctx.fillRect(14, 16, 4, 12);

    // Grain head (grows with stage)
    const headY = stage === 1 ? 12 : stage === 2 ? 8 : 4;
    ctx.fillStyle = this.palette.grain;

    // Head shape
    ctx.beginPath();
    ctx.ellipse(16, headY, 6, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Seeds
    ctx.fillStyle = '#9c7544';
    for (let i = 0; i < 5; i++) {
      const x = 12 + i * 2;
      const y = headY - 4 + i % 2 * 2;
      ctx.fillRect(x, y, 2, 2);
    }
    return canvas;
  }

  /**
   * Plant: Tree (multiple growth stages)
   */
  tree(stage = 1, variant = 0) {
    const {
      canvas,
      ctx
    } = this.createCanvas(48, 48);
    ctx.fillStyle = this.palette.grass_light;
    ctx.fillRect(0, 0, 48, 48);

    // Trunk
    ctx.fillStyle = this.palette.bark;
    const trunkWidth = 4;
    const trunkHeight = stage === 1 ? 16 : stage === 2 ? 20 : 24;
    ctx.fillRect(22, 48 - trunkHeight, trunkWidth, trunkHeight);

    // Canopy (grows with stage)
    ctx.fillStyle = variant % 2 === 0 ? this.palette.leaf_dark : this.palette.leaf_light;
    const canopyY = 48 - trunkHeight - 12 - (stage - 1) * 4;
    if (stage === 1) {
      ctx.beginPath();
      ctx.ellipse(24, canopyY, 8, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (stage === 2) {
      ctx.beginPath();
      ctx.ellipse(24, canopyY, 12, 14, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(24, canopyY - 2, 14, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(24, canopyY + 6, 12, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas;
  }

  /**
   * Animal: Cow/livestock
   */
  livestock(type = 'cow', variant = 0) {
    const {
      canvas,
      ctx
    } = this.createCanvas(48, 32);
    ctx.fillStyle = this.palette.grass_light;
    ctx.fillRect(0, 0, 48, 32);
    const colors = {
      cow: [this.palette.fur_brown, this.palette.flesh],
      pig: [this.palette.fur_gray, this.palette.flesh],
      sheep: [this.palette.white, this.palette.flesh]
    };
    const [bodyColor, accentColor] = colors[type] || colors.cow;

    // Body
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(24, 18, 16, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(10, 16, 6, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.lineWidth = 3;
    ctx.strokeStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(16, 26);
    ctx.lineTo(16, 31);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(24, 26);
    ctx.lineTo(24, 31);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(32, 26);
    ctx.lineTo(32, 31);
    ctx.stroke();

    // Eyes
    ctx.fillStyle = '#000';
    ctx.fillRect(8, 14, 2, 2);
    ctx.fillRect(12, 14, 2, 2);

    // Horns or ears (depending on type)
    if (type === 'cow') {
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(7, 12);
      ctx.lineTo(4, 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(13, 12);
      ctx.lineTo(16, 8);
      ctx.stroke();
    }
    return canvas;
  }

  /**
   * Animal: Wild creature (deer, wolf, etc)
   */
  wildAnimal(type = 'deer', variant = 0) {
    const {
      canvas,
      ctx
    } = this.createCanvas(48, 32);
    ctx.fillStyle = this.palette.grass_light;
    ctx.fillRect(0, 0, 48, 32);
    const colors = {
      deer: this.palette.fur_light,
      wolf: this.palette.fur_gray,
      boar: this.palette.fur_brown
    };
    const bodyColor = colors[type] || colors.deer;

    // Body
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(26, 18, 14, 9, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Head (pointed)
    ctx.beginPath();
    ctx.ellipse(12, 16, 5, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs (thinner, more agile)
    ctx.lineWidth = 2;
    ctx.strokeStyle = bodyColor;
    for (let i = 0; i < 4; i++) {
      const x = 14 + i * 7;
      ctx.beginPath();
      ctx.moveTo(x, 25);
      ctx.lineTo(x, 31);
      ctx.stroke();
    }

    // Tail
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(38, 18);
    ctx.quadraticCurveTo(42, 16, 44, 20);
    ctx.stroke();

    // Eyes & features
    ctx.fillStyle = '#000';
    ctx.fillRect(10, 14, 2, 2);

    // Antlers/horns (deer only)
    if (type === 'deer') {
      ctx.strokeStyle = '#6b5138';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(10, 12);
      ctx.lineTo(6, 6);
      ctx.lineTo(8, 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(14, 12);
      ctx.lineTo(18, 6);
      ctx.lineTo(20, 2);
      ctx.stroke();
    }
    return canvas;
  }

  /**
   * NPC: Settler character
   */
  settler(gender = 'male', skinTone = 0, hairStyle = 0) {
    const {
      canvas,
      ctx
    } = this.createCanvas(32, 48);
    ctx.fillStyle = this.palette.grass_light;
    ctx.fillRect(0, 0, 32, 48);

    // Adjust skin tone
    const skinTones = ['#d4a574', '#c9956a', '#e8c9a0', '#b8956a'];
    const skin = skinTones[skinTone % skinTones.length];

    // Head
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(16, 12, 6, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    const hairColors = [this.palette.hair_dark, this.palette.hair_light, '#4a5a3a', '#8b6f47'];
    ctx.fillStyle = hairColors[hairStyle % hairColors.length];
    if (gender === 'female') {
      ctx.beginPath();
      ctx.ellipse(16, 10, 7, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(16, 9, 7, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Body
    ctx.fillStyle = this.palette.clothing_brown;
    ctx.fillRect(10, 20, 12, 16);

    // Arms
    ctx.lineWidth = 3;
    ctx.strokeStyle = skin;
    ctx.beginPath();
    ctx.moveTo(10, 22);
    ctx.lineTo(4, 28);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(22, 22);
    ctx.lineTo(28, 28);
    ctx.stroke();

    // Legs
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.palette.clothing_blue;
    ctx.beginPath();
    ctx.moveTo(12, 36);
    ctx.lineTo(12, 46);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(20, 36);
    ctx.lineTo(20, 46);
    ctx.stroke();

    // Eyes
    ctx.fillStyle = '#000';
    ctx.fillRect(14, 10, 1.5, 1.5);
    ctx.fillRect(17.5, 10, 1.5, 1.5);
    return canvas;
  }

  /**
   * Structure: Wooden house
   */
  house(roofColor = this.palette.wood) {
    const {
      canvas,
      ctx
    } = this.createCanvas(48, 48);
    ctx.fillStyle = this.palette.grass_light;
    ctx.fillRect(0, 0, 48, 48);

    // Walls
    ctx.fillStyle = this.palette.wood;
    ctx.fillRect(8, 20, 32, 20);

    // Roof
    ctx.fillStyle = roofColor;
    ctx.beginPath();
    ctx.moveTo(8, 20);
    ctx.lineTo(24, 8);
    ctx.lineTo(40, 20);
    ctx.closePath();
    ctx.fill();

    // Door
    ctx.fillStyle = '#6b5138';
    ctx.fillRect(20, 32, 8, 8);
    ctx.fillStyle = '#8b6f47';
    ctx.fillRect(26, 36, 1, 1);

    // Windows
    ctx.fillStyle = '#3d586b';
    ctx.fillRect(12, 24, 5, 5);
    ctx.fillRect(31, 24, 5, 5);

    // Window panes
    ctx.strokeStyle = this.palette.wood;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(14.5, 24);
    ctx.lineTo(14.5, 29);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(12, 26.5);
    ctx.lineTo(17, 26.5);
    ctx.stroke();
    return canvas;
  }

  /**
   * Item: Generic resource
   */
  resource(type = 'grain', variant = 0) {
    const {
      canvas,
      ctx
    } = this.createCanvas(24, 24);
    ctx.fillStyle = this.palette.grass_light;
    ctx.fillRect(0, 0, 24, 24);
    const colors = {
      grain: this.palette.grain,
      wood: this.palette.wood,
      stone: this.palette.stone,
      tool: '#7a7a7a',
      food: '#c9956a',
      weapon: '#6b5138'
    };
    const color = colors[type] || this.palette.grain;
    ctx.fillStyle = color;
    if (type === 'grain') {
      ctx.beginPath();
      ctx.ellipse(12, 12, 6, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'wood') {
      ctx.fillRect(6, 4, 12, 16);
    } else if (type === 'stone') {
      ctx.beginPath();
      ctx.moveTo(12, 4);
      ctx.lineTo(18, 10);
      ctx.lineTo(16, 20);
      ctx.lineTo(8, 20);
      ctx.lineTo(6, 10);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'tool') {
      ctx.fillRect(8, 6, 8, 12);
      ctx.fillRect(6, 8, 12, 2);
    } else if (type === 'food') {
      ctx.beginPath();
      ctx.ellipse(12, 12, 5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'weapon') {
      ctx.beginPath();
      ctx.moveTo(12, 4);
      ctx.lineTo(16, 8);
      ctx.lineTo(14, 20);
      ctx.lineTo(10, 20);
      ctx.lineTo(8, 8);
      ctx.closePath();
      ctx.fill();
    }
    return canvas;
  }

  /**
   * Weather effect: Rain/mist
   */
  rainEffect(intensity = 1) {
    const {
      canvas,
      ctx
    } = this.createCanvas(32, 32);
    ctx.fillStyle = 'rgba(200, 210, 230, 0.1)';
    ctx.fillRect(0, 0, 32, 32);
    ctx.strokeStyle = 'rgba(180, 200, 230, ' + 0.3 * intensity + ')';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5 * intensity; i++) {
      const x = Math.random() * 32;
      const y = Math.random() * 32;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 2, y + 4);
      ctx.stroke();
    }
    return canvas;
  }

  /**
   * Weather effect: Snow
   */
  snowEffect(intensity = 1) {
    const {
      canvas,
      ctx
    } = this.createCanvas(32, 32);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = 'rgba(255, 255, 255, ' + 0.6 * intensity + ')';
    for (let i = 0; i < 6 * intensity; i++) {
      const x = Math.random() * 32;
      const y = Math.random() * 32;
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas;
  }

  /**
   * Weather effect: Dust/smoke
   */
  dustEffect(intensity = 1) {
    const {
      canvas,
      ctx
    } = this.createCanvas(32, 32);
    ctx.fillStyle = 'rgba(200, 180, 150, 0.05)';
    ctx.fillRect(0, 0, 32, 32);

    // Particle clouds
    for (let i = 0; i < 3 * intensity; i++) {
      const x = Math.random() * 32;
      const y = Math.random() * 32;
      const size = 2 + Math.random() * 4;
      ctx.fillStyle = 'rgba(200, 180, 150, ' + 0.2 * Math.random() + ')';
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas;
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpriteGenerator;
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "assets/sprite-generator.js", error: String((e && e.message) || e) }); }

// components/containers/Panel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Panel({
  children,
  title,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--color-surface)',
      border: 'var(--border-width-normal) solid var(--color-border)',
      padding: 'var(--padding-md)',
      fontSize: 'var(--font-size-base)'
    }
  }, props), title && /*#__PURE__*/React.createElement("h3", {
    style: {
      color: 'var(--color-text-accent)',
      fontSize: 'var(--font-size-md)',
      marginBottom: 'var(--gap-md)',
      borderBottom: 'var(--border-width-thin) solid var(--color-border)',
      paddingBottom: 'var(--gap-sm)'
    }
  }, title), children);
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/containers/Panel.jsx", error: String((e && e.message) || e) }); }

// components/controls/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Button({
  children,
  variant = "default",
  disabled = false,
  ...props
}) {
  const baseStyles = {
    fontFamily: 'var(--font-family-base)',
    fontSize: 'var(--font-size-sm)',
    padding: 'var(--padding-sm) var(--padding-md)',
    border: 'var(--border-width-thin) solid',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'var(--transition-fast)',
    fontWeight: 'var(--font-weight-normal)'
  };
  const variants = {
    default: {
      ...baseStyles,
      background: 'var(--color-bg-hover)',
      color: 'var(--color-text-primary)',
      borderColor: 'var(--color-border)'
    },
    primary: {
      ...baseStyles,
      background: 'var(--color-border)',
      color: 'var(--color-text-accent)',
      borderColor: 'var(--color-text-accent)'
    },
    success: {
      ...baseStyles,
      background: 'rgba(143, 194, 106, 0.15)',
      color: 'var(--color-success)',
      borderColor: 'var(--color-success)'
    },
    danger: {
      ...baseStyles,
      background: 'rgba(224, 122, 90, 0.15)',
      color: 'var(--color-danger)',
      borderColor: 'var(--color-danger)'
    }
  };
  const style = disabled ? {
    ...variants[variant],
    opacity: 0.5,
    color: '#555'
  } : variants[variant];
  return /*#__PURE__*/React.createElement("button", _extends({
    style: style,
    disabled: disabled
  }, props), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Button.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Badge.jsx
try { (() => {
function Badge({
  children,
  variant = "default"
}) {
  const variants = {
    default: {
      background: 'var(--color-border)',
      color: 'var(--color-text-accent)'
    },
    info: {
      background: 'rgba(154, 176, 196, 0.2)',
      color: 'var(--color-text-info)'
    },
    success: {
      background: 'rgba(143, 194, 106, 0.2)',
      color: 'var(--color-success)'
    },
    warning: {
      background: 'rgba(194, 161, 77, 0.2)',
      color: 'var(--color-warning)'
    }
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      padding: '2px 6px',
      fontSize: 'var(--font-size-xs)',
      border: 'var(--border-width-thin) solid currentColor',
      ...variants[variant]
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Badge.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Bar.jsx
try { (() => {
function Bar({
  label,
  value,
  max = 100,
  color = "var(--color-success)"
}) {
  const percentage = value / max * 100;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--gap-md)',
      marginBottom: 'var(--gap-sm)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '50px',
      fontSize: 'var(--font-size-xs)',
      color: 'var(--color-text-tertiary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: '8px',
      background: 'var(--color-bg-hover)',
      border: 'var(--border-width-thin) solid var(--color-border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      width: `${Math.min(percentage, 100)}%`,
      background: color,
      transition: 'var(--transition-base)'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      width: '24px',
      textAlign: 'right',
      fontSize: 'var(--font-size-xs)',
      color: 'var(--color-text-secondary)'
    }
  }, value));
}
Object.assign(__ds_scope, { Bar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Bar.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Icon({
  id,
  size = "md",
  variant,
  className,
  ...props
}) {
  const sizeMap = {
    sm: "icon-sm",
    md: "icon-md",
    lg: "icon-lg"
  };
  const variantMap = {
    success: "icon-success",
    warning: "icon-warning",
    danger: "icon-danger",
    info: "icon-info"
  };
  return /*#__PURE__*/React.createElement("i", _extends({
    className: `icon ${sizeMap[size]} ${variant ? variantMap[variant] : ""} ${className || ""}`,
    "data-icon": id
  }, props));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Icon.jsx", error: String((e && e.message) || e) }); }

// components/forms/Label.jsx
try { (() => {
function Label({
  children,
  required = false
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'block',
      fontSize: 'var(--font-size-sm)',
      color: 'var(--color-text-secondary)',
      marginBottom: 'var(--gap-xs)',
      fontWeight: 'var(--font-weight-normal)'
    }
  }, children, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--color-danger)',
      marginLeft: '2px'
    }
  }, "*"));
}
Object.assign(__ds_scope, { Label });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Label.jsx", error: String((e && e.message) || e) }); }

// components/navigation/MenuItem.jsx
try { (() => {
function MenuItem({
  label,
  hotkey,
  disabled = false,
  onClick
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 'var(--gap-sm) var(--gap-md)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      background: 'transparent',
      transition: 'var(--transition-fast)',
      borderLeft: '2px solid transparent',
      fontSize: 'var(--font-size-sm)',
      color: 'var(--color-text-secondary)',
      ':hover': !disabled && {
        borderLeftColor: 'var(--color-text-accent)'
      }
    },
    onClick: !disabled && onClick
  }, /*#__PURE__*/React.createElement("span", null, label), hotkey && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--font-size-xs)',
      color: 'var(--color-text-muted)'
    }
  }, hotkey));
}
Object.assign(__ds_scope, { MenuItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/MenuItem.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Bar = __ds_scope.Bar;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.Label = __ds_scope.Label;

__ds_ns.MenuItem = __ds_scope.MenuItem;

})();
