import { describe, expect, it } from 'vitest';
import { guessPose, slugify } from '../src/maker/guess';

describe('guessPose', () => {
  it('reads English keywords from the file name', () => {
    expect(guessPose('chiikawa_sleeping_01.png')).toBe('sleep');
    expect(guessPose('hachi-happy.gif')).toBe('happy');
    expect(guessPose('surprised.webp')).toBe('surprised');
    expect(guessPose('walk2.gif')).toBe('walk');
    expect(guessPose('Run_cycle.PNG')).toBe('run');
    expect(guessPose('idle.png')).toBe('idle');
    expect(guessPose('default_pose.png')).toBe('idle');
    expect(guessPose('drag_pose.png')).toBe('held');
  });

  it('reads Korean and Japanese keywords', () => {
    expect(guessPose('치이카와_잠.png')).toBe('sleep');
    expect(guessPose('놀람.gif')).toBe('surprised');
    expect(guessPose('기쁨_01.png')).toBe('happy');
    expect(guessPose('걷기.gif')).toBe('walk');
    expect(guessPose('기본.png')).toBe('idle');
    expect(guessPose('びっくり.png')).toBe('surprised');
  });

  it('does not match keywords inside longer words and ignores the extension', () => {
    expect(guessPose('sunrunner.png')).toBeNull();
    expect(guessPose('landscape.png')).toBeNull();
    expect(guessPose('unknown_name_03.png')).toBeNull();
    expect(guessPose('picture.sleep')).toBeNull(); // "sleep" is only the extension here
  });
});

describe('slugify', () => {
  it('makes folder-safe ids', () => {
    expect(slugify('My Skin 2')).toBe('my-skin-2');
    expect(slugify('  --Hello__World!! ')).toBe('hello-world');
    expect(slugify('치이카와')).toBe('');
    expect(slugify('a'.repeat(80))).toHaveLength(40);
  });
});
