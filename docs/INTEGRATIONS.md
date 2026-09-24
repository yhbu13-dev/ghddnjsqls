# 연동 명세

## 1. 티오더 POS 판매 로그 수신

`POST {외부 접속 주소}/api/ingest/pos`

| 헤더 | 값 |
|---|---|
| `Content-Type` | `application/json` |
| `X-BevFlow-Timestamp` | 전송 시각 (epoch 밀리초). 서버 시각과 5분 넘게 차이 나면 거부합니다 |
| `X-BevFlow-Signature` | `sha256=` + HEX( HMAC-SHA256( 수신 키, 타임스탬프 + "." + 원본 본문 ) ) |

수신 키는 [관리 → 데이터 연동]에서 확인하고 재발급합니다. 환경 변수 `BEVFLOW_INGEST_SECRET`로 고정할 수도 있습니다.

```json
{
  "store": "TO-GN-01",
  "sales": [
    { "id": "20260924-000123-1", "sold_at": "2026-09-24T12:31:05+09:00", "menu": "콜라 1.25L", "qty": 2 },
    { "id": "20260924-000123-2", "sold_at": 1790222465000, "menu": "점심세트(콜라캔 포함)", "qty": 1 }
  ]
}
```

- `store`: 매장의 **티오더 매장 ID**. 여러 매장을 한 번에 보낼 때는 항목마다 `store`를 넣습니다.
- `id`: 판매 줄 고유 ID. 같은 매장·같은 ID는 한 번만 반영되므로 재전송해도 안전합니다.
- `sold_at`: ISO 8601 또는 epoch 밀리초. 시간대가 없는 `YYYY-MM-DD HH:MM`은 KST로 봅니다.
- `menu`: POS 메뉴명. [메뉴 매핑]과 글자가 정확히 같아야 합니다.
- 음료가 아닌 메뉴를 함께 보내도 괜찮습니다. 매핑되지 않은 메뉴는 재고에 영향이 없고 [미매핑 POS 메뉴]에만 기록됩니다.
- 한 번에 최대 5,000건까지 보낼 수 있습니다. 1~5분 간격 배치를 권장합니다.

응답:

```json
{ "accepted": 2, "duplicates": 0, "unmapped": 0, "unknownStore": 0, "invalid": 0 }
```

서명 예시 (Node.js):

```js
const crypto = require('node:crypto');
const body = JSON.stringify(payload);
const ts = Date.now();
const sig = crypto.createHmac('sha256', SECRET).update(ts + '.' + body).digest('hex');
await fetch(URL, { method: 'POST', body, headers: {
  'content-type': 'application/json', 'x-bevflow-timestamp': String(ts), 'x-bevflow-signature': 'sha256=' + sig } });
```

**티오더와 협의할 것**: 판매 로그 푸시(또는 BevFlow가 가져갈 수 있는 조회 API), 매장 ID 체계, 취소·환불 건 처리(수량 음수 대신 취소 이벤트), 세트 메뉴 구성 정보.

## 2. 알림 발송 (알림톡)

[운영 설정 → 연동 → 알림 발송 방식]

- **콘솔**: 외부로 보내지 않습니다. 메시지가 [알림톡 모니터]에 쌓이고, 운영자가 [메시지·링크 복사]로 전달합니다. 대행사 계약 전 파일럿 초기에 씁니다.
- **웹훅**: 메시지마다 설정한 URL로 POST합니다. 알림톡 대행사 API를 부르는 중계 서버나 자동화 도구에서 받아 실제로 발송합니다. 실패하면 1분 간격으로 5회까지 재시도합니다.

```json
{
  "id": 812, "kind": "propose", "template": "BF_PROPOSE_03", "to": "010-1234-5678",
  "text": "[BevFlow 발주 제안]\n홍길동 사장님, 콜라 1.25L 재고가 약 1.5박스(±0.4) 남았어요. …",
  "variables": { "store": "역삼 달빛포차", "owner": "홍길동", "code": "PO-260924-003", "sku": "콜라 1.25L", "stock": "1.5", "band": "0.4", "qty": 3, "arrive": "오늘 도착", "amount": "190,400원", "link": "https://…/o/…" },
  "buttons": [{ "name": "발주 확인하기", "url": "https://…/o/…" }],
  "created_at": 1790222465000
}
```

헤더 `X-BevFlow-Signature: sha256=HMAC(웹훅 키, 본문)`으로 BevFlow가 보낸 요청인지 확인할 수 있습니다. 2xx로 응답하면 발송 완료로 기록되고, 본문에 `id`나 `message_id`가 있으면 대행사 메시지 ID로 저장합니다.

**대행사에 등록할 템플릿** (버튼은 모두 웹링크, URL 변수 `#{link}`)

| 코드 | 용도 | 버튼 |
|---|---|---|
| `BF_PROPOSE_03` | 발주 제안 (재고·제안 수량·도착 예정·합계) | 발주 확인하기 |
| `BF_REMIND_01` | 60분 무응답 리마인드 | 확인하기 |
| `BF_CONFIRM_02` | 발주 확정 · 도착 예정 | 확인하기 |
| `BF_PAYFAIL_01` | 결제 실패 안내 | 확인하기 |
| `BF_HOLD_01` | 보류 확인 | — |
| `BF_EXPIRE_01` | 무응답 만료 안내 | — |
| `BF_DELIVERED_01` | 배송 완료 | — |
| `BF_DLVFAIL_01` | 배송 실패 · 재방문 안내 | — |

실제 문구는 `server/engine/messages.js`에 있습니다. 템플릿 심사 결과에 맞춰 이 파일의 문구를 고치면 됩니다.

대행사 API를 BevFlow가 직접 부르려면 `server/adapters/notifier.js`에 발송 방식을 하나 추가하고, `server/settings.js`의 `notifier` 값 목록에 넣으면 됩니다.

## 3. 결제

- **후불 청구 (invoice)**: 승인하는 즉시 주문을 확정하고 월말에 매장별로 청구합니다. 정산 CSV의 결제 방식이 `후불 청구`로 찍힙니다.
- **카드 (sandbox_card)**: 카드 자동결제 흐름(성공·실패·재결제)을 시험하는 모드입니다. 매장의 `결제 실패 테스트`를 켜면 거절을 돌려줍니다.
- **PG 연동**: `server/adapters/payment.js`의 `charge({ proposal, store })`가 `{ ok, method, ref }` 또는 `{ ok: false, reason }`을 돌려주게 구현합니다. 비동기 호출도 지원합니다.

## 4. CSV 가져오기

[관리 → 데이터 연동 → CSV 가져오기] · UTF-8 · 첫 줄은 머리글

**매장** (`code` 기준으로 있으면 수정, 없으면 추가)

```csv
code,name,region_id,type,owner_name,owner_phone,address,lat,lng,pos_store_id,send_pref,skus
GN-01,역삼 달빛포차,GN,D,홍길동,010-1234-5678,서울 강남구 …,37.5012,127.0391,TO-GN-01,immediate,CL125;SD150;WT200
```

`type`: `L`(점심 중심) / `D`(저녁 중심) · `send_pref`: `immediate` / `break` · `skus`: SKU 코드를 `;`로 구분

**메뉴 매핑** (`store_code`를 비우면 전체 매장 공통)

```csv
menu_name,sku_id,units,store_code
콜라 1.25L,CL125,1,
점심세트(콜라캔 포함),CL355,1,
```

**POS 판매** (연동 전 과거 판매 반영용)

```csv
store,sale_id,sold_at,menu,qty
TO-GN-01,20260924-000123-1,2026-09-24 12:31,콜라 1.25L,2
```

## 5. 링크

- 사장님 링크 `/o/{토큰}`: 발주마다 발급하며 7일간 유효합니다. 처음 열면 **열람**으로 기록됩니다. 콘솔의 [사장님 화면 열기] 미리보기는 열람으로 치지 않습니다.
- 기사 링크 `/d/{토큰}`: 배차된 라우트마다 발급하며 배송일 다음 날까지 유효합니다.
- 두 링크 모두 [링크 서명 키 재발급]으로 한꺼번에 무효로 만들 수 있습니다.
