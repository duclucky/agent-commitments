# Kế hoạch triển khai Agent Commitments

- Ngày lập: 2026-10-09, múi giờ Asia/Bangkok.
- Trạng thái: **Arc Testnet alpha và mainnet canary chưa bind/chưa nạp tiền; M1-M6 đã có mã/kiểm thử local. Review độc lập, mainnet payment lifecycle và xác thực nhu cầu vẫn chưa hoàn tất**.
- Workspace: `C:\Arc Cateen`.
- Điểm xuất phát: thư mục trống trước yêu cầu ban đầu; workspace hiện vẫn chưa là Git checkout.
- Phạm vi đã được cấp và thực hiện: deploy và kiểm thử trên Arc Testnet; người dùng sau đó cấp quyền gom tiền ví Agent Wallet và deploy mainnet. Mainnet đã deploy BudgetVault, escrow và draft adapter v2 dưới dạng unbound/unfunded candidate. Binding, funding và smoke lifecycle chưa thực hiện; công bố repo/site/X/Showcase chưa thực hiện.
- Bằng chứng local và testnet mới nhất được ghi ở checklist cuối tài liệu và [deployment record](deployments/arc-testnet-2026-10-11.md).
- Bằng chứng mainnet và gate hiện tại: [mainnet record](deployments/arc-mainnet-2026-10-12.md), [ADR 0005](adr/0005-mainnet-agentic-commerce-escrow.md) và [candidate review](mainnet-candidate-review.md).

## 1. Kết quả sản phẩm cần đạt

Agent Commitments là bộ hợp đồng và SDK để các nhóm agent mua dịch vụ số từ nhà cung cấp độc lập bằng USDC, chia sẻ ngân sách, giữ trước tiền cho báo giá, thực thi thanh toán và phục hồi khi hệ thống gặp lỗi.

Khách hàng đầu tiên: nhóm xây dựng workflow nhiều agent, có chi phí thực cho OCR, xử lý dữ liệu, dịch thuật hoặc kiểm thử. Người dùng SDK là lập trình viên; người dùng ứng dụng là người vận hành và nhà cung cấp dịch vụ.

Giả thuyết cần kiểm chứng: họ cần quản lý **nghĩa vụ đã cam kết**, không chỉ theo dõi số dư ví hoặc tổng chi đã xảy ra. Một SDK có accounting có thể kiểm chứng và recovery rõ ràng sẽ giảm phần việc họ phải tự xây dựng.

Đóng góp kỹ thuật dự kiến:

1. Root budget có phân quyền theo cây và reservation dùng chung, bảo toàn ngân sách khi các agent chạy đồng thời.
2. Liên kết reservation với một công việc escrow và đúng một khoản quyết toán; không tính trùng tiền giữa vault, escrow và database.
3. Bộ runtime xử lý bất định sau broadcast, idempotency và tái dựng trạng thái từ bằng chứng có thẩm quyền.
4. SDK, ví dụ độc lập và bộ kiểm thử sự cố để dự án khác tái sử dụng.

### 1.1 Đối chiếu yêu cầu chương trình

Nguồn chuẩn: [Arc Open Source Showcase / Mainnet Bounty](https://arc-oss.thecanteenapp.com/#mainnet-bounty), đọc ngày 2026-10-09.

| Yêu cầu | Deliverable dự kiến | Bằng chứng |
|---|---|---|
| Mã nguồn mở và tài liệu rõ | License, README, hướng dẫn tích hợp và giới hạn | Clone/build/example độc lập |
| Primitive có thể tái sử dụng; bổ sung cho repo Circle | Vault, adapter, SDK và failure test kit | So sánh giao diện; tích hợp bên ngoài |
| Triển khai Arc mainnet | Bộ hợp đồng pilot | Địa chỉ, receipt, code hash và explorer |
| Chia sẻ trải nghiệm và nộp Showcase | Bài X và hồ sơ CLI | Chỉ công bố sau khi được phép |
| Hoạt động OSS, người dùng thật, tăng trưởng | Release và các nhóm pilot | Job/receipt đã đối soát; sử dụng lặp lại |

Repo riêng cho phần primitive là một lựa chọn đóng gói; không bắt buộc tách repository ngay. Không suy diễn cơ cấu giải thưởng thành tiêu chí sản phẩm.

### 1.2 Ranh giới các bản phát hành

| Bản | Phạm vi |
|---|---|
| Local alpha | Tiền giả trên Anvil; đầy đủ accounting, escrow, concurrency và recovery |
| Arc testnet alpha | Cùng luồng với token/mạng được xác minh; hai dịch vụ thử nghiệm |
| Arc mainnet pilot | USDC trên Arc, grant hai cấp, escrow một công việc/một giá, người dùng được tuyển chọn và trần tiền được chốt |
| Cross-chain beta | Thêm đúng một tuyến nạp USDC vào Arc đã kiểm chứng; chưa mặc định có payout đa chuỗi |

Mainnet pilot phục vụ người mua/nhà cung cấp ở nhiều nơi cùng dùng Arc. Chỉ mô tả cross-chain đã hoạt động sau khi beta có bằng chứng thực tế.

Ngoài phạm vi v1: token riêng, yield, lending, unsecured credit, netting nhiều bên, FX, tài khoản ngân hàng, marketplace mở, reputation toàn cầu, arbitration phi tập trung, tự chấm chất lượng bằng LLM, thanh toán partial trong một job, upgradeable proxy và mọi rail tùy ý.

## 2. Giả định và các quyết định cần xác minh

### 2.1 Quyết định thiết kế mặc định

- Một tài sản USDC được allowlist trên Arc cho mỗi deployment.
- Ngân sách có tiền nạp trước; không cấp tín dụng.
- Không giao khóa chủ tiền cho backend hoặc LLM. Agent chỉ có quyền hạn chế; relayer chỉ gửi hành động đã được ký và ràng buộc đầy đủ.
- Tối đa hai cấp agent: owner -> agent điều phối -> agent con. Việc kế thừa quyền được kiểm tra trên chuỗi, không phụ thuộc prompt.
- Một reservation gắn với một báo giá có chữ ký của nhà cung cấp và một job có giá cố định. V1 không đổi giá hoặc người nhận sau reservation.
- Settlement dùng một implementation escrow theo ERC-8183 đã pin và review, qua adapter do dự án viết. Không mặc nhiên tin reference implementation là an toàn cho production.
- Mỗi root budget có vault và adapter gắn cố định với nhau; v1 ưu tiên deployment đơn giản không proxy. Factory chỉ thêm khi pilot thực sự cần onboarding nhiều budget.
- Backend dùng Postgres và worker riêng; không thêm Redis, message broker hay microservice khi chưa cần.
- Nhà cung cấp có API idempotent cho việc nhận job; evaluator được chọn trước, độc lập với quyền vận hành worker. Pilot có thể dùng bên mua nghiệm thu nếu bên bán đồng ý mô hình đó.
- Điều khoản phải nói rõ evaluator có thể sai hoặc ngừng hoạt động. Escrow chỉ thực thi kết quả theo quyền đã thống nhất, không tự chứng minh chất lượng thực tế.

### 2.2 Discovery có giới hạn ở M0

| Cần xác minh | Cách kiểm tra | Kết quả cần ghi |
|---|---|---|
| Arc RPC, chain ID, explorer, USDC và decimals | Docs chính thức + read-only RPC | Network manifest có nguồn/ngày; không chứa secret |
| Escrow/ERC-8183 phù hợp | Đọc source, license, ABI, token/client/refund semantics và thử local | Commit/compiler pin, compatibility matrix và threat model |
| Circle Agent Wallets, Gateway, CCTP hỗ trợ Arc mainnet đến đâu | Docs từng sản phẩm, contract registry, read-only evidence | Supported / unsupported / chưa xác minh cho từng tính năng |
| AP2/x402 có cần cho pilot | So sánh interface của hai provider đầu tiên | Chọn adapter nhỏ cần thiết; không hứa tuân thủ toàn bộ |
| Toolchain Windows | Kiểm tra runtime có sẵn và cách chạy Foundry | Native hoặc WSL với hướng dẫn riêng; không tự giả định đã cài |
| Nhu cầu | Chuẩn bị câu hỏi và tìm nhóm phù hợp; chỉ liên hệ khi được phép | Hai vấn đề cụ thể, provider pilot và tiêu chí quyết định tiếp tục |

Nếu escrow không cho adapter đóng vai client, không có đường refund có thể đối soát hoặc phụ thuộc quyền quá rộng, dừng riêng nhánh tích hợp đó và ghi phương án thay thế trong ADR. Có thể tiếp tục mô hình domain/local harness; không âm thầm thay mô hình giữ tiền hoặc quảng bá ERC-8183 compatibility.

Không cần API key hoặc hỗ trợ Gateway mainnet để hoàn thành local core. Không tự cài dịch vụ trả phí để vượt qua thiếu capability.

## 3. Mô hình tiền có thẩm quyền

### 3.1 Các số dư của một root budget

Mọi lượng tiền dưới đây là số nguyên đơn vị ERC-20 USDC. Các ký hiệu là mô hình kế toán, không bắt buộc trùng tên storage.

| Biến | Nghĩa |
|---|---|
| D | Tổng tiền nạp đã được ghi nhận đúng vào budget |
| A | Tiền khả dụng, chưa có nghĩa vụ ràng buộc |
| R | Tiền đã giữ cho reservation nhưng chưa đưa vào escrow |
| E | Khoản đã dispatch vào escrow, chưa hoàn tất đối soát về budget |
| S | Tổng chi đã quyết toán, gồm phí settlement nếu có |
| W | Tổng tiền owner đã rút hợp lệ |

**Bất biến: D = A + R + E + S + W.** Tất cả không âm.

E là giá trị còn phải đối soát, không phải cam kết rằng tiền vẫn đang nằm trong escrow: job có thể đã Completed hoặc Refunded nhưng chưa reconcile. Cách ghi nhận bảo thủ này ngăn tái sử dụng tiền chưa xác minh.

| Hành động | Chuyển accounting |
|---|---|
| Nạp đúng qua deposit | D += x; A += x |
| Giữ tiền theo báo giá | A -= x; R += x |
| Hủy/TTL hết trước dispatch | R -= x; A += x |
| Fund escrow thành công, cùng transaction | R -= x; E += x |
| Xác minh job Completed | E -= x; S += x |
| Xác minh job Refunded và thu hồi được tiền | E -= x; A += x |
| Rút phần chưa cam kết | A -= x; W += x |

Refund của job funded không làm D tăng lần nữa. V1 chưa hỗ trợ giảm S bằng refund sau Completed; nếu bổ sung sau phải có mô hình gross/net spend riêng, không vá bằng cách sửa số dư tùy ý.

Tách vốn dịch vụ và phí vận hành: v1 relayer dùng gas budget riêng, công khai chi phí này; không âm thầm rút native USDC từ vault. Trước mainnet phải kiểm tra hệ quả cùng một nguồn USDC có hai giao diện native/ERC-20. Owner cũng phải có gas ngoài phần đã cam kết để gọi recovery khi relayer tắt.

### 3.2 Accounting theo grant

- Với mỗi grant trên đường từ root đến agent: `reserved + inEscrow + grossSpent <= cap`.
- Reserve cập nhật toàn bộ ancestor path trong cùng transaction, với độ sâu giới hạn. Kiểm tra cap của riêng agent con không đủ.
- Child cap có thể cùng chia sẻ cap cha; tổng danh nghĩa cap các con không tạo thêm tiền. Giao diện phải giải thích đây là hạn mức dùng chung, không phải phần tiền được cấp độc lập.
- Không nới quyền khi ủy quyền: provider/evaluator allowlist phải là tập con, thời hạn không dài hơn cha, amount cap không lớn hơn cha.
- Chi đã Completed tiêu thụ lifetime cap của grant. Refund trước Completed giảm nghĩa vụ và trả lại khả năng chi; revoke không reset lịch sử chi.
- Grant v1 bất biến sau tạo, chỉ revoke; cấp mới có ID mới và vẫn chịu cap của ancestor. Không được vượt cap bằng xoay agent con.
- Rút A phải tôn trọng quyền owner và bảo toàn các obligation R/E.

### 3.3 Tiền ngoài sổ và giới hạn bảo đảm

- Direct token donation không được coi là deposit/refund cho budget. Theo dõi surplus tách biệt; không có admin sweep tùy ý đối với tiền đã hạch toán.
- Mỗi external escrow job chỉ được gắn vào một commitment và credited một lần. Địa chỉ escrow, token, budget amount, client adapter, provider và evaluator phải khớp.
- Khi refund tới adapter qua một giao dịch permissionless bên ngoài, reconcile cần kiểm tra terminal state của đúng job, đánh dấu đã thu hồi và chuyển đúng số tiền về đúng vault. Không dùng thay đổi token balance tổng làm bằng chứng duy nhất.
- Failed transfer, token pause/freeze hoặc trạng thái không chắc chắn giữ E và hiển thị lỗi; không tự ghi refund thành công. Recovery không bảo đảm vượt qua hạn chế của token/network.
- Hệ thống kiểm soát các đường chuyển tiền trong vault/adapter. Khoản chi từ ví hoặc credential khác nằm ngoài bảo đảm.

## 4. Trạng thái, chữ ký và hành vi khi lỗi

### 4.1 Hai state machine riêng

Trạng thái kinh tế đề xuất:

```text
RESERVED -> CANCELLED                    (chưa dispatch)
RESERVED -> RESERVATION_EXPIRED          (chưa dispatch)
RESERVED -> FUNDED -> SUBMITTED -> SETTLED
                   \-> REFUND_PENDING -> REFUNDED
                         ^          (sau xác minh + thu hồi tiền)
                         |
                 reject / escrow expiry theo đúng contract
```

SUBMITTED cũng có thể dẫn đến REFUND_PENDING nếu escrow cho phép reject/expiry. External job đã terminal nhưng chưa reconcile vẫn nằm trong E. Với completion, observer có thể hiện SETTLEMENT_PENDING trước khi kế toán chuyển sang SETTLED; trạng thái UI này không tạo accounting mới.

Trạng thái giao dịch vận chuyển độc lập: `PREPARED -> BROADCAST -> CONFIRMED`, hoặc `UNKNOWN / REVERTED / REPLACED`. UNKNOWN không giải phóng R/E và không tạo ID kinh tế mới.

Không có đường cancel một funded job chỉ vì owner revoke agent hoặc backend timeout. Điều kiện hoàn tiền do escrow đã chọn quyết định; không thêm quyền override rút tiền.

### 4.2 Định danh và signed terms đề xuất

- `budgetId`: root budget; gắn với vault triển khai.
- `grantId`, `parentGrantId`: chuỗi quyền; không dùng tên agent như căn cứ xác thực.
- `operationId`: định danh tác vụ do caller tạo một lần và lưu bền trước retry.
- `commitmentId`: gắn budget, operation, provider quote và phiên bản payload; không phụ thuộc tx hash.
- `externalJobId`: ánh xạ duy nhất từ escrow đã pin, sau dispatch.
- Idempotency scope tối thiểu `(tenant/budget, operationId, action)`; cùng key/payload trả cùng kết quả, khác payload trả conflict.
- Signed quote ràng buộc provider, evaluator, asset, exact total amount, work-spec commitment, thời hạn báo giá, thời hạn escrow, chain ID, vault/adapter và nonce.
- Agent authorization ràng buộc grant, quote hash, operation và phạm vi action. Chống replay xuyên chain/contract/tenant; hỗ trợ signer hợp đồng nếu đã có ca kiểm thử tương ứng.
- Terms ghi số tiền nhà cung cấp nhận và phí. V1 ưu tiên không có protocol fee của dự án; phí escrow nếu có phải cố định và nằm trong giá đã ký.
- Metadata/hash không đồng nghĩa bí mật. Dùng nonce ngẫu nhiên cho commitment tài liệu ít entropy; dữ liệu gốc lưu ngoài chuỗi có quyền truy cập.

### 4.3 Deadline và nghĩa vụ

- Tách quote expiry, reservation expiry và escrow/job expiry; không dùng một timeout chung.
- Dispatch phải còn đủ thời gian làm việc/nghiệm thu theo terms đã ký. Không fund một job sắp hết hạn chỉ vì chữ ký quote còn hợp lệ.
- Provider bắt đầu tác vụ sau khi xác nhận funded state và điều khoản; reservation chưa funded chưa phải lời hứa thanh toán không thể hủy.
- Sau dispatch nhưng trước fund, reservation vẫn có thể hết hạn/hủy và job `Open` không tạo quyền nhận tiền. Sau fund, expiry được xử lý theo escrow. Revoke ngăn nghĩa vụ mới từ RESERVED nhưng không làm mất quyền provider của job đã funded.
- Pause ngăn reserve/fund mới; reconcile, refund và settlement hiện hữu phải vẫn có đường thực thi hợp lệ.
- Không cung cấp chữ ký thanh toán có thể thực thi bên ngoài rồi đồng thời giải phóng reservation khi chữ ký ấy vẫn còn giá trị.

### 4.4 Những tình huống phải có hành vi xác định

| Sự cố | Hành vi mong đợi |
|---|---|
| 3 agent cùng reserve 40 từ A=100 | Tối đa 2 reserve thành công; A=20, R=80 |
| Commit DB xong, worker chết trước gửi | Worker tiếp tục cùng operation; không tạo reservation thứ hai |
| Broadcast thành công, response bị mất | Giữ UNKNOWN; đối soát nonce/hash/state; không tạo payment mới |
| Job Completed khi indexer tắt | Rebuild/reconcile cập nhật S đúng một lần |
| Refund được gọi trực tiếp ngoài backend | Adapter nhận tiền; permissionless reconcile ghi A đúng budget đúng một lần |
| Revoke cùng lúc fund | Thứ tự thực thi trên chuỗi quyết định; nếu fund trước thì nghĩa vụ được giữ |
| Provider callback giả hoặc trùng | Không giải phóng tiền theo callback; chữ ký/ID kiểm tra, duplicate không có tác dụng kinh tế |
| Một bước workflow thất bại | Phần đã nghiệm thu vẫn được trả; phần chưa cam kết có thể phân bổ lại |
| Provider outage sau funded | Theo deadline/reject của escrow; không suy đoán failure từ HTTP timeout |
| Token transfer không thực hiện được | Giữ nghĩa vụ, báo nguyên nhân; retry an toàn khi điều kiện cho phép |

## 5. Kiến trúc và cấu trúc repo dự kiến

Toolchain đề xuất: TypeScript strict, pnpm workspace, viem, Solidity/Foundry, Postgres, API Node/Fastify, dashboard Next.js, Vitest và Playwright. Pin phiên bản cụ thể sau kiểm tra M0; đây không phải tuyên bố về phiên bản mới nhất. SDK không phụ thuộc Fastify/Next.js/Postgres.

```text
AGENTS.md
README.md
LICENSE
SECURITY.md
CONTRIBUTING.md
package.json / pnpm-workspace.yaml / pnpm-lock.yaml
contracts/
  src/BudgetVault.sol
  src/GrantPolicy.sol
  src/ERC8183Adapter.sol
  src/interfaces/
  test/{unit,invariant,integration}/
  script/                         # deploy/verify; không auto-broadcast
packages/
  domain/src/                    # tiền, schemas, transitions, reference model
  sdk/src/                       # typed calls, signer abstraction, recovery reads
  network-config/                # verified manifest, không chứa credentials
apps/
  api/src/                       # auth, orchestration, provider jobs
  worker/src/                    # outbox, indexer, reconciliation
  console/                       # budget, commitment, recovery và audit views
examples/
  document-workflow/             # ứng dụng tham chiếu, không phải core
  provider-service/              # signed quote + idempotent job nhận việc
  sdk-only/                      # ví dụ không dùng hosted API/UI
db/migrations/
tests/{integration,e2e,failure}/
deployments/                     # metadata công khai, không có khóa
docs/
  implementation-plan.md
  capability-matrix.md
  architecture.md
  threat-model.md
  integration.md
  runbooks/
  adr/
```

`GrantPolicy` có thể là library bên trong contracts thay vì contract độc lập nếu không cần địa chỉ/quyền riêng. Không tạo toàn bộ folder trống trước khi có nội dung. Không nhân bản copy escrow upstream: dùng dependency pin/patch có nguồn và license rõ.

### 5.1 Trách nhiệm module

| Module | Sở hữu | Không được làm |
|---|---|---|
| BudgetVault + GrantPolicy | D/A/R/E/S/W, quyền, reservation, withdraw | Gọi hợp đồng tùy ý theo input agent |
| ERC8183Adapter | Mapping job, atomic fund, đọc terminal state, thu hồi tiền | Sửa giá/người nhận đã ký hoặc tin callback HTTP |
| domain | Mô hình tham chiếu, schemas, tính tiền và projection | Trở thành sổ có quyền vượt contract |
| SDK | API ngữ nghĩa, tx preparation, typed status | Giữ secret hoặc che giấu UNKNOWN thành success |
| API/worker | Auth, queue, retry, job delivery và chain indexing | Ký bằng owner key, tự quyết định service quality |
| Console | Hiển thị trạng thái, trình ký, giải thích recovery | Đưa cấu hình nội bộ không cần thiết vào luồng người dùng |
| Provider/evaluator | Làm việc và nghiệm thu theo terms | Đổi điều khoản sau funded hoặc tự nhận quyền ngoài hợp đồng |

### 5.2 Interface đề xuất

SDK cấp cao: `createBudget`, `grant`, `revoke`, `reserve`, `dispatch`, `setProviderBudget`, `fund`, `inspect`, `reconcile`, `cancelReservation`, `withdrawAvailable`.

- `reserve` nhận signed quote + agent authorization và trả commitment ID cùng trạng thái xác nhận.
- `dispatch` tạo đúng một escrow job `Open` qua adapter nhưng chưa chuyển tiền. Provider gọi `setBudget` trực tiếp trên reference escrow; `fund` chỉ chuyển R -> E khi job binding và amount khớp quote, dùng allowance giới hạn rồi xóa allowance. Mỗi transaction tự rollback toàn bộ thay đổi nếu lỗi.
- `inspect` trả economic state, tx state, thời điểm quan sát, accounting và recovery action hợp lệ; không gộp thành một boolean paid.
- `reconcile` có thể được bất kỳ người nào kích hoạt nhưng không cho caller chọn số tiền/kết quả; contract đọc trạng thái escrow có thẩm quyền.
- `withdrawAvailable` chỉ owner, chỉ A và recipient được owner ký.
- SDK hỗ trợ prepare-only và external signer. HTTP API không mặc nhiên có quyền tiêu tiền của caller.

HTTP v1 đề xuất: tạo/đọc budget metadata, lấy quotes, tạo/đọc commitments, yêu cầu dispatch/set-budget/fund/reconcile, xem transaction attempts. Write request cần xác thực principal/grant và Idempotency-Key; đọc dữ liệu riêng cần tenant auth. Endpoint không thay thế kiểm tra chữ ký trên chuỗi.

### 5.3 Lưu trữ, indexer và queue

Các bảng dự kiến: `tenants`, `budgets`, `grants`, `quotes`, `commitments`, `escrow_jobs`, `transaction_attempts`, `chain_events`, `outbox`, `idempotency_records`, `provider_jobs`, `indexer_checkpoints`.

- Unique constraints cho scope idempotency, commitment-to-job và `(chainId, txHash, logIndex)`.
- Transaction DB ghi intent + outbox cùng nhau. Worker claim job bằng locking; concurrency không dựa vào một tiến trình singleton duy nhất.
- Lưu sender/nonce/signed payload hoặc signer request reference thích hợp trước broadcast; không ghi secret hay raw document vào outbox.
- Replay events theo block/transaction/log order; lưu block hash/checkpoint. Có cách xử lý RPC không nhất quán và rollback projection khi cần, không giả định mọi response đều finalized.
- Chuỗi hợp đồng là nguồn có thẩm quyền; rebuild projection phải ra cùng balances/job state. Dữ liệu provider riêng tư không thể phục hồi từ chain, cần backup tách biệt.
- Reconciliation polling có backoff và giới hạn; không resend dựa trên thời gian chờ đơn thuần.

## 6. Các milestone triển khai

Dependency chính: **M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6 -> M8 -> M9 -> M10**.

M7 là nhánh cross-chain sau M5; chỉ được đưa vào beta khi vượt M8 với phạm vi riêng. Khảo sát nhu cầu và chuẩn bị tài liệu có thể tiến hành song song về mặt lịch làm việc, không mặc nhiên cho phép tự tạo agent hoặc liên hệ người khác.

### M0 — Chốt capability, mô hình tin cậy và nhu cầu

**Phụ thuộc:** được giao bắt đầu triển khai; đọc các nguồn trong mục 10.

**Công việc:**

1. Xác minh các mục discovery 2.2; pin tài liệu/implementation escrow và ghi giới hạn mạng.
2. Tạo `docs/capability-matrix.md`, `docs/threat-model.md`, ADR về custody, accounting, grant, evaluator và adapter.
3. Đối chiếu các dự án liên quan; nêu rõ phần tái sử dụng và phần khác biệt kiểm chứng được.
4. Soạn kịch bản phỏng vấn/pilot; hỏi về lỗi chi trùng, ngân sách dùng chung, lượng job, phí và willingness to integrate. Chưa gửi nếu chưa được phép.
5. Chọn một loại đầu ra kiểm chứng được, ví dụ tài liệu đúng schema/số trang; tách chất lượng nội dung do người mua đánh giá.

**Nghiệm thu:** có lựa chọn escrow khả thi, nguồn cho từng config, danh sách unsupported rõ; mọi câu hỏi ảnh hưởng dòng tiền đã được quyết định hoặc được ghi là blocker của nhánh tương ứng. Nếu chưa có khách hàng, local alpha được tiếp tục nhưng không coi nhu cầu đã xác thực.

### M1 — Scaffold tối thiểu và quy ước chất lượng

**Phụ thuộc:** M0 đã xác định toolchain và scope local.

**Tệp:** root package/workspace configs, `contracts/foundry.toml`, package cần dùng đầu tiên, `.gitignore`, `.env.example`, CI draft, README.

1. Kiểm tra runtime hiện có, chọn bản tương thích và pin lockfile/compiler/dependency; không tự cài global khi có cách repo-local.
2. Tạo workspace và local Postgres/Anvil setup; hướng dẫn Windows/WSL không trộn đường dẫn hay shell ngầm.
3. Định nghĩa script kiểm tra ở mục 7; tách offline suite khỏi network/live suite.
4. Chọn license dự kiến Apache-2.0 cho code tự viết sau khi kiểm tra tương thích; giữ attribution của upstream. Không public repo ở bước này.
5. Thiết lập cấu hình không chứa secret, logger redaction và CI chỉ dùng chain local.

**Nghiệm thu:** clean dependency install có lockfile; typecheck/build harness chạy; local services start/stop được; không có test giả để làm CI xanh. Test suite trống chưa được ghi là đã kiểm chứng hành vi sản phẩm.

### M2 — Domain model và oracle kiểm thử

**Phụ thuộc:** M1.

**Tệp:** `packages/domain/src/{money,accounting,grants,commitments,quotes}.ts`, unit/property tests, fixtures giả lập.

1. Viết failing cases cho các chuyển accounting ở 3.1, cap ancestor, conflict idempotency và stale quote.
2. Xây reference model xác định; sinh chuỗi hành động để kiểm tra conservation và terminal exactly-once accounting.
3. Định nghĩa payload serialization, version, domain separator và API amount strings; tạo golden vectors cho TS/Solidity.
4. Tách economic state khỏi transport state; định nghĩa typed error và recovery actions.

**Nghiệm thu:** property tests bao phủ deposit/reserve/cancel/fund/settle/refund/withdraw/revoke; thao tác sai không đổi tiền. Vector hash/signature khớp giữa các implementation sau M3; chưa có Solidity thì ghi trạng thái so khớp là pending.

### M3 — Vault, grant và reservation có cưỡng chế trên chuỗi

**Phụ thuộc:** M2; threat model M0.

**Tệp:** `BudgetVault.sol`, `GrantPolicy.sol`, interfaces, Foundry unit/invariant tests, signing vectors.

1. Viết test trước cho ba reservation 40/40/40 với ngân sách 100, giới hạn cha/con và cross-budget replay.
2. Triển khai deposit, grant/revoke, reserve, cancel/expire, withdrawAvailable và pause có phạm vi rõ.
3. Quote/authorization phải được xác minh đầy đủ; cùng operation và terms không tạo reservation thứ hai, khác terms phải revert.
4. Chặn arbitrary adapter/target, reentrancy, cap bypass bằng grant mới, sai chain/token/decimals.
5. Kiểm tra token transfer thất bại/return bất thường và donation; v1 chỉ hỗ trợ token đã định danh, không quảng bá hỗ trợ mọi ERC-20.

**Nghiệm thu:** mọi transition trong phạm vi có ca valid/invalid; conservation không vỡ qua invariant runs; gas tăng theo độ sâu giới hạn chứ không theo tổng số agent/job. Pause/revoke không cho rút R/E.

### M4 — Adapter và vòng đời escrow

**Phụ thuộc:** M3; escrow implementation qua gate M0.

**Tệp:** `ERC8183Adapter.sol`, escrow dependency pin/patch, integration tests, `docs/adr/` cập nhật.

1. Viết failing tests cho dispatch trùng, caller `setBudget` sai, giá lệch quote, fund revert, stale grant, escrow giả và job ID đã dùng.
2. Dispatch tạo và bind job `Open`; provider đặt giá. Fund kiểm tra lại toàn bộ binding, cấp allowance giới hạn, gọi escrow và chuyển R -> E trong cùng transaction; failure rollback.
3. Adapter là client của escrow và refund recipient; lưu mapping bất biến commitment -> escrow job.
4. Implement permissionless reconciliation từ terminal state; Completed -> S; refund -> A chỉ sau khi tiền về đúng vault.
5. Kiểm tra complete/refund gọi ngoài runtime, race tại expiry, evaluator không hoạt động, token frozen và allowance cleanup.
6. Ghi rõ trust assumptions, quyền evaluator, deadline race và upstream modifications. Không mở rộng chuẩn bằng tên tương thích nếu đã thay semantics.

**Nghiệm thu:** một khoản tiền không đồng thời nằm trong R và E; không credit refund bằng callback giả/donation; reconcile nhiều lần không đổi kết quả. Local real escrow implementation chạy, không chỉ mock. Full suite M2-M4 qua; chưa gọi là audited.

### M5 — SDK, runtime và đối soát có thể khôi phục

**Phụ thuộc:** M4; ABI đã ổn định cho local alpha.

**Tệp:** `packages/sdk`, `apps/api`, `apps/worker`, migrations, `tests/integration`, `tests/failure`, `examples/sdk-only`.

1. SDK expose các method ở 5.2; external signer, typed status và network validation. Public API không buộc caller biết DB schema hoặc tự ghép nhiều bước nguy hiểm.
2. HTTP auth bằng signed challenge có nonce/expiry/chain binding hoặc cơ chế tương đương đã chốt; phân quyền tenant cho mọi read/write.
3. Tạo migrations/constraints, transaction outbox, worker lease, serialized nonce handling theo signer và reconciliation scheduler.
4. Viết lỗi trước implementation: kill trước/sau broadcast, mất receipt, duplicate events, hai worker cùng job, payload conflict và khôi phục checkpoint.
5. Phục hồi dữ liệu từ chain; query trạng thái trực tiếp khi DB stale; không phát sinh thanh toán mới để “sửa” chênh lệch.
6. Mỗi provider job có cùng operation ID và idempotent accept/status; retry invocation không tạo tác vụ tính phí thứ hai.

**Nghiệm thu:** chạy hai worker và client đồng thời vẫn không trả trùng; restart/rebuild ra trạng thái bằng chain; `examples/sdk-only` hoạt động không cần API/UI. UNKNOWN xuất hiện đúng khi chưa có bằng chứng; lỗi không bị đổi thành success.

### M6 — Ứng dụng tham chiếu và tích hợp provider

**Phụ thuộc:** M5.

**Tệp:** `apps/console`, `examples/document-workflow`, `examples/provider-service`, docs integration, e2e tests.

1. Luồng owner: nạp budget, cấp quyền, xem số dư A/R/E/S/W, thu hồi grant, rút A và xem recovery.
2. Luồng agent: nhận quote -> reserve -> dispatch -> provider setBudget -> fund -> theo dõi -> reconcile; planner thay được bằng logic xác định để test không cần LLM.
3. Luồng provider: ký quote, xác nhận funded, nhận task idempotent, gửi deliverable reference; evaluator xác nhận theo terms.
4. Pilot workflow gồm hai dịch vụ độc lập, ví dụ trích xuất dữ liệu và tạo tài liệu; bước thứ ba có thể được thêm để chứng minh thất bại từng phần.
5. UI phân biệt cần ký/đã gửi/chưa xác định/đã xác nhận/đã nghiệm thu/đã hoàn; số ví không được gọi là số người dùng.
6. Demo nhỏ có success, provider reject, timeout và agent crash. Mock fixture chỉ trong local/test mode có nhãn rõ.

**Nghiệm thu:** người dùng hoàn thành một job từ đầu đến cuối; owner revoke không phá nghĩa vụ đã funded; hoàn tiền có transaction evidence. E2E kiểm tra mobile và keyboard cho các hành động chính. Hai provider mô phỏng chưa được ghi là hai đối tác thực.

### M7 — Một tuyến nạp USDC xuyên chuỗi, tùy capability

**Phụ thuộc:** M5; nguồn/destination và CCTP deployment đã xác minh ở M0; được phép nếu broadcast.

**Tệp:** adapter CCTP bên runtime/SDK, `docs/runbooks/bridge-recovery.md`, capability manifest, integration tests riêng.

1. Chọn đúng một source chain được hỗ trợ, dự kiến Base -> Arc nếu nguồn chính thức xác nhận; không hardcode lựa chọn chưa kiểm tra.
2. Luồng v1 đơn giản: bridge vào ví người dùng, sau đó gọi deposit vào budget. Hai bước được hiển thị rõ; không tuyên bố atomic bridge+deposit.
3. Tách trạng thái burn/attestation/mint/deposit. Chỉ deposit thành công mới tăng D/A. Bridge pending chỉ là inbound dự kiến.
4. Lưu message/nonce/recipient/burn hash; resume từ bước đã có bằng chứng. Không burn lần nữa khi mint chưa rõ kết quả.
5. Tính và hiển thị phí/số tiền thực nhận; không giả định số burn bằng số deposit nếu tuyến có phí.

**Nghiệm thu:** cùng transfer resume được sau restart và không mint/deposit trùng; người nhận/chain sai bị chặn. Unsupported mainnet route giữ feature disabled và ghi rõ lý do. Mainnet core không bị chặn bởi tính năng tùy chọn này.

### M8 — Hardening, testnet và review trước mainnet

**Phụ thuộc:** M6; M7 chỉ nếu nằm trong release candidate.

**Tệp:** security report, test evidence, deployment scripts/manifests, runbooks deploy/pause/recover/migrate, release notes draft.

1. Chạy toàn bộ offline suites, invariant/fuzz và differential checks với domain model; lưu seed/repro cho lỗi.
2. Review access control, signatures, collateral accounting, adapter approvals, evaluator trust, SSRF ở provider URL/webhook, secrets và tenant isolation.
3. Deploy testnet chỉ khi được phép; xác minh chain/token/source và receipts. Chạy trên implementation/token thực các ca không thể kết luận từ mock.
4. Diễn tập relayer/indexer outage, RPC failure, backup restore, direct contract recovery và owner mất quyền agent.
5. Review độc lập phần tiền/quyền bởi người hoặc đơn vị có năng lực. Đây là release gate nội bộ, không phải yêu cầu ban tổ chức. Không tự liên hệ hoặc thuê dịch vụ trả phí.
6. Chốt deposit cap, max commitment, maximum concurrent jobs, signer policy và ngưỡng pause dựa trên evidence. Khi chưa chốt, mainnet deployment không được enable.

**Nghiệm thu:** không còn lỗi critical/high về mất tiền, tăng quyền hoặc trả trùng; finding khác có xử lý được chấp nhận. Recovery runbook có bằng chứng đã diễn tập. Chưa review độc lập thì mainnet-money readiness còn pending, dù testnet đã pass.

### M9 — Chuẩn bị và triển khai mainnet pilot

**Phụ thuộc:** M8; nguồn official mainnet đã kiểm tra lại; có phạm vi authorization cụ thể.

1. Chuẩn bị gói review: diff/release commit nếu repo đã dùng Git, build/compiler hash, chain/token, constructor args, roles, signer, trần tiền/phí, simulation và chi phí ước tính.
2. Chuẩn bị site, README và source verification để xem trước. Chỉ xin phép hành động còn thiếu quyền sau khi gói này đã kiểm tra được.
3. Sau khi được phép: deploy trong đúng phạm vi, xác minh bytecode/source/roles và lưu manifest không chứa credentials.
4. Thực hiện smoke flow với giá trị đã được phép; kiểm tra reserve/fund/settle và refund bằng authoritative receipts. Không vượt ngân sách để hoàn tất kiểm thử.
5. Công bố site/repo/package chỉ khi được phép tương ứng. Chỉ bật capability đã kiểm chứng; tách production config khỏi testnet.

**Nghiệm thu:** mỗi deployment có địa chỉ, chain, tx/block, code hash, compiler và source reference; onchain accounting đúng; recovery hoạt động; không có default demo keys, hidden mocks hoặc network fallback sai.

Rollback của hợp đồng không upgradeable: pause nghĩa vụ mới, cho phép xử lý nghĩa vụ cũ, owner rút A; deployment mới chỉ dùng cho budget mới sau khi được phép. Không tự di chuyển R/E hoặc xóa sổ nghĩa vụ cũ. DB migration dùng backup và bước tương thích, không reset dữ liệu tài chính để “làm sạch”.

### M10 — Pilot thật, đóng gói OSS và nộp Showcase

**Phụ thuộc:** M9; được phép liên hệ/công bố/gửi hồ sơ.

1. Mục tiêu kiểm chứng nội bộ: ít nhất hai nhóm dùng thử độc lập, một nhóm tích hợp SDK từ ví dụ và một nhóm quay lại chạy workload khác. Đây không phải ngưỡng do ban tổ chức quy định.
2. Ghi nhận số tổ chức/người vận hành có căn cứ, jobs đã settle, gross/net spend theo định nghĩa, refunds, tỷ lệ retry/recovery và tích hợp bên ngoài.
3. Loại local/testnet, đội dự án, giao dịch tự tạo và traffic thử nghiệm khỏi traction người dùng độc lập. Nhiều agent/ví do một người điều khiển không phải nhiều khách hàng.
4. Hoàn thiện README, API docs, threat model, supported networks, LICENSE/attribution, integration quickstart, changelog và known limitations.
5. Soạn bài X mô tả trải nghiệm triển khai có kiểm chứng và hồ sơ Showcase nêu primitives, khác biệt, CA mainnet, site/repo và bằng chứng sử dụng.
6. Sau khi được phép công bố: chạy `arc-canteen submit-showcase`, rồi `arc-canteen update-traction` với số liệu đã đối soát. Không giả định CLI đã cài/đăng nhập; kiểm tra help và phiên bản hiện hành trước.

**Nghiệm thu:** tài liệu đủ để người ngoài tự chạy và tích hợp; nội dung đã công bố khớp trạng thái thật. Nếu chưa có người dùng độc lập, báo technical delivery hoàn tất ở phạm vi tương ứng nhưng product adoption vẫn chưa được xác thực.

## 7. Kế hoạch kiểm chứng và lệnh dự kiến

### 7.1 Ma trận các ca bắt buộc

| ID | Ca nghiệm thu | Milestone |
|---|---|---|
| AC-01 | Conservation D=A+R+E+S+W trên mọi chuỗi hành động hợp lệ | M2-M4 |
| AC-02 | Nhiều agent không vượt cap cha hay root money; grant mới không reset gross spend cha | M2-M3 |
| AC-03 | Replay sai chain/vault/grant/provider/amount/terms bị từ chối | M3-M4 |
| AC-04 | Duplicate operation trả một kết quả; khác payload cùng key bị conflict | M3-M5 |
| AC-05 | Fund escrow hoặc accounting cùng thành công, hoặc cùng rollback | M4 |
| AC-06 | Timeout sau broadcast không dẫn tới thanh toán mới hoặc release tiền | M5 |
| AC-07 | Direct completion/refund ngoài backend được reconcile đúng một lần | M4-M5 |
| AC-08 | Revoke/pause không tước nghĩa vụ funded hoặc chặn đường thu hồi hợp lệ | M3-M8 |
| AC-09 | Token failure/donation không tạo tiền giả; reentrancy không tăng quyền/tiền | M3-M4 |
| AC-10 | Hai worker + event trùng/đảo thứ tự + restart/rebuild khớp chain | M5 |
| AC-11 | SDK-only không phụ thuộc hosted API, UI hoặc LLM | M5-M6 |
| AC-12 | Workflow thất bại từng phần vẫn trả đúng phần đã nghiệm thu | M6 |
| AC-13 | Bridge pending không tăng budget; resume không burn/mint/deposit trùng | M7 |
| AC-14 | Tenant isolation, SSRF, document access và log redaction | M5-M8 |
| AC-15 | Recovery owner trực tiếp hoạt động khi API/relayer/indexer tắt | M8 |
| AC-16 | Pilot onchain evidence và traction phân loại trung thực | M9-M10 |

### 7.2 Command contract cần tạo ở M1

Chưa có script nào dưới đây trong workspace tại ngày lập kế hoạch. Đây là tên/giao diện lệnh mong muốn, không chạy nguyên xi trước khi implementation tạo và xác minh chúng. Wrapper dùng cách gọi Foundry native/WSL đã chọn ở M0.

| Lệnh dự kiến tại repo root | Kết quả mong đợi |
|---|---|
| `pnpm install --frozen-lockfile` | Cài dependency đúng lockfile sau bootstrap; không đổi version ngầm |
| `pnpm lint` | Lint phần mã có trong release |
| `pnpm typecheck` | TypeScript strict không có lỗi |
| `pnpm build` | Packages/API/worker/console build được |
| `pnpm test:unit` | Domain/SDK unit + property cases đã liệt kê thực sự chạy |
| `pnpm test:contracts` | Foundry unit/integration suite local |
| `pnpm test:invariants` | Foundry stateful fuzz + differential model, profile/seed được ghi nhận |
| `pnpm test:integration` | API/worker/SDK + local chain/Postgres, không cần tiền thật |
| `pnpm test:failure` | Fault injection ở các ranh giới persistence/broadcast/reconcile |
| `pnpm test:e2e` | Console + provider/workflow local, trạng thái tiền hiển thị đúng |
| `pnpm example:sdk` | Chạy ví dụ SDK độc lập trên local chain |
| `pnpm check:docs` | Link nội bộ, manifest/schema và ví dụ tài liệu không sai lệch |

Network suites phải là lệnh riêng, không được chạy ngầm trong `test`, build hoặc install. Kiểm tra live cần network manifest, signer mode và authorization rõ. Test collection rỗng không được coi là pass.

## 8. Rủi ro, rollout và điều kiện dừng

| Rủi ro | Cách giảm và điều kiện chặn |
|---|---|
| Sai accounting hoặc refund bị dùng hai lần | Invariant/differential tests, adapter kiểm tra job binding và review độc lập; chặn mainnet khi còn finding nghiêm trọng |
| Chuẩn escrow thay đổi hoặc semantics không phù hợp | Pin source/compiler, compatibility tests; ADR trước thay implementation |
| Agent giữ tiền vô hạn nhưng không dispatch | Reservation TTL, cap concurrency; chỉ release khi chắc chắn chưa có nghĩa vụ bên ngoài |
| Evaluator sai/biến mất | Terms công khai, deadline/expiry theo escrow; không quảng bá bảo đảm chất lượng tuyệt đối |
| Worker có quyền chuyển tiền tùy ý | Signed actions, allowlist bất biến theo budget, gas-only relayer; không owner key trong server |
| Cross-chain không atomic | MVP tách bridge và deposit; trạng thái rõ; chỉ dùng tiền đã nạp |
| Skill hoặc docs cũ về mạng | Capability matrix có nguồn/ngày, kiểm tra lại trước deployment |
| Thông tin nhạy cảm rò rỉ qua hash/log/provider URL | Commitment có nonce, access control, retention policy, redaction và SSRF protection |
| Phí cao so với giá job | Đo chi phí mỗi lifecycle; chọn workload đủ giá trị. Không ép escrow từng nanopayment; session/batching là hướng sau có đánh giá riêng |
| Bị sao chép thành dashboard thông thường | Tiêu chí SDK-only, primitive integration và failure kit là deliverable bắt buộc |
| Không có khách hàng | Kiểm chứng với nhóm pilot; thay use case tham chiếu nếu không có chi phí thực, giữ core chỉ khi có bằng chứng nhu cầu |

Không có cam kết ngày mainnet trước khi M0 xác minh capability và M8 đạt gate. Ưu tiên thứ tự: tính đúng của tiền/quyền -> khả năng phục hồi -> tích hợp độc lập -> trải nghiệm -> mở rộng mạng.

## 9. Định nghĩa hoàn tất theo phạm vi

- **Tài liệu kế hoạch hoàn tất:** AGENTS.md và kế hoạch tồn tại, link nội bộ hợp lệ, mô hình tiền/trạng thái/authority nhất quán. Không suy ra sản phẩm đã xây.
- **Local alpha hoàn tất:** M1-M6 đạt acceptance trong môi trường local; suite và SDK-only có bằng chứng.
- **Mainnet pilot sẵn sàng:** M0-M6 và M8 đạt gate; các giá trị cap và gói review M9 đã chốt. Readiness không phải permission to deploy.
- **Mainnet pilot đã triển khai:** M9 có bằng chứng onchain và phạm vi thực tế được công bố chính xác.
- **Cross-chain beta hoàn tất:** M7 và M8 cho route đó có evidence, được triển khai theo phạm vi đã cho phép.
- **Sản phẩm được xác thực bước đầu:** có tổ chức bên ngoài dùng cho workload thật, quay lại sử dụng và có ít nhất một tích hợp độc lập. Không lấy số tx tự tạo thay thế tiêu chí này.
- **Showcase submission hoàn tất:** hồ sơ được gửi sau khi cho phép và khớp các bằng chứng; không đồng nghĩa được nhận giải.

## 10. Nguồn tham chiếu và giới hạn nghiên cứu

Các URL dưới đây là điểm xuất phát; cần pin revision cho dependency và giao diện trước implementation. Không coi trang marketing hoặc README là kiểm toán bảo mật hay bằng chứng dịch vụ đã hỗ trợ mọi mạng.

1. [Showcase / Mainnet Bounty](https://arc-oss.thecanteenapp.com/#mainnet-bounty) — điều kiện chương trình.
2. [Arc docs index](https://docs.arc.io/llms.txt) — tìm tài liệu mạng chính thức.
3. [Circle docs index](https://developers.circle.com/llms.txt) — kiểm tra capability từng sản phẩm.
4. [Circle Agent Stack](https://www.circle.com/agent-stack) — baseline ví, hạn mức, discovery và payment rails; từng thành phần vẫn cần kiểm tra hỗ trợ mainnet riêng.
5. [AP2 specification](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md) — authorization/receipts; không gọi grant nội bộ là AP2-compliant khi chưa có adapter và conformance tests.
6. [ERC-8183 draft](https://eips.ethereum.org/EIPS/eip-8183) — tham chiếu job escrow/evaluator; phải pin implementation và kiểm tra trust model.
7. [Circle arc-escrow](https://github.com/circlefin/arc-escrow), [arc-commerce](https://github.com/circlefin/arc-commerce), [arc-p2p-payments](https://github.com/circlefin/arc-p2p-payments) — so sánh phần bổ sung và cách tích hợp; không deploy mẫu testnet nguyên trạng lên mainnet.
8. [Circle CCTP pay-first/settle-later](https://www.circle.com/blog/pay-first-settle-later-with-cctp) — tham khảo tách payment/settlement; mô hình ứng vốn của ví dụ không nằm trong v1.
9. [x402](https://github.com/coinbase/x402) — adapter payment cho dịch vụ nếu cần ở giai đoạn sau; không giả định receipt chứng minh service quality.
10. [ARC CLI](https://github.com/the-canteen-dev/ARC-cli) — đối chiếu cú pháp submission/traction hiện hành trước khi gửi.

### Checklist triển khai — cập nhật 2026-10-09

- [ ] M0: capability/trust baseline và Arc Testnet deployment đã ghi; xác thực nhu cầu và provider pilot vẫn chờ liên hệ bên ngoài.
- [x] M1: pnpm/TypeScript/Foundry scaffold, lockfile, CI local-only, Postgres compose và command contract.
- [x] M2: accounting/grant/idempotency/money model với 14 domain unit tests; signed quote nằm ở SDK.
- [x] M3: vault/grant/reservation, replay/expiry/pause/decimals và fuzz conservation local.
- [x] M4: adapter + local lifecycle tests và ABI pin cho Arc ERC-8183 reference; testnet vault/adapter đã bind, chưa phải audit/conformance production.
- [x] M5: SDK, auth API với PostgreSQL challenge/session/idempotency store, Postgres outbox, multi-worker broadcast/reconciliation lease với receipt backoff, restart recovery, projection checkpoint/reorg rollback bền vững và SDK-only đã kiểm thử local.
- [x] M6: console/provider/document workflow và browser-to-local-chain E2E local đã có; kiểm tra mobile 375px, keyboard activation, settlement và receipt evidence.
- [x] M6 mainnet read-only (2026-10-12): console đọc ledger/backing và 2 job pilot tại cùng block, kiểm tra code hash/binding và receipt canonical; lỗi/stale không fallback demo. Có [quickstart mainnet](quickstart-arc-mainnet.md). Đây là công cụ quan sát nội bộ, không phải hosted release hay traction bên ngoài.
- [x] Circle developer integration: Developer-Controlled Wallets executor cho raw calldata trên `ARC-TESTNET`, stable idempotency key, typed state mapping, resumable finality polling và prepare-only quickstart dùng Circle SDK `9.2.0`; chưa broadcast vì không có credential.
- [ ] M7: SDK đã có deterministic CCTP inbound state/evidence/recovery và chặn credit trước deposit; route manifest, Circle executor và integration test với CCTP thật vẫn chưa thực hiện.
- [ ] M8: hardening, failure/recovery, browser E2E, deployment rehearsal, read-only verification, lifecycle fork, live settlement, live reject/refund/reconcile/withdraw và live multi-role settlement trên Arc Testnet đều có. Review độc lập vẫn chưa thực hiện nên M8 chưa đạt release gate đầy đủ.
- [ ] M9: đã bind v2 và hoàn tất pilot mainnet nội bộ sau ngoại lệ rõ của chủ tiền: deposit/refund 0,01 USDC, settle 0,005 và withdraw 0,005; 19 receipts được verify. Vốn/production rộng hơn, source verification/public release và independent review chưa đạt đầy đủ milestone chung. Xem [pilot record](deployments/arc-mainnet-pilot-2026-10-12.md).
- [ ] M10: chưa có pilot bên ngoài, công bố hoặc Showcase submission.

Bằng chứng hiện có: `pnpm build`, `pnpm lint`, 14 domain tests, 23 SDK tests, API/provider/workflow tests, 23 Foundry tests, 512 fuzz cases qua hai invariant properties, 6 failure-injection tests, 9 Postgres integration tests, lifecycle Anvil thật từ EIP-712 reserve qua provider-priced job đến settlement, browser-to-local-chain E2E bằng keyboard ở viewport 375px, deployment rehearsal và ba receipt Arc Testnet cho deployment hiện tại. API integration test kiểm tra challenge atomic, session và idempotency qua restart; outbox integration kiểm tra receipt lease nhiều worker; projection integration test kiểm tra deduplication, rebuild và rollback range sau reorg; SDK inspect trả typed state/recovery action và CCTP inbound tests chặn skip/conflict/credit trước deposit. `pnpm verify:arc-testnet` đối chiếu deployment, 32 receipt của settlement/recovery/multi-role smoke, ba terminal job/reservation, vai trò độc lập và ledger bằng RPC read-only. `pnpm test:arc-testnet-fork` chạy lại lifecycle trên bytecode testnet đã deploy. Ba live smoke đã kiểm tra settlement, reject/refund/reconcile/withdraw và phân quyền bằng ba signer dự án với 0,1 USDC mỗi flow; hoạt động nội bộ này không phải traction độc lập. Kết quả phải được chạy lại trước mỗi tuyên bố release; checklist này không thay thế log CI hoặc review độc lập.
