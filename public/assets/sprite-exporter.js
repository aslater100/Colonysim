/**
 * Sprite Export Utilities
 * Convert canvas sprites to PNG or other formats for game engines
 */

class SpriteExporter {
  /**
   * Export canvas to PNG blob
   */
  static canvasToPNG(canvas) {
    return new Promise((resolve) => {
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
        ...config,
      },
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
        name: `${name}_${i}`,
      })),
    };

    return {
      json,
      png,
      jsonString: JSON.stringify(json, null, 2),
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpriteExporter;
}
