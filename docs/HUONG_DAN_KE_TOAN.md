# Hướng dẫn sử dụng – Dành cho Kế toán (Duyệt SO / Kiểm soát công nợ)

**Cổng Đặt Hàng – IMV** · Cập nhật ngày 22/11/2026

Tài liệu dành cho người dùng có Role loại **Accountant** (Kế toán công nợ): duyệt Sales Order (SO) theo quy trình duyệt của SAP ngay trên cổng, kiểm tra 6 bước trước khi duyệt, duyệt nhiều SO một lần, tự động duyệt (**Auto SO Approval**), hoàn tác duyệt (**Undo approval**), xem tuổi nợ (**AR Aging**) và nhận thông báo.

Địa chỉ truy cập: **https://order.imv.com.vn**

> Giao diện hiển thị bằng **tiếng Anh**. Tài liệu giữ nguyên tên menu, nút bấm tiếng Anh (in **đậm**) và giải thích bằng tiếng Việt.

---

## Mục lục

1. [Tổng quan: Kế toán làm gì trên cổng](#1-tổng-quan-kế-toán-làm-gì-trên-cổng)
2. [Đăng nhập, menu và phạm vi dữ liệu](#2-đăng-nhập-menu-và-phạm-vi-dữ-liệu)
3. [Thiết lập lần đầu: tài khoản SAP trong My Profile](#3-thiết-lập-lần-đầu-tài-khoản-sap-trong-my-profile)
4. [Danh sách SO chờ duyệt – SO Approval](#4-danh-sách-so-chờ-duyệt--so-approval)
5. [Duyệt một SO: 6 bước kiểm tra](#5-duyệt-một-so-6-bước-kiểm-tra)
6. [Duyệt hoặc từ chối nhiều SO một lần](#6-duyệt-hoặc-từ-chối-nhiều-so-một-lần)
7. [Hoàn tác duyệt – Undo approval](#7-hoàn-tác-duyệt--undo-approval)
8. [Tự động duyệt – Auto SO Approval](#8-tự-động-duyệt--auto-so-approval)
9. [Tuổi nợ – AR Aging](#9-tuổi-nợ--ar-aging)
10. [Thông báo – chuông 🔔 và nhãn NEW](#10-thông-báo--chuông--và-nhãn-new)
11. [Sự cố thường gặp](#11-sự-cố-thường-gặp)

---

## 1. Tổng quan: Kế toán làm gì trên cổng

Khi Admin hoặc Nhân viên kinh doanh đẩy đơn lên SAP, Sales Order được tạo với **U_DataStatus = I** (chưa phát hành). Cổng kiểm tra các **Approval Templates** của SAP, với người dùng SAP đã đẩy đơn là người khởi tạo (originator):

| Trường hợp | Kết quả |
|---|---|
| Có Approval Template áp dụng (ví dụ đơn kênh GT do sa01 đẩy → template **SO01. SO - GT**) | SO **giữ ở I** và chờ người duyệt của **Approval Stage** đầu tiên (ví dụ **acc03**) duyệt trên cổng |
| Không có template nào áp dụng | SO được cập nhật thành **C** ngay |

Khi Kế toán duyệt ở bước (stage) cuối, cổng đặt **U_DataStatus = C** trong SAP **bằng chính người dùng SAP của Kế toán** – giống thao tác trong **Approval Status Report** của SAP, nhưng không cần đăng nhập SAP.

- Cổng dùng đúng thiết lập trong SAP: **Approval Templates**, **Approval Stages**, người duyệt (Authorizers), số người duyệt bắt buộc (MaxReqr) của từng bước.
- Yêu cầu duyệt tạo trực tiếp trong SAP (ví dụ nhân viên đặt C trong SAP client) cũng hiện trên cổng và duyệt được như nhau.
- Mọi ngày giờ hiển thị theo **giờ Việt Nam (GMT+7)**.

---

## 2. Đăng nhập, menu và phạm vi dữ liệu

### 2.1. Đăng nhập

1. Mở **https://order.imv.com.vn**, nhập **User ID** hoặc **Email**, bấm **Tiếp tục**, nhập mật khẩu, bấm **Đăng nhập**.
2. Tài khoản Kế toán được chuyển đến khu vực **/account**.
3. Đăng xuất: bấm **Đăng xuất / Sign out** ở cuối thanh bên trái.

> Lần đầu đăng nhập có thể được yêu cầu đổi mật khẩu. Đổi mật khẩu bất cứ lúc nào tại **Settings → My Profile**.

### 2.2. Menu

| Nhóm | Mục | Dùng để |
|---|---|---|
| Credit Control | **SO Approval** | Danh sách SO chờ bạn duyệt, kiểm tra và duyệt |
| Credit Control | **Auto SO Approval** | Cài đặt tự động duyệt SO đạt đủ 6 bước |
| Credit Control | **AR Aging** | Tuổi nợ khách hàng (báo cáo Q504 của SAP), xuất Excel |
| Settings | **My Profile** | Tài khoản SAP, Owner Code, đổi mật khẩu |
| (khác) | Các chức năng System Admin cấp thêm trong Role | Ví dụ Inventory, Orders… |

### 2.3. Bạn thấy những SO nào

Chỉ các SO **thỏa cả hai điều kiện**:

1. **Theo SAP:** người dùng SAP của bạn (ví dụ acc03) là người duyệt (Authorizer) trong Approval Stage của SO.
2. **Theo phạm vi dữ liệu của Role:** khách hàng thuộc **Channels** và **Customer Groups** (cấp 1, 2, 3) của Role; SO có hàng thuộc **Brands** của Role.

Ngoài ra chỉ hiện SO có ngày chứng từ (SODate) **từ ngày "Approve SO from date"** trở đi (System Admin đặt trong Settings).

> SO đang chờ **Kế toán khác** duyệt không hiện ở danh sách Pending của bạn.

---

## 3. Thiết lập lần đầu: tài khoản SAP trong My Profile

Để duyệt, cổng đăng nhập SAP bằng **người dùng SAP của chính bạn**. Bạn chỉ nhập một lần:

1. Mở **Settings → My Profile**, khung **SAP account (SO Approval)**.
2. Nhập **SAP user code** (ví dụ `acc03`) và **SAP password**.
3. Bấm **Verify & save**. Cổng đăng nhập thử vào SAP; nếu thành công, mật khẩu được lưu **mã hóa (Fernet)**.

- **Khi đổi mật khẩu trong SAP:** nhập mật khẩu mới ở đây. Nếu SAP từ chối mật khẩu đã lưu, cổng báo và yêu cầu cập nhật.
- **Remove:** xóa mật khẩu đã lưu.
- Chỉ **Kế toán** (và System Admin) được sửa tài khoản SAP của Kế toán. Một người dùng SAP chỉ gắn với một Kế toán.

---

## 4. Danh sách SO chờ duyệt – SO Approval

### 4.1. Bộ lọc

| Bộ lọc | Ghi chú |
|---|---|
| **Brand** | Thương hiệu trong Role của bạn |
| **SODate From** / **SODate To** | Ngày chứng từ SO; không sớm hơn "Approve SO from date" |
| **Status** | **Pending** (chờ bạn duyệt), **Approved**, **Not approved**, **All** |
| **SO No** | U_DocNo (ví dụ `SOO261122003`) hoặc DocNum |
| **Business Partner** | Mã hoặc tên khách |
| **Creator** | Người dùng SAP tạo SO (ví dụ sa01, sa02) |

Bấm **↻ Refresh** để tải lại.

### 4.2. Các cột

| Cột | Ý nghĩa |
|---|---|
| ☐ | Chọn để duyệt / từ chối nhiều SO (mục 6) |
| **Brand** | Thương hiệu |
| **SODate** | Ngày chứng từ |
| **SO No** | Số SO; nhãn đỏ nhấp nháy **NEW** = SO mới bạn chưa mở |
| **BP** | Khách hàng |
| **Creator** | Người dùng SAP tạo SO |
| **Excl / Incl** | Tổng tiền trước / sau thuế |
| **AR/Credit** | Cảnh báo công nợ: hóa đơn quá hạn, hạn mức tín dụng |
| **SAP approval** | Template, bước hiện tại, đang chờ ai |
| **Remarks** | Ghi chú của SO |
| **Status** | Pending / Approved / Not approved; **↶ undone** = SO đã từng bị hoàn tác duyệt |

Bấm vào một dòng để mở trang duyệt SO.

---

## 5. Duyệt một SO: 6 bước kiểm tra

### 5.1. Thông tin trên trang

- **Đầu trang:** số SO, khách hàng, MST, người tạo, nguồn (đơn từ cổng hay SO tạo trong SAP), trạng thái.
- **SAP approval request** (bên phải): template, các bước (stage), người duyệt từng bước, ai đã duyệt / từ chối, đang chờ ai.
- **Customer credit / AR:** tóm tắt công nợ của khách.
- **Order lines:** dòng hàng, giá, % chiết khấu, quà tặng (**Free**), dòng chiết khấu hợp đồng / khuyến mãi.
- **Approval history:** lịch sử duyệt, kèm ghi chú từng bước, cách duyệt (thủ công, **Multi-SO**, **Auto SO Approval**, **In SAP**) và các lần **Undone**.

### 5.2. Sáu bước kiểm tra

Khi mở SO, cổng chạy 6 bước kiểm tra trực tiếp trên dữ liệu SAP (kết quả giữ 15 phút; bấm **↻ Re-run checks** để chạy lại):

| Bước | Kiểm tra | Đạt khi |
|---|---|---|
| 1. **Standard Price** | Giá từng dòng so với bảng giá của khách | Đúng giá bảng giá |
| 2. **Standard / Period Discount** | Chiết khấu kỳ (STD) | Đúng chiết khấu kỳ đang hiệu lực |
| 3. **Contract Discount** | Chiết khấu hợp đồng (CT) | Đúng thỏa thuận hợp đồng còn hiệu lực hôm nay |
| 4. **Promotion Discount** | Khuyến mãi (PM) và hàng tặng | Chương trình còn hiệu lực, đúng tỷ lệ tặng |
| 5. **Inventory Available & Required Shelf Life** | Tồn kho tại kho của đơn và hạn sử dụng theo yêu cầu của khách | Đủ hàng, lô đạt hạn sử dụng yêu cầu |
| 6. **AR Aging — Pending Invoices (not reconciled) & Credit** | Hóa đơn chưa cấn trừ, quá hạn, hạn mức tín dụng (báo cáo Q504) | Không có nợ quá hạn, còn hạn mức |

Kết quả mỗi bước:

| Nhãn | Ý nghĩa |
|---|---|
| ✓ **Pass** | Đạt |
| ! **Review** | Cần xem lại các dòng được đánh dấu |
| ✕ **Not recommended** | Không khuyến nghị duyệt |
| ? **Couldn't check** | Không kiểm tra được (ví dụ mất kết nối) – kiểm tra thủ công |

Đầu khung **Decision**, hệ thống tóm tắt: *System recommends: APPROVE* (cả 6 bước đạt), *Review needed…* hoặc *System does NOT recommend approving…*

### 5.3. Ra quyết định

1. Mở từng bước để xem chi tiết (không bắt buộc với bước đã **Pass**).
2. **Mỗi bước không Pass phải có ghi chú kiểm tra** (Checking note): lý do bạn vẫn chấp nhận. Nếu còn thiếu, khung Decision liệt kê tên bước cần ghi chú – bấm vào tên để mở bước đó.
3. Nhập **Decision note** (ghi chú chung; **bắt buộc khi từ chối**).
4. Bấm:
   - **✓ Approve & release in SAP as acc03** – duyệt bước cuối: SO được đặt **C** trong SAP.
   - **✓ Approve stage** – duyệt một bước giữa: SO chuyển sang chờ người duyệt bước tiếp theo.
   - **✕ Reject** – từ chối: SO giữ **I** trong SAP.
5. Xác nhận trong hộp thoại. Kết quả hiện ngay dưới nút.

> **Muốn duyệt SO có bước "Not recommended":** ghi rõ lý do vào ghi chú của bước đó (ví dụ "Khách đã thanh toán, chờ cấn trừ") rồi bấm Approve. Ghi chú được lưu trong lịch sử duyệt.

> Nếu khung báo *Save your SAP user and password in My Profile*: làm theo mục 3.

---

## 6. Duyệt hoặc từ chối nhiều SO một lần

1. Ở danh sách **Pending**, tích chọn các SO (ô ở đầu dòng hoặc ô chọn tất cả).
2. Thanh thao tác hiện ở trên bảng:
   - **✓ Check & approve ready SOs:** cổng chạy 6 bước cho từng SO đã chọn.
     - SO **đạt cả 6 bước** → được **duyệt tự động** (ghi là *Multi-SO* trong lịch sử).
     - SO **có bước không đạt** → được đánh dấu **Needs manual review**, không duyệt; bạn mở từng SO để ghi chú và duyệt thủ công.
   - **✕ Reject selected:** từ chối các SO đã chọn – **bắt buộc nhập ghi chú** (Note).
3. Kết quả từng SO hiện ngay trên dòng của SO.

---

## 7. Hoàn tác duyệt – Undo approval

Dùng khi bạn đã duyệt nhầm.

**Điều kiện:**

- SO **đã được duyệt** và **bạn là người duyệt bước cuối** (System Admin hoàn tác được SO của mọi Kế toán).
- SO **chưa được chuyển thành Hóa đơn (AR Invoice)** – kể cả qua phiếu giao hàng (Delivery); SO chưa đóng (Closed) hoặc hủy.

**Cách làm:**

1. Mở SO đã duyệt. Khung **Decision** hiện **Undo approval — reason**.
2. Nhập lý do (bắt buộc), bấm **↶ Undo approval**, xác nhận.
3. Cổng đặt lại **U_DataStatus = I** trong SAP (bằng người dùng SAP của bạn), rồi ghi nhận hoàn tác.
   - Nếu SAP từ chối, không có gì thay đổi.
   - Nếu không lưu được trên cổng, cổng tự trả SAP về C – SAP và cổng luôn khớp nhau.
4. SO quay lại danh sách **Pending**, chờ duyệt lại **ở đúng bước đã hoàn tác**, có nhãn **↶ undone**. Người tạo / đẩy SO nhận thông báo.

- Lịch sử duyệt vẫn giữ lần duyệt cũ (gạch ngang, nhãn **Undone**, ai hoàn tác, lúc nào, lý do).
- **SO đã từng hoàn tác không bao giờ được Auto SO Approval duyệt lại** – phải duyệt thủ công.
- Với bước cần 2 người duyệt (MaxReqr = 2), duyệt lại cần đủ số người như SAP yêu cầu; người có lần duyệt vẫn còn hiệu lực không duyệt thêm lần nữa.
- Khi không hoàn tác được, khung Decision ghi lý do (ví dụ *Already on AR Invoice 5730*, *Approved by acc04 — only they (or System Admin) can undo it*).

---

## 8. Tự động duyệt – Auto SO Approval

Menu **Credit Control → 🤖 Auto SO Approval**.

**Cách hoạt động:** trong các khung giờ bạn đặt, cổng định kỳ chạy 6 bước kiểm tra cho **mọi SO đang chờ chính bạn duyệt** (không bao giờ đụng tới SO của Kế toán khác):

| Kết quả kiểm tra | Hành động |
|---|---|
| Cả 6 bước **Pass** | Duyệt SO bằng người dùng SAP của bạn – giống bấm Approve (lịch sử ghi **Auto SO Approval**) |
| Có bước không Pass | Không duyệt; SO chờ bạn duyệt thủ công; nhật ký ghi bước nào, vì sao |
| Lỗi | Ghi lỗi vào nhật ký |
| SO từng bị hoàn tác duyệt | Bỏ qua – phải duyệt thủ công |

**Cài đặt:**

1. Tích **Auto SO Approval**.
2. **Time windows** (giờ Việt Nam) – mỗi khung có chu kỳ riêng, ví dụ:
   - `08:00` to `17:00` every `10` min
   - `17:00` to `22:00` every `30` min
   - Ngoài mọi khung giờ: không chạy. Giờ kết thúc không tính (dùng `24:00` cho cuối ngày); giờ kết thúc nhỏ hơn giờ bắt đầu = qua nửa đêm. Chu kỳ 5–1440 phút; các khung không được chồng nhau.
3. Bấm **Save**. **▶ Run now** chạy ngay một lần.

**Theo dõi:**

- **Last run:** thời gian, trạng thái, tóm tắt lần chạy gần nhất.
- **Recent runs:** mỗi lần chạy – Schedule / Run now, số SO kiểm tra, đã duyệt, chờ duyệt thủ công, lỗi.
- **Log — each SO checked:** từng SO – kết quả (**approved**, **manual review**, **failed**), 6 ô bước 1–6 (xanh = Pass, cam = Review, đỏ = Not recommended, tím = Couldn't check), lý do. Bấm **Steps** để xem chi tiết từng bước. Kết quả lặp lại y hệt chỉ ghi một dòng (*checked N×*).

> Cần lưu mật khẩu SAP trong My Profile (mục 3). Nếu SAP từ chối mật khẩu, lần chạy dừng và báo lỗi.
> System Admin xem và sửa được cài đặt Auto SO Approval của mọi Kế toán.

---

## 9. Tuổi nợ – AR Aging

Menu **Credit Control → ⏳ AR Aging** – chạy báo cáo tuổi nợ **Q504** trực tiếp trên SAP HANA.

- **Bộ lọc:** **As of** (ngày tính tuổi nợ), **Channel**, **Brand**, **Control account**, **Customer**; tìm kiếm; chỉ hiện khách có nợ quá hạn.
- **Bảng khách hàng:** Customer, Salesman, Credit limit, Balance, các khoảng tuổi nợ (**Aging (days past due)**), chứng từ cũ nhất (Oldest).
- Bấm vào một khách để xem **từng chứng từ chưa cấn trừ**: Type, Doc no, Invoice no, SO no, Inv. date, Due date, **Age (days)**, Amount, Not reconciled, Brand, Notes.
- **Excel:** xuất đúng dữ liệu đang hiện (sheet khách hàng và sheet chi tiết chứng từ).
- Dữ liệu giới hạn theo **Channels, Brands, Customer Groups** của Role (dòng không có thương hiệu vẫn được tính).

Bước 6 khi duyệt SO dùng cùng báo cáo này.

---

## 10. Thông báo – chuông 🔔 và nhãn NEW

**Chuông thông báo** ở góc phải trên cùng. **Số màu đỏ** trên chuông = số thông báo **mới chưa đọc** + số **SO đang chờ bạn duyệt**. Số này cũng hiện trên tiêu đề tab trình duyệt, ví dụ "(3) Order Portal".

| Thông báo | Khi nào |
|---|---|
| 📝 **SO … waits for your approval** | Admin / Nhân viên kinh doanh đẩy SO vào quy trình duyệt; bước trước đã duyệt xong tới lượt bạn; SO bị hoàn tác duyệt; yêu cầu duyệt tạo trong SAP client |

- Bấm chuông để xem danh sách; dòng **To approve** (màu đỏ) là SO còn chờ bạn. Bấm vào một dòng để mở SO.
- Số **To approve** khớp với danh sách **Pending** của bạn và tự cập nhật (vài phút một lần); SO được duyệt / từ chối (trên cổng hoặc trong SAP) tự rời khỏi số đếm.
- Thông báo mới tới khi đang làm việc sẽ hiện một khung nhỏ ở góc phải trong vài giây.
- **Mark all read** đánh dấu đã đọc các tin; SO chờ duyệt vẫn được đếm đến khi được xử lý.
- Ở danh sách **SO Approval**, SO chưa mở có nhãn đỏ nhấp nháy **NEW**; mở SO thì nhãn tắt.

---

## 11. Sự cố thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Danh sách SO trống | Chưa có SAP user code; Role thiếu Channels / Brands / Customer Groups; SO trước "Approve SO from date"; không phải bạn duyệt bước hiện tại | Kiểm tra My Profile; nhờ System Admin kiểm tra Role, Settings và Approval Stages trong SAP |
| Nút Approve bị mờ | Còn bước không Pass chưa có ghi chú; chưa lưu mật khẩu SAP; không phải lượt của bạn | Ghi chú các bước được liệt kê; làm mục 3; xem khung SAP approval request |
| *SAP refused the saved password* | Mật khẩu SAP đã đổi | Nhập mật khẩu mới ở My Profile |
| Không thấy nút Undo | SO đã có hóa đơn; SO do Kế toán khác duyệt; SO đã đóng | Đọc lý do dưới khung Decision; liên hệ System Admin |
| Bước 6 báo *Couldn't check* | Không đọc được dữ liệu công nợ từ SAP | **↻ Re-run checks**; nếu vẫn lỗi báo IT |
| Auto SO Approval không chạy | Chưa tích / ngoài khung giờ; chưa lưu mật khẩu SAP; máy chủ chưa khởi động lại sau khi cài | Xem **Last run** và **Recent runs**; báo System Admin |
| Số trên chuông chưa khớp | Đang cập nhật (vài phút) | Mở **SO Approval** (Pending) để cập nhật ngay |
