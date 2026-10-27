-- =============================================================
-- Ordering Portal Database Schema
-- Database: orderdatasource (existing)
-- =============================================================

-- Multi-company support: every table below carries a `company_id` column
-- (config.json's admin.entityID for whichever app instance wrote the row —
-- see getCompanyId() in src/lib/config.ts). Several app
-- instances/containers, each configured for a different company, share this
-- ONE physical database and table set; `company_id` is what keeps their
-- data apart. Every UNIQUE/PRIMARY key that used to assume a business key
-- (an item code, a card code, an email, ...) was globally unique now leads
-- with company_id instead, since the same business key can legitimately
-- exist for two different companies. A fresh install gets all of this
-- directly from the CREATE TABLE statements below; the one-off script that
-- migrated an existing pre-company_id database (added the column,
-- backfilled every row with the then-configured entityID, rebuilt the
-- affected keys as composite) has already been run against every known
-- deployment and was removed from the repo — see git history
-- (migrate_company_id.js) if a never-migrated database ever turns up.

-- Users & Authentication
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  mst_code VARCHAR(50),
  sap_card_code VARCHAR(50),
  sap_card_name VARCHAR(255),
  sap_price_list_num INT NULL,
  sap_cus_grp01 VARCHAR(20) NULL,
  sap_cus_grp02 VARCHAR(20) NULL,
  sap_cus_grp03 VARCHAR(20) NULL,
  -- New-company registration (customer not yet a SAP Business Partner):
  -- sap_card_code stays NULL until an admin assigns the commercial fields
  -- below and the portal creates the BP in SAP (see
  -- POST /api/admin/customers/[id]/create-bp). sap_card_name doubles as
  -- the customer-typed "Company Name" in this path. registration_address
  -- is the Billing Address; registration_shipping_address defaults to it
  -- (customer picks a separate one only if they override it).
  -- declared_region_code is the customer's self-declared Customer Group 2
  -- ("region") — unverified, used only to route visibility of the pending
  -- registration to the matching regional admin (see isCustomerInApprovalScope);
  -- the real Customer Group 1/2/3 are only set once an admin approves.
  -- registration_contact_person is optional (unlike full_name, the login
  -- account holder) — it becomes the BP's ContactEmployees.Name on SAP
  -- creation when provided, falling back to full_name otherwise.
  registration_address TEXT NULL,
  registration_shipping_address TEXT NULL,
  registration_remark TEXT NULL,
  registration_contact_person VARCHAR(255) NULL,
  declared_region_code VARCHAR(20) NULL,
  sap_group_code INT NULL,
  pay_terms_grp_code INT NULL,
  salesperson_code INT NULL,
  credit_limit DECIMAL(18,2) NULL,
  currency VARCHAR(10) NULL,
  language ENUM('vi', 'en') DEFAULT 'vi',
  is_active BOOLEAN DEFAULT TRUE,
  approval_status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  approved_at TIMESTAMP NULL,
  approved_by VARCHAR(255) NULL,
  rejection_reason TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_email (company_id, email),
  UNIQUE KEY uk_company_phone (company_id, phone),
  INDEX idx_company (company_id),
  INDEX idx_mst_code (mst_code),
  INDEX idx_sap_card_code (sap_card_code),
  INDEX idx_approval_status (approval_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration script for existing data:
-- ALTER TABLE users DROP COLUMN user_type;
-- ALTER TABLE users ADD COLUMN approval_status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending' AFTER is_active;
-- ALTER TABLE users ADD COLUMN approved_at TIMESTAMP NULL AFTER approval_status;
-- ALTER TABLE users ADD COLUMN approved_by VARCHAR(255) NULL AFTER approved_at;
-- ALTER TABLE users ADD COLUMN rejection_reason TEXT NULL AFTER approved_by;
-- ALTER TABLE users ADD INDEX idx_approval_status (approval_status);
-- UPDATE users SET approval_status = 'approved' WHERE is_active = TRUE;

-- The sap_price_list_num/items_group_code/item_channel_prices, admin
-- management tables, ItemCat01-06 hierarchy, contract_discount, customers,
-- company_id, and users.registration_*/sap_group_code/pay_terms_grp_code/
-- salesperson_code/credit_limit/currency/declared_region_code columns
-- below all came from one-off migration scripts that have since been run
-- against every known deployment and removed from the repo — see git
-- history (migrate_pricing.js, migrate_admin.js, migrate_item_categories.js,
-- migrate_contract_discount.js, migrate_sap_customers.js,
-- migrate_company_id.js, migrate_new_customer_fields.js,
-- migrate_customer_region_fields.js, migrate_contact_person_field.js) if a
-- database that still needs one of them ever turns up. A fresh install
-- gets everything directly from the CREATE TABLE statements below.

-- Product Cache (synced from SAP B1). is_active is purely sync-driven
-- (reflects the current sellable-category filter); is_manually_hidden is a
-- separate admin override that survives resyncs.
CREATE TABLE IF NOT EXISTS items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  sap_item_code VARCHAR(50) NOT NULL,
  item_name_vi VARCHAR(255),
  item_name_en VARCHAR(255),
  uom VARCHAR(20),
  -- Admin-set override for the unit of measure shown to customers (e.g. SAP's
  -- own `uom` is a case pack code but the storefront should say the inner
  -- unit instead) — NULL by default, and a sync never touches it (not in
  -- syncItems' column list), so it survives future "Sync from SAP" runs.
  -- Effective UOM anywhere customer-facing = COALESCE(sales_uom, uom).
  sales_uom VARCHAR(50) NULL,
  pack_size VARCHAR(50),
  category VARCHAR(100),
  items_group_code INT NULL,
  item_cat01 VARCHAR(20) NULL,
  item_cat02 VARCHAR(20) NULL,
  item_cat03 VARCHAR(20) NULL,
  item_cat04 VARCHAR(20) NULL,
  item_cat05 VARCHAR(20) NULL,
  item_cat06 VARCHAR(20) NULL,
  base_price DECIMAL(18,2) DEFAULT 0,
  image_url VARCHAR(500),
  -- SAP Items.U_ProdBrand UDF — same code space as cost_centers where
  -- dimension=1 (e.g. "D1" = PIGEON). Posted to a Sales Order line's own
  -- CostingCode/COGSCostingCode, and to the header's U_ProdBrand, on
  -- confirm — see POST /api/admin/orders/[id]/confirm.
  brand_code VARCHAR(20) NULL,
  -- SAP Items.SalesVATGroup — NOT the same name as the Sales Order line's
  -- own VatGroup field despite meaning the same thing. Posted explicitly
  -- onto Contract/Promotion Discount lines (CK99999998/CK99999999), whose
  -- OWN item master VatGroup differs from a real item's (confirmed
  -- empirically — CK99999998 itself defaults to "S10", not the real
  -- item's "S08") — without this override the discount would be taxed at
  -- the wrong rate.
  vat_group VARCHAR(20) NULL,
  -- SAP Items.U_ItemTaxClass UDF — posted back onto real inventory/free-
  -- item lines (not the synthetic discount lines, which have none).
  item_tax_class VARCHAR(255) NULL,
  is_active BOOLEAN DEFAULT TRUE,
  is_manually_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_item (company_id, sap_item_code),
  INDEX idx_company (company_id),
  INDEX idx_category (category),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Migration for an existing DB:
-- ALTER TABLE items ADD COLUMN brand_code VARCHAR(20) NULL AFTER image_url;
-- ALTER TABLE items ADD COLUMN vat_group VARCHAR(20) NULL AFTER brand_code;
-- ALTER TABLE items ADD COLUMN item_tax_class VARCHAR(255) NULL AFTER vat_group;

-- Distribution Rule codes ("Profit Centers" in this B1 version's own UI
-- terminology), synced from SAP's /ProfitCenters Service Layer entity —
-- see syncCostCenters in sync.ts. dimension 1 = Brand (matches items.
-- brand_code), dimension 2 = Department (matches admin_users.
-- department_code), dimension 3 = Customer (ocr_code there IS the BP's own
-- CardCode, 1:1 — looked up by exact CardCode at confirm time, never shown
-- as a dropdown, see POST /api/admin/orders/[id]/confirm). All three are
-- posted onto Sales Order lines as the Service Layer's own
-- CostingCode(N)/COGSCostingCode(N) fields — NOT the RDR1 SQL column names
-- OcrCode(N)/CogsOcrCo(N), which Service Layer silently ignores.
CREATE TABLE IF NOT EXISTS cost_centers (
  company_id VARCHAR(50) NOT NULL,
  ocr_code VARCHAR(20) NOT NULL,
  dimension TINYINT NOT NULL,
  ocr_name VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  last_synced TIMESTAMP NULL,
  PRIMARY KEY (company_id, ocr_code, dimension)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Item Groups (SAP BusinessOne UDFs Items.U_ItemCat01..06 — a 6-level
-- merchandising hierarchy, replaces the old OITB-based item groups as the
-- sellability gate). Master category names aren't exposed via SAP Service
-- Layer (the backing @AMDM_ID_ITEMCAT01-06 UDTs return "Service Not
-- Found" — Service Layer's own SQLQueries Query Generator Authorization
-- blocks them regardless of HANA grants), so codes and names are synced
-- directly from SAP HANA instead (see syncItemGroupsFromHana in
-- src/lib/itemCategories.ts), or added manually. Which (ItemCat01,
-- ItemCat02) pairs exist here is also the sync scope for which items get
-- pulled from SAP at all (see syncItems in sync.ts). is_active is a
-- per-row admin on/off switch at ANY level: turning a group off removes it
-- (and, for level 1/2, its pair) from the sync scope, so items under it
-- stop being pulled from SAP and are left/marked inactive
-- (items.is_active = FALSE) rather than deleted. A re-sync never touches
-- this column, so the toggle survives it.
CREATE TABLE IF NOT EXISTS item_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  level TINYINT NOT NULL,
  code VARCHAR(20) NOT NULL,
  parent_code VARCHAR(20) NULL,
  name VARCHAR(255) NULL,
  is_sellable BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uk_company_level_code (company_id, level, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Migration for an existing DB:
-- ALTER TABLE item_groups ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Channel Price Lists (synced from SAP B1 ItemPrices; PriceListNum 11 = base,
-- 12-16 = customer-group/channel lists matching BusinessPartners.PriceListNum).
-- SAP price lists can be defined "based on" another list with a multiplier
-- (Administration > Price Lists > "Base Price List" + "Factor" per item) —
-- base_price_list_num/factor record which list + multiplier SAP used to
-- derive `price` for (item, price_list_num); when base_price_list_num equals
-- price_list_num itself, the price is set directly on this list, not derived.
-- `price` itself is always SAP's already-resolved final price (Service
-- Layer returns it pre-computed) — these two columns are for display/audit
-- only, mirroring the Base Price List/Factor columns in the SAP B1 client's
-- own Price List screen; nothing needs to recompute `price` from them.
CREATE TABLE IF NOT EXISTS item_channel_prices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  sap_item_code VARCHAR(50) NOT NULL,
  price_list_num INT NOT NULL,
  base_price_list_num INT NULL,
  factor DECIMAL(10,4) NULL DEFAULT 1,
  price DECIMAL(18,2) NOT NULL DEFAULT 0,
  last_synced TIMESTAMP NULL,
  UNIQUE KEY uk_company_item_pricelist (company_id, sap_item_code, price_list_num),
  INDEX idx_item_code (sap_item_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration for existing databases:
-- ALTER TABLE item_channel_prices ADD COLUMN base_price_list_num INT NULL AFTER price_list_num;
-- ALTER TABLE item_channel_prices ADD COLUMN factor DECIMAL(10,4) NULL DEFAULT 1 AFTER base_price_list_num;

-- Special Prices (synced from SAP B1)
CREATE TABLE IF NOT EXISTS special_prices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  sap_card_code VARCHAR(50) NOT NULL,
  sap_item_code VARCHAR(50) NOT NULL,
  special_price DECIMAL(18,2) NOT NULL,
  discount_percent DECIMAL(5,2),
  valid_from DATE,
  valid_to DATE,
  last_synced TIMESTAMP NULL,
  UNIQUE KEY uk_company_bp_item (company_id, sap_card_code, sap_item_code),
  INDEX idx_card_code (sap_card_code),
  INDEX idx_item_code (sap_item_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Period Discounts — SAP B1's "Special Prices" object also carries rows
-- scoped to an entire Price List rather than one customer: SAP marks these
-- with CardCode = '*{PriceListNum}' (e.g. '*12' for "S02. GT Price List").
-- The real, time-bound discount for each item lives in that row's
-- SpecialPriceDataAreas child collection (DateFrom/Dateto + Discount % + the
-- resulting SpecialPrice) — the row's own top-level Price/DiscountPercent
-- are just the undiscounted baseline. One row per (price list, item, period
-- start) — an item can have more than one tier. See syncPeriodDiscounts in
-- src/lib/sap-b1/sync.ts. Not yet wired into the live storefront price
-- calculation (see src/app/api/products/route.ts) — sync/admin-visibility
-- only until that's decided.
-- base_price is the row's own (undiscounted) Price on this price list —
-- same baseline for every date-tier of that item; discount_percent keeps
-- SAP's full 4-decimal precision (e.g. 20.0003), not rounded to 2.
--
-- Migration for an existing database (this table was briefly shipped
-- without base_price and with a 2-decimal discount_percent):
--   ALTER TABLE period_discount ADD COLUMN base_price DECIMAL(18,2) NULL AFTER sap_item_code;
--   ALTER TABLE period_discount MODIFY COLUMN discount_percent DECIMAL(7,4);
CREATE TABLE IF NOT EXISTS period_discount (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  price_list_num INT NOT NULL,
  sap_item_code VARCHAR(50) NOT NULL,
  base_price DECIMAL(18,2),
  discount_percent DECIMAL(7,4),
  special_price DECIMAL(18,2) NOT NULL,
  date_from DATE,
  date_to DATE,
  last_synced TIMESTAMP NULL,
  UNIQUE KEY uk_company_pricelist_item_from (company_id, price_list_num, sap_item_code, date_from),
  INDEX idx_price_list (price_list_num),
  INDEX idx_item_code (sap_item_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Special Discounts — the same SAP "Special Prices" object in its normal
-- per-customer form (a real CardCode, not a '*NN' price-list placeholder):
-- negotiated item prices/discounts for one Business Partner. Bulk-synced
-- here for every customer on a given channel price list in one go (e.g. all
-- "GT Channel" customers on "S02. GT Price List") rather than one card at a
-- time — see syncSpecialDiscountsForChannel. Same shape/source as the
-- existing `special_prices` table, kept as a separate table per the
-- admin's request. Not yet wired into the live storefront price
-- calculation — sync/admin-visibility only until that's decided.
CREATE TABLE IF NOT EXISTS special_discount (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  sap_card_code VARCHAR(50) NOT NULL,
  sap_item_code VARCHAR(50) NOT NULL,
  special_price DECIMAL(18,2) NOT NULL,
  discount_percent DECIMAL(6,2),
  valid_from DATE,
  valid_to DATE,
  last_synced TIMESTAMP NULL,
  UNIQUE KEY uk_company_bp_item_from (company_id, sap_card_code, sap_item_code, valid_from),
  INDEX idx_card_code (sap_card_code),
  INDEX idx_item_code (sap_item_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Warehouses (synced from SAP B1 /Warehouses). `is_included` is the admin's
-- own on/off switch for whether this warehouse's stock counts toward an
-- item's "available" quantity on the storefront (see item_warehouse_stock
-- below and the stock gate in src/app/api/products/route.ts) — it is NOT
-- synced from SAP and a re-sync never touches it once set (see
-- syncWarehouses in src/lib/sap-b1/sync.ts). On first sync a warehouse
-- defaults to included only if its name contains "_NORMAL" and not
-- "EXPIRED" (SAP's own naming convention here for genuine sellable regional
-- stock, e.g. HCM_NORMAL/HCM_NORMAL_GT, vs e.g. *_CONSIGNMENT, *_EXPIRED,
-- *_IN TRANSIT, FACTORY_*, which should not count) — admins should review
-- this on the Warehouses admin page rather than trust the default blindly.
CREATE TABLE IF NOT EXISTS warehouses (
  company_id VARCHAR(50) NOT NULL,
  sap_warehouse_code VARCHAR(20) NOT NULL,
  warehouse_name VARCHAR(150),
  is_inactive_in_sap BOOLEAN DEFAULT FALSE,
  is_included BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced TIMESTAMP NULL,
  PRIMARY KEY (company_id, sap_warehouse_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-item, per-warehouse stock (synced from SAP B1's OITW table via a
-- SQLQueries object — see syncInventoryStock / client.ts getInventoryStock;
-- the OData ItemWarehouseInfoCollection on /Items returns ~55 full GL-account
-- -laden objects per item, which is far too heavy for a 1000+-item sync, so
-- this goes straight at OITW instead, same pattern as executePromotionSql).
-- "Available" is computed at query time as in_stock - committed, not stored,
-- so the formula can be revisited without a migration.
--
-- shelf_life_pct: the WORST (lowest) remaining-shelf-life % among this
-- item/warehouse's batches with on-hand qty > 0 — (days until ExpDate) /
-- (ExpDate - MnfDate) * 100, clamped to [0,100] — computed in JS from raw
-- OBTN/OBTQ batch rows (SAP's SQLQueries engine rejects CASE/arithmetic
-- expressions entirely, so the % itself can't be computed in the SAP query).
-- NULL means the item isn't batch-managed (or has none in this warehouse) —
-- treated as "no shelf-life restriction" wherever this is read.
CREATE TABLE IF NOT EXISTS item_warehouse_stock (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  sap_item_code VARCHAR(50) NOT NULL,
  warehouse_code VARCHAR(20) NOT NULL,
  in_stock DECIMAL(18,3) NOT NULL DEFAULT 0,
  committed DECIMAL(18,3) NOT NULL DEFAULT 0,
  ordered DECIMAL(18,3) NOT NULL DEFAULT 0,
  shelf_life_pct DECIMAL(6,2) NULL,
  last_synced TIMESTAMP NULL,
  UNIQUE KEY uk_company_item_warehouse (company_id, sap_item_code, warehouse_code),
  INDEX idx_item_code (sap_item_code),
  INDEX idx_warehouse_code (warehouse_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-batch stock (SAP OBTQ/OBTN), refreshed with item_warehouse_stock by
-- the inventory sync. Lets the available quantity count only the batches
-- whose remaining shelf life meets a customer's required shelf-life %
-- (customer_require_shelflife) — the % is worked out from the dates at
-- query time. An item/warehouse with no rows here is not batch-managed.
CREATE TABLE IF NOT EXISTS item_batch_stock (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  sap_item_code VARCHAR(50) NOT NULL,
  warehouse_code VARCHAR(20) NOT NULL,
  qty DECIMAL(18,3) NOT NULL DEFAULT 0,
  mnf_date DATE NULL,
  exp_date DATE NULL,
  last_synced TIMESTAMP NULL,
  INDEX idx_company_item_warehouse (company_id, sap_item_code, warehouse_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contract Discounts (synced from SAP B1 CBD — @MDM_CD_CBD_H/@MDM_CD_CBD_L).
-- One row per (header, line): a header targets a customer (specific
-- CardCode or a customer_groups level 1-3 code); each line targets items
-- (a specific ItemCode or an item_groups level 1-6 code) with a
-- discount percentage. U_Type/U_TypeName encode which targeting mode
-- applies — see sync.ts CONTRACT_DISCOUNT_TYPE constants.
CREATE TABLE IF NOT EXISTS contract_discount (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  doc_entry INT NOT NULL,
  doc_num INT NULL,
  line_id INT NOT NULL,
  period INT NULL,
  status VARCHAR(10) NULL,
  create_date DATE NULL,
  update_date DATE NULL,
  canceled VARCHAR(1) NULL,
  u_type_cust VARCHAR(10) NULL,
  u_type_name_cust VARCHAR(100) NULL,
  u_code_cust VARCHAR(50) NULL,
  u_name_cust VARCHAR(255) NULL,
  u_valid_from DATE NULL,
  u_valid_to DATE NULL,
  u_type_item VARCHAR(10) NULL,
  u_type_name_item VARCHAR(100) NULL,
  u_code_item VARCHAR(50) NULL,
  u_name_item VARCHAR(255) NULL,
  u_base_disc_pct DECIMAL(6,2) NULL,
  last_synced TIMESTAMP NULL,
  UNIQUE KEY uk_company_doc_line (company_id, doc_entry, line_id),
  INDEX idx_code_cust (u_code_cust),
  INDEX idx_code_item (u_code_item)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Customer Required Shelf Life (synced from SAP B1 UDO "@MDM_CD_CSL_H" /
-- "@MDM_CD_CSL_L" — same "[CD]" custom module family as contract_discount —
-- via the dedicated /CSL Service Layer entity, header + nested
-- MDM_CD_CSL_LCollection; raw SQLQueries access to these two tables is
-- blocked for this SAP user ("not accessible"), /CSL is not). One row per
-- (header, line): a header targets a customer or customer-group level, a
-- line targets an item-group level with a required remaining-shelf-life %
-- range (shelf_life_from/to, e.g. 70-100) — see syncCustomerRequiredShelfLife
-- in src/lib/sap-b1/sync.ts. Only rows whose customer-group AND item-group
-- code are both already known locally (customer_groups/item_groups) are
-- kept — a header targeting a specific customer (not a group), or any row
-- naming a group this portal doesn't track, is skipped (see
-- scope filtering in syncCustomerRequiredShelfLife).
CREATE TABLE IF NOT EXISTS customer_require_shelflife (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  doc_entry INT NOT NULL,
  cust_group_code VARCHAR(50) NOT NULL,
  cust_group_name VARCHAR(255) NULL,
  valid_from DATE NULL,
  valid_to DATE NULL,
  item_group_code VARCHAR(50) NOT NULL,
  item_group_name VARCHAR(255) NULL,
  shelf_life_from DECIMAL(6,2) NULL,
  shelf_life_to DECIMAL(6,2) NULL,
  last_synced TIMESTAMP NULL,
  UNIQUE KEY uk_company_doc_itemgroup (company_id, doc_entry, item_group_code),
  INDEX idx_cust_group (cust_group_code),
  INDEX idx_item_group (item_group_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Promotion Discounts (synced from SAP B1 via custom SQL query).
-- Flat rows mapping a Promotion -> BP/Group -> Item/Group -> Discount/Free Item.
-- bp_type/it_type are the AUTHORITATIVE way to read bp_code/selling_item_code:
--   bp_type='2' -> bp_code is an exact BP card code.
--   bp_type='CG1'/'CG2'/'CG3' -> bp_code is a customer_groups code at that level.
--   it_type='4' -> selling_item_code is an exact item code.
--   it_type='IC1'..'IC6' -> selling_item_code is an item_groups code at that level.
-- bp_grp_code/selling_grp_code are NOT item_groups/customer_groups codes —
-- they're free-text labels (e.g. "GT.TOILETRIES") and are display-only.
-- id is BIGINT and the HANA sync rebuilds this table fresh each run (see
-- syncPromotionDiscountsFromHana): every sync replaces ~720k rows, which
-- used to burn that many ids per run on an INT column.
CREATE TABLE IF NOT EXISTS promotion_discount (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  doc_entry INT NOT NULL,
  promotion_code VARCHAR(50),
  promotion_name VARCHAR(255),
  create_date DATE,
  update_date DATE,
  begin_date DATE,
  end_date DATE,
  after_cus_disc VARCHAR(10) NULL,
  after_price_disc VARCHAR(10) NULL,
  bp_grp_code VARCHAR(50),
  bp_grp_name VARCHAR(255),
  bp_type VARCHAR(10),
  bp_code VARCHAR(50),
  bp_name VARCHAR(255),
  selling_grp_code VARCHAR(50),
  selling_grp_name VARCHAR(255),
  it_type VARCHAR(10),
  selling_item_code VARCHAR(50),
  selling_item_name VARCHAR(255),
  disc_pct DECIMAL(6,2),
  selling_qty DECIMAL(18,2),
  giving_item_code VARCHAR(50),
  giving_item_name VARCHAR(255),
  giving_qty DECIMAL(18,2),
  last_synced TIMESTAMP NULL,
  INDEX idx_company (company_id),
  INDEX idx_bp_code (bp_code),
  INDEX idx_selling_item_code (selling_item_code),
  INDEX idx_active_dates (begin_date, end_date),
  -- Per-product promotion lookup on the storefront (promotionMatchSql's
  -- fromSql joins on selling_item_code); without it each product scanned all
  -- of the customer's rows — this table holds ~700k per-BP rows.
  INDEX idx_company_item_bp (company_id, selling_item_code, bp_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Migration for an existing DB:
-- ALTER TABLE promotion_discount MODIFY id BIGINT NOT NULL AUTO_INCREMENT, ALGORITHM=COPY, LOCK=SHARED;
-- ALTER TABLE promotion_discount ADD INDEX idx_company_item_bp (company_id, selling_item_code, bp_code), ALGORITHM=INPLACE, LOCK=NONE;
-- ALTER TABLE promotion_discount ADD COLUMN bp_type VARCHAR(10) NULL AFTER bp_grp_name;
-- ALTER TABLE promotion_discount ADD COLUMN it_type VARCHAR(10) NULL AFTER selling_grp_name;
-- ALTER TABLE promotion_discount ADD COLUMN after_cus_disc VARCHAR(10) NULL AFTER end_date;
-- ALTER TABLE promotion_discount ADD COLUMN after_price_disc VARCHAR(10) NULL AFTER after_cus_disc;

-- The old hand-maintained `promotions` table was never used (all promotions
-- come from SAP into promotion_discount above) and has been removed.
-- Migration for an existing DB:
-- DROP TABLE IF EXISTS promotions;

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  order_number VARCHAR(64) NOT NULL, -- SO-{BP code}-{yymmdd}-{3 digits}
  -- The portal login that placed it. NULL for an order an admin created
  -- ("Self create") for a customer with no portal login.
  user_id INT NULL,
  -- The SAP customer (BP) the order is for. Always set for new orders;
  -- before this column existed it was only reachable via users.sap_card_code.
  sap_card_code VARCHAR(50) NULL,
  -- Set when an admin created the order on the customer's behalf (admin_users.id).
  created_by_admin_id INT NULL,
  -- Header choices made in the admin "Self create" dialog (NULL for
  -- storefront orders): SAP warehouse, bill-to/ship-to address names
  -- (customer_addresses.address_name -> PayToCode/ShipToCode) and the
  -- Sales Supervisor (U_CusSEL04 on the SAP order).
  -- warehouse_code is also saved by the admin order page's warehouse picker.
  warehouse_code VARCHAR(50) NULL,
  bill_to_code VARCHAR(100) NULL,
  billing_address VARCHAR(1000) NULL,
  ship_to_code VARCHAR(100) NULL,
  supervisor_code VARCHAR(50) NULL,
  supervisor_name VARCHAR(255) NULL,
  customer_name VARCHAR(255),
  delivery_address TEXT,
  contact_phone VARCHAR(20),
  contact_email VARCHAR(255),
  subtotal DECIMAL(18,2) DEFAULT 0,
  discount_total DECIMAL(18,2) DEFAULT 0,
  grand_total DECIMAL(18,2) DEFAULT 0,
  remark TEXT,
  status ENUM('draft','submitted','processing','sap_draft_created','approved','delivered','rejected','completed','cancelled')
         DEFAULT 'draft',
  sap_doc_entry INT,
  sap_doc_num INT,
  -- SAP-generated Sales Order number (U_DocNo, e.g. "SOO261015001") — filled
  -- by the sync-status cron/manual button after the draft is approved in SAP.
  sap_so_number VARCHAR(50) NULL,
  language ENUM('vi', 'en') DEFAULT 'vi',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uk_company_order_number (company_id, order_number),
  INDEX idx_user (user_id),
  INDEX idx_card_code (company_id, sap_card_code),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Migration for an existing DB:
-- ALTER TABLE orders MODIFY user_id INT NULL,
--   ADD COLUMN sap_card_code VARCHAR(50) NULL AFTER user_id,
--   ADD COLUMN created_by_admin_id INT NULL AFTER sap_card_code,
--   ADD COLUMN warehouse_code VARCHAR(50) NULL AFTER created_by_admin_id,  -- skip if it already exists
--   ADD COLUMN bill_to_code VARCHAR(100) NULL AFTER warehouse_code,
--   ADD COLUMN billing_address VARCHAR(1000) NULL AFTER bill_to_code,
--   ADD COLUMN ship_to_code VARCHAR(100) NULL AFTER billing_address,
--   ADD COLUMN supervisor_code VARCHAR(50) NULL AFTER ship_to_code,
--   ADD COLUMN supervisor_name VARCHAR(255) NULL AFTER supervisor_code,
--   ADD INDEX idx_card_code (company_id, sap_card_code);
-- UPDATE orders o JOIN users u ON u.id = o.user_id SET o.sap_card_code = u.sap_card_code WHERE o.sap_card_code IS NULL;
-- ALTER TABLE orders MODIFY COLUMN status ENUM('draft','submitted','processing','sap_draft_created','approved','delivered','rejected','completed','cancelled') DEFAULT 'draft';
-- ALTER TABLE orders ADD COLUMN sap_so_number VARCHAR(50) NULL AFTER sap_doc_num;

-- Order Lines. company_id is denormalized from the parent order (set at
-- order-creation time, never touched after) so a line can be filtered/
-- joined by company directly, without forcing a join back to `orders`
-- everywhere this table is queried.
CREATE TABLE IF NOT EXISTS order_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  order_id INT NOT NULL,
  sap_item_code VARCHAR(50) NOT NULL,
  item_name VARCHAR(255),
  quantity INT NOT NULL,
  uom VARCHAR(20),
  -- Item channel price BEFORE contract/promotion discounts — this (not
  -- unit_price) is what gets pushed to the SAP draft sales order; SAP B1
  -- applies its own discount structure on top. 0 on free-gift lines.
  base_unit_price DECIMAL(18,2) NOT NULL DEFAULT 0,
  -- Net price after discounts, as the customer saw it (informational for SAP).
  unit_price DECIMAL(18,2) NOT NULL,
  discount_percent DECIMAL(5,2) DEFAULT 0,
  line_total DECIMAL(18,2) NOT NULL,
  -- What actually gets pushed to SAP on confirm (see POST .../confirm) —
  -- defaults to `quantity` at order creation, but the admin reviewing the
  -- order can lower it first (insufficient live stock, shelf-life gate,
  -- ...) on the Order Review page. Auto-recalculated on a linked gift
  -- line (see promo_buy_qty/promo_give_qty/source_line_id below) whenever
  -- the buy line's own confirm_qty changes — otherwise never touched
  -- except by an explicit admin edit or the pre-SAP-push live-stock cap.
  confirm_qty INT NOT NULL DEFAULT 0,
  -- The customer's response to confirm_qty when it differs from `quantity`
  -- (an admin adjustment) — 'pending' until they Accept/Reject on their own
  -- order page; reset to 'pending' every time the admin changes confirm_qty
  -- again (a fresh adjustment is a fresh decision), and 'accepted' whenever
  -- confirm_qty equals quantity (nothing to confirm). Never blocks the
  -- admin's SAP push by itself — just surfaces disagreement for them to see.
  customer_confirm_status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'accepted',
  -- Buy-X-get-Y promo linkage (see calculateFreeQty in useCart.tsx, and
  -- the checkout page which creates the paired lines at order time):
  -- is_gift_line marks the free-item line itself (unit_price always 0);
  -- source_line_id, set ONLY on a gift line, points back at the paid
  -- "buy" line in the SAME order that earned it; promo_buy_qty/
  -- promo_give_qty, set ONLY on a buy line that has an attached gift,
  -- are that promo's ratio (buy N -> give M) — used to recompute the
  -- gift line's own confirm_qty whenever the buy line's confirm_qty
  -- changes (see recalculateLinkedGiftQty in src/lib/orderGifts.ts).
  is_gift_line BOOLEAN NOT NULL DEFAULT FALSE,
  source_line_id INT NULL,
  promo_buy_qty INT NULL,
  promo_give_qty INT NULL,
  -- Excel Import (storefront "Excel Import" feature): the uploaded file's
  -- Remark column for this row. NULL for every line created through the
  -- normal manual add-to-cart/Reorder flow, which has no remark concept.
  -- Unrelated to and independent of orders.remark (order-level).
  remark VARCHAR(500) NULL,
  -- Per-discount-type % breakdown, snapshotted at order-creation time from
  -- the same waterfall src/app/api/products/route.ts already computes
  -- (Channel -> Period -> Contract -> Promotion) — previously only the
  -- COMBINED discount_percent above was persisted. Lets Admin - Order show
  -- which discount type(s) actually applied instead of one opaque %. NULL
  -- on legacy rows predating this column and on gift lines (unit_price is
  -- always 0, so no waterfall percent is meaningful there).
  period_disc_pct DECIMAL(7,4) NULL,
  contract_disc_pct DECIMAL(7,4) NULL,
  promo_disc_pct DECIMAL(7,4) NULL,
  -- Which specific promotion_discount PROGRAM (doc_entry/promotion_code,
  -- NOT a single rule row) the customer chose on the product card, when an
  -- item qualified for more than one at once — see
  -- src/lib/pricing/productPricing.ts's promotionOptions/giveawayOptions.
  -- Plain denormalized code+name (not an FK): promotion_discount is a
  -- bulk-synced cache table, fully replaced on every sync, so a row-level
  -- FK would dangle after the very next sync even though the PROGRAM
  -- (promotion_code) itself is still perfectly identifiable. promotion_code
  -- covers the percent-discount program on this line; giveaway_promotion_code
  -- covers the (independent) buy-X-get-Y program that attached this line's
  -- gift line, if any — a single buy line can draw its % discount from one
  -- program and its free gift from a completely different one. NULL means
  -- either no program applied, or (for legacy rows predating this column)
  -- the choice was never recorded — the SAP push falls back to today's
  -- auto-best-match in that case (see POST .../confirm).
  promotion_code VARCHAR(50) NULL,
  promotion_name VARCHAR(255) NULL,
  giveaway_promotion_code VARCHAR(50) NULL,
  giveaway_promotion_name VARCHAR(255) NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (source_line_id) REFERENCES order_lines(id) ON DELETE SET NULL,
  INDEX idx_company (company_id),
  INDEX idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Migration for an existing DB:
-- ALTER TABLE order_lines ADD COLUMN base_unit_price DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER uom;
-- ALTER TABLE order_lines ADD COLUMN confirm_qty INT NOT NULL DEFAULT 0 AFTER line_total;
-- UPDATE order_lines SET confirm_qty = quantity WHERE confirm_qty = 0;
-- ALTER TABLE order_lines ADD COLUMN customer_confirm_status ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'accepted' AFTER confirm_qty;
-- ALTER TABLE order_lines ADD COLUMN is_gift_line BOOLEAN NOT NULL DEFAULT FALSE AFTER customer_confirm_status;
-- ALTER TABLE order_lines ADD COLUMN source_line_id INT NULL AFTER is_gift_line;
-- ALTER TABLE order_lines ADD COLUMN promo_buy_qty INT NULL AFTER source_line_id;
-- ALTER TABLE order_lines ADD COLUMN promo_give_qty INT NULL AFTER promo_buy_qty;
-- ALTER TABLE order_lines ADD FOREIGN KEY (source_line_id) REFERENCES order_lines(id) ON DELETE SET NULL;
-- ALTER TABLE order_lines ADD COLUMN remark VARCHAR(500) NULL AFTER promo_give_qty;
-- ALTER TABLE order_lines ADD COLUMN period_disc_pct DECIMAL(7,4) NULL AFTER remark;
-- ALTER TABLE order_lines ADD COLUMN contract_disc_pct DECIMAL(7,4) NULL AFTER period_disc_pct;
-- ALTER TABLE order_lines ADD COLUMN promo_disc_pct DECIMAL(7,4) NULL AFTER contract_disc_pct;
-- ALTER TABLE order_lines ADD COLUMN promotion_code VARCHAR(50) NULL AFTER promo_disc_pct;
-- ALTER TABLE order_lines ADD COLUMN promotion_name VARCHAR(255) NULL AFTER promotion_code;
-- ALTER TABLE order_lines ADD COLUMN giveaway_promotion_code VARCHAR(50) NULL AFTER promotion_name;
-- ALTER TABLE order_lines ADD COLUMN giveaway_promotion_name VARCHAR(255) NULL AFTER giveaway_promotion_code;

-- Order Status History — one row per status an order has entered (including
-- the initial 'submitted'), so the customer's "Đơn hàng của tôi" status popup
-- can show a timeline with the time of each step.
CREATE TABLE IF NOT EXISTS order_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  order_id INT NOT NULL,
  status VARCHAR(30) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_company (company_id),
  INDEX idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Order Messages — a two-way thread attached to one order (admin <-> the
-- customer who placed it), for exactly the cases that come up AFTER an
-- order is placed: not enough stock, qty over available stock, shelf-life
-- requirement not met, etc. Both sides see the same thread on their own
-- order page (admin: Order Review; customer: their own order detail page).
-- sender_name is a snapshot (the admin's full name, or the customer's own
-- name) — intentionally NOT a FK to admin_users/users, so the thread still
-- reads correctly even if that account is later renamed or removed.
-- read_at: NULL = unread. Set on admin-authored rows when the customer
-- opens their own order's thread (drives the storefront navbar badge —
-- getUnreadMessageSummaryForUser), and on customer-authored rows when any
-- admin opens the admin Order Review thread (drives the admin portal's own
-- top-right badge — getUnreadCustomerMessageSummaryForAdmins). Same column,
-- opposite direction, disambiguated by sender_type.
CREATE TABLE IF NOT EXISTS order_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  order_id INT NOT NULL,
  sender_type ENUM('admin', 'customer') NOT NULL,
  sender_name VARCHAR(255),
  message TEXT NOT NULL,
  read_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_company (company_id),
  INDEX idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Migration for an existing DB:
-- ALTER TABLE order_messages ADD COLUMN read_at TIMESTAMP NULL DEFAULT NULL AFTER message;

-- Push Subscriptions — one row per browser/device a customer has granted
-- Notification permission on (see src/lib/webPush.ts). endpoint is the
-- push service URL the browser handed back from PushManager.subscribe();
-- p256dh/auth are the per-subscription encryption keys the Web Push
-- protocol requires. A customer can have several (phone, laptop, ...) —
-- all of them get notified. A row is deleted the moment its endpoint
-- comes back expired/invalid (410/404) from the push service, so this
-- table only ever holds subscriptions that still work.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  user_id INT NOT NULL,
  endpoint VARCHAR(512) NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_company_endpoint (company_id, endpoint(255)),
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- Admin Management
-- =============================================================

-- Admin Roles ("user group") — a fixed list of section keys the role may access
CREATE TABLE IF NOT EXISTS admin_roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255),
  permissions JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_name (company_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin Users. `is_root` marks the "root" account(s) — unrestricted,
-- bypasses every role/scope check (see hasPermission, getAllowed*Codes),
-- and only root can reach this table's own admin UI (Admin Users/Admin
-- Roles — see ROOT_ONLY_PERMISSIONS). A root row has no role (`role_id`
-- NULL); every other row must have one — enforced by the CHECK below.
-- The original bootstrap credential lived only in config.json/.env; it is
-- migrated into a real row here (see scripts/migrate_root_admin.mjs) so root
-- is a normal, manageable `admin_users` account like any other, with its
-- own id used for the `admin-token` JWT's adminId and for last-root-standing
-- checks (see /api/admin/users DELETE and the isActive PATCH guard).
CREATE TABLE IF NOT EXISTS admin_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role_id INT NULL,
  is_root BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  -- This admin's own cost center code, dimension 2 in cost_centers (see
  -- that table's comment) — posted as OcrCode2/CogsOcrCo2 on every Sales
  -- Order line when THIS admin confirms/pushes an order to SAP (see POST
  -- /api/admin/orders/[id]/confirm). NULL until set on the Admin Users page;
  -- a push proceeds without those two fields if it's still unset.
  department_code VARCHAR(20) NULL,
  -- This admin's own SAP Employee lookup key — matched against
  -- EmployeesInfo.EmployeeCode (OHEM; Human Resources > Employee Master
  -- Data's own "Code"/"Employee Code" field, NOT ExternalEmployeeNumber,
  -- which is unused in this company, nor the primary-key EmployeeID
  -- itself) live at push time (see SapB1Client.resolveOrderOwner). Several
  -- admins may share the same code (e.g. a sales team all posting as one
  -- SAP Employee owner) — no uniqueness constraint. When NULL, or when no
  -- SAP Employee has a matching EmployeeCode, the push falls back to the Employee
  -- linked to the shared Service Layer integration login (config.json's
  -- sapb1.userId) instead. Used to fill the pushed Sales Order's
  -- DocumentsOwner (the Employee's numeric EmployeeID) and U_OwnerName
  -- (LastName + " " + FirstName) header fields.
  owner_code VARCHAR(50) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES admin_roles(id),
  UNIQUE KEY uk_company_email (company_id, email),
  CONSTRAINT chk_admin_users_role CHECK (
    (is_root = TRUE AND role_id IS NULL) OR (is_root = FALSE AND role_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Migration for an existing DB:
-- ALTER TABLE admin_users ADD COLUMN department_code VARCHAR(20) NULL AFTER is_active;
-- ALTER TABLE admin_users ADD COLUMN owner_code VARCHAR(50) NULL AFTER department_code;

-- Price Lists (synced from SAP B1 PriceLists) — admin marks base vs channel lists
CREATE TABLE IF NOT EXISTS price_lists (
  company_id VARCHAR(50) NOT NULL,
  price_list_num INT NOT NULL,
  list_name VARCHAR(255),
  is_base BOOLEAN DEFAULT FALSE,
  is_channel BOOLEAN DEFAULT FALSE,
  last_synced TIMESTAMP NULL,
  PRIMARY KEY (company_id, price_list_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Customer Groups (synced from SAP BusinessPartners.U_CusGrp01/02/03).
-- Level 1 names can be derived from price_lists; level 2/3 names are not
-- exposed via SAP Service Layer, so admins name them locally as discovered.
-- is_active: per-row admin on/off switch at any level — UNLIKE item_groups,
-- toggling here cascades to descendants in BOTH directions (parent active
-- <-> children active), not just off; see cascadeSetActiveDescendants in
-- src/lib/customerGroups.ts. Re-imports never touch this column.
CREATE TABLE IF NOT EXISTS customer_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  level TINYINT NOT NULL,
  code VARCHAR(20) NOT NULL,
  parent_code VARCHAR(20) NULL,
  name VARCHAR(255) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uk_company_level_code (company_id, level, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Migration for an existing DB:
-- ALTER TABLE customer_groups ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Catalog Visibility — default: which item categories (item_groups,
-- levels 1-3) a customer group may browse/order
CREATE TABLE IF NOT EXISTS catalog_visibility (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  customer_group_id INT NOT NULL,
  item_category_level TINYINT NOT NULL,
  item_category_code VARCHAR(20) NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uk_company_group_itemcat (company_id, customer_group_id, item_category_level, item_category_code),
  INDEX idx_customer_group_id (customer_group_id),
  FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Catalog Visibility — Customer Group (level 2 only) <-> Warehouse, n:n.
-- Which warehouse(s)' stock counts toward "available" (see the stock gate in
-- src/app/api/products/route.ts) for a customer depends on which level-2
-- group they belong to (users.sap_cus_grp02): if their group has at least
-- one mapping here, ONLY those warehouses count for them; a group with no
-- mapping falls back to every warehouse marked Included on the Warehouses
-- admin page (warehouses.is_included) — the same safe default as before
-- this table existed. `is_included` remains the master on/off switch (a
-- warehouse must be Included to be offered here, and if NO warehouse is
-- Included anywhere, the stock gate is off entirely regardless of mappings).
CREATE TABLE IF NOT EXISTS customer_group_warehouses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  customer_group_id INT NOT NULL,
  warehouse_code VARCHAR(20) NOT NULL,
  UNIQUE KEY uk_company_group_warehouse (company_id, customer_group_id, warehouse_code),
  INDEX idx_customer_group_id (customer_group_id),
  INDEX idx_warehouse_code (warehouse_code),
  FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- NOTE: the FK to warehouses(sap_warehouse_code) was dropped when
-- warehouses' primary key became composite (company_id, sap_warehouse_code)
-- — a single-column FK can no longer reference it. Application code must
-- itself match company_id when joining to warehouses (see sync.ts /
-- warehouseVisibility.ts).

-- Per-admin data scoping, n:n — which Customer Groups / Item Groups a
-- non-root admin user (admin_users, i.e. NOT the config.json bootstrap
-- "root"/super-admin, who is always unrestricted) may see and manage.
-- Default (no rows for that admin) = sees/manages NOTHING on scoped admin
-- pages — an explicit allow-list, not a deny-list; root must assign at
-- least one group before an admin can do anything on those pages. Assigning
-- a group also grants every descendant group underneath it (same downward
-- inheritance as Catalog Visibility) — see src/lib/adminScope.ts, which
-- every scoped admin route reads through.
CREATE TABLE IF NOT EXISTS admin_user_customer_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  admin_user_id INT NOT NULL,
  customer_group_id INT NOT NULL,
  UNIQUE KEY uk_company_admin_cg (company_id, admin_user_id, customer_group_id),
  INDEX idx_admin_user_id (admin_user_id),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Warehouses a (non-root) admin may work with: the Inventory page, the
-- "Self create" order dialog and the order page's warehouse picker. Codes
-- outside config.json masterdata.wareHouse are ignored; root always gets
-- every masterdata warehouse. None assigned = no warehouses (default-deny,
-- same as the group tables). Edited on Admin Users ("Warehouse" column).
CREATE TABLE IF NOT EXISTS admin_user_warehouses (
  company_id VARCHAR(50) NOT NULL,
  admin_user_id INT NOT NULL,
  warehouse_code VARCHAR(50) NOT NULL,
  PRIMARY KEY (company_id, admin_user_id, warehouse_code),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_user_item_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  admin_user_id INT NOT NULL,
  item_group_id INT NOT NULL,
  UNIQUE KEY uk_company_admin_ig (company_id, admin_user_id, item_group_id),
  INDEX idx_admin_user_id (admin_user_id),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_group_id) REFERENCES item_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SAP Customer Master cache (Business Partners) — mirrors `items` for
-- customers. Scoped to customer_groups pairs from the customer_groups table
-- (synced from SAP HANA — see syncCustomerGroupsFromHana — or added
-- manually via admin UI). Distinct from `users` (portal-registered accounts).
-- The `account` column is NULL by default; it is filled with the user's
-- email when a new customer signs up and admin approves the account.
CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  sap_card_code VARCHAR(50) NOT NULL,
  card_name VARCHAR(255),
  mst_code VARCHAR(50),
  price_list_num INT NULL,
  cus_grp01 VARCHAR(20) NULL,
  cus_grp02 VARCHAR(20) NULL,
  cus_grp03 VARCHAR(20) NULL,
  phone VARCHAR(50) NULL,
  email VARCHAR(255) NULL,
  address TEXT NULL,
  account VARCHAR(255) NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- SAP defaults used by the admin "Self create" order dialog:
  -- BilltoDefault / ShipToDefault (customer_addresses.address_name) and the
  -- BP's Sales Supervisor (U_CusSEL04 -> sales_supervisors.code).
  bill_to_default VARCHAR(100) NULL,
  ship_to_default VARCHAR(100) NULL,
  supervisor_code VARCHAR(50) NULL,
  last_synced TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_card_code (company_id, sap_card_code),
  INDEX idx_mst_code (mst_code),
  INDEX idx_cus_grp01 (cus_grp01),
  INDEX idx_cus_grp02 (cus_grp02)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Migration for an existing DB:
-- ALTER TABLE customers ADD COLUMN bill_to_default VARCHAR(100) NULL, ADD COLUMN ship_to_default VARCHAR(100) NULL,
--   ADD COLUMN supervisor_code VARCHAR(50) NULL;

-- Each SAP customer's bill-to / ship-to addresses (BusinessPartners.BPAddresses),
-- refreshed by the SAP Customers sync. Picked from in the admin "Self create"
-- order dialog; address_name is what SAP's PayToCode/ShipToCode expect.
CREATE TABLE IF NOT EXISTS customer_addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  sap_card_code VARCHAR(50) NOT NULL,
  address_type ENUM('bill_to', 'ship_to') NOT NULL,
  address_name VARCHAR(100) NOT NULL,
  full_address VARCHAR(1000),
  last_synced TIMESTAMP NULL,
  UNIQUE KEY uk_company_card_type_name (company_id, sap_card_code, address_type, address_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SAP "Sales Supervisor" list (user table U_MDM_CD_SEL04, the value list of
-- the U_CusSEL04 field on customers and sales orders), refreshed by the SAP
-- Customers sync.
CREATE TABLE IF NOT EXISTS sales_supervisors (
  company_id VARCHAR(50) NOT NULL,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  last_synced TIMESTAMP NULL,
  PRIMARY KEY (company_id, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration for existing databases:
-- ALTER TABLE customers ADD COLUMN account VARCHAR(255) NULL AFTER address;
-- ALTER TABLE customers ADD COLUMN is_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER account;

-- Scheduled Sync setting — ONE ROW PER COMPANY (company_id is the primary
-- key itself, not a surrogate `id`), root-editable on the Admin Settings
-- page. Replaces scripts/daily-sync.mjs's role (an external script
-- registered in Windows Task Scheduler that logs in over HTTP) with an
-- in-process scheduler — see src/instrumentation.ts, which runs once when
-- the server boots and polls THIS company's row every minute to decide
-- whether it's time to run runScheduledSync() (src/lib/sap-b1/
-- scheduledSync.ts) again. ONE combined schedule for every sync type (SAP
-- Customers, Items, Price Lists, Period Discount, Contract Discount,
-- Promotion Discount) per company, not a separate schedule per type —
-- simpler to configure, and matches the existing daily-sync.mjs's own
-- all-together behavior, just with Period Discount added (the one sync
-- type that script never covered at all). A row is lazily created for a
-- company the first time its settings are read/written (see
-- scheduledSync.ts) — there's no static bootstrap INSERT here, since a
-- fresh install doesn't know any company_id yet.
CREATE TABLE IF NOT EXISTS sync_schedule_settings (
  company_id VARCHAR(50) PRIMARY KEY,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  interval_hours INT NOT NULL DEFAULT 24,
  post_so_mode ENUM('draft','sales_order') NOT NULL DEFAULT 'draft',
  last_run_at TIMESTAMP NULL,
  last_run_status ENUM('success', 'partial', 'failed') NULL,
  last_run_summary TEXT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit Logs — append-only trail of login/logout (success AND failure) for
-- both admin and customer accounts, plus the highest-value business
-- events (admin user/role CRUD, customer approve/reject/create-BP, order
-- confirm/cancel on both the admin and customer side, customer signup/
-- order placement) — see src/lib/auditLog.ts's logAuditEvent(), the single
-- write path every one of those routes calls through.
-- actor_id is nullable (a failed login before any row matched has no id
-- yet); actor_label is a denormalized snapshot of the actor's email/name
-- at the time of the event — intentionally NOT a FK to admin_users/users,
-- same reasoning as order_messages.sender_name, so a log entry still
-- reads correctly even after that account is later renamed or removed.
-- entity_type/entity_id identify WHAT the action targeted (e.g. entity_type
-- 'order', entity_id the order's own id/order_number) — both NULL for a
-- pure auth event (login/logout) that has no target entity. details is
-- free-form JSON for whatever extra context that specific action wants
-- (old/new values, failure reason, ...) — never queried into, only read
-- back whole, so it doesn't need its own columns.
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id VARCHAR(50) NOT NULL,
  actor_type ENUM('admin', 'customer') NOT NULL,
  actor_id INT NULL,
  actor_label VARCHAR(255) NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NULL,
  entity_id VARCHAR(100) NULL,
  details JSON NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_company_created (company_id, created_at),
  INDEX idx_company_actor (company_id, actor_type, actor_id),
  INDEX idx_company_entity (company_id, entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
