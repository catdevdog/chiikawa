import { app } from 'electron';

const ko = {
  mode: '모드',
  modeAuto: '자동 (따라가다 배회)',
  modeFollow: '따라가기',
  modeAttach: '마우스에 붙어있기',
  modeWander: '배회',
  size: '크기',
  small: '작게',
  normal: '보통',
  large: '크게',
  huge: '아주 크게',
  roam: '이동 범위',
  roamFree: '화면 전체',
  roamFloor: '바닥만',
  skin: '캐릭터(스킨)',
  openSkins: '스킨 폴더 열기',
  makeSkin: '스킨 만들기…',
  clickThrough: '방해하지 않기 (클릭 통과)',
  autoStart: 'Windows 시작 시 실행',
  quit: '종료',
};

const en: typeof ko = {
  mode: 'Mode',
  modeAuto: 'Auto (follow, then wander)',
  modeFollow: 'Follow the mouse',
  modeAttach: 'Stick to the mouse',
  modeWander: 'Wander',
  size: 'Size',
  small: 'Small',
  normal: 'Normal',
  large: 'Large',
  huge: 'Huge',
  roam: 'Roaming area',
  roamFree: 'Whole screen',
  roamFloor: 'Floor only',
  skin: 'Character (skin)',
  openSkins: 'Open skins folder',
  makeSkin: 'Make a skin…',
  clickThrough: "Don't get in the way (click-through)",
  autoStart: 'Start with Windows',
  quit: 'Quit',
};

export const t = (): typeof ko => (app.getLocale().toLowerCase().startsWith('ko') ? ko : en);
