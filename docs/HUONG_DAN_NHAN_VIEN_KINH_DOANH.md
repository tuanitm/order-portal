# Hướng dẫn sử dụng – Dành cho Nhân viên kinh doanh (Salesman)

**Cổng Đặt Hàng – IMV** · Cập nhật ngày 22/11/2026

Tài liệu dành cho người dùng có Role loại **Sales**: tạo đơn hàng thay khách hàng (chọn chiết khấu, khuyến mãi, quà tặng đã thỏa thuận với khách), đẩy đơn **trực tiếp lên SAP** bằng người dùng SAP được gán cho tài khoản, theo dõi quy trình duyệt của Kế toán, xem tồn kho và nhận thông báo.

Địa chỉ truy cập: **https://order.imv.com.vn**

> Giao diện hiển thị bằng **tiếng Anh**. Tài liệu giữ nguyên tên menu, nút bấm tiếng Anh (in **đậm**) và giải thích bằng tiếng Việt.

---

## Mục lục

1. [Tổng quan quy trình](#1-tổng-quan-quy-trình)
2. [Đăng nhập, menu và phạm vi dữ liệu](#2-đăng-nhập-menu-và-phạm-vi-dữ-liệu)
3. [My Profile: tài khoản SAP và Owner Code](#3-my-profile-tài-khoản-sap-và-owner-code)
4. [Danh sách đơn hàng](#4-danh-sách-đơn-hàng)
5. [Tạo đơn thay khách hàng – Self create](#5-tạo-đơn-thay-khách-hàng--self-create)
6. [Xử lý đơn và đẩy lên SAP](#6-xử-lý-đơn-và-đẩy-lên-sap)
7. [Quy trình duyệt của Kế toán](#7-quy-trình-duyệt-của-kế-toán)
8. [Tồn kho – Inventory](#8-tồn-kho--inventory)
9. [Thông báo – chuông 🔔 và nhãn NEW](#9-thông-báo--chuông--và-nhãn-new)
10. [Sự cố thường gặp](#10-sự-cố-thường-gặp)

---

## 1. Tổng quan quy trình

| Bước | Việc làm | Ai làm |
|---|---|---|
| 1. Thỏa thuận | Thống nhất với khách hàng mặt hàng, số lượng, chương trình chiết khấu / khuyến mãi / quà tặng | Nhân viên kinh doanh |
| 2. Tạo đơn | **＋ Self create** trên cổng – giá và khuyến mãi giống hệt giá khách thấy | Nhân viên kinh doanh |
| 3. Kiểm tra | Chọn kho, lấy tồn kho, chỉnh số lượng xác nhận nếu thiếu hàng | Nhân viên kinh doanh |
| 4. Đẩy lên SAP | **Confirm & Push to SAP** – SO được tạo trong SAP bằng người dùng SAP của bạn (ví dụ sa01) | Nhân viên kinh doanh |
| 5. Duyệt | Nếu SO khớp Approval Template (ví dụ kênh GT), Kế toán (ví dụ acc03) duyệt; SO được phát hành (**U_DataStatus = C**) | Kế toán |
| 6. Theo dõi | Nhận thông báo duyệt / từ chối; xem trạng thái trên danh sách đơn | Nhân viên kinh doanh |

Mọi ngày giờ hiển thị theo **giờ Việt Nam (GMT+7)**.

---

## 2. Đăng nhập, menu và phạm vi dữ liệu

### 2.1. Đăng nhập

1. Mở **https://order.imv.com.vn**, nhập **User ID** hoặc **Email**, bấm **Tiếp tục**, nhập mật khẩu, bấm **Đăng nhập**.
2. Tài khoản Sales được chuyển đến khu vực **/sales**.
3. Lần đầu đăng nhập có thể phải đổi mật khẩu. Phiên đăng nhập có hiệu lực 8 giờ.
4. Đăng xuất: bấm **Đăng xuất / Sign out** ở cuối thanh bên trái.

### 2.2. Menu

| Mục | Dùng để |
|---|---|
| **Orders** | Danh sách đơn, tạo đơn thay khách, xử lý và đẩy đơn lên SAP |
| **Inventory** | Tồn kho trực tiếp từ SAP (nếu Role có quyền này) |
| **My Profile** | Xem tài khoản SAP, Owner Code; đổi mật khẩu đăng nhập |

### 2.3. Phạm vi dữ liệu

Bạn chỉ thấy khách hàng, mặt hàng, kho và đơn hàng nằm trong **phạm vi dữ liệu của Role**: **Brands**, **Channels**, **Customer Groups**, **Product Groups**, **Warehouses**. Nếu thiếu khách hoặc mặt hàng, liên hệ System Admin.

---

## 3. My Profile: tài khoản SAP và Owner Code

Mở **Settings → My Profile**.

| Mục | Ý nghĩa | Ai đặt |
|---|---|---|
| **SAP account (Push to SAP)** | Người dùng SAP mà đơn của bạn được đẩy lên (ví dụ `sa01`). SAP ghi người này là người tạo SO và người khởi tạo quy trình duyệt. **Nhiều tài khoản Sales có thể dùng chung một người dùng SAP** | **Chỉ System Admin** (trang Users) |
| **Owner Code** | Mã nhân viên SAP (Employee Code) ghi vào Owner của SO, để người dùng SAP khác thấy đơn | **Chỉ System Admin** |
| **Change Password** | Đổi mật khẩu đăng nhập cổng | Bạn |

- Hai mục SAP account và Owner Code **chỉ xem**, có biểu tượng 🔒 *Set by System Admin*. Muốn đổi, liên hệ System Admin.
- Nếu chưa có người dùng SAP, đơn của bạn được đẩy bằng người dùng SAP mặc định của cổng (admin02).
- Khi mật khẩu SAP dùng chung được đổi, System Admin cập nhật một lần cho mọi tài khoản dùng chung.

---

## 4. Danh sách đơn hàng

Menu **Orders**.

- **Lọc:** thương hiệu, khách hàng (mã hoặc tên), **Doc No** (mã đơn trên cổng hoặc số SO trong SAP), trạng thái.
- **Các cột:** Brand, Order #, Cust Code, Cust Name, Total, SAP Doc #, SAP SO #, Status, Created.
- **Mã đơn** dạng `SO-{Mã khách}-{yymmdd}-{3 số}`, ví dụ `SO-GTSO0701-261027-771`. Đơn đã hủy hiện **gạch ngang**.
- **Nhãn duyệt** dưới trạng thái (đơn đã đẩy lên SAP): ⏳ **Waiting approval**, ✓ **SO approved**, ✕ **SO rejected**.
- Nhãn đỏ nhấp nháy **NEW** cạnh mã đơn = có cập nhật về duyệt (đã duyệt / từ chối / hoàn tác) bạn chưa xem; mở đơn thì nhãn tắt.

---

## 5. Tạo đơn thay khách hàng – Self create

Bấm **＋ Self create** (sau ô tìm Doc No). Giá, chiết khấu và khuyến mãi trong hộp thoại **giống hệt** giá khách thấy trên cổng.

1. **Customer:** gõ mã, tên hoặc MST rồi chọn (chỉ khách trong phạm vi của bạn; khách bị khóa hiện nhưng không chọn được). Bên dưới hiện bảng giá, nhóm khách, khách có tài khoản cổng hay không.
2. **Bill to / Ship to:** chọn địa chỉ xuất hóa đơn / giao hàng của khách (mặc định theo SAP).
3. **Warehouse:** kho xuất hàng (chỉ kho trong Role). Đổi kho cập nhật lại tồn và giá.
4. **Sales supervisor:** mặc định theo khách trong SAP, có thể đổi.
5. **Thêm hàng:** gõ mã hoặc tên, **Enter** để thêm và nhảy vào ô **Qty**; Enter trong ô Qty quay lại ô tìm hàng. Thêm lại cùng mặt hàng sẽ cộng số lượng.
6. **Chọn chiết khấu và khuyến mãi đã thỏa thuận với khách** – ngay dưới tên hàng:
   - 🏷 **Chiết khấu khuyến mãi (%)**: khi mặt hàng có nhiều chương trình cùng lúc, bấm nhãn để chọn chương trình.
   - 🎁 **Tặng hàng**: chọn chương trình quà tặng (hoặc không nhận quà). Dòng quà tự tính, thụt vào, giá 0; chương trình tặng nhiều quà hiện đủ các dòng (quà cùng loại trước, quà hàng khác sau).
   - Các cột **Base, STD%, CT%, PM%, Unit, Total** cho thấy giá gốc, chiết khấu kỳ, chiết khấu hợp đồng, khuyến mãi và đơn giá cuối.
   - Lựa chọn của bạn được **giữ nguyên khi đẩy lên SAP**.
7. Nhập **Remark** (gửi lên SAP thành Comments), kiểm tra Subtotal / Discount / Total, bấm **Create order**.

> Số lượng vượt **Avail Qty** hiện màu đỏ và hệ thống hỏi xác nhận. Đơn có nhiều thương hiệu được **tách thành nhiều đơn**, mỗi đơn một thương hiệu. Tên hàng dài: rê chuột hoặc bấm vào tên để xem đầy đủ.

**⧉ Duplicate** trên trang đơn: tạo đơn mới từ đơn cũ với giá **hôm nay**; những gì không sao chép được (hết khuyến mãi, hết hàng…) được liệt kê.

---

## 6. Xử lý đơn và đẩy lên SAP

Mở đơn từ danh sách.

1. Chọn **Warehouse**, bấm **Get Stock** để lấy tồn kho trực tiếp từ SAP (xanh = đủ, đỏ = thiếu).
2. Thiếu hàng: sửa **Cfm Qty** (số lượng xác nhận). Quà, chiết khấu, thuế, tổng tiền tự tính lại. Nếu khách có tài khoản cổng, dòng có Cfm Qty khác Qty cần khách **Đồng ý / Từ chối**.
3. Bấm **Confirm & Push to SAP**. Ngay trước khi đẩy, hệ thống kiểm tra lại tồn kho thực tế.
4. **Đơn được đẩy trực tiếp lên SAP qua SAP Service Layer, đăng nhập bằng người dùng SAP gán cho tài khoản của bạn** (ví dụ sa01):
   - SO được tạo với **U_DataStatus = I**.
   - Nếu SO khớp một **Approval Template** của SAP (với sa01 là người khởi tạo), SO **giữ ở I** và chờ Kế toán duyệt – thông báo ⏳ *Credit approval required* hiện trên trang đơn.
   - Nếu không có template nào áp dụng, SO được cập nhật thành **C** ngay.
5. Thành công: đơn nhận **SAP Doc #**, **SAP SO #** và chuyển trạng thái. Nếu lỗi, nội dung lỗi SAP hiện cạnh nút.

**Dữ liệu gửi lên SAP** giống đơn do Admin đẩy: khách, kho, địa chỉ (PayToCode / ShipToCode), Sales Supervisor (U_CusSEL04), thông tin xuất hóa đơn, Owner (theo Owner Code của bạn), dòng quà tặng và các dòng chiết khấu hợp đồng / khuyến mãi theo lựa chọn của bạn.

**Hủy đơn:** **Cancel Order** – chỉ khi đơn chưa thành Sales Order chính thức trong SAP.

---

## 7. Quy trình duyệt của Kế toán

| Trạng thái duyệt | Ý nghĩa | U_DataStatus trong SAP |
|---|---|---|
| ⏳ **Waiting approval** | Đang chờ Kế toán (theo Approval Stage của SAP, ví dụ đơn GT chờ acc03) | I |
| ✓ **SO approved** | Kế toán đã duyệt bước cuối | C |
| ✕ **SO rejected** | Kế toán từ chối (kèm lý do) | I |
| ↶ Hoàn tác duyệt | Kế toán hoàn tác lần duyệt trước – SO chờ duyệt lại | I |

- Kế toán kiểm tra 6 bước: giá chuẩn, chiết khấu kỳ, chiết khấu hợp đồng, khuyến mãi, tồn kho & hạn sử dụng, công nợ (AR Aging). Để đơn được duyệt nhanh: chọn đúng chương trình, đúng kho, kiểm tra công nợ khách trước khi đặt.
- Với template có nhiều bước, sau mỗi bước bạn nhận thông báo *stage approved – waiting for …*.

---

## 8. Tồn kho – Inventory

- Đọc trực tiếp từ SAP: **OnHand**, **Committed**, **Available**, theo từng kho trong Role của bạn (ô **🏭 All warehouses** để chọn kho).
- Cột **Shelf life %**: % hạn sử dụng còn lại của lô thấp nhất (đỏ < 33%, cam < 66%, xanh ≥ 66%); rê chuột để xem từng lô.
- Tìm theo mã hoặc tên hàng. **Export Excel** xuất đúng dữ liệu đang xem, kèm chi tiết lô.

---

## 9. Thông báo – chuông 🔔 và nhãn NEW

**Chuông thông báo** ở góc phải trên cùng, **số màu đỏ** = số thông báo mới chưa đọc (cũng hiện trên tiêu đề tab trình duyệt).

| Thông báo | Khi nào |
|---|---|
| ✅ **SO … approved** | Kế toán duyệt (kể cả Auto SO Approval) – SO đã phát hành C trong SAP |
| ⛔ **SO … rejected** | Kế toán từ chối, kèm lý do |
| ➡️ **SO …: stage approved** | Một bước đã duyệt, chờ bước tiếp theo |
| ↶ **SO …: approval undone** | Kế toán hoàn tác duyệt, kèm lý do; SO chờ duyệt lại |

- Bạn nhận thông báo cho đơn **bạn tạo, bạn đẩy**, hoặc SO được tạo bằng người dùng SAP của bạn (mọi tài khoản dùng chung người dùng SAP đó đều nhận).
- Bấm vào thông báo để mở đơn; **Mark all read** đánh dấu đã đọc tất cả.
- Thông báo tới khi đang làm việc hiện một khung nhỏ ở góc phải vài giây.
- Biểu tượng tin nhắn bên cạnh chuông báo tin nhắn mới của khách trong đơn hàng.

---

## 10. Sự cố thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Không thấy khách / mặt hàng / kho | Ngoài phạm vi dữ liệu của Role; khách bị khóa | Liên hệ System Admin |
| *SAP refused the saved password* khi đẩy đơn | Mật khẩu người dùng SAP dùng chung đã đổi | Báo System Admin cập nhật ở trang Users |
| SO không vào quy trình duyệt dù cần duyệt | Người dùng SAP của bạn không phải originator của Approval Template; đẩy bằng admin02 vì chưa có người dùng SAP | Báo System Admin gán người dùng SAP; nhờ tư vấn SAP kiểm tra template |
| Confirm & Push báo lỗi | Khách thiếu mã SAP; còn dòng chờ khách xác nhận; SAP từ chối dữ liệu | Đọc lỗi cạnh nút; xử lý dòng Pending |
| Người dùng SAP khác không thấy SO | Owner Code chưa đúng | Báo System Admin kiểm tra Owner Code |
| Không nhận thông báo duyệt | Đơn không do bạn tạo / đẩy; đang chờ cập nhật | Tải lại trang; kiểm tra nhãn duyệt trên danh sách đơn |
