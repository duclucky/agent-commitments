# Mainnet candidate review package — 2026-10-12

Trạng thái hiện tại: pilot nội bộ đã hoàn tất sau ngoại lệ rõ của chủ tiền; chưa có kết luận review độc lập. Đây là hồ sơ kỹ thuật/self-review. Vault đã bind v2, budget hiện rỗng và không còn nghĩa vụ pending. Xem [pilot evidence](deployments/arc-mainnet-pilot-2026-10-12.md); các snapshot unbound trong hồ sơ dưới đây ghi trạng thái trước pilot. Nguồn địa chỉ/receipt/hash để đối chiếu: [mainnet manifest](../deployments/arc-mainnet.json).

## Scope và phiên bản

- BudgetVault `0x2415a87B0b9280C1989F03ceA9DC1c3644777862`: grant/accounting/EIP-712, cap 1 USDC, mỗi commitment 0,1 USDC, concurrency 1, root expiry 2027-01-10.
- AgenticCommerceEscrow `0x19E14a1006d106882D4c24584AAA6Ce1771E4151`: token 6 decimals, expected-budget binding, non-upgradeable, không fee/hook, expiry refund permissionless, recovery excess phía trên tổng nghĩa vụ.
- ERC8183DraftAdapter v2 `0x0db5f0CC38F86e60FEbe495d4fFAF2Bb0288704d`: immutable vault/escrow/token; dispatch admission theo mọi grant ancestor; exact amount allowance trong funding/reconcile.
- SDK: quote/call preparation, provider/evaluator/refund operations và manifest canary có adapter/escrow operational bằng null.
- Compiler Solidity 0.8.30, Forge 1.7.1, optimizer 200, Cancun; OpenZeppelin 5.6.1, viem 2.57.4. Giữ lockfile. Chưa có Git revision.

[ADR 0005](adr/0005-mainnet-agentic-commerce-escrow.md) pin sự khác nhau giữa normative ERC-8183 Draft ngày 2026-10-12 và ABI reference Arc Testnet. Không diễn giải source minh họa trong EIP là bảo đảm an toàn production.

## Findings tự kiểm tra đã xử lý

| ID | Trigger và ảnh hưởng | Fix/bằng chứng |
|---|---|---|
| MC-01 | Adapter v1 tạo job Open khi grant/ancestor đã revoke hoặc hết hạn; funding vẫn bị vault chặn | V2 kiểm tra ancestry trước createJob; ba regression đã đỏ rồi xanh. V1 chưa bind và bị đánh dấu superseded |
| MC-02 | SDK có escrow cấu hình nhưng prepareProviderBudget trên mainnet vẫn throw | Dùng cùng requireEscrow resolution với các role calls; regression đã đỏ rồi xanh |
| MC-03 | Hồ sơ gọi networkFee Circle báo là receipt gas cost | Lưu hai trường và tổng riêng; verifier so gasUsed/effectiveGasPrice trực tiếp với RPC. Không suy ra khoản billing từ balance |

## Bằng chứng đã có

- Contract suite 45 tests, gồm 4 fuzz properties × 256 runs; escrow fuzz kiểm tra settlement/refund và backing vật lý. Các test adversarial kiểm tra fake incoming transfer, payout failure/retry và callback reentrancy xuyên job.
- Adapter regression: price lệch quote, fund/refund trùng, pause giữa dispatch/fund, escrow pause rollback consumption/allowance, refund sau revoke/pause và revoked/expired ancestor.
- Domain 14 tests; SDK 26 tests.
- Runtime failure injection 6 tests và PostgreSQL integration 9 tests; `pnpm test:e2e` gồm API/provider/workflow, local-chain lifecycle và browser 375px/keyboard đều đạt. Các E2E hiện dùng local reference, không chứng minh USDC thật di chuyển trên candidate mainnet.
- `pnpm test:deployment-rehearsal`: hai Forge scripts mô phỏng local, xác nhận không broadcast.
- `pnpm verify:arc-mainnet`: receipt canonical, gas fields, runtime hash, CREATE2/calldata/init code/artifact, constructor state, balance/allowance và ledger rỗng. V1 được đối chiếu riêng và không được bound.
- `pnpm lint` và `pnpm check:docs`; timestamp warnings đã được giải thích ở [ADR 0003](adr/0003-time-semantics.md).

Bản snapshot read-only đã lưu: [mainnet verification](deployments/arc-mainnet-verification-2026-10-12.json). Verifier còn kiểm tra nội dung các Solidity source/dependency hiện tại khớp hash trong compiler metadata trước khi so artifact với chain.

Update sau Studio: [hồ sơ hardening và rà đường tiền](audits/post-studio-hardening-2026-10-12.md) bổ sung bảy regression vào contract suite, SDK refund simulation/backing inspection và cảnh báo console demo. Full suite hiện 52 contract tests, 38 SDK tests; source production vẫn giữ nguyên. [Snapshot mainnet cuối](audits/post-studio-mainnet-state-2026-10-12.json) xác nhận unbound/unfunded và source/runtime khớp. [Bản chuẩn bị pilot](deployments/arc-mainnet-pilot-preparation-2026-10-12.json) chỉ có calldata/estimate read-only, không phải giao dịch đã gửi.

Giới hạn signer được xác nhận: `BudgetVault.reserve` chỉ dùng ECDSA provider EOA, chưa hỗ trợ ERC-1271 provider SCA. Chọn role/signer đúng trước smoke; khả năng Circle wallet gửi calldata không chứng minh wallet đó ký được quote cho địa chỉ provider SCA.

Reviewer phải chạy lại các lệnh trên và tự xác minh source/bytecode. Kết quả test không thay thế review. Không có bằng chứng real-USDC lifecycle trên candidate mới; chưa có public source verification.

## Các câu hỏi bắt buộc reviewer giải quyết

Đã bổ sung [tự audit bằng Circle Arc Studio ngày 2026-10-12](audits/arc-studio-audit-2026-10-12.md): 55 test tái hiện local/Studio, phản biện và hiệu chỉnh báo cáo tự động. Slither có lỗi phân tích nên coverage không đầy đủ. Đây là tool-assisted self-review; không thay thế reviewer độc lập và không mở gate binding/funding. Rủi ro còn lại gồm issuer blocklist, direct donation, orphan Open job và one-time adapter binding; xem báo cáo đã đối chiếu trước khi dùng khuyến nghị từ bản Studio nguyên bản.

1. Mỗi transition D/A/R/E/S/W và ancestor grant có xảy ra đúng một lần khi revert/retry hoặc gọi lại?
2. Provider signature có ràng buộc đầy đủ chain/vault/grant/adapter/token/amount/work/nonce/deadlines? Quyền gọi reserve/fund/reconcile có thể bị vượt qua không?
3. Dispatch/fund có bị tạo nghĩa vụ qua grant revoked/expired, người nhận/evaluator/giá sai hoặc allowance còn dư?
4. Escrow totalEscrowed có luôn được backing bởi token thực trong trạng thái hỗ trợ? Excess withdrawal có thể chạm tiền job, hoặc direct donation bị hạch toán nhầm thành refund không?
5. SafeERC20/reentrancy/state rollback có chặn payout/refund trùng? Blacklist hoặc USDC transfer revert giữ nguyên nghĩa vụ và cho retry được không?
6. Pause/revoke/expiry có giữ đường hoàn tất và refund; semantics khi evaluator complete sau expiry nhưng trước claimRefund có được các bên chấp nhận? Candidate giữ cùng race thứ tự giao dịch của draft/reference, không có quyền hoàn tiền ưu tiên ngoài chuỗi.
7. Unfunded Open job sau cancel reservation không thể fund vì vault status/adapter binding chặn; SDK có diễn giải đúng R/E và không dispatch lại với payment ID mới?
8. One-time adapter binding, absence of upgrades, owner excess recovery và expiry của root grant có phù hợp giới hạn pilot? Cần vault mới nếu review phát hiện lỗi immutable.

## Kích hoạt sau review

Reviewer ghi rõ người review, phạm vi, source hashes, finding/severity và quyết định. Đóng finding nghiêm trọng trước khi bind. Kiểm tra lại bytecode, token và state ở block mới; chuẩn bị `setAdapter` với đúng v2 và phí ước tính cho owner phê duyệt phạm vi thao tác không đảo ngược. Sau đó cập nhật manifest/SDK theo binding thực tế. Funding và smoke mainnet 0,01 USDC phải có phạm vi giá trị/vai trò/fee được duyệt trước khi thực hiện. Cần kiểm chứng settlement, reject/refund/reconcile và withdraw bằng USDC thật; hoạt động này là test nội bộ, không phải traction.
