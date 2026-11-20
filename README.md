# Lens Try-On – Thử lens trực tiếp (WordPress / WooCommerce)

Plugin cho khách thử kính áp tròng ngay trên khuôn mặt qua camera, chạy trực tiếp trên trình duyệt (Chrome/Safari điện thoại & máy tính), không cần cài app, không gửi hình ảnh lên máy chủ.

## Cài đặt

1. Nén thư mục `lens-tryon` thành zip (hoặc dùng `lens-tryon.zip` có sẵn ở `E:\MyProject`) → WordPress **Plugins → Add New → Upload Plugin** → Kích hoạt.
2. Cần WooCommerce. Website phải chạy **HTTPS** (trình duyệt chỉ cho phép camera trên HTTPS).
3. **Cài đặt → Thử lens**: đổi chữ nút, vị trí nút, màu chủ đạo, phạm vi “mẫu lens khác” hiển thị trong giao diện thử.

## Gắn ảnh lens cho sản phẩm

Sửa sản phẩm → khung *Dữ liệu sản phẩm* → tab **Thử lens**:

| Trường | Ý nghĩa |
|---|---|
| Ảnh lens thử | PNG nền trong suốt (xem yêu cầu ảnh bên dưới) |
| GDIA (mm) | Đường kính phần có màu của lens, VD 13.2. Để trống = vừa khít mống mắt |
| Độ phủ màu | 0.7–0.85 cho lens tự nhiên (thấy chút màu mắt thật), 0.9–1 cho lens màu đậm |
| Vùng đồng tử | Mặc định 0.28 – vùng giữa giữ nguyên đồng tử thật |
| Tắt thử lens | Ẩn nút cho sản phẩm này |

**Sản phẩm có biến thể màu**: mở từng biến thể → chọn *Ảnh lens thử* riêng (và GDIA riêng nếu khác). Khi khách chọn màu trên trang rồi bấm “Thử lens”, giao diện mở đúng màu đó; đổi màu trong giao diện thử cũng đổi lựa chọn trên form sản phẩm.

Nút tự hiện khi sản phẩm có ít nhất 1 ảnh thử. Muốn đặt nút ở chỗ khác (page builder, Elementor…): chọn vị trí *Không tự chèn* rồi dùng shortcode:

```
[lens_tryon_button]                       // trong trang sản phẩm
[lens_tryon_button product_id="123"]      // ở trang bất kỳ
[lens_tryon_button product_id="123" lens="456" text="Thử màu Xám"]   // lens = ID biến thể
```

Hoặc bất kỳ phần tử nào có thuộc tính `data-lens-tryon` (cùng trang đã nạp plugin), hay gọi JS `LensTryOn.open({ lensId: '456' })`.

## Yêu cầu ảnh lens (quan trọng cho độ chân thực)

- PNG (hoặc WebP) **nền trong suốt**, ảnh vuông, khuyến nghị 512–1024px.
- Lens chụp/scan **thẳng mặt**, tròn, căn giữa; viền ngoài của phần in màu chạm mép ảnh (plugin tự cắt phần trong suốt thừa).
- **Giữa lens (đồng tử) trong suốt.**
- Giữ nguyên độ trong suốt thật của lens: phần họa tiết thưa → alpha thấp. Đừng làm phẳng thành màu đặc – sẽ trông như hình dán.
- Ảnh không có bóng đổ, không có phản chiếu đèn (plugin tự giữ đốm sáng thật trên mắt khách).

Các ảnh trong `demo/lens/` là ảnh vẽ mẫu để thử kỹ thuật, không phải ảnh lens thật.

## Cách hoạt động (tóm tắt kỹ thuật)

- **Nhận diện**: MediaPipe Face Landmarker (478 điểm, gồm 10 điểm mống mắt), chạy WebAssembly + GPU trên thiết bị. Chỉ tải mô hình (~3.7MB) khi khách bấm *Bật camera*.
- **Bám mắt, không trễ**: lens được vẽ trên **chính khung hình** dùng để nhận diện (không có độ lệch thời gian giữa ảnh và lens). Vị trí mống mắt được lọc rung (One-Euro) trong hệ toạ độ của mắt, còn chuyển động đầu được theo trực tiếp bằng khung mắt → quay/nghiêng đầu nhanh vẫn dính; đảo mắt thì lens chạy theo mống mắt.
- **Kích thước ổn định**: tỉ lệ bán kính mống mắt / độ rộng mắt được học dần cho từng người, nên lens không “phập phồng”; khi quay/ngẩng đầu lens co thành elip theo phối cảnh (từ ma trận tư thế đầu).
- **Mí mắt**: mặt nạ theo viền mí (16 điểm/mắt, viền mềm) → lens bị mí che đúng, nháy mắt thì biến mất tự nhiên.
- **Hoà trộn chân thực** (shader WebGL): giữ đồng tử thật; giữ chi tiết sáng tối & bóng mí trên của mống mắt thật; đo ánh sáng và cân bằng trắng từ tròng trắng để lens sáng/tối/ám màu theo môi trường; tối nhẹ ở rìa theo độ cong giác mạc; giữ đốm phản chiếu trên giác mạc; thêm hạt nhiễu khớp với camera.
- **Hiệu năng**: chỉ tô pixel trong vùng 2 mống mắt; `requestVideoFrameCallback` khi có. Điện thoại tầm trung 2020+ đạt ~30fps. Thêm `?lensdebug` vào URL để xem FPS.
- **Quyền riêng tư**: màn hình xin phép giải thích rõ trước khi hỏi quyền camera; video chỉ xử lý trong trình duyệt; camera tắt ngay khi đóng giao diện hoặc chuyển tab. Ảnh chụp chỉ tạo trên máy khách (tải về / chia sẻ).

## Tự host mô hình (tuỳ chọn)

Mặc định tải thư viện từ jsDelivr và mô hình từ Google Storage. Muốn tự host: tải `@mediapipe/tasks-vision@0.10.14` (file `vision_bundle.mjs` + thư mục `wasm/`) và `face_landmarker.task`, đưa lên host của bạn rồi điền URL ở **Cài đặt → Thử lens → Nâng cao**.

## Demo không cần WordPress

`demo/index.html` – chạy server tĩnh tại thư mục `lens-tryon`:

```
npx http-server -p 8080        # hoặc: python -m http.server 8080
```

Mở `http://localhost:8080/demo/` trên máy tính. Để thử trên điện thoại cần HTTPS (VD: `npx localtunnel --port 8080`, ngrok, hoặc GitHub Pages).

## Cấu trúc

```
lens-tryon/
├── lens-tryon.php                      # khai báo plugin
├── uninstall.php
├── includes/
│   ├── class-lens-tryon-data.php       # đọc lens từ sản phẩm / biến thể
│   ├── class-lens-tryon-admin.php      # tab "Thử lens" + trường biến thể
│   ├── class-lens-tryon-frontend.php   # nút, shortcode, nạp script, AJAX thêm vào giỏ
│   └── class-lens-tryon-settings.php   # Cài đặt → Thử lens
├── assets/js/lens-tryon.js             # engine AR + giao diện (không phụ thuộc thư viện)
├── assets/js/admin.js                  # chọn ảnh từ thư viện Media
├── assets/css/lens-tryon.css
└── demo/                               # trang demo độc lập + ảnh lens mẫu
```

## Hook cho lập trình viên

- `lens_tryon_product_lenses` (filter) – sửa danh sách lens của 1 sản phẩm.
- `lens_tryon_lenses` – sửa toàn bộ danh sách đưa vào giao diện thử.
- `lens_tryon_related_query` – sửa truy vấn sản phẩm liên quan.
- `lens_tryon_config` – sửa cấu hình JS (`i18n`, `tuning`, …).
- JS: `window.LensTryOnConfig.onAddToCart(lens, ui)` để tự xử lý thêm giỏ; `onSelect(lens)` khi đổi mẫu.

## Kiểm tra trước khi nghiệm thu

- [ ] Ánh sáng phòng bình thường: lens trông như đeo thật, không viền cứng, đồng tử & đốm sáng còn nguyên.
- [ ] Quay trái/phải, nghiêng, ngẩng/cúi, lại gần/ra xa: lens dính mắt.
- [ ] Đảo mắt 4 hướng: lens chạy theo mống mắt; nháy mắt: lens bị mí che.
- [ ] iPhone Safari + Android Chrome: ~24–30fps (`?lensdebug`).
- [ ] Đổi mẫu tức thì; thêm vào giỏ cập nhật mini-cart; chụp ảnh tải về được.
