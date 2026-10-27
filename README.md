# RoadSense DriveFusion — tích hợp RoadSense2 + Hỗ trợ lái xe (SmooDri)

**Phiên bản:** 1.0 (27/10/2026). Dự án HTML/CSS/JavaScript thuần, không cần build, phù hợp triển khai GitHub Pages qua HTTPS.

## 1. Những gì đã tích hợp

- Tốc độ GPS, bán kính cua, mức tốc độ gợi ý thử nghiệm (theo cấu hình), cảm biến độ xóc, quãng đường; nền RoadSense2.
- Cốc nước G-Force, ga, phanh, lực khi cua, lắc ngang/đảo hướng, ổ gà và đường xóc, điểm lái xe êm ái (tham khảo thuật toán từ ứng dụng Hỗ trợ lái xe).
- **BẮT ĐẦU → đếm ngược tránh rung do nhấn nút → lấy mẫu cân chỉnh khi máy đứng yên → tự động ghi chuyến đi**. Có thể nhấn HỦY trong thời gian đếm ngược hoặc cân chỉnh.
- Bản ghi hành trình riêng mỗi lần bắt đầu/dừng. Mẫu GPS và cảm biến lưu trong IndexedDB theo phần, có thể đồng bộ GitHub theo thiết kế cũ.
- Điểm đường xóc được lưu trong object store `roadPoints` ở IndexedDB, không còn cắt chỉ 300 điểm như danh sách lưu trữ cũ. Điểm gần nhau được gộp; số chuyến ghi nhận khác nhau dùng đánh giá độ tin cậy. Chuyến sau sẽ dò xem có điểm đã nhớ phía trước theo GPS, hướng chạy và bán kính cảnh báo.
- Tách điểm lái êm ái (ga/phanh/cua/lắc ngang) và độ xóc mặt đường; **không trừ điểm tài xế chỉ vì đi qua ổ gà**.
- Âm báo tốc độ 4 tiếng bíp như RoadSense2, thêm 2 tiếng bíp âm thấp khi sắp đến điểm đường xấu. Bật trong Cài đặt > Cảnh báo âm thanh. Khi trình duyệt cấm phát âm nền, phải tương tác với trang để cấp quyền audio.
- Dữ liệu cũ (trong `roadsense-data/v1/`) được giữ nguyên trong gói. Dữ liệu IndexedDB từ RoadSense2 trên **cùng domain và cùng thư mục phạm vi** sẽ nâng cấp từ phiên bản database 2 lên 3, không xóa kho cũ.

## 2. Các bước sử dụng

1. Giải nén và đưa **toàn bộ** tệp/thư mục trong gói lên một website HTTPS (GitHub Pages, Netlify, v.v.). Không chạy `file://` cho mục đích thực tế vì quyền cảm biến/GPS/Service Worker có thể không hoạt động.
2. Mở trang bằng điện thoại có GPS và cảm biến chuyển động; gắn **cố định** điện thoại lên xe và đặt xe đứng yên.
3. Vào **Cài đặt** để điều chỉnh thời gian chờ sau khi nhấn BẮT ĐẦU (mặc định 5 giây), thời gian cân chỉnh (mặc định 1,5 giây) và các ngưỡng G.
4. Chạm **BẮT ĐẦU**, cấp quyền GPS/cảm biến (iPhone: chạm trực tiếp để cấp quyền), chờ hết thời gian tránh rung và để máy đứng yên cho đến khi xuất hiện **Đã cân chỉnh cảm biến**. Sau đó mới bắt đầu lưu hành trình. Nút đổi thành **DỪNG GHI**.
5. Chạy xe và theo dõi các thông số; khi gặp cú xóc đủ mạnh và GPS đủ chính xác, vị trí mới được ghi vào bộ nhớ mặt đường. Chuyến sau app có thể cảnh báo lại khi tiếp cận.
6. Nhấn **DỪNG GHI** khi đến nơi; có thể tải dữ liệu JSON/CSV hoặc Upload lên GitHub. Không phải thao tác xuất mỗi chuyến để lưu cục bộ: các phần hành trình được ghi trong IndexedDB.

## 3. Thiết kế dữ liệu

- `RoadSenseDB` / `archiveSessions`, `archiveChunks`: nhật ký GPS, motion, driving (G-force, % ga/phanh/cua/xóc, điểm êm ái), sự kiện road_event, thông tin cân chỉnh, tóm tắt chuyến đi.
- `RoadSenseDB` / `roadPoints`: địa điểm ổ gà/đường xóc đã phát hiện; lưu vị trí, thời gian, cường độ G, độ chính xác GPS, số **chuyến** xác nhận, không cắt 300 điểm.
- `roadsense-data/v1/<session-id>/...` là cấu trúc tệp đồng bộ GitHub của RoadSense2 và **được giữ nguyên** để tránh phá tương thích. `v1` là phiên bản **định dạng kho dữ liệu xuất**, không phải số phiên bản ứng dụng.
- `roadsense_settings_v3` và các cài đặt/chế độ đồng bộ từ RoadSense2 tiếp tục được sử dụng để tương thích với cấu hình cũ.
- File JSON sao lưu từ nút xuất chứa thuộc tính `roadPoints` và có thể nhập lại **bộ nhớ mặt đường** từ giao diện Dữ liệu & GitHub. Nhập lại này không khôi phục toàn bộ session cũ (các phần hành trình cũ chỉ được xuất để sao lưu).
- Hai thư mục chuyến đi cũ được chép từ ZIP nguồn vào gói; chúng là dữ liệu tĩnh, **không tự động trở thành bộ nhớ cảnh báo của thiết bị**. Nếu trước đây thiết bị có `roadsense_road_events_v3` thì các điểm hợp lệ được nhập sang IndexedDB một lần khi khởi động.

## 4. GitHub và bản lưu dự phòng

- `archive.js` giữ nguyên kho GitHub mặc định cũ: `gptlohoi-del/RoadSense2` (hằng `REPO` gần đầu tệp). Nếu bạn triển khai ở **repository khác**, hãy chỉnh `REPO` trong `archive.js` trước khi đồng bộ. Trang tải lên phải được phép ghi trong repository đó.
- Nhập GitHub Fine-grained Token với quyền Contents: Read and write tại mục **Dữ liệu & GitHub**. Token mặc định chỉ được giữ trong bộ nhớ phiên trình duyệt; việc tùy chọn ghi nhớ token trên máy kém an toàn hơn.
- Đồng bộ GitHub chỉ **đẩy nhật ký hành trình**. Kho `roadPoints` là dữ liệu cục bộ: việc dùng thiết bị/trình duyệt khác cần xuất JSON ở máy cũ và nhập lại trong mục Dữ liệu & GitHub trên máy mới. Chưa tự tải điểm xóc từ GitHub về.
- Trình duyệt hoặc hệ điều hành có thể dừng JavaScript, GPS, cảm biến, Wake Lock khi khóa màn hình hoặc chạy nền; **không bảo đảm ghi liên tục nếu ứng dụng không hiển thị**.

## 5. Phương pháp phát hiện và giới hạn

- G-Force là ước tính từ accelerometer của điện thoại. Trục xe được suy ra từ hướng gắn điện thoại và vector trọng lực khi cân chỉnh. Nếu bị ngược ga/phanh, đổi `Chiều ga / phanh`; nếu máy nằm ngang, thử `Trục Y`. Mỗi lần gắn lại cần khởi động chuyến mới để cân chỉnh lại.
- Độ xóc dựa trên đỉnh gia tốc theo phương trọng lực sau bù nền; **không thể phân biệt chắc chắn ổ gà, gờ giảm tốc, va chạm xe, hay rung do giá đỡ**. Các điểm chỉ được học khi GPS gần đây có sai số ≤45 m, xe ước tính ≥8 km/h và lực xóc đạt ngưỡng.
- Cảnh báo vị trí được chọn theo khoảng cách và hướng chạy ước tính, có thể sai vì GPS, đường nhiều tầng/đường song song, môi trường đô thị. Không thay thế quan sát thực tế.
- Nếu không nhận được cảm biến ổn định trong 18 giây ở giai đoạn cân chỉnh, chương trình sẽ tiếp tục **ghi GPS-only** với cảnh báo rõ ràng rằng không có chỉ số G. Ghi GPS-only không phát hiện điểm đường mới.
- Mức tốc độ gợi ý là tham số thử nghiệm, **không phải giới hạn tốc độ theo pháp luật**. Luôn tuân thủ biển báo, điều kiện đường thực tế và không thao tác màn hình khi lái.

## 6. Các tệp chính

| Tệp | Vai trò |
| --- | --- |
| `index.html` | Giao diện tích hợp duy nhất |
| `style.css` | Giao diện responsive / dark-light / cốc nước |
| `script.js` | Quy trình đếm ngược–cân chỉnh–ghi, GPS, hiển thị, cảnh báo, cài đặt |
| `driving.js` | Bộ tính G-Force/ga/phanh/cua/lắc ngang/điểm êm ái |
| `road-memory.js` | Kho điểm đường xóc IndexedDB, gộp và cảnh báo lại |
| `archive.js` | Lưu hành trình chia phần, xuất dữ liệu, đồng bộ GitHub (giữ nền RoadSense2) |
| `sw.js`, `manifest.json`, icon | Hỗ trợ cài đặt và cache offline |
| `roadsense-data/v1/` | Bản sao dữ liệu cũ từ tệp ZIP RoadSense2 |

## 7. Kiểm tra

Đã kiểm tra cú pháp JavaScript (`node --check`), các ID liên kết JS–HTML, giao diện ở kích thước điện thoại và một bài kiểm tra tự động mô phỏng BẮT ĐẦU → cân chỉnh → ghi → DỪNG cùng với kiểm tra thuật toán phát hiện xóc. **Chưa thử nghiệm thực địa với cảm biến/GPS trên điện thoại thật.**
