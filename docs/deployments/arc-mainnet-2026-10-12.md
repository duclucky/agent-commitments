# Arc mainnet deployment và pilot — 2026-10-12

`BudgetVault`, `AgenticCommerceEscrow` và `ERC8183DraftAdapter` v2 đã được triển khai trên Arc mainnet. Sau canary ban đầu, người dùng cho phép ngoại lệ review độc lập cho pilot giới hạn: vault đã bind v2 và hoàn tất refund/settlement/withdraw bằng USDC thật. Xem [pilot record và 19 receipts](arc-mainnet-pilot-2026-10-12.md). Budget hiện rỗng; không có nghĩa vụ pending. Independent review vẫn false theo [ADR 0005](../adr/0005-mainnet-agentic-commerce-escrow.md).

## Địa chỉ và giao dịch

- Owner/deployer wallet: [`0x7329d0F937dAa2f16Ff0869C5E05a907A4c17dC2`](https://explorer.arc.io/address/0x7329d0F937dAa2f16Ff0869C5E05a907A4c17dC2)
- Checked CREATE2 deployer: [`0x01c9f78F19aCe62D3517AE883984b60Ab72Ee94C`](https://explorer.arc.io/address/0x01c9f78F19aCe62D3517AE883984b60Ab72Ee94C), [transaction](https://explorer.arc.io/tx/0x707b28ffdced14cd26b4b4a8221e6a256490783057f837b45a64be07e05daaed)
- BudgetVault: [`0x2415a87B0b9280C1989F03ceA9DC1c3644777862`](https://explorer.arc.io/address/0x2415a87B0b9280C1989F03ceA9DC1c3644777862), [transaction](https://explorer.arc.io/tx/0xe20da8e008b59a04d5a807667bd1446a8edfe394a2c96726a1d6a297a5de8e82)
- Escrow candidate: [`0x19E14a1006d106882D4c24584AAA6Ce1771E4151`](https://explorer.arc.io/address/0x19E14a1006d106882D4c24584AAA6Ce1771E4151), [transaction](https://explorer.arc.io/tx/0xc47a01334079828dd2f6d39fabc4b2e581321b387539021fcc639907128a2569)
- Adapter candidate v2: [`0x0db5f0CC38F86e60FEbe495d4fFAF2Bb0288704d`](https://explorer.arc.io/address/0x0db5f0CC38F86e60FEbe495d4fFAF2Bb0288704d), [transaction](https://explorer.arc.io/tx/0x9faf77f6f2ef42741262f7989702f93487526b67748d8d14acf8863e08ce05f5)

Escrow runtime: 6.877 byte, hash `0xd7d2f4b47c3ead3ae5bcaa7db790d5841577aa347cf7b433a8dbdf9566a882fb`. Adapter v2 runtime: 7.028 byte, hash `0xac4382e1add9828e48bce8c0569fa77d53442cfa7e3ae8832270f75afead4da6`.

Vault runtime có 12.420 byte và hash `0x9d39228432ff3a2fed8a959c9a8692109f0fb5f77db12d3b7061089fda388bc2`. Manifest đầy đủ nằm tại [`deployments/arc-mainnet.json`](../../deployments/arc-mainnet.json).

## Chính sách immutable và trạng thái

- Token: USDC `0x3600000000000000000000000000000000000000`, 6 decimals.
- Deposit cap: `1.000.000` atomic = 1 USDC.
- Max commitment: `100.000` atomic = 0,1 USDC.
- Max concurrent commitments: `1`.
- Root grant expiry: `2027-01-10T00:00:00Z`.
- Adapter: v2 `0x0db5f0CC38F86e60FEbe495d4fFAF2Bb0288704d`; `paused = false`.
- Ledger sau pilot: D=10000, S=5000, W=5000, A/R/E=0; vault không giữ USDC và không có commitment đang hoạt động.

## Gom ví và chi phí quan sát được

Phần dưới là snapshot trước kích hoạt pilot; số dư/phí pilot mới nằm trong record được liên kết ở đầu tài liệu.

Bốn ví nguồn đã chuyển mỗi ví `0,008 USDC` qua native Arc representation vào ví owner, tổng cộng `0,032 USDC`. Số dư ERC-20 của owner sau gom và deploy candidate vẫn là `0,052 USDC`; đây là kết quả truy vấn Circle CLI. Hai biểu diễn native 18 decimals và ERC-20 6 decimals là cùng giá trị và không được cộng đôi. Chỉ từ số dư này không thể suy ra bên nào trả phí hoặc khoản billing sau đó.

Bản ghi ban đầu gán sai nhãn phí: `0,12786974908576769 USDC` là tổng `networkFee` Circle báo cho bốn lần chuyển, lần deploy thử thất bại, helper và vault; không phải tổng `gasUsed × effectiveGasPrice` trong receipt. Manifest hiện đã sửa tên trường và lưu từng receipt gas cost riêng. Tính cả escrow, adapter v1 và adapter v2, tổng receipt gas cost là `0,200734863 USDC`, tổng networkFee Circle báo là `0,2630078584324176 USDC`. Hai số này đo khác nhau và không được coi là tổng tiền ròng đã trừ khỏi ví owner.

Lần gọi trực tiếp ERC-2470 đầu tiên có [transaction thành công ở lớp account](https://explorer.arc.io/tx/0xbf40f1d685e6976de3fe59d89e80549cde5cfef6bfd5c33ef00d9f01047af16b), nhưng inner `CREATE2` hết gas và trả zero address. Địa chỉ dự kiến `0x4901F391BE7ba4AB93C82C3Be139cA9834da6DD5` không có code. Deployment sau đó dùng helper 29 byte kiểm tra kết quả `CREATE2` và revert nếu việc tạo contract thất bại.

## Phạm vi bằng chứng

`pnpm verify:arc-mainnet` kiểm tra chain ID, receipt canonical, block/gas, bytecode size/hash, USDC decimals, constructor state, root grant, ledger theo manifest và việc địa chỉ của lần thử thất bại không có code. Với stack mới, lệnh còn đối chiếu creation calldata trong transaction, địa chỉ CREATE2, init code và runtime ngoài vùng immutable với artifact local, rồi kiểm tra các immutable và allowance. Sau pilot, verifier đối chiếu thêm 19 receipt, hai terminal jobs/reservations, refund/payout event và phí theo ceiling. Source chưa publish lên explorer và workspace không có Git revision.

Adapter candidate v1 `0xBB3D6a8Bf71a92b62ae20A964B172Fad606080CD` chưa bind, chưa có tiền và đã superseded. Regression cho thấy v1 cho tạo job Open sau khi grant hoặc ancestor revoked/expired; vault vẫn chặn funding. V2 thêm kiểm tra ancestry trước dispatch. Không dùng v1 cho binding hoặc tích hợp mới; manifest giữ receipt/hash v1 để đối soát chi phí và lịch sử.

Escrow tự triển khai pin subset của ERC-8183 Draft được rà ngày 2026-10-12; không phải reference chính thức của Circle và không tuyên bố tương thích mọi bản Draft. Pilot nạp/refund/settle/withdraw mainnet đã hoàn tất theo ngoại lệ rõ của chủ tiền; review độc lập chưa có. Hồ sơ nằm tại [mainnet candidate review](../mainnet-candidate-review.md).

Snapshot trước binding: [canary verification JSON](arc-mainnet-verification-2026-10-12.json). Snapshot sau pilot: [pilot verification JSON](arc-mainnet-pilot-verification-2026-10-12.json). Solidity source/dependency content hashes khớp compiler metadata; vault và stack creation code/CREATE2/runtime cũng khớp artifact. Snapshot có thời điểm kiểm tra và không tự cập nhật khi chain thay đổi.
