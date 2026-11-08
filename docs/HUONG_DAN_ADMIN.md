# Hướng dẫn sử dụng – Dành cho Người dùng Quản trị

**Cổng Đặt Hàng – IMV**

Tài liệu dành cho nhân viên quản trị: duyệt khách hàng, tạo và xử lý đơn hàng, đẩy đơn lên SAP Business One, xem tồn kho, quản lý dữ liệu đồng bộ từ SAP và phân quyền.

Địa chỉ truy cập: **https://order.imv.com.vn/vi/admin**

> Giao diện quản trị hiển thị bằng **tiếng Anh**. Tài liệu giữ nguyên tên menu, nút bấm tiếng Anh (in **đậm**) và giải thích bằng tiếng Việt.

---

## Mục lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Đăng nhập, tài khoản và menu](#2-đăng-nhập-tài-khoản-và-menu)
3. [Thiết lập lần đầu và công việc hằng ngày](#3-thiết-lập-lần-đầu-và-công-việc-hằng-ngày)
4. [Dashboard và đồng bộ nhanh](#4-dashboard-và-đồng-bộ-nhanh)
5. [Duyệt khách hàng – Customer Approval](#5-duyệt-khách-hàng--customer-approval)
6. [Danh sách đơn hàng và tạo đơn thay khách – Self create](#6-danh-sách-đơn-hàng-và-tạo-đơn-thay-khách--self-create)
7. [Xử lý một đơn hàng và đẩy lên SAP](#7-xử-lý-một-đơn-hàng-và-đẩy-lên-sap)
8. [Tồn kho – Inventory](#8-tồn-kho--inventory)
9. [Dữ liệu gốc – Master Data](#9-dữ-liệu-gốc--master-data)
10. [Giá, chiết khấu và khuyến mãi](#10-giá-chiết-khấu-và-khuyến-mãi)
11. [Cài đặt – Settings](#11-cài-đặt--settings)
12. [Sự cố thường gặp](#12-sự-cố-thường-gặp)
13. [Ghi chú vận hành cho bộ phận IT](#13-ghi-chú-vận-hành-cho-bộ-phận-it)

---

## 1. Tổng quan hệ thống

Cổng Đặt Hàng là nơi khách hàng (đại lý, nhà phân phối) tự đặt hàng, và nơi nhân viên quản trị kiểm tra rồi đẩy đơn vào **SAP Business One**. Nhân viên cũng có thể **tạo đơn thay khách hàng**, giúp tiết kiệm giấy phép người dùng SAP.

| Bước | Diễn biến |
|---|---|
| 1. Tạo đơn | Khách đặt trên cổng, hoặc admin tạo đơn thay khách (**Self create**) |
| 2. Chờ xác nhận | Đơn lưu trên cổng với trạng thái **Submitted** |
| 3. Kiểm tra | Admin kiểm tra tồn kho, điều chỉnh số lượng xác nhận, trao đổi với khách |
| 4. Đẩy lên SAP | **Confirm & Push to SAP** tạo Draft hoặc Sales Order trong SAP |
| 5. Theo dõi | Số chứng từ, số SO trong SAP và trạng thái đơn |

- **Dữ liệu lấy từ SAP:** khách hàng (kèm địa chỉ và Sales Supervisor), nhóm khách hàng, nhóm hàng, sản phẩm, kho, tồn kho, bảng giá, chiết khấu kỳ, chiết khấu hợp đồng, khuyến mãi. Dữ liệu được đồng bộ theo lịch hoặc khi bấm nút đồng bộ.
- **Múi giờ:** giờ Việt Nam (UTC+7).

---

## 2. Đăng nhập, tài khoản và menu

1. Mở **https://order.imv.com.vn/vi/admin**, nhập email quản trị và mật khẩu, bấm **Đăng nhập**.
2. Phiên đăng nhập có hiệu lực **8 giờ**.
3. Đổi mật khẩu của mình tại **Settings → My Profile**.

| Loại tài khoản | Quyền |
|---|---|
| **Root** (Super Admin) | Toàn quyền: thấy mọi khách hàng, mọi kho trong danh sách kho của công ty và các mục chỉ dành cho Root |
| **Admin user** | Chỉ thấy các menu được vai trò (Role) cho phép; chỉ thấy khách hàng thuộc nhóm khách được gán, nhóm hàng được gán và **kho được gán** (xem mục 11.4) |

**Bản đồ menu**

| Nhóm menu | Mục | Dùng để |
|---|---|---|
| Dashboard | Dashboard | Số liệu tổng quan, đồng bộ nhanh |
| Customer Approval | Customer Approval | Duyệt, từ chối, tạo khách hàng trong SAP |
| Orders | Orders | Tạo, xử lý, đẩy đơn lên SAP |
| Inventory | Inventory | Tồn kho trực tiếp từ SAP, kèm % hạn sử dụng còn lại |
| Master Data | Customer Groups, SAP Customers, Item Groups, Items, Warehouses | Dữ liệu gốc đồng bộ từ SAP |
| Price & Discount | Price Lists, Contract Discount, Promotion Discount | Bảng giá, chiết khấu, khuyến mãi |
| Settings | My Profile, Catalog Visibility | Đổi mật khẩu; ẩn/hiện hàng và kho cho khách hàng |
| Settings (chỉ Root) | SAP Sync Config, Reset the Id, Admin Roles, Admin Users, Audit Logs | Lịch đồng bộ, cách đẩy đơn, bảo trì, phân quyền, nhật ký |

> **Biểu tượng chuông** ở góc phải trên cùng báo tin nhắn mới của khách trong các đơn hàng. Bấm vào để mở thẳng đơn đó.

---

## 3. Thiết lập lần đầu và công việc hằng ngày

### 3.1. Thiết lập lần đầu (làm theo thứ tự)

1. **Customer Groups** → **Sync from SAP (HANA)**, bật **Active** cho các nhóm khách cần bán.
2. **Item Groups** → đồng bộ, bật **Active** cho các nhóm hàng cần bán, bấm **Save Changes**.
3. **Price Lists** → đồng bộ, đánh dấu đúng một bảng **Base** và các bảng **Channel**.
4. **SAP Customers** → **Sync from SAP** (lấy cả địa chỉ và Sales Supervisor).
5. **Items** → **Sync from SAP**.
6. **Warehouses** → đồng bộ kho và tồn kho, đánh dấu kho **Included**.
7. **Contract Discount** và **Promotion Discount** → đồng bộ.
8. **Admin Roles**, **Admin Users** → tạo vai trò, tài khoản; gán nhóm khách, nhóm hàng và kho.
9. **SAP Sync Config** → đặt lịch đồng bộ tự động và cách đẩy đơn.

### 3.2. Công việc hằng ngày

- **Customer Approval:** duyệt khách hàng mới.
- **Orders:** xử lý đơn **Submitted**, trả lời tin nhắn, đẩy đơn lên SAP; tạo đơn thay khách khi cần.
- **Đồng bộ:** khi SAP thay đổi giá, khuyến mãi hoặc sản phẩm, bấm đồng bộ hoặc chờ lịch tự động.

---

## 4. Dashboard và đồng bộ nhanh

Dashboard hiển thị các ô số liệu (bấm vào để mở trang tương ứng): khách chờ duyệt, khách đã duyệt, cặp nhóm hàng được bán, số sản phẩm đã đồng bộ, số bảng giá, số đơn hàng.

Khung **Quick sync** có các nút đồng bộ theo yêu cầu: **Sync SAP customers**, **Sync items from SAP**, **Sync price lists from SAP**, **Sync period discounts from SAP**, **Sync contract discounts from SAP**. Nếu lỗi, nội dung lỗi SAP trả về hiện ngay cạnh nút.

> **Chỉ đồng bộ chương trình đang hiệu lực:** chiết khấu hợp đồng và khuyến mãi chỉ lấy các chương trình **có hiệu lực hôm nay**. Chương trình bắt đầu từ ngày mai sẽ xuất hiện sau lần đồng bộ đầu tiên vào ngày bắt đầu.

---

## 5. Duyệt khách hàng – Customer Approval

Khách tự đăng ký trên cổng ở trạng thái **Pending**. Bộ lọc: **Pending**, **Approved**, **Rejected**, **All**.

### 5.1. Khách đã có trong SAP (tìm thấy MST)

1. Kiểm tra **BP Code / BP Name / Group**: đối tác SAP khách đã liên kết. Đây là căn cứ tính giá, chiết khấu, khuyến mãi.
2. Bấm **✓ Approve**. Hệ thống liên kết tài khoản với khách SAP và gửi email báo cho khách.

### 5.2. Khách mới (chưa có trong SAP)

1. Bấm **Create in SAP & Approve**.
2. Kiểm tra và hoàn thiện: **Name**, **MST**, **Customer Group 3**, **Price List**, **Billing Address** (bắt buộc), **Shipping Address** (để trống = giống địa chỉ xuất hóa đơn), người liên hệ, điện thoại, email, tiền tệ, ghi chú.
3. Bấm **Create & Approve**: hệ thống tạo Business Partner trong SAP rồi duyệt tài khoản.

### 5.3. Các thao tác khác

- **✕ Reject:** nhập lý do (bắt buộc). Khách thấy lý do khi đăng nhập.
- **↻ Resync SAP:** đọc lại bảng giá và nhóm khách của riêng khách đó sau khi SAP thay đổi.

---

## 6. Danh sách đơn hàng và tạo đơn thay khách – Self create

### 6.1. Danh sách đơn

- **Lọc theo:** thương hiệu, khách hàng (mã hoặc tên), **Doc No** (mã đơn trên cổng hoặc SAP) và trạng thái.
- **Các cột:** Brand, Order #, Cust Code, Cust Name, Total, SAP Doc #, SAP SO #, Status, Created.
- **Mã đơn** có dạng `SO-{Mã khách}-{yymmdd}-{3 số}`, ví dụ `SO-GTSO0701-261027-771`.

### 6.2. Tạo đơn thay khách hàng – nút ＋ Self create

Nút nằm sau ô tìm **Doc No**. Dùng để nhập đơn cho khách hàng hoặc nhà phân phối không tự đặt trên cổng. Giá và khuyến mãi trong hộp thoại **giống hệt** giá khách thấy trên cổng.

```
+- Create sales order 
| Customer  [ma / ten / MST  v]     Warehouse [1001 v]  Supervisor [   v]
| Bill to   [GTSO0701_001 v]         Ship to   [GTSO0701_001 v]
+------------------------------------------------------------------------
| [+ Add item: go ma hoac ten, Enter]
| Code  Name (2 dong...) Avail Qty UoM  Base STD% CT% PM%  Unit  Total
|       [% GT260100024 - 30% v]   [Qua: Buy 1 get 1 - D72306101 v]
|  L Gift ...                  24  Cai   0                        0
+------------------------------------------------------------------------
| Remark [..............]          Subtotal / Discount / Total
|                                           [Cancel]  [Create order]
+------------------------------------------------------------------------
```

1. **Customer:** gõ mã, tên hoặc MST rồi chọn. Chỉ hiện khách thuộc nhóm khách được gán cho bạn; khách bị khóa hiện nhưng không chọn được. Bên dưới cho biết bảng giá, nhóm khách và khách có tài khoản cổng hay không.
2. **Bill to / Ship to:** tự chọn địa chỉ mặc định trong SAP; có thể đổi sang địa chỉ khác của khách. Địa chỉ đầy đủ hiện ngay dưới ô chọn.
3. **Warehouse:** chỉ các **kho được gán cho bạn**. Đổi kho sẽ cập nhật lại Avail Qty và giá.
4. **Sales supervisor:** tự chọn theo mặc định của khách trong SAP (nếu có), có thể đổi.
5. **Thêm hàng:** gõ mã hoặc tên, **Enter** thêm mặt hàng đang chọn và chuyển con trỏ vào ô **Qty**; Enter trong ô Qty quay lại ô tìm hàng. Thêm lại cùng mặt hàng sẽ tăng số lượng.
6. **Khuyến mãi:** nhãn 🏷 (chiết khấu %) và 🎁 (tặng hàng) nằm dưới tên hàng. Khi có nhiều chương trình, bấm vào nhãn để chọn; danh sách hiện tên đầy đủ của từng chương trình. Dòng quà tặng tự tính, hiện thụt vào, giá 0.
7. **Tên hàng dài** hiện tối đa 2 dòng; rê chuột để xem đầy đủ hoặc bấm vào tên để mở rộng.
8. Nhập **Remark** (gửi lên SAP thành Comments), xem Subtotal / Discount / Total, bấm **Create order**.

> **Kiểm tra trước khi tạo:** số lượng vượt Avail Qty hiện màu đỏ và hệ thống hỏi xác nhận khi tạo. Đơn có hàng nhiều thương hiệu được **tách thành nhiều đơn**, mỗi đơn một thương hiệu (nút đổi thành *Create N orders*). Esc hoặc bấm ra ngoài sẽ hỏi trước khi bỏ đơn đang nhập.

Sau khi tạo, hộp thoại hiện liên kết tới đơn mới (trạng thái **Submitted**). Đơn đi theo quy trình duyệt bình thường ở mục 7. Nếu khách có tài khoản cổng, khách cũng thấy đơn trong *Đơn hàng của tôi*.

---

## 7. Xử lý một đơn hàng và đẩy lên SAP

### 7.1. Thông tin trên trang đơn

- **Đầu đơn:** địa chỉ giao (Ship to), xuất hóa đơn (Bill to), điện thoại, Sales supervisor, ghi chú, người tạo (với đơn Self create).
- **Dòng hàng:** Item Code, Item Name, **Avail Qty**, Qty, **Cfm Qty**, UoM, Base Price, STD / CT / PM Disc %, Unit Price, Line Total. Dòng quà tặng giá 0.
- **Messages:** trao đổi với khách ngay trong đơn.

### 7.2. Các bước xử lý

1. Chọn **Warehouse** (chỉ các kho được gán cho bạn) và bấm **Get Stock** để lấy tồn kho trực tiếp từ SAP. Avail Qty xanh = đủ hàng, đỏ = thiếu.
2. Nếu thiếu hàng, sửa **Cfm Qty** (số lượng xác nhận). Quà tặng tự tính lại theo tỷ lệ chương trình. **Line Total, Discount và Total** của đơn được tính lại theo Cfm Qty.
3. Dòng có Cfm Qty khác Qty cần khách **Đồng ý / Từ chối** trên trang đơn của họ. Dòng khách từ chối không được đẩy lên SAP và tính là 0.
4. Bấm **Confirm & Push to SAP**. Ngay trước khi đẩy, hệ thống kiểm tra lại tồn kho thực tế và tự giảm Cfm Qty nếu kho không đủ.
5. Thành công: đơn nhận **SAP Doc #** và đổi trạng thái theo **Post SO Mode** (Draft → **SAP Draft Created**; Sales Order → **Approved**). Nếu lỗi, nội dung lỗi SAP hiện cạnh nút.
6. Cập nhật trạng thái theo tiến độ bằng ô chọn cạnh nhãn trạng thái; mỗi lần đổi được ghi lại kèm thời gian.

### 7.3. Dữ liệu gửi lên SAP

| Trường | Giá trị |
|---|---|
| Khách hàng, kho, ghi chú | Mã khách (CardCode), kho đã chọn trên mỗi dòng, Remark → Comments |
| PayToCode / ShipToCode | Địa chỉ chọn khi Self create (đơn từ cổng dùng mặc định của khách) |
| U_CusSEL04 | Sales Supervisor (khi có chọn) |
| Dòng hàng: Dscription, U_INVDesc | Tên hàng trong SAP; U_INVDesc giống Dscription |
| Dòng quà tặng: U_INVDesc | Tên hàng + *- HÀNG KHUYẾN MÃI KHÔNG THU TIỀN* |
| Dòng quà tặng: U_CTKM, U_CTKM_NAME | Mã và tên chương trình tặng hàng đã chọn |
| Dòng CK…98 / CK…99 | Chiết khấu hợp đồng / chiết khấu khuyến mãi (CK…99 có U_CTKM) |

### 7.4. Nhân bản và hủy đơn

- **⧉ Duplicate:** mở hộp thoại tạo đơn, điền sẵn khách, địa chỉ, kho, supervisor, ghi chú và các mặt hàng của đơn hiện tại, với giá **hôm nay**. Sửa nếu cần rồi bấm **Create order**. Những gì không sao chép được nguyên vẹn (hết khuyến mãi, hết hàng…) được liệt kê ở cuối hộp thoại.
- **Cancel Order:** hủy đơn (và bản nháp SAP nếu có). Không hủy được khi đơn đã là Sales Order chính thức trong SAP.

### 7.5. Trạng thái đơn

| Admin thấy | Khách thấy |
|---|---|
| Submitted | Chờ xác nhận |
| Processing | Đang xử lý |
| SAP Draft Created | Đã đẩy lên SAP |
| Approved | Đã xác nhận |
| Completed | Hoàn thành |
| Rejected | Từ chối |
| Cancelled | Bạn đã hủy |

---

## 8. Tồn kho – Inventory

Tồn kho đọc trực tiếp từ SAP: **OnHand**, **Committed** (đơn bán đang mở + yêu cầu chuyển kho + lệnh sản xuất) và **Available**.

- **Chọn kho:** ô **🏭 All warehouses** cho phép chọn một hoặc nhiều kho; mặc định chọn tất cả kho của bạn (Root: tất cả kho của công ty). Luôn phải có ít nhất một kho được chọn.
- **Cột Warehouse:** mỗi mặt hàng hiện một dòng cho mỗi kho; rê chuột để xem tên kho.
- **Cột Shelf life %** (trước OnHand): % hạn sử dụng còn lại của **lô thấp nhất**. Đỏ dưới 33%, cam dưới 66%, xanh từ 66% trở lên. Số trong ngoặc là số lô; rê chuột để xem từng lô và số lượng. *—* = không có lô ghi ngày.
- Tìm theo mã hoặc tên hàng; mỗi trang 50 dòng.

> **Tốc độ:** chọn tất cả kho có thể mất khoảng 10 giây. Chọn ít kho hơn để xem nhanh hơn.

---

## 9. Dữ liệu gốc – Master Data

- **Customer Groups:** nhóm khách 3 cấp. Chỉ khách thuộc nhóm **Active** mới được đồng bộ. Tắt nhóm cha thì nhóm con tắt theo; bật lại nhóm cha thì nhóm con bật lại.
- **SAP Customers:** danh sách khách hàng từ SAP; tìm theo tên, Card Code, MST. Đồng bộ cũng lấy **địa chỉ xuất hóa đơn / giao hàng**, địa chỉ mặc định và **Sales Supervisor** dùng trong Self create. Bỏ tích **Enable** để khóa khách (không đăng nhập, không đặt hàng); tích lại để mở.
- **Item Groups:** nhóm hàng 6 cấp. Bật/tắt **Active** chỉ là thay đổi chờ lưu; bấm **Save Changes** để áp dụng. Bật lại nhóm cha thì phải bật từng nhóm con.
- **Items:** sản phẩm đã đồng bộ. Công tắc **Visible** ẩn/hiện từng sản phẩm, giữ nguyên qua các lần đồng bộ. Ảnh lấy từ trường `U_ImageURL` trong SAP.
- **Warehouses:** đồng bộ kho và tồn kho. Đánh dấu **Included** các kho được tính tồn cho khách. **Check Item Stock** xem tồn một mã hàng theo từng kho, kèm % hạn sử dụng.

---

## 10. Giá, chiết khấu và khuyến mãi

- **Price Lists:** đánh dấu đúng một bảng **Base** và các bảng **Channel** (bảng giá theo kênh gán cho khách).
- **Contract Discount:** thỏa thuận chiết khấu % theo khách / nhóm khách và sản phẩm / nhóm hàng. Chỉ thỏa thuận **có hiệu lực hôm nay** được đồng bộ.
- **Promotion Discount:** chương trình khuyến mãi từ SAP: **Discount** (giảm %) hoặc **Free Item** (mua X tặng Y). Chỉ chương trình **có hiệu lực hôm nay** được đồng bộ.

**Cách tính giá cho khách**

1. **Giá kênh:** giá trong bảng Channel của khách (hoặc giá cơ bản).
2. **Base Price** = Giá kênh − chiết khấu kỳ (STD Disc %).
3. **Unit Price** = Base Price × (1 − (CT Disc % + PM Disc %) / 100), làm tròn đến đồng.

Khi khớp chương trình, mục cụ thể hơn được ưu tiên (mã khách hơn nhóm khách; mã hàng hơn nhóm hàng). Khi một sản phẩm có nhiều chương trình cùng lúc, khách (hoặc admin trong Self create) được chọn chương trình, và lựa chọn đó được giữ khi đẩy lên SAP.

---

## 11. Cài đặt – Settings

### 11.1. Catalog Visibility

- **Quy tắc ẩn/hiện:** mặc định khách thấy mọi sản phẩm. Thêm quy tắc (Customer Group + Item Group + **Visible** / **Hidden**) để ẩn một nhóm hàng với một nhóm khách; quy tắc áp dụng xuống mọi nhóm con.
- **Warehouse Visibility:** gán kho cho từng nhóm khách cấp 2. Khách chỉ thấy tồn kho của các kho này. Đây là quy tắc **chỉ dành cho khách hàng**; kho của admin được gán riêng ở Admin Users.

### 11.2. SAP Sync Config (chỉ Root)

- **Post SO Mode:** **Draft** (mặc định, tạo bản nháp, người dùng SAP duyệt thành Sales Order) hoặc **Sales Order** (tạo thẳng Sales Order, đơn chuyển ngay sang Approved).
- **SAP Sync Schedule:** bật đồng bộ tự động mỗi N giờ, bấm **Save**; **Run now** chạy ngay; **Last run** cho biết kết quả lần gần nhất. Lịch mới có hiệu lực sau khi khởi động lại máy chủ.

### 11.3. Reset the Id (chỉ Root)

Đánh số lại cột **id** của các bảng dữ liệu đồng bộ và bảng nhóm (về 1..N), giữ nguyên liên kết cha–con. Mỗi bảng hiện số dòng, id lớn nhất và % dải id đã dùng. Không chạy được khi có đồng bộ đang chạy trên bảng đó. Mọi lần chạy được ghi vào Audit Logs.

> Sau khi reset **Customer Groups** hoặc **Item Groups**, các admin khác nên tải lại các trang quản trị đang mở có chỉnh sửa nhóm.

### 11.4. Admin Roles và Admin Users (chỉ Root)

- **Admin Roles:** tạo vai trò và chọn các mục menu được phép.
- **Admin Users:** tạo tài khoản (họ tên, email, mật khẩu, vai trò), bật/tắt **Active**, sửa, xóa. Các cột phạm vi (nhập mã cách nhau dấu phẩy, bấm **Save**):
  - **Department**, **Owner Code:** phòng ban và nhân viên SAP ghi lên đơn khi đẩy.
  - **Customer Groups**, **Item Groups:** khách hàng và hàng hóa admin được thấy và quản lý (gán nhóm cha = gán cả nhóm con).
  - **Warehouse:** kho admin được dùng ở Inventory, Self create, chọn kho, kiểm tra tồn và đẩy đơn. Chỉ nhận mã kho trong danh sách kho của công ty. Root luôn có tất cả kho; admin chưa được gán kho thì không thấy kho nào.

### 11.5. Audit Logs (chỉ Root)

Nhật ký thao tác của admin và khách: thời gian, người làm, hành động, đối tượng, chi tiết, địa chỉ IP. Lọc theo loại hành động, loại người dùng và khoảng ngày.

---

## 12. Sự cố thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Khách không thấy sản phẩm | Nhóm hàng tắt Active; sản phẩm tắt Visible; bị Catalog Visibility ẩn; hết hàng ở kho của khách | Kiểm tra Item Groups, Items, Catalog Visibility, Warehouses |
| Khách thấy sai giá hoặc thiếu khuyến mãi | Chưa đồng bộ; khách thiếu BP Code; chương trình chưa tới ngày hoặc đã hết hạn | **↻ Resync SAP** cho khách; đồng bộ Price Lists, Contract / Promotion Discount |
| Không thấy kho trong Self create, Inventory hoặc trang đơn | Kho chưa được gán cho admin | Root gán kho ở Admin Users → Warehouse |
| Confirm & Push báo lỗi | Khách thiếu BP Code; còn dòng chờ khách xác nhận; SAP từ chối dữ liệu | Đọc lỗi cạnh nút; xử lý dòng Pending; bổ sung BP Code |
| Người dùng SAP khác không thấy đơn đã đẩy | Phân quyền Owner trong SAP B1 | Kiểm tra Owner Code của admin và quyền xem chứng từ trong SAP |
| Khách không nhận được email | Cấu hình email (SMTP) sai hoặc mật khẩu ứng dụng hết hiệu lực | Báo bộ phận IT kiểm tra cấu hình email |
| Ảnh sản phẩm trống | Trường `U_ImageURL` trong SAP chưa có giá trị | Điền `U_ImageURL`, đồng bộ lại Items |
| Lịch đồng bộ mới không chạy | Máy chủ chưa khởi động lại | Khởi động lại máy chủ, xem **Last run** |
| Inventory báo lỗi SAP | Mất kết nối SAP / HANA hoặc thiếu quyền | Đọc nội dung lỗi, báo bộ phận IT |

**Liên hệ mở khóa tài khoản khách hàng:** 0908404678.

---

## 13. Ghi chú vận hành cho bộ phận IT

- **Cấu hình:** `config.json` (kết nối MySQL, SAP, HANA, email; danh sách `masterdata`: nhóm khách, nhóm hàng, bảng giá, kho của công ty) và `.env` (mật khẩu đã mã hóa). Không chia sẻ các file này ra ngoài.
- **Chạy bằng Docker:** `docker compose up -d --build` để cập nhật phiên bản. Cổng mặc định 5005; HTTPS qua `docker compose --profile proxy up -d`.
- **Cơ sở dữ liệu:** các thay đổi cấu trúc nằm trong `schema.sql` (kèm câu lệnh migration cho cơ sở dữ liệu đang chạy).
- **Sau khi đổi mật khẩu email hoặc lịch đồng bộ:** khởi động lại ứng dụng.
