# 작업 규칙

## 문서와 공지의 문체

- `.md` 문서와 공지사항(CHANGELOG.md, 릴리스 설명, 업데이트 알림)에는 긴 줄표(em dash), 화살표, 말줄임표 문자, 곱슬 따옴표, 가운뎃점 같은 AI가 쓰는 특수문자를 쓰지 않는다.
- 문장은 "~다."로 끝낸다. 사용자에게 보이는 글(README, CHANGELOG, 알림, docs/GUIDE.md, docs/SKINS.md)은 "~했습니다.", "~입니다."처럼 합쇼체로 쓰고, 개발 문서(docs/PLAN.md, docs/DEVELOPMENT.md)는 "~한다."로 쓴다. "~해요."로 끝내지 않는다.
- CHANGELOG.md의 한 줄은 문장 몇 개로 쓰고, 첫 문장은 업데이트 알림에 그대로 나오므로 36자 이하로 짧게 쓴다.
- 첫 문장은 새로 된 일이면 "이제 ~가 ~합니다."로, 고친 문제이면 "~하던 현상을 수정했습니다."로 쓴다. 실험 기능은 마침표 앞에 "(실험 기능)"을 붙인다. 마침표 뒤에 붙이면 알림의 첫 문장이 거기서 끝나지 않고 길어진다.
- `tests/docs.test.ts`와 `tests/changelog.test.ts`가 이 규칙을 확인한다.

## README

- README.md는 내려받는 방법, 어떤 기능이 있는지(기능마다 한 줄씩), 최신 업데이트만 싣는다. 기능을 자세히 설명하지 않고, 자세한 내용은 `docs/GUIDE.md`(사용법), `docs/SKINS.md`(스킨), `docs/DEVELOPMENT.md`(개발)에 쓴다.
- README.md의 "최신 업데이트"는 `package.json` 버전의 CHANGELOG 항목에서 각 줄의 첫 문장을 그대로 옮긴 것이다. 버전을 올릴 때 함께 바꾸고, `tests/docs.test.ts`가 어긋나지 않는지 확인한다.

## 릴리스

- 릴리스는 사용자가 GitHub Actions의 build 워크플로를 `Run workflow`로 직접 실행해서 만든다. 태그를 푸시하거나 릴리스를 발행하지 않는다.
- 버전별 작업은 기능 브랜치(`feature/*`)에서 하고, main은 사용자가 앞 버전을 릴리스한 뒤에 다음 버전으로 올린다(fast-forward).
