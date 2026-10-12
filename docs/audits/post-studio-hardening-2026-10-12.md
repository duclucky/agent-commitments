# Hoàn thiện phục hồi và rà đường tiền sau Studio — 2026-10-12

Phạm vi: SDK, console demo, regression tests, runbook và bản chuẩn bị pilot. Source production Solidity giữ nguyên; không đổi mô hình accounting, quyền quản trị hay adapter, không làm mất hiệu lực source snapshot đã audit. Không deploy, bind, approve, chuyển tiền hoặc công bố trong lượt này.

## Thay đổi đã triển khai

- SDK `inspectRefundRecovery`: đọc state cùng block, simulation reconcile cho cùng commitment; phân biệt BLOCKED do revert với UNKNOWN do RPC/thiếu snapshot. Không suy từ revert ra kết luận chắc chắn có blocklist.
- `prepareRefundReconciliation`: kiểm tra mới trước khi tạo calldata; chặn state chưa READY, attempt trước chưa có receipt và khoản đã REFUNDED. Simulation không hạch toán A hoặc tự broadcast.
- `inspectVaultFunding`: xác minh token/6 decimals, conservation và backing A+R cùng block; trả bigint cho unassigned/shortfall, không cộng E hay tiền chuyển nhầm vào A.
- Console thêm refund bị chặn/sẵn sàng và tiền chuyển nhầm, trạng thái đọc lại cùng cảnh báo deposit. Đây vẫn là demo local có nhãn, không phải dashboard mainnet đã kết nối.
- Bảy regression contract được đưa vào suite thường xuyên; các ca này mô tả hành vi hiện có, không phải bản sửa Solidity mới.

## Rà soát tập trung đường tiền

| Đường đi | Điều kiện và kết quả kiểm tra |
|---|---|
| Reserve | EIP-712 khóa chain/vault/grant/token/adapter/amount/terms. Mọi ancestor giảm khả năng chi; cùng operation khác nonce conflict. |
| Dispatch/fund | Grant ancestry active; job client/provider/evaluator/amount/expiry/hook đúng. R→E và escrow funding cùng transaction; transfer hoặc pause revert thì rollback; allowance exact amount được xóa. |
| Settle | Provider submit, evaluator complete; payout failure rollback. Reconcile terminal chỉ thực hiện một lần; funded obligation tiếp tục xử lý khi pause. |
| Reject/refund | Transfer fail giữ trạng thái cũ, tổng escrow, E và active slot. Refund về adapter chưa làm A tăng; `recordRefund` kéo tiền về vault trước accounting. |
| Retry | Recheck cùng commitment; UNKNOWN transaction phải truy cùng hash. Mock blocklist được bỏ thì refund/reconcile thành công; không tạo payment ID mới. |
| Withdraw | Owner chỉ rút A; pause không chặn rút. Direct transfer không làm A tăng và còn lại sau khi rút hết A. |
| Quote signer | Provider EOA ECDSA được hỗ trợ. ERC-1271 SCA provider không được hỗ trợ; test ghi lại giới hạn, không quảng bá mọi Circle wallet ký được quote. |

Đây là self-review có bằng chứng, không phải review độc lập. Không sửa contract chỉ để loại cảnh báo hoặc thêm quyền cứu tiền tùy ý.

## Kiểm chứng

- SDK: 38 tests, gồm 12 test mới về refund, snapshot pinning, RPC/revert, token binding, decimals, conservation và unassigned/shortfall. Log unit (operator-local evidence; omitted from the public release).
- Domain: 14 tests; contract suite: 52 tests gồm 4 fuzz properties × 256 lượt = 1.024 lượt fuzz; không skip/fail. Log contract (operator-local evidence; omitted from the public release).
- Console: 6 test hành vi trạng thái/money/error; kiểm tra browser thực cho BLOCKED→recheck, READY vẫn FUNDED, chuyển nhầm tách khỏi A. [Ảnh giao diện](post-studio-recovery-console-2026-10-12.png).
- Browser-to-local-chain E2E ở 375px bằng keyboard đạt; đây là lifecycle local reference, không phải mainnet-money test.
- Runtime failure injection: 6 tests đạt. Build (operator-local evidence; omitted from the public release), lint (operator-local evidence; omitted from the public release) và docs checks đạt; timestamp warnings vẫn theo ADR 0003.
- [Bản chuẩn bị pilot read-only](../deployments/arc-mainnet-pilot-preparation-2026-10-12.json) kiểm tra bytecode và SDK backing trên RPC mainnet thật. Vault rỗng, chưa bound, owner balance 52.000 units = 0,052 USDC tại block đã ghi.
- [Snapshot mainnet cuối](post-studio-mainnet-state-2026-10-12.json) lúc `2026-10-12T08:05:37.705Z` xác nhận source content, creation/runtime artifact và state; cả 11 file đầu vào Studio vẫn khớp SHA-256. Test mới không thay đổi source production hoặc đầu vào test cũ.

## Pilot đã chuẩn bị, chưa kích hoạt

Đã tạo calldata cho `setAdapter(v2)` (one-time), approve chính xác 10.000 units và deposit 0,01 USDC. Binding simulation đã đạt; estimate gas chỉ cho binding/approval, không phải trần phí toàn lifecycle. Sequence dự kiến chạy refund trước rồi dùng lại 0,01 USDC cho settlement; lưu receipt, trạng thái terminal và ledger, không tính test nội bộ là traction.

Gate còn mở theo [AGENTS.md](../../AGENTS.md), [ADR 0005](../adr/0005-mainnet-agentic-commerce-escrow.md) và [mainnet readiness](../runbooks/mainnet-readiness.md): review độc lập, signer provider EOA/evaluator, phạm vi giao dịch và trần phí toàn lifecycle. `independentSecurityReview` vẫn false. Bản chuẩn bị không phải chữ ký, giao dịch hay approval.

Chạy lại kiểm tra state ngay trước mọi thao tác mainnet được phép. Không dùng estimate cũ để suy ra đủ tiền hoặc thành công của giao dịch tương lai. Source verification/public repo/X/showcase đều chưa công bố trong lượt này.
