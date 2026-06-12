/**
 * Sprite Animation System v2
 * Builds keyframe animations by calling SpriteGenerator with pose/frame params.
 */

class SpriteAnimator {
  constructor(spriteGenerator) {
    this.gen = spriteGenerator;
  }

  _anim(frames, frameRate, type = 'idle') {
    return { frames, frameRate, loop: true, type };
  }

  /**
   * Idle / ambient animations (breathing, head bobs, growth cycles)
   */
  idleAnimation(spriteType, params = {}) {
    const g = this.gen;
    if (spriteType === 'settler') {
      return this._anim(
        [0, 0, 1, 1].map(f => g.settler(params.gender || 'male', params.skin || 0, params.hair || 0, { pose: 'idle', frame: f })),
        4, 'idle');
    }
    if (spriteType === 'livestock') {
      return this._anim(
        [0, 1, 0, 2].map(f => g.livestock(params.type || 'cow', params.variant || 0, f)),
        4, 'idle');
    }
    if (spriteType === 'wildAnimal') {
      return this._anim(
        [0, 1, 0, 2].map(f => g.wildAnimal(params.type || 'deer', params.variant || 0, f)),
        5, 'idle');
    }
    if (spriteType === 'grainPlant') {
      return this._anim([1, 2, 3].map(s => g.grainPlant(s)), 2, 'growth');
    }
    if (spriteType === 'tree') {
      return this._anim([1, 2, 3].map(s => g.tree(s, params.variant || 0)), 1, 'growth');
    }
    if (spriteType === 'water') {
      return this._anim([0, 1, 2, 3].map(v => g.waterTile(v)), 5, 'idle');
    }
    return this._anim([], 10);
  }

  /**
   * Work animations (farming hoe swing, mining pickaxe)
   */
  workAnimation(workType, params = {}) {
    const g = this.gen, p = params;
    if (workType === 'farming') {
      return this._anim(
        [0, 1, 2, 3, 4, 5].map(f => g.settler(p.gender || 'male', p.skin || 0, p.hair || 0, { pose: 'farm', frame: f })),
        8, 'work');
    }
    if (workType === 'mining') {
      return this._anim(
        [0, 1, 2, 3].map(f => g.settler(p.gender || 'male', p.skin || 0, p.hair || 0, { pose: 'mine', frame: f })),
        7, 'work');
    }
    return this._anim([], 10);
  }

  /**
   * Movement animations (walking cycle)
   */
  movementAnimation(movementType, params = {}) {
    const g = this.gen, p = params;
    if (movementType === 'walk') {
      return this._anim(
        [0, 1, 2, 3].map(f => g.settler(p.gender || 'male', p.skin || 0, p.hair || 0, { pose: 'walk', frame: f })),
        7, 'movement');
    }
    return this._anim([], 10);
  }

  /**
   * Get the frame canvas for a given elapsed time (ms)
   */
  render(animation, timeMs = 0) {
    if (!animation.frames || animation.frames.length === 0) return null;
    const frameDuration = 1000 / animation.frameRate;
    const frameIndex = Math.floor(timeMs / frameDuration) % animation.frames.length;
    return animation.frames[frameIndex];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpriteAnimator;
}
