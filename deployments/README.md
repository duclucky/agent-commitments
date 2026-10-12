# Deployments

Repo có manifest máy đọc được cho Arc Testnet tại [`arc-testnet.json`](arc-testnet.json) và canary Arc Mainnet chưa bind tại [`arc-mainnet.json`](arc-mainnet.json). Chạy `pnpm verify:arc-testnet` hoặc `pnpm verify:arc-mainnet` để kiểm tra manifest với RPC hiện tại mà không ký hoặc broadcast. Candidate mainnet cần artifact contract tương ứng đã build; `pnpm prepare:arc-mainnet-draft-candidate` chỉ tạo kế hoạch calldata, không broadcast. `arc-mainnet-draft-candidate-plan.json` và `arc-mainnet-draft-candidate-v1-plan.json` là kế hoạch đã dùng, không phải bằng chứng deployment độc lập; địa chỉ/hash đã thực thi nằm trong `arc-mainnet.json`.

Mỗi manifest phải ghi ít nhất:

- chain ID, RPC/explorer source và ngày kiểm tra;
- token, vault, adapter, escrow và owner/evaluator addresses;
- transaction hashes, block numbers, compiler/settings và source commit;
- runtime bytecode hash và trạng thái source verification;
- cap/expiry/pause policy áp dụng cho pilot.

Không thêm địa chỉ ví dụ, địa chỉ chỉ được “dự kiến” hoặc receipt không canonical vào thư mục này. Deployment hiện tại không có Git source revision vì workspace chưa phải Git checkout; trường này được ghi `null` thay vì bịa lịch sử.
