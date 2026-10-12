# Local security review — 2026-10-12

Phạm vi: `BudgetVault`, `ERC8183Adapter`, local escrow subset, domain/SDK/runtime/API và các ví dụ. Đây là self-review kỹ thuật, không phải audit hoặc review độc lập.

Update mainnet 2026-10-12: vault, self-hosted escrow và draft adapter v2 đã deploy dưới dạng unbound/unfunded canary. Findings và regression mới nằm trong [mainnet candidate review](mainnet-candidate-review.md); các bằng chứng phía dưới là snapshot local/testnet trước candidate mới.

Update sau Studio cùng ngày: xem [Circle Arc Studio audit đã đối chiếu](audits/arc-studio-audit-2026-10-12.md) và [hardening/refund review](audits/post-studio-hardening-2026-10-12.md). Slither đã chạy trong Studio nhưng coverage không đầy đủ vì lỗi reference/inheritance/IR; không dùng câu “chưa cài Slither” ở snapshot cũ bên dưới để mô tả kết quả hiện tại. Provider quote SCA/ERC-1271 chưa được hỗ trợ; đã ghi rõ giới hạn và thêm regression. Đây vẫn là self-review.

Update sau ngoại lệ chủ tiền: [pilot mainnet](deployments/arc-mainnet-pilot-2026-10-12.md) đã bind v2 và hoàn tất refund/settlement/withdraw với 19 receipt được verify. Independent review vẫn false; quyết định ngoại lệ chỉ đóng blocker cho pilot nội bộ đã chốt, không áp dụng phát hành production rộng hơn. Các gate/snapshot trước đó dưới đây là lịch sử.

## Findings đã xử lý

| ID | Finding | Xử lý và bằng chứng |
|---|---|---|
| SR-01 | Grant chỉ giảm cap/expiry, chưa giảm tập provider/evaluator | Allowlist bất biến lúc tạo grant, child subset validation và reserve kiểm tra mọi ancestor; contract/domain regression tests |
| SR-02 | Quote dựa vào vault để suy ra token nhưng không ký token trực tiếp | Thêm `token` vào EIP-712 type và từ chối token khác vault token; cross-vault và wrong-token tests |
| SR-03 | Chưa có giới hạn exposure cố định cho pilot | Constructor bắt buộc deposit/per-commitment/concurrent caps; test vượt từng cap và active slot recovery |
| SR-04 | Exact retry có thể fail sau pause/quote expiry | Existing commitment được kiểm tra theo caller + exact terms trước admission checks; regression test chứng minh không reserve lần hai |
| SR-05 | Quote chưa thể hiện adapter đích, dù vault chỉ bind adapter một lần | Thêm adapter vào EIP-712 payload và từ chối reserve trước/sai adapter binding |

## Review không phát hiện lỗi mới trong phạm vi local

- Accounting giữ `D=A+R+E+S+W`; direct donation không ghi có budget.
- Adapter là đích duy nhất, allowance chỉ mở cho exact amount và được xóa trong cùng transaction.
- Pause/revoke chặn nghĩa vụ mới nhưng complete/refund/reconcile của funded job vẫn mở.
- API test bao phủ challenge replay, tenant isolation và idempotency conflict. Local alpha không nhận provider URL/webhook tùy ý, nên hiện không có SSRF sink trong runtime.
- SDK giữ economic state và transaction transport state riêng; Circle transaction ID/hash không tự trở thành payment success.
- Circle executor có thể poll lại cùng transaction ID qua restart và không submit giao dịch mới; timeout và `STUCK` giữ trạng thái chưa chắc chắn.
- Multi-role Arc Testnet flow dùng owner, provider và evaluator khác nhau; onchain job xác nhận provider/evaluator đúng allowlist và chữ ký.
- `Deploy.s.sol` đã được rehearsal ở simulation mode với public caps; runner xác nhận không broadcast.
- Search source không thấy private key production, Circle credential hoặc frontend secret. Khóa cố định chỉ nằm trong local Anvil scripts/tests.

## Gate còn mở

- Chưa có review độc lập; đây là blocker của mainnet-money readiness.
- Cặp vault/adapter hiện tại đã được deploy, xác minh read-only và chạy settlement, reject/refund/reconcile/withdraw cùng multi-role settlement với 0,1 USDC mỗi flow trên USDC/escrow thật của Arc Testnet. Circle Wallets chưa được dùng để broadcast do chưa có credential trong workspace.
- `LocalAgenticCommerce` chỉ là subset tham chiếu, chưa phải bằng chứng tương thích với deployment ERC-8183 production.
- Owner/signer production, giá trị ba cap, pause threshold và escrow production address chưa được chủ tiền duyệt.
- API có PostgreSQL store cho challenge dùng một lần, session token hash và idempotency record; memory store chỉ dành cho local development. Public deployment vẫn cần ingress rate limit, TLS, backup và monitoring.

## Bằng chứng local cuối — 2026-10-11

- `pnpm build` và `pnpm lint`: pass; Foundry chỉ báo các cảnh báo `block.timestamp` đã được chấp nhận trong ADR 0003.
- Domain 14 tests, SDK 16 tests, API 2 tests, provider 1 test và document workflow 1 test: pass.
- Foundry 23 tests: pass; invariant suite chạy 2 properties × 256 runs = 512 fuzz cases.
- Runtime failure injection 4 tests và Postgres integration 4 tests: pass.
- Local-chain lifecycle và browser-to-local-chain E2E 375px/keyboard: pass; browser receipt mới nhất `0xfc1c9f5cc42f6d8f75103514c1f90a6984f98c9b4dc0ed29853afe27197e9e55` trên Anvil tạm thời.
- `Deploy.s.sol` rehearsal: pass ở simulation mode, không broadcast.
- `pnpm verify:arc-testnet`: pass; đối chiếu 32 smoke/setup receipts, ba terminal jobs/reservations, vai trò độc lập, current bytecode/bindings và ledger `D=300000, S=200000, W=100000`.
- `pnpm audit --prod`: không có known vulnerability. Slither, Aderyn và Semgrep chưa được cài nên không có kết quả static analyzer từ ba công cụ này.
- `pnpm prepare:arc-testnet-verification`: creation input và runtime code hash của cả hai contract khớp; Standard JSON đã tạo nhưng chưa publish.
- `pnpm audit --prod`: không có known vulnerability; `pnpm check:docs`: pass.

Receipt Anvil chỉ là bằng chứng local tạm thời, không phải deployment hoặc traction.

## Quyết định phát hành

Local alpha và deployment Arc Testnet hiện tại có thể tiếp tục dùng cho phát triển, read-only verification, fork test và giao dịch kiểm thử theo quyền đã cấp. Mainnet canary chưa bind/chưa nạp tiền đã được triển khai theo quyền riêng đã cấp. Kích hoạt qua one-time binding và funding vẫn chờ review độc lập cùng acceptance gates trong mainnet candidate review.
