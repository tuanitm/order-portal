SELECT *
FROM (
	SELECT 
		T3."WhsCode",
		T3."WhsName",
		T1."ItemCode",
		T1."ItemName",
		T1."InvntryUom",
		T0."OnHand",
		--T0."IsCommited" as "Commited",
		IFNULL(T4."OpenQty",0) + IFNULL(T5."TRQty",0) + IFNULL(T6."POQty",0) as "Committed",
		T0."OnHand" - (IFNULL(T4."OpenQty",0) + IFNULL(T5."TRQty",0) + IFNULL(T6."POQty",0)) AS "Available"
	FROM OITW T0
	JOIN OITM T1 ON T0."ItemCode" = T1."ItemCode"
	JOIN OITB T2 ON T1."ItmsGrpCod" = T2."ItmsGrpCod"
	JOIN OWHS T3 ON T0."WhsCode" = T3."WhsCode"
	LEFT JOIN (
		-- Open SO (trừ)
		SELECT 
			l."ItemCode", 
			l."WhsCode",
			SUM(l."OpenQty") AS "OpenQty"
		FROM RDR1 l
		INNER JOIN ORDR h ON h."DocEntry" = l."DocEntry"
		WHERE h."DocStatus" = 'O' AND h."CANCELED" = 'N'
		GROUP BY l."ItemCode", l."WhsCode"
	) T4 ON T0."ItemCode" = T4."ItemCode" AND T0."WhsCode" = T4."WhsCode"
	LEFT JOIN (
		
		SELECT t1."ItemCode",
			   t1."FromWhsCod" AS "WhsCode",
			   SUM(t1."OpenQty") AS "TRQty"
		FROM OWTQ t0
		JOIN WTQ1 t1 ON t0."DocEntry" = t1."DocEntry"
		WHERE t0."DocStatus" = 'O'
		GROUP BY t1."ItemCode", t1."FromWhsCod"
	) T5 ON T0."ItemCode" = T5."ItemCode" AND T0."WhsCode" = T5."WhsCode"
	LEFT JOIN (
		
		SELECT t1."ItemCode",
			   t1."wareHouse" AS "WhsCode",
			   SUM(GREATEST(t1."PlannedQty" - t1."IssuedQty", 0)) AS "POQty"
		FROM OWOR t0
		JOIN WOR1 t1 ON t0."DocEntry" = t1."DocEntry"
		WHERE t0."Status" IN ('P','R')
		GROUP BY t1."ItemCode", t1."wareHouse"
	) T6 ON T0."ItemCode" = T6."ItemCode" AND T0."WhsCode" = T6."WhsCode"
	WHERE T1."InvntItem" = 'Y'
) X 

WHERE X."OnHand" <> 0 OR X."Committed" <> 0
ORDER BY X."WhsCode", X."ItemCode";