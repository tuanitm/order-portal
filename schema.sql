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

-- Product Cache (synced from SAP B1)
CREATE TABLE IF NOT EXISTS items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sap_item_code VARCHAR(50) UNIQUE NOT NULL,
  item_name_vi VARCHAR(255),
  item_name_en VARCHAR(255),
  uom VARCHAR(20),
  pack_size VARCHAR(50),
  category VARCHAR(100),
  base_price DECIMAL(18,2) DEFAULT 0,
  image_url VARCHAR(500),
  is_active BOOLEAN DEFAULT TRUE,
  last_synced TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_category (category),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
