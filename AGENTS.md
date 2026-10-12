# AGENTS.md

## Giao tiếp và phạm vi công việc

- Trả lời bằng tiếng Việt, trừ khi người dùng yêu cầu ngôn ngữ khác. Nêu kết quả trước, chỉ thêm chi tiết cần để hiểu hoặc kiểm chứng.
- Phân biệt yêu cầu giải thích, nghiên cứu, đánh giá, lập kế hoạch với yêu cầu triển khai. Viết kế hoạch không mặc nhiên cho phép xây dựng sản phẩm.
- Với công việc đã được giao rõ ràng, làm đến khi hoàn tất và kiểm chứng. Tận dụng quyền đã được cấp trong phiên; chỉ hỏi khi thông tin thiếu ảnh hưởng đáng kể đến tính đúng, phạm vi hoặc hành động không thể đảo ngược.
- Giữ nguyên thay đổi của người dùng. Không ghi đè, reset, xóa, đổi cấu trúc hoặc thêm dependency ngoài phạm vi cần thiết.
- Đọc hướng dẫn trong các AGENTS.md cấp dưới nếu có. Dùng skill phù hợp; điều chỉnh mức lập kế hoạch và kiểm thử theo rủi ro thực tế.
- Không tự tạo subagent, commit, worktree hoặc khởi tạo Git nếu không có yêu cầu hay chỉ dẫn áp dụng cho phép.
- Không tiết lộ khóa riêng, token, thông tin xác thực, tài liệu khách hàng hoặc payload nhạy cảm trong log, ảnh chụp, tool output và phản hồi.
- Cần người dùng cho phép rõ trước khi công bố, thực hiện hành động phá hủy hoặc giao dịch tài chính. Bao gồm public repo/package/site, đăng X, submit-showcase, update-traction, deploy mainnet, approve token và chuyển tiền. Chuẩn bị nội dung, kiểm tra và bản xem trước trước khi xin phép thực hiện.
- Không tự broadcast lên mạng dùng chung, kể cả testnet, khi mới được yêu cầu lập kế hoạch hoặc kiểm tra local. Khi đã được phép, tuân theo phạm vi mạng, ví, hợp đồng, giá trị và trần phí đã thống nhất.

## Mục tiêu sản phẩm

Tên làm việc: **Agent Commitments**.

Xây dựng hạ tầng mã nguồn mở cho thanh toán dịch vụ số toàn cầu trong Agent Economy: nhiều agent sử dụng chung ngân sách USDC, phân quyền, giữ trước tiền cho công việc, quyết toán và phục hồi sau lỗi mà không chi vượt ngân sách hoặc trả trùng trong các luồng được hỗ trợ.

- Arc là nơi quản lý ngân sách và nghĩa vụ thanh toán của phiên bản đầu.
- Giá trị tái sử dụng nằm ở hợp đồng, SDK, mô hình trạng thái và bộ kiểm thử lỗi; ứng dụng xử lý tài liệu là ví dụ tích hợp và kênh kiểm chứng nhu cầu.
- Bổ sung cho Circle Agent Wallets, CCTP/Gateway và các chuẩn liên quan; không xây lại ví, bridge, marketplace tổng quát hoặc cơ chế escrow nếu có thành phần phù hợp đã được kiểm tra.
- Không thêm token, yield, tín dụng không bảo đảm, FX, fiat off-ramp, agent chấm điểm bằng LLM hoặc đa chuỗi chỉ để tăng số tính năng.
- Không tuyên bố “toàn cầu” đồng nghĩa hỗ trợ mọi quốc gia, mọi ngân hàng hoặc mọi chain. Công bố chính xác tài sản, tuyến chuyển tiền và phụ thuộc đã xác minh.

Kế hoạch chuẩn: [docs/implementation-plan.md](docs/implementation-plan.md). Trạng thái, giao diện và lệnh trong kế hoạch là đề xuất cho đến khi có mã nguồn và bằng chứng kiểm chứng tương ứng.

## Kiến trúc và quyền sở hữu dữ liệu

- Hợp đồng quyết định số tiền khả dụng, cam kết, phân quyền và chuyển tiền. Database/indexer là bản chiếu phục vụ truy vấn, không phải nguồn có thẩm quyền để giải phóng tiền.
- Phân biệt trạng thái kinh tế của cam kết với trạng thái truyền giao dịch. RPC timeout không phải bằng chứng thanh toán thất bại.
- LLM được đề xuất nhà cung cấp, báo giá và trình tự công việc; kiểm tra quyền, số tiền, chữ ký và trạng thái phải là mã xác định.
- Tách module theo trách nhiệm: domain, contracts, SDK, runtime, ứng dụng tham chiếu. Không tách package hay thêm abstraction chỉ để bọc một thư viện.
- SDK và hợp đồng phải dùng được khi không chạy ứng dụng tham chiếu hoặc dịch vụ hosted của dự án.
- Tương thích AP2, ERC-8183 hoặc x402 chỉ được tuyên bố cho phiên bản, tính năng và kiểm thử thực sự đã hoàn tất. Không gọi schema tự thiết kế là tuân thủ một chuẩn.
- Quyết định thay đổi mô hình giữ tiền, quyền quản trị, accounting hoặc chuẩn tích hợp phải được ghi trong ADR trước khi sửa hành vi.

## Bất biến tiền và ủy quyền

- USDC dùng số nguyên đơn vị nhỏ nhất: bigint trong TypeScript và uint256 trong Solidity; không dùng số thực cho tiền. API truyền số tiền dưới dạng chuỗi số nguyên.
- Xác minh decimals của token trên mạng đích. Trên Arc, phân biệt giao diện ERC-20 USDC 6 decimals với giao diện native phục vụ gas 18 decimals; không cộng hai cách biểu diễn thành hai số dư.
- Mỗi root budget tuân theo phương trình D = A + R + E + S + W được định nghĩa trong kế hoạch. Cập nhật mỗi chuyển trạng thái đúng một lần.
- Không tính tiền đang bridge, chờ xác nhận, chờ hoàn hoặc đang nằm trong escrow thành tiền khả dụng.
- Mỗi reservation phải trừ khả năng chi ở mọi cấp grant liên quan. Grant con không được mở rộng quyền, thời hạn, tập người nhận hoặc giới hạn của grant cha.
- Thu hồi quyền chặn cam kết và dispatch mới; không xóa nghĩa vụ đã funded hoặc chiếm lại tiền nhà cung cấp đã được hưởng theo điều khoản.
- Chỉ reservation chưa dispatch, chưa tạo nghĩa vụ bên ngoài mới được giải phóng theo TTL nội bộ. Timeout của worker không được giải phóng escrow.
- Dùng định danh ổn định cho cùng một tác vụ kinh tế. Retry không tạo payment ID mới; cùng idempotency key với payload khác phải bị từ chối.
- Chữ ký phải ràng buộc chain, verifying contract, budget/grant, nhà cung cấp, evaluator, token, số tiền, nội dung công việc, nonce và hạn sử dụng thích hợp.
- Không cho phép arbitrary call, delegatecall hoặc allowance không giới hạn tới adapter do agent cung cấp. Đường đi của tiền chỉ qua adapter đã được định danh và kiểm tra.
- Tiền chuyển nhầm trực tiếp vào hợp đồng không được tự động ghi có cho một budget hoặc coi là refund của một job.
- Chỉ hạch toán hoàn tiền khi đã xác minh trạng thái có thẩm quyền và tiền thực sự đã thu hồi. Biên nhận HTTP hoặc DB status không đủ.
- Bằng chứng thanh toán không phải bằng chứng chất lượng dịch vụ. Phải công bố ai nghiệm thu, tiêu chí nào và giới hạn tin cậy.
- Mọi bảo đảm ngân sách chỉ áp dụng cho các dòng tiền đi qua hệ thống; không tuyên bố kiểm soát khóa ví hay khoản chi bên ngoài.

## Mạng, khóa và triển khai

- Trước tích hợp, xác minh chain ID, RPC, explorer, token, địa chỉ/code hash hợp đồng và trạng thái hỗ trợ của từng sản phẩm Circle từ nguồn chính thức và bằng chứng read-only.
- Skill hoặc README cũ có thể chỉ nói về testnet. Không sao chép cấu hình testnet sang mainnet hoặc tự suy ra địa chỉ mainnet.
- Pin phiên bản dependency, compiler và reference implementation; giữ lockfile. Ghi nguồn, ngày kiểm tra và phiên bản chuẩn trong capability matrix/ADR.
- Không tạo, đọc ra màn hình hoặc chuyển khóa riêng qua tham số CLI. Dùng môi trường/secret manager và external signer hoặc encrypted keystore thích hợp.
- Chỉ dùng khóa cố định công khai cho chain local; tách hẳn khỏi mọi mạng dùng chung. Không đưa secret vào NEXT_PUBLIC_*, frontend bundle, fixtures, Git hoặc deployment manifest.
- Local demo và mock phải được ghi nhãn. Không dùng mock như fallback im lặng khi RPC hay dịch vụ production lỗi.
- Pause chỉ chặn tạo nghĩa vụ mới theo chính sách đã chốt; phải bảo toàn đường hoàn tiền, đối soát và hoàn tất nghĩa vụ hiện có.
- Pilot ưu tiên hợp đồng không upgradeable, trần tiền nhỏ và cách rút phần chưa cam kết. Không nâng quyền quản trị để sửa nhanh sự cố.

## Quy trình triển khai và kiểm thử

1. Đọc kế hoạch, mã hiện tại và phạm vi thay đổi; xác định điều kiện chấp nhận liên quan.
2. Với lỗi, tái hiện và xác định nguyên nhân từ bằng chứng trước khi sửa.
3. Với hành vi mới có rủi ro tiền/quyền, viết ca lỗi hoặc regression có ý nghĩa trước khi triển khai khi khả thi.
4. Thay đổi tối thiểu, bảo vệ bất biến và giữ phạm vi. Cập nhật ABI, SDK, schema và tài liệu cùng nhau khi đổi giao diện.
5. Chạy kiểm tra phù hợp với phần đã sửa. Không viết test hình thức cho thay đổi tài liệu hoặc test chỉ lặp lại implementation.
6. Rà diff và trạng thái cuối; báo kết quả, bằng chứng và phần chưa kiểm chứng.

Các nhóm kiểm tra cần có khi phần tương ứng đã được xây dựng:

- Domain: accounting, grant ancestry, quote binding, idempotency và transition properties.
- Contracts: unit, fuzz/invariant, reentrancy, replay, sai quyền và khả năng rút/hoàn sau sự cố.
- Runtime: concurrency, event trùng/đảo thứ tự, restart ở ranh giới broadcast, mất phản hồi và DB rebuild.
- Integration: SDK độc lập, token thật trên mạng đã được phép, escrow/adapter đúng phiên bản, bridge nếu có.
- UI: trạng thái pending/unknown/error/refund; không hiện success chỉ vì đã có tx hash; keyboard và mobile flow quan trọng.

Không có lệnh build/test thực thi nào được xác lập ở thời điểm chỉ có tài liệu. Khi scaffolding, định nghĩa các script đã nêu trong kế hoạch và xác minh script tồn tại trước khi chạy. Không báo pass từ lệnh chưa tồn tại, không thu thập được test hoặc chưa chạy.

## Chất lượng mã nguồn mở và bằng chứng sản phẩm

- Mỗi primitive có giao diện rõ, ví dụ chạy được, threat model, hạn chế và license phù hợp dependency.
- Giữ phần lõi độc lập với framework agent, LLM provider, database và dịch vụ hosted khi không cần thiết.
- Không công khai văn bản nguồn, thông tin cá nhân hay nội dung thương mại của job; chỉ dùng commitment/hash trên chuỗi theo thiết kế bảo mật đã rà soát.
- Mainnet readiness cần đủ kiểm tra tiền/quyền/phục hồi và review độc lập; build xanh hoặc source verification không thay thế security review.
- Traction phân biệt local/testnet/mainnet, job/giao dịch, ví/người/tổ chức. Loại hoạt động nội bộ, kiểm thử và giao dịch tự tạo khỏi số liệu người dùng độc lập.
- Không bịa khách hàng, tích hợp, volume, audit, hoạt động GitHub hoặc khả năng thắng giải. Không tạo lịch sử commit giả.
- Chỉ nói hoàn tất khi tiêu chí của phạm vi đã giao có bằng chứng mới phù hợp. Ghi rõ phần bị chặn bởi quyền truy cập, dịch vụ, approval hoặc kiểm tra chưa chạy.
