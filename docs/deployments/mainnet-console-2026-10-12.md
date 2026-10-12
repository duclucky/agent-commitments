# Console mainnet chỉ đọc — kiểm chứng 2026-10-12

Cập nhật ngôn ngữ giao diện: console đã chuyển toàn bộ nội dung hiển thị và accessibility sang tiếng Anh, gồm demo, mainnet, loading/error và recovery. [Ảnh bản tiếng Anh](mainnet-console-en-2026-10-12.png) được chụp sau build, đọc mainnet thành công tại block 25598004. 13 test console/server và browser local-chain E2E 375px bằng bàn phím đã chạy lại và pass. Ảnh tiếng Việt bên dưới là bằng chứng lịch sử trước khi sửa.

Phạm vi hoàn tất: console local đọc dữ liệu Arc Mainnet của pilot đã được duyệt; developer quickstart SDK độc lập và bản nháp công bố. Không có giao dịch mới, đổi contract, public hosting, đăng X hoặc Showcase submission trong phạm vi này.

## Bằng chứng runtime

[Snapshot RPC](mainnet-console-snapshot-2026-10-12.json) tại block **25577700**, chain 5042:

| D | A | R | E | S | W |
|---|---|---|---|---|---|
| 10000 | 0 | 0 | 0 | 5000 | 5000 |

Đơn vị nhỏ nhất ERC-20 USDC, 6 decimals. Physical backing, unassigned và shortfall đều 0. Job 1 REFUNDED / REJECTED, job 2 SETTLED / COMPLETED; hai reconciliation receipts CONFIRMED và khớp canonical block. Collector kiểm tra chain ID, tuổi RPC head, ba runtime code hash, binding v2, decimals/token và backing ở cùng block, rồi kiểm tra block đó vẫn canonical sau các lần đọc. Snapshot là bằng chứng tại thời điểm đọc, không phải nguồn quyết định chuyển tiền.

## Kiểm tra đã chạy

- `pnpm test:mainnet-console`: **13 test pass** (11 presentation/validation/recovery + 2 server). Bao gồm sai chain, snapshot cũ, tiền dạng float, ledger/backing sai, donation không ghi có A, GET no-store, POST bị từ chối và lỗi RPC không lộ exception.
- `pnpm test:browser-local-chain`: pass sau sửa cuối; settlement trên Anvil bằng bàn phím, viewport 375px. Foundry build có các warning timestamp và unchecked transfer ở fixture đã có từ trước; không sửa contract trong đợt này.
- Build console/network-config/SDK pass. `pnpm check:docs` pass.
- Chrome live mainnet: 2 hàng với REFUNDED/SETTLED và CONFIRMED; Enter trên nút đọc lại hoàn tất và giữ focus. Viewport 375px không tràn chiều ngang toàn trang; bảng cuộn trong vùng riêng. [Ảnh desktop](mainnet-console-2026-10-12.png), [ảnh mobile](mainnet-console-mobile-2026-10-12.png).
- Fault-injection server local riêng trả HTTP 503: UI hiện “Chưa xác minh”, cả 6 số tiền là “—”, 0 hàng job; không hiện dữ liệu demo hoặc trạng thái thành công. Server thử nghiệm đã dừng sau kiểm tra.

## Sử dụng và giới hạn

Chạy `pnpm console:mainnet`, mở `http://127.0.0.1:4173/?mode=mainnet`. Server chỉ nghe loopback và không có signer hoặc endpoint ghi. Sau 2 phút UI bỏ snapshot cũ, yêu cầu đọc lại. Journal đầy đủ, raw signed transaction và quote signature không được serve; chỉ các trường public được chọn đi qua API.

Xem [quickstart](../quickstart-arc-mainnet.md), [bản nháp Showcase/X](../showcase-draft.md) và [pilot](arc-mainnet-pilot-2026-10-12.md). Review độc lập, external adoption và public release chưa hoàn tất. Console chỉ quan sát hai job pilot đã biết; chưa phải indexer lịch sử toàn bộ vault hoặc cổng vận hành production. Snapshot và ảnh là hoạt động nội bộ, không tính traction.
