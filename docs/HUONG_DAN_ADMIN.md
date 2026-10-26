# Hướng dẫn sử dụng – Phần Quản trị (Admin)

**Cổng Đặt Hàng / Ordering Portal – IMV**

Tài liệu dành cho nhân viên quản trị vận hành cổng đặt hàng: duyệt khách hàng, đồng bộ dữ liệu từ SAP B1, quản lý giá – chiết khấu – khuyến mãi và xử lý đơn hàng.

> Giao diện quản trị hiển thị bằng **tiếng Anh**. Tài liệu này giữ nguyên tên menu, nút bấm tiếng Anh (in **đậm**) và giải thích bằng tiếng Việt.

---

## Mục lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Đăng nhập quản trị](#2-đăng-nhập-quản-trị)
3. [Quy trình vận hành khuyến nghị](#3-quy-trình-vận-hành-khuyến-nghị)
4. [Dashboard và Quick sync](#4-dashboard-và-quick-sync)
5. [Customers Approval – Duyệt khách hàng](#5-customers-approval--duyệt-khách-hàng)
6. [SAP Customers](#6-sap-customers)
7. [Customer Groups – Nhóm khách hàng](#7-customer-groups--nhóm-khách-hàng)
8. [Catalog Visibility – Ẩn/hiện hàng hóa theo khách hàng](#8-catalog-visibility--ẩnhiện-hàng-hóa-theo-khách-hàng)
9. [Items – Sản phẩm](#9-items--sản-phẩm)
10. [Item Groups – Nhóm hàng](#10-item-groups--nhóm-hàng)
11. [Price Lists – Bảng giá](#11-price-lists--bảng-giá)
12. [Contract Discounts – Chiết khấu hợp đồng](#12-contract-discounts--chiết-khấu-hợp-đồng)
13. [Promotion Discounts – Khuyến mãi](#13-promotion-discounts--khuyến-mãi)
14. [Orders – Xử lý đơn hàng](#14-orders--xử-lý-đơn-hàng)
15. [Admin Users và Admin Roles – Phân quyền](#15-admin-users-và-admin-roles--phân-quyền)
16. [Cách hệ thống tính giá cho khách hàng](#16-cách-hệ-thống-tính-giá-cho-khách-hàng)
17. [Vận hành, cập nhật file, đồng bộ tự động](#17-vận-hành-cập-nhật-file-đồng-bộ-tự-động)
18. [Sự cố thường gặp](#18-sự-cố-thường-gặp)

---

## 1. Tổng quan hệ thống

| Luồng | Diễn biến |
|---|---|
| **Dữ liệu chủ** (khách hàng, sản phẩm, bảng giá, chiết khấu, khuyến mãi) | SAP B1 → *đồng bộ* → Cơ sở dữ liệu MySQL của cổng (bản sao dữ liệu SAP, tài khoản, đơn hàng) → Cửa hàng của khách hàng (giá, khuyến mãi, giỏ hàng, đặt hàng) |
| **Đơn hàng** | Khách hàng gửi đơn → lưu vào MySQL → Admin kiểm tra → **Confirm & Push to SAP** → Draft Sales Order trong SAP B1 |

- Dữ liệu chủ (khách hàng, sản phẩm, bảng giá, chiết khấu, khuyến mãi) **lấy từ SAP** và được lưu bản sao trong MySQL. Khách hàng luôn xem dữ liệu bản sao này, nên cần **đồng bộ lại** khi SAP thay đổi.
- Khi khách hàng đặt hàng, đơn được **lưu vào MySQL trước**. Admin kiểm tra rồi bấm **Confirm & Push to SAP** để tạo **Draft Sales Order** trong SAP.
- Múi giờ hệ thống: **giờ Việt Nam (UTC+7)**.

---

## 2. Đăng nhập quản trị

1. Mở địa chỉ: `https://order.imv.com.vn/vi/admin` (hoặc `/en/admin`).
2. Nhập **Email quản trị** và **Mật khẩu**, bấm **Đăng nhập**.
3. Có hai loại tài khoản:
   - **Super-admin** (khai báo trong `config.json` / file `.env`): luôn có toàn quyền.
   - **Admin user** do Super-admin tạo tại menu **Admin Users**, chỉ thấy các menu được gán quyền.
4. Phiên đăng nhập có hiệu lực **8 giờ**. Hết hạn cần đăng nhập lại.
5. Cuối thanh menu bên trái có email đang đăng nhập và liên kết **← Cổng đặt hàng** để quay về trang khách hàng.

Menu bên trái gồm: Dashboard, Customers Approval, SAP Customers, Customer Groups, Catalog Visibility, Items, Item Groups, Price Lists, Contract Discounts, Promotion Discounts, Orders, Admin Users, Admin Roles. Menu nào bạn không được cấp quyền sẽ không hiển thị.

---

## 3. Quy trình vận hành khuyến nghị

### 3.1. Thiết lập lần đầu (làm theo thứ tự)

| Bước | Việc cần làm | Menu |
|---|---|---|
| 1 | Nhập **nhóm khách hàng** từ SAP (quyết định khách hàng nào được đồng bộ) | Customer Groups |
| 2 | Nhập **nhóm hàng** từ SAP (quyết định sản phẩm nào được đồng bộ) | Item Groups |
| 3 | Đồng bộ **bảng giá**, đánh dấu 1 bảng **Base** và các bảng **Channel** | Price Lists |
| 4 | Đồng bộ **khách hàng SAP** | SAP Customers |
| 5 | Đồng bộ **sản phẩm** | Items |
| 6 | Đồng bộ **chiết khấu hợp đồng** | Contract Discounts |
| 7 | Nhập **khuyến mãi** | Promotion Discounts |
| 8 | Tạo tài khoản admin và phân quyền (nếu cần) | Admin Users / Admin Roles |

### 3.2. Công việc hằng ngày

1. Vào **Customers Approval** → duyệt hoặc từ chối khách hàng đăng ký mới.
2. Vào **Orders** → kiểm tra đơn mới (trạng thái **Submitted**) → **Confirm & Push to SAP**.
3. Khi SAP có thay đổi giá / khuyến mãi / sản phẩm → bấm nút đồng bộ tương ứng (hoặc chờ đồng bộ tự động lúc 03:00, xem [mục 17](#17-vận-hành-cập-nhật-file-đồng-bộ-tự-động)).

---

## 4. Dashboard và Quick sync

**Dashboard** hiển thị các ô thống kê, bấm vào ô để đến trang tương ứng:

- **Pending customer requests** – số khách hàng đang chờ duyệt.
- **Approved customers** – số khách hàng đã duyệt.
- **Sellable category pairs** – số cặp nhóm hàng được phép bán.
- **Synced items** – số sản phẩm đã đồng bộ.
- **Price lists** – số bảng giá.
- **Orders** – tổng số đơn hàng.

Khung **Quick sync** có các nút đồng bộ theo yêu cầu:

| Nút | Tác dụng |
|---|---|
| **Sync SAP customers** | Cập nhật danh sách khách hàng từ SAP |
| **Sync items from SAP** | Cập nhật sản phẩm, giá, ảnh từ SAP |
| **Sync price lists from SAP** | Cập nhật bảng giá |
| **Sync contract discounts from SAP** | Cập nhật chiết khấu hợp đồng |
| **Sync promotion discounts from SAP** | Nhập khuyến mãi (xem [mục 13](#13-promotion-discounts--khuyến-mãi)) |

Lưu ý: **Customer Groups** và **Item Groups** đồng bộ trực tiếp từ SAP HANA ở trang riêng của mỗi mục (xem [mục 7](#7-customer-groups--nhóm-khách-hàng) và [mục 10](#10-item-groups--nhóm-hàng)) — không còn qua file Excel.

Sau khi bấm nút, nếu lỗi hệ thống hiển thị **mã lỗi và nội dung SAP trả về** ngay cạnh nút để bạn biết nguyên nhân.

---

## 5. Customers Approval – Duyệt khách hàng

Khách hàng tự đăng ký trên cổng sẽ ở trạng thái **Pending** cho đến khi admin xử lý.

**Bộ lọc:** **Pending**, **Approved**, **Rejected**, **All**.

**Các cột:** Customer Name, Email, Phone, Tax Code (MST), BP Code, BP Name, Group, Registered At, Status, Actions.

- **BP Code / BP Name / Group**: mã và tên đối tác trong SAP mà khách hàng đã liên kết khi đăng ký bằng MST. Đây là căn cứ để tính **bảng giá, chiết khấu và khuyến mãi** cho khách.

**Duyệt khách hàng**
1. Kiểm tra thông tin, đặc biệt **BP Code** có đúng đối tác không.
2. Bấm **✓ Approve** → xác nhận.
3. Hệ thống: chuyển trạng thái sang **Approved**, liên kết tài khoản (email) vào bản ghi khách hàng SAP và **gửi email thông báo** cho khách.

**Từ chối**
1. Bấm **✕ Reject**.
2. Nhập **lý do từ chối** (bắt buộc) → **Confirm Reject**.
3. Khách sẽ thấy thông báo bị từ chối kèm lý do khi đăng nhập.

**↻ Resync SAP** (hiện với khách đã có BP Code): đọc lại thông tin đối tác từ SAP (bảng giá, nhóm khách hàng) cho riêng khách đó. Dùng khi SAP vừa đổi bảng giá hoặc nhóm của khách.

> Nếu khách không có BP Code (không nhập MST hoặc không tìm thấy trong SAP), họ vẫn duyệt được nhưng **không có giá theo bảng giá riêng và không thể đẩy đơn lên SAP**. Cần bổ sung liên kết trước khi xác nhận đơn.

---

## 6. SAP Customers

Danh sách khách hàng lấy từ SAP (chỉ các nhóm khách hàng đang **Active** trong [Customer Groups](#7-customer-groups--nhóm-khách-hàng)).

- **Sync from SAP**: đồng bộ lại danh sách.
- Ô tìm kiếm: theo tên, **Card Code** hoặc **MST**.
- **Nhấp đúp** vào tiêu đề cột để sắp xếp.
- Các cột: Card Code, Name, MST, Group, Price List, Phone, Account (email tài khoản cổng đã liên kết), **Enable**.

**Khóa / mở khóa khách hàng:** bỏ tick cột **Enable** để chặn khách đăng nhập và đặt hàng. Khách bị khóa sẽ thấy thông báo:

> *This account was blocked, please contact Admin 0908404678 to enable account again.*

Tick lại **Enable** để mở khóa.

---

## 7. Customer Groups – Nhóm khách hàng

Nhóm khách hàng có **3 cấp** (Level 1 → 3). Trang này vừa để quản lý nhóm, vừa **quyết định phạm vi đồng bộ**: chỉ khách hàng thuộc các cặp (CusGrp01, CusGrp02) được liệt kê mới được kéo về.

**Cập nhật danh sách nhóm**
- **Sync from SAP (HANA)**: đồng bộ trực tiếp tên nhóm từ SAP HANA — cách duy nhất để cập nhật tự động.
- **Add Customer Group Manually**: chọn **Level**, nhập **Code** (bắt buộc), **Parent Code** (không bắt buộc), **Name** → thêm.
- Mỗi dòng có thể sửa (**Save** / **Cancel**).

**Cột Active – bật/tắt nhóm**
- Tắt **Active** → dừng đồng bộ khách hàng thuộc nhóm đó.
- Nhóm khách hàng **lan truyền hai chiều**:
  - Tắt nhóm cha → tất cả nhóm con bị tắt, ghi chú **(parent off)**.
  - Bật lại nhóm cha → các nhóm con cũng được bật lại.

---

## 8. Catalog Visibility – Ẩn/hiện hàng hóa theo khách hàng

Mặc định **mọi khách hàng thấy mọi sản phẩm**. Trang này cho phép **ẩn** (hoặc hiện) một nhóm hàng đối với một nhóm khách hàng.

**Thêm quy tắc (Add Visibility Rule)**
1. Chọn **Customer Group**.
2. Chọn **Item Group**.
3. Chọn **Visibility**: **✓ Visible** hoặc **✕ Hidden**.
4. Thêm quy tắc. Bấm vào biểu tượng trạng thái trong danh sách để đảo ẩn/hiện, hoặc xóa quy tắc (hỏi xác nhận).

**Nguyên tắc**
- Quy tắc **kế thừa xuống dưới**: áp dụng cho nhóm khách hàng đó cùng mọi nhóm con, và cho nhóm hàng đó cùng mọi nhóm hàng con và sản phẩm bên dưới.
- Chỉ **ẩn**, không cấp thêm quyền: nếu không có quy tắc nào → khách vẫn thấy tất cả.
- Hiện chỉ điều khiển được **nhóm hàng cấp 1 đến 3**.

**Per-customer Override – ngoại lệ cho từng khách**
- Nhập **ID người dùng** của khách (lấy ở trang Customers) → **Look up** → chỉnh → **Save overrides**.
- Ngoại lệ theo từng khách **luôn thắng** quy tắc theo nhóm.

---

## 9. Items – Sản phẩm

Danh sách sản phẩm đã đồng bộ từ SAP.

- **Sync from SAP**: đồng bộ sản phẩm (có thể mất khoảng một phút).
- Tìm theo tên hoặc mã; **nhấp đúp** tiêu đề cột để sắp xếp.
- Các cột: **Item Code**, **Name**, **Item Group** (hiển thị chuỗi nhóm, ví dụ `D1 / D11 / D111`), **Base Price**, **Visible**.
- **Visible**: công tắc ẩn/hiện **từng sản phẩm** trên cửa hàng, không ảnh hưởng nhóm hàng. Lựa chọn này **được giữ nguyên qua các lần đồng bộ**.

**Ảnh sản phẩm:** ảnh lấy từ trường **`U_ImageURL`** trong SAP Item Master (một đường dẫn đầy đủ `https://...`). Sau khi đồng bộ, ảnh hiển thị trên thẻ sản phẩm; sản phẩm chưa có ảnh hiển thị biểu tượng 📦.

**Điều kiện để một sản phẩm được đồng bộ:** thuộc nhóm hàng đang **Active** (xem mục 10) và còn hiệu lực (Valid) trong SAP. Sản phẩm không còn thuộc phạm vi sẽ bị đánh dấu không hoạt động, **không bị xóa**.

---

## 10. Item Groups – Nhóm hàng

Nhóm hàng có **6 cấp** (Level 1 → 6). Cấp 2 đóng vai trò "cổng bán hàng": chỉ sản phẩm thuộc các cặp (ItemCat01, ItemCat02) được liệt kê mới được đồng bộ.

**Cập nhật danh sách nhóm**
- **Import from SAP_Item_Group**: nhập từ file `SAP_Item_Group.xlsx`. Import lại sau khi cập nhật file.
- **Add Item Group Manually**: chọn **Level**, nhập **Code**, **Parent Code**, **Name**.

**Bật/tắt nhóm hàng (cột Active)**
- Tắt **Active** → không đồng bộ sản phẩm thuộc nhóm; sản phẩm đã có được đánh dấu **không hoạt động** (không xóa).
- Quy tắc cha – con:
  - Nhóm cha **tắt** → nhóm con tự động bị tắt, ghi chú **(parent off)**.
  - Nhóm cha **bật lại** → nhóm con **không tự bật lại**; phải bật từng nhóm con (khác với Customer Groups).
- **Chọn nhiều rồi lưu một lần**: thao tác bật/tắt chỉ ở dạng **chờ lưu** (đánh dấu *Staged*). Sau khi chọn xong, bấm **Save Changes** để áp dụng tất cả.
- **Select All / Select None** (bên phải tiêu đề mỗi cấp): chọn / bỏ chọn nhanh toàn bộ nhóm ở cấp đó và mọi nhóm bên dưới.

---

## 11. Price Lists – Bảng giá

- **Sync from SAP**: đồng bộ các bảng giá và giá từng sản phẩm.
- Tick đúng **một** bảng là **Base** – bảng giá gốc, dùng để hiển thị **giá gạch ngang**.
- Tick các bảng là **Channel** – bảng giá theo kênh, được gán cho khách hàng. Khách thuộc bảng nào thì thấy giá của bảng đó.
- Nút **Show active only / Show all synced price lists** để lọc các bảng đã đánh dấu.
- Phần **Price List Details** xem giá từng sản phẩm của một bảng giá: **Base Price List** (bảng giá nguồn mà SAP dùng để suy ra giá), **Factor** (hệ số), **Base Price** và **Price** (= Base Price × Factor, do SAP tính sẵn).

---

## 12. Contract Discounts – Chiết khấu hợp đồng

Hiển thị các **thỏa thuận chiết khấu** từ SAP (CBD): một khách hàng (cụ thể hoặc theo nhóm khách hàng cấp 1–3) được giảm **%** cho sản phẩm (cụ thể hoặc theo nhóm hàng cấp 1–6).

- **Sync agreements from SAP**: đồng bộ các thỏa thuận.
- Bộ lọc: theo mã khách hàng (CardCode hoặc mã nhóm), **Valid date** (ngày hiệu lực).
- Các cột: Doc #, Customer Target, Item Target, Discount %, Valid, Status.
- Phần **Resolved Prices (SpecialPrices)**: nhập **SAP card code** → **Search** để xem giá cụ thể SAP đã tính cho khách; **Sync this customer** để đồng bộ riêng khách đó.

---

## 13. Promotion Discounts – Khuyến mãi

Hiển thị khuyến mãi từ chương trình SAP Promotion Program. Mỗi dòng gắn một chương trình với **đối tượng khách hàng** (BP hoặc nhóm BP) và **hàng bán** (sản phẩm hoặc nhóm hàng), kèm **giảm %** hoặc **tặng hàng**.

- **Sync promotion discounts from SAP (HANA)**: đồng bộ trực tiếp từ SAP HANA (không còn qua file Excel) — đây là cách duy nhất để cập nhật dữ liệu khuyến mãi.
- Bộ lọc: tìm theo **Promotion Code / Name**; **BP code or name**; **item code or name**; **Disc Type** (**Discount Pct** hoặc **Free Item**); **Active only**; **Valid date**.

**Ý nghĩa các cột**

| Cột | Ý nghĩa |
|---|---|
| Promotion | Mã / tên chương trình |
| BP Target | Đối tượng áp dụng: một mã BP hoặc một nhóm BP |
| Disc Type | **Discount** (giảm %) hoặc **Free Item** (mua tặng) |
| Selling Item | Sản phẩm hoặc nhóm hàng được khuyến mãi |
| Discount | % giảm |
| BuyQty | Số lượng mua để được tặng |
| Free/Bonus Item | Hàng tặng |
| GiveQty | Số lượng tặng |
| Valid | Thời gian hiệu lực |
| Status | Đang hiệu lực hay không |

Loại đối tượng của mỗi dòng được xác định bởi hai cột kỹ thuật: `bp_type` (`2` = mã BP cụ thể, `CG1`–`CG3` = nhóm khách hàng cấp 1–3) và `it_type` (`4` = mã sản phẩm cụ thể, `IC1`–`IC6` = nhóm hàng cấp 1–6). Dòng không có đối tượng khách hàng thì **áp dụng cho mọi khách hàng**.

---

## 14. Orders – Xử lý đơn hàng

### 14.1. Danh sách đơn

- Bộ lọc trạng thái: **All, Submitted, Processing, SAP Draft Created, Approved, Completed, Rejected**.
- Các cột: **Order #**, **Customer**, **Total**, **SAP Doc #**, **Status**, **Created**.
- Mã đơn có dạng `SO-{Mã BP}-{yymmdd}-{3 số ngẫu nhiên}`, ví dụ `SO-GTSO0701-260919-684`.

### 14.2. Chi tiết đơn và đẩy lên SAP

Bấm vào đơn để xem: khách hàng, địa chỉ, điện thoại, ghi chú và các dòng hàng (**Item, Quantity, Base Unit Price, Unit Price, Discount %, Line Total**), cùng phần **Subtotal, Discount, Total**. Mọi số tiền được làm tròn đến đơn vị đồng.

Dòng hàng tặng (khuyến mãi mua – tặng) có đơn giá **0**.

**Quy trình xử lý**
1. Đơn mới có trạng thái **Submitted** (khách chờ xác nhận).
2. Kiểm tra nội dung. Nếu thấy cảnh báo *"This customer has no linked SAP BP code"* thì cần bổ sung BP Code trước.
3. Bấm **Confirm & Push to SAP**. Hệ thống tạo **Draft Sales Order** trong SAP và chuyển đơn sang **SAP Draft Created**, hiển thị **SAP Doc #**.
4. Khi đã lên SAP, tiếp tục cập nhật trạng thái theo tiến độ thực tế.

> **Lưu ý:** Khi đẩy lên SAP, hệ thống chỉ gửi **mã hàng, số lượng và đơn giá gốc (Base Unit Price)**. **Không gửi %chiết khấu và đơn giá sau chiết khấu** – SAP B1 tự xử lý cấu trúc giá theo cấu hình của SAP.

Nếu đẩy lỗi, thông báo hiển thị mã lỗi và nội dung SAP trả về bên cạnh nút để xử lý.

### 14.3. Đổi trạng thái đơn

Dùng danh sách chọn cạnh nhãn trạng thái để đổi thủ công.

| Admin thấy | Khách hàng thấy (tiếng Việt) |
|---|---|
| Draft | Nháp |
| Submitted | Chờ xác nhận |
| Processing | Đang xử lý |
| SAP Draft Created | Đã đẩy lên SAP |
| Approved | Đã xác nhận |
| Rejected | Từ chối |
| Completed | Hoàn thành |

Mỗi lần đổi trạng thái được **ghi kèm thời gian** vào lịch sử. Khách hàng thấy lịch sử này khi bấm vào nhãn trạng thái trong **Đơn hàng của tôi**.

---

## 15. Admin Users và Admin Roles – Phân quyền

### Admin Roles
- Mở form tạo vai trò, nhập **Role name**, **Description** (không bắt buộc), bấm chọn các mục menu mà vai trò được phép truy cập → **Create role**.
- Với vai trò đã có, bấm vào từng mục quyền trong danh sách để bật/tắt quyền đó.
- Quyền được cấp theo **cả mục menu** (không chia nhỏ theo từng hành động).
- Có thể xóa vai trò (hỏi xác nhận).

### Admin Users
- **Admin Users** liệt kê các tài khoản bổ sung, ngoài Super-admin khai báo trong cấu hình.
- Tạo mới: nhập **Full name, Email, Password**, chọn **Role** → **Create admin user**. Cả bốn trường đều bắt buộc.
- Cột **Active**: bật/tắt tài khoản. Có thể **Delete** (hỏi xác nhận).

---

## 16. Cách hệ thống tính giá cho khách hàng

Giá mỗi khách thấy được tính theo thứ tự, mỗi bước **tính tiếp trên kết quả bước trước**:

1. **Giá gốc trước chiết khấu**: giá của **bảng giá (Channel)** gán cho khách; nếu không có thì dùng **giá cơ bản của sản phẩm**. Đây là **giá gạch ngang** hiển thị cho khách.
2. **Chiết khấu hợp đồng** (Contract Discounts).
3. **Chiết khấu khuyến mãi** (Promotion Discounts).

**Quy tắc khớp đối tượng**

| | Có thể khớp theo |
|---|---|
| Khách hàng | Mã BP, hoặc nhóm khách hàng cấp 1, 2, 3 |
| Sản phẩm | Mã sản phẩm, hoặc nhóm hàng cấp 1 đến 6 |

- Đối tượng **càng cụ thể càng được ưu tiên**: mã BP hơn nhóm cấp 3, hơn cấp 2, hơn cấp 1; mã sản phẩm hơn nhóm cấp 6, … hơn cấp 1.
- Chỉ áp dụng chương trình **còn hiệu lực** (trong khoảng ngày bắt đầu – kết thúc).
- Áp dụng cho nhóm cha thì **mọi nhóm con và sản phẩm bên dưới cũng được áp dụng** (ví dụ khuyến mãi cho nhóm BP `GTSO` áp dụng cho mọi BP thuộc `GTSO`).
- Giá cuối cùng hiển thị trên cửa hàng được **làm tròn đến đơn vị đồng**.
- Khuyến mãi **mua – tặng** hiển thị thành một dòng riêng dưới giá của sản phẩm.

---

## 17. Vận hành, cập nhật file, đồng bộ tự động

### Đồng bộ tự động hằng ngày
Hệ thống có tác vụ đồng bộ chạy **lúc 03:00** mỗi ngày (khách hàng, sản phẩm, bảng giá, chiết khấu hợp đồng). Khi chạy bằng Docker, bật bằng:

```bash
docker compose --profile sync up -d
```

Chạy ngay một lần: `docker compose run --rm daily-sync node scripts/daily-sync.mjs`.

Bước **Promotions** trong tác vụ tự động đồng bộ trực tiếp từ SAP HANA (không còn phụ thuộc file Excel) — xem [mục 13](#13-promotion-discounts--khuyến-mãi).

### Các file dữ liệu cần cập nhật thủ công
Nằm ở thư mục gốc của ứng dụng: `SAP_Customer_Group.xlsx`, `SAP_Item_Group.xlsx`, `itemgroup.json`, `custgroup.json`. Sau khi thay file, vào trang tương ứng bấm **Import**. Khi chạy trong Docker, các file này được đóng gói vào ảnh (image) lúc build, nên sau khi thay file cần chạy lại `docker compose up -d --build`.

### Cấu hình
- `config.json`: thông tin kết nối MySQL, SAP, email, tài khoản Super-admin và `admin.companyPrefix` (tiền tố hiển thị trước tên cổng, ví dụ **IMV**).
- `.env`: mật khẩu (đã mã hóa).
- Không chia sẻ các file này ra ngoài.

---

## 18. Sự cố thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Khách không thấy sản phẩm | Nhóm hàng đang **Inactive**; sản phẩm bị tắt **Visible**; bị **Catalog Visibility** ẩn | Kiểm tra Item Groups, Items, Catalog Visibility |
| Khách không thấy khuyến mãi hoặc giá sai | Chưa đồng bộ; khách chưa có BP Code; khuyến mãi hết hạn; bảng giá chưa gán | **↻ Resync SAP** cho khách; kiểm tra Promotion Discounts và Price Lists; đồng bộ lại |
| Bấm **Confirm & Push to SAP** báo lỗi | Khách không có BP Code; SAP từ chối dữ liệu | Đọc nội dung lỗi hiển thị cạnh nút; bổ sung BP Code |
| Khách báo tài khoản bị khóa | Đã bỏ tick **Enable** ở SAP Customers | Tick lại **Enable** |
| Khách không đăng nhập được, báo chờ duyệt | Chưa duyệt | Duyệt ở Customers Approval |
| Đồng bộ báo lỗi kết nối SAP | Mất mạng tới SAP hoặc tài khoản SAP thiếu quyền | Xem nội dung lỗi; kiểm tra mạng và tài khoản SAP |
| Đồng bộ sản phẩm nhưng ảnh trống | Trường `U_ImageURL` trong SAP chưa có giá trị, hoặc SAP chưa nhận trường này | Điền `U_ImageURL` cho sản phẩm; đồng bộ lại |
| Mất phiên đăng nhập liên tục | Hết 8 giờ, hoặc cookie bị chặn | Đăng nhập lại |

**Liên hệ hỗ trợ khách hàng bị khóa:** 0908404678.
