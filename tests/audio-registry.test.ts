import { describe, it, expect } from 'vitest';
import { musicStemSlot, ambienceStemSlot } from '../src/ui/audio/audioRegistry';
import { ERAS, eraForYear } from '../src/ui/music';

describe('musicStemSlot', () => {
  it('names a music stem for each era window, matching the music engine', () => {
    expect(musicStemSlot(1900)).toBe('music-ragtime');
    expect(musicStemSlot(1925)).toBe('music-chipjazz');
    expect(musicStemSlot(1950)).toBe('music-midcentury');
    expect(musicStemSlot(1980)).toBe('music-analog');
    expect(musicStemSlot(2010)).toBe('music-electronica');
    expect(musicStemSlot(2080)).toBe('music-future');
  });

  it('clamps below the first era to the first era stem', () => {
    expect(musicStemSlot(1850)).toBe(`music-${ERAS[0].id}`);
  });

  it('stays in lockstep with eraForYear across the century', () => {
    for (let y = 1900; y <= 2100; y += 7) {
      expect(musicStemSlot(y)).toBe(`music-${eraForYear(y).id}`);
    }
  });
});

describe('ambienceStemSlot', () => {
  it('names an ambience bed on the same era windows as the music stems', () => {
    expect(ambienceStemSlot(1900)).toBe('ambience-ragtime');
    expect(ambienceStemSlot(2080)).toBe('ambience-future');
  });

  it('shares the music stem era so beds and themes turn over together', () => {
    for (let y = 1900; y <= 2100; y += 13) {
      expect(ambienceStemSlot(y).replace('ambience-', '')).toBe(
        musicStemSlot(y).replace('music-', ''),
      );
    }
  });
});
