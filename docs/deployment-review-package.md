# Deployment review package — Arc Testnet alpha

Ngày cập nhật: 2026-10-12. Candidate này đã được triển khai lên Arc Testnet theo quyền người dùng cấp và đã chạy settlement, recovery và multi-role smoke nội bộ, mỗi flow 0,1 USDC.

## Candidate scope

- `BudgetVault`: USDC accounting, grant attenuation, reservation và immutable exposure caps.
- `ERC8183Adapter`: một adapter cố định nối vault với escrow đã được review.
- Circle Developer-Controlled Wallets: client-side transaction executor cho `ARC-TESTNET`; không phải dependency của hợp đồng.
- Không bao gồm CCTP/Gateway, bridge, AP2 conformance, token mới hoặc mainnet deployment.

## Public constructor inputs cần duyệt

| Input | Giá trị rehearsal local | Mainnet/testnet candidate |
|---|---:|---|
| Token | Mock USDC | Arc USDC `0x3600000000000000000000000000000000000000` (6 decimals) |
| Escrow | `LocalAgenticCommerce` | Arc ERC-8183 reference `0x0747EEf0706327138c69792bF28Cd525089e4583` |
| Owner | Anvil local signer | `0x2503A16442F21B3B01f04EFd5205EE8B04F9bb79` |
| Root expiry | 30 ngày | `2026-11-10T15:49:20Z` |
| Deposit cap | 100 USDC | 100 USDC |
| Max commitment | 25 USDC | 25 USDC |
| Max concurrent commitments | 4 | 4 |
| Provider/evaluator allowlists | local fixture | `[địa chỉ cần duyệt]` |

Ba cap là immutable và root grant cap bằng deposit cap. Thay đổi sau deployment cần vault mới; không có proxy hoặc admin bypass.

## Toolchain và artifact local

- Forge `1.7.1`, Solidity artifact compiler `0.8.30+commit.73712a01`, optimizer 200, EVM Cancun.
- `BudgetVault`: deployed bytecode 12,420 bytes, local build hash `0xcd154d267e442cb115e1ed72ea6c272ad561ad796753e9a0acff53e9ca967e64`.
- `ERC8183Adapter`: 6,351 bytes, local artifact hash `0x35e56a5978c928aa812edbdc481ba434f19e446c9b8d1f83dcc6667fb2c138ff`.
- `LocalAgenticCommerce`: 4,232 bytes, local build hash `0x4c51fcca9fcefae4f459f86fc45bbd379f59da93cc60cd0a0a483162684fa860`; chỉ là local reference.
- Repo hiện không phải Git checkout nên chưa có release commit/hash. Phải tạo source reference có thể review trước khi công bố.

Các hash trên chỉ áp dụng cho source/build hiện tại. Phải tạo lại nếu hợp đồng, compiler, optimizer hoặc dependency thay đổi.

## Verification hiện có

- Contract unit/fuzz/invariant bao phủ conservation, cap ancestry, allowlist, token/adapter quote binding, idempotency, pause/revoke và exact-once reconciliation.
- Local-chain lifecycle dùng calldata/EIP-712/escrow thật trên Anvil.
- Deployment rehearsal chạy đúng `Deploy.s.sol` ở simulation mode và xác nhận không broadcast.
- Live Arc Testnet settlement, recovery và multi-role flows đều có terminal receipt, authoritative job/reservation state và accounting bảo toàn; multi-role dùng ba signer dự án độc lập. Đây là internal test traffic.
- Circle quickstart prepare request và có executor poll cùng transaction ID đến finality/terminal/unknown; chưa dùng credential để broadcast qua Circle.
- Xem [local security review](security-review.md) và [mainnet readiness gate](runbooks/mainnet-readiness.md).

## Gate cần quyết định hoặc bằng chứng bên ngoài

1. Review độc lập phần tiền/quyền; xử lý findings trước mainnet.
2. Chọn provider/evaluator allowlists trước khi tạo grant hoặc nạp vault.
3. Cho phép riêng nếu muốn deploy mainnet, công bố repo/site hoặc gửi Showcase. Giao dịch Arc Testnet phục vụ kiểm thử đã được cho phép trong phiên.

Không dùng gói này để suy ra mainnet readiness hoặc authorization.
