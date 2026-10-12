# Agent Commitments — tự audit bằng Circle Arc Studio

Ngày kiểm tra: 2026-10-12. Kết quả đã đối chiếu: 55/55 test đạt cả trong Studio và local, gồm 4 fuzz properties × 256 lượt = 1.024 lượt fuzz. Chưa chứng minh được lỗi chi vượt ngân sách, replay thanh toán hoặc thanh toán trùng trong các trường hợp đã chạy. Đây không phải kết luận rằng mọi đường đi đều an toàn.

Đã sử dụng [Arc Studio by Circle](https://studio.arc.io/app/caac8290-b4d2-4489-aa78-fb294c2d155e), qua CLI chính thức 1.1.3, với hai lượt: phân tích/PoC và hiệu chỉnh dựa trên bằng chứng tái hiện local. Hai kết quả đều `completed`, danh sách `deployments` rỗng. Không sửa source production, bind adapter, approve, nạp tiền hoặc broadcast giao dịch trong phạm vi audit.

## Phạm vi và nguồn

| Contract | Địa chỉ Arc Mainnet |
|---|---|
| BudgetVault | `0x2415a87B0b9280C1989F03ceA9DC1c3644777862` |
| AgenticCommerceEscrow | `0x19E14a1006d106882D4c24584AAA6Ce1771E4151` |
| ERC8183DraftAdapter v2 | `0x0db5f0CC38F86e60FEbe495d4fFAF2Bb0288704d` |

Bốn source (ba contract và interface) cùng cấu hình/compiler/test/ADR được pin trong [source manifest](arc-studio-source-manifest-2026-10-12.json). Cả 11 file đầu vào vẫn khớp SHA-256 sau audit; source hashes trong báo cáo Studio khớp manifest. Verifier read-only còn xác nhận source content trong compiler metadata, init code và runtime candidate khớp chain. Adapter v1 superseded và ABI legacy Testnet không thuộc phạm vi audit này.

## Rủi ro còn lại đã xác minh

| ID Studio | Phân loại sau đối chiếu | Bằng chứng và ảnh hưởng |
|---|---|---|
| F-06 | Trung bình — phụ thuộc issuer/liveness | USDC chặn adapter có thể làm refund reconciliation revert. Nghĩa vụ E phải được giữ nguyên đến khi tiền thực sự về vault; sau unblock có thể retry thành công. Test blocklist dùng mock local, không chứng minh chính sách unblock của Circle hay thời gian phục hồi trên mainnet. |
| F-09 | Thấp — chuyển nhầm tiền | Chuyển trực tiếp vào vault không tăng A và không có hàm rescue. Sau rút hết A, phần chuyển nhầm vẫn nằm lại. Không ảnh hưởng số dư được nạp đúng qua `deposit`. |
| F-02/F-12 | Thấp — trạng thái dư thừa | Dispatch rồi cancel/revoke có thể để lại job Open vĩnh viễn; Open không tự expire. Reservation chưa funded có thể cancel ngay bởi owner/grantee, không cần chờ TTL; job đó không thể fund qua adapter sau cancel. Không có USDC bị khóa trong job Open này. |
| F-04 | Ràng buộc thiết kế pilot | Adapter chỉ bind một lần. Lỗi adapter sau funding có thể ngăn đường xử lý nghĩa vụ đã đưa ra ngoài vault. A vẫn rút được; R chưa funded vẫn cancel được. Giữ giới hạn pilot và review trước binding; không thêm quyền upgrade để bỏ qua ràng buộc. |

Các mục permissionless dispatch/fund/reconcile, shared grant cap, input/output hash khác nhau và evaluator nghiệm thu là thiết kế/giả định tin cậy đã công bố, không được đếm thành các exploit độc lập. Thay nonce của cùng grant/operation gây `CommitmentConflict`, không tạo khoản chi thứ hai. `reconcileCompleted` không gọi ra ngoài và status guard chặn lặp trong test; thiếu `nonReentrant` riêng trên hàm này chưa tạo exploit được chứng minh.

Studio v2 liệt kê 1 mục MEDIUM và 13 LOW, bao gồm nhiều mục thiết kế/giả định triển khai. Không diễn giải số này thành “14 lỗ hổng contract”. Không có finding HIGH/CRITICAL còn được xác nhận trong phạm vi này.

## Kết luận không chấp nhận từ báo cáo tự động

Bản đầu có sai sót đã được phản biện và giữ lại làm provenance. Các khuyến nghị ghi refund trước khi thu hồi tiền, hardcode chain ID và buộc deliverable hash bằng work hash đã bị loại. Bất biến đại số D=A+R+E+S+W và backing vật lý là hai kiểm tra khác nhau; ghi refund thiếu tiền có thể vẫn giữ phương trình đại số nhưng phá backing.

V2 đề xuất thêm `abandonOrphanJob` trên adapter để gọi `escrow.reject()` cho job Open: escrow hiện cho client reject Open, nhưng adapter hiện chưa cung cấp đường gọi này. Đây là đề xuất thay đổi API cần kiểm tra authorization/state binding và dùng candidate adapter mới nếu triển khai; không phải hàm đã có hoặc bản sửa đã hoàn tất. V2 suy đoán nguyên nhân lỗi Slither là tương thích compiler; log chỉ chứng minh lỗi phân tích, chưa xác định root cause của công cụ.

## Kiểm tra đã thực thi và giới hạn

- Studio: Forge 1.7.1, solc 0.8.30, optimizer 200, Cancun, OpenZeppelin 5.6.1; 35 baseline + 16 PoC + 4 test phản biện = 55 test, 19 suites, không skip/fail.
- Local: chạy cùng source và PoC cuối trong `.audit-reproduction/arc-studio-2026-10-12`, không chạy chain dùng chung; `ffi=false`, không cấp filesystem cheatcode. Log đầy đủ (operator-local evidence; omitted from the public release) xác nhận 55 test và 1.024 lượt fuzz. PoC và triage được giữ trong thư mục artifact bên dưới để tái hiện.
- Slither 0.11.6 thực sự chạy trong Studio và báo 51 detector results / 24 contracts / 102 detectors. Log gốc (operator-local evidence; omitted from the public release) có lỗi reference resolution, thiếu inheritance BudgetVault và không tạo được IR constructor adapter. **Coverage static analysis không đầy đủ**, kể cả kết quả detector có được sinh ra. Không coi 51 detector results là 51 lỗ hổng. JSON Slither lớn hơn giới hạn tải của CLI, chưa tải được; log đã được lưu, không có bản JSON local hợp lệ.
- Aderyn không có trong sandbox. Chưa chạy mainnet fork hoặc lifecycle bằng USDC thật trên candidate. Không có review độc lập bởi chuyên gia. Kết quả mock blocklist/fuzz không đại diện mọi hành vi issuer/RPC/mainnet.
- [Snapshot mainnet read-only](arc-studio-mainnet-state-2026-10-12.json) lúc `2026-10-12T04:31:05.683Z`: verifier đạt, vault adapter zero, ledger D/A/R/E/S/W đều zero, candidate chưa bound/chưa funded, source/runtime khớp artifact.

Lệnh tái hiện local:

```powershell
forge test --root .audit-reproduction/arc-studio-2026-10-12 -vv
pnpm verify:arc-mainnet --output docs/audits/arc-studio-mainnet-state-2026-10-12.json
```

## Hồ sơ bằng chứng

- Báo cáo Studio v2 nguyên bản (operator-local evidence; omitted from the public release), findings JSON v2 (operator-local evidence; omitted from the public release), bản đầu (operator-local evidence; omitted from the public release).
- [Kết quả lượt đầu](arc-studio-result-2026-10-12.json), [kết quả lượt phản biện](arc-studio-validation-result-2026-10-12.json), yêu cầu phản biện (operator-local evidence; omitted from the public release).
- PoC cuối (operator-local evidence; omitted from the public release), test phản biện (operator-local evidence; omitted from the public release), Forge log Studio (operator-local evidence; omitted from the public release), triage log Studio (operator-local evidence; omitted from the public release).
- Log PoC local ban đầu ghi một fixture test sai và thất bại; fixture được sửa trước bộ 55 test cuối. Không phải bug production và không bị dùng làm bằng chứng pass.

Theo [Arc security](https://www.arc.io/security), kiểm tra bằng Studio không thay thế independent audit. Trạng thái `independentSecurityReview` vẫn **false**. Trước binding/funding mainnet cần review độc lập với source hashes này, giải quyết các finding có ảnh hưởng tiền/quyền và kiểm chứng lifecycle settlement/refund/withdraw theo phạm vi đã duyệt. Tự audit lần này đã hoàn tất; các gate kích hoạt mainnet vẫn còn.
