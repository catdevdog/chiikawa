import { describe, expect, it } from 'vitest';
import { classify, MAX_LINE_CHARS, MAX_LINES_PER_EVENT, parseLines, Speaker, textWidth } from '../src/engine/speech';
import { mulberry32, SAY_EVENTS } from '../src/engine';

describe('classify', () => {
  it('sounds and short cries float', () => {
    for (const t of ['야하!', '하아?', '푸루루루루루~', '우라라라라라라라라!', '깜짝이야!?', '하아? 하아?', '츠츠 우라우라', '!']) expect(classify(t), t).toBe('float');
  });

  it('sentences are held', () => {
    for (const t of ['세 번이나… 놀자는 거야!?', '여긴… 다른 화면이라는 거야!?', '오늘도 어떻게든 돼!', 'Where did the cursor go']) expect(classify(t), t).toBe('hold');
  });

  it('one very long word is a sentence too', () => {
    expect(classify('아주아주아주아주아주아주길어요')).toBe('hold');
  });
});

describe('parseLines', () => {
  it('reads strings and objects, and decides the style when it is not given', () => {
    const lines = parseLines({ click: ['하아?', { text: '하아? 하아?', style: 'hold' }, { text: '오늘도 어떻게든 돼!' }] });
    expect(lines.click).toEqual([
      { text: '하아?', style: 'float' },
      { text: '하아? 하아?', style: 'hold' },
      { text: '오늘도 어떻게든 돼!', style: 'hold' },
    ]);
  });

  it('keeps only known situations', () => {
    const lines = parseLines({ click: ['a'], dance: ['b'], toString: ['c'] });
    expect(Object.keys(lines)).toEqual(['click']);
  });

  it('drops entries that are not text, empty, or only blanks', () => {
    const lines = parseLines({ click: [1, null, '', '   ', { style: 'float' }, { text: 5 }, ['x'], '야하!'] });
    expect(lines.click).toEqual([{ text: '야하!', style: 'float' }]);
  });

  it('tidies the text: control characters and runs of blanks become one space, long lines are cut', () => {
    const lines = parseLines({ click: ['  하아?\n\t하아?  ', 'x'.repeat(100)] });
    expect(lines.click![0]!.text).toBe('하아? 하아?');
    expect([...lines.click![1]!.text]).toHaveLength(MAX_LINE_CHARS);
  });

  it('keeps at most so many lines per situation', () => {
    const lines = parseLines({ click: Array.from({ length: 50 }, (_, i) => `line${i}`) });
    expect(lines.click).toHaveLength(MAX_LINES_PER_EVENT);
  });

  it('ignores anything that is not an object', () => {
    for (const bad of [null, undefined, 5, 'click', [], true]) expect(parseLines(bad)).toEqual({});
  });

  it('an unknown style falls back to the automatic one', () => {
    expect(parseLines({ click: [{ text: '야하!', style: 'shout' }] }).click![0]!.style).toBe('float');
  });
});

describe('textWidth', () => {
  it('counts Hangul as a full em and Latin letters as less, and grows with the size', () => {
    expect(textWidth('가나다', 20)).toBeGreaterThan(textWidth('abc', 20));
    expect(textWidth('가나다', 40)).toBeCloseTo(textWidth('가나다', 20) * 2);
    expect(textWidth('', 20)).toBe(0);
  });
});

describe('Speaker', () => {
  const lines = parseLines({
    click: ['하아?', '하아!?', '야하!'],
    hover: ['후응'],
    idle: ['후응…'],
    start: ['미야아아!'],
  });
  const make = (rng = mulberry32(3)) => {
    const sp = new Speaker(rng);
    sp.setLines(lines);
    return sp;
  };

  it('has nothing to say without lines, and does not touch the random numbers', () => {
    let calls = 0;
    const sp = new Speaker(() => (calls++, 0.5));
    expect(sp.any).toBe(false);
    expect(sp.pick('click', 1000, false)).toBeNull();
    expect(calls).toBe(0);
  });

  it('knows whether it has anything to say', () => {
    expect(make().any).toBe(true);
    const sp = make();
    sp.setLines({});
    expect(sp.any).toBe(false);
  });

  it('picks one of the lines of the situation', () => {
    const line = make().pick('click', 1000, false)!;
    expect(['하아?', '하아!?', '야하!']).toContain(line.text);
  });

  it('says nothing for a situation it has no line for', () => {
    expect(make().pick('land', 1000, false)).toBeNull();
  });

  it('waits out the cooldown of a situation', () => {
    const sp = make();
    expect(sp.pick('click', 1000, false)).not.toBeNull();
    expect(sp.pick('click', 1200, false)).toBeNull();
    expect(sp.pick('click', 1500, false)).not.toBeNull();
  });

  it('never says the same line twice in a row', () => {
    const sp = make(() => 0);
    let last = '';
    for (let t = 1000; t < 40_000; t += 1000) {
      const line = sp.pick('click', t, false)!;
      expect(line.text).not.toBe(last);
      last = line.text;
    }
  });

  it('a lone line may repeat (there is nothing else)', () => {
    const sp = make(() => 0);
    expect(sp.pick('start', 1000, false)!.text).toBe('미야아아!');
    expect(sp.pick('start', 2000, false)!.text).toBe('미야아아!');
  });

  it('a situation with a chance below one is sometimes silent and does not use up its cooldown then', () => {
    const rolls = [0.99, 0.0];
    const sp = make(() => rolls.shift() ?? 0);
    expect(sp.pick('hover', 1000, false)).toBeNull();
    expect(sp.pick('hover', 1001, false)).not.toBeNull();
  });

  it('does not talk over words that are still up, unless the situation is urgent', () => {
    const sp = make(() => 0);
    expect(sp.pick('hover', 1000, true)).toBeNull();
    expect(sp.pick('click', 1000, true)).not.toBeNull();
  });

  it('keeps some distance between two lines unless the second is urgent', () => {
    const sp = make(() => 0);
    expect(sp.pick('click', 1000, false)).not.toBeNull();
    expect(sp.pick('hover', 1300, false)).toBeNull();
    expect(sp.pick('hover', 2000, false)).not.toBeNull();
    expect(sp.pick('click', 2100, false)).not.toBeNull();
  });

  it('the level "reactions" drops the murmurs and "off" everything', () => {
    const sp = make(() => 0);
    sp.setLevel('reactions');
    expect(sp.pick('idle', 1000, false)).toBeNull();
    expect(sp.pick('click', 1000, false)).not.toBeNull();
    sp.setLevel('off');
    expect(sp.pick('click', 9000, false)).toBeNull();
    sp.setLevel('all');
    expect(sp.pick('idle', 20_000, false)).not.toBeNull();
  });

  it('every situation has a rule', () => {
    const sp = new Speaker(() => 0);
    sp.setLines(Object.fromEntries(SAY_EVENTS.map((e) => [e, [{ text: '야하!', style: 'float' }]])));
    let now = 100_000;
    for (const e of SAY_EVENTS) expect(sp.pick(e, (now += 5000), false), e).not.toBeNull();
  });
});
