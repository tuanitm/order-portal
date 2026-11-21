
/* SELECT * FROM OJDT T0 WHERE T0."RefDate"='[%0]'; */
/* SELECT * FROM OCRD T1 WHERE T1."CardCode"='[%1]'; */
/* SELECT * FROM OACT T2 WHERE T2."AcctCode"='[%2]'; */
/* SELECT * FROM OCRD T3 WHERE T3."U_CusGrp01"='[%3]'; */
/* SELECT * FROM OINV T5 WHERE T5."U_ProdBrand"='[%4]'; */

-- pRefDate := '20350101'; --test
-- pCardCode := '*'; --test
-- pAcctCode := '*'; --test
-- pCusGrp01 := '*'; --test

declare pRefDate date = '[%0]';
declare pCardCode nvarchar(50) = '[%1]';
declare pAcctCode nvarchar(50) = '[%2]';
declare pCusGrp01 nvarchar(50) = '[%3]';
declare pProdBrand nvarchar(50) = '[%4]';

SELECT 
    Y."BaseRef" "DocNum",
    Y."BrCode",
    ProfitCtr."OcrName" AS "BrName",
    Y."CorpCode",
    Y."CorpName",
    Y."GrpCustCode",
    Y."GrpCustName",
    Y."CustCode",
    Y."Cust.Code2",
    Y."Cust.Name",
    Y."Cr.Limit",
    Y."Doc.No",
    Y."SO.No",
    Y."Doc.No" AS "BA.No",
    Y."SI.No",
	Y."U_NumAtCard" as "Reference No.",    
	Y."DocEntry",
	Y."TransType" as "ObjType",
    Y."Inv.No",
    to_nvarchar(Y."Inv.Date",'dd/MM/yyyy') as "Inv.Date",
    to_nvarchar(Y."DueDate",'dd/MM/yyyy') as "DueDate",
    Y."OverdueDays" AS "Ages",
    Y."Amount" AS "InvAmt",
    Y."RemainAmount" AS "InvBal",
    CASE WHEN Y."OverdueDays" < 0 THEN Y."RemainAmount" ELSE 0 END AS "NotDue",
    CASE WHEN Y."OverdueDays" BETWEEN 0 AND 15 THEN Y."RemainAmount" ELSE 0 END AS "D15",
    CASE WHEN Y."OverdueDays" > 15 AND Y."OverdueDays" <= 30 THEN Y."RemainAmount" ELSE 0 END AS "D30",
    CASE WHEN Y."OverdueDays" > 30 AND Y."OverdueDays" <= 45 THEN Y."RemainAmount" ELSE 0 END AS "D45",
    CASE WHEN Y."OverdueDays" > 45 AND Y."OverdueDays" <= 60 THEN Y."RemainAmount" ELSE 0 END AS "D60",
    CASE WHEN Y."OverdueDays" > 60 AND Y."OverdueDays" <= 90 THEN Y."RemainAmount" ELSE 0 END AS "D90",
    CASE WHEN Y."OverdueDays" > 90 AND Y."OverdueDays" <= 180 THEN Y."RemainAmount" ELSE 0 END AS "D180",
    CASE WHEN Y."OverdueDays" > 180 THEN Y."RemainAmount" ELSE 0 END AS "D181",

    Y."SSCode",
    CusSE."Name" "SSName",

	Y."TransactionType" as "Trans. Type Code",
	Y."TransTypeName" as "Trans. Type Name",
    Y."Notes",
    Y."AddlNotes" as "Notes (Additional)",
    
    Y."ShipToCode" as "ShipToCode",
    Y."ShipToName" as "ShipToName",
    Y."ShipToAddress2" as "ShipToAddress2",
    Y."ShipToBuyer" as "ShipToBuyer",
    Y."Account" "Control Account"
FROM (
    SELECT 
        X.*,
        CASE 
            WHEN (X."Amount" - X."PaidAmount") <> 0 THEN DAYS_BETWEEN(X."DueDate", :pRefDate)
            ELSE NULL 
        END AS "OverdueDays",
        CASE
            WHEN X."PaidAmount" > 0 AND X."Amount" < 0 THEN X."PaidAmount" * -1.0
            WHEN X."PaidAmount" < 0 AND X."Amount" > 0 THEN X."PaidAmount" * -1.0
            ELSE X."PaidAmount"
        END AS "PaidAmountCalc",
        CASE
            WHEN X."PaidAmount" > 0 AND X."Amount" < 0 THEN X."Amount" - (X."PaidAmount" * -1.0)
            WHEN X."PaidAmount" < 0 AND X."Amount" > 0 THEN X."Amount" - (X."PaidAmount" * -1.0)
            ELSE X."Amount" - X."PaidAmount"
        END AS "RemainAmount"
        
    FROM (
        SELECT 
            COALESCE(
                nullif(ifnull(nullif(JdtLine."U_ProdBrand",''),JdtLine."ProfitCode"),''),
                CASE 
                    WHEN Jdt."TransType" = 13 THEN COALESCE(NULLIF(ar."OcrCode",''), ar."U_ProdBrand")
                    WHEN Jdt."TransType" = 14 THEN COALESCE(NULLIF(arc."OcrCode",''), arc."U_ProdBrand")
                    WHEN Jdt."TransType" = 24 THEN ip."OcrCode"
                    WHEN Jdt."TransType" = 46 THEN op."OcrCode"
                    ELSE NULL
                END
            ) AS "BrCode",
            Comp."AliasName" AS "CorpCode",
            Comp."CompnyName" AS "CorpName",
            IFNULL(Cust."FatherCard", Cust."CardCode") AS "GrpCustCode",
            IFNULL(CustGrp."CardName", Cust."CardName") AS "GrpCustName",
            Cust."CardCode" AS "CustCode",
            Cust."U_BPOldCode" AS "Cust.Code2",
            Cust."CardName" AS "Cust.Name",
            Cust."CreditLine" AS "Cr.Limit",
            Jdt."BaseRef",
            Jdt."TransType",
			CASE 
                WHEN Jdt."TransType" = 13 THEN TO_NVARCHAR(ar."DocEntry")
                WHEN Jdt."TransType" = 14 THEN TO_NVARCHAR(arc."DocEntry")
                WHEN Jdt."TransType" = 30 THEN CAST(Jdt."TransId" AS NVARCHAR) 
                WHEN Jdt."TransType" = 24 THEN TO_NVARCHAR(ip."DocEntry")
                WHEN Jdt."TransType" = 46 THEN TO_NVARCHAR(op."DocEntry")
            END AS "DocEntry",
			
            CASE 
                WHEN Jdt."TransType" = 13 THEN 'A/R Invoice'
                WHEN Jdt."TransType" = 14 THEN 'A/R Credit Memo'
                WHEN Jdt."TransType" = 30 THEN 'Journal Entry'
                WHEN Jdt."TransType" = 24 THEN 'Incoming Payment'
                WHEN Jdt."TransType" = 46 THEN 'Outgoing Payment'
            END AS "DocType",

            CASE 
                WHEN Jdt."TransType" = 13 THEN TO_NVARCHAR(ar."U_NumAtCard")
                WHEN Jdt."TransType" = 14 THEN TO_NVARCHAR(arc."U_NumAtCard")
            END AS "U_NumAtCard",
    
            -- Số chứng từ
            CASE 
                WHEN Jdt."TransType" = 13 THEN CAST(Jdt."BaseRef" AS NVARCHAR)
                WHEN Jdt."TransType" = 14 THEN CAST(Jdt."BaseRef" AS NVARCHAR)
                WHEN Jdt."TransType" = 30 THEN CAST(Jdt."Number" AS NVARCHAR)
                WHEN Jdt."TransType" IN (24,46) THEN CAST(Jdt."BaseRef" AS NVARCHAR)
            END AS "DocNum",
            
            CASE 
                WHEN Jdt."TransType" = 13 THEN TO_NVARCHAR(ar."U_DocNo")
                WHEN Jdt."TransType" = 14 THEN TO_NVARCHAR(arc."U_DocNo")
                WHEN Jdt."TransType" = 30 THEN CAST(Jdt."U_DocNo" AS NVARCHAR) 
                WHEN Jdt."TransType" IN (24,46) THEN CAST(Jdt."U_DocNo" AS NVARCHAR)
            END AS "Doc.No",
            
            Jdt."U_DocNo" AS "SI.No",
    
            -- Số hóa đơn / số chứng từ khách hàng
			JdtLine."U_InvSeri" || JdtLine."U_InvNo" as "Inv.No",
    
            -- Ngày hóa đơn
            CASE 
                WHEN Jdt."TransType" = 13 THEN TO_NVARCHAR(IFNULL(NULLIF(ar."U_CN_InvDate",''),ar."U_InvDate"))
                WHEN Jdt."TransType" = 14 THEN TO_NVARCHAR(arc."U_CN_InvDate")
                WHEN Jdt."TransType" = 30 THEN COALESCE(NULLIF(JdtLine."U_InvDate",''),Jdt."RefDate")
                WHEN Jdt."TransType" IN (24,46) THEN JdtLine."U_InvDate"
            END AS "Inv.Date",
    
            Jdt."RefDate" AS "PostingDate",
            Jdt."DueDate" AS "DueDate",
            JdtLine."Account",
            JdtLine."ContraAct",
    
            -- Giá trị gốc
            CASE 
                WHEN Jdt."TransType" IN (13,14,46) THEN JdtLine."Debit" - JdtLine."Credit"
                WHEN Jdt."TransType" = 30 AND (JdtLine."Debit" - JdtLine."Credit") > 0 THEN JdtLine."Debit" - JdtLine."Credit"
                WHEN Jdt."TransType" = 30 AND (JdtLine."Debit" - JdtLine."Credit") < 0 AND IFNULL(JdtLine."MthDate",'') = '' THEN JdtLine."Debit" - JdtLine."Credit"
                WHEN Jdt."TransType" = 30 AND (JdtLine."Debit" - JdtLine."Credit") < 0 AND IFNULL(JdtLine."MthDate",'') <> '' THEN 
                     (IFNULL(JdtLine."Debit",0) - IFNULL(JdtLine."Credit",0)) - IFNULL(ReconD."Gia_Tri",0)
                WHEN Jdt."TransType" = 24 AND IFNULL(JdtLine."MthDate",'') = '' THEN JdtLine."Debit" - JdtLine."Credit"
                WHEN Jdt."TransType" = 24 AND IFNULL(JdtLine."MthDate",'') <> '' THEN 
                     (IFNULL(JdtLine."Debit",0) - IFNULL(JdtLine."Credit",0)) - IFNULL(ReconD."Gia_Tri",0)
                ELSE 0
            END AS "Amount",
    
            -- Giá trị đã thanh toán (đã chuẩn hóa)
            CASE
                WHEN Jdt."TransType" IN (13,14,46)
                     OR (Jdt."TransType" = 30 AND (JdtLine."Debit" - JdtLine."Credit") > 0)
                THEN IFNULL(ReconD."Gia_Tri", 0)
                ELSE 0
            END AS "PaidAmount",
    
            CustGrpDef."GroupName" AS "BPGroup",
            IFNULL(PayTerm."ExtraDays",0) AS "PaymentTerm",
            
            case 
                when jdt."TransType"=13 then invAdr."ShipToCode"
                when jdt."TransType"=14 then invCreAdr."ShipToCode"
                else cusAdr."ShipToCode" end "ShipToCode",
            case 
                when jdt."TransType"=13 then invAdr."ShipToName"
                when jdt."TransType"=14 then invCreAdr."ShipToName"
                else cusAdr."ShipToName" end "ShipToName",
            case 
                when jdt."TransType"=13 then invAdr."Address2S"
                when jdt."TransType"=14 then invCreAdr."Address2S"
                else cusAdr."Address2" end "ShipToAddress2",
            case 
                when jdt."TransType"=13 then invAdr."U_BPBuyerS"
                when jdt."TransType"=14 then invCreAdr."U_BPBuyerS"
                else cusAdr."U_BPBuyer" end "ShipToBuyer",
            
	        COALESCE(AR."U_CusSEL04", ARC."U_CusSEL04") AS "SSCode",
	        --COALESCE(AR."Comments", ARC."Comments", IP."Comments", OP."Comments") AS "Notes",
			
			JdtLine."U_TransType" as "TransactionType",
			sy01."Name" as "TransTypeName",
			JdtLine."LineMemo" as "Notes",
			JdtLine."U_AddlNotes" as "AddlNotes",
			
	        SO."U_DocNo" AS "SO.No"
        FROM OJDT Jdt
        JOIN JDT1 JdtLine ON Jdt."TransId" = JdtLine."TransId"
        JOIN OCRD Cust ON JdtLine."ShortName" = Cust."CardCode"
        LEFT JOIN OCRD CustGrp ON Cust."FatherCard" = CustGrp."CardCode"
        LEFT JOIN OCTG PayTerm ON Cust."GroupNum" = PayTerm."GroupNum"
        LEFT JOIN OCRG CustGrpDef ON CustGrpDef."GroupCode" = Cust."GroupCode"
        left join "@SYS_GE_TRANSTYPE" sy01 on sy01."Code" = JdtLine."U_TransType"
    
        -- Tổng hợp các giao dịch đối ứng (Reconciliation)
        LEFT JOIN (
            SELECT "ShortName","TransId","TransRowId",IFNULL(SUM("ReconSum"),0) AS "Gia_Tri"
            FROM "uv_GetReconSum_Debit"
            WHERE "ReconDate" BETWEEN '1999-09-17' AND :pRefDate
            GROUP BY "ShortName","TransId","TransRowId"
        ) ReconD ON ReconD."ShortName" = Cust."CardCode" 
                 AND JdtLine."TransId" = ReconD."TransId" 
                 AND JdtLine."Line_ID" = ReconD."TransRowId"
        LEFT JOIN OADM Comp ON 1=1
        
        left join ( select "CardCode", max(CRD1."Address") as "ShipToCode", max(CRD1."U_BPAddress") as "ShipToName", max(CRD1."Address2") as "Address2", max(CRD1."U_BPBuyer") as "U_BPBuyer"
            from CRD1
            where "AdresType" = 'S'
            group by "CardCode"
        ) cusAdr on cust."CardCode"=cusAdr."CardCode"
        
        left join( select b."DocNum", b."ShipToCode", b."Address2" "ShipToName", max(a."Address2S") as "Address2S", max(a."U_BPBuyerS") as "U_BPBuyerS"
            from INV12 a join OINV b on a."DocEntry"=b."DocEntry"
            group by b."DocNum",b."ShipToCode", b."Address2"
        ) invAdr on Jdt."BaseRef"=invAdr."DocNum"  AND Jdt."TransType" = 13
        
        left join( select b."DocNum", b."ShipToCode", b."Address2" as "ShipToName", max(a."Address2S") as "Address2S", max(a."U_BPBuyerS") as "U_BPBuyerS"
            from RIN12 a join ORIN b on a."DocEntry"=b."DocEntry"
            group by b."DocNum",b."ShipToCode", b."Address2"
        ) invCreAdr on Jdt."BaseRef"=invCreAdr."DocNum"  AND Jdt."TransType" = 14
        
        left join( select b."DocEntry", b."DocNum", b."ShipToCode", b."Address2" "ShipToName"
            , b."U_DocNo", b."U_InvDate", b."NumAtCard", b."U_CusSEL04", b."Comments", b."U_InvSeri", b."U_NumAtCard"
            , max(a."OcrCode") as "OcrCode", b."U_ProdBrand", b."U_CN_InvDate"
	        from INV1 a join OINV b on a."DocEntry"=b."DocEntry"
	        where b."CANCELED" = 'N'
	        group by b."DocEntry", b."DocNum",b."ShipToCode", b."Address2", b."U_DocNo", b."U_InvDate", b."U_CN_InvDate", b."NumAtCard", b."U_CusSEL04", b."Comments", b."U_ProdBrand", b."U_InvSeri", b."U_NumAtCard"
	    ) ar on Jdt."BaseRef"=ar."DocNum"  AND jdt."TransType" = 13
	    left join( select b."DocEntry", b."DocNum", b."ShipToCode", b."Address2" "ShipToName"
	            , b."U_DocNo", b."U_CN_InvDate", b."NumAtCard", b."U_CusSEL04", b."Comments", b."U_CN_InvSeri", b."U_NumAtCard"
	            , max(a."OcrCode") as "OcrCode", b."U_ProdBrand"
	        from RIN1 a join ORIN b on a."DocEntry"=b."DocEntry"
	        where b."CANCELED" = 'N'
	        group by b."DocEntry", b."DocNum",b."ShipToCode", b."Address2", b."U_DocNo", b."U_CN_InvDate", b."NumAtCard", b."U_CusSEL04", b."Comments", b."U_ProdBrand", b."U_CN_InvSeri", b."U_NumAtCard"
	    ) arc on Jdt."BaseRef"=arc."DocNum"  AND jdt."TransType" = 14
	    
		left join( select b."DocEntry", b."DocNum", b."Comments"
	            , max(a."OcrCode") as "OcrCode"
	        from ORCT b left join RCT2 a on a."DocEntry"=b."DocEntry"
	        where b."Canceled" = 'N'
	        group by b."DocEntry", b."DocNum", b."Comments"
	    ) IP on Jdt."BaseRef"=IP."DocNum"  AND jdt."TransType" = 24
		left join( select b."DocEntry", b."DocNum", b."Comments"
	            , max(a."OcrCode") as "OcrCode"
	        from OVPM b left join VPM2 a on a."DocEntry"=b."DocEntry"
	        where b."Canceled" = 'N'
	        group by b."DocEntry", b."DocNum", b."Comments"
	    ) OP on Jdt."BaseRef"=OP."DocNum"  AND jdt."TransType" = 46
	    
        LEFT JOIN (
	        SELECT 
	            INV1."DocEntry",
	            MAX(SO."U_DocNo") AS "U_DocNo"
	        FROM INV1
	        LEFT JOIN ORDR SO ON INV1."BaseType" = SO."ObjType" AND INV1."BaseEntry" = SO."DocEntry" AND SO."CANCELED" = 'N'
	        GROUP BY INV1."DocEntry"
	    ) SO ON AR."DocEntry" = SO."DocEntry"
        WHERE 
            Jdt."RefDate" <= :pRefDate
            AND Jdt."TransType" IN (13,14,24,30,46)
            AND Cust."CardType" = 'C'
            AND (IFNULL(:pCardCode,'')='*' OR Cust."CardCode" = :pCardCode )
            AND (IFNULL(:pAcctCode,'')='*' OR JdtLine."Account" = :pAcctCode )
            AND (IFNULL(:pCusGrp01,'')='*' OR Cust."U_CusGrp01" = :pCusGrp01 )
    ) X
    WHERE X."Amount" <> 0 AND IFNULL(X."Amount",0) <> 0
    AND (X."BrCode" = :pProdBrand or :pProdBrand='*')
) Y 
LEFT JOIN OOCR ProfitCtr ON Y."BrCode" = ProfitCtr."OcrCode"
LEFT JOIN "@MDM_CD_SEL04" CusSE ON CusSE."Code" = Y."SSCode"
WHERE Y."RemainAmount" <> 0
ORDER BY Y."CustCode";