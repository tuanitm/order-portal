# Hướng dẫn sử dụng – Dành cho System Admin (Quản trị hệ thống)

**Cổng Đặt Hàng – IMV** · Cập nhật ngày 22/11/2026

Tài liệu dành cho người dùng có Role loại **Super Admin** (System Admin / Root): toàn quyền trên cổng, phân quyền (Roles, Users), gán người dùng SAP cho nhân viên, cấu hình đẩy đơn và quy trình duyệt SO, lịch đồng bộ, cài đặt **Auto SO Approval** của Kế toán, hoàn tác duyệt, bảo trì và nhật ký thao tác.

Các công việc hằng ngày (duyệt khách hàng, xử lý và đẩy đơn, tồn kho, dữ liệu gốc, giá – khuyến mãi) giống Admin: xem *Hướng dẫn sử dụng – Admin*. Kế toán, Nhân viên kinh doanh và Khách hàng có tài liệu riêng.

Địa chỉ truy cập: **https://order.imv.com.vn**

> Giao diện quản trị hiển thị bằng **tiếng Anh**. Tài liệu giữ nguyên tên menu, nút bấm tiếng Anh (in **đậm**) và giải thích bằng tiếng Việt.

---

## Mục lục

1. [Vai trò System Admin](#1-vai-trò-system-admin)
2. [Thiết lập lần đầu (theo thứ tự)](#2-thiết-lập-lần-đầu-theo-thứ-tự)
3. [Roles – loại người dùng, chức năng, phạm vi dữ liệu](#3-roles--loại-người-dùng-chức-năng-phạm-vi-dữ-liệu)
4. [Users – tài khoản, người dùng SAP, Owner Code](#4-users--tài-khoản-người-dùng-sap-owner-code)
5. [SAP Sync Config – đẩy đơn, duyệt SO, lịch đồng bộ](#5-sap-sync-config--đẩy-đơn-duyệt-so-lịch-đồng-bộ)
6. [Auto SO Approval của các Kế toán](#6-auto-so-approval-của-các-kế-toán)
7. [Giám sát SO Approval và hoàn tác duyệt](#7-giám-sát-so-approval-và-hoàn-tác-duyệt)
8. [Thông báo – chuông 🔔](#8-thông-báo--chuông-)
9. [Reset the Id](#9-reset-the-id)
10. [Nhật ký thao tác – Audit Logs](#10-nhật-ký-thao-tác--audit-logs)
11. [Sự cố thường gặp](#11-sự-cố-thường-gặp)
12. [Ghi chú vận hành cho bộ phận IT](#12-ghi-chú-vận-hành-cho-bộ-phận-it)

---

## 1. Vai trò System Admin

| Loại người dùng (Role kind) | Khu vực sau đăng nhập | Tài liệu |
|---|---|---|
| **Super Admin** (System Admin) | **/admin** – mọi chức năng, mọi dữ liệu | Tài liệu này + Hướng dẫn Admin |
| **Admin** | **/admin** – chức năng và dữ liệu theo Role | Hướng dẫn Admin |
| **Sales** (Nhân viên kinh doanh) | **/sales** – Orders, Inventory, My Profile | Hướng dẫn Nhân viên kinh doanh |
| **Accountant** (Kế toán) | **/account** – SO Approval, Auto SO Approval, AR Aging + chức năng theo Role | Hướng dẫn Kế toán |
| **Customer** | **/customer** – cửa hàng | Hướng dẫn Khách hàng |

Các mục chỉ System Admin thấy (nhóm **Settings**): **SAP Sync Config**, **Reset the Id**, **Roles**, **Users**, **Audit Logs**.

- System Admin **đẩy đơn bằng người dùng SAP mặc định của cổng (admin02)**.
- System Admin xem được mọi SO trong **SO Approval** (chỉ xem – việc duyệt thuộc về người duyệt trong SAP) và **hoàn tác duyệt** được SO của mọi Kế toán.

---

## 2. Thiết lập lần đầu (theo thứ tự)

1. **Dữ liệu gốc** (xem Hướng dẫn Admin mục 9–10): Customer Groups → Item Groups → Price Lists → SAP Customers → Items → Warehouses → Contract / Promotion Discount.
2. **Roles** (mục 3): tạo Role cho Admin, Sales, Accountant, Customer với chức năng và phạm vi dữ liệu.
3. **Users** (mục 4): tạo tài khoản, gán Role; gán **người dùng SAP** cho Admin, Sales, Kế toán.
4. **SAP Sync Config** (mục 5): Post SO Mode, **Approve SO from date**, lịch đồng bộ, lịch tồn kho.
5. Trong SAP (tư vấn SAP): người dùng SAP của Admin / Sales (ví dụ sa01, sa02) phải là **originator** của các Approval Template; người dùng SAP của Kế toán (ví dụ acc03) là người duyệt trong **Approval Stages**.
6. **Auto SO Approval** (mục 6): bật cho Kế toán nếu cần.
7. **Khởi động lại máy chủ** sau khi đổi lịch đồng bộ hoặc lần đầu dùng Auto SO Approval / thông báo.

---

## 3. Roles – loại người dùng, chức năng, phạm vi dữ liệu

Mỗi người dùng có **đúng một Role**. Role quyết định **chức năng** (menu) và **dữ liệu** được thấy.

| Loại Role (Role type) | Chức năng | Phạm vi dữ liệu |
|---|---|---|
| **Super Admin** | Tất cả | Toàn bộ – không cần cấu hình |
| **Admin** | Tích chọn (Dashboard, Customers, Items, Price Lists, Orders, Inventory, SO Approval, AR Aging…) | **Bắt buộc**: Brands, Channels, Customer Groups, Product Groups; Warehouses tùy chọn |
| **Sales** | Tích chọn – khu vực /sales hiện **Orders**, **Inventory** (cần ít nhất Orders) | Như Admin |
| **Accountant** | **SO Approval** luôn có (kèm Auto SO Approval); tích thêm **AR Aging** và chức năng khác – mọi chức năng tích đều hiện trong menu /account | **Bắt buộc**: **Channels** và **Brands**; Customer Groups (cấp 1–3) để giới hạn khách |
| **Customer** | Chỉ cửa hàng | **Tùy chọn** (để trống = không giới hạn): Brands, Channels, Product Groups, Warehouses |

**Ý nghĩa phạm vi dữ liệu**

| Mục | Admin / Sales / Accountant | Customer |
|---|---|---|
| **Brands** (ví dụ D1, N1) | Chỉ thấy hàng, đơn, SO của các thương hiệu này | Cửa hàng chỉ hiện sản phẩm các thương hiệu này |
| **Channels** (ví dụ GT) | Khách thuộc kênh này | Chỉ gán được khách SAP thuộc kênh này |
| **Customer Groups** | Khách thuộc các nhóm (cấp 1, 2, 3; giao với Channels) | — |
| **Product Groups** | Hàng thuộc các nhóm hàng (gồm nhóm con) | Cửa hàng chỉ hiện hàng thuộc các nhóm này |
| **Warehouses** | Kho dùng ở Inventory, Self create, kiểm tra tồn, đẩy đơn | Kho tính tồn cho khách |

> Với Admin / Sales / Accountant, mục **để trống = không thấy dữ liệu nào**. Một nhóm bao gồm mọi nhóm con.

**Thao tác:** **＋ New role**; **Edit**; **Duplicate** (sao chép đầy đủ, tên "… (copy)"); **Delete** (chỉ khi Role không còn người dùng).

---

## 4. Users – tài khoản, người dùng SAP, Owner Code

Một danh sách cho **mọi người dùng**. Lọc **All / Staff / Super Admin / Admin / Sales / Customers**, tìm theo User ID, tên, email, mã SAP, điện thoại.

| Trường | Ghi chú |
|---|---|
| **Role** | Bắt buộc |
| **User ID** | Tên đăng nhập, duy nhất; 3–50 ký tự (chữ, số, `.` `_` `-`). Bắt buộc với nhân viên |
| **Name**, **Email**, **Phone** | Email (nếu có) duy nhất, dùng để đăng nhập và nhận mã Quên mật khẩu |
| **SAP customer code** | Bắt buộc với Role Customer |
| **Department** | Phòng ban (ghi lên SO dạng CostingCode2) |
| **SAP owner code** | Mã nhân viên SAP (Employee Code) ghi vào Owner của SO khi người này đẩy đơn |
| **SAP user code** + **SAP password** | Với **Accountant, Admin, Sales**: người dùng SAP mà người này duyệt SO (Kế toán) hoặc đẩy đơn (Admin / Sales). Mật khẩu được kiểm tra bằng một lần đăng nhập SAP rồi lưu **mã hóa (Fernet)**. Đổi SAP user code sẽ xóa mật khẩu đã lưu |
| **Password** | Bắt buộc khi tạo (≥ 6 ký tự); khi sửa để trống = giữ nguyên |
| **Change password at next login** | Bắt đổi mật khẩu lần đăng nhập tới |
| **Active** | **Deactivate / Activate** khóa / mở tài khoản (khóa cũng đăng xuất phiên SAP của người đó) |

**Quy tắc người dùng SAP**

| Loại | Một người dùng SAP cho… | Ai đặt |
|---|---|---|
| **Accountant** | Đúng **một** Kế toán | Kế toán tự đặt ở My Profile, hoặc System Admin |
| **Admin** | Đúng **một** Admin | Admin tự đặt ở My Profile, hoặc System Admin |
| **Sales** | **Nhiều tài khoản Sales dùng chung** (ví dụ cả nhóm GT dùng `sa01`) | **Chỉ System Admin** |

- **Sales dùng chung:** lưu mật khẩu SAP trên **một** tài khoản Sales thì mọi tài khoản Sales cùng người dùng SAP được cập nhật theo. Tài khoản Sales mới gán người dùng SAP đã có mật khẩu sẽ tự dùng mật khẩu đó.
- Không cho dùng chung giữa Sales và Admin / Kế toán (hệ thống báo *only Sales accounts can share one SAP user*).
- **Owner Code** của Sales chỉ System Admin đặt; Sales chỉ xem ở My Profile.
- **Delete** không được khi người dùng đã có đơn hàng (hãy Deactivate); không xóa được chính mình và Super Admin cuối cùng.

---

## 5. SAP Sync Config – đẩy đơn, duyệt SO, lịch đồng bộ

Menu **Settings → SAP Sync Config**.

### 5.1. Post SO Mode

- **Draft:** tạo bản nháp trong SAP; người dùng SAP duyệt thành Sales Order.
- **Sales Order:** tạo thẳng Sales Order. SO được tạo với **U_DataStatus = I**, sau đó:
  - có **Approval Template** áp dụng (điều kiện đúng và người đẩy là originator) → giữ **I**, chờ Kế toán duyệt trên cổng (SO Approval);
  - không có → cập nhật **C** ngay.
- **📅 Approve SO from date:** SO Approval chỉ hiện SO có ngày chứng từ **từ ngày này** (ví dụ `2026-11-01`); để trống = tất cả. Lưu cùng nút **Save** của mục này.

> Yêu cầu duyệt SAP tự tạo (khi nhân viên đặt C trong SAP client) cũng hiện trên SO Approval và duyệt được trên cổng.

### 5.2. SAP Sync Schedule

Một lần chạy đồng bộ: Customer Group, Item Group, SAP Customers, Items, Warehouse, Price List, Channel Price List, Period Discount, Contract Discount, Promotion Discount, SAP Order Status.

- Tích **Enable automated sync**, đặt **Run every (hours)**, bấm **Save**. **Run now** chạy ngay. **Last run** cho biết kết quả lần gần nhất.

### 5.3. Inventory Stock Sync Schedule

| Lựa chọn | Cách hoạt động |
|---|---|
| **Option 1 — Scheduled sync** | Sao chép tồn kho từ SAP vào cổng theo các **khung giờ** (giờ Việt Nam), mỗi khung một chu kỳ (ví dụ 08:00–17:00 mỗi 10 phút, 17:00–22:00 mỗi 30 phút). Ngoài mọi khung giờ không chạy. **Run stock sync now** chạy ngay |
| **Option 2 — Real-time from SAP** | Đọc tồn kho trực tiếp từ SAP khi khách xem hàng; một lần đọc dùng chung cho mọi khách trong **thời gian cache** đặt ở đây. Không ai xem thì không đọc. Lịch Option 1 bị tắt. **Refresh live stock now** làm mới ngay |

Bấm **Save** ở cuối mục để lưu lựa chọn và lịch.

---

## 6. Auto SO Approval của các Kế toán

Mục **Auto SO Approval — Accountants** (cuối trang SAP Sync Config) liệt kê **mọi Kế toán**: SAP user (cảnh báo *no password* nếu chưa lưu mật khẩu), bật / tắt, các khung giờ, lần chạy gần nhất.

Bấm **Manage** để mở cài đặt của một Kế toán – giống hệt trang của Kế toán:

- Tích **Auto SO Approval**, thêm **Time windows** (giờ bắt đầu, kết thúc, chu kỳ phút; 5–1440 phút; không chồng nhau), bấm **Save**.
- **▶ Run now** chạy ngay cho Kế toán đó.
- Xem **Recent runs** và **Log — each SO checked** (từng SO: approved / manual review / failed, 6 bước, lý do).

Quy tắc: mỗi lần chạy chỉ xét **SO đang chờ chính Kế toán đó duyệt**, duyệt bằng người dùng SAP của Kế toán đó, **chỉ khi cả 6 bước Pass**; SO từng bị hoàn tác duyệt luôn để duyệt thủ công.

---

## 7. Giám sát SO Approval và hoàn tác duyệt

- **SO Approval** (menu Credit Control): System Admin thấy **mọi** yêu cầu duyệt trong phạm vi công ty, kèm bước hiện tại và đang chờ ai. Không duyệt thay được – chỉ người duyệt trong Approval Stage của SAP mới duyệt.
- **Hoàn tác duyệt (Undo approval):** mở SO đã duyệt, nhập lý do, bấm **↶ Undo approval**.
  - Được khi SO **chưa có AR Invoice** (kể cả qua Delivery), chưa đóng / hủy.
  - System Admin hoàn tác được SO của **mọi Kế toán**; SAP được đặt lại **I** bằng người dùng mặc định (admin02).
  - SO quay lại chờ duyệt ở đúng bước đã hoàn tác; người tạo / đẩy SO và người duyệt nhận thông báo; lịch sử giữ lần duyệt cũ kèm lý do hoàn tác.

---

## 8. Thông báo – chuông 🔔

Chuông ở góc phải trên cùng, **số màu đỏ** = thông báo mới. System Admin nhận thông báo duyệt / từ chối / hoàn tác cho các SO mình đẩy (xem Hướng dẫn Admin mục 12). Hệ thống thông báo cho:

| Người nhận | Thông báo |
|---|---|
| Kế toán | SO chờ duyệt (khi đẩy đơn, tới lượt bước sau, bị hoàn tác, yêu cầu tạo trong SAP client); số đỏ = tin mới + SO đang chờ họ |
| Admin / Sales (người tạo, người đẩy, người dùng SAP tạo SO) | Đã duyệt, từ chối, duyệt một bước, hoàn tác |

---

## 9. Reset the Id

Đánh số lại cột **id** của các bảng dữ liệu đồng bộ và bảng nhóm (về 1..N), giữ nguyên liên kết cha–con. Mỗi bảng hiện số dòng, id lớn nhất và % dải id đã dùng. Không chạy được khi có đồng bộ đang chạy trên bảng đó. Mọi lần chạy được ghi vào Audit Logs.

> Sau khi reset **Customer Groups** hoặc **Item Groups**, các admin khác nên tải lại các trang quản trị đang mở.

---

## 10. Nhật ký thao tác – Audit Logs

Ghi lại **mọi thao tác** của mọi loại người dùng, cả **thành công và thất bại** (thất bại có hậu tố *Failed*):

| Nhóm | Hành động được ghi |
|---|---|
| Đăng nhập | Đăng nhập, sai mật khẩu, đăng xuất, đổi mật khẩu, Quên mật khẩu |
| Đơn của khách | Đặt đơn, sửa đơn, đồng ý / từ chối SL xác nhận, nhắn tin, hủy đơn |
| Đơn – nhân viên | Self create, sửa đơn, sửa Cfm Qty, Confirm & Push to SAP (kèm người dùng SAP đã đẩy, kết quả duyệt), cập nhật trạng thái, nhắn tin, hủy đơn |
| Duyệt SO | Duyệt / từ chối (đối tượng *sap_sales_order*), hoàn tác duyệt, cài đặt và chạy Auto SO Approval |
| Tài khoản SAP | Lưu / xóa tài khoản SAP (My Profile hoặc Users) – **mật khẩu không bao giờ được ghi** |
| Khách hàng, người dùng | Duyệt, từ chối, tạo khách trong SAP, Resync; tạo / sửa / xóa Users và Roles |
| Dữ liệu gốc, cài đặt | Sửa Items, Item Groups, Customer Groups, Price Lists, Warehouses, SAP Customers, Catalog Visibility, lịch đồng bộ, SAP Sync Config |
| Đồng bộ SAP | Mọi lần đồng bộ bằng tay và **Run now**, kèm kết quả hoặc lỗi |

- **Các cột:** Time, User, User type, Action, Entity, IP Address, Details (**View**: dữ liệu gửi lên – mật khẩu hiện `***` – và kết quả).
- **Bộ lọc:** loại người dùng, hành động, tìm theo User ID / email / mã đối tượng, khoảng ngày.

---

## 11. Sự cố thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Nhân viên không thấy dữ liệu | Role thiếu Brands / Channels / Customer Groups / Product Groups | Bổ sung ở **Roles** |
| Kế toán không thấy SO chờ duyệt | Chưa có SAP user code; Role thiếu Channels / Brands; SO trước *Approve SO from date*; người dùng SAP không có trong Approval Stage | Kiểm tra Users, Roles, SAP Sync Config; nhờ tư vấn SAP kiểm tra Stages |
| SO không vào quy trình duyệt | Người đẩy (ví dụ admin02) không phải originator của template; điều kiện template không khớp | Gán người dùng SAP riêng cho Admin / Sales; kiểm tra template trong SAP |
| Không lưu được SAP user code | Đã gắn với người khác (chỉ Sales được dùng chung với Sales) | Chọn người dùng SAP khác |
| *SAP refused the login* khi lưu mật khẩu SAP | Sai mật khẩu, người dùng SAP bị khóa | Kiểm tra trong SAP |
| Đẩy đơn báo *SAP refused the saved password* | Mật khẩu SAP đã đổi | Cập nhật mật khẩu (Sales: ở Users; Admin / Kế toán: My Profile) |
| Lịch đồng bộ / Auto SO Approval / thông báo SAP client không chạy | Máy chủ chưa khởi động lại sau khi thay đổi | Khởi động lại máy chủ |
| Đăng xuất chuyển tới địa chỉ lạ (0.0.0.0) | Phiên bản cũ trước bản sửa 22/11/2026 | Cập nhật phiên bản mới |

---

## 12. Ghi chú vận hành cho bộ phận IT

- **Cấu hình:** `config.json` (MySQL, SAP Service Layer `sapb1`, HANA `hanadb`, email, `masterdata`) và `.env` (mật khẩu mã hóa Fernet, khóa ở `scripts/.encryption_key`). **Kiểm tra `sapb1.companyID` và `hanadb.schema` trỏ đúng công ty thật (IMV) trước khi triển khai** – môi trường thử dùng công ty test.
- **Chạy bằng Docker:** `docker compose up -d --build`. Cổng 5005; HTTPS qua Caddy: `docker compose --profile proxy up -d` (Caddy gửi X-Forwarded-Host / -Proto). Container đặt `TZ=Asia/Ho_Chi_Minh`.
- **Tác vụ nền** (chạy trong máy chủ, mỗi phút kiểm tra một lần, **cần khởi động lại sau khi cập nhật**): đồng bộ SAP theo giờ; đồng bộ tồn kho theo khung giờ; Auto SO Approval theo từng Kế toán; thông báo yêu cầu duyệt tạo trong SAP client và cập nhật số SO chờ duyệt của Kế toán (5 phút một lần).
- **Cơ sở dữ liệu:** cấu trúc trong `schema.sql`; migration trong `scripts/` (chạy thử không có `--apply`, áp dụng với `--apply`). Dùng chung với Order-Portal2 (ADS) – migration chỉ **thêm** cột/bảng. Các migration của đợt cập nhật này: `migrate_so_approval_stages`, `migrate_sap_credentials`, `migrate_so_approval_sap_queue`, `migrate_so_approval_portal`, `migrate_so_auto_approval`, `migrate_staff_notifications`.
- **Quyền HANA** cho người dùng chỉ đọc (IMV_REPORT_RO): các bảng duyệt (OWDD, WDD1, OWTM, WTM1–WTM5, OWST, WST1, OUQR), chứng từ (ORDR, RDR1, OINV, INV1, ODLN, DLN1, ORCT, OITR, ITR1, JDT1), OCRD, OCTG, OUSR.
- **Múi giờ:** MySQL chạy UTC; ứng dụng đặt `+07:00` cho mọi kết nối.
