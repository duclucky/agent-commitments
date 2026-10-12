# Arc Testnet source verification package

Chạy `pnpm prepare:arc-testnet-verification` để tạo lại constructor args, Standard JSON compiler input và `report.json`. Script chỉ đọc RPC; nó không gửi source hoặc giao dịch.

Trước khi công bố source lên explorer, kiểm tra `report.json` có `creationInputMatched: true` cho cả hai contract. Theo hướng dẫn Arc, verifier là Blockscout tại `https://explorer.testnet.arc.io/api/`. Việc chạy `forge verify-contract` không có `--show-standard-json-input` sẽ công bố source và cần quyền riêng.

Sau khi có quyền công bố riêng, đặt `ALLOW_SOURCE_PUBLICATION=ARC-TESTNET` rồi chạy `pnpm publish:arc-testnet-verification`. Script chuẩn bị lại package, submit cả hai contract và chờ kết quả verifier.
