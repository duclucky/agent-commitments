# Agent Commitments — pilot Arc Mainnet đã hoàn tất

Hoàn tất lúc 18:20 ngày 2026-10-12 (GMT+7). Ba contract đã được bind và kiểm thử bằng USDC thật trên Arc Mainnet, chain 5042. Đây là pilot nội bộ với vốn/fee được người dùng duyệt, không phải khách hàng hoặc traction độc lập. Console vẫn là demo local; chưa công bố website/repo/X/showcase trong phạm vi lần này.

## Kết quả tiền

| Thao tác | Bằng chứng |
|---|---|
| Bind adapter v2 một lần | [Receipt bind](https://explorer.arc.io/tx/0x9779536bcb60593c60ed39e51106cc74ea27fa6ee160fa3c17800c31ea63f3a0) |
| Deposit đúng 0,01 USDC | [Receipt deposit](https://explorer.arc.io/tx/0x366ecd562a955fef1ed6dd99512b59cdc505e98d0e81a80b820b9314d486cdf4) |
| Job 1: funded/rejected/refunded và reconcile 0,01 USDC | [Receipt refund về vault](https://explorer.arc.io/tx/0x1ba4d834fe889d1e59f9f5c14738692ea98559527ccc0173a6e9f334996ea213) |
| Job 2: provider submit, evaluator nghiệm thu, thanh toán 0,005 USDC | [Receipt complete/payment](https://explorer.arc.io/tx/0xdd49f67405560e2265505b556051626aa89ed4cd06597611435015019e5e73d0) |
| Job 2: reconcile settlement | [Receipt reconcile](https://explorer.arc.io/tx/0x25349259b1094b2b9591d12a6a9e06b25d7fec0b29bfa9597fdd34be58ef9ae5) |
| Owner rút 0,005 USDC còn lại | [Receipt withdraw](https://explorer.arc.io/tx/0xf319223a694fdcdbfd8425aabbbfaf51e16746908f0b30657d6031a4e0c7e3b4) |

Ledger cuối, theo đơn vị nhỏ nhất 6 decimals: **D=10000, A=0, R=0, E=0, S=5000, W=5000**. Active commitments=0; vault/adapter/escrow đều không còn USDC, totalEscrowed=0, allowance adapter→vault và adapter→escrow đều zero. Vault đã bind v2 nên có thể dùng qua SDK, nhưng hiện A=0 và không tự tạo nghĩa vụ mới.

## Contract và vai trò

- Vault: `0x2415a87B0b9280C1989F03ceA9DC1c3644777862`.
- Escrow: `0x19E14a1006d106882D4c24584AAA6Ce1771E4151`.
- Adapter v2: `0x0db5f0CC38F86e60FEbe495d4fFAF2Bb0288704d`; v1 superseded vẫn không được dùng.
- Owner/grantee/evaluator: Circle SCA `0x7329d0F937dAa2f16Ff0869C5E05a907A4c17dC2`.
- Provider EOA mainnet riêng: `0xDc69A0851c1a7C887bEe33f0A58a675E2Edc0C4c`. Encrypted V3 keystore và DPAPI password ở ngoài repo; không dùng khóa public local/testnet cho mainnet. Chữ ký quote đã được recover và đối chiếu đúng provider trước reserve.
- Child grant restrict provider/evaluator theo hai địa chỉ trên, cap 20.000 units và expiry đã ghi trong journal. Root cap 1 USDC, max commitment 0,1 USDC, concurrency 1 không đổi.

Evaluator owner là vai trò kiểm thử nội bộ; receipt thanh toán không chứng minh chất lượng dịch vụ hoặc nghiệm thu độc lập. Báo giá provider hiện chỉ hỗ trợ ECDSA EOA, chưa có ERC-1271 SCA.

## Phí và số dư

[Hồ sơ phí](arc-mainnet-pilot-fees-2026-10-12.json) giữ riêng phí Circle báo/receipt và số dư. Tổng measure dùng để đối soát ceiling khoảng **0,1457485123 USDC**, dưới trần 0,30 USDC: 0,1414059370 phần Circle (max reported fee/receipt gas từng transaction) + 0,0043425753 gas từ ba provider transactions. Estimate chỉ được giữ trước khi gửi; sau receipt đã xác nhận, giải phóng phần dự phòng của estimate và giữ measure xác nhận. Không cộng estimate thêm lần nữa vào phí đã xác nhận.

Provider được cấp 0,02 USDC nội bộ cho gas; đó không phải một khoản phí độc lập cộng thêm. Owner sau pilot: **2,001305 USDC**; provider: **0,020657 USDC**, gồm tiền gas chưa dùng và payout. Quan sát owner giảm 0,025 USDC so với snapshot trước pilot tương ứng chuyển provider 0,02 và net deposit/withdraw 0,005; các measure networkFee tự chúng không chứng minh billing thực tế từ ví. Không suy đoán Circle thu bao nhiêu từ số dư, và không cộng đôi native/ ERC-20 USDC.

## Verification và khả năng resume

- [Mainnet manifest](../../deployments/arc-mainnet.json) đã cập nhật binding, ledger, job count, expected root gross spend và ngoại lệ pilot.
- Journal (operator-local evidence; omitted from the public release) lưu **19 transaction** với idempotency/ID/hash/canonical receipts. Reserve và dispatch mỗi job chỉ một lần; các lần chạy lại không tạo payment ID mới.
- [Verifier snapshot](arc-mainnet-pilot-verification-2026-10-12.json): 19 receipt đều success/canonical, source/compiler metadata/runtime khớp, terminal reservation/job roles/amounts đúng, refund/payout events đúng recipient, backing/allowance rỗng và ceiling đạt.
- `pnpm example:mainnet-pilot-readonly` dùng SDK độc lập đọc RPC thật: refund REFUNDED, settlement SETTLED/CONFIRMED, physical/unassigned/shortfall đều zero. SDK thêm `createArcMainnetPilotClient` và `arcMainnetPilotDeployment`; export canary cũ giữ snapshot lịch sử unbound, không dùng nó như trạng thái vận hành hiện tại.
- Ba test policy kiểm tra phạm vi đã duyệt, trần phí và giải phóng estimate sau confirmation. SDK tổng 39 tests; full build/lint/docs được chạy lại sau thay đổi.
- Build/lint sau pilot đã đạt: build log (operator-local evidence; omitted from the public release), lint log (operator-local evidence; omitted from the public release). Timestamp warnings vẫn theo ADR 0003. Bốn source Solidity đã audit giữ nguyên SHA-256; không còn file password tạm hoặc bản sao CLI shim sau execution.

Lệnh verification chỉ đọc:

```powershell
pnpm verify:arc-mainnet --output docs/deployments/arc-mainnet-pilot-verification-2026-10-12.json
pnpm example:mainnet-pilot-readonly
pnpm test:mainnet-pilot-policy
```

## Sự cố công cụ đã xử lý

Circle CLI 1.1.4 truyền positional ABI parameters dưới dạng string. Với array/tuple, estimate dùng string ban đầu lỗi; chuyển thành array giúp estimate nhưng user challenge trả HTTP 400 Invalid request body. Chưa có grant transaction được tạo ở lần bị từ chối. Gửi raw `callData` do viem encode (đường được Circle CLI/API dùng trong chính source cho các integration khác) khắc phục cả estimate và submit.

Compatibility shim dùng bản sao tạm của CLI, đổi đúng hai request sites trong handleAgentExecute sang raw calldata, giữ auth/challenge/idempotency flow; original installed CLI không bị sửa, file tạm được xóa. Các call đều được simulation kiểm tra trước; provider raw tx còn được decode và recover signer để đối chiếu chain/to/data/value/nonce/gas trước broadcast. Nếu phiên bản CLI đổi và request sites không khớp, shim dừng.

Một lần runner dừng do cộng giữ lại estimate tối đa của giao dịch đã confirmed. Sau khi phân biệt pending fee reservation và confirmed fee measure, runner tiếp tục cùng journal; không đổi trần 0,30 và không trả trùng. Bằng chứng funding trước approval, lost response và known HTTP validation rejection được ghi riêng; không coi timeout là thất bại kinh tế.

## Ngoại lệ review và giới hạn

Người dùng trực tiếp chọn **cho phép ngoại lệ và chốt pilot** sau khi xem Studio/self-review, signer và trần phí. [Phạm vi đã chốt](arc-mainnet-pilot-execution-scope-2026-10-12.md), [ADR 0005](../adr/0005-mainnet-agentic-commerce-escrow.md) và manifest giữ sự kiện này. Independent review vẫn **false**; ngoại lệ chỉ áp dụng pilot nội bộ đã chạy, không tự cho phép vốn production rộng hơn, giao dịch mới hoặc công bố.

Known limits giữ nguyên: USDC issuer có thể chặn transfers/refund, evaluator là điểm tin cậy, Open orphan có thể tồn tại, vault không rescue direct transfers và binding không đổi được. Không có audit độc lập/certification Circle hoặc proof mọi đường đi đều an toàn. Việc source verification trên explorer và công bố vẫn là phạm vi riêng.
