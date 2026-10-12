# Mainnet readiness gate

Update 2026-10-12: chủ tiền đã cho phép ngoại lệ review độc lập cho pilot nội bộ giới hạn và pilot đã hoàn tất, theo [record](../deployments/arc-mainnet-pilot-2026-10-12.md). Binding v2 đã thực hiện; không chạy lại setAdapter/prepare trước-binding. Gate chung dưới đây vẫn áp dụng khi mở rộng phạm vi/vốn production; không biến ngoại lệ pilot thành review độc lập đã đạt.

Readiness không phải quyền deploy. Kích hoạt pilot qua one-time binding hoặc funding cần đủ các gate sau và authorization cho network, signer, địa chỉ, giá trị và trần phí. Canary unbound/unfunded đã được triển khai theo quyền riêng của người dùng; điều đó không đóng gate security hoặc cho phép hạch toán candidate như một hệ thống thanh toán hoạt động. Xem [ADR 0005](../adr/0005-mainnet-agentic-commerce-escrow.md) và [candidate review package](../mainnet-candidate-review.md).

## Capability

- Xác minh lại chain ID, RPC, explorer, USDC address/decimals từ nguồn chính thức và read-only RPC.
- Xác minh bytecode/source/license của escrow production; local reference không đủ.
- Ghi rõ Circle Wallets/CCTP/Gateway capability nào thực sự dùng và capability nào không dùng.

## Security

- Full unit/fuzz/failure/DB/local-chain E2E xanh trên commit candidate.
- Review độc lập không còn finding nghiêm trọng về accounting, replay, allowance, refund, pause/revoke và recovery.
- External signer/keystore hoạt động; backend không giữ owner private key.
- `DEPOSIT_CAP`, `MAX_COMMITMENT_AMOUNT`, `MAX_CONCURRENT_COMMITMENTS`, root expiry, provider/evaluator allowlists và đường rút A được chủ tiền duyệt.

## Deployment rehearsal

- Chạy `forge script` không có `--broadcast` trên fork/simulation với public inputs, bao gồm ba cap bất biến.
- So khớp owner với sender, escrow client/refund semantics, token và adapter one-time binding.
- Chuẩn bị manifest, verification command, receipt capture và rollback/pause runbook.

## Sau deployment

- Đối chiếu runtime bytecode hash và constructor args trước khi nạp tiền.
- Chạy smoke lifecycle với giá trị nằm trong trần đã duyệt; theo dõi A/R/E/S/W và receipt.
- Chỉ công bố địa chỉ sau khi bằng chứng khớp. Showcase/X/traction cần authorization công bố riêng.
