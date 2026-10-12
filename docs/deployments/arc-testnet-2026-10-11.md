# Arc Testnet deployment — 2026-10-11

Deployment alpha trên Arc Testnet, chain ID `5042002`, RPC `https://rpc.testnet.arc.io`. Deployment dùng USDC ERC-20 `0x3600000000000000000000000000000000000000` (6 decimals) và escrow ERC-8183 reference của Arc tại `0x0747EEf0706327138c69792bF28Cd525089e4583`.

| Thành phần | Địa chỉ | Tx |
|---|---|---|
| `BudgetVault` | [`0x0A1AbBf8b795e30F305C54C53A2404a595aF923a`](https://explorer.testnet.arc.io/address/0x0A1AbBf8b795e30F305C54C53A2404a595aF923a) | [`0x56c2dd32e5927344460bddc58bfecc40e6c642b972f7290516a8741fd0457f89`](https://explorer.testnet.arc.io/tx/0x56c2dd32e5927344460bddc58bfecc40e6c642b972f7290516a8741fd0457f89) |
| `ERC8183Adapter` | [`0x18EF2ad61947800e9F3574b65cee4fd2b4361a4a`](https://explorer.testnet.arc.io/address/0x18EF2ad61947800e9F3574b65cee4fd2b4361a4a) | [`0x07076b8687d64155563ba058017938c6404d9a0c3ae9289aeff75ba4e883e583`](https://explorer.testnet.arc.io/tx/0x07076b8687d64155563ba058017938c6404d9a0c3ae9289aeff75ba4e883e583) |
| Bind adapter | vault → adapter | [`0xe049a5cc248129a647777e6010fad11596446ef5ff19e703904b257f43866536`](https://explorer.testnet.arc.io/tx/0xe049a5cc248129a647777e6010fad11596446ef5ff19e703904b257f43866536) |

## Cấu hình bất biến

- Owner/root grantee: `0x2503A16442F21B3B01f04EFd5205EE8B04F9bb79`
- Root expiry: `2026-11-10T15:49:20Z`
- Deposit cap: `100000000` atomic units (100 USDC)
- Max commitment: `25000000` atomic units (25 USDC)
- Max concurrent commitments: `4`
- Toolchain: Forge `1.7.1` (`4072e48705af9d93e3c0f6e29e93b5e9a40caed8`), Solidity `0.8.30`, optimizer 200 runs, EVM Cancun
- Vault deployed code: 12,420 bytes, hash `0x5dedc337a7f9a835f266b1479973bf07257af5f6a6abe81f1fa4552731cda35b`
- Adapter deployed code: 6,351 bytes, hash `0x5ff792230520fa0f041264ec5b7ab8f1d41ac8b63ea9b09090940a9874c295f0`

## Bằng chứng sau deployment

Cả ba receipt có `status=success` ở block `66675920`. Tổng phí thực trả cho deployment hiện tại là `0.112866330962786709` USDC theo native gas view. Read-only verification xác nhận token, owner, caps, adapter binding, escrow binding và root grant đều đúng cấu hình; `paused=false`.

Escrow là proxy. EIP-1967 implementation tại thời điểm kiểm tra là `0xa316fd02827242d537f84730f8a37d0ba5fd351a`, deployed code hash `0x7054f89cadf92af85003313db92e9b29ef670ee2c7a20b5295cdddf66ecaa4b3`. Adapter pin ABI và quy tắc provider gọi `setBudget` của deployment này; xem [ADR 0002](../adr/0002-erc8183-adapter.md).

Gói source verification đã được chuẩn bị offline tại `verification/arc-testnet/`. Creation bytecode cộng constructor args khớp chính xác hai deployment transaction và runtime code hash khớp manifest. Standard JSON hợp lệ cho Blockscout đã được tạo; source chưa được công bố lên explorer.

## Deployment đã thay thế

Cặp đầu tiên (`BudgetVault` `0x94c82EA02Bf1F378393E86D8Ff563A6122F182e3`, adapter `0x21C49eB4d81436Fa72D22fcC414da178d949a764`) đã bị thay thế sau khi fork test xác nhận adapter cũ gọi hàm provider-only `setBudget` với vai trò client. Ledger của vault cũ vẫn bằng không, chưa có grant con hoặc job có giá trị. Không dùng hai địa chỉ này cho tích hợp mới.

## Live value-flow smoke test

Một flow nội bộ 0,1 USDC đã chạy thành công trên Arc Testnet qua đúng đường production: approve → deposit → create grant → reserve → dispatch → provider `setBudget` → fund → submit → complete → reconcile.

- Commitment: `0x6f5380e5ab28ed882964eeb8a07dff8c2d805fb9deece404fc5ee591baff59cc`
- ERC-8183 job: `186887`, terminal status `Completed` (`3`)
- Reservation terminal status: `Settled` (`3`)
- Ledger cuối: `D=100000`, `A=0`, `R=0`, `E=0`, `S=100000`, `W=0`; active commitments `0`
- Cả 10 receipt đều `success`, từ block `66676964` đến `66677153`
- Tổng gas của flow: `0.046816361260542828` USDC theo native gas view
- Fund tx: [`0x531f5ec0…d761dad`](https://explorer.testnet.arc.io/tx/0x531f5ec0c9c50883baab53403d507cb27d740d13ec72056c58b52ab85d761dad)
- Complete tx: [`0x8a8c9c9d…2280af6`](https://explorer.testnet.arc.io/tx/0x8a8c9c9d07a3b0d0d5f4e60f6cbaaa0930a53c46ba472d18391a60c5b2280af6)
- Reconcile tx: [`0xfa8f0f39…bdd3fb1`](https://explorer.testnet.arc.io/tx/0xfa8f0f39c6083d0124ffdacf845cf36d4925f03d2b5ad48810d011935bdd3fb1)

Owner, provider và evaluator đều là ví kiểm thử của dự án trong smoke flow này. Đây là bằng chứng tích hợp và chuyển giá trị testnet, không phải người dùng độc lập, khách hàng, volume thương mại hoặc bằng chứng chất lượng dịch vụ.

Một flow recovery nội bộ thứ hai cũng đã hoàn tất với 0,1 USDC: deposit → reserve → dispatch → provider `setBudget` → fund → evaluator reject → refund về adapter → reconcile về vault → owner withdraw phần available.

- Commitment: `0xe2631314db947800ba4ef777c23ae25a676d1f7b061747004a207e67219848dc`
- ERC-8183 job: `186888`, terminal status `Rejected` (`4`)
- Reservation terminal status: `Refunded` (`4`)
- Ledger cuối sau cả hai flow: `D=200000`, `A=0`, `R=0`, `E=0`, `S=100000`, `W=100000`; active commitments `0`
- Cả 10 receipt recovery đều `success`, từ block `66677570` đến `66677613`
- Tổng gas recovery flow: `0.05098496` USDC theo native gas view
- Reject tx: [`0xb2bf4a58…0f83971`](https://explorer.testnet.arc.io/tx/0xb2bf4a586f3dd7a805238a3bdb78e5dcdb7887367fe82bd13bc62f6d80f83971)
- Reconcile tx: [`0x7803f216…db5fd1`](https://explorer.testnet.arc.io/tx/0x7803f216a5e2eff2ec0e1cb737bdf819a01ba88b18a4f07ffd58a46b13db5fd1)
- Withdraw tx: [`0x16ee0231…45760f`](https://explorer.testnet.arc.io/tx/0x16ee0231ef3b8a5004308960154c1cd460d90796e3331103c5bae92f5b45760f)

Sau recovery, balance vật lý của vault và adapter đều bằng 0, allowance adapter → escrow bằng 0. Điều này xác nhận tiền testnet đã quay về owner trong khi accounting vẫn bảo toàn `D=A+R+E+S+W`.

## Multi-role authorization smoke test

Một settlement thứ ba chạy với ba signer độc lập để chứng minh quyền không chỉ đúng khi các vai trò trùng địa chỉ:

- Budget owner: `0x2503A16442F21B3B01f04EFd5205EE8B04F9bb79`
- Provider: `0x0A85AB57c0caCadB6f44c2Ac14D926a8A682b0D3`
- Evaluator: `0x9c135CDc1C4B9EA30548FF975634021cc7501440`
- ERC-8183 client: adapter `0x18EF2ad61947800e9F3574b65cee4fd2b4361a4a`
- Commitment: `0xbc8eb6d2eaee114d7ce2a67a7748e9b7fae827bdd1e4e69c1fc3ea575fe6e019`
- Job: `186889`; job `Completed` và reservation `Settled`
- Provider ký quote, gọi `setBudget` và `submit`; evaluator riêng gọi `complete`
- 12 receipt setup/lifecycle đều thành công; tổng phí `0.061354048701909041` USDC theo native gas view
- [`dispatch`](https://explorer.testnet.arc.io/tx/0x8d1a9e6b925df673078e1d2bdae40da60df3f977ed2a5ddb7991800f72d7923c), [`setBudget`](https://explorer.testnet.arc.io/tx/0xfe9f2d864266d7b1b2f0db7b93ea07d8f790a844e74d6a8165174f50de80e4d7), [`submit`](https://explorer.testnet.arc.io/tx/0xa5b9d808011dce8cd2ee00e030250edff0a556060788c41abeaf539662d6799e), [`complete`](https://explorer.testnet.arc.io/tx/0x3f00dee59ae3f321fc02733f6d9715a587a0e81c23dbae19a4ef6f85d688d262), [`reconcile`](https://explorer.testnet.arc.io/tx/0xc8609bd020996765a3f5351fc14f7f963b550cb2e54e27bc9126c03aa64195ea)

Ledger cuối sau ba flow là `D=300000`, `A=0`, `R=0`, `E=0`, `S=200000`, `W=100000`; active commitments `0`. Vault và adapter đều có token balance bằng 0, allowance adapter → escrow bằng 0. Ba ví vẫn do dự án kiểm soát nên đây là kiểm thử quyền nội bộ, không phải ba người dùng độc lập.

Đây là testnet alpha, chưa phải audit hoặc mainnet-readiness. Hoạt động triển khai và ba smoke test nội bộ không được tính là traction người dùng độc lập.
