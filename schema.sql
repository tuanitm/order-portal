-- =============================================================
-- Ordering Portal Database Schema
-- Database: orderdatasource (existing)
-- =============================================================

-- Users & Authentication
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(20) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  mst_code VARCHAR(50),
  sap_card_code VARCHAR(50),
  sap_card_name VARCHAR(255),
  sap_price_list_num INT NULL,
  sap_cus_grp01 VARCHAR(20) NULL,
  sap_cus_grp02 VARCHAR(20) NULL,
  sap_cus_grp03 VARCHAR(20) NULL,
  language ENUM('vi', 'en') DEFAULT 'vi',
  is_active BOOLEAN DEFAULT TRUE,
  approval_status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  approved_at TIMESTAMP NULL,
  approved_by VARCHAR(255) NULL,
  rejection_reason TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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

-- Migration for existing databases: run `node migrate_pricing.js` to add
-- sap_price_list_num, items_group_code and the item_channel_prices table.
-- Then run `node migrate_admin.js` to add the admin management tables below.
-- Then run `node migrate_item_categories.js` for the ItemCat01-06 hierarchy
-- (replaces the old OITB-based group sellability gate — see item_groups below).
-- Then run `node migrate_contract_discount.js` for the contract_discount table.
-- Then run `node migrate_sap_customers.js` for the customers table.

-- Product Cache (synced from SAP B1). is_active is purely sync-driven
-- (reflects the current sellable-category filter); is_manually_hidden is a
-- separate admin override that survives resyncs.
CREATE TABLE IF NOT EXISTS items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sap_item_code VARCHAR(50) UNIQUE NOT NULL,
  item_name_vi VARCHAR(255),
  item_name_en VARCHAR(255),
  uom VARCHAR(20),
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
  is_active BOOLEAN DEFAULT TRUE,
  is_manually_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_category (category),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Item Groups (SAP BusinessOne UDFs Items.U_ItemCat01..06 — a 6-level
-- merchandising hierarchy, replaces the old OITB-based item groups as the
-- sellability gate). Master category names aren't exposed via SAP Service
-- Layer (the backing @AMDM_ID_ITEMCAT01-06 UDTs return "Service Not
-- Found"), so codes and names are added manually via itemgroup.json (see
-- src/lib/itemCategories.ts) — never synced automatically from SAP. Which
-- (ItemCat01, ItemCat02) pairs are declared there is also the sync scope
-- for which items get pulled from SAP at all (see syncItems in sync.ts).
-- is_active is a per-row admin on/off switch at ANY level: turning a group
-- off removes it (and, for level 1/2, its pair) from the sync scope, so
-- items under it stop being pulled from SAP and are left/marked inactive
-- (items.is_active = FALSE) rather than deleted. Re-imports never touch
-- this column, so the toggle survives a re-import of SAP_Item_Group.xlsx.
CREATE TABLE IF NOT EXISTS item_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  level TINYINT NOT NULL,
  code VARCHAR(20) NOT NULL,
  parent_code VARCHAR(20) NULL,
  name VARCHAR(255) NULL,
  is_sellable BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uk_level_code (level, code)
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
  sap_item_code VARCHAR(50) NOT NULL,
  price_list_num INT NOT NULL,
  base_price_list_num INT NULL,
  factor DECIMAL(10,4) NULL DEFAULT 1,
  price DECIMAL(18,2) NOT NULL DEFAULT 0,
  last_synced TIMESTAMP NULL,
  UNIQUE KEY uk_item_pricelist (sap_item_code, price_list_num),
  INDEX idx_item_code (sap_item_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration for existing databases:
-- ALTER TABLE item_channel_prices ADD COLUMN base_price_list_num INT NULL AFTER price_list_num;
-- ALTER TABLE item_channel_prices ADD COLUMN factor DECIMAL(10,4) NULL DEFAULT 1 AFTER base_price_list_num;

-- Special Prices (synced from SAP B1)
CREATE TABLE IF NOT EXISTS special_prices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sap_card_code VARCHAR(50) NOT NULL,
  sap_item_code VARCHAR(50) NOT NULL,
  special_price DECIMAL(18,2) NOT NULL,
  discount_percent DECIMAL(5,2),
  valid_from DATE,
  valid_to DATE,
  last_synced TIMESTAMP NULL,
  UNIQUE KEY uk_bp_item (sap_card_code, sap_item_code),
  INDEX idx_card_code (sap_card_code),
  INDEX idx_item_code (sap_item_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contract Discounts (synced from SAP B1 CBD — @MDM_CD_CBD_H/@MDM_CD_CBD_L).
-- One row per (header, line): a header targets a customer (specific
-- CardCode or a customer_groups level 1-3 code); each line targets items
-- (a specific ItemCode or an item_groups level 1-6 code) with a
-- discount percentage. U_Type/U_TypeName encode which targeting mode
-- applies — see sync.ts CONTRACT_DISCOUNT_TYPE constants.
CREATE TABLE IF NOT EXISTS contract_discount (
  id INT AUTO_INCREMENT PRIMARY KEY,
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
  UNIQUE KEY uk_doc_line (doc_entry, line_id),
  INDEX idx_code_cust (u_code_cust),
  INDEX idx_code_item (u_code_item)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Promotion Discounts (synced from SAP B1 via custom SQL query).
-- Flat rows mapping a Promotion -> BP/Group -> Item/Group -> Discount/Free Item.
CREATE TABLE IF NOT EXISTS promotion_discount (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doc_entry INT NOT NULL,
  promotion_code VARCHAR(50),
  promotion_name VARCHAR(255),
  create_date DATE,
  update_date DATE,
  begin_date DATE,
  end_date DATE,
  bp_grp_code VARCHAR(50),
  bp_grp_name VARCHAR(255),
  bp_code VARCHAR(50),
  bp_name VARCHAR(255),
  selling_grp_code VARCHAR(50),
  selling_grp_name VARCHAR(255),
  selling_item_code VARCHAR(50),
  selling_item_name VARCHAR(255),
  disc_pct DECIMAL(6,2),
  selling_qty DECIMAL(18,2),
  giving_item_code VARCHAR(50),
  giving_item_name VARCHAR(255),
  giving_qty DECIMAL(18,2),
  last_synced TIMESTAMP NULL,
  INDEX idx_bp_code (bp_code),
  INDEX idx_selling_item_code (selling_item_code),
  INDEX idx_active_dates (begin_date, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Promotions
CREATE TABLE IF NOT EXISTS promotions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  promo_code VARCHAR(50),
  title_vi VARCHAR(255),
  title_en VARCHAR(255),
  description_vi TEXT,
  description_en TEXT,
  discount_type ENUM('percent', 'amount', 'buy_x_get_y') NOT NULL,
  discount_value DECIMAL(18,2),
  min_qty INT,
  applicable_items JSON,
  applicable_bps JSON,
  valid_from DATE,
  valid_to DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_active_dates (is_active, valid_from, valid_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(30) UNIQUE NOT NULL,
  user_id INT NOT NULL,
  customer_name VARCHAR(255),
  delivery_address TEXT,
  contact_phone VARCHAR(20),
  contact_email VARCHAR(255),
  subtotal DECIMAL(18,2) DEFAULT 0,
  discount_total DECIMAL(18,2) DEFAULT 0,
  grand_total DECIMAL(18,2) DEFAULT 0,
  remark TEXT,
  status ENUM('draft','submitted','processing','sap_draft_created','approved','rejected','completed')
         DEFAULT 'draft',
  sap_doc_entry INT,
  sap_doc_num INT,
  language ENUM('vi', 'en') DEFAULT 'vi',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user (user_id),
  INDEX idx_status (status),
  INDEX idx_order_number (order_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Order Lines
CREATE TABLE IF NOT EXISTS order_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  sap_item_code VARCHAR(50) NOT NULL,
  item_name VARCHAR(255),
  quantity INT NOT NULL,
  uom VARCHAR(20),
  unit_price DECIMAL(18,2) NOT NULL,
  discount_percent DECIMAL(5,2) DEFAULT 0,
  line_total DECIMAL(18,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================
-- Admin Management
-- =============================================================

-- Admin Roles ("user group") — a fixed list of section keys the role may access
CREATE TABLE IF NOT EXISTS admin_roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255),
  permissions JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin Users — in addition to the config.json bootstrap super-admin
CREATE TABLE IF NOT EXISTS admin_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role_id INT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES admin_roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Price Lists (synced from SAP B1 PriceLists) — admin marks base vs channel lists
CREATE TABLE IF NOT EXISTS price_lists (
  price_list_num INT PRIMARY KEY,
  list_name VARCHAR(255),
  is_base BOOLEAN DEFAULT FALSE,
  is_channel BOOLEAN DEFAULT FALSE,
  last_synced TIMESTAMP NULL
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
  level TINYINT NOT NULL,
  code VARCHAR(20) NOT NULL,
  parent_code VARCHAR(20) NULL,
  name VARCHAR(255) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uk_level_code (level, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Migration for an existing DB:
-- ALTER TABLE customer_groups ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Catalog Visibility — default: which item categories (item_groups,
-- levels 1-3) a customer group may browse/order
CREATE TABLE IF NOT EXISTS catalog_visibility (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_group_id INT NOT NULL,
  item_category_level TINYINT NOT NULL,
  item_category_code VARCHAR(20) NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uk_group_itemcat (customer_group_id, item_category_level, item_category_code),
  INDEX idx_customer_group_id (customer_group_id),
  FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Catalog Visibility — per-customer override, wins over the group default
CREATE TABLE IF NOT EXISTS customer_item_group_overrides (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  item_category_level TINYINT NOT NULL,
  item_category_code VARCHAR(20) NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uk_user_itemcat (user_id, item_category_level, item_category_code),
  INDEX idx_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SAP Customer Master cache (Business Partners) — mirrors `items` for
-- customers. Scoped to customer_groups pairs from the customer_groups table
-- (imported from SAP_Customer_Group.xlsx or added manually via admin UI).
-- Distinct from `users` (portal-registered accounts).
-- The `account` column is NULL by default; it is filled with the user's
-- email when a new customer signs up and admin approves the account.
CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sap_card_code VARCHAR(50) UNIQUE NOT NULL,
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
  last_synced TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mst_code (mst_code),
  INDEX idx_cus_grp01 (cus_grp01),
  INDEX idx_cus_grp02 (cus_grp02)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration for existing databases:
-- ALTER TABLE customers ADD COLUMN account VARCHAR(255) NULL AFTER address;
