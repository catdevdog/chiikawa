import { syncCorrection, type SceneCommand, type SceneManifest, type SceneStateReport } from '../shared/scene';
import type { Area } from '../shared/types';
import { loadPose, resolveInside, type Sprite } from './skin';

/** What the drawing needs of a scene that plays: where its feet are (the nearer pets are drawn in front of it) and how to draw its picture now. */
export interface DrawnScene {
  /** the row of the shared space the picture stands on */
  feetY: number;
  draw(ctx: CanvasRenderingContext2D): void;
}

/** A scene that is not ready after this long (ms) is given up on (the stage waits a little longer than this). */
const READY_MS = 6500;

/** Where the sound is read from: the picture, the sound, or (for a picture with no sound) the clock of the page. */
type Clock = 'video' | 'audio' | 'system';

/** One showing: the files it plays, how it keeps time, and where it is. */
interface Run {
  run: number;
  id: string;
  manifest: SceneManifest;
  rect: Area;
  clock: Clock;
  video: HTMLVideoElement | null;
  audio: HTMLAudioElement | null;
  sprite: Sprite | null;
  /** loaded and started: it is drawn and listened to */
  playing: boolean;
  /** when it started (the page's clock, ms) */
  t0: number;
  /** the sound has been started (it is started late when it is to come after the picture) */
  audioStarted: boolean;
  /** the picture time (ms) when the sound ended, and when: the picture goes on by the clock of the page from there */
  audioEnd: { pictureMs: number; at: number } | null;
  /** a stop came (or another scene) while it was loading, or it is over */
  done: boolean;
  startTimer: ReturnType<typeof setTimeout> | null;
  /** when the video was last moved to where the sound is, and when it was last asked to play (the page's clock, ms) */
  lastSeek: number;
  lastPlay: number;
}

/** The video is not moved again for this long (ms) after it was: moving it takes a moment, and doing it at every frame would only hold it up. */
const SEEK_GAP_MS = 500;
const PLAY_GAP_MS = 250;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Plays the scene the main process hands this window: a video or pictures with a sound, drawn where it says. The picture is kept
 * in step with the sound (which is the clock) while it plays, and the main process hears when it plays, when it is over, and when
 * it could not be played. Only the window that is given a scene has one.
 */
export class ScenePlayer {
  private current: Run | null = null;

  constructor(
    private readonly report: (r: SceneStateReport) => void,
    private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void,
    /** where the folders of scenes are, as a path of the page */
    private readonly base = '/scenes',
  ) {}

  /** Is a scene on, and drawn? (A window with one has to be drawn at every frame.) */
  get active(): boolean {
    return this.current?.playing === true;
  }

  handle(command: SceneCommand): void {
    if (command.kind === 'start') void this.start(command);
    else if (this.current?.run === command.run) {
      if (command.kind === 'stop') this.dispose(this.current);
      else this.setVolume(this.current, command.volume);
    }
  }

  /** Called at every frame while a scene plays: keeps the picture with the sound, and ends the scene when it is over. */
  tick(now: number): void {
    const r = this.current;
    if (!r?.playing) return;
    if (r.clock === 'audio' && r.video) this.followSound(r, now);
    if (this.isOver(r, now)) this.finish(r, 'ended');
  }

  /** Where the scene is, for the end-to-end tests: the clock it keeps time by, the picture time, and what the video and the sound say. */
  debug(now: number = performance.now()): { run: number; id: string; clock: Clock; playing: boolean; pictureMs: number; videoMs: number | null; audioMs: number | null; rate: number | null } | null {
    const r = this.current;
    if (!r) return null;
    return {
      run: r.run,
      id: r.id,
      clock: r.clock,
      playing: r.playing,
      pictureMs: this.pictureMs(r, now),
      videoMs: r.video ? r.video.currentTime * 1000 : null,
      audioMs: r.audio ? r.audio.currentTime * 1000 : null,
      rate: r.video ? r.video.playbackRate : null,
    };
  }

  /** The scene as it is to be drawn at `now`, or null when none plays. */
  drawable(now: number): DrawnScene | null {
    const r = this.current;
    if (!r?.playing) return null;
    const { rect, manifest } = r;
    return {
      feetY: rect.y + manifest.anchor.y * rect.height,
      draw: (ctx) => {
        const shot = this.shot(r, now);
        if (!shot) return;
        // fitted into its box, bottom-centred, as a skin's poses are
        const fit = Math.min(rect.width / shot.width, rect.height / shot.height);
        const w = shot.width * fit;
        const h = shot.height * fit;
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(shot.image, rect.x + (rect.width - w) / 2, rect.y + rect.height - h, w, h);
        ctx.restore();
      },
    };
  }

  // --- internals -----------------------------------------------------------

  private async start(c: Extract<SceneCommand, { kind: 'start' }>): Promise<void> {
    if (this.current) this.dispose(this.current);
    const m = c.manifest;
    const dir = `${this.base}/${c.id}/`;
    const clock: Clock = m.audio ? 'audio' : m.video ? 'video' : 'system';
    const r: Run = { run: c.run, id: c.id, manifest: m, rect: c.rect, clock, video: null, audio: null, sprite: null, playing: false, t0: 0, audioStarted: false, audioEnd: null, done: false, startTimer: null, lastSeek: -Infinity, lastPlay: -Infinity };
    this.current = r;
    try {
      if (m.video) {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.playsInline = true;
        // a video with a sound of its own beside it is only to be looked at
        video.muted = clock === 'audio';
        video.volume = clock === 'video' ? clamp01(c.volume) : 0;
        video.src = resolveInside(dir, m.video);
        r.video = video;
      }
      if (m.audio) {
        const audio = new Audio();
        audio.preload = 'auto';
        audio.volume = clamp01(c.volume);
        audio.src = resolveInside(dir, m.audio);
        r.audio = audio;
      }
      const loads: Promise<unknown>[] = [];
      if (r.video) loads.push(ready(r.video));
      if (r.audio) loads.push(ready(r.audio));
      if (m.picture) loads.push(loadPose(dir, m.picture, m.size).then((sprite) => (r.sprite = sprite)));
      await Promise.all(loads);
      if (r.done) return;
      await this.begin(r);
      if (r.done) return;
      r.playing = true;
      this.report({ run: r.run, state: 'playing' });
      this.log('info', `scene ${r.id} plays (${clock})`);
    } catch (err) {
      if (r.done) return;
      this.finish(r, 'failed', err instanceof Error ? err.message : String(err));
    }
  }

  /** Starts the sound and the picture together; the sound later when the scene says it comes after the picture. */
  private async begin(r: Run): Promise<void> {
    const offset = r.manifest.offsetMs;
    r.t0 = performance.now();
    for (const el of [r.video, r.audio]) {
      el?.addEventListener('error', () => {
        if (!r.done) this.finish(r, 'failed', `${el === r.audio ? 'the sound' : 'the video'} stopped: ${el?.error?.message ?? 'an error'}`);
      });
    }
    if (r.audio) {
      r.audio.addEventListener('ended', () => {
        r.audioEnd = { pictureMs: r.audio!.duration * 1000 + offset, at: performance.now() };
      });
    }
    // the sound and the picture start together; the sound later when it comes after the picture, the picture later (it waits, see
    // followSound) when it comes after the sound. A video with a sound of its own is simply played.
    const starts: Promise<void>[] = [];
    if (r.audio && offset <= 0) {
      starts.push(
        r.audio.play().then(() => {
          r.audioStarted = true;
        }),
      );
    } else if (r.audio) {
      r.startTimer = setTimeout(() => {
        r.startTimer = null;
        if (r.done) return;
        r.audioStarted = true;
        r.audio!.play().catch((err: unknown) => this.finish(r, 'failed', `the sound could not be played: ${String(err)}`));
      }, offset);
    }
    if (r.video && (r.clock === 'video' || offset >= 0)) starts.push(r.video.play());
    await Promise.all(starts);
  }

  /** The picture time (ms) now: where in the picture the scene is, by the clock the scene keeps time with. */
  private pictureMs(r: Run, now: number): number {
    switch (r.clock) {
      case 'video':
        return (r.video?.currentTime ?? 0) * 1000;
      case 'audio':
        if (r.audioEnd) return r.audioEnd.pictureMs + (now - r.audioEnd.at);
        return r.audioStarted && r.audio ? r.audio.currentTime * 1000 + r.manifest.offsetMs : now - r.t0;
      default:
        return now - r.t0;
    }
  }

  /** The video follows the sound: it waits while the sound is still to come, plays, and is sped up, slowed down or moved when it drifts. */
  private followSound(r: Run, now: number): void {
    const v = r.video!;
    const want = this.pictureMs(r, now);
    if (want < 0) {
      // the sound comes before the picture: the first picture waits
      if (!v.paused) v.pause();
      if (v.currentTime !== 0) v.currentTime = 0;
      return;
    }
    if (v.ended) return;
    if (v.paused && now - r.lastPlay >= PLAY_GAP_MS) {
      r.lastPlay = now;
      void v.play().catch(() => {});
    }
    // once the sound is over there is nothing to keep time with
    if (r.audioEnd) {
      if (v.playbackRate !== 1) v.playbackRate = 1;
      return;
    }
    const fix = syncCorrection(v.currentTime * 1000 - want);
    if (fix.seek && now - r.lastSeek >= SEEK_GAP_MS) {
      r.lastSeek = now;
      v.currentTime = want / 1000;
    }
    const rate = fix.seek ? 1 : fix.rate;
    if (v.playbackRate !== rate) v.playbackRate = rate;
  }

  /** Is the scene over: the picture and the sound have both come to their ends? */
  private isOver(r: Run, now: number): boolean {
    // a picture that does not move has no end of its own: the sound decides (and without one the scene goes on until it is clicked)
    const pictureDone = r.video ? r.video.ended : r.sprite && Number.isFinite(r.sprite.duration) ? this.pictureMs(r, now) >= r.sprite.duration : r.audio !== null;
    const soundDone = r.audio ? r.audioEnd !== null : true;
    return pictureDone && soundDone;
  }

  /** What is to be drawn now: the frame of the video, or the picture at this time (the last one once it is over, not the first again). */
  private shot(r: Run, now: number): { image: CanvasImageSource; width: number; height: number } | null {
    if (r.video) return r.video.readyState >= 2 && r.video.videoWidth > 0 ? { image: r.video, width: r.video.videoWidth, height: r.video.videoHeight } : null;
    if (!r.sprite) return null;
    const total = r.sprite.duration;
    const t = Math.max(0, this.pictureMs(r, now));
    return r.sprite.frameAt(Number.isFinite(total) ? Math.min(t, total - 1) : t);
  }

  private setVolume(r: Run, volume: number): void {
    const v = clamp01(volume);
    if (r.audio) r.audio.volume = v;
    else if (r.video && r.clock === 'video') r.video.volume = v;
  }

  /** The scene is over (or failed): it is let go of, and the main process is told. */
  private finish(r: Run, state: 'ended' | 'failed', message?: string): void {
    if (r.done) return;
    this.dispose(r);
    if (state === 'failed') this.log('warn', `scene ${r.id} failed: ${message ?? ''}`);
    this.report({ run: r.run, state, ...(message === undefined ? {} : { message }) });
  }

  /** Lets go of the files and the sound, and of the scene itself if it is the one that is current. */
  private dispose(r: Run): void {
    r.done = true;
    r.playing = false;
    if (r.startTimer) clearTimeout(r.startTimer);
    for (const el of [r.video, r.audio]) {
      if (!el) continue;
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    // the pictures of an animation are bitmaps: give their memory back now
    for (const f of r.sprite?.frames ?? []) if (f.image instanceof ImageBitmap) f.image.close();
    r.sprite = null;
    if (this.current === r) this.current = null;
  }
}

/** Resolves when the media can play through, and fails when it cannot be loaded or takes too long. */
function ready(el: HTMLMediaElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('it took too long to load')), READY_MS);
    const onReady = (): void => done();
    const onError = (): void => done(new Error(`it could not be loaded: ${el.error?.message || `error ${el.error?.code ?? '?'}`}`));
    function done(err?: Error): void {
      clearTimeout(timer);
      el.removeEventListener('canplaythrough', onReady);
      el.removeEventListener('error', onError);
      if (err) reject(err);
      else resolve();
    }
    if (el.readyState >= 4) return done();
    el.addEventListener('canplaythrough', onReady);
    el.addEventListener('error', onError);
  });
}
