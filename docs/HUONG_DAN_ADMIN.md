# Hướng dẫn sử dụng – Dành cho Admin

**Cổng Đặt Hàng – IMV** · Cập nhật ngày 22/11/2026

Tài liệu dành cho nhân viên có Role loại **Admin**: duyệt khách hàng, tạo và xử lý đơn hàng, đẩy đơn lên SAP Business One bằng người dùng SAP của mình, theo dõi quy trình duyệt của Kế toán, xem tồn kho, quản lý dữ liệu đồng bộ từ SAP và nhận thông báo.

Các chức năng chỉ dành cho **System Admin** (Roles, Users, SAP Sync Config, Reset the Id, Audit Logs, cài đặt Auto SO Approval của Kế toán) có trong tài liệu *Hướng dẫn sử dụng – System Admin*. Nhân viên kinh doanh và Kế toán có tài liệu riêng.

Địa chỉ truy cập: **https://order.imv.com.vn** (một trang đăng nhập chung cho mọi người dùng)

> Giao diện quản trị hiển thị bằng **tiếng Anh**. Tài liệu giữ nguyên tên menu, nút bấm tiếng Anh (in **đậm**) và giải thích bằng tiếng Việt.

---

## Mục lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Đăng nhập, menu và phạm vi dữ liệu](#2-đăng-nhập-menu-và-phạm-vi-dữ-liệu)
3. [Công việc hằng ngày](#3-công-việc-hằng-ngày)
4. [Dashboard và đồng bộ nhanh](#4-dashboard-và-đồng-bộ-nhanh)
5. [Duyệt khách hàng – Customer Approval](#5-duyệt-khách-hàng--customer-approval)
6. [Danh sách đơn hàng và tạo đơn thay khách – Self create](#6-danh-sách-đơn-hàng-và-tạo-đơn-thay-khách--self-create)
7. [Xử lý một đơn hàng và đẩy lên SAP](#7-xử-lý-một-đơn-hàng-và-đẩy-lên-sap)
8. [Tồn kho – Inventory](#8-tồn-kho--inventory)
9. [Dữ liệu gốc – Master Data](#9-dữ-liệu-gốc--master-data)
10. [Giá, chiết khấu và khuyến mãi](#10-giá-chiết-khấu-và-khuyến-mãi)
11. [Quy trình duyệt SO của Kế toán](#11-quy-trình-duyệt-so-của-kế-toán)
12. [Thông báo – chuông 🔔 và nhãn NEW](#12-thông-báo--chuông--và-nhãn-new)
13. [My Profile: tài khoản SAP, Owner Code, mật khẩu](#13-my-profile-tài-khoản-sap-owner-code-mật-khẩu)
14. [Catalog Visibility](#14-catalog-visibility)
15. [Sự cố thường gặp](#15-sự-cố-thường-gặp)

---

## 1. Tổng quan hệ thống

Cổng Đặt Hàng là nơi khách hàng (đại lý, nhà phân phối) tự đặt hàng, và nơi nhân viên kiểm tra rồi đẩy đơn vào **SAP Business One**. Nhân viên cũng có thể **tạo đơn thay khách hàng**, giúp tiết kiệm giấy phép người dùng SAP. Kế toán duyệt SO theo quy trình duyệt của SAP ngay trên cổng.

| Bước | Diễn biến |
|---|---|
| 1. Tạo đơn | Khách đặt trên cổng, hoặc nhân viên tạo đơn thay khách (**Self create**) |
| 2. Chờ xác nhận | Đơn lưu trên cổng với trạng thái **Submitted** |
| 3. Kiểm tra | Nhân viên kiểm tra tồn kho, điều chỉnh số lượng xác nhận, trao đổi với khách |
| 4. Đẩy lên SAP | **Confirm & Push to SAP** tạo Draft hoặc Sales Order trong SAP, bằng người dùng SAP của người đẩy |
| 5. Duyệt công nợ | Nếu SO khớp Approval Template của SAP, Kế toán duyệt; SO được phát hành (**U_DataStatus = C**) |
| 6. Theo dõi | Số chứng từ, số SO trong SAP, trạng thái đơn và trạng thái duyệt; thông báo trên chuông 🔔 |

- **Dữ liệu lấy từ SAP:** khách hàng (kèm địa chỉ và Sales Supervisor), nhóm khách hàng, nhóm hàng, sản phẩm, kho, tồn kho, bảng giá, chiết khấu kỳ, chiết khấu hợp đồng, khuyến mãi, thuế suất GTGT. Dữ liệu được đồng bộ theo lịch hoặc khi bấm nút đồng bộ.
- **Múi giờ:** mọi ngày giờ trên cổng đều hiển thị theo **giờ Việt Nam (GMT+7)**.

---

## 2. Đăng nhập, menu và phạm vi dữ liệu

### 2.1. Đăng nhập

1. Mở **https://order.imv.com.vn**, nhập **Tên đăng nhập (User ID)** hoặc **Email** rồi bấm **Tiếp tục**.
2. Nhập mật khẩu, bấm **Đăng nhập**. Tài khoản Admin được chuyển đến khu vực **/admin**.

- Sai tên hoặc mật khẩu: hiện thông báo **"Sai tên hoặc mật khẩu!"**.
- Phiên đăng nhập của nhân viên có hiệu lực **8 giờ**.
- **Đổi mật khẩu khi đăng nhập lần đầu:** nếu tài khoản được đặt *Change password at next login*, hệ thống đưa thẳng đến trang đổi mật khẩu.
- **Đăng xuất:** bấm **Đăng xuất / Sign out** cạnh tên người dùng ở thanh bên trái; hệ thống quay về trang đăng nhập đầu tiên.

### 2.2. Menu (khu vực /admin)

Bạn chỉ thấy các mục được tích trong Role của mình.

| Nhóm menu | Mục | Dùng để |
|---|---|---|
| Dashboard | Dashboard | Số liệu tổng quan, đồng bộ nhanh |
| Customer Approval | Customer Approval | Duyệt, từ chối, tạo khách hàng trong SAP |
| Orders | Orders | Tạo, xử lý, đẩy đơn lên SAP |
| Credit Control | SO Approval, AR Aging | Chỉ khi Role được cấp: xem trạng thái duyệt SO, tuổi nợ khách hàng |
| Inventory | Inventory | Tồn kho trực tiếp từ SAP, kèm % hạn sử dụng còn lại |
| Master Data | Customer Groups, SAP Customers, Item Groups, Items, Warehouses | Dữ liệu gốc đồng bộ từ SAP |
| Price & Discount | Price Lists, Contract Discount, Promotion Discount | Bảng giá, chiết khấu, khuyến mãi |
| Settings | My Profile, Catalog Visibility | Tài khoản SAP, Owner Code, đổi mật khẩu; ẩn/hiện hàng và kho cho khách |

> Góc phải trên cùng có hai biểu tượng: **chuông 🔔** (thông báo duyệt SO – mục 12) và **biểu tượng tin nhắn** (tin nhắn mới của khách trong các đơn hàng). Thanh bên trái hiện tên đăng nhập và tên Role của bạn.

### 2.3. Phạm vi dữ liệu

Bạn chỉ thấy dữ liệu trong **phạm vi của Role**: **Brands**, **Channels**, **Customer Groups**, **Product Groups**, **Warehouses**. Mục để trống = không thấy dữ liệu nào. Phạm vi do System Admin cấu hình.

---

## 3. Công việc hằng ngày

- **Customer Approval:** duyệt khách hàng mới.
- **Orders:** xử lý đơn **Submitted**, trả lời tin nhắn, đẩy đơn lên SAP; tạo đơn thay khách khi cần.
- **Theo dõi duyệt:** xem nhãn ⏳ / ✓ / ✕ trên danh sách đơn và thông báo trên chuông 🔔.
- **Đồng bộ:** khi SAP thay đổi giá, khuyến mãi hoặc sản phẩm, bấm đồng bộ hoặc chờ lịch tự động.

---

## 4. Dashboard và đồng bộ nhanh

Dashboard hiển thị các ô số liệu (bấm vào để mở trang tương ứng): khách chờ duyệt, khách đã duyệt, cặp nhóm hàng được bán, số sản phẩm đã đồng bộ, số bảng giá, số đơn hàng.

Khung **Quick sync** có các nút đồng bộ theo yêu cầu: **Sync SAP customers**, **Sync items from SAP**, **Sync price lists from SAP**, **Sync period discounts from SAP**, **Sync contract discounts from SAP**. Nếu lỗi, nội dung lỗi SAP trả về hiện ngay cạnh nút.

> **Chỉ đồng bộ chương trình đang hiệu lực:** chiết khấu hợp đồng và khuyến mãi chỉ lấy các chương trình **có hiệu lực hôm nay** (theo ngày Việt Nam). Chương trình bắt đầu từ ngày mai sẽ xuất hiện sau lần đồng bộ đầu tiên vào ngày bắt đầu.

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

> Tài khoản khách hàng cũng có thể được tạo trực tiếp ở **Users** (Role loại Customer + mã khách SAP) – xem *Hướng dẫn System Admin*.

---

## 6. Danh sách đơn hàng và tạo đơn thay khách – Self create

### 6.1. Danh sách đơn

- **Lọc theo:** thương hiệu, khách hàng (mã hoặc tên), **Doc No** (mã đơn trên cổng hoặc SAP) và trạng thái.
- **Các cột:** Brand, Order #, Cust Code, Cust Name, Total, SAP Doc #, SAP SO #, Status, Created (giờ Việt Nam).
- **Mã đơn** có dạng `SO-{Mã khách}-{yymmdd}-{3 số}`, ví dụ `SO-GTSO0701-261027-771`.
- **Đơn đã hủy** hiện mã đơn **gạch ngang**, chữ màu xám.
- Admin chỉ thấy đơn của khách và thương hiệu thuộc phạm vi dữ liệu trong Role.
- **Nhãn duyệt** dưới trạng thái (đơn đã đẩy lên SAP): ⏳ **Waiting approval**, ✓ **SO approved**, ✕ **SO rejected** (mục 11).
- Nhãn đỏ nhấp nháy **NEW** cạnh mã đơn = có cập nhật duyệt (đã duyệt / từ chối / hoàn tác) bạn chưa xem; mở đơn thì nhãn tắt.

### 6.2. Tạo đơn thay khách hàng – nút ＋ Self create

Nút nằm sau ô tìm **Doc No**. Dùng để nhập đơn cho khách hàng hoặc nhà phân phối không tự đặt trên cổng. Giá và khuyến mãi trong hộp thoại **giống hệt** giá khách thấy trên cổng.

```
+- Create sales order 
| Customer  [ma / ten / MST  v]     Warehouse [1001 v]  Supervisor [   v]
| Bill to   [GTSO0701_001 v]         Ship to   [GTSO0701_001 v]
+------------------------------------------------------------------------
| [+ Add item: go ma hoac ten, Enter]
| Code  Name (2 dong...) Avail Qty UoM  Base STD% CT% PM%  Unit  Total
|       [% GT260100024 - 30% v]   [Qua: Buy 10 get 1 + Buy 1 get 1 ... v]
|  L Gift (cung loai) ...      1   Cai   0                        0
|  L Gift (hang khac) ...      1   Cai   0                        0
+------------------------------------------------------------------------
| Remark [..............]          Subtotal / Discount / Total
|                                           [Cancel]  [Create order]
+------------------------------------------------------------------------
```

1. **Customer:** gõ mã, tên hoặc MST rồi chọn. Chỉ hiện khách thuộc phạm vi dữ liệu của bạn; khách bị khóa hiện nhưng không chọn được. Bên dưới cho biết bảng giá, nhóm khách và khách có tài khoản cổng hay không.
2. **Bill to / Ship to:** tự chọn địa chỉ mặc định trong SAP; có thể đổi sang địa chỉ khác của khách. Địa chỉ đầy đủ hiện ngay dưới ô chọn.
3. **Warehouse:** chỉ các **kho trong Role của bạn**. Đổi kho sẽ cập nhật lại Avail Qty và giá.
4. **Sales supervisor:** tự chọn theo mặc định của khách trong SAP (nếu có), có thể đổi.
5. **Thêm hàng:** gõ mã hoặc tên, **Enter** thêm mặt hàng đang chọn và chuyển con trỏ vào ô **Qty**; Enter trong ô Qty quay lại ô tìm hàng. Thêm lại cùng mặt hàng sẽ tăng số lượng. Chỉ hiện hàng thuộc **Brands** và **Product Groups** trong Role của bạn.
6. **Khuyến mãi:** nhãn 🏷 (chiết khấu %) và 🎁 (tặng hàng) nằm dưới tên hàng. Khi có nhiều chương trình, bấm vào nhãn để chọn. Dòng quà tặng tự tính, hiện thụt vào, giá 0.
7. **Chương trình tặng nhiều quà** (ví dụ GT261100022: mua 10 D11123501 tặng 1 cùng loại, mua 1 tặng 1 D72305104): hiện **đủ các dòng quà**, theo thứ tự: hàng mua → **quà cùng loại** → **quà hàng khác**.
8. **Tên hàng dài** hiện tối đa 2 dòng; rê chuột để xem đầy đủ hoặc bấm vào tên để mở rộng.
9. Nhập **Remark** (gửi lên SAP thành Comments), xem Subtotal / Discount / Total, bấm **Create order**.

> **Kiểm tra trước khi tạo:** số lượng vượt Avail Qty hiện màu đỏ và hệ thống hỏi xác nhận khi tạo. Đơn có hàng nhiều thương hiệu được **tách thành nhiều đơn**, mỗi đơn một thương hiệu (nút đổi thành *Create N orders*). Esc hoặc bấm ra ngoài sẽ hỏi trước khi bỏ đơn đang nhập.

Sau khi tạo, hộp thoại hiện liên kết tới đơn mới (trạng thái **Submitted**). Đơn đi theo quy trình duyệt bình thường ở mục 7. Nếu khách có tài khoản cổng, khách cũng thấy đơn trong *Đơn hàng của tôi*.

---

## 7. Xử lý một đơn hàng và đẩy lên SAP

### 7.1. Thông tin trên trang đơn

- **Đầu đơn:** địa chỉ xuất hóa đơn (Bill to), địa chỉ giao (Ship to), điện thoại, Sales supervisor, ghi chú, người tạo (với đơn Self create).
- **Dòng hàng:** **Item Code** (chữ đậm), Item Name, **Avail Qty**, Qty, **Cfm Qty** (có dấu phân cách hàng nghìn), UoM, Base Price, STD / CT / PM Disc %, Unit Price, Line Total, **Tax** (tiền thuế GTGT của dòng kèm thuế suất, ví dụ `162.311₫ (8%)`).
- **Thứ tự dòng quà tặng:** ngay sau hàng mua; quà **cùng loại** trước, quà **hàng khác** sau.
- **Tổng đơn:** Subtotal, Discount, **Tổng tiền trước thuế**, **Thuế GTGT theo từng thuế suất** (5%, 8%, 10%…), **Tổng thanh toán (gồm thuế)**. Tiền thuế mỗi dòng = Line Total × thuế suất của mặt hàng (lấy từ nhóm thuế VAT Group của mặt hàng trong SAP), làm tròn đến đồng; tổng thuế là tổng thuế các dòng.
- **Messages:** trao đổi với khách ngay trong đơn.

### 7.2. Các bước xử lý

1. Chọn **Warehouse** (chỉ các kho trong Role của bạn) và bấm **Get Stock** để lấy tồn kho trực tiếp từ SAP. Avail Qty xanh = đủ hàng, đỏ = thiếu.
2. Nếu thiếu hàng, sửa **Cfm Qty** (số lượng xác nhận). Quà tặng tự tính lại theo tỷ lệ chương trình (mỗi dòng quà theo tỷ lệ riêng). **Line Total, Discount, Thuế và Total** của đơn được tính lại theo Cfm Qty.
3. Dòng có Cfm Qty khác Qty cần khách **Đồng ý / Từ chối** trên trang đơn của họ. Dòng khách từ chối không được đẩy lên SAP và tính là 0.
4. Bấm **Confirm & Push to SAP**. Ngay trước khi đẩy, hệ thống kiểm tra lại tồn kho thực tế và tự giảm Cfm Qty nếu kho không đủ.
5. **Đẩy bằng người dùng SAP của bạn:** nếu tài khoản của bạn có người dùng SAP (My Profile → SAP account, ví dụ `sa02`), cổng đăng nhập SAP Service Layer bằng người dùng đó để tạo SO – SAP ghi bạn là người tạo (UserSign) và người khởi tạo quy trình duyệt. Chưa có người dùng SAP thì đẩy bằng người dùng mặc định của cổng (**admin02**).
6. Thành công: đơn nhận **SAP Doc #** và đổi trạng thái theo **Post SO Mode** (Draft → **SAP Draft Created**; Sales Order → **Approved**). Với Sales Order, SO được tạo với **U_DataStatus = I** rồi:
   - nếu khớp **Approval Template** của SAP → **giữ ở I**, chờ Kế toán duyệt (thông báo *Credit approval required* trên trang đơn; Kế toán nhận thông báo) – xem mục 11;
   - nếu không → cập nhật **C** ngay.

   Nếu lỗi, nội dung lỗi SAP hiện cạnh nút (và được ghi vào Audit Logs).
7. Cập nhật trạng thái theo tiến độ bằng ô chọn cạnh nhãn trạng thái; mỗi lần đổi được ghi lại kèm thời gian.

### 7.3. Dữ liệu gửi lên SAP

| Trường | Giá trị |
|---|---|
| Khách hàng, kho, ghi chú | Mã khách (CardCode), kho đã chọn trên mỗi dòng, Remark → Comments |
| PayToCode / ShipToCode | Địa chỉ xuất hóa đơn / giao hàng đã chọn trên đơn (khách chọn khi đặt hàng, hoặc nhân viên chọn khi Self create) |
| U_CusSEL04 | Sales Supervisor (khi có chọn) |
| U_InvName, U_InvTaxNo, U_InvAddress, U_BPPhone | Thông tin xuất hóa đơn lấy từ đơn: tên khách hàng, MST của khách, địa chỉ xuất hóa đơn (Bill to), số điện thoại liên hệ (nếu đơn thiếu thì lấy từ khách hàng trong SAP) |
| U_DataStatus | Gửi **I** khi tạo. Với Post SO Mode = **Sales Order**: không cần duyệt → cập nhật **C** ngay; cần duyệt → giữ **I**, Kế toán duyệt bước cuối thì thành **C** |
| Người tạo trong SAP (UserSign) | Người dùng SAP của bạn (My Profile), hoặc admin02 |
| DocumentsOwner, U_OwnerName | Theo **Owner Code** của bạn (My Profile) |
| Dòng hàng: Dscription, U_INVDesc | Tên hàng trong SAP; U_INVDesc giống Dscription |
| Dòng quà tặng: U_INVDesc | Tên hàng + *- HÀNG KHUYẾN MÃI KHÔNG THU TIỀN* |
| Dòng quà tặng: U_CTKM, U_CTKM_NAME | Mã và tên chương trình tặng hàng |
| Dòng quà tặng: U_SortField | `…_31` cho quà thứ nhất (cùng loại), `…_32` cho quà thứ hai (hàng khác) |
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

- **Chọn kho:** ô **🏭 All warehouses** cho phép chọn một hoặc nhiều kho; mặc định chọn tất cả kho trong Role của bạn (System Admin: tất cả kho của công ty). Luôn phải có ít nhất một kho được chọn.
- **Cột Warehouse:** mỗi mặt hàng hiện một dòng cho mỗi kho; rê chuột để xem tên kho.
- **Cột Shelf life %** (trước OnHand): % hạn sử dụng còn lại của **lô thấp nhất**. Đỏ dưới 33%, cam dưới 66%, xanh từ 66% trở lên. Số trong ngoặc là số lô; rê chuột để xem từng lô và số lượng. *—* = không có lô ghi ngày.
- Tìm theo mã hoặc tên hàng; mỗi trang 50 dòng.
- **Export Excel:** xuất đúng dữ liệu đang xem (mọi dòng theo bộ lọc, kèm chi tiết lô).

> **Tốc độ:** chọn tất cả kho có thể mất khoảng 10 giây. Chọn ít kho hơn để xem nhanh hơn.

---

## 9. Dữ liệu gốc – Master Data

- **Customer Groups:** nhóm khách 3 cấp. Chỉ khách thuộc nhóm **Active** mới được đồng bộ. Tắt nhóm cha thì nhóm con tắt theo; bật lại nhóm cha thì nhóm con bật lại.
- **SAP Customers:** danh sách khách hàng từ SAP; tìm theo tên, Card Code, MST. Đồng bộ cũng lấy **địa chỉ xuất hóa đơn / giao hàng**, địa chỉ mặc định và **Sales Supervisor**. Bỏ tích **Enable** để khóa khách (không đăng nhập, không đặt hàng); tích lại để mở.
- **Item Groups:** nhóm hàng 6 cấp. Bật/tắt **Active** chỉ là thay đổi chờ lưu; bấm **Save Changes** để áp dụng. Bật lại nhóm cha thì phải bật từng nhóm con.
- **Items:** sản phẩm đã đồng bộ. Công tắc **Visible** ẩn/hiện từng sản phẩm, giữ nguyên qua các lần đồng bộ. Ảnh lấy từ trường `U_ImageURL` trong SAP. Thuế suất của mặt hàng lấy theo **VAT Group** trong SAP.
- **Warehouses:** đồng bộ kho và tồn kho. Đánh dấu **Included** các kho được tính tồn cho khách. **Check Item Stock** xem tồn một mã hàng theo từng kho, kèm % hạn sử dụng.

---

## 10. Giá, chiết khấu và khuyến mãi

- **Price Lists:** đánh dấu đúng một bảng **Base** và các bảng **Channel** (bảng giá theo kênh gán cho khách).
- **Contract Discount:** thỏa thuận chiết khấu % theo khách / nhóm khách và sản phẩm / nhóm hàng. Chỉ thỏa thuận **có hiệu lực hôm nay** được đồng bộ.
- **Promotion Discount:** chương trình khuyến mãi từ SAP: **Discount** (giảm %) hoặc **Free Item** (mua X tặng Y). Chỉ chương trình **có hiệu lực hôm nay** được đồng bộ. Ngày bắt đầu / kết thúc hiển thị đúng ngày trong SAP.

**Cách tính giá cho khách**

1. **Giá kênh:** giá trong bảng Channel của khách (hoặc giá cơ bản).
2. **Base Price** = Giá kênh − chiết khấu kỳ (STD Disc %).
3. **Unit Price** = Base Price × (1 − (CT Disc % + PM Disc %) / 100), làm tròn đến đồng.
4. **Thuế GTGT** = Line Total × thuế suất của mặt hàng, làm tròn từng dòng.

Khi khớp chương trình, mục cụ thể hơn được ưu tiên (mã khách hơn nhóm khách; mã hàng hơn nhóm hàng). Khi một sản phẩm có nhiều chương trình cùng lúc, khách (hoặc nhân viên trong Self create) được chọn chương trình, và lựa chọn đó được giữ khi đẩy lên SAP.

**Chương trình tặng nhiều quà:** một chương trình có thể vừa tặng **cùng loại** (ví dụ mua 10 tặng 1) vừa tặng **hàng khác** (ví dụ mua 1 tặng 1 sản phẩm khác). Cổng tính và hiện đủ cả hai quà; quà cùng loại luôn xếp trước.

---

## 11. Quy trình duyệt SO của Kế toán

Áp dụng khi Post SO Mode = **Sales Order**. Cổng dùng đúng thiết lập trong SAP: **Approval Templates** (điều kiện, người khởi tạo – originators), **Approval Stages** và người duyệt.

1. Bạn bấm **Confirm & Push to SAP**: SO được tạo với **U_DataStatus = I** bằng người dùng SAP của bạn.
2. Cổng kiểm tra các Approval Template: điều kiện đúng với SO **và** người dùng SAP của bạn là originator của template.
   - **Có template áp dụng** (ví dụ đơn GT do sa02 đẩy → **SO01. SO - GT**): SO **giữ ở I**; Kế toán của bước đầu (ví dụ **acc03**) nhận thông báo và duyệt trên cổng.
   - **Không có template**: SO được cập nhật thành **C** ngay.
3. Kế toán kiểm tra 6 bước (giá chuẩn, chiết khấu kỳ, chiết khấu hợp đồng, khuyến mãi, tồn kho & hạn sử dụng, công nợ) rồi duyệt hoặc từ chối.
4. Duyệt bước cuối → SO thành **C** trong SAP; bạn nhận thông báo ✅. Từ chối → SO giữ **I**; bạn nhận thông báo ⛔ kèm lý do.
5. Kế toán có thể **hoàn tác duyệt** (khi SO chưa có hóa đơn): SO quay về **I**, chờ duyệt lại; bạn nhận thông báo ↶.

| Nhãn trên danh sách đơn | Ý nghĩa |
|---|---|
| ⏳ **Waiting approval** | Đang chờ Kế toán duyệt |
| ✓ **SO approved** | Đã duyệt, SO đã phát hành (C) |
| ✕ **SO rejected** | Bị từ chối, SO giữ I |

> Nếu đẩy bằng **admin02** (chưa có người dùng SAP riêng) mà admin02 không phải originator của template, SO không vào quy trình duyệt và được đặt C ngay. Hãy nhờ System Admin gán người dùng SAP cho bạn.

---

## 12. Thông báo – chuông 🔔 và nhãn NEW

**Chuông thông báo** ở góc phải trên cùng; **số màu đỏ** = số thông báo mới chưa đọc (cũng hiện trên tiêu đề tab trình duyệt, ví dụ "(2) Order Portal").

| Thông báo | Khi nào |
|---|---|
| ✅ **SO … approved** | Kế toán duyệt (kể cả Auto SO Approval) – SO đã phát hành C |
| ⛔ **SO … rejected** | Kế toán từ chối, kèm lý do |
| ➡️ **SO …: stage approved** | Một bước đã duyệt, chờ bước tiếp theo |
| ↶ **SO …: approval undone** | Kế toán hoàn tác duyệt, kèm lý do |

- Bạn nhận thông báo cho SO **bạn tạo**, **bạn đẩy**, hoặc SO được tạo bằng người dùng SAP của bạn.
- Bấm thông báo để mở đơn; **Mark all read** đánh dấu đã đọc tất cả. Thông báo mới khi đang làm việc hiện một khung nhỏ vài giây.
- Ở danh sách **Orders**, đơn có cập nhật chưa xem có nhãn đỏ nhấp nháy **NEW**; mở đơn thì nhãn tắt.

---

## 13. My Profile: tài khoản SAP, Owner Code, mật khẩu

Mở **Settings → My Profile**.

- **SAP account (Push to SAP):** nhập **SAP user code** (ví dụ `sa02`) và **SAP password** một lần, bấm **Verify & save**. Cổng đăng nhập thử SAP; thành công thì mật khẩu được lưu **mã hóa**. Từ đó các đơn bạn đẩy được tạo bằng người dùng SAP này. Khi đổi mật khẩu trong SAP, nhập lại mật khẩu mới ở đây (nếu SAP từ chối mật khẩu đã lưu, việc đẩy đơn dừng lại và báo bạn cập nhật). **Remove** xóa mật khẩu đã lưu.
- **Owner Code:** mã nhân viên SAP (Employee Code) ghi vào Owner của SO để người dùng SAP khác thấy đơn. Nhiều người có thể dùng chung một mã. Để trống = dùng Employee của người dùng mặc định.
- **Change Password:** đổi mật khẩu đăng nhập cổng.

> Mỗi người dùng SAP chỉ gắn với một tài khoản Admin. System Admin cũng có thể đặt các thông tin này cho bạn ở trang Users.

---

## 14. Catalog Visibility

- **Quy tắc ẩn/hiện:** mặc định khách thấy mọi sản phẩm. Thêm quy tắc (Customer Group + Item Group + **Visible** / **Hidden**) để ẩn một nhóm hàng với một nhóm khách; quy tắc áp dụng xuống mọi nhóm con.
- **Warehouse Visibility:** gán kho cho từng nhóm khách cấp 2. Khách chỉ thấy tồn kho của các kho này (trừ khi Role Customer của họ có Warehouses riêng).

---

## 15. Sự cố thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Đăng nhập báo "Sai tên hoặc mật khẩu!" | Sai User ID / email / mật khẩu | Nhờ System Admin đặt lại mật khẩu |
| Không thấy đơn, khách, hàng hoặc kho nào | Role chưa cấu hình đủ phạm vi dữ liệu | Nhờ System Admin bổ sung ở **Roles** |
| Khách không thấy sản phẩm | Nhóm hàng tắt Active; sản phẩm tắt Visible; bị Catalog Visibility ẩn; hết hàng ở kho của khách | Kiểm tra Item Groups, Items, Catalog Visibility, Warehouses |
| Khách thấy sai giá hoặc thiếu khuyến mãi | Chưa đồng bộ; khách thiếu BP Code; chương trình chưa tới ngày hoặc đã hết hạn | **↻ Resync SAP** cho khách; đồng bộ Price Lists, Contract / Promotion Discount |
| Confirm & Push báo lỗi | Khách thiếu BP Code; còn dòng chờ khách xác nhận; SAP từ chối dữ liệu | Đọc lỗi cạnh nút; xử lý dòng Pending; bổ sung BP Code |
| *SAP refused the saved password* khi đẩy đơn | Mật khẩu SAP đã đổi | Nhập mật khẩu mới ở **My Profile → SAP account** |
| SAP báo *Posting Date … equal to or earlier than system date* | Ngày của máy chủ SAP chậm hơn | Cổng đã tự lấy ngày theo SAP; nếu vẫn lỗi báo IT |
| SO không vào quy trình duyệt dù cần | Người dùng SAP đẩy đơn không phải originator của Approval Template | Nhờ System Admin / tư vấn SAP kiểm tra template và người dùng SAP của bạn |
| Thuế hiện "—" | Mặt hàng chưa có VAT Group trong SAP | Bổ sung VAT Group trong SAP, đồng bộ lại Items |
| Người dùng SAP khác không thấy đơn đã đẩy | Owner Code / phân quyền Owner trong SAP | Kiểm tra Owner Code ở My Profile và quyền xem chứng từ trong SAP |
| Ảnh sản phẩm trống | Trường `U_ImageURL` trong SAP chưa có giá trị | Điền `U_ImageURL`, đồng bộ lại Items |
| Inventory báo lỗi SAP | Mất kết nối SAP / HANA hoặc thiếu quyền | Đọc nội dung lỗi, báo bộ phận IT |

**Liên hệ mở khóa tài khoản khách hàng:** 0908404678.
