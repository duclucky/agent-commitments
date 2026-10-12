# Phạm vi kích hoạt pilot mainnet đề xuất — 2026-10-12

## Quyết định mới và thực thi

Sau khi bản đề xuất bên dưới được trình bày, người dùng đã chọn **“Cho phép ngoại lệ và chốt phạm vi pilot trên”**: độc lập review không còn chặn pilot giới hạn này theo quyết định trực tiếp của chủ tiền. `independentHumanAudit`/`independentSecurityReview` vẫn false; không ghi ngoại lệ thành bằng chứng đã audit độc lập. Deposit 0,01 USDC, fee ceiling 0,30 USDC, provider EOA riêng và evaluator owner được duyệt.

Provider mainnet riêng: `0xDc69A0851c1a7C887bEe33f0A58a675E2Edc0C4c`, encrypted keystore ngoài repo, password Windows DPAPI. [Kiểm tra keystore](arc-mainnet-provider-verification-2026-10-12.json) đã xác minh địa chỉ sau giải mã, không xuất khóa.

Người dùng đã nạp thêm; [preflight sau nạp](arc-mainnet-approved-pilot-preflight-2026-10-12.json) xác nhận owner 2,026305 USDC, đủ reserve ceiling. Bắt đầu runner với journal bền vững ở pilot journal (operator-local evidence; omitted from the public release). Mỗi bước estimate/simulation, lưu ID/hash và canonical receipt; theo dõi journal cho kết quả cuối. Nội dung proposal bên dưới được giữ làm lịch sử, không còn là trạng thái permission hiện tại.

Người dùng đã yêu cầu triển khai mainnet và tiếp tục. Chưa broadcast trong bước preflight này: điều kiện review độc lập ở AGENTS.md vẫn còn hiệu lực, chưa có quyết định ngoại lệ rõ hoặc trần phí được thống nhất. Không đánh dấu Circle Studio thành independent review.

## Kết quả chuẩn bị

- [Preflight source/runtime/state](../audits/mainnet-activation-preflight-2026-10-12.json) và [calldata read-only mới](arc-mainnet-pilot-preflight-2026-10-12.json): đúng chain 5042, bytecode khớp, vault chưa bound/funded.
- Circle CLI 1.1.4 đọc balance owner bằng 0,052 USDC. Native 18 decimals và ERC-20 6 decimals là cùng tài sản; không cộng thành 0,104 USDC.
- [Estimate Circle](arc-mainnet-circle-fee-estimates-2026-10-12.json): bind `0.01211615925` USDC, approve `0.014094622302140968` USDC theo trường networkFee. Đây khác direct EVM gas estimate và chưa bao gồm deposit, role funding hay lifecycle; tổng hai thao tác khoảng 0,02621 USDC.
- Rehearsal fork mainnet (operator-local evidence; omitted from the public release): source/hash và địa chỉ ba contract thật, code USDC được thay bằng MockUSDC chỉ trong fork local. Dùng public dummy signer local, không dùng keystore/khóa mạng thật. Không có broadcast hoặc quyền thay token trên mainnet.

## Mô phỏng đã đạt

Bind → exact approve → deposit 10.000 units → grant với provider/evaluator hạn chế → reserve/dispatch/price/fund/reject/reconcile 10.000 units → reserve/dispatch/price/fund/submit/complete/reconcile 5.000 units → withdraw 5.000 units.

Ledger cuối: D=10.000, S=5.000, W=5.000; A=R=E=0, activeCommitments=0. Provider mock nhận 5.000 units; vault/adapter/escrow không còn token và adapter allowances đều zero. Fork block 25571269; Forge báo script thành công. Gas tổng harness 2.189.268 bao gồm local fixture/checks, không phải giá gas production. StepGas là gas đo trong cùng simulation, không tính SCA/relayer và trạng thái cold độc lập từng tx; không dùng nó làm hóa đơn hoặc trần chi thật.

Hai lỗi harness trước khi đạt đã được xác định/sửa: lệnh script cần chạy trong contracts và `vm.prank` bị getter ROOT_GRANT_ID tiêu thụ trước createGrant. Không sửa Solidity production hoặc tiêu chí nghiệm thu.

## Phạm vi nếu được chốt

- Network: Arc Mainnet, chain 5042, USDC ERC-20 6 decimals.
- Owner Circle wallet: `0x7329d0F937dAa2f16Ff0869C5E05a907A4c17dC2`.
- Vault: `0x2415a87B0b9280C1989F03ceA9DC1c3644777862`; bind duy nhất adapter v2 `0x0db5f0CC38F86e60FEbe495d4fFAF2Bb0288704d`; escrow `0x19E14a1006d106882D4c24584AAA6Ce1771E4151`.
- Tổng deposit chỉ 0,01 USDC. Refund job 0,01 USDC, settlement job 0,005 USDC; số dư còn lại 0,005 USDC rút lại owner. Không chạy workload thương mại hoặc gọi đây là traction.
- Provider: đề xuất tạo EOA mainnet riêng bằng encrypted keystore; không dùng dummy key hoặc keystore chỉ dành testnet. Provider EOA cần gas và ký EIP-712. Evaluator đề xuất owner Circle wallet cho smoke nội bộ; đây không phải nghiệm thu độc lập. Chưa tạo signer mainnet trong phạm vi preparation.
- **Trần phí đề xuất 0,30 USDC cho cả pilot**, bao gồm gas/SCA/relayer và phí cấp gas cho provider; đây là ceiling xin chốt, không phải dự đoán thực tế hoặc quyền chi đã có. Tiền cấp gas provider là chuyển nội bộ và phải đối chiếu riêng với phí thực phát sinh, không tính hai lần. Dừng trước bước tiếp theo nếu estimate sẽ vượt trần hoặc mất finality.
- Duy trì ít nhất 0,31 USDC tổng tiền được bố trí (0,01 deposit + 0,30 phí tối đa). So với 0,052 hiện tại, thiếu 0,258 USDC để bố trí toàn bộ ceiling. Không kết luận pilot chắc chắn thiếu phí thực tế; estimate toàn lifecycle còn cần signer/call state cụ thể.
- Stable idempotency theo mỗi tác vụ và transaction journal trước request; mất phản hồi truy transaction ID/hash, không tạo payment mới. Kiểm tra chain/code/state/receipt trước bước tiếp theo.

## Quyết định còn thiếu

AGENTS.md yêu cầu: “Mainnet readiness cần đủ kiểm tra tiền/quyền/phục hồi và review độc lập”. Người dùng cần chọn cung cấp review độc lập hoặc **cho phép ngoại lệ rõ cho pilot giới hạn này dựa trên Studio/self-review hiện có**. Việc cấp quyền triển khai không được ghi thành bằng chứng review đã diễn ra.

Đồng thời chốt trần phí/role/amount ở trên. Khi được chốt và ví được bố trí đủ tiền, runner mới có thể được thực hiện; không dùng các con số đề xuất làm approval ngầm. Không công bố repo/site/X/showcase trong phạm vi này.
