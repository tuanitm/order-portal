/* ================================================================
   PROMOTION PROGRAM DETAIL REPORT
   SAP Business One - SAP HANA

   Output:
     Promotion
       -> Business Partner / BP Group
       -> Selling Item / Selling Item Group
       -> Discount % OR Free Item

   DiscountType:
       P = Percentage Discount
       I = Free Item

   BP Apply Type:
       2             = Single Business Partner
       UDO_PM_GRP_BP = Business Partner Group

   Selling Item Type:
       4               = Single Item
       UDO_PM_GRP_ITEM = Item Group
   ================================================================ 
   @PM_HEADER
   PM_APPLYBP
   PM_SELLING_ITEMS   
   */
WITH
/* ================================================================
   1. EXPAND PROMOTION BUSINESS PARTNERS
   ================================================================ */
"BP_EXPANDED" AS
(
    /* ------------------------------------------------------------
       Single Business Partner
       PM_APPLYBP.Type = '2'
       ------------------------------------------------------------ */
    SELECT DISTINCT
        A."DocEntry"                       AS "DocEntry",
        A."VisOrder"                       AS "BPLineNum",

        CAST(NULL AS NVARCHAR(50))         AS "BPGrpCode",
        CAST(NULL AS NVARCHAR(254))        AS "BPGrpName",

        A."Code"                           AS "BPCode",
        IFNULL(BP."CardName", A."Name")    AS "BPName"

    FROM "PM_APPLYBP" A

    LEFT JOIN "OCRD" BP
        ON BP."CardCode" = A."Code"

    WHERE A."Type" = '2'
    
    -- GET FMCG GT ONLY
    /*
    AND BP."U_CusGrp02" 
    IN('GTSO','GTNO','GTSE','GTMK')
    AND (BP."U_CusCCDept"='HCMD01')
    */

    UNION ALL

    /* ------------------------------------------------------------
       Business Partner Group
       PM_APPLYBP.Type = 'UDO_PM_GRP_BP'

       PM_APPLYBP.Code
            -> @PM_GRP_BP.Code
            -> PM_GRP_BP_DETAILS
            -> individual BP
       ------------------------------------------------------------ */
    SELECT DISTINCT
        A."DocEntry"                       AS "DocEntry",
        A."VisOrder"                       AS "BPLineNum",

        G."Code"                           AS "BPGrpCode",
        G."Name"                           AS "BPGrpName",

        BP."CardCode"                      AS "BPCode",
        IFNULL(BP."CardName", D."Name")    AS "BPName"

    FROM "PM_APPLYBP" A

    INNER JOIN "@PM_GRP_BP" G
        ON G."Code" = A."Code"

    INNER JOIN "PM_GRP_BP_DETAILS" D
        ON D."DocEntry" = G."DocEntry"

    LEFT JOIN "OCRD" BP
        ON ((D."Type" = 'B' AND BP."CardCode" = D."Code")
		OR (D."Type" = 'CG1' AND BP."U_CusGrp01" = D."Code")
		OR (D."Type" = 'CG2' AND BP."U_CusGrp02" = D."Code")
		OR (D."Type" = 'CG3' AND BP."U_CusGrp03" = D."Code"))

    WHERE A."Type" = 'UDO_PM_GRP_BP'

      /* Excluded BP should not be considered part of group */
      AND IFNULL(D."Exclude", 'N') <> 'Y'
      
      -- GET FMCG GT ONLY
      /*
      AND BP."U_CusGrp01" = 'GT' 
      AND BP."U_CusGrp02" 
      IN('GTSO','GTNO','GTSE','GTMK')
      AND (BP."U_CusCCDept" = 'HCMD01')
      */
),


/* ================================================================
   2. EXPAND PROMOTION SELLING ITEMS
   ================================================================ */
"ITEM_EXPANDED" AS
(
    /* ------------------------------------------------------------
       Single Item
       PM_SELLING_ITEMS.Type = '4'
       ------------------------------------------------------------ */
    SELECT DISTINCT 
        S."DocEntry"                       AS "DocEntry",
        S."LineNum"                        AS "LineNum",
        S."VisOrder"                       AS "ItemVisOrder",

        CAST(NULL AS NVARCHAR(50))         AS "SellingGrpCode",
        CAST(NULL AS NVARCHAR(254))        AS "SellingGrpName",

        S."Code"                           AS "SellingItemCode",
        IFNULL(I."ItemName", S."Name")     AS "SellingItemName",

        S."BreakBy"                        AS "BreakBy",
        S."FrSelling"                      AS "FrSelling",
        S."ToSelling"                      AS "ToSelling",
        S."MinSelling"                     AS "MinSelling",

        S."DiscountType"                   AS "DiscountType",
        S."DiscountValue"                  AS "DiscountValue",

        S."FreeItemCode"                   AS "FreeItemCode",
        IFNULL(F."ItemName",
               S."FreeItemName")           AS "FreeItemName"

    FROM "PM_SELLING_ITEMS" S

    LEFT JOIN "OITM" I
        ON I."ItemCode" = S."Code"

    LEFT JOIN "OITM" F
        ON F."ItemCode" = S."FreeItemCode"

    WHERE S."Type" = '4'
    
    -- GET PIGEON, ETSUKO ONLY
    AND I."U_ItemCat01" IN('D1','L1','A1','A2')


    UNION ALL

    /* ------------------------------------------------------------
       Selling Item Group
       PM_SELLING_ITEMS.Type = 'UDO_PM_GRP_ITEM'

       PM_SELLING_ITEMS.Code
            -> @PM_GRP_ITEM.Code
            -> PM_GRP_ITEM_DETAILS
            -> ItemCode
       ------------------------------------------------------------ */
    SELECT DISTINCT 
        S."DocEntry"                       AS "DocEntry",
        S."LineNum"                        AS "LineNum",
        S."VisOrder"                       AS "ItemVisOrder",

        G."Code"                           AS "SellingGrpCode",
        G."Name"                           AS "SellingGrpName",

        I."ItemCode"                       AS "SellingItemCode",
        IFNULL(I."ItemName",
               D."ItemName")               AS "SellingItemName",

        S."BreakBy"                        AS "BreakBy",
        S."FrSelling"                      AS "FrSelling",
        S."ToSelling"                      AS "ToSelling",
        S."MinSelling"                     AS "MinSelling",

        S."DiscountType"                   AS "DiscountType",
        S."DiscountValue"                  AS "DiscountValue",

        S."FreeItemCode"                   AS "FreeItemCode",
        IFNULL(F."ItemName",
               S."FreeItemName")           AS "FreeItemName"

    FROM "PM_SELLING_ITEMS" S

    INNER JOIN "@PM_GRP_ITEM" G
        ON G."Code" = S."Code"

    INNER JOIN "PM_GRP_ITEM_DETAILS" D
        ON D."DocEntry" = G."DocEntry"

    LEFT JOIN "OITM" I
        ON ((D."Type" = 'I' AND I."ItemCode" = D."Code")
        OR (D."Type" = 'IC1' AND I."U_ItemCat01" = D."Code")
        OR (D."Type" = 'IC2' AND I."U_ItemCat02" = D."Code")
        OR (D."Type" = 'IC3' AND I."U_ItemCat03" = D."Code")
        OR (D."Type" = 'IC4' AND I."U_ItemCat04" = D."Code")
        OR (D."Type" = 'IC5' AND I."U_ItemCat05" = D."Code")
        OR (D."Type" = 'IC6' AND I."U_ItemCat05" = D."Code"))

    LEFT JOIN "OITM" F
        ON F."ItemCode" = S."FreeItemCode"

    WHERE S."Type" = 'UDO_PM_GRP_ITEM'

      /* Excluded item should not be expanded */
      AND IFNULL(D."Exclude", 'N') <> 'Y'
      
      -- GET PIGEON, ETSUKO ONLY
      AND I."U_ItemCat01" IN('D1','L1','A1','A2')
)

/* ================================================================
   3. FINAL RESULT
   ================================================================ */
SELECT DISTINCT 

    /* ---------------- Promotion ---------------- */
    H."DocEntry"						  AS "doc_entry",
    H."Code"                              AS "promotion_code",
    H."Name"                              AS "promotion_name",

    H."CreateDate"                        AS "create_date",
    H."UpdateDate"                        AS "update_date",

    H."U_StartDate"                       AS "begin_date",
    H."U_EndDate"                         AS "end_date",
    H."U_AfterCusDisc"                    AS "after_cus_disc",
    H."U_AfterPriceDisc"                  AS "after_price_disc",
    IT."DiscountType"                     AS "disc_type",

    /* ---------------- Business Partner ---------------- */
    BP."BPGrpCode"                        AS "bp_grp_code",
    BP."BPGrpName"                        AS "bp_grp_name",

    BP."BPCode"                           AS "bp_code",
    BP."BPName"                           AS "bp_name",

    /* ---------------- Selling Item ---------------- */
    IT."SellingGrpCode"                   AS "selling_grp_code",
    IT."SellingGrpName"                   AS "selling_grp_name",

    IT."SellingItemCode"                  AS "selling_item_code",
    IT."SellingItemName"                  AS "selling_item_name",

    /* ============================================================
       Percentage Discount

       DiscountType = P
       DiscountValue = %
       ============================================================ */
    CASE
        WHEN IT."DiscountType" = 'P'
        THEN IT."DiscountValue"
        ELSE NULL
    END                                   AS "disc_pct",

    /* ============================================================
       Buying / Selling Quantity

       For quantity-based promotion:
           FrSelling = required buying quantity

       Example:
           Buy 10 -> Give 2
           selling_qty = 10
       ============================================================ */
    CASE
        WHEN IFNULL(IT."BreakBy",
                    H."U_BreakBy") = 'Q'
        THEN IT."FrSelling"
        ELSE NULL
    END                                   AS "selling_qty",

    /* ============================================================
       Giving Item

       Only applicable when DiscountType = I
       ============================================================ */
    CASE
        WHEN IT."DiscountType" = 'I'
        THEN IT."FreeItemCode"
        ELSE NULL
    END                                   AS "giving_item_code",

    CASE
        WHEN IT."DiscountType" = 'I'
        THEN IT."FreeItemName"
        ELSE NULL
    END                                   AS "giving_item_name",


    /* ============================================================
       Giving Quantity

       DiscountType = I:
           DiscountValue = free quantity

       Example:
           FrSelling     = 10
           DiscountValue = 2

           Buy 10 -> Give 2
       ============================================================ */
    CASE
        WHEN IT."DiscountType" = 'I'
        THEN IT."DiscountValue"
        ELSE NULL
    END                                   AS "giving_qty"


FROM "@PM_HEADER" H

LEFT OUTER JOIN "BP_EXPANDED" BP
    ON BP."DocEntry" = H."DocEntry"

LEFT OUTER JOIN "ITEM_EXPANDED" IT
    ON IT."DocEntry" = H."DocEntry"   

/* ================================================================
   FILTER
   ================================================================ */
WHERE 
IFNULL("U_Status", 'N') = 'R' 
AND IFNULL(H."Canceled", 'N') <> 'Y'
-- Not Get MT, BB
AND IFNULL(H."U_Prefix", 'GT') <> 'MT'
AND IFNULL(H."U_Prefix", 'GT') <> 'BB'
-- TEST
-- AND H."DocEntry" = 35

ORDER BY
    H."U_StartDate" DESC,
    H."Code",
    BP."BPGrpCode",
    BP."BPCode",
    IT."SellingGrpCode",
    IT."SellingItemCode"
    --IT."LineNum";