
/* SELECT * FROM "@SYS_QR_PRM" T0 WHERE T0."U_DateFrom"='[%0]'; */
/* SELECT * FROM "@SYS_QR_PRM" T0 WHERE T0."U_DateTo"='[%1]'; */
/* SELECT * FROM OCRD T2 WHERE T2."U_CusGrp01"='[%2]'; */
/* SELECT * FROM OCRD T3 WHERE T3."U_CusGrp02"='[%3]'; */
/* SELECT * FROM OCRD T4 WHERE T4."U_CusGrp03"='[%4]'; */
/* SELECT * FROM OINV T5 WHERE T5."U_ProdBrand"='[%5]'; */
/* SELECT * FROM OCRD T6 WHERE T6."CardCode"='[%6]'; */

declare pFromDate DATETIME =/* T0."U_DateFrom" */ '[%0]';
declare pToDate DATETIME =/* T0."U_DateTo" */ '[%1]';
declare pCusGrp01 nvarchar(50) =/* T2."U_CusGrp01" */ '[%2]';
declare pCusGrp02 nvarchar(50) =/* T3."U_CusGrp02" */ '[%3]';
declare pCusGrp03 nvarchar(50) =/* T4."U_CusGrp03" */ '[%4]';
declare pProdBrand nvarchar(50) =/* T5."U_ProdBrand" */ '[%5]';
declare pCardCode nvarchar(50) =/* T6."CardCode" */ '[%6]';
declare pGpType nvarchar(50) =''/*AR, ARC, JE*/;   
declare pUserID nvarchar(50) ='';   
declare pReportName nvarchar(5000) ='Q202. Sales Details';

select $[USER] into pUserID from dummy;

call "BTS_QRM_FIN_GROSSPROFIT_DETAIL"(pFromDate, pToDate, pCusGrp01, pCusGrp02, pCusGrp03, pProdBrand, pCardCode, pGpType, pUserID, pReportName, tbRS);

select
	"GpType",
	"BrandCode",
	"BrandName",
	"Company",
	"Company Name",
	"CatName1",
	"CatCode2",
	"DeptCode",
	"DeptName",
	"AreaCode1",
	"AreaName1",
	"AreaCode2",
	"AreaName2",
	"AreaCode3",
	"AreaName3",
	"MidCode",
	"MidName",
	"CustCode",
	"Cust NC",
	"CustName",
	"ShortName",
	"Buyer",
	"BillDate",
	"Doc Internal",
	"Invoice No",
	"SINo",
	"SONo",
	"CodeLev1",
	"NameLev1",
	"CodeLev2",
	"NameLev2",
	"CodeLev3",
	"NameLev3",
	"CodeLev4",
	"NameLev4",
	"CodeLev5",
	"NameLev5",
	"InvCode",
	"InvCode2",
	"InvName",
	"Unit",
	"QtySale",
	"QtyPromo",
	"BasePrice",
	"StdDisc",
	"CtDisc",
	"PromoCode",
	"PromoDisc",
	"TaxRate",
	"SalesPrice",
	"SalesAmt",
	"WH.Code",
	"WH.Name",
	"Remarks",
    "InvNotes" AS "Notes (Invoice)",
	"Note2",
	"SMCode",
	"SMName",
	"Addrcode",
	"AddrName",
	"AddrName2",
	"AddrName2",
	"AreaCode",
	"AreaName",
	"ProvinceCode",
	"ProvinceName",
	"Reference No.",
	"CINo",
	"FOCPrice",
	"FOCAmt",
    "Reason",
	"AccNo",
	"Interco",
	"SysType"
from :tbRS
where "QType" in ('S1','A2')
order by "BillDate", "Doc Internal";