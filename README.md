# Desktop Buddy

바탕화면을 돌아다니고, 마우스에 붙어 다니고, 마우스에 반응하는 **Windows 데스크탑 펫**이에요.
(Desktop Buddy는 가칭입니다. A tiny desktop pet for Windows that wanders the screen, sticks to your mouse and reacts to it.)

<p align="center">
  <a href="https://github.com/catdevdog/chiikawa/releases/latest/download/DesktopBuddy-Setup.exe">
    <img alt="Windows용 다운로드" src="https://img.shields.io/badge/Windows%20용%20다운로드-설치%20파일%20(.exe)-3a6df0?style=for-the-badge&logo=windows&logoColor=white">
  </a>
  <a href="https://github.com/catdevdog/chiikawa/releases/latest/download/DesktopBuddy-Portable.zip">
    <img alt="포터블 zip" src="https://img.shields.io/badge/포터블-zip-555?style=for-the-badge">
  </a>
</p>

> 첫 릴리스(`v0.1.0`)가 올라오기 전에는 위 링크가 열리지 않아요. 모든 빌드는 [Actions](../../actions) 탭의 `windows` 아티팩트로도 받을 수 있어요.

## 다운로드와 설치 (Windows 10 / 11, 64비트)

1. 위의 **설치 파일(.exe)** 을 받아 실행하면 바로 설치되고 시작됩니다. 설치가 싫다면 **포터블 zip**을 풀어서 `Desktop Buddy.exe`를 실행하세요.
2. 처음 실행할 때 Windows가 **"PC를 보호했습니다"** 화면을 띄울 수 있어요. 아직 코드 서명을 하지 않은 앱이라서 그래요. **추가 정보 → 실행**을 누르면 됩니다.
3. 펫은 주 모니터에 나타나고, 작업 표시줄 오른쪽 아래(숨겨진 아이콘 `^` 안일 수 있어요)에 트레이 아이콘이 생깁니다.

## 사용법

트레이 아이콘을 클릭(또는 우클릭)하면 메뉴가 열려요.

| 메뉴 | 설명 |
|---|---|
| 모드 | **자동**(마우스가 움직이면 따라오고, 멈추면 돌아다니다 졸아요) · **따라가기** · **마우스에 붙어있기** · **배회** |
| 크기 | 작게 / 보통 / 크게 / 아주 크게 |
| 이동 범위 | **화면 전체** 또는 **바닥만** |
| 캐릭터(스킨) | 설치된 스킨 선택, **스킨 폴더 열기** |
| 방해하지 않기 | 켜면 펫이 클릭을 전혀 가로채지 않아요 (움직이기만 해요) |
| Windows 시작 시 실행 | 설치 버전에서 동작해요 |
| 종료 | 비상 종료 단축키: `Ctrl + Alt + Shift + B` |

**펫과 놀기**

- 마우스를 올리면 걸음을 멈추고 쳐다봐요. 좌우로 문지르면(쓰다듬기) 좋아해요.
- 클릭하면 깜짝 놀라요. 빠르게 3번 클릭하면 기뻐해요.
- 잡아서 끌면 들려서 대롱대롱 매달리고, 놓으면 떨어져요. 휙 던질 수도 있어요.
- 마우스를 빠르게 휘둘러 다가가면 놀라서 도망가요(배회 중일 때).
- 아무도 건드리지 않으면 졸다가 잠들어요.
- **붙어있기** 모드에서는 펫이 마우스 커서에 매달려 따라와요. 이때 펫은 클릭을 가로채지 않아서 평소처럼 작업할 수 있어요.

## 캐릭터(스킨) 추가하기

스킨은 이미지 파일과 `manifest.json`이 들어 있는 폴더예요. 트레이 메뉴의 **스킨 폴더 열기**로 폴더를 열고(보통 `%APPDATA%\desktop-buddy\skins`), 그 안에 스킨마다 폴더를 하나씩 만드세요.

```
skins/
  my-skin/
    manifest.json
    idle.png        ← 필수
    happy.gif       ← 선택
```

```json
{
  "name": "My skin",
  "size": { "w": 128, "h": 128 },
  "anchor": { "x": 0.5, "y": 0.94 },
  "hitbox": { "x": 0.17, "y": 0.1, "w": 0.66, "h": 0.81 },
  "facing": "right",
  "poses": { "idle": "idle.png", "happy": "happy.gif", "sleep": "sleep.png" }
}
```

- **포즈**: `idle`(필수), `walk`, `run`, `sit`, `sleep`, `held`(들렸을 때), `fall`, `land`, `surprised`, `happy`. 없는 포즈는 비슷한 포즈로, 최종적으로 `idle`로 대체돼요. 걷기·앉기 같은 동작은 정지 이미지만 있어도 코드로 통통 튀고 찌그러지며 움직여요.
- **파일 형식**: `png`, `apng`, `gif`, `webp`, `svg`. 움직이는 GIF/APNG/WebP도 그대로 재생돼요. GIF는 투명도가 1비트라 가장자리가 거칠 수 있어서 **투명 배경 PNG(또는 APNG/WebP)** 를 권장해요.
- `size`는 스프라이트 상자의 크기(px), `anchor`는 발 위치, `hitbox`는 몸통 영역(클릭과 화면 가장자리 제한에 쓰여요)이고 모두 상자 대비 비율이에요. 이미지는 상자 안에 비율을 유지한 채 아래쪽 가운데로 맞춰져요.
- 이 저장소에는 직접 만든 기본 마스코트(**Sprout**)만 들어 있어요. 다른 캐릭터 이미지는 포함하지 않으니, 스킨을 만들 때는 이미지의 사용 권한을 확인해 주세요.

## 문제가 생기면

- **로그**: `%APPDATA%\desktop-buddy\buddy.log`
- **클릭 통과가 이상할 때**: 환경 변수 `BUDDY_DEBUG=1`로 실행하면 클릭 통과가 바뀔 때마다 로그에 남아요.
- **펫이 안 보여요**: 트레이 아이콘이 있는지 확인하세요. 펫은 **주 모니터**에서만 돌아다녀요.
- **백신이 막아요**: 코드 서명이 없어서 생기는 오탐일 수 있어요. 소스는 이 저장소에 그대로 공개돼 있어요.

## 개발

Node.js 22 이상이 필요해요.

```bash
npm install
npm run dev:web     # 브라우저 테스트 페이지 (http://localhost:5173)
npm start           # Electron으로 실행 (빌드 후)
npm test            # 단위 테스트
npm run typecheck
npm run dist        # Windows 설치 파일 (Windows에서 실행)
```

브라우저 테스트 페이지에서는 마우스가 곧 커서예요. 주소 뒤에 `?debug=1`(히트박스 표시), `?mode=wander`, `?sleepAfter=1500`(빨리 졸게) 같은 옵션을 붙일 수 있어요.

```
src/engine/     순수 TypeScript 엔진: 상태머신, 물리, 모드, 상호작용 (DOM/Electron 의존 없음, 테스트됨)
src/renderer/   Canvas 렌더러, 스킨 로더, 브라우저 테스트 페이지
src/shell/      Electron 메인: 투명 오버레이 창, 클릭 통과, 트레이, buddy:// 프로토콜, 설정
src/shared/     메인과 렌더러가 공유하는 타입
skins/default/  기본 마스코트
docs/PLAN.md    기획과 로드맵
```

**릴리스**: `git tag v0.1.0 && git push origin v0.1.0` 을 하면 GitHub Actions가 설치 파일과 포터블 zip을 만들어 Release에 올려요.

## 알려진 제한

- Windows 우선이에요. macOS/Linux는 아직 확인하지 않았어요.
- 주 모니터 한 대에서만 돌아다녀요.
- 전체화면 앱 위에서 숨기는 기능은 아직 없어요.
- 코드 서명이 없어서 처음 실행할 때 Windows 경고가 떠요.
