# CCTP inbound funding recovery

`InboundFundingState` trong SDK theo dõi một lần nạp USDC vào budget qua các bước độc lập:

```text
PLANNED
  -> BURN_SUBMITTED -> BURN_CONFIRMED
  -> ATTESTED
  -> MINT_SUBMITTED -> MINT_CONFIRMED
  -> DEPOSIT_SUBMITTED -> DEPOSIT_CONFIRMED
```

Mỗi transfer có ID ổn định ràng buộc source/destination chain và CCTP domain, recipient, vault, operation ID và requested amount. Retry với cùng evidence là idempotent; cùng bước với tx/message/amount khác bị từ chối. SDK chỉ trả `budgetCreditableAmount > 0` sau `DEPOSIT_CONFIRMED`, vì mint vào ví người dùng chưa phải deposit vào vault và không làm tăng D/A.

## Phục hồi theo bước

- `CHECK_BURN`, `CHECK_MINT`, `CHECK_DEPOSIT`: truy receipt theo tx hash đã lưu; không tạo operation ID hoặc burn mới vì timeout.
- `FETCH_ATTESTATION`: truy attestation cho đúng `messageHash`; chỉ lưu hash của attestation trong state nếu payload đầy đủ được quản lý bởi executor riêng.
- `APPROVE_AND_DEPOSIT`: dùng amount thực nhận từ mint receipt. Chuẩn bị approval đúng amount rồi deposit vào vault; không giả định requested amount bằng received amount khi route có phí.
- `COMPLETE`: đối chiếu deposit receipt và ledger vault. Chỉ khi đó mới đưa amount vào budget projection.

Primitive hiện chỉ quản lý state/evidence và không tự gọi Circle API, burn, mint hoặc broadcast. Integrator phải pin route CCTP được Circle hỗ trợ, contract address, token, finality và fee policy trước khi bật executor. Không dùng state off-chain để ghi có budget nếu getter/event của vault chưa xác nhận deposit.
