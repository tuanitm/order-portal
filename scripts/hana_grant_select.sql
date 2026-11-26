/* ================================================================
   GRANT SELECT for the portal's read-only HANA user IMV_REPORT_RO
   (config.json hanadb.userId), schema "IMV" (production).

   Run as a HANA admin (SYSTEM, or the schema owner) in HANA Studio /
   SAP HANA Database Explorer. Read-only grants only. Re-running is
   harmless: granting a privilege the user already has is a no-op.

   Probed 2026-11-26: every table below is NOT readable yet in "IMV".
   Everything else the portal reads (OITM, OITW, OITB, OWHS, OCRD, CRD1,
   ORDR/RDR1, OINV/INV1, OBTQ, OBTN, OWDD/WDD1, OUSR, OUQR,
   @MDM_ID_ITEMCAT01..06, the Promotion Management tables, ...) is already
   granted. "IMV261104" (test) is already fully readable.
   ================================================================ */

-- 1. Inventory "By batch (R403)": batch quantity per bin location
GRANT SELECT ON "IMV"."OBBQ" TO IMV_REPORT_RO;   -- batch qty per bin
GRANT SELECT ON "IMV"."OBIN" TO IMV_REPORT_RO;   -- bin locations (code, description)
GRANT SELECT ON "IMV"."OBTW" TO IMV_REPORT_RO;   -- batch details per warehouse
GRANT SELECT ON "IMV"."IBT1" TO IMV_REPORT_RO;   -- batch transactions (aging by batch, like query Q688)

-- 2. Drafts: SO Approval / AR Invoice (CK) read draft documents today through the Service Layer
GRANT SELECT ON "IMV"."ODRF" TO IMV_REPORT_RO;   -- draft header
GRANT SELECT ON "IMV"."DRF1" TO IMV_REPORT_RO;   -- draft lines
GRANT SELECT ON "IMV"."DRF2" TO IMV_REPORT_RO;   -- draft line freight
GRANT SELECT ON "IMV"."DRF3" TO IMV_REPORT_RO;   -- draft header freight

-- 3. Master data used by the portal's lookups
GRANT SELECT ON "IMV"."OHEM" TO IMV_REPORT_RO;   -- employees (SAP order Owner)
GRANT SELECT ON "IMV"."ODIM" TO IMV_REPORT_RO;   -- dimensions ("Product Brand" = dimension 1)
GRANT SELECT ON "IMV"."OPLN" TO IMV_REPORT_RO;   -- price list names
GRANT SELECT ON "IMV"."OVTG" TO IMV_REPORT_RO;   -- VAT groups / rates
GRANT SELECT ON "IMV"."OITG" TO IMV_REPORT_RO;   -- item properties
GRANT SELECT ON "IMV"."CUFD" TO IMV_REPORT_RO;   -- user-defined field definitions
GRANT SELECT ON "IMV"."UFD1" TO IMV_REPORT_RO;   -- user-defined field valid values (descriptions)

-- 4. Pricing: special prices, period/volume discounts, blanket agreements
GRANT SELECT ON "IMV"."OSPP" TO IMV_REPORT_RO;   -- special prices for BP
GRANT SELECT ON "IMV"."SPP1" TO IMV_REPORT_RO;   -- special prices - date ranges
GRANT SELECT ON "IMV"."SPP2" TO IMV_REPORT_RO;   -- special prices - quantity ranges
GRANT SELECT ON "IMV"."OEDG" TO IMV_REPORT_RO;   -- discount groups
GRANT SELECT ON "IMV"."EDG1" TO IMV_REPORT_RO;   -- discount group lines
GRANT SELECT ON "IMV"."OOAT" TO IMV_REPORT_RO;   -- blanket agreements
GRANT SELECT ON "IMV"."OAT1" TO IMV_REPORT_RO;   -- blanket agreement lines
GRANT SELECT ON "IMV"."OAT2" TO IMV_REPORT_RO;   -- blanket agreement periods (used by query Q688)

/* Check afterwards (as IMV_REPORT_RO): each should return a row, not "insufficient privilege"
SELECT TOP 1 * FROM "IMV"."OBBQ";
SELECT TOP 1 * FROM "IMV"."ODRF";
*/
