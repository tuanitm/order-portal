# Hướng dẫn sử dụng – Dành cho Người dùng Quản trị

**Cổng Đặt Hàng – IMV** · Cập nhật ngày 18/11/2026

Tài liệu dành cho nhân viên nội bộ (Root / Super Admin, Admin, Sales): đăng nhập, duyệt khách hàng, tạo và xử lý đơn hàng, đẩy đơn lên SAP Business One, xem tồn kho, quản lý dữ liệu đồng bộ từ SAP, phân quyền (Roles, Users) và nhật ký thao tác.

Địa chỉ truy cập: **https://order.imv.com.vn** (một trang đăng nhập chung cho mọi người dùng)

> Giao diện quản trị hiển thị bằng **tiếng Anh**. Tài liệu giữ nguyên tên menu, nút bấm tiếng Anh (in **đậm**) và giải thích bằng tiếng Việt.

---

## Mục lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Đăng nhập, loại người dùng và menu](#2-đăng-nhập-loại-người-dùng-và-menu)
3. [Thiết lập lần đầu và công việc hằng ngày](#3-thiết-lập-lần-đầu-và-công-việc-hằng-ngày)
4. [Dashboard và đồng bộ nhanh](#4-dashboard-và-đồng-bộ-nhanh)
5. [Duyệt khách hàng – Customer Approval](#5-duyệt-khách-hàng--customer-approval)
6. [Danh sách đơn hàng và tạo đơn thay khách – Self create](#6-danh-sách-đơn-hàng-và-tạo-đơn-thay-khách--self-create)
7. [Xử lý một đơn hàng và đẩy lên SAP](#7-xử-lý-một-đơn-hàng-và-đẩy-lên-sap)
8. [Tồn kho – Inventory](#8-tồn-kho--inventory)
9. [Dữ liệu gốc – Master Data](#9-dữ-liệu-gốc--master-data)
10. [Giá, chiết khấu và khuyến mãi](#10-giá-chiết-khấu-và-khuyến-mãi)
11. [Phân quyền – Roles và Users](#11-phân-quyền--roles-và-users)
12. [Cài đặt khác – Settings](#12-cài-đặt-khác--settings)
13. [Nhật ký thao tác – Audit Logs](#13-nhật-ký-thao-tác--audit-logs)
14. [Sự cố thường gặp](#14-sự-cố-thường-gặp)
15. [Ghi chú vận hành cho bộ phận IT](#15-ghi-chú-vận-hành-cho-bộ-phận-it)

---

## 1. Tổng quan hệ thống

Cổng Đặt Hàng là nơi khách hàng (đại lý, nhà phân phối) tự đặt hàng, và nơi nhân viên kiểm tra rồi đẩy đơn vào **SAP Business One**. Nhân viên cũng có thể **tạo đơn thay khách hàng**, giúp tiết kiệm giấy phép người dùng SAP.

| Bước | Diễn biến |
|---|---|
| 1. Tạo đơn | Khách đặt trên cổng, hoặc nhân viên tạo đơn thay khách (**Self create**) |
| 2. Chờ xác nhận | Đơn lưu trên cổng với trạng thái **Submitted** |
| 3. Kiểm tra | Nhân viên kiểm tra tồn kho, điều chỉnh số lượng xác nhận, trao đổi với khách |
| 4. Đẩy lên SAP | **Confirm & Push to SAP** tạo Draft hoặc Sales Order trong SAP |
| 5. Theo dõi | Số chứng từ, số SO trong SAP và trạng thái đơn |

- **Dữ liệu lấy từ SAP:** khách hàng (kèm địa chỉ và Sales Supervisor), nhóm khách hàng, nhóm hàng, sản phẩm, kho, tồn kho, bảng giá, chiết khấu kỳ, chiết khấu hợp đồng, khuyến mãi, thuế suất GTGT. Dữ liệu được đồng bộ theo lịch hoặc khi bấm nút đồng bộ.
- **Múi giờ:** mọi ngày giờ trên cổng (thời gian tạo, cập nhật, đồng bộ, nhật ký) đều hiển thị theo **giờ Việt Nam (GMT+7)**, bất kể máy tính của người xem đặt múi giờ nào.

---

## 2. Đăng nhập, loại người dùng và menu

### 2.1. Đăng nhập

1. Mở **https://order.imv.com.vn**, nhập **Tên đăng nhập (User ID)** hoặc **Email** rồi bấm **Tiếp tục**.
2. Nhập mật khẩu, bấm **Đăng nhập**. Hệ thống **tự nhận biết loại người dùng** và chuyển đến đúng khu vực:

| Loại người dùng | Sau khi đăng nhập |
|---|---|
| **Root / Super Admin**, **Admin** | Khu vực quản trị **/admin** |
| **Sales** | Khu vực bán hàng **/sales** (Orders, Inventory, My Profile) |
| **Customer** | Cửa hàng của khách **/customer** (xem tài liệu Hướng dẫn cho Khách hàng) |

- Sai tên hoặc mật khẩu: hiện thông báo **"Sai tên hoặc mật khẩu!"**.
- Phiên đăng nhập của nhân viên có hiệu lực **8 giờ**.
- **Đổi mật khẩu khi đăng nhập lần đầu:** nếu tài khoản được đặt *Change password at next login*, hệ thống đưa thẳng đến trang đổi mật khẩu; chưa đổi thì không dùng được chức năng nào khác.
- Đổi mật khẩu của mình bất cứ lúc nào tại **Settings → My Profile**.
- **Đăng xuất:** bấm **Đăng xuất** (giao diện tiếng Anh: **Sign out**) cạnh tên người dùng ở thanh bên trái; hệ thống quay về trang đăng nhập đầu tiên.

### 2.2. Quyền theo loại người dùng

| Loại | Chức năng (menu) | Dữ liệu được thấy |
|---|---|---|
| **Root / Super Admin** | Tất cả, kể cả các mục chỉ dành cho Root | Toàn bộ |
| **Admin** | Các chức năng được tích trong Role | Chỉ trong **phạm vi dữ liệu** của Role: Brands, Channels, Customer Groups, Product Groups, Warehouses (mục 11.1) |
| **Sales** | Orders, Inventory (theo Role), My Profile | Như Admin |
| **Customer** | Chỉ cửa hàng | Khách hàng SAP của chính mình |

### 2.3. Bản đồ menu (khu vực /admin)

| Nhóm menu | Mục | Dùng để |
|---|---|---|
| Dashboard | Dashboard | Số liệu tổng quan, đồng bộ nhanh |
| Customer Approval | Customer Approval | Duyệt, từ chối, tạo khách hàng trong SAP |
| Orders | Orders | Tạo, xử lý, đẩy đơn lên SAP |
| Inventory | Inventory | Tồn kho trực tiếp từ SAP, kèm % hạn sử dụng còn lại |
| Master Data | Customer Groups, SAP Customers, Item Groups, Items, Warehouses | Dữ liệu gốc đồng bộ từ SAP |
| Price & Discount | Price Lists, Contract Discount, Promotion Discount | Bảng giá, chiết khấu, khuyến mãi |
| Settings | My Profile, Catalog Visibility | Đổi mật khẩu; ẩn/hiện hàng và kho cho khách hàng |
| Settings (chỉ Root) | SAP Sync Config, Reset the Id, **Roles**, **Users**, Audit Logs | Lịch đồng bộ, cách đẩy đơn, bảo trì, phân quyền, nhật ký |

> **Biểu tượng chuông** ở góc phải trên cùng báo tin nhắn mới của khách trong các đơn hàng. Bấm vào để mở thẳng đơn đó. Thanh bên trái hiện tên đăng nhập và tên Role của bạn.

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
8. **Roles** → tạo vai trò: chức năng và phạm vi dữ liệu (mục 11.1).
9. **Users** → tạo tài khoản nhân viên và khách hàng, gán Role (mục 11.2).
10. **SAP Sync Config** → đặt lịch đồng bộ tự động và cách đẩy đơn.

### 3.2. Công việc hằng ngày

- **Customer Approval:** duyệt khách hàng mới.
- **Orders:** xử lý đơn **Submitted**, trả lời tin nhắn, đẩy đơn lên SAP; tạo đơn thay khách khi cần.
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

> Tài khoản khách hàng cũng có thể được tạo trực tiếp ở **Users** (Role loại Customer + mã khách SAP) – xem mục 11.2.

---

## 6. Danh sách đơn hàng và tạo đơn thay khách – Self create

### 6.1. Danh sách đơn

- **Lọc theo:** thương hiệu, khách hàng (mã hoặc tên), **Doc No** (mã đơn trên cổng hoặc SAP) và trạng thái.
- **Các cột:** Brand, Order #, Cust Code, Cust Name, Total, SAP Doc #, SAP SO #, Status, Created (giờ Việt Nam).
- **Mã đơn** có dạng `SO-{Mã khách}-{yymmdd}-{3 số}`, ví dụ `SO-GTSO0701-261027-771`.
- **Đơn đã hủy** hiện mã đơn **gạch ngang**, chữ màu xám.
- Admin / Sales chỉ thấy đơn của khách và thương hiệu thuộc phạm vi dữ liệu trong Role.

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
5. Thành công: đơn nhận **SAP Doc #** và đổi trạng thái theo **Post SO Mode** (Draft → **SAP Draft Created**; Sales Order → **Approved**). Nếu lỗi, nội dung lỗi SAP hiện cạnh nút (và được ghi vào Audit Logs).
6. Cập nhật trạng thái theo tiến độ bằng ô chọn cạnh nhãn trạng thái; mỗi lần đổi được ghi lại kèm thời gian.

### 7.3. Dữ liệu gửi lên SAP

| Trường | Giá trị |
|---|---|
| Khách hàng, kho, ghi chú | Mã khách (CardCode), kho đã chọn trên mỗi dòng, Remark → Comments |
| PayToCode / ShipToCode | Địa chỉ xuất hóa đơn / giao hàng đã chọn trên đơn (khách chọn khi đặt hàng, hoặc nhân viên chọn khi Self create) |
| U_CusSEL04 | Sales Supervisor (khi có chọn) |
| U_InvName, U_InvTaxNo, U_InvAddress, U_BPPhone | Thông tin xuất hóa đơn lấy từ đơn: tên khách hàng, MST của khách, địa chỉ xuất hóa đơn (Bill to), số điện thoại liên hệ (nếu đơn thiếu thì lấy từ khách hàng trong SAP) |
| U_DataStatus | Gửi **I** khi tạo; với Post SO Mode = **Sales Order**, sau khi SO được tạo hệ thống cập nhật thành **C** |
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

- **Chọn kho:** ô **🏭 All warehouses** cho phép chọn một hoặc nhiều kho; mặc định chọn tất cả kho trong Role của bạn (Root: tất cả kho của công ty). Luôn phải có ít nhất một kho được chọn.
- **Cột Warehouse:** mỗi mặt hàng hiện một dòng cho mỗi kho; rê chuột để xem tên kho.
- **Cột Shelf life %** (trước OnHand): % hạn sử dụng còn lại của **lô thấp nhất**. Đỏ dưới 33%, cam dưới 66%, xanh từ 66% trở lên. Số trong ngoặc là số lô; rê chuột để xem từng lô và số lượng. *—* = không có lô ghi ngày.
- Tìm theo mã hoặc tên hàng; mỗi trang 50 dòng.

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

## 11. Phân quyền – Roles và Users

### 11.1. Roles (chỉ Root)

Mỗi người dùng có **đúng một Role**. Role quyết định **chức năng** được dùng và **dữ liệu** được thấy; người dùng kế thừa cả hai từ Role.

| Loại Role (Role type) | Chức năng | Phạm vi dữ liệu |
|---|---|---|
| **Super Admin** | Tất cả | Toàn bộ – không cần cấu hình |
| **Admin** | Tích chọn (Dashboard, Customers, Items, Price Lists, Orders, Inventory…) | **Bắt buộc**: Brands, Channels, Customer Groups, Product Groups; Warehouses tùy chọn |
| **Sales** | Tích chọn (nên có Orders, Inventory) | Như Admin |
| **Customer** | Chỉ cửa hàng | **Tùy chọn** (để trống = không giới hạn): Brands, Channels, Product Groups, Warehouses. *Không có Customer Groups* vì mỗi người dùng Customer là một khách SAP |

**Ý nghĩa phạm vi dữ liệu**

| Mục | Admin / Sales | Customer |
|---|---|---|
| **Brands** (ví dụ D1, N1) | Chỉ thấy hàng, đơn của các thương hiệu này | Cửa hàng chỉ hiện sản phẩm các thương hiệu này |
| **Channels** (ví dụ GT) | Khách thuộc kênh này | Chỉ gán được khách SAP thuộc kênh này |
| **Customer Groups** | Khách thuộc các nhóm (giao với Channels) | — |
| **Product Groups** | Hàng thuộc các nhóm hàng (gồm nhóm con) | Cửa hàng chỉ hiện hàng thuộc các nhóm này |
| **Warehouses** | Kho dùng ở Inventory, Self create, kiểm tra tồn, đẩy đơn | Kho tính tồn cho khách (thay cho kho theo nhóm khách ở Catalog Visibility) |

> Với Admin / Sales, mục **để trống = không thấy dữ liệu nào**. Một nhóm bao gồm mọi nhóm con.

**Thao tác:** **＋ New role** tạo mới; **Edit** sửa; **Duplicate** tạo Role mới sao chép đầy đủ chức năng và phạm vi dữ liệu (tên tự đặt "… (copy)", có thể đổi trước khi lưu); **Delete** chỉ được khi Role không còn người dùng.

### 11.2. Users (chỉ Root)

Một danh sách cho **mọi người dùng** (nhân viên và khách hàng). Lọc theo **All / Staff / Super Admin / Admin / Sales / Customers**, tìm theo User ID, tên, email, mã SAP, điện thoại.

| Trường | Ghi chú |
|---|---|
| **Role** | Bắt buộc, một Role |
| **User ID** | Tên đăng nhập, duy nhất; 3–50 ký tự (chữ, số, `.` `_` `-`). Bắt buộc với nhân viên |
| **Name** | Bắt buộc |
| **Email** | Không bắt buộc; nếu có thì duy nhất và **cũng dùng để đăng nhập** (và để nhận mã Quên mật khẩu) |
| **Phone** | Không bắt buộc |
| **SAP customer code** | **Bắt buộc với Role Customer**: người dùng đặt hàng cho khách SAP này (gõ mã hoặc tên để chọn) |
| **Department**, **SAP owner code** | Chỉ nhân viên: phòng ban và nhân viên SAP ghi lên đơn khi đẩy |
| **Password** | Bắt buộc khi tạo (≥ 6 ký tự); khi sửa để trống = giữ nguyên |
| **Change password at next login** | Bắt người dùng đổi mật khẩu ở lần đăng nhập tới (có thể tích nhanh ngay trên danh sách) |
| **Active** | **Deactivate / Activate** để khóa / mở tài khoản |

- **Delete** không được khi người dùng đã có đơn hàng (hãy Deactivate), không xóa được chính mình và Super Admin cuối cùng.
- Khi gán Role Customer có **Channels**, khách SAP phải thuộc kênh đó; nếu không, hệ thống báo lỗi và không lưu.

---

## 12. Cài đặt khác – Settings

### 12.1. Catalog Visibility

- **Quy tắc ẩn/hiện:** mặc định khách thấy mọi sản phẩm. Thêm quy tắc (Customer Group + Item Group + **Visible** / **Hidden**) để ẩn một nhóm hàng với một nhóm khách; quy tắc áp dụng xuống mọi nhóm con.
- **Warehouse Visibility:** gán kho cho từng nhóm khách cấp 2. Khách chỉ thấy tồn kho của các kho này (trừ khi Role Customer của họ có Warehouses riêng).

### 12.2. SAP Sync Config (chỉ Root)

- **Post SO Mode:** **Draft** (mặc định, tạo bản nháp, người dùng SAP duyệt thành Sales Order) hoặc **Sales Order** (tạo thẳng Sales Order, đơn chuyển ngay sang Approved).
- **SAP Sync Schedule:** bật đồng bộ tự động mỗi N giờ, bấm **Save**; **Run now** chạy ngay; **Last run** cho biết kết quả lần gần nhất. Lịch mới có hiệu lực sau khi khởi động lại máy chủ.

### 12.3. Reset the Id (chỉ Root)

Đánh số lại cột **id** của các bảng dữ liệu đồng bộ và bảng nhóm (về 1..N), giữ nguyên liên kết cha–con. Mỗi bảng hiện số dòng, id lớn nhất và % dải id đã dùng. Không chạy được khi có đồng bộ đang chạy trên bảng đó. Mọi lần chạy được ghi vào Audit Logs.

> Sau khi reset **Customer Groups** hoặc **Item Groups**, các admin khác nên tải lại các trang quản trị đang mở có chỉnh sửa nhóm.

---

## 13. Nhật ký thao tác – Audit Logs

Chỉ Root xem được. Ghi lại **mọi thao tác** của mọi loại người dùng (Root / Super Admin, Admin, Sales, Customer), cả **thành công và thất bại** (thất bại có hậu tố *Failed*):

| Nhóm | Hành động được ghi |
|---|---|
| Đăng nhập | Đăng nhập, sai mật khẩu / không có tài khoản, đăng xuất, đổi mật khẩu, yêu cầu và đặt lại mật khẩu (Quên mật khẩu) |
| Đơn của khách | Đặt đơn, sửa đơn, đồng ý / từ chối SL xác nhận, nhắn tin, hủy đơn |
| Đơn – nhân viên | Self create, sửa đơn, sửa Cfm Qty, Confirm & Push to SAP, cập nhật trạng thái từ SAP, nhắn tin, hủy đơn |
| Khách hàng, người dùng | Duyệt, từ chối, tạo khách trong SAP, Resync; tạo / sửa / xóa Users và Roles |
| Dữ liệu gốc | Sửa Items, Item Groups, Customer Groups, Price Lists, Warehouses, SAP Customers, Catalog Visibility, lịch đồng bộ |
| Đồng bộ SAP | Mọi lần đồng bộ bằng tay và **Run now**, kèm kết quả (số bản ghi) hoặc lỗi |

- **Các cột:** Time (giờ Việt Nam), **User** (User ID), **User type**, Action, Entity (đối tượng, ví dụ `order #104`), IP Address, Details (bấm **View**: dữ liệu gửi lên – mật khẩu luôn hiện `***` – và kết quả hoặc lỗi).
- **Bộ lọc:** loại người dùng, hành động, tìm theo User ID / email / mã đối tượng, khoảng ngày.
- Không ghi: các thao tác chỉ xem / tìm kiếm, và đồng bộ tự động theo lịch.

---

## 14. Sự cố thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Đăng nhập báo "Sai tên hoặc mật khẩu!" | Sai User ID / email / mật khẩu; tài khoản chưa có email nên không đăng nhập bằng email được | Kiểm tra ở **Users**; Root đặt lại mật khẩu (và tích *Change password at next login*) |
| Admin / Sales không thấy đơn, khách, hàng hoặc kho nào | Role chưa cấu hình đủ Brands / Channels / Customer Groups / Product Groups / Warehouses | Root bổ sung phạm vi dữ liệu ở **Roles** |
| Khách không thấy sản phẩm | Nhóm hàng tắt Active; sản phẩm tắt Visible; bị Catalog Visibility ẩn; hết hàng ở kho của khách; Role Customer giới hạn Brands / Product Groups | Kiểm tra Item Groups, Items, Catalog Visibility, Warehouses, Roles |
| Khách thấy sai giá hoặc thiếu khuyến mãi | Chưa đồng bộ; khách thiếu BP Code; chương trình chưa tới ngày hoặc đã hết hạn | **↻ Resync SAP** cho khách; đồng bộ Price Lists, Contract / Promotion Discount |
| Không lưu được người dùng Customer | Thiếu mã khách SAP, mã không có trong SAP Customers, hoặc khách ngoài Channels của Role | Đồng bộ **SAP Customers**; chọn đúng Role |
| Confirm & Push báo lỗi | Khách thiếu BP Code; còn dòng chờ khách xác nhận; SAP từ chối dữ liệu | Đọc lỗi cạnh nút (hoặc Audit Logs); xử lý dòng Pending; bổ sung BP Code |
| Thuế hiện "—" | Mặt hàng chưa có VAT Group trong SAP | Bổ sung VAT Group trong SAP, đồng bộ lại Items |
| Người dùng SAP khác không thấy đơn đã đẩy | Phân quyền Owner trong SAP B1 | Kiểm tra SAP owner code của nhân viên và quyền xem chứng từ trong SAP |
| Khách không nhận được email | Cấu hình email (SMTP) sai hoặc mật khẩu ứng dụng hết hiệu lực; tài khoản không có email | Báo bộ phận IT kiểm tra cấu hình email |
| Ảnh sản phẩm trống | Trường `U_ImageURL` trong SAP chưa có giá trị | Điền `U_ImageURL`, đồng bộ lại Items |
| Lịch đồng bộ mới không chạy | Máy chủ chưa khởi động lại | Khởi động lại máy chủ, xem **Last run** |
| Inventory báo lỗi SAP | Mất kết nối SAP / HANA hoặc thiếu quyền | Đọc nội dung lỗi, báo bộ phận IT |

**Liên hệ mở khóa tài khoản khách hàng:** 0908404678.

---

## 15. Ghi chú vận hành cho bộ phận IT

- **Cấu hình:** `config.json` (kết nối MySQL, SAP, HANA, email; danh sách `masterdata`: nhóm khách, nhóm hàng, bảng giá, kho của công ty) và `.env` (mật khẩu đã mã hóa). Không chia sẻ các file này ra ngoài.
- **Chạy bằng Docker:** `docker compose up -d --build` để cập nhật phiên bản. Cổng mặc định 5005; HTTPS qua `docker compose --profile proxy up -d`. Container đặt `TZ=Asia/Ho_Chi_Minh`.
- **Cơ sở dữ liệu:** các thay đổi cấu trúc nằm trong `schema.sql`; script migration trong thư mục `scripts/` (chạy thử không có `--apply`, áp dụng với `--apply`). Cơ sở dữ liệu dùng chung với Order-Portal2 (công ty ADS) – mọi migration chỉ **thêm** cột/bảng và chỉ đổi dữ liệu của IMV.
- **Múi giờ:** máy chủ MySQL chạy UTC; ứng dụng tự đặt `+07:00` cho mọi kết nối. Cột thời gian là `TIMESTAMP` nên dữ liệu luôn đúng; công cụ SQL khác muốn xem giờ Việt Nam thì chạy `SET time_zone = '+07:00';`.
- **Tạo hàng loạt người dùng khách hàng:** từ file Excel (cột company_id, role_id, userid, password, sap_card_code…) bằng script; mã khách phải có trong SAP Customers.
- **Sau khi đổi mật khẩu email hoặc lịch đồng bộ:** khởi động lại ứng dụng.
