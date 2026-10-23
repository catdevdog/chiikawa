# 개발

Node.js 22 이상이 필요하다. 기획과 설계는 [PLAN.md](PLAN.md)에 있다.

## 실행과 시험

```bash
npm install
npm run dev:web     # 브라우저 테스트 페이지 (http://localhost:5173), 스킨 메이커는 /maker.html (저장하면 ./skins/<이름>)
npm start           # Electron으로 실행 (빌드 후)
npm test            # 단위 테스트
npm run typecheck
npm run dist        # Windows 설치 파일 (Windows에서 실행)
```

브라우저 테스트 페이지에서는 마우스가 곧 커서이다. 주소 뒤에 `?debug=1`(히트박스 표시), `?mode=wander`, `?sleepAfter=1500`(빨리 졸게 함), `?chatty=1`(모든 상황에서 자주 말하게 함) 같은 옵션을 붙일 수 있다.

모니터가 한 대뿐인 PC에서 멀티 모니터를 시험하려면 가짜 모니터를 줄 수 있다(설치된 앱에서는 무시된다). 예를 들어 `BUDDY_FAKE_DISPLAYS='[{"id":1,"x":0,"y":0,"width":1280,"height":720,"primary":true},{"id":2,"x":1280,"y":0,"width":1024,"height":600}]' npm start`처럼 쓴다. 화면이 가짜 모니터를 다 덮을 만큼 커야 보인다. 이 값에 `BUDDY_TEST=1`을 더하면 자동 시험이 쓰는 `globalThis.__buddyTest`도 생긴다.

## 폴더 구조

```
src/engine/     순수 TypeScript 엔진: 상태머신, 물리, 모드, 상호작용 (DOM과 Electron에 의존하지 않고, 테스트되어 있음)
src/renderer/   Canvas 렌더러(메인이 보낸 펫을 그리기만 함), 스킨 로더, 브라우저 테스트 페이지(여기서는 엔진을 직접 돌림)
src/shell/      Electron 메인: 펫 시뮬레이션(stage, 여러 마리), 모니터별 투명 오버레이 창, 클릭 통과, 트레이, buddy:// 프로토콜, 설정, 다른 프로그램의 창 읽기(win32.ts, Windows 전용)
src/maker/      스킨 메이커의 이미지 처리: 배경 제거, 트리밍, 정렬, 스프라이트 시트, 정지 그림 움직임 만들기 (순수 TypeScript, 테스트되어 있음)
src/shared/     메인과 렌더러가 공유하는 타입, 스킨 manifest 검증
skins/default/  기본 마스코트 Sprout
skins/usagi/ hachiware/ chiikawa/ rakko/    ちいかわ 캐릭터 스킨 (저작권은 권리자에게 있음)
CHANGELOG.md    버전마다 바뀐 점 (릴리스 설명과 업데이트 알림에 쓰임)
scripts/        빌드와 릴리스에 쓰는 스크립트
docs/           사용법(GUIDE.md), 스킨(SKINS.md), 개발(DEVELOPMENT.md), 기획과 로드맵(PLAN.md)
```

## 릴리스

릴리스는 먼저 [CHANGELOG.md](../CHANGELOG.md)에 새 버전의 `## X.Y.Z` 항목을 적고(사용자가 알아챌 변경을 한 줄씩 적는다. 첫 문장은 새로 된 일이면 "이제 ~가 ~합니다.", 고친 문제이면 "~하던 현상을 수정했습니다."로 쓴다), [README](../README.md)의 **최신 업데이트**를 그 항목에 맞추고, `package.json`의 `version`을 올려 커밋하는 것으로 시작한다. 그다음 GitHub의 Actions 탭에서 build 워크플로를 `Run workflow`로 실행하면서 Branch를 릴리스할 커밋이 있는 브랜치로 두고 `release_tag`에 `vX.Y.Z`를 적으면, 설치 파일, 포터블 zip, 그리고 설치된 앱이 업데이트에 쓰는 `latest.yml`과 `.blockmap`을 만들어 Release에 올린다. 태그를 직접 올릴 수 있다면 `git tag vX.Y.Z && git push origin vX.Y.Z`로도 같은 결과를 얻는다. 릴리스 설명에는 CHANGELOG의 그 버전 항목이 그대로 들어가고, 앱은 업데이트 뒤 처음 켤 때 각 줄의 첫 문장을 알림으로 보여 준다. 태그와 `package.json`의 버전이 다르거나 CHANGELOG에 그 버전 항목이 없으면 워크플로가 릴리스를 멈춘다(버전이 다르면 설치된 앱이 업데이트를 받지 못하거나 계속 받으려 하기 때문이다). 같은 브랜치에서 build가 돌고 있을 때 다시 실행하면 먼저 돌던 것이 취소되므로(`concurrency`), 릴리스를 만드는 동안에는 그 브랜치에서 다른 build를 실행하지 않는다.
