# Pilot discovery guide

Chưa có tổ chức hoặc provider nào được liên hệ. Tài liệu này chuẩn bị cho M0/M10 và không phải bằng chứng traction.

## Nhóm phù hợp

- Workflow có ít nhất hai agent/service mua OCR, extraction, translation, QA hoặc document generation.
- Có chi phí thực, retry/concurrency và một người chịu trách nhiệm ngân sách.
- Có thể định nghĩa output kiểm chứng được và evaluator trước khi job funded.

## Câu hỏi

1. Khi hai agent cùng chi, hệ thống hiện ngăn vượt ngân sách bằng cách nào?
2. Họ theo dõi tiền đã cam kết nhưng chưa settle ở đâu?
3. Lỗi gần nhất quanh timeout/retry/duplicate charge xảy ra thế nào và mất bao lâu để đối soát?
4. Giá trị, tần suất và độ dài job điển hình là bao nhiêu; phí escrow tối đa chấp nhận được?
5. Ai được phép cấp/revoke quyền và ai nghiệm thu output?
6. Provider có API idempotent và signed fixed-price quote không?
7. Họ cần SDK-only hay chấp nhận hosted orchestration?
8. Điều gì khiến họ quay lại dùng cho workload thứ hai?

## Tiêu chí tiếp tục pilot

- Ít nhất hai vấn đề cụ thể về shared budget, commitment accounting hoặc recovery được xác nhận.
- Một buyer và một provider chấp nhận fixed-price job, evaluator/deadline rõ và cap nhỏ.
- Nhóm ngoài dự án có thể chạy SDK-only example và chỉ ra workload thật.

Nếu không đạt, không dùng transaction tự tạo để thay thế nhu cầu; giữ core ở trạng thái technical experiment hoặc đổi use case tham chiếu.
